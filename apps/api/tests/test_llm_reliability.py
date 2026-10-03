"""LLM reliability: thinking models get room (and are asked to think briefly) for background
JSON, cut-off or malformed JSON moves on to the next model, provider error text is kept,
a group waits for a cooling member even when another member failed for good, and the
health check tests the models the groups really use, JSON mode included."""

import json
from collections.abc import Callable

import httpx
import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.engine import gateway, store, tester
from agentic.models import AIProvider, BrainFact, LLMCall

from .conftest import csrf, setup_owner
from .test_agents import llm, new_agent, office  # noqa: F401 - fixtures and helpers

KEY = "good-key-123"
Reply = Callable[[dict], httpx.Response]


def ok(body: dict, content: str | None = None, finish: str = "stop") -> httpx.Response:
    if content is None:
        content = '{"facts": []}' if body.get("response_format") else "OK"
    return httpx.Response(
        200,
        json={
            "model": body["model"],
            "choices": [{"finish_reason": finish, "message": {"content": content}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 20},
        },
    )


class FakeProvider:
    """OpenAI-compatible fake: each model answers through its own function."""

    def __init__(self, models: dict[str, Reply] | None = None) -> None:
        self.models = models or {}
        self.bodies: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        body = json.loads(request.content)
        self.bodies.append(body)
        return self.models.get(body["model"], ok)(body)

    def calls(self, model: str) -> list[dict]:
        return [b for b in self.bodies if b["model"] == model]


@pytest.fixture
def fake():
    f = FakeProvider()
    engine_client.use_transport(httpx.MockTransport(f.handler))
    yield f
    engine_client.use_transport(None)


async def add_provider(c: httpx.AsyncClient, name: str, host: str) -> dict:
    r = await c.post(
        "/api/ai/providers",
        json={"name": name, "base_url": f"https://{host}/v1", "api_key": KEY, "tier": "paid"},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def set_group(c: httpx.AsyncClient, name: str, members: list[tuple[str, str]]) -> None:
    r = await c.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": p, "model_id": m} for p, m in members]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text


async def workspace_of(provider_id: str) -> str:
    async with SessionLocal() as db:
        p = await db.get(AIProvider, provider_id)
        assert p is not None
        return p.workspace_id


async def ask(ws: str, group: str = "fast", **kw) -> gateway.GatewayReply:
    kw.setdefault("task", "brain.extract")
    kw.setdefault("json_mode", True)
    async with SessionLocal() as db:
        return await gateway.chat(db, ws, group, [{"role": "user", "content": "facts?"}], **kw)


async def calls() -> list[LLMCall]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(LLMCall).order_by(LLMCall.id))).all())


# ---------------------------------------------------------------- recognising thinkers


@pytest.mark.parametrize(
    "model",
    [
        "openai/gpt-oss-20b",
        "gpt-oss-120b",
        "o3-mini",
        "o4-mini",
        "gpt-5.4-mini",
        "deepseek-reasoner",
        "deepseek/deepseek-r1:free",
        "deepseek-r1-distill-llama-70b",
        "qwq-32b",
        "qwen/qwen3-32b",
        "moonshotai/kimi-k2-thinking",
        "glm-4.5-air",
        "gemini-2.5-flash",
    ],
)
def test_thinking_models_are_recognised(model: str):
    assert engine_client.thinks(model)


@pytest.mark.parametrize(
    "model",
    ["llama-3.3-70b-versatile", "gpt-4o-mini", "deepseek-chat", "gpt-5-chat-latest", "m1"],
)
def test_plain_models_are_not(model: str):
    assert not engine_client.thinks(model)


def test_only_some_families_take_reasoning_effort():
    assert engine_client.takes_effort("openai/gpt-oss-20b")
    assert engine_client.takes_effort("gpt-5.4-mini")
    assert not engine_client.takes_effort("deepseek-reasoner")  # DeepSeek has no such knob
    assert not engine_client.takes_effort("llama-3.3-70b-versatile")


# ---------------------------------------------------------------- budgets and effort


async def test_background_json_asks_gpt_oss_to_think_briefly(client, fake):
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "openai/gpt-oss-20b")])
    ws = await workspace_of(p["id"])

    r = await ask(ws, max_tokens=600)
    assert r.content == '{"facts": []}'
    sent = fake.bodies[-1]
    assert sent["reasoning_effort"] == "low"
    assert sent["max_tokens"] >= engine_client.JSON_REASONING_FLOOR

    # A chat turn is not background JSON: room to think, but no effort override.
    await ask(ws, task="agent.chat", json_mode=False, max_tokens=600)
    sent = fake.bodies[-1]
    assert "reasoning_effort" not in sent and sent["max_tokens"] == engine_client.REASONING_FLOOR


async def test_plain_model_keeps_its_budget_and_gets_no_effort(client, fake):
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "llama-3.3-70b-versatile")])
    await ask(await workspace_of(p["id"]), max_tokens=900)
    assert fake.bodies[-1]["max_tokens"] == 900 and "reasoning_effort" not in fake.bodies[-1]


async def test_rejected_reasoning_effort_is_dropped_and_remembered(client, fake):
    def picky(body: dict) -> httpx.Response:
        if "reasoning_effort" in body:
            return httpx.Response(
                400,
                json={"error": {"message": "Unrecognized request argument: reasoning_effort"}},
            )
        return ok(body)

    fake.models["gpt-5-mini"] = picky
    await setup_owner(client)
    p = await add_provider(client, "Proxy", "good.fake")
    await set_group(client, "fast", [(p["id"], "gpt-5-mini")])
    ws = await workspace_of(p["id"])
    await ask(ws)
    assert "no_reasoning_effort" in await store.quirks(p["id"], "gpt-5-mini")
    before = len(fake.bodies)
    await ask(ws)
    assert len(fake.bodies) == before + 1  # learned: no second 400


async def test_groq_out_of_tokens_400_retries_with_room(client, fake):
    """Groq's own JSON check: 400 json_validate_failed until the budget is big enough."""

    def groq(body: dict) -> httpx.Response:
        if body["max_tokens"] < engine_client.JSON_REASONING_FLOOR:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "code": "json_validate_failed",
                        "message": "max completion tokens reached before generating a valid "
                        "document",
                    }
                },
            )
        return ok(body)

    fake.models["mystery-thinker"] = groq
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "mystery-thinker")])
    r = await ask(await workspace_of(p["id"]), max_tokens=600)
    assert r.content == '{"facts": []}'
    assert await store.is_reasoning(p["id"], "mystery-thinker")


# ---------------------------------------------------------------- unusable replies


async def test_truncated_json_moves_on_to_the_next_member(client, fake):
    fake.models["cut-model"] = lambda b: ok(b, '{"facts": [{"text": "Ali runs', "length")
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "cut-model"), (p["id"], "good-model")])

    r = await ask(await workspace_of(p["id"]))
    assert r.model == "good-model" and r.attempts[0]["error_class"] == "truncated"
    first, second = await calls()
    assert first.status == "error" and first.error_class == "truncated"
    assert first.error_detail and "finish_reason=length" in first.error_detail
    assert second.status == "ok" and second.error_detail is None


async def test_json_without_the_expected_key_is_not_an_answer(client, fake):
    from agentic.brain.facts import has_list

    fake.models["chatty-model"] = lambda b: ok(b, '{"answer": "I found no facts."}')
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "chatty-model"), (p["id"], "good-model")])
    r = await ask(await workspace_of(p["id"]), accept=has_list("facts"))
    assert r.model == "good-model"
    assert (await calls())[0].error_class == "unusable_reply"


async def test_provider_error_text_is_kept_with_keys_redacted(client, fake):
    fake.models["bad-model"] = lambda b: httpx.Response(
        400,
        json={"error": {"message": "Bad request from key sk-proj-abcdefghijklmnop0123456789"}},
    )
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    await set_group(client, "fast", [(p["id"], "bad-model")])
    with pytest.raises(gateway.GatewayUnavailable):
        await ask(await workspace_of(p["id"]))
    (row,) = await calls()
    assert row.error_class == "bad_request"
    assert row.error_detail and "Bad request from" in row.error_detail
    assert "abcdefghijklmnop" not in row.error_detail and "[redacted]" in row.error_detail


# ---------------------------------------------------------------- waiting


async def test_waits_for_a_cooling_member_when_the_other_failed_for_good(client, fake, monkeypatch):
    fake.models["bad-model"] = lambda b: httpx.Response(
        400, json={"error": {"message": "this request is malformed"}}
    )
    await setup_owner(client)
    broken = await add_provider(client, "Strict", "good.fake")
    cooling = await add_provider(client, "Busy", "flaky.fake")
    await set_group(client, "fast", [(broken["id"], "bad-model"), (cooling["id"], "good-model")])
    await store.cool(cooling["id"], 5)
    slept: list[float] = []

    async def no_sleep(s: float) -> None:  # time passes: the cooldown runs out
        slept.append(s)
        await store.clear_cooldown(cooling["id"])

    monkeypatch.setattr(gateway.asyncio, "sleep", no_sleep)
    r = await ask(await workspace_of(broken["id"]))
    assert r.provider_name == "Busy" and slept and slept[0] <= 6
    assert len(fake.calls("bad-model")) == 1  # not asked again after the wait
    assert r.attempts[0]["skipped"] == "failed earlier in this call"


# ---------------------------------------------------------------- health check


async def test_scheduled_check_uses_the_group_model_and_probes_json(client, fake):
    fake.models["old-model"] = ok
    fake.models["gpt-5.4-mini"] = lambda b: ok(
        b, "Sure! Here it is: ok=true" if b.get("response_format") else "OK"
    )
    await setup_owner(client)
    p = await add_provider(client, "OpenAI", "good.fake")
    await set_group(client, "smart", [(p["id"], "gpt-5.4-mini")])

    async with SessionLocal() as db:
        prov = await db.get(AIProvider, p["id"])
        assert prov is not None
        target = tester.Target(
            workspace_id=prov.workspace_id,
            base_url=prov.base_url,
            key=KEY,
            preset=None,
            name=prov.name,
            tier=prov.tier,
            provider=prov,
            source="scheduled",
            model="old-model",  # what the last check used
        )
        events = [e async for e in tester.run(target, db)]
    steps = {e["step"]: e for e in events if e["type"] == "step" and e["status"] != "running"}
    assert steps["chat"]["status"] == "ok" and steps["json"]["status"] == "failed"
    assert events[-1]["model"] == "gpt-5.4-mini" and events[-1]["ok"] is False
    json_probe = fake.calls("gpt-5.4-mini")[-1]
    assert json_probe["reasoning_effort"] == "low"
    assert json_probe["max_tokens"] >= engine_client.JSON_REASONING_FLOOR
    assert not fake.calls("old-model")

    after = next(x for x in (await client.get("/api/ai/providers")).json() if x["id"] == p["id"])
    assert after["health"] == "degraded"
    assert "JSON" in after["last_test_result"]["summary"]


# ---------------------------------------------------------------- private memory


async def test_private_assistant_never_teaches_the_team(client, llm):  # noqa: F811
    from agentic.brain import facts
    from agentic.brain.scope import for_agent
    from agentic.models import Agent

    o = await office(client)
    a = await new_agent(client, o, "Chief of Staff")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent is not None
        agent.private = True
        await db.commit()
        llm.say(
            json.dumps(
                {"facts": [{"text": "Siti approves all supplier invoices.", "private": False}]}
            )
        )
        learned = await facts.learn(
            db,
            agent,
            await for_agent(db, agent),
            "PERSON: Siti approves all supplier invoices.",
            source_kind="task",
            source_id="task-123",
            source_label="test",
        )
        assert learned.added
        fact = await db.scalar(select(BrainFact))
        assert fact is not None and fact.agent_id == agent.id and fact.branch_id is None
    rows = await calls()
    assert rows[-1].task == "brain.extract" and rows[-1].task_id == "task-123"
