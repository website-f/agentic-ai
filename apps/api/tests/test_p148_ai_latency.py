"""P148c (Fitri, 28 Nov 2026: "the AI response must be super fast as well, unless the AI model
itself is slow"): the time from a person's message to the first word of the answer.

A fake provider answers after a fixed delay, so everything measured on top of that delay is
ours: the preparation before the provider call (under a budget), the slow preparations side by
side instead of one after the other, the tool list built once, memory that may not hold the
answer back, and the answer streamed so its first words arrive before the model finishes.
"""

import asyncio
import json
import time

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import runtime, scope_guard
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.engine import stream, timing
from agentic.models import Agent, AgentMessage, ChatSession, User, Workspace

from .conftest import csrf
from .test_agents import new_agent, new_task, office, temporal  # noqa: F401 - fixture

DELAY = 0.4  # the fake model's own time to answer
# Our part before the provider call, in the test environment (Postgres + Valkey on this
# machine). Measured at ~60-120 ms; the budget leaves room for a slow test machine.
PRE_CALL_BUDGET = 1.0


class SlowModel:
    """An OpenAI-compatible model that takes DELAY seconds. Streams when asked to: the first
    words right away, the rest after DELAY."""

    def __init__(self) -> None:
        self.arrived: list[float] = []  # perf_counter when each chat request came in
        self.finished: list[float] = []  # ... and when its answer was complete
        self.bodies: list[dict] = []
        self.replies: list[dict] = []

    def say(self, text: str) -> "SlowModel":
        self.replies.append({"content": text})
        return self

    def call(self, name: str, **args) -> "SlowModel":
        self.replies.append(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": f"call_{len(self.replies)}",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                ],
            }
        )
        return self

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        if not request.url.path.endswith("/chat/completions"):
            return httpx.Response(404, json={"error": "no route"})
        self.arrived.append(time.perf_counter())
        body = json.loads(request.content)
        self.bodies.append(body)
        msg = self.replies.pop(0) if self.replies else {"content": "(script empty)"}
        if body.get("stream"):
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=self._sse(body, msg)
            )
        await asyncio.sleep(DELAY)
        self.finished.append(time.perf_counter())
        return httpx.Response(
            200,
            json={
                "model": body["model"],
                "choices": [
                    {
                        "finish_reason": "tool_calls" if msg.get("tool_calls") else "stop",
                        "message": msg,
                    }
                ],
                "usage": {"prompt_tokens": 100, "completion_tokens": 20},
            },
        )

    async def _sse(self, body: dict, msg: dict):
        def ev(obj: dict) -> bytes:
            return f"data: {json.dumps(obj)}\n\n".encode()

        base = {"model": body["model"]}
        await asyncio.sleep(0.02)
        yield b": warming up\n\n"  # a comment line, as OpenRouter sends
        if msg.get("tool_calls"):
            call = msg["tool_calls"][0]
            args = call["function"]["arguments"]
            head = {"index": 0, "id": call["id"], "type": "function"}
            yield ev(
                {
                    **base,
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {**head, "function": {"name": call["function"]["name"]}}
                                ]
                            }
                        }
                    ],
                }
            )
            await asyncio.sleep(DELAY)
            for part in (args[: len(args) // 2], args[len(args) // 2 :]):
                yield ev(
                    {
                        **base,
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [{"index": 0, "function": {"arguments": part}}]
                                }
                            }
                        ],
                    }
                )
            finish = "tool_calls"
        else:
            words = msg["content"].split(" ")
            yield ev({**base, "choices": [{"delta": {"role": "assistant", "content": words[0]}}]})
            await asyncio.sleep(DELAY)
            for w in words[1:]:
                yield ev({**base, "choices": [{"delta": {"content": " " + w}}]})
            finish = "stop"
        yield ev({**base, "choices": [{"delta": {}, "finish_reason": finish}]})
        yield ev({**base, "choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 20}})
        self.finished.append(time.perf_counter())
        yield b"data: [DONE]\n\n"


@pytest.fixture(autouse=True)
def seeded(monkeypatch):
    """A new office's first chat or task seeds its starter skills (embeddings and the vault's
    commits, once per office, ~10 s here): not what is measured."""
    from agentic.skills import store

    async def nothing(*_a, **_k):
        return None

    monkeypatch.setattr(store, "ensure_builtin", nothing)


@pytest.fixture
def model():
    m = SlowModel()
    engine_client.use_transport(httpx.MockTransport(m))
    yield m
    engine_client.use_transport(None)


async def _chat(c: httpx.AsyncClient, agent_id: str, text: str) -> tuple[dict, float]:
    t0 = time.perf_counter()
    r = await c.post(f"/api/agents/{agent_id}/chat", json={"message": text}, headers=csrf(c))
    assert r.status_code == 200, r.text
    return r.json(), t0


def _last_chat_trace() -> timing.Trace:
    tr = next(t for t in reversed(timing.recent) if t.kind == "chat")
    assert "provider_call" in tr.marks, tr.summary()
    return tr


# ---------------------------------------------------------------- the budget


async def test_pre_call_overhead_is_small(client, model, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Hello.").say("Three invoices are overdue.").say("The oldest is from August.")
    # The office's first chat also sets up its groups and starter skills (once per office).
    await _chat(client, agent["id"], "Hello there, please get ready for some questions")
    body, t0 = await _chat(client, agent["id"], "Which invoices are overdue this month?")
    first = model.arrived[1] - t0
    assert body["reply"] == "Three invoices are overdue."
    body, t0 = await _chat(client, agent["id"], "Which one of those invoices is the oldest?")
    second = model.arrived[2] - t0
    tr = _last_chat_trace()
    print("p148c chat trace:", json.dumps(tr.summary()))
    print(f"p148c pre-call: {first * 1000:.0f} ms, then {second * 1000:.0f} ms")
    assert first < PRE_CALL_BUDGET, first
    assert second < PRE_CALL_BUDGET, (second, tr.summary())
    assert tr.marks["provider_call"] < PRE_CALL_BUDGET * 1000
    # The model's own time is the model's: the answer came right after it.
    assert body["reply"] == "The oldest is from August."


async def test_slow_preparations_run_side_by_side(client, model, temporal, monkeypatch):
    """The work-scope check (a model call of its own) and memory recall (embeddings, vector
    search) each take 0.3 s here: together they cost 0.3 s, not 0.6 s."""
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Done.").say("Done again.").say("Done once more.")
    await _chat(client, agent["id"], "Warm up the conversation for this agent please")
    _, t0 = await _chat(client, agent["id"], "Which suppliers did we pay last week, please?")
    base = model.arrived[1] - t0  # this machine's own overhead right now

    async def slow_scope(*_a, **_k):
        await asyncio.sleep(0.3)
        return scope_guard.Verdict(True)

    real_recall = runtime.recall_block

    async def slow_recall(*a, **k):
        await asyncio.sleep(0.3)
        return await real_recall(*a, **k)

    monkeypatch.setattr(scope_guard, "check", slow_scope)
    monkeypatch.setattr(runtime, "recall_block", slow_recall)
    _, t0 = await _chat(client, agent["id"], "Which customers have not paid their invoices yet?")
    pre = model.arrived[2] - t0
    tr = _last_chat_trace()
    print("p148c side-by-side trace:", json.dumps(tr.summary()))
    scope, recall = tr.span("scope_check"), tr.span("recall.memory")
    assert scope and recall, tr.summary()
    assert scope[0] < recall[1] and recall[0] < scope[1], (scope, recall)  # they overlapped
    # Not one after the other (that would add 0.6 s to this machine's own overhead).
    assert pre - base < 0.3 + 0.2, (pre, base)
    assert pre >= 0.3  # and the answer still waited for the scope check


async def test_memory_may_not_hold_the_answer_back(client, model, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Done.")

    async def stuck_recall(*_a, **_k):
        await asyncio.sleep(3)
        return "", 0, 0

    monkeypatch.setattr(runtime, "recall_block", stuck_recall)
    monkeypatch.setattr(runtime, "RECALL_BUDGET", 0.2)
    body, t0 = await _chat(client, agent["id"], "What did we agree with Kedai Ali last month?")
    assert body["reply"] == "Done."
    assert model.arrived[0] - t0 < 0.2 + PRE_CALL_BUDGET
    tr = _last_chat_trace()
    # It waited out what was left of the 0.2 s (counted from the start of the turn), no more.
    assert 0 < tr.took("wait.recall") <= 300, tr.summary()
    assert tr.marks["provider_call"] < 200 + PRE_CALL_BUDGET * 1000, tr.summary()
    # The late lookup still finishes on its own (its bookkeeping lands), after the answer.
    assert runtime._LATE
    await asyncio.gather(*runtime._LATE)


async def test_a_greeting_skips_memory(client, model, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Hello!")
    asked: list[str] = []

    async def spy(db, agent, query, *a, **k):
        asked.append(query)
        return "", 0, 0

    monkeypatch.setattr(runtime, "recall_block", spy)
    await _chat(client, agent["id"], "Thank you!")
    assert asked == []
    assert runtime.trivial("good morning") and not runtime.trivial("ok send it to Ali")


async def test_tool_definitions_are_built_once(client, model, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    runtime._OFFERED.clear()
    before = dict(runtime.offered_stats)
    model.say("One.").say("Two.")
    await _chat(client, agent["id"], "First question about the overdue invoices")
    await _chat(client, agent["id"], "Second question about the overdue invoices")
    assert runtime.offered_stats["misses"] - before["misses"] == 1
    assert runtime.offered_stats["hits"] - before["hits"] >= 1
    # The same list the model was sent both times.
    assert model.bodies[0]["tools"] == model.bodies[1]["tools"]
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        listed = runtime.offered_tools(a)
        listed.append({"type": "function", "function": {"name": "x"}})  # a copy: safe to change
        assert runtime.offered_tools(a) != listed
        # A changed mode is a new list.
        a.tools = {**(a.tools or {}), "web_fetch": "deny"}
        names = {t["function"]["name"] for t in runtime.offered_tools(a)}
        assert "web_fetch" not in names


# ---------------------------------------------------------------- streaming


async def _turn_streamed(agent_id: str, text: str) -> tuple[list[tuple[float, dict]], object]:
    """chat_turn with a sink, reading the events as they come (as the endpoint does)."""
    sink = stream.Sink()
    got: list[tuple[float, dict]] = []

    async def run():
        async with SessionLocal() as db:
            a = await db.get(Agent, agent_id)
            who = await db.scalar(select(User.id).limit(1))
            s = ChatSession(workspace_id=a.workspace_id, agent_id=a.id, user_id=who, title="t")
            db.add(s)
            await db.commit()
            with stream.attach(sink):
                return await runtime.chat_turn(db, a, s, text)

    job = asyncio.create_task(run())
    job.add_done_callback(lambda _: sink.close())
    while True:
        ev = await sink.queue.get()
        if ev["t"] == "_end":
            break
        got.append((time.perf_counter(), ev))
    return got, await job


async def test_the_first_words_arrive_before_the_model_finishes(client, model, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Three invoices are overdue this month.")
    events, reply = await _turn_streamed(agent["id"], "Which invoices are overdue this month?")
    deltas = [(t, e) for t, e in events if e["t"] == "delta"]
    assert deltas, events
    first_at = deltas[0][0]
    assert first_at < model.finished[0] - DELAY / 2  # long before the model was done
    assert "".join(e["text"] for _, e in deltas) == "Three invoices are overdue this month."
    assert reply.content == "Three invoices are overdue this month."
    assert model.bodies[0]["stream"] is True
    tr = next(t for t in reversed(timing.recent) if t.kind == "chat")
    assert tr.marks["first_token"] < tr.marks["provider_call"] + DELAY * 1000 / 2, tr.summary()
    print("p148c streamed trace:", json.dumps(tr.summary()))


async def test_streamed_tool_calls_are_put_back_together(client, model, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.call("calc", expression="8 * 12").say("It is 96.")
    events, reply = await _turn_streamed(agent["id"], "What is 8 x 12?")
    assert reply.content == "It is 96." and reply.tools_used == ["calc"]
    kinds = [e["t"] for _, e in events]
    assert "tool" in kinds and kinds.index("tool") < kinds.index("delta")
    async with SessionLocal() as db:
        rows = (await db.scalars(select(AgentMessage).where(AgentMessage.role == "tool"))).all()
        assert [m.content for m in rows] == ["96"]


async def test_the_stream_endpoint_sends_lines_then_the_saved_answer(client, model, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    model.say("Kedai Ali owes the most.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat/stream",
        json={"message": "Who owes us the most money right now?"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.headers["x-accel-buffering"] == "no"
    assert r.headers["content-type"].startswith("application/x-ndjson")
    lines = [json.loads(x) for x in r.text.splitlines() if x.strip()]
    assert lines[0]["t"] == "start" and lines[0]["session_id"]
    assert "".join(x["text"] for x in lines if x["t"] == "delta") == "Kedai Ali owes the most."
    done = lines[-1]
    assert done["t"] == "done" and done["reply"] == "Kedai Ali owes the most."
    assert done["session_id"] == lines[0]["session_id"] and done["message_id"]
    msgs = (await client.get(f"/api/chat/sessions/{done['session_id']}/messages")).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]


async def test_a_provider_that_will_not_stream_is_asked_plainly(monkeypatch):
    bodies: list[dict] = []

    async def refuse(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if body.get("stream"):
            return httpx.Response(400, json={"error": {"message": "stream is not supported"}})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "plain"}, "finish_reason": "stop"}]},
        )

    engine_client.use_transport(httpx.MockTransport(refuse))
    try:
        seen: list[str] = []
        r = await engine_client.chat(
            "https://good.fake/v1",
            "k",
            "m",
            [{"role": "user", "content": "hi"}],
            on_delta=seen.append,
        )
    finally:
        engine_client.use_transport(None)
    assert r.content == "plain" and "no_stream" in r.quirks
    assert "stream" not in bodies[-1]


# ---------------------------------------------------------------- connections and tasks


async def test_provider_calls_reuse_one_pooled_client(model):
    model.say("a").say("b")
    for _ in range(2):
        await engine_client.chat(
            "https://good.fake/v1", "k", "m", [{"role": "user", "content": "x"}]
        )
    pooled = [k for k in engine_client._pool if k[1] == "good.fake"]
    assert len(pooled) == 1
    t = engine_client.request_timeout(120)
    assert t.connect is not None and t.connect <= engine_client.CONNECT_TIMEOUT


async def test_a_task_step_is_timed_with_its_dispatch(client, model, temporal):
    from agentic.agents import dispatch

    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "List the overdue invoices")
    await dispatch._note_dispatch(task["id"])
    model.say("Done: three invoices.")
    await runtime.start_run(task["id"])
    res = await runtime.run_task_step(task["id"])
    assert res.state == "done", res
    tr = next(t for t in reversed(timing.recent) if t.kind == "task")
    print("p148c task trace:", json.dumps(tr.summary()))
    assert tr.info.get("dispatch_ms") is not None
    assert tr.marks["provider_call"] < PRE_CALL_BUDGET * 1000 + 400, tr.summary()
    assert tr.took("tools.flags") > 0 and tr.took("model") >= DELAY * 1000


async def test_a_stream_without_token_counts_is_still_counted():
    async def quiet(request: httpx.Request) -> httpx.Response:
        async def sse():
            for piece in ("Hello", " there."):
                chunk = {"choices": [{"delta": {"content": piece}}]}
                yield f"data: {json.dumps(chunk)}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse())

    engine_client.use_transport(httpx.MockTransport(quiet))
    try:
        seen: list[str] = []
        r = await engine_client.chat(
            "https://good.fake/v1",
            "k",
            "m",
            [{"role": "user", "content": "x" * 400}],
            on_delta=seen.append,
        )
    finally:
        engine_client.use_transport(None)
    assert r.content == "Hello there." and "".join(seen) == "Hello there."
    assert r.usage.prompt >= 100 and r.usage.completion > 0


async def test_a_model_that_does_not_start_is_left_for_the_next(client, monkeypatch):
    """Streaming: a model that has not written a word within settings.ai_answer_timeout is
    left for the next one (P105), and nothing it said reaches the person."""
    from agentic.core.config import settings
    from agentic.engine import gateway

    from .conftest import setup_owner
    from .test_ai_engine import add_provider

    async def two(request: httpx.Request) -> httpx.Response:
        host = request.url.host

        async def sse():
            if host == "good.fake":
                await asyncio.sleep(3)  # never starts in time
            chunk = {"model": "m", "choices": [{"delta": {"content": f"from {host}"}}]}
            yield f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n".encode()

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse())

    monkeypatch.setattr(settings, "ai_answer_timeout", 0.3)
    engine_client.use_transport(httpx.MockTransport(two))
    try:
        await setup_owner(client)
        p = [await add_provider(client, n, h) for n, h in (("A", "good.fake"), ("B", "flaky.fake"))]
        r = await client.put(
            "/api/ai/groups/smart",
            json={"members": [{"provider_id": x["id"], "model_id": "m"} for x in p]},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        sink = stream.Sink()
        async with SessionLocal() as db:
            ws = await db.scalar(select(Workspace.id))
            t0 = time.perf_counter()
            with stream.attach(sink):
                reply = await gateway.chat(
                    db, ws, "smart", [{"role": "user", "content": "hi"}], task="agent.chat"
                )
            took = time.perf_counter() - t0
    finally:
        engine_client.use_transport(None)
    assert reply.content == "from flaky.fake" and reply.attempts[0]["error_class"] == "slow"
    assert took < 2
    words = []
    while not sink.queue.empty():
        e = sink.queue.get_nowait()
        if e["t"] == "delta":
            words.append(e["text"])
    assert words == ["from flaky.fake"]
