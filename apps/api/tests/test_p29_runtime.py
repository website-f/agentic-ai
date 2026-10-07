"""P29 runtime fixes: policy gating matches what the agent is offered, approvals that outlive
their run, team tools set to "ask", side effects that must not repeat on a retried step,
cut-off answers, and who an agent may hand work to."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from agentic.agents import decisions, dispatch, policy, runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.engine import gateway
from agentic.engine.client import Usage
from agentic.models import Agent, AgentMessage, Approval, Task, TaskEvent, Workspace
from agentic.teams import colleague, delegation, reconcile

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_skills import tool

# ---------------------------------------------------------------- policy


async def test_hidden_and_denied_tools_never_run_or_ask(client, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz")
    async with SessionLocal() as db:
        agent = await db.get(Agent, faiz["id"])
        assert agent is not None and not agent.private
        # A personal assistant's tool named by a team agent (twins too): denied, not asked.
        d = await policy.evaluate(agent, "email_read", {"id": "m1"})
        assert (d.effect, d.rule) == ("deny", "hidden.email_read")
        agent.tools = {"message_agent": "allow"}  # not even an explicit allow opens it
        assert (await policy.evaluate(agent, "message_agent", {})).effect == "deny"
        # An explicit deny comes before "always ask": no approval card for browser_submit.
        from agentic.core.config import settings

        old = settings.browser_url
        settings.browser_url = "http://browser.test"
        try:
            assert (await policy.evaluate(agent, "browser_submit", {})).effect == "ask"
            agent.tools = {"browser_submit": "deny"}
            d = await policy.evaluate(agent, "browser_submit", {})
            assert (d.effect, d.rule) == ("deny", "agent.browser_submit=deny")
        finally:
            settings.browser_url = old
        # No browser service: the browser tools do not exist for anyone.
        old = settings.browser_url
        settings.browser_url = ""
        try:
            agent.tools = {"browser_open": "allow"}
            d = await policy.evaluate(agent, "browser_open", {"url": "https://good.fake"})
            assert d.effect == "deny"
        finally:
            settings.browser_url = old


async def test_research_seed_urls_need_what_web_fetch_needs(client, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz")
    async with SessionLocal() as db:
        agent = await db.get(Agent, faiz["id"])
        assert agent is not None
        # From the search provider's results: fine (research_gather's own default).
        assert (
            await policy.evaluate(agent, "research_gather", {"question": "q"})
        ).effect == "allow"
        # Pages the model picked: web_fetch asks for this agent, so this asks too.
        args = {"question": "q", "seed_urls": ["https://good.fake/a"]}
        d = await policy.evaluate(agent, "research_gather", args)
        assert d.effect == "ask" and d.rule.startswith("research_gather.seed_urls")
        bad = {"question": "q", "seed_urls": ["http://169.254.169.254/latest"]}
        assert (await policy.evaluate(agent, "research_gather", bad)).effect == "deny"
        agent.tools = {"web_fetch": "allow"}
        assert (await policy.evaluate(agent, "research_gather", args)).effect == "allow"


def test_more_tools_count_as_outside_content():
    assert {"expand_result", "tool_search", "tool_describe", "meeting_minutes"} <= (
        policy.OUTSIDE_CONTENT
    )


# ---------------------------------------------------------------- team tools set to "ask"


async def test_a_team_tool_set_to_ask_waits_for_approval_then_runs(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    await new_agent(client, o, "Rafi", dept="Operations")
    async with SessionLocal() as db:
        a = await db.get(Agent, aina["id"])
        a.tools = {**(a.tools or {}), "ask_colleague": "ask"}
        await db.commit()
    task = await new_task(client, aina, "Check the SST rate")
    llm.call("ask_colleague", agent="Rafi", question="What SST rate applies?", fresh=True)
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    async with SessionLocal() as db:
        ap = await db.get(Approval, r.approval_id)
        assert ap is not None and ap.tool_name == "ask_colleague"
        ap.status, ap.decided_by = "approved", "user:x"
        await db.commit()
    await runtime.apply_approval(r.approval_id)
    async with SessionLocal() as db:  # no tool result yet: the colleague is asked next
        assert not (
            await db.scalars(
                select(AgentMessage).where(
                    AgentMessage.task_id == task["id"], AgentMessage.role == "tool"
                )
            )
        ).all()
    r = await runtime.run_task_step(task["id"])
    assert r.state == "delegate" and len(r.children or []) == 1


# ---------------------------------------------------------------- approvals outliving a run


async def _asks_calc(client, llm) -> tuple[dict, str]:
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        a = await db.get(Agent, aina["id"])
        a.tools = {**(a.tools or {}), "calc": "ask"}
        await db.commit()
    task = await new_task(client, aina, "Add it up")
    llm.call("calc", expression="2 + 3")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval" and r.approval_id
    return task, r.approval_id


async def test_a_decision_for_a_run_that_is_gone_is_kept(client, llm, temporal, monkeypatch):
    from temporalio.service import RPCError, RPCStatusCode

    task, aid = await _asks_calc(client, llm)

    async def gone(_wid, _aid):
        raise RPCError("workflow not found", RPCStatusCode.NOT_FOUND, b"")

    monkeypatch.setattr(dispatch, "signal_decision", gone)
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        t.workflow_id = t.workflow_id or "task-gone-1"
        await db.commit()
        ap = await db.get(Approval, aid)
        await decisions.decide(db, ap, "user:someone", "approve")  # no 503
    async with SessionLocal() as db:
        ap = await db.get(Approval, aid)
        t = await db.get(Task, task["id"])
    assert ap.status == "approved"  # the decision stands
    assert t.status == "blocked" and t.blocked_reason == decisions.GONE_REASON
    from agentic.agents import launch

    assert launch.restartable(t)  # a person can start it again
    # The new run applies the recorded decision instead of asking again.
    llm.say("It is 5.")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    async with SessionLocal() as db:
        result = await db.scalar(
            select(AgentMessage.content).where(
                AgentMessage.task_id == task["id"], AgentMessage.role == "tool"
            )
        )
        asks = (await db.scalars(select(Approval).where(Approval.task_id == task["id"]))).all()
    assert result == "5" and len(asks) == 1


async def test_decide_locks_the_row_and_refuses_a_second_decision(client, llm, temporal):
    _, aid = await _asks_calc(client, llm)
    async with SessionLocal() as db:
        stale = await db.get(Approval, aid)
        async with SessionLocal() as other:  # a Telegram button decides first
            await decisions.decide(other, await other.get(Approval, aid), "user:a", "deny")
        try:
            await decisions.decide(db, stale, "user:b", "approve")
            raise AssertionError("a second decision went through")
        except decisions.DecisionError as e:
            assert e.code == "already_decided"


async def test_reconciler_relaunches_a_run_whose_approval_wait_is_gone(
    client, llm, temporal, monkeypatch
):
    task, aid = await _asks_calc(client, llm)
    then = datetime.now(UTC) - timedelta(minutes=30)
    async with SessionLocal() as db:
        await db.execute(update(Task).where(Task.id == task["id"]).values(updated_at=then))
        await db.commit()

    async def gone(_wid):
        return False

    monkeypatch.setattr(reconcile, "workflow_open", gone)
    starts = len(temporal["start"])
    assert (await reconcile.tick())["relaunched"] == 1
    assert len(temporal["start"]) == starts + 1
    # The new run waits on the same approval (and shows as blocked again).
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval" and r.approval_id == aid
    async with SessionLocal() as db:
        assert (await db.get(Task, task["id"])).status == "blocked"


# ---------------------------------------------------------------- side effects run once


async def test_a_side_effect_tool_runs_once_per_call(client, llm, temporal, monkeypatch):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    task = await new_task(client, aina, "Tell the boss")
    runs: list[dict] = []

    async def notify(ctx, args):
        runs.append(args)
        return "Sent to Owner One via whatsapp."

    monkeypatch.setitem(
        TOOLS,
        "notify_person",
        TOOLS["notify_person"].__class__(**{**TOOLS["notify_person"].__dict__, "handler": notify}),
    )
    async with SessionLocal() as db:
        agent = await db.get(Agent, aina["id"])
        ws = await db.get(Workspace, agent.workspace_id)
        t = await db.get(Task, task["id"])
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=t)
        first = await runtime.run_tool_once(ctx, "notify_person", {"message": "hi"}, "call_7")
        again = await runtime.run_tool_once(ctx, "notify_person", {"message": "hi"}, "call_7")
        assert first == again == "Sent to Owner One via whatsapp." and len(runs) == 1
        # Interrupted mid-run (no recorded result): not repeated blindly.
        await valkey().set(f"toolonce:{t.id}:call_8", runtime._RUNNING)
        out = await runtime.run_tool_once(ctx, "notify_person", {"message": "hi"}, "call_8")
        assert out == runtime.MAYBE_DONE and len(runs) == 1
        # Read-only tools are not tracked.
        assert await runtime.run_tool_once(ctx, "calc", {"expression": "1+1"}, "call_9") == "2"


# ---------------------------------------------------------------- cut-off answers


async def test_a_cut_off_answer_is_asked_for_again_once(client, llm, temporal, monkeypatch):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    task = await new_task(client, aina, "Write the long report")
    replies = [("The report: part one and", True), ("Short complete report.", False)]

    async def chat(db, ws_id, group, messages, **kw):
        text, cut = replies.pop(0)
        return gateway.GatewayReply(
            content=text,
            provider_id="p",
            provider_name="Fake",
            model="m1",
            usage=Usage(prompt=10, completion=10),
            latency_ms=1,
            cost_usd=None,
            truncated=cut,
        )

    monkeypatch.setattr(runtime.gateway, "chat", chat)
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done" and r.message == "Short complete report."
    async with SessionLocal() as db:
        asked = await db.scalar(
            select(AgentMessage.content).where(
                AgentMessage.task_id == task["id"], AgentMessage.content == runtime.CUT_NUDGE
            )
        )
        ev = await db.scalar(
            select(TaskEvent).where(TaskEvent.task_id == task["id"], TaskEvent.kind == "truncated")
        )
    assert asked and ev is not None


# ---------------------------------------------------------------- who an agent can reach


async def test_private_and_walled_off_agents_are_out_of_reach(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    await new_agent(client, o, "Rafi", dept="Operations")
    mine = (
        await client.post(
            "/api/assistants", json={"preset": "chief_of_staff"}, headers=csrf(client)
        )
    ).json()
    walled = (
        await client.post(
            "/api/branches",
            json={"name": "Rahsia Holdings", "isolated": True},
            headers=csrf(client),
        )
    ).json()
    zara = (
        await client.post(
            "/api/agents",
            json={
                "branch_id": walled["id"],
                "department_id": walled["departments"][1]["id"],
                "name": "Zara",
                "role": "Accountant",
            },
            headers=csrf(client),
        )
    ).json()
    listed = await tool(aina["id"], "team_directory")
    assert "Rafi" in listed and mine["name"] not in listed and "Zara" not in listed
    inside = await tool(zara["id"], "team_directory")
    assert "Zara" in inside and "Rafi" not in inside
    async with SessionLocal() as db:
        a = await db.get(Agent, aina["id"])
        ws = a.workspace_id
        assert (await delegation._find_agent(db, ws, "Rafi", caller=a)) is not None
        assert await delegation._find_agent(db, ws, mine["name"], caller=a) is None
        assert await delegation._find_agent(db, ws, "Zara", caller=a) is None
        assert await colleague.find_agent(db, ws, "accountant", caller=a) is None
        z = await db.get(Agent, zara["id"])
        assert await delegation._find_agent(db, ws, "Rafi", caller=z) is None
