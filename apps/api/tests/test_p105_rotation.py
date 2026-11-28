"""P105: shared models take turns, size errors and slow models fail over fast, and the owner
marks which models share the work.

Fake providers (httpx MockTransport): every host answers with its own name, so a test sees
who answered. good.fake, flaky.fake, broken.fake and ratelimit.fake are the hosts the SSRF
guard lets through in tests; what each one does is up to the test's handler.
"""

import asyncio
from collections import Counter

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.engine import client as engine_client
from agentic.engine import errors, gateway, rotation, store

from .conftest import csrf, setup_owner
from .test_ai_engine import GOOD_KEY, add_provider
from .test_office_roles import as_role

HOSTS = ("good.fake", "flaky.fake", "broken.fake", "ratelimit.fake")


def answer(host: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "m",
            "usage": {"prompt_tokens": 10, "completion_tokens": 2},
            "choices": [{"finish_reason": "stop", "message": {"content": f"from {host}"}}],
        },
    )


class Fake:
    """Each host answers with its name unless `behave[host]` says otherwise."""

    def __init__(self) -> None:
        self.asked: list[str] = []
        self.behave: dict[str, object] = {}

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if request.headers.get("authorization") != f"Bearer {GOOD_KEY}":
            return httpx.Response(401, json={})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "m"}]})
        self.asked.append(host)
        how = self.behave.get(host)
        if how == "too_large":
            return httpx.Response(
                413,
                json={
                    "error": {
                        "message": "Request too large for model `m` in organization `org` "
                        "on tokens per minute (TPM): Limit 8000, Requested 9000",
                        "code": "rate_limit_exceeded",
                    }
                },
            )
        if how == "500":
            return httpx.Response(500, text="down")
        if isinstance(how, float):  # slow: answers after this many seconds
            await asyncio.sleep(how)
        return answer(host)


@pytest.fixture
def fake():
    f = Fake()
    engine_client.use_transport(httpx.MockTransport(f))
    yield f
    engine_client.use_transport(None)


async def put_group(c: httpx.AsyncClient, name: str, members: list[tuple[str, bool]]) -> dict:
    r = await c.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": p, "model_id": "m", "shared": s} for p, s in members]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text
    return r.json()


async def office(c: httpx.AsyncClient, n: int = 3) -> list[dict]:
    await setup_owner(c)
    return [await add_provider(c, f"P{i}", HOSTS[i]) for i in range(n)]


async def ask(c: httpx.AsyncClient, group: str = "smart") -> dict:
    r = await c.post("/api/ai/playground", json={"group": group, "prompt": "hi"}, headers=csrf(c))
    assert r.status_code == 200, r.text
    return r.json()


async def workspace_id() -> str:
    from agentic.core.db import SessionLocal
    from agentic.models import Workspace

    async with SessionLocal() as db:
        return str(await db.scalar(select(Workspace.id)))


async def gw(group: str = "smart", **kw) -> gateway.GatewayReply:
    from agentic.core.db import SessionLocal

    ws = await workspace_id()
    async with SessionLocal() as db:
        return await gateway.chat(
            db, ws, group, [{"role": "user", "content": "hi"}], **{"task": "agent.chat", **kw}
        )


# ---------------------------------------------------------------- the plan itself (pure)


def _m(name: str, shared: bool = True) -> dict:
    return {"provider_id": name, "model_id": "m", **({"shared": True} if shared else {})}


def test_equal_models_take_even_turns():
    members = [_m("a"), _m("b"), _m("c", shared=False)]
    firsts = Counter(rotation.plan(members, {}, turn)[0]["provider_id"] for turn in range(200))
    assert set(firsts) == {"a", "b"} and abs(firsts["a"] - firsts["b"]) <= 10
    # whoever goes first, the other shared one is next and the rest keeps its place
    for turn in range(5):
        order = [m["provider_id"] for m in rotation.plan(members, {}, turn)]
        assert sorted(order[:2]) == ["a", "b"] and order[2] == "c"


def test_a_faster_or_steadier_model_gets_more_of_the_work():
    members = [_m("a"), _m("b")]
    health = {"a|m": rotation.Health(ms=1000), "b|m": rotation.Health(ms=2000)}
    firsts = Counter(rotation.plan(members, health, t)[0]["provider_id"] for t in range(400))
    assert 0.53 < firsts["a"] / 400 < 0.66  # sqrt(2) : 1, about 59/41
    failing = {"a|m": rotation.Health(ms=1000, fail=0.9), "b|m": rotation.Health(ms=1000)}
    firsts = Counter(rotation.plan(members, failing, t)[0]["provider_id"] for t in range(400))
    assert 0 < firsts["a"] < 40  # a little work, so it is noticed when it is well again


def test_sticky_member_goes_first_unless_unhealthy():
    members = [_m("a"), _m("b"), _m("c", shared=False)]
    for turn in range(20):
        assert rotation.plan(members, {}, turn, sticky="b|m")[0]["provider_id"] == "b"
    sick = {"b|m": rotation.Health(ms=900, fail=0.7)}
    firsts = {rotation.plan(members, sick, t, sticky="b|m")[0]["provider_id"] for t in range(20)}
    assert "a" in firsts
    # a sticky member that is not shared (or gone) is ignored
    assert rotation.plan(members, {}, 1, sticky="c|m")[0]["provider_id"] in ("a", "b")


def test_one_or_no_shared_member_keeps_the_saved_order():
    members = [_m("a", shared=False), _m("b", shared=False)]
    assert [m["provider_id"] for m in rotation.plan(members, {}, 7)] == ["a", "b"]


def test_request_too_large_is_its_own_class_and_cools_nothing():
    groq = (
        "Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier "
        "`on_demand` on tokens per minute (TPM): Limit 8000, Requested 12000"
    )
    for status, body in (
        (413, groq),
        (429, groq),
        (400, '{"error": {"code": "context_length_exceeded"}}'),
        (400, "This model's maximum context length is 65536 tokens."),
    ):
        f = errors.classify_response(status, body, "api.fake")
        assert f.error_class == "too_large" and f.cool_seconds == 0, (status, body)
    plain = errors.classify_response(429, "Rate limit reached. Try again in 2s", "api.fake", "2")
    assert plain.error_class == "rate_limited"


# ---------------------------------------------------------------- through the gateway


async def test_shared_models_spread_the_work_and_the_rest_waits(client, fake):
    p = await office(client)
    await put_group(client, "smart", [(p[0]["id"], True), (p[1]["id"], True), (p[2]["id"], False)])
    for _ in range(20):
        await ask(client)
    seen = Counter(fake.asked)
    assert seen["good.fake"] >= 6 and seen["flaky.fake"] >= 6, seen
    assert seen["broken.fake"] == 0  # not shared: only when both shared ones cannot answer
    h = await rotation.health_of(p[0]["id"], "m")
    assert h.n >= 6 and h.ms is not None and h.fail == 0


async def test_an_agent_stays_on_one_model_for_the_prompt_cache(client, fake):
    p = await office(client, 2)
    await put_group(client, "smart", [(p[0]["id"], True), (p[1]["id"], True)])
    hosts = {(await gw(agent_id="ag_one")).content for _ in range(8)}
    assert len(hosts) == 1
    # another agent (and calls with no agent) still spread
    spread = {(await gw()).content for _ in range(10)}
    assert len(spread) == 2


async def test_failover_goes_to_the_next_shared_model_then_the_rest(client, fake):
    p = await office(client)
    await put_group(client, "smart", [(p[0]["id"], True), (p[1]["id"], True), (p[2]["id"], False)])
    fake.behave = {"good.fake": "500"}
    for _ in range(6):
        body = await ask(client)
        assert body["content"] == "from flaky.fake"
    assert await store.cooling_for(p[0]["id"]) > 0  # a 5xx still rests the provider
    fake.behave["flaky.fake"] = "500"
    await store.clear_cooldown(p[0]["id"])
    body = await ask(client)
    assert body["content"] == "from broken.fake"
    assert [a.get("error_class") for a in body["attempts"][:2]] == ["provider_error"] * 2


async def test_a_request_too_big_for_a_model_skips_it_without_cooling(client, fake, monkeypatch):
    slept: list[float] = []

    async def no_sleep(s: float) -> None:
        slept.append(s)

    monkeypatch.setattr(gateway.asyncio, "sleep", no_sleep)
    p = await office(client, 2)
    await put_group(client, "fast", [(p[0]["id"], False), (p[1]["id"], False)])
    fake.behave = {"good.fake": "too_large"}
    body = await ask(client, "fast")
    assert body["content"] == "from flaky.fake"
    assert body["attempts"][0]["error_class"] == "too_large"
    assert await store.cooling_for(p[0]["id"]) == 0
    assert await store.model_cooling_for(p[0]["id"], "m") == 0
    assert not slept
    # the next (smaller) request is asked of it again straight away
    fake.behave = {}
    assert (await ask(client, "fast"))["content"] == "from good.fake"
    # and its health did not suffer for one big request
    assert (await rotation.health_of(p[0]["id"], "m")).fail == 0


async def test_a_slow_model_is_left_for_the_next_when_a_person_waits(client, fake, monkeypatch):
    monkeypatch.setattr(settings, "ai_answer_timeout", 0.3)
    p = await office(client, 2)
    await put_group(client, "smart", [(p[0]["id"], False), (p[1]["id"], False)])
    fake.behave = {"good.fake": 3.0}
    body = await ask(client)
    assert body["content"] == "from flaky.fake"
    assert body["attempts"][0]["error_class"] == "slow"
    assert await store.cooling_for(p[0]["id"]) == 0  # slow once is not down for everyone
    assert (await rotation.health_of(p[0]["id"], "m")).fail > 0
    # the last model that could answer is always waited for
    await put_group(client, "fast", [(p[0]["id"], False)])
    fake.behave = {"good.fake": 0.6}
    assert (await ask(client, "fast"))["content"] == "from good.fake"


async def test_background_work_is_not_cut_short(client, fake, monkeypatch):
    monkeypatch.setattr(settings, "ai_answer_timeout", 0.3)
    p = await office(client, 2)
    await put_group(client, "bulk", [(p[0]["id"], False), (p[1]["id"], False)])
    fake.behave = {"good.fake": 0.6}
    r = await gw("bulk", task="brain.extract.p105")
    assert r.content == "from good.fake"


async def test_background_work_moves_on_after_its_own_longer_limit(client, fake, monkeypatch):
    """P149: a model on the owner's own server that takes too long on background work is left
    for the next one (AI Foundry), with a longer limit than a waiting person's."""
    monkeypatch.setattr(settings, "ai_answer_timeout", 0.1)
    monkeypatch.setattr(settings, "ai_task_answer_timeout", 0.3)
    p = await office(client, 2)
    await put_group(client, "bulk", [(p[0]["id"], False), (p[1]["id"], False)])
    fake.behave = {"good.fake": 3.0}
    r = await gw("bulk", task="brain.extract.p149")
    assert r.content == "from flaky.fake"
    assert r.attempts[0]["error_class"] == "slow"
    # 0 turns the limit off: background work waits for the model again.
    monkeypatch.setattr(settings, "ai_task_answer_timeout", 0)
    fake.behave = {"good.fake": 0.4}
    assert (await gw("bulk", task="brain.extract.p149b")).content == "from good.fake"


async def _local_backup(c: httpx.AsyncClient) -> dict:
    return await add_provider(c, store.LOCAL_PROVIDER, "ratelimit.fake", tier="local")


async def test_no_backup_model_while_a_main_model_rests_a_few_seconds(client, fake, monkeypatch):
    """A tiny job reaches the fast group: the main model rests 5 s, the backup is free. The
    gateway waits for the main model instead of handing the job to the backup."""
    slept: list[float] = []

    async def time_passes(s: float) -> None:
        from agentic.core.valkey import valkey

        slept.append(s)
        for k in await valkey().keys("ai_cooldown*"):
            await valkey().delete(k)

    monkeypatch.setattr(gateway.asyncio, "sleep", time_passes)
    p = await office(client, 1)
    local = await _local_backup(client)
    await put_group(client, "fast", [(p[0]["id"], False), (local["id"], False)])
    await store.cool_model(p[0]["id"], "m", 5)
    r = await gw("fast", task="file.understand")
    assert r.content == "from good.fake" and "ratelimit.fake" not in fake.asked
    assert slept and slept[0] < 10


async def test_a_person_waits_briefly_for_a_resting_model_not_a_minute(client, fake, monkeypatch):
    slept: list[float] = []

    async def time_passes(s: float) -> None:
        from agentic.core.valkey import valkey

        slept.append(s)
        for k in await valkey().keys("ai_cooldown*"):
            await valkey().delete(k)

    monkeypatch.setattr(gateway.asyncio, "sleep", time_passes)
    p = await office(client, 1)
    await put_group(client, "smart", [(p[0]["id"], False)])
    await store.cool_model(p[0]["id"], "m", 4)
    assert (await gw()).content == "from good.fake" and slept
    # resting longer than a person should wait: the chat gives up (and the runtime's backup
    # answers, saying so)
    slept.clear()
    await store.cool_model(p[0]["id"], "m", int(settings.ai_chat_max_wait) + 30)
    with pytest.raises(gateway.GatewayUnavailable) as e:
        await gw()
    assert not slept and e.value.retry_in


# ---------------------------------------------------------------- the group settings (API)


async def test_owner_marks_shared_models_and_they_move_to_the_top(client, fake):
    p = await office(client)
    body = await put_group(
        client, "smart", [(p[2]["id"], False), (p[0]["id"], True), (p[1]["id"], True)]
    )
    assert [(m["provider_id"], m.get("shared", False)) for m in body["members"]] == [
        (p[0]["id"], True),
        (p[1]["id"], True),
        (p[2]["id"], False),
    ]
    listed = next(g for g in (await client.get("/api/ai/groups")).json() if g["name"] == "smart")
    assert [m.get("shared", False) for m in listed["members"]] == [True, True, False]
    # stored tidy: only shared members carry the mark
    from agentic.core.db import SessionLocal
    from agentic.models import ModelGroup

    async with SessionLocal() as db:
        g = await db.scalar(select(ModelGroup).where(ModelGroup.name == "smart"))
        assert g is not None and "shared" not in g.members[2]


async def test_only_who_runs_the_ai_engine_changes_groups(client, fake):
    p = await office(client, 1)
    for role in ("viewer", "management"):
        other = await as_role(client, f"{role}.p105@example.com", role)
        try:
            r = await other.put(
                "/api/ai/groups/smart",
                json={"members": [{"provider_id": p[0]["id"], "model_id": "m", "shared": True}]},
                headers=csrf(other),
            )
            assert r.status_code == 403, (role, r.text)
        finally:
            await other.aclose()


async def test_member_stats_show_answer_time_and_success(client, fake):
    p = await office(client, 2)
    await put_group(client, "smart", [(p[0]["id"], True), (p[1]["id"], True)])
    fake.behave = {"flaky.fake": "500"}
    for _ in range(6):
        await ask(client)
    r = await client.get("/api/ai/groups/stats")
    assert r.status_code == 200, r.text
    stats = {s["provider_id"]: s for s in r.json()}
    good, bad = stats[p[0]["id"]], stats[p[1]["id"]]
    assert good["calls"] >= 6 and good["success_rate"] == 1.0 and good["avg_ms"] is not None
    assert bad["calls"] >= 1 and bad["success_rate"] == 0.0 and bad["avg_ms"] is None
    # a viewer may look (engine.view); management, without the AI engine, may not
    viewer = await as_role(client, "viewer.stats@example.com", "viewer")
    mgmt = await as_role(client, "mgmt.stats@example.com", "management")
    try:
        assert (await viewer.get("/api/ai/groups/stats")).status_code == 200
        assert (await mgmt.get("/api/ai/groups/stats")).status_code == 403
    finally:
        await viewer.aclose()
        await mgmt.aclose()


async def test_stats_count_a_served_model_name_under_its_member(client, fake):
    """Azure answers with the model behind a deployment: count it under the deployment."""
    from datetime import UTC, datetime

    from agentic.core.db import SessionLocal
    from agentic.models import LLMCall

    await setup_owner(client)
    prov = await add_provider(client, "Azure 2", "good.fake")
    r = await client.put(
        "/api/ai/groups/smart",
        json={"members": [{"provider_id": prov["id"], "model_id": "arisha-gpt41-mini"}]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    ws = await workspace_id()
    async with SessionLocal() as db:
        for model, status, ms in (
            ("gpt-4.1-mini-2025-04-14", "ok", 1000),
            ("gpt-4.1-mini-2025-04-14", "ok", 2000),
            ("arisha-gpt41-mini", "error", 50),
        ):
            db.add(
                LLMCall(
                    workspace_id=ws,
                    ts=datetime.now(UTC),
                    task="agent.chat",
                    provider_id=prov["id"],
                    provider_name="Azure 2",
                    model=model,
                    status=status,
                    latency_ms=ms,
                )
            )
        await db.commit()
    out = (await client.get("/api/ai/groups/stats")).json()
    assert len(out) == 1
    s = out[0]
    assert (s["calls"], s["ok"], s["avg_ms"], s["success_rate"]) == (3, 2, 1500, round(2 / 3, 3))


# ---------------------------------------------------------------- migration 0065


async def test_migration_shares_the_two_azure_models_only_when_untouched():
    import importlib.util
    from pathlib import Path

    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    from agentic.core.db import SessionLocal, engine
    from agentic.models import AIProvider, ModelGroup, Workspace

    path = Path(__file__).parent.parent / "alembic" / "versions" / "0065_share_azure_pool.py"
    spec = importlib.util.spec_from_file_location("m0065", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    async with SessionLocal() as db:
        ws = Workspace(name="Mig Co", slug="mig-co")
        db.add(ws)
        await db.flush()
        a1 = AIProvider(
            workspace_id=ws.id,
            name="Azure AI Foundry",
            preset="azure-foundry",
            base_url="https://r1.services.ai.azure.com/openai/v1",
        )
        a2 = AIProvider(
            workspace_id=ws.id,
            name="Azure AI Foundry 2",
            base_url="https://r2.openai.azure.com/openai/v1",
        )
        other = AIProvider(workspace_id=ws.id, name="OpenAI", base_url="https://api.openai.com/v1")
        db.add_all([a1, a2, other])
        await db.flush()
        m1 = {"provider_id": a1.id, "model_id": "DeepSeek-V4.1-Flash-1017"}
        m2 = {"provider_id": a2.id, "model_id": "arisha-gpt41-mini"}
        m3 = {"provider_id": other.id, "model_id": "gpt-5.4-mini"}
        groups = {
            "smart": [m1, m2, m3],
            "bulk": [m2, m1],
            "fast": [m3, m1, m2],  # the owner put another model first: left alone
            "reasoning": [{**m1, "shared": True}, m2],  # already chosen: left alone
        }
        for i, (name, members) in enumerate(groups.items()):
            db.add(
                ModelGroup(workspace_id=ws.id, name=name, label=name, members=members, position=i)
            )
        await db.commit()

    def run(sync_conn, step: str) -> None:
        with Operations.context(MigrationContext.configure(sync_conn)):
            getattr(mod, step)()

    async with engine.begin() as conn:
        await conn.run_sync(run, "upgrade")
    async with SessionLocal() as db:
        got = {
            g.name: [bool(m.get("shared")) for m in g.members]
            for g in (await db.scalars(select(ModelGroup))).all()
        }
    assert got["smart"] == [True, True, False]
    assert got["bulk"] == [True, True]
    assert got["fast"] == [False, False, False]
    assert got["reasoning"] == [True, False]

    async with engine.begin() as conn:
        await conn.run_sync(run, "downgrade")
    async with SessionLocal() as db:
        rows = (await db.scalars(select(ModelGroup))).all()
        assert not any(m.get("shared") for g in rows for m in g.members)
