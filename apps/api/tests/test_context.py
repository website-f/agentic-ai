"""P12 context window: old tool results become stubs, long runs get a checkpoint, cut points
move in jumps (so the prompt cache keeps hitting), and tool calls stay with their results."""

import json
from dataclasses import dataclass, field
from typing import Any

import pytest

from agentic.agents import context, runtime

from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401


@dataclass
class M:
    id: int
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Owner:
    id: str = "tk_test"
    ctx_summary: str | None = None
    ctx_summary_upto: int | None = None
    ctx_cut: int | None = None


class FakeDB:
    async def commit(self):
        pass


def run(n_steps: int, size: int = 3000, same: bool = False) -> list[M]:
    """A brief, then n tool rounds: assistant call + a big tool result each."""
    out = [M(1, "user", "Task: compare suppliers")]
    i = 2
    for k in range(n_steps):
        call = {
            "id": f"c{k}",
            "type": "function",
            "function": {
                "name": "web_fetch",
                "arguments": json.dumps({"url": f"https://x.example/{k}"}),
            },
        }
        out.append(M(i, "assistant", None, [call]))
        body = ("same page " if same else f"page {k} QT-2026-{k:04d} ") * (size // 12)
        out.append(M(i + 1, "tool", body, tool_call_id=f"c{k}", name="web_fetch"))
        i += 2
    return out


def openai(m: M) -> dict[str, Any]:
    return runtime.to_openai(m)  # type: ignore[arg-type]


def valid(msgs: list[dict[str, Any]]) -> bool:
    """Every tool message answers a call made by an assistant before it."""
    open_calls: set[str] = set()
    for d in msgs:
        if d["role"] == "assistant":
            open_calls |= {c["id"] for c in d.get("tool_calls") or []}
        if d["role"] == "tool" and d["tool_call_id"] not in open_calls:
            return False
    return True


async def test_short_runs_are_sent_untouched():
    h, o = run(3), Owner()
    w = await context.plan(FakeDB(), o, h, workspace_id="ws", group="smart", pinned_first=True)
    assert (w.cut, w.summary) == (0, None)
    assert context.render(h, w, openai, pinned_first=True) == [openai(m) for m in h]


async def test_old_results_become_stubs_and_the_cut_moves_in_jumps():
    o = Owner()
    h = run(12)
    w = await context.plan(FakeDB(), o, h, workspace_id="ws", group="smart", pinned_first=True)
    assert w.cut > 0
    sent = context.render(h, w, openai, pinned_first=True)
    assert valid(sent) and sent[0]["content"] == "Task: compare suppliers"
    old = [
        d
        for d in sent
        if d["role"] == "tool" and d["content"].startswith("[web_fetch result from earlier")
    ]
    # P21: a stub points at the stored original instead of asking for the tool to run again.
    assert old and "expand_result(message_id=" in old[0]["content"]
    assert "call the tool again" not in old[0]["content"]
    assert sent[-1]["content"] == h[-1].content  # the newest result is in full
    before = sum(context.tokens(json.dumps(openai(m))) for m in h)
    after = sum(context.tokens(json.dumps(d)) for d in sent)
    assert after < before * 0.6

    # One more small step: the cut stays, so everything already sent is byte-identical.
    cut = o.ctx_cut
    h2 = h + run(13)[-2:]
    h2[-2].id, h2[-1].id = h[-1].id + 1, h[-1].id + 2
    w2 = await context.plan(FakeDB(), o, h2, workspace_id="ws", group="smart", pinned_first=True)
    assert w2.cut == cut
    sent2 = context.render(h2, w2, openai, pinned_first=True)
    assert sent2[: len(sent)] == sent


async def test_identical_results_point_to_the_newest_copy():
    h = run(3, size=600, same=True)
    w = context.Window(None, 0, 0)
    sent = context.render(h, w, openai, pinned_first=True)
    tools = [d["content"] for d in sent if d["role"] == "tool"]
    assert tools[0].startswith("[Same web_fetch output") and tools[1].startswith("[Same")
    assert tools[2] == h[-1].content


async def test_long_runs_are_compacted_keeping_exact_references(monkeypatch):
    calls: list[tuple[str | None, int]] = []

    async def fake(db, ws, group, previous, turns, **ids):
        calls.append((previous, len(turns)))
        return "## Goal\nCompare suppliers.\n## Done so far\n1. Fetched pages — prices found."

    monkeypatch.setattr(context, "_summarise", fake)
    o = Owner()
    h = run(40)
    w = await context.plan(FakeDB(), o, h, workspace_id="ws", group="smart", pinned_first=True)
    assert len(calls) == 1 and w.summary and w.summary_upto > 0
    assert "Exact references:" in w.summary and "QT-2026-0000" in w.summary  # a regex anchor
    sent = context.render(h, w, openai, pinned_first=True)
    assert valid(sent)
    assert "[CONTEXT CHECKPOINT" in sent[0]["content"] and sent[0]["content"].startswith("Task:")
    assert sum(context.tokens(json.dumps(d)) for d in sent) < context.COMPACT_AT

    # Later growth updates the same checkpoint (the previous one is passed in).
    h3 = h + [
        M(m.id + 1000, m.role, m.content, m.tool_calls, m.tool_call_id, m.name) for m in run(40)[1:]
    ]
    await context.plan(FakeDB(), o, h3, workspace_id="ws", group="smart", pinned_first=True)
    assert len(calls) == 2 and calls[1][0] and calls[1][0].startswith("## Goal")


async def test_chat_checkpoint_rides_on_a_user_turn_and_extra_text_is_added(monkeypatch):
    async def fake(db, ws, group, previous, turns, **ids):
        return "## Goal\nHelp with invoices." + "." * 100

    monkeypatch.setattr(context, "_summarise", fake)
    h: list[M] = []
    i = 1
    for k in range(60):
        h.append(M(i, "user", f"question {k} " * 200))
        h.append(M(i + 1, "assistant", f"answer {k} " * 200))
        i += 2
    o = Owner()
    w = await context.plan(FakeDB(), o, h, workspace_id="ws", group="smart", pinned_first=False)
    sent = context.render(h, w, openai, pinned_first=False, extra={h[-2].id: "RECALLED"})
    assert sent[0]["role"] == "user" and sent[0]["content"].startswith("[CONTEXT CHECKPOINT")
    assert "question" in sent[0]["content"]  # merged into the first kept user turn
    assert sent[-2]["content"].endswith("RECALLED")


@pytest.mark.parametrize("budget", [100, 5000])
async def test_the_tail_never_starts_on_a_tool_result(budget):
    h = run(6)
    start = context.tail_start(h[1:], budget)
    assert h[1:][start].role != "tool"


async def test_a_real_task_sends_less_once_it_grows(client, llm, temporal, monkeypatch):
    from agentic.agents import tools as tools_mod

    org = await office(client)
    agent = await new_agent(client, org, "Aina")
    task = await new_task(client, agent, "Read many pages", "Read and compare.")
    big = "Supplier price list RM 1,200.00 " * 400

    async def fetch(ctx, args):
        return big + str(args.get("url"))

    real = tools_mod.TOOLS["web_fetch"]
    monkeypatch.setitem(
        tools_mod.TOOLS,
        "web_fetch",
        tools_mod.Tool(
            real.name, real.label, real.description, real.parameters, "low", "allow", fetch
        ),
    )
    for k in range(5):
        llm.call("web_fetch", url=f"https://good.fake/{k}")
    llm.say("Compared.")
    for _ in range(3):
        if (await runtime.run_task_step(task["id"])).state == "done":
            break
    sizes = [len(json.dumps(req["messages"])) for req in llm.requests]
    # Without pruning each request grows by a whole page (~13k chars); with it, growth flattens.
    assert sizes[-1] < sizes[0] + 5 * len(big)
    assert any("result from earlier" in json.dumps(req["messages"]) for req in llm.requests)
    assert (await messages(task["id"]))[-1].content == "Compared."
