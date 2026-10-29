"""P55: the schedule picker's "Once". A person's one-off schedule switches itself off after it
fires (like an agent's "remind me Friday 4pm"); "Run now" does not use it up; it needs one date
and time; an edit can turn it into a recurring schedule and back. Schedule.created_by carries
it: "user:<id>|once"."""

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.models import Schedule, User
from agentic.teams import schedules

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401


@pytest.fixture
def sched(temporal, monkeypatch):  # noqa: F811
    """The Temporal schedule calls, recorded."""
    calls: dict[str, list] = {"upsert": [], "deleted": [], "run_now": []}

    async def upsert_schedule(sid, cron, tz, enabled, note):
        calls["upsert"].append((sid, cron, tz, enabled))

    async def delete_schedule(sid):
        calls["deleted"].append(sid)

    async def run_schedule_now(sid):
        calls["run_now"].append(sid)
        return f"scheduled-{sid}-now"

    monkeypatch.setattr(dispatch, "upsert_schedule", upsert_schedule)
    monkeypatch.setattr(dispatch, "delete_schedule", delete_schedule)
    monkeypatch.setattr(dispatch, "run_schedule_now", run_schedule_now)
    return calls


def test_created_by_says_who_and_whether_once():
    assert schedules.by_person("user:us_1", False) == "user:us_1"
    assert schedules.by_person("user:us_1", True) == "user:us_1|once"
    o = schedules.origin("user:us_1|once")
    assert (o.agent_id, o.person, o.via, o.once) == (None, "us_1", "page", True)
    assert schedules.origin("user:us_1") == schedules.Origin(person="us_1")
    by_agent = schedules.by_agent("ag_1", "us_1", "chat", False)
    assert schedules.with_once(by_agent, True) == "agent:ag_1|for:us_1|chat|once"
    assert schedules.with_once("agent:ag_1|for:us_1|chat|once", False) == by_agent
    assert schedules.with_once("user:us_1|once", True) == "user:us_1|once"
    assert schedules.origin(schedules.with_once(by_agent, True)).person == "us_1"
    assert schedules.one_off_cron("30 16 5 11 *") and schedules.one_off_cron(" 0  9 1 1 * ")
    for recurring in ("0 9 * * 1-5", "0 9 1 * *", "0 9 5 11 1", "0 */2 * * *", "0 9 5 1,6 *"):
        assert not schedules.one_off_cron(recurring), recurring


async def test_a_persons_one_off_switches_itself_off_after_firing(client, llm, sched):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    body = {
        "name": "SST return",
        "agent_id": a["id"],
        "title": "Submit the SST return",
        "cron": "30 16 5 11 *",
        "once": True,
    }
    r = await client.post("/api/schedules", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["origin"] == {
        "via": "page",
        "person_name": "Owner One",
        "by_agent": False,
        "once": True,
    }
    assert s["enabled"] and s["next_runs"]
    async with SessionLocal() as db:
        owner = await db.scalar(select(User).where(User.email == "owner@example.com"))
        assert (await db.get(Schedule, s["id"])).created_by == f"user:{owner.id}|once"
    assert sched["upsert"] == [(s["id"], "30 16 5 11 *", "Asia/Kuala_Lumpur", True)]

    # "Run now" is extra: the one-off still fires on its date.
    assert await schedules.claim(s["id"], True)
    async with SessionLocal() as db:
        assert (await db.get(Schedule, s["id"])).enabled

    # Its firing makes the task, then switches the schedule off, in Temporal too.
    claimed = await schedules.claim(s["id"], False)
    assert claimed and claimed["task_id"]
    async with SessionLocal() as db:
        assert not (await db.get(Schedule, s["id"])).enabled
        # The run is still the person's (their AI allowance, their own AI's mail and PC).
        from agentic.models import Task
        from agentic.teams.allowance import person_of_task

        task = await db.get(Task, claimed["task_id"])
        assert await person_of_task(db, task) == owner.id
    assert sched["upsert"][-1] == (s["id"], "30 16 5 11 *", "Asia/Kuala_Lumpur", False)
    assert await schedules.claim(s["id"], False) is None  # a stray second firing: nothing
    listed = (await client.get("/api/schedules")).json()
    assert listed[0]["origin"]["once"] is True
    assert listed[0]["enabled"] is False and listed[0]["next_runs"] == []
    assert listed[0]["last_run_at"]

    # Picked again for another date, it runs once more.
    r = await client.patch(
        f"/api/schedules/{s['id']}",
        json={"cron": "0 9 20 12 *", "enabled": True},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] and r.json()["origin"]["once"] is True


async def test_recurring_schedules_stay_on(client, llm, sched):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    body = {"name": "Cash", "agent_id": a["id"], "title": "Cash report", "cron": "0 9 * * 1-5"}
    s = (await client.post("/api/schedules", json=body, headers=csrf(client))).json()
    assert s["origin"]["once"] is False
    assert await schedules.claim(s["id"], False)
    async with SessionLocal() as db:
        assert (await db.get(Schedule, s["id"])).enabled


async def test_a_one_off_needs_one_date_and_can_become_recurring(client, llm, sched):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    base = {"name": "Cash", "agent_id": a["id"], "title": "Cash report"}
    r = await client.post(
        "/api/schedules", json={**base, "cron": "0 9 * * 1-5", "once": True}, headers=csrf(client)
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_once"
    r = await client.post(
        "/api/schedules",
        json={**base, "cron": "0 9 * * 1-5", "once": True},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.json()["message"].startswith("Jadual sekali sahaja berjalan pada satu tarikh")

    s = (
        await client.post(
            "/api/schedules", json={**base, "cron": "0 9 * * 1-5"}, headers=csrf(client)
        )
    ).json()
    url = f"/api/schedules/{s['id']}"
    r = await client.patch(url, json={"once": True}, headers=csrf(client))
    assert r.status_code == 422 and r.json()["code"] == "bad_once"  # weekdays are not one date
    r = await client.patch(url, json={"once": True, "cron": "0 10 20 12 *"}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["origin"]["once"] is True and r.json()["cron"] == "0 10 20 12 *"
    r = await client.patch(url, json={"cron": "0 9 * * *"}, headers=csrf(client))
    assert r.status_code == 422  # still a one-off: it keeps needing one date
    r = await client.patch(url, json={"once": False, "cron": "0 9 * * 1"}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["origin"]["once"] is False
    async with SessionLocal() as db:
        owner = await db.scalar(select(User).where(User.email == "owner@example.com"))
        assert (await db.get(Schedule, s["id"])).created_by == f"user:{owner.id}"
