"""P47: an agent's working day: its hours, breaks and duties on a date, the office view (staff
see their own AI only), and the end-of-day summary (no model, once a day)."""

from datetime import UTC, date, datetime

from sqlalchemy import select

from agentic.channels import deliver
from agentic.core.db import SessionLocal
from agentic.models import Agent, Report, Schedule, Task, Workspace
from agentic.teams import timetable

from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_microsoft import make_agent, user_id
from .test_office_roles import as_role

HOURS = {
    "tz": "Asia/Kuala_Lumpur",
    "days": [1, 2, 3, 4, 5],
    "start": "09:00",
    "end": "18:00",
    "breaks": [{"start": "13:00", "end": "14:00"}],
    "urgent_anytime": False,
    "day_report": True,
}
MONDAY = date(2026, 10, 26)
SUNDAY = date(2026, 10, 25)


async def _setup(client, o) -> str:
    a = await new_agent(client, o, "Sofia", "Operations")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent is not None
        agent.work_hours = HOURS
        db.add_all(
            [
                Schedule(
                    workspace_id=agent.workspace_id,
                    name="Morning mail",
                    agent_id=agent.id,
                    title="Check the shared mailbox",
                    cron="0 9 * * 1-5",
                    timezone="Asia/Kuala_Lumpur",
                    created_by="user:x",
                ),
                Schedule(
                    workspace_id=agent.workspace_id,
                    name="Night backup check",
                    agent_id=agent.id,
                    title="Check last night's backup",
                    cron="30 20 * * *",
                    timezone="Asia/Kuala_Lumpur",
                    created_by="user:x",
                ),
            ]
        )
        await db.commit()
    return a["id"]


async def test_a_working_day_with_its_duties(client, llm, temporal):
    o = await office(client)
    aid = await _setup(client, o)
    async with SessionLocal() as db:
        agent = await db.get(Agent, aid)
        assert agent is not None
        mon = await timetable.day_plan(db, agent, MONDAY, "Asia/Kuala_Lumpur")
        sun = await timetable.day_plan(db, agent, SUNDAY, "Asia/Kuala_Lumpur")
    assert mon["works"] and mon["hours"] == [
        {"start": "09:00", "end": "13:00"},
        {"start": "14:00", "end": "18:00"},
    ]
    assert [(d["time"], d["outside_hours"]) for d in mon["duties"]] == [
        ("09:00", False),
        ("20:30", True),
    ]
    assert mon["day_report"] is True and mon["label"]
    assert not sun["works"] and sun["hours"] == []
    assert [d["time"] for d in sun["duties"]] == ["20:30"]


async def test_the_office_view_and_staff_see_their_own_ai(client, llm, temporal):
    o = await office(client)
    aid = await _setup(client, o)
    r = await client.get("/api/timetable", params={"date": MONDAY.isoformat()})
    assert r.status_code == 200, r.text
    assert any(x["agent_id"] == aid for x in r.json()["agents"])
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        uid, ws_id = await user_id("aina@example.com")
        twin = await make_agent(o, ws_id, uid, is_twin=True, name="Aina Twin")
        got = (await staff.get("/api/timetable")).json()
        assert [x["agent_id"] for x in got["agents"]] == [twin.id]
        assert (await staff.get("/api/timetable", params={"date": "26-10-2026"})).status_code == 422
    finally:
        await staff.aclose()


async def test_the_end_of_day_summary_once(client, llm, temporal, monkeypatch):
    o = await office(client)
    aid = await _setup(client, o)
    told: list[dict] = []

    async def notify_people(db, workspace_id, title, body, url, *, dedupe, perm="approvals.decide"):
        told.append({"url": url, "perm": perm, "body": body})
        return []

    monkeypatch.setattr(deliver, "notify_people", notify_people)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        db.add(
            Task(
                workspace_id=ws.id,
                title="Reply to Ahmad",
                brief="",
                status="done",
                assignee_agent_id=aid,
                created_by="user:x",
                finished_at=datetime(2026, 10, 26, 3, 0, tzinfo=UTC),
            )
        )
        await db.commit()
    # Monday 18:05 in Kuala Lumpur = 10:05 UTC.
    before = datetime(2026, 10, 26, 9, 55, tzinfo=UTC)
    after = datetime(2026, 10, 26, 10, 5, tzinfo=UTC)
    calls = len(llm.requests)
    async with SessionLocal() as db:
        assert await timetable.day_reports(db, before) == 0
        assert await timetable.day_reports(db, after) == 1
        assert await timetable.day_reports(db, after) == 0
        r = await db.scalar(select(Report).where(Report.agent_id == aid))
    assert len(llm.requests) == calls  # no model
    assert r is not None and r.labels == ["day", "agent"] and "Reply to Ahmad" in r.body
    assert r.summary.startswith("Sofia finished 1 tasks today")
    assert told and told[0]["perm"] == "agents.manage" and told[0]["url"] == f"/reports?r={r.id}"
