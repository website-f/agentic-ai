"""P21 tool-result compression: content-routed compressors keep errors, outliers and matches;
the model gets the short text while transcripts keep the original; expand_result reads the
original back (scoped to the caller's task or chat); MCP results keep their tail; every call
records a prompt-prefix hash and /api/ai/cache-health reports prefix churn."""

import json
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import compress, mcp, runtime
from agentic.agents.compress_tools import COMPRESS_TOOLS
from agentic.agents.tools import TOOLS, Tool, ToolContext
from agentic.core.db import SessionLocal
from agentic.engine import cache_health, gateway
from agentic.engine import client as engine_client
from agentic.models import Agent, AgentMessage, ChatSession, LLMCall, Task, User, Workspace

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401


def invoices(n: int = 312) -> list[dict[str, Any]]:
    rnd = random.Random(7)  # noqa: S311 - test data
    rows = [
        {
            "id": i,
            "customer": f"Customer {i}",
            "amount": round(100 + rnd.random() * 20, 2),
            "status": "paid",
            "note": "monthly service invoice",
        }
        for i in range(n)
    ]
    rows[150]["amount"] = 9999.0  # an outlier
    rows[200]["status"] = "failed"
    rows[200]["error"] = "card declined"  # an error row
    rows[77]["customer"] = "Petronas Dagangan"  # what the job is about
    return rows


# ---------------------------------------------------------------- compressors


def test_json_rows_keep_errors_outliers_matches_and_both_ends():
    text = json.dumps(invoices(), indent=2)
    r = compress.compress(text, tool="tool_call", query="invoices for Petronas", message_id=1234)
    assert r is not None and r.kind == "rows"
    out = r.text
    for row in ("\n0,", "\n1,", "\n311,", "\n310,"):  # first and last rows (# column)
        assert row in out
    assert "card declined" in out  # every error row
    assert "9999.0" in out  # the outlier
    assert "Petronas Dagangan" in out  # the query match
    assert "[312 rows shown as " in out
    assert out.rstrip().endswith("Full result: expand_result(message_id=1234, query=…)]")
    assert len(out) < len(text) / 10
    shown = [ln for ln in out.split("\n")[1:-1] if ln[:1].isdigit()]
    assert 12 <= len(shown) <= 20


def test_status_codes_of_400_and_more_count_as_errors():
    rows = [{"url": f"/p/{i}", "status": 200, "ms": 20 + i % 3} for i in range(80)]
    rows[33]["status"] = 503
    rows[61]["status"] = "404"
    r = compress.compress(json.dumps(rows, indent=1), tool="x", message_id=1)
    assert r is not None
    assert '"/p/33"' in r.text or "/p/33," in r.text
    assert "/p/61" in r.text


def test_lossless_table_when_it_saves_enough():
    rows = [{"sku": f"A-{i}", "qty": i, "price": 2.5 * i, "ok": True} for i in range(60)]
    text = json.dumps(rows, indent=2)
    r = compress.compress(text, tool="x", message_id=9)
    assert r is not None and r.kind == "table"
    assert r.text.startswith("sku,qty,price,ok\nA-0,0,0.0,true")
    assert all(f"A-{i}," in r.text for i in range(60))  # nothing left out
    assert "nothing left out" in r.text and "message_id=9" in r.text


def test_thresholds_and_things_never_compressed():
    small = json.dumps([{"a": i} for i in range(30)])
    assert len(small) < compress.MIN_CHARS and compress.compress(small, message_id=1) is None
    few = json.dumps([{"name": "x" * 600} for _ in range(4)])  # < 5 items: no row choice
    r = compress.compress(few, message_id=1)
    assert r is None or r.kind == "compact"
    code = "\n".join(["def total(rows):", "    return sum(r['amount'] for r in rows)"] * 120)
    assert compress.compress(code, tool="tool_call", message_id=1) is None
    big = json.dumps(invoices(), indent=2)
    assert compress.compress(big, tool="read_file", message_id=1) is None
    assert compress.compress(big, tool="browser_read", message_id=1) is None
    assert compress.prepare(big, tool="expand_result", query="", message_id=1) == {}
    prose = "The supplier confirmed delivery for next Tuesday and asked about payment. " * 60
    assert compress.compress(prose, message_id=1) is None


def test_log_keeps_errors_tracebacks_and_ends_and_collapses_repeats():
    lines = [f"2026-10-05 10:00:{i % 60:02d} INFO worker processed batch {i}" for i in range(400)]
    lines[250] = "2026-10-05 10:04:10 ERROR db connection refused (host=pg)"
    lines[300:300] = [
        "Traceback (most recent call last):",
        '  File "job.py", line 3, in <module>',
        "    main()",
        "ValueError: bad input",
    ]
    lines.append("2026-10-05 10:09:59 INFO done, exit 1")
    r = compress.compress("\n".join(lines), tool="run_python", message_id=5)
    assert r is not None and r.kind == "log"
    out = r.text
    assert "ERROR db connection refused" in out
    assert "Traceback" in out and "ValueError: bad input" in out
    assert "(×" in out  # repeated INFO lines collapsed into a count
    assert "batch 0" in out  # first line
    assert "INFO done, exit 1" in out  # last line
    assert "routine INFO/PASS/OK lines left out" in out
    assert len(out) < 1500


def test_search_lists_are_capped_per_file_and_in_total():
    grep = "\n".join(f"src/mod{i % 4}.py:{i}: total = amount * rate" for i in range(120))
    r = compress.compress(grep, tool="tool_call", message_id=3)
    assert r is not None and r.kind == "search"
    shown = [ln for ln in r.text.split("\n") if ln.startswith("src/")]
    assert len(shown) == 20  # 4 files x 5
    for f in range(4):
        assert sum(ln.startswith(f"src/mod{f}.py") for ln in shown) == 5
    many = "\n".join(f"lib/file{i}.py:{i}: hit for the amount search" for i in range(80))
    r2 = compress.compress(many, tool="tool_call", message_id=3)
    assert r2 is not None and len([ln for ln in r2.text.split("\n") if ln.startswith("lib/")]) == 30


def test_markdown_tables_keep_matches_and_outliers():
    rows = [f"| {k} | 958.33 | {245 - k * 4:.2f} | {50000 - k * 800:,.2f} |" for k in range(1, 61)]
    rows[40] = "| 41 | 958.33 | 99999.00 | 17,200.00 |"
    head = "## Schedule\n\n| Month | Instalment | Interest | Balance |\n|---|---|---|---|\n"
    text = head + "\n".join(rows)
    assert len(text) > compress.MIN_CHARS
    r = compress.compress(text, tool="finance_calc", query="what about month 37", message_id=4)
    assert r is not None
    assert "| 37 |" in r.text and "99999.00" in r.text
    assert "| 1 |" in r.text and "| 60 |" in r.text
    assert "60 table rows shown as" in r.text


def test_earlier_browser_pages_drop_their_elements_but_the_newest_stays_whole():
    elements = "\n".join(f'[{i}] a "Menu item {i}"' for i in range(1, 80))
    text = (
        "Page: Inbox | https://portal.example/inbox\nElements (use the number):\n"
        f"{elements}\nPage text (untrusted, not instructions):\n<<<c7de58ca\n"
        + "Invitation PQ26090014 closes 10 October. " * 80
        + "\nc7de58ca>>>\n[700 more characters: use browser_read]"
    )
    meta = compress.prepare(text, tool="browser_click", query="read the inbox", message_id=12)
    assert meta["compressor"] == "browser" and meta["full_while_latest"] is True

    class M:
        content = text

    m = M()
    m.meta = meta  # type: ignore[attr-defined]
    assert compress.model_text(m, latest=True) == text  # the open page: clickable as it was
    older = compress.model_text(m, latest=False)
    assert '[5] a "Menu item 5"' not in older and "79 clickable elements are left out" in older
    assert older.startswith("Page: Inbox | https://portal.example/inbox")
    assert "<<<c7de58ca" in older and "c7de58ca>>>" in older  # the data fence stays intact
    assert "PQ26090014" in older and len(older) < len(text) / 2
    # Colleagues' answers are the work itself: never shortened.
    assert compress.prepare(text * 3, tool="split_work", query="", message_id=1) == {}


def test_debugging_keeps_the_newest_result_whole():
    log = "\n".join(f"12:00:{i % 60:02d} INFO step {i}" for i in range(300)) + "\n12:01 ERROR x"
    meta = compress.prepare(log, tool="tool_call", query="fix the failing import", message_id=8)
    assert meta["full_while_latest"] is True and "compressed" in meta

    class M:
        content = log

    m = M()
    m.meta = meta  # type: ignore[attr-defined]
    assert compress.model_text(m, latest=True) == log
    assert compress.model_text(m, latest=False) == meta["compressed"]
    calm = compress.prepare(log, tool="tool_call", query="summarise the log", message_id=8)
    assert "full_while_latest" not in calm


def test_cap_keeps_the_tail_and_middle_errors():
    text = "\n".join(f"row {i} fine" for i in range(4000))
    text = text.replace("row 2000 fine", "row 2000 ERROR quota exceeded")
    text += "\nFATAL: disk full at the very end"
    meta = compress.prepare(text, tool="tool_call", query="", message_id=77)
    sent = meta["compressed"]
    assert len(sent) <= compress.MAX_SENT + 2_000
    assert sent.rstrip().endswith("FATAL: disk full at the very end")
    assert "row 2000 ERROR quota exceeded" in sent
    assert "expand_result(message_id=77, offset=" in sent


async def test_mcp_long_result_keeps_its_tail_error():
    body = "\n".join(f"issue {i}: open" for i in range(5000)) + "\nERROR: page 51 failed to load"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": body}]},
            },
        )

    engine_client.use_transport(httpx.MockTransport(handler))
    try:
        out = await mcp.call_tool("https://good.fake/rpc", "", "list_issues", {})
    finally:
        engine_client.use_transport(None)
    assert len(out) > 12_000 and out.endswith("ERROR: page 51 failed to load")  # no hard cut
    sent = compress.prepare(out, tool="tool_call", query="", message_id=5)["compressed"]
    assert "ERROR: page 51 failed to load" in sent and len(sent) < 14_000


def test_bm25_ranks_the_matching_row_first():
    docs = [compress.terms(t) for t in ("apple pie", "banana bread", "cherry apple tart")]
    scores = compress.bm25(docs, compress.terms("banana"))
    assert scores.index(max(scores)) == 1 and scores[0] == 0


# ---------------------------------------------------------------- expand_result


async def _ctx(db, agent_id: str, **kw) -> ToolContext:
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, **kw)


async def test_expand_result_is_scoped_and_pages_and_filters(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    t1 = await new_task(client, agent, "Check invoices")
    t2 = await new_task(client, agent, "Other job")
    original = json.dumps(invoices(), indent=2)
    expand = COMPRESS_TOOLS[0].handler
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        m = AgentMessage(
            workspace_id=a.workspace_id,
            agent_id=a.id,
            task_id=t1["id"],
            role="tool",
            name="tool_call",
            tool_call_id="c1",
            content=original,
            created_at=datetime.now(UTC),
        )
        db.add(m)
        owner = await db.scalar(select(User).limit(1))
        assert owner is not None
        session = ChatSession(workspace_id=a.workspace_id, agent_id=a.id, user_id=owner.id)
        db.add(session)
        await db.commit()
        task1, task2 = await db.get(Task, t1["id"]), await db.get(Task, t2["id"])

        own = await _ctx(db, agent["id"], task=task1)
        page = await expand(own, {"message_id": m.id, "offset": 10, "limit": 5})
        assert "[10] " in page and "[14] " in page and "[15] " not in page
        assert '"id":10,' in page and "next: offset=15" in page
        hit = await expand(own, {"message_id": m.id, "query": "Petronas"})
        assert "Petronas Dagangan" in hit and "[77]" in hit
        err = await expand(own, {"message_id": m.id, "query": "card declined"})
        assert "[200]" in err

        other = await _ctx(db, agent["id"], task=task2)
        assert "no tool result" in await expand(other, {"message_id": m.id})
        chat = await _ctx(db, agent["id"], task=None, session_id=session.id)
        assert "no tool result" in await expand(chat, {"message_id": m.id})
        assert "Error" in await expand(own, {"message_id": "nope"})


# ---------------------------------------------------------------- task and chat paths


def _big_tool(text: str) -> Tool:
    async def handler(ctx, args):
        return text

    return Tool(
        "big_report",
        "Big report",
        "Returns a big JSON report.",
        {"type": "object", "properties": {}},
        "low",
        "allow",
        handler,
    )


async def test_task_sends_compressed_text_and_keeps_the_original(
    client, llm, temporal, monkeypatch
):
    original = json.dumps(invoices(), indent=2)
    monkeypatch.setitem(TOOLS, "big_report", _big_tool(original))
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Find the Petronas invoice", "Look in the report")
    llm.call("big_report").say("Invoice 77 is Petronas.")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    stored = [m for m in await messages(task["id"]) if m.role == "tool"][0]
    assert stored.content == original  # the transcript keeps everything
    assert stored.meta and stored.meta["compressor"] == "rows"
    sent = llm.requests[1]["messages"][-1]
    assert sent["role"] == "tool" and sent["content"] == stored.meta["compressed"]
    assert f"expand_result(message_id={stored.id}" in sent["content"]
    assert "Petronas Dagangan" in sent["content"] and len(sent["content"]) < 3000


async def test_chat_sends_compressed_text_and_keeps_the_original(
    client, llm, temporal, monkeypatch
):
    original = json.dumps(invoices(), indent=2)
    monkeypatch.setitem(TOOLS, "big_report", _big_tool(original))
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.call("big_report").say("One payment failed: invoice 200.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "which invoices failed?"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        stored = await db.scalar(
            select(AgentMessage).where(
                AgentMessage.agent_id == agent["id"], AgentMessage.role == "tool"
            )
        )
    assert stored is not None and stored.session_id and stored.content == original
    sent = llm.requests[1]["messages"][-1]
    assert sent["role"] == "tool" and sent["content"] == stored.meta["compressed"]
    assert "card declined" in sent["content"]


# ---------------------------------------------------------------- prompt cache


async def test_prefix_hash_is_recorded_per_call(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.call("calc", expression="2 + 2").say("It is 4.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat", json={"message": "what is 2+2"}, headers=csrf(client)
    )
    assert r.status_code == 200
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(LLMCall).where(LLMCall.task == "agent.chat").order_by(LLMCall.id)
            )
        ).all()
    assert len(rows) == 2
    assert all(len(x.prefix_hash or "") == 16 for x in rows)
    assert rows[0].prefix_hash == rows[1].prefix_hash  # same agent, same tools: cache-stable
    msgs = llm.requests[0]["messages"]
    assert rows[0].prefix_hash == gateway.prefix_hash(msgs, llm.requests[0]["tools"])
    other = gateway.prefix_hash([{**msgs[0], "content": msgs[0]["content"] + "!"}], None)
    assert other != rows[0].prefix_hash


def _call(ts: int, prefix: str, *, task_id: str | None = "tk1", agent="ag1", cached=0, prompt=100):
    return cache_health.Call(
        ts=datetime(2026, 10, 1, tzinfo=UTC) + timedelta(minutes=ts),
        agent_id=agent,
        task="agent.task",
        task_id=task_id,
        prefix_hash=prefix,
        prompt_tokens=prompt,
        cached_tokens=cached,
    )


def test_cache_health_math():
    stable = [_call(i, "aaaa", cached=80) for i in range(6)]
    churn = [_call(i, f"p{i % 2}", agent="ag2", task_id="tk2") for i in range(10)]
    rows = {r["agent_id"]: r for r in cache_health.report(stable + churn, {"ag2": "Badrul"})}
    assert rows["ag1"]["changes"] == 0 and rows["ag1"]["flags"] == []
    assert rows["ag1"]["cached_share"] == 0.8
    b = rows["ag2"]
    assert b["calls"] == 10 and b["prefixes"] == 2 and b["changes"] == 9
    assert b["change_share"] == 1.0 and "prefix_churn" in b["flags"]
    assert b["note"].startswith("Badrul's instructions change between calls")
    # A new task run starting with a new prefix is not churn: runs are compared separately.
    runs = [_call(i, f"run{i // 5}", task_id=f"tk{i // 5}") for i in range(10)]
    assert cache_health.report(runs, {})[0]["changes"] == 0
    # The cached share fell from 80% to 10%.
    drop = [_call(i, "s", cached=80 if i < 6 else 10) for i in range(12)]
    assert "cache_drop" in cache_health.report(drop, {})[0]["flags"]


async def test_cache_health_endpoint(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        now = datetime.now(UTC)
        for i in range(8):
            db.add(
                LLMCall(
                    workspace_id=a.workspace_id,
                    ts=now - timedelta(minutes=30 - i),
                    task="agent.task",
                    provider_name="Good",
                    model="m1",
                    agent_id=a.id,
                    task_id="tk_x",
                    prompt_tokens=1000,
                    cached_tokens=0 if i % 2 else 500,
                    status="ok",
                    prefix_hash="a" * 16 if i % 2 else "b" * 16,
                )
            )
        await db.commit()
    r = await client.get("/api/ai/cache-health?days=7")
    assert r.status_code == 200, r.text
    body = r.json()
    g = next(x for x in body["groups"] if x["agent_id"] == agent["id"])
    assert g["calls"] == 8 and g["prefixes"] == 2 and g["changes"] == 7
    assert g["flags"] == ["prefix_churn"] and "Aina's instructions change" in g["note"]
    assert g["cached_share"] == 0.25 and body["flagged"] >= 1


@pytest.mark.parametrize(
    ("base", "model", "want"),
    [
        ("https://api.anthropic.com/v1", "claude-haiku-4-5", True),
        ("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.6", True),
        ("https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct:free", False),
        ("https://api.groq.com/openai/v1", "llama-3.3-70b", False),
    ],
)
def test_cache_breakpoints_only_for_anthropic(base, model, want):
    assert engine_client.wants_cache_control(base, model) is want


async def test_anthropic_calls_carry_cache_breakpoints_and_learn_to_drop_them(monkeypatch):
    bodies: list[dict] = []

    async def fake_request(method, url, key, json=None, timeout=30, **kw):
        bodies.append(json)
        return engine_client.CallResult(
            ok=True,
            latency_ms=1,
            status=200,
            data={"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]},
        )

    monkeypatch.setattr(engine_client, "_request", fake_request)
    msgs = [{"role": "system", "content": "rules"}, {"role": "user", "content": "hi"}]
    tools = [
        {"type": "function", "function": {"name": "a", "parameters": {}}},
        {"type": "function", "function": {"name": "b", "parameters": {}}},
    ]
    await engine_client.chat(
        "https://api.anthropic.com/v1", "k", "claude-haiku-4-5", msgs, tools=tools
    )
    sent = bodies[0]
    assert sent["messages"][0]["content"] == [
        {"type": "text", "text": "rules", "cache_control": {"type": "ephemeral"}}
    ]
    assert "cache_control" not in sent["tools"][0]
    assert sent["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    assert msgs[0]["content"] == "rules" and "cache_control" not in tools[-1]  # not mutated

    # A provider that refuses the field: the 400 is learned as a quirk and the call retried.
    bodies.clear()

    async def refusing(method, url, key, json=None, timeout=30, **kw):
        bodies.append(json)
        if len(bodies) == 1:
            return engine_client.CallResult(
                ok=False,
                latency_ms=1,
                status=400,
                data={"error_text": "Extra inputs are not permitted: cache_control"},
            )
        return engine_client.CallResult(
            ok=True,
            latency_ms=1,
            status=200,
            data={"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]},
        )

    monkeypatch.setattr(engine_client, "_request", refusing)
    r = await engine_client.chat(
        "https://api.anthropic.com/v1", "k", "claude-haiku-4-5", msgs, tools=tools
    )
    assert r.call.ok and "no_cache_control" in r.quirks
    assert bodies[1]["messages"][0]["content"] == "rules"
    assert "cache_control" not in bodies[1]["tools"][-1]

    # Other providers are sent the messages untouched.
    bodies.clear()
    monkeypatch.setattr(engine_client, "_request", fake_request)
    await engine_client.chat("https://api.groq.com/openai/v1", "k", "llama", msgs, tools=tools)
    assert bodies[0]["messages"][0]["content"] == "rules" and bodies[0]["tools"] == tools
