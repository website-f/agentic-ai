"""P51 safeguards: a person's own AI keeps their mail and computer for them, work an agent
lines up stays its person's (allowance), the office's own work has a daily pool, failover
goes to cheaper AI first, and a person can end a task even when the worker service is down."""

from datetime import UTC, datetime

from sqlalchemy import select

from agentic.agents import runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.api.routers import task_rescue
from agentic.core.db import SessionLocal
from agentic.models import Agent, LLMCall, Task, Workspace
from agentic.teams import allowance

from .conftest import csrf
from .test_accountable_work import _running, _task
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import member


async def _people(client) -> tuple[str, str]:
    me = (await client.get("/api/auth/me")).json()["user"]["id"]
    other = (await member(client, "manager@example.com", "admin"))["member"]["user_id"]
    return me, other


async def test_their_own_ai_opens_their_mail_and_computer_only_for_them(client, llm, temporal):
    o = await office(client)
    twin = await new_agent(client, o, "Twin")
    me, manager = await _people(client)
    async with SessionLocal() as db:
        a = await db.get(Agent, twin["id"])
        a.owner_user_id, a.is_twin = me, True
        await db.commit()
        ws = await db.get(Workspace, a.workspace_id)
        # In chat: only the owner.
        assert await runtime.owner_asks(db, a, person=me)
        assert not await runtime.owner_asks(db, a, person=manager)
        for tool in ("outlook_search", "pc_find_files"):
            ctx = ToolContext(db=db, agent=a, workspace=ws, task=None, person=manager)
            out = await runtime.run_tool(ctx, tool, {"query": "resignation"})
            assert out.startswith("Error: this is your person's own mail and computer")
        # In a task: only when the owner themselves set it going.
        mine = Task(
            workspace_id=a.workspace_id, title="x", created_by=f"user:{me}", assignee_agent_id=a.id
        )
        theirs = Task(
            workspace_id=a.workspace_id,
            title="y",
            created_by=f"user:{manager}",
            assignee_agent_id=a.id,
        )
        # P51/P52: office or system work (a shared mailbox, an outside sender) is NOT the owner
        # personally asking, so it gets no personal mail/PC/Teams.
        duty = Task(
            workspace_id=a.workspace_id, title="z", created_by="system:mail", assignee_agent_id=a.id
        )
        db.add_all([mine, theirs, duty])
        await db.flush()
        assert await runtime.owner_asks(db, a, mine)
        assert not await runtime.owner_asks(db, a, theirs)
        assert not await runtime.owner_asks(db, a, duty)
        # A company agent (nobody's own) is unaffected.
        plain = await db.get(Agent, (await new_agent(client, o, "Desk"))["id"])
        assert await runtime.owner_asks(db, plain, person=manager)


async def test_work_an_agent_lines_up_stays_its_persons(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    await new_agent(client, o, "Faiz")
    me = (await client.get("/api/auth/me")).json()["user"]["id"]
    t = await _task(client, aina, "Plan the week")
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        a = await db.get(Agent, aina["id"])
        ws = await db.get(Workspace, a.workspace_id)
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=task)
        out = await TOOLS["create_task"].handler(
            ctx, {"title": "Call the supplier", "brief": "Ask about Friday."}
        )
        assert "Error" not in out, out
        made = await db.scalar(select(Task).where(Task.title == "Call the supplier"))
        assert made is not None and made.created_by == f"user:{me}"


async def test_the_offices_own_work_has_a_daily_pool(client, llm, temporal):
    await office(client)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        ws.settings = {**(ws.settings or {}), "ai_allowance": {"office_daily_tokens": 1000}}
        await db.commit()
        assert await allowance.office_check(db, ws) is None
        db.add(
            LLMCall(
                workspace_id=ws.id,
                ts=datetime.now(UTC),
                task="agent.task",
                provider_name="x",
                model="m",
                prompt_tokens=900,
                completion_tokens=200,
                status="ok",
            )
        )
        await db.commit()
        pool = await allowance.office_check(db, ws)
        assert pool is not None and pool.used == 1100 and pool.limit == 1000
        assert "nobody asked for directly" in pool.note()
        assert await allowance.grant_office(db, ws) == 500
        assert await allowance.office_check(db, ws) is None  # 1100 of 1500 now
        # A person's own use never draws on it.
        ws.settings = {**ws.settings, "ai_allowance": {"office_daily_tokens": 0}}
        await db.commit()
        assert allowance.office_limit(ws) is None


def test_failover_tries_cheaper_ai_first_and_dearer_only_with_a_budget():
    free = Agent(budget_daily_tokens=None, budget_monthly_usd=None)
    capped = Agent(budget_daily_tokens=100_000, budget_monthly_usd=None)
    assert runtime.failover_order("smart", free) == ["fast", "bulk"]
    assert runtime.failover_order("fast", free) == ["bulk"]
    assert runtime.failover_order("bulk", free) == []
    assert runtime.failover_order("bulk", capped) == ["fast", "smart"]
    assert runtime.failover_order("fast", capped) == ["bulk", "smart"]


async def test_a_task_can_be_ended_while_the_worker_service_is_down(
    client, llm, temporal, monkeypatch
):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Long job", start=True)
    await _running(t["id"])

    async def down(*_a, **_k):
        raise ConnectionError("temporal is down")

    monkeypatch.setattr(task_rescue.dispatch, "terminate_task", down)
    r = await client.post(f"/api/tasks/{t['id']}/stop", json={}, headers=csrf(client))
    assert r.status_code == 503 and r.json()["code"] == "temporal_unavailable"
    r = await client.post(f"/api/tasks/{t['id']}/stop?force=true", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "failed"
    # A run that wakes up later finds it closed and does nothing more.
    step = await runtime.run_task_step(t["id"])
    assert step.state == "done"
