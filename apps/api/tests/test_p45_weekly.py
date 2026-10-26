"""P45: what each agent learned in a week (no model), the Monday report and its notice, and
the Learning page's week view for the agents a person may see."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from agentic.brain import weekly
from agentic.channels import deliver
from agentic.core.db import SessionLocal
from agentic.models import (
    BrainFact,
    Report,
    Routine,
    SkillProposal,
    Task,
    TaskEvent,
    Workspace,
)

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role


async def _seed(agent_id: str, ws_id: str, at: datetime) -> None:
    async with SessionLocal() as db:
        db.add_all(
            [
                BrainFact(
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    text="Supplier X delivers on Fridays.",
                    source_kind="task",
                    created_by="agent",
                    valid_from=at,
                    created_at=at,
                ),
                BrainFact(
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    text="Never email customers after 9pm.",
                    source_kind="person",
                    created_by="user:x",
                    valid_from=at,
                    created_at=at,
                ),
                SkillProposal(
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    kind="new",
                    name="quote-check",
                    description="Check a quote",
                    body="...",
                    proposed_by=f"agent:{agent_id}",
                    status="approved",
                    created_at=at,
                ),
                Routine(
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    name="Weekly stock count",
                    description="Count stock from the sheet",
                    status="candidate",
                    baseline_tokens=4200,
                    created_at=at,
                    updated_at=at,
                ),
            ]
        )
        t = Task(
            workspace_id=ws_id,
            title="Count stock",
            brief="",
            status="done",
            assignee_agent_id=agent_id,
            created_by="user:x",
            finished_at=at,
        )
        db.add(t)
        await db.flush()
        db.add(
            TaskEvent(
                task_id=t.id,
                ts=at,
                kind="routine_run",
                actor="system:routines",
                text="done",
                data={"state": "done", "tokens": 300, "saved": 3900},
            )
        )
        await db.commit()


async def test_the_week_per_agent_without_a_model(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Sofia", "Operations")
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        monday = weekly.week_of(date.today())[0]
    at = datetime.combine(monday, datetime.min.time(), UTC) + timedelta(days=1, hours=3)
    await _seed(a["id"], ws.id, at)
    calls = len(llm.requests)
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws.id)
        assert ws is not None
        data = await weekly.gather(db, ws, monday)
    assert len(llm.requests) == calls  # nothing was asked of a model
    row = next(r for r in data["agents"] if r["id"] == a["id"])
    assert (row["done"], row["facts"], row["lessons"]) == (1, 1, 1)
    assert (row["skills_proposed"], row["skills_approved"]) == (1, 1)
    assert (row["routines_learned"], row["routine_runs"], row["tokens_saved"]) == (1, 1, 3900)
    assert row["lesson_examples"] == ["Never email customers after 9pm."]
    assert data["to_trust"][0]["name"] == "Weekly stock count"
    assert data["week"] == weekly.week_label(monday)
    # The week before is empty.
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws.id)
        assert ws is not None
        before = await weekly.gather(db, ws, monday - timedelta(days=7))
    assert before["totals"]["facts"] == 0


async def test_the_monday_report_is_written_once_and_owners_are_told(
    client, llm, temporal, monkeypatch
):
    o = await office(client)
    a = await new_agent(client, o, "Sofia", "Operations")
    told: list[dict] = []

    async def notify_people(db, workspace_id, title, body, url, *, dedupe, perm="approvals.decide"):
        told.append({"url": url, "perm": perm, "dedupe": dedupe})
        return []

    monkeypatch.setattr(deliver, "notify_people", notify_people)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        ws.timezone = "Asia/Kuala_Lumpur"
        await db.commit()
    # Monday 2026-10-26 08:00 in Kuala Lumpur is 00:00 UTC; last week starts 2026-10-19.
    last_monday = date(2026, 10, 19)
    await _seed(a["id"], ws.id, datetime(2026, 10, 21, 3, tzinfo=UTC))
    monday_8am = datetime(2026, 10, 26, 0, 5, tzinfo=UTC)
    async with SessionLocal() as db:
        assert await weekly.tick(db, monday_8am - timedelta(hours=1)) == 0  # 07:05: not yet
        assert await weekly.tick(db, monday_8am) == 1
        assert await weekly.tick(db, monday_8am) == 0  # once a week
        r = await db.scalar(
            select(Report).where(
                Report.call_id == f"learning:week:{weekly.week_label(last_monday)}"
            )
        )
    assert r is not None and r.labels == ["learning", "weekly"]
    assert r.owner_user_id is None and r.branch_id is None  # owners and admins see it
    assert "Sofia" in r.body and r.tables[0]["rows"][0][0] == "Sofia"
    assert told == [
        {
            "url": "/learning?tab=week",
            "perm": "org.manage",
            "dedupe": f"learning-week:{ws.id}:{weekly.week_label(last_monday)}",
        }
    ]


async def test_the_week_page_shows_only_agents_a_person_may_see(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Sofia", "Operations")
    r = await client.get("/api/learning/week")
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(x["id"] == a["id"] for x in body["agents"])
    assert body["week"] == body["this_week"] and body["next"] is None
    past = await client.get("/api/learning/week", params={"week": body["previous"]})
    assert past.json()["next"] == body["this_week"]
    assert (await client.get("/api/learning/week", params={"week": "nope"})).status_code == 422
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await staff.get("/api/learning/week")).status_code == 403
    finally:
        await staff.aclose()
    assert csrf  # imported for parity with the other tests
