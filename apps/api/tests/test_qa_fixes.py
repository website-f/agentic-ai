"""Fixes from the live QA: true totals in the assistant's slipping report, bulk retry of
failed work, chat sessions that move up when continued, a light and paged task list, a light
skill-proposal queue, deleting tasks / conversations / workflows, and an honest done count."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select

from agentic.api.scope import member_scope
from agentic.assistants import insights
from agentic.core.db import SessionLocal
from agentic.models import (
    Agent,
    AgentMessage,
    ChatSession,
    SkillProposal,
    Task,
    TaskEvent,
    User,
    Workflow,
    WorkflowRun,
)

from .conftest import csrf as _csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role


def csrf(c: httpx.AsyncClient) -> dict[str, str]:
    """CSRF plus the JSON content type every state-changing call (DELETE too) must carry."""
    return {"content-type": "application/json", **_csrf(c)}


async def _seed(
    agent: dict,
    branch_id: str,
    n: int,
    status: str,
    hours_ago: float,
    prefix: str,
    error: str | None = None,
) -> list[str]:
    """Tasks written straight to the database, `hours_ago` old."""
    now = datetime.now(UTC)
    ids = []
    async with SessionLocal() as db:
        ws = (await db.get(Agent, agent["id"])).workspace_id  # type: ignore[union-attr]
        owner = await db.scalar(select(User))
        assert owner is not None
        for i in range(n):
            t = Task(
                workspace_id=ws,
                branch_id=branch_id,
                title=f"{prefix} {i}",
                brief="",
                assignee_agent_id=agent["id"],
                created_by=f"user:{owner.id}",
                status=status,
                error=error,
                position=float(i),
            )
            db.add(t)
            await db.flush()
            t.created_at = t.updated_at = now - timedelta(hours=hours_ago)
            if status in ("done", "failed", "review", "cancelled"):
                t.finished_at = now - timedelta(hours=hours_ago)
            ids.append(t.id)
        await db.commit()
    return ids


# ---------------------------------------------------------------- 1. insight totals


async def test_slacking_report_states_true_totals(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    bid = o["branch"]["id"]
    await _seed(faiz, bid, 12, "failed", 5, "Broken", error="Portal timed out")
    await _seed(faiz, bid, 3, "failed", 24 * 20, "Ancient", error="old")  # outside the window
    await _seed(faiz, bid, 11, "ready", 30, "Waiting")
    async with SessionLocal() as db:
        ws = (await db.get(Agent, faiz["id"])).workspace_id  # type: ignore[union-attr]
        now = datetime.now(UTC)
        for i, age in enumerate((2, 50)):
            db.add(
                SkillProposal(
                    workspace_id=ws,
                    kind="new",
                    name=f"skill-{i}",
                    description="A skill waiting for review.",
                    body="## When to use\nx",
                    proposed_by=f"agent:{faiz['id']}",
                    agent_id=faiz["id"],
                    created_at=now - timedelta(hours=age),
                )
            )
        await db.commit()
        owner = await db.scalar(select(User))
        assert owner is not None
        sc = await member_scope(db, ws, owner.id)
        assert sc is not None
        slack = await insights.slacking_report(db, ws, sc, 7)
        pulse = await insights.company_pulse(db, ws, sc, 7)
    assert "## Failed and not retried: 12 total (showing 10)" in slack
    assert "3 more failed earlier and were never retried" in slack
    assert "## Not started after a day: 11 total (showing 10)" in slack
    assert "## Skill proposals waiting for review: 2, oldest waiting since 2 days ago" in slack
    assert "skill-1 (new), proposed by Faiz" in slack
    assert sum(1 for line in slack.splitlines() if line.startswith("- Broken")) == 10
    assert "## Recent failures: 12 total (showing 5)" in pulse
    assert "Skill proposals waiting for review: 2" in pulse


# ---------------------------------------------------------------- 2. bulk retry


async def test_retry_failed_relaunches_what_the_person_can_see(
    client: httpx.AsyncClient, llm, temporal
):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    bid = o["branch"]["id"]
    recent = await _seed(faiz, bid, 3, "failed", 5, "Recent", error="boom")
    old = await _seed(faiz, bid, 1, "failed", 24 * 10, "Old", error="boom")
    done = await _seed(faiz, bid, 1, "done", 5, "Fine")

    r = await client.post("/api/tasks/retry-failed", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["retried"] == 3 and r.json()["skipped"] == []
    assert sorted(tid for tid, _ in temporal["start"]) == sorted(recent)
    async with SessionLocal() as db:
        rows = {t.id: t for t in (await db.scalars(select(Task))).all()}
    assert all(rows[i].status == "ready" and rows[i].error is None for i in recent)
    assert rows[old[0]].status == "failed"  # older than since_hours (72)

    # Named tasks ignore the time window; anything not failed comes back as skipped.
    r = await client.post(
        "/api/tasks/retry-failed",
        json={"task_ids": [old[0], done[0], "tk_nope"]},
        headers=csrf(client),
    )
    out = r.json()
    assert out["retried"] == 1 and out["retried_ids"] == old
    assert {s["id"] for s in out["skipped"]} == {done[0], "tk_nope"}

    # At most 50 per call.
    await _seed(faiz, bid, 52, "failed", 1, "Many", error="boom")
    out = (await client.post("/api/tasks/retry-failed", json={}, headers=csrf(client))).json()
    assert out["retried"] == 50 and len(out["skipped"]) == 2
    assert "Over 50" in out["skipped"][0]["reason"]

    # A staff member with no agents of their own sees none of this work.
    staff = await as_role(client, "siti@example.com", "staff", branch_id=bid)
    try:
        r = await staff.post("/api/tasks/retry-failed", json={}, headers=csrf(staff))
        assert r.status_code in (200, 403)
        if r.status_code == 200:
            assert r.json()["retried"] == 0
    finally:
        await staff.aclose()


# ---------------------------------------------------------------- 3 + 6. chat sessions


async def test_chat_session_moves_up_and_can_be_deleted(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.say("First.").say("Second.").say("Again.")
    a = (
        await client.post(
            f"/api/agents/{agent['id']}/chat", json={"message": "Hello A"}, headers=csrf(client)
        )
    ).json()["session_id"]
    b = (
        await client.post(
            f"/api/agents/{agent['id']}/chat", json={"message": "Hello B"}, headers=csrf(client)
        )
    ).json()["session_id"]
    sessions = (await client.get(f"/api/agents/{agent['id']}/sessions")).json()
    assert [s["id"] for s in sessions] == [b, a]
    async with SessionLocal() as db:
        before = (await db.get(ChatSession, a)).updated_at  # type: ignore[union-attr]
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Back to A", "session_id": a},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        after = (await db.get(ChatSession, a)).updated_at  # type: ignore[union-attr]
    assert after > before
    sessions = (await client.get(f"/api/agents/{agent['id']}/sessions")).json()
    assert [s["id"] for s in sessions] == [a, b]  # the continued conversation comes first

    # Only its own person may delete a conversation; its messages go with it.
    staff = await as_role(client, "siti@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        r = await staff.delete(f"/api/chat/sessions/{a}", headers=csrf(staff))
        assert r.status_code == 404
    finally:
        await staff.aclose()
    r = await client.delete(f"/api/chat/sessions/{a}", headers=csrf(client))
    assert r.status_code == 204
    async with SessionLocal() as db:
        assert await db.get(ChatSession, a) is None
        left = await db.scalar(
            select(func.count()).select_from(AgentMessage).where(AgentMessage.session_id == a)
        )
    assert left == 0
    sessions = (await client.get(f"/api/agents/{agent['id']}/sessions")).json()
    assert [s["id"] for s in sessions] == [b]
    assert (await client.delete(f"/api/chat/sessions/{a}", headers=csrf(client))).status_code == 404


# ---------------------------------------------------------------- 4. task list


async def test_task_list_pages_and_trims(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    long = "word " * 300  # 1500 characters
    made = [(await new_task(client, faiz, f"Job {i}", brief=long))["id"] for i in range(5)]

    r = await client.get("/api/tasks?limit=2")
    assert r.status_code == 200
    page1 = r.json()
    assert len(page1) == 2 and r.headers["x-next-before"] == page1[-1]["id"]
    assert all(t["truncated"] and len(t["brief"]) <= 401 for t in page1)
    seen = [t["id"] for t in page1]
    cursor = r.headers["x-next-before"]
    while cursor:
        r = await client.get(f"/api/tasks?limit=2&before={cursor}")
        seen += [t["id"] for t in r.json()]
        cursor = r.headers.get("x-next-before")
    assert sorted(seen) == sorted(made) and len(seen) == 5  # every task once, none twice
    assert [t["id"] for t in (await client.get("/api/tasks")).json()] == seen  # same order

    detail = (await client.get(f"/api/tasks/{made[0]}")).json()["task"]
    assert detail["brief"] == long.strip() or detail["brief"] == long
    assert detail["truncated"] is False
    full = (await client.get("/api/tasks?full=true")).json()
    assert all(not t["truncated"] and len(t["brief"]) >= 1400 for t in full)
    assert (await client.get("/api/tasks?limit=501")).status_code == 422
    assert (await client.get("/api/tasks?before=tk_missing")).status_code == 400


# ---------------------------------------------------------------- 5. proposal queue


async def test_proposal_list_is_light_and_detail_is_full(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    body = "## When to use\n" + "Check every line carefully. " * 200
    async with SessionLocal() as db:
        ws = (await db.get(Agent, faiz["id"])).workspace_id  # type: ignore[union-attr]
        sp = SkillProposal(
            workspace_id=ws,
            kind="new",
            name="careful-check",
            description="Check every line of a statement.",
            body=body,
            proposed_by=f"agent:{faiz['id']}",
            agent_id=faiz["id"],
            eval_cases=[{"title": "one", "input": "x" * 3000}],
            eval={
                "new": {
                    "passed": 1,
                    "total": 1,
                    "tokens": 10,
                    "cases": [{"title": "one", "pass": True, "failures": [], "output": "y" * 5000}],
                }
            },
            created_at=datetime.now(UTC),
        )
        db.add(sp)
        await db.commit()
        sp_id = sp.id
    rows = (await client.get("/api/skill-proposals")).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["body_truncated"] and len(row["body"]) == 1000
    assert row["eval"]["new"] == {"passed": 1, "total": 1, "tokens": 10, "cases": []}
    assert row["eval_case_count"] == 1 and "eval_cases" not in row
    assert row["proposed_by_name"] == "Faiz"
    full = (await client.get(f"/api/skill-proposals/{sp_id}")).json()
    assert full["body"] == body and full["eval"]["new"]["cases"][0]["output"] == "y" * 5000
    assert full["eval_cases"][0]["input"] == "x" * 3000


# ---------------------------------------------------------------- 6. delete tasks


async def test_delete_task_only_when_finished(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    t = await new_task(client, faiz, "Close the month")
    async with SessionLocal() as db:
        row = await db.get(Task, t["id"])
        assert row is not None
        row.status = "running"
        db.add(
            AgentMessage(
                workspace_id=row.workspace_id,
                agent_id=faiz["id"],
                task_id=row.id,
                role="user",
                content="hi",
                created_at=datetime.now(UTC),
            )
        )
        await db.commit()
    r = await client.delete(f"/api/tasks/{t['id']}", headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "not_finished"

    async with SessionLocal() as db:
        row = await db.get(Task, t["id"])
        assert row is not None
        row.status = "done"
        child = Task(
            workspace_id=row.workspace_id,
            title="Sub part",
            created_by="agent:x",
            status="running",
            parent_task_id=row.id,
            depth=1,
        )
        db.add(child)
        await db.commit()
        child_id = child.id
    r = await client.delete(f"/api/tasks/{t['id']}", headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "children_active"

    async with SessionLocal() as db:
        c = await db.get(Task, child_id)
        assert c is not None
        c.status = "cancelled"
        await db.commit()
    # Someone who cannot see the task cannot delete it.
    staff = await as_role(client, "siti@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await staff.delete(f"/api/tasks/{t['id']}", headers=csrf(staff))).status_code in (
            403,
            404,
        )
    finally:
        await staff.aclose()
    r = await client.delete(f"/api/tasks/{t['id']}", headers=csrf(client))
    assert r.status_code == 204, r.text
    async with SessionLocal() as db:
        assert await db.get(Task, t["id"]) is None and await db.get(Task, child_id) is None
        for model, col in ((AgentMessage, AgentMessage.task_id), (TaskEvent, TaskEvent.task_id)):
            n = await db.scalar(select(func.count()).select_from(model).where(col == t["id"]))
            assert n == 0
    assert (await client.get(f"/api/tasks/{t['id']}")).status_code == 404


# ---------------------------------------------------------------- 7. delete workflows


async def test_delete_workflow_refuses_live_runs_and_takes_finished_ones(
    client: httpx.AsyncClient, llm, temporal
):
    await office(client)
    wf = (
        await client.post("/api/workflows", json={"name": "Month end"}, headers=csrf(client))
    ).json()
    async with SessionLocal() as db:
        w = await db.get(Workflow, wf["id"])
        assert w is not None
        run = WorkflowRun(
            workspace_id=w.workspace_id,
            workflow_id=w.id,
            name="Month end",
            title="September",
            created_by="user:x",
            status="waiting",
        )
        db.add(run)
        await db.commit()
        run_id = run.id
    r = await client.delete(f"/api/workflows/{wf['id']}", headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "runs_active"
    async with SessionLocal() as db:
        row = await db.get(WorkflowRun, run_id)
        assert row is not None
        row.status = "done"
        await db.commit()
    r = await client.delete(f"/api/workflows/{wf['id']}", headers=csrf(client))
    assert r.status_code == 204
    async with SessionLocal() as db:
        assert await db.get(WorkflowRun, run_id) is None  # no orphaned run left behind


# ---------------------------------------------------------------- 8. overview


async def test_overview_counts_only_accepted_work_as_done(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    faiz = await new_agent(client, o, "Faiz", "Finance")
    bid = o["branch"]["id"]
    await _seed(faiz, bid, 1, "done", 2, "Accepted")
    await _seed(faiz, bid, 2, "review", 2, "Waiting")
    ov = (await client.get("/api/overview?days=7")).json()
    assert ov["totals"]["tasks_done"] == 1 and ov["totals"]["in_review"] == 2
    maju = next(b for b in ov["branches"] if b["id"] == bid)
    assert maju["tasks_done"] == 1 and maju["open"]["review"] == 2
