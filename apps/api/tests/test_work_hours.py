"""P19 working hours: the pure helpers, and where they are enforced (starting tasks, the
durable deferred start, schedules, heartbeats, agent settings)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from agentic.agents import dispatch, launch
from agentic.agents import work_hours as wh
from agentic.core.db import SessionLocal
from agentic.models import Agent, Schedule, Task, TaskEvent
from agentic.teams import heartbeat, schedules

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401

KL = ZoneInfo("Asia/Kuala_Lumpur")
WEEK = {
    "tz": "Asia/Kuala_Lumpur",
    "days": [1, 2, 3, 4, 5],
    "start": "09:00",
    "end": "18:00",
    "breaks": [{"start": "13:00", "end": "14:00"}],
    "urgent_anytime": False,
}
ALWAYS = {"tz": "UTC", "days": [1, 2, 3, 4, 5, 6, 7], "start": "00:00", "end": "24:00"}


def kl(y, mo, d, h, mi=0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=KL)


WED_10 = kl(2026, 9, 30, 10)  # Wednesday
WED_1330 = kl(2026, 9, 30, 13, 30)
WED_19 = kl(2026, 9, 30, 19)
FRI_19 = kl(2026, 10, 2, 19)
SAT_10 = kl(2026, 10, 3, 10)


def off_now() -> dict:
    """Hours that are off right now, whatever day the test runs: every other weekday."""
    today = datetime.now(KL).isoweekday()
    return {**WEEK, "days": [d for d in range(1, 8) if d != today]}


@pytest.fixture
def deferred(temporal, monkeypatch):  # noqa: F811
    temporal["deferred"] = []

    async def start_deferred(task_id, run, at):
        temporal["deferred"].append((task_id, run, at))
        return f"defer-{task_id}-{run}"

    async def upsert_schedule(*_a):
        return None

    monkeypatch.setattr(dispatch, "start_deferred", start_deferred)
    monkeypatch.setattr(dispatch, "upsert_schedule", upsert_schedule)
    return temporal


# ---------------------------------------------------------------- pure helpers


def test_state_breaks_days_and_time_zone():
    assert wh.state(WED_10, WEEK) == "working" and wh.is_working(WED_10, WEEK)
    assert wh.state(WED_1330, WEEK) == "break"
    assert wh.state(WED_19, WEEK) == "off" and wh.state(SAT_10, WEEK) == "off"
    assert wh.state(kl(2026, 9, 30, 9), WEEK) == "working"  # start is inclusive
    assert wh.state(kl(2026, 9, 30, 18), WEEK) == "off"  # end is exclusive
    assert wh.state(kl(2026, 9, 30, 14), WEEK) == "working"  # back from lunch
    # The same instant in another zone: 10:00 in KL is 02:00 UTC, still on duty.
    assert wh.is_working(WED_10.astimezone(UTC), WEEK)
    london = {**WEEK, "tz": "Europe/London"}
    assert not wh.is_working(WED_10, london)  # 03:00 in London
    assert wh.is_working(WED_19, None)  # no hours: any time


def test_next_start_and_shift_end():
    assert wh.next_start(WED_10, WEEK) == WED_10
    assert wh.next_start(WED_1330, WEEK) == kl(2026, 9, 30, 14)  # after lunch
    assert wh.next_start(WED_19, WEEK) == kl(2026, 10, 1, 9)  # tomorrow
    assert wh.next_start(FRI_19, WEEK) == kl(2026, 10, 5, 9)  # Monday
    assert wh.next_start(kl(2026, 9, 30, 7), WEEK) == kl(2026, 9, 30, 9)  # later today
    assert wh.next_start(WED_10, None) is None
    assert wh.shift_end(WED_10, WEEK) == kl(2026, 9, 30, 13)
    assert wh.shift_end(kl(2026, 9, 30, 15), WEEK) == kl(2026, 9, 30, 18)
    assert wh.shift_end(WED_19, WEEK) is None
    assert wh.shift_end(kl(2026, 10, 3, 23), {**ALWAYS, "tz": "Asia/Kuala_Lumpur"}) == kl(
        2026, 10, 4, 0
    )


def test_describe_duty_and_labels():
    assert wh.describe(WEEK) == "Mon–Fri 09:00–18:00, lunch 13:00–14:00"
    assert wh.describe({**WEEK, "days": [1, 3, 5], "breaks": []}) == "Mon, Wed, Fri 09:00–18:00"
    assert wh.describe(
        {**WEEK, "days": list(range(1, 8)), "breaks": [{"start": "10:00", "end": "10:15"}]}
    ) == ("Every day 09:00–18:00, break 10:00–10:15")
    assert wh.describe(None) == "Any time"
    assert wh.duty(WED_10, WEEK)["label"] == "On duty until 13:00"
    assert wh.duty(WED_1330, WEEK) == {
        "state": "break",
        "on": False,
        "until": kl(2026, 9, 30, 14).isoformat(),
        "label": "On a break until 14:00",
    }
    assert wh.duty(WED_19, WEEK)["label"] == "Off duty until 09:00 tomorrow"
    assert wh.duty(FRI_19, WEEK)["label"] == "Off duty until 09:00 on Mon"
    assert wh.duty(WED_10, None)["state"] == "always"
    assert wh.waiting_note("Siti's twin", kl(2026, 10, 1, 9), WED_19, WEEK) == (
        "Starts when Siti's twin is back at 09:00 tomorrow"
    )


def test_urgency_rules():
    assert wh.task_is_urgent("urgent", []) and wh.task_is_urgent("normal", ["Urgent"])
    assert not wh.task_is_urgent("high", ["invoice"])
    assert wh.schedule_is_urgent("Urgent: server check", "Server check")
    assert wh.schedule_is_urgent("Nightly", "[urgent] backup")
    assert not wh.schedule_is_urgent("Weekly report", "Not urgent at all")
    # Urgent work starts off-hours only when the hours allow it.
    assert wh.deferred_until(WED_19, WEEK, urgent=True) == kl(2026, 10, 1, 9)
    anytime = {**WEEK, "urgent_anytime": True}
    assert wh.deferred_until(WED_19, anytime, urgent=True) is None
    assert wh.deferred_until(WED_19, anytime, urgent=False) == kl(2026, 10, 1, 9)
    assert wh.deferred_until(WED_10, WEEK, urgent=False) is None
    assert wh.deferred_until(WED_19, None, urgent=False) is None


def test_clean_validates_and_normalises():
    out = wh.clean(
        {"days": [5, 1, 1], "start": "9:00", "end": "17:30", "breaks": []}, "Asia/Kuala_Lumpur"
    )
    assert out == {
        "tz": "Asia/Kuala_Lumpur",
        "days": [1, 5],
        "start": "09:00",
        "end": "17:30",
        "breaks": [],
        "urgent_anytime": False,
    }
    assert wh.clean(None, "UTC") is None
    bad = [
        ({**WEEK, "days": []}, "at least one"),
        ({**WEEK, "days": [0]}, "from 1"),
        ({**WEEK, "start": "18:00", "end": "09:00"}, "overnight"),  # overnight: not supported
        ({**WEEK, "start": "09:00", "end": "09:00"}, "end after"),
        ({**WEEK, "start": "9am"}, "look like"),
        ({**WEEK, "tz": "Mars/Base"}, "time zone"),
        ({**WEEK, "breaks": [{"start": "08:00", "end": "09:30"}]}, "inside"),
        ({**WEEK, "breaks": [{"start": "13:00", "end": "12:00"}]}, "end after"),
        (
            {
                **WEEK,
                "breaks": [{"start": "12:00", "end": "13:30"}, {"start": "13:00", "end": "14:00"}],
            },
            "overlap",
        ),
        ({**WEEK, "breaks": [{"start": "09:00", "end": "18:00"}]}, "no time"),
    ]
    for raw, words in bad:
        with pytest.raises(wh.HoursError, match=words):
            wh.clean(raw, "UTC")
    two = wh.clean(
        {
            **WEEK,
            "breaks": [{"start": "15:00", "end": "15:15"}, {"start": "10:30", "end": "10:45"}],
        },
        "UTC",
    )
    assert two and [b["start"] for b in two["breaks"]] == ["10:30", "15:00"]  # sorted
    assert wh.segments(two) == [(540, 630), (645, 900), (915, 1080)]


# ---------------------------------------------------------------- enforcement


async def set_hours(agent_id: str, hours: dict | None) -> None:
    async with SessionLocal() as db:
        a = await db.get(Agent, agent_id)
        assert a is not None
        a.work_hours = hours
        await db.commit()


async def test_off_duty_agent_queues_work_until_its_shift(client, llm, deferred):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    await set_hours(a["id"], off_now())
    r = await client.post(
        "/api/tasks",
        json={"title": "Reconcile", "assignee_agent_id": a["id"], "start": True},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "ready" and t["run_count"] == 0
    assert t["blocked_reason"].startswith("Starts when Aina is back at 09:00")
    assert deferred["start"] == []  # not started now...
    [(task_id, run, at)] = deferred["deferred"]  # ...but timed for the next shift
    assert task_id == t["id"] and run == 0
    assert at.astimezone(KL).hour == 9 and at > datetime.now(UTC)

    # Pressing start again is the same timer (same task, run and time): idempotent.
    r = await client.post(f"/api/tasks/{t['id']}/start", json={}, headers=csrf(client))
    assert r.status_code == 200 and deferred["deferred"][-1] == (t["id"], 0, at)

    # Urgent work waits too unless the hours allow urgent work any time...
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Server down",
            "assignee_agent_id": a["id"],
            "start": True,
            "priority": "urgent",
        },
        headers=csrf(client),
    )
    assert r.json()["status"] == "ready" and deferred["start"] == []
    # ...which they do now: the urgent one starts, a normal one still waits.
    await set_hours(a["id"], {**off_now(), "urgent_anytime": True})
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Server down",
            "assignee_agent_id": a["id"],
            "start": True,
            "labels": ["urgent"],
        },
        headers=csrf(client),
    )
    assert r.json()["status"] == "ready" and r.json()["run_count"] == 1
    assert [x[0] for x in deferred["start"]] == [r.json()["id"]]

    # The wake-up: hours are now "any time", so it starts; a moved task is left alone.
    await set_hours(a["id"], None)
    async with SessionLocal() as db:
        assert await launch.start_deferred(db, t["id"], 1) == "skipped"  # wrong run
        assert await launch.start_deferred(db, t["id"], 0) == "started"
        assert await launch.start_deferred(db, t["id"], 0) == "skipped"  # already started
        task = await db.get(Task, t["id"])
        assert task is not None and task.run_count == 1 and task.blocked_reason is None
    async with SessionLocal() as db:
        kinds = (await db.scalars(select(TaskEvent.kind).where(TaskEvent.task_id == t["id"]))).all()
    assert "deferred" in kinds and "run" in kinds


async def test_changing_hours_starts_waiting_work(client, llm, deferred):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    await set_hours(a["id"], off_now())
    t = (
        await client.post(
            "/api/tasks",
            json={"title": "Reconcile", "assignee_agent_id": a["id"], "start": True},
            headers=csrf(client),
        )
    ).json()
    assert t["status"] == "ready" and deferred["start"] == []
    r = await client.patch(
        f"/api/agents/{a['id']}", json={"work_hours": ALWAYS}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["work_hours"]["end"] == "24:00" and body["duty"]["on"] is True
    assert body["hours_label"] == "Every day 00:00–24:00"
    assert deferred["start"] == [(t["id"], 1)]

    # Validation: a 422 with the reason; null clears hours (any time).
    r = await client.patch(
        f"/api/agents/{a['id']}",
        json={"work_hours": {**WEEK, "start": "18:00", "end": "09:00"}},
        headers=csrf(client),
    )
    assert r.status_code == 422 and "overnight" in r.json()["message"]
    r = await client.patch(
        f"/api/agents/{a['id']}", json={"work_hours": None}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["work_hours"] is None and r.json()["duty"] is None
    # The default tz is the workspace's.
    r = await client.patch(
        f"/api/agents/{a['id']}",
        json={"work_hours": {k: v for k, v in WEEK.items() if k != "tz"}},
        headers=csrf(client),
    )
    assert r.json()["work_hours"]["tz"] == "Asia/Kuala_Lumpur"
    assert r.json()["duty"]["label"].startswith(("On duty", "Off duty", "On a break"))


async def test_schedule_runs_wait_for_the_shift_unless_urgent(client, llm, deferred):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    await set_hours(a["id"], off_now())
    async with SessionLocal() as db:
        ws_id = (await db.get(Agent, a["id"])).workspace_id  # type: ignore[union-attr]
        plain = Schedule(
            workspace_id=ws_id,
            name="Daily cash",
            agent_id=a["id"],
            title="Cash report",
            cron="0 9 * * *",
            timezone="Asia/Kuala_Lumpur",
            created_by="user:x",
        )
        urgent = Schedule(
            workspace_id=ws_id,
            name="Urgent: uptime",
            agent_id=a["id"],
            title="Uptime check",
            cron="0 * * * *",
            timezone="Asia/Kuala_Lumpur",
            created_by="user:x",
        )
        db.add_all([plain, urgent])
        await db.commit()
        ids = plain.id, urgent.id
    out = await schedules.claim(ids[0], False)
    assert out and "wait_until" in out
    assert datetime.fromisoformat(out["wait_until"]).astimezone(KL).hour == 9
    async with SessionLocal() as db:
        t = await db.get(Task, out["task_id"])
        assert t and t.blocked_reason and t.blocked_reason.startswith("Starts when Aina")
        assert t.priority == "normal"
    # Urgent schedule, hours that do not allow urgent work: it waits as well.
    assert "wait_until" in (await schedules.claim(ids[1], False) or {})
    await set_hours(a["id"], {**off_now(), "urgent_anytime": True})
    out = await schedules.claim(ids[1], False)
    assert out and "wait_until" not in out
    async with SessionLocal() as db:
        t = await db.get(Task, out["task_id"])
        assert t and t.priority == "urgent" and t.blocked_reason is None
    # When the run starts, the note goes.
    out = await schedules.claim(ids[0], False)
    assert out
    await schedules.attempt(out["run_id"], 1)
    async with SessionLocal() as db:
        t = await db.get(Task, out["task_id"])
        assert t and t.blocked_reason is None and t.run_count == 1


async def test_heartbeat_wakes_agents_only_in_their_hours(client, llm, deferred):
    o = await office(client)
    on = await new_agent(client, o, "Aina", heartbeat=True)
    off = await new_agent(client, o, "Bina", "Operations", heartbeat=True)
    office_hours = await new_agent(client, o, "Chen", "Research", heartbeat=True)
    async with SessionLocal() as db:
        for x in (on, off, office_hours):
            db.add(
                Task(
                    workspace_id=(await db.get(Agent, x["id"])).workspace_id,  # type: ignore[union-attr]
                    title=f"Queued for {x['name']}",
                    status="ready",
                    assignee_agent_id=x["id"],
                    created_by="user:x",
                )
            )
        await db.commit()
    # Saturday 10:00 in KL: the office is closed, Aina works weekends, Bina is at lunch.
    await set_hours(on["id"], {**WEEK, "days": [6, 7]})
    await set_hours(
        off["id"], {**WEEK, "days": [6], "breaks": [{"start": "10:00", "end": "11:00"}]}
    )
    totals = await heartbeat.tick(SAT_10.astimezone(UTC))
    assert totals["started"] == 1
    async with SessionLocal() as db:
        started = (await db.scalars(select(Task).where(Task.run_count == 1))).all()
        assert [t.assignee_agent_id for t in started] == [on["id"]]
    # Wednesday 10:00: the office is open; Chen (no hours of its own) wakes, Bina does not.
    totals = await heartbeat.tick(WED_10.astimezone(UTC))
    async with SessionLocal() as db:
        started = (await db.scalars(select(Task).where(Task.run_count == 1))).all()
        assert sorted(t.assignee_agent_id for t in started) == sorted(
            [on["id"], office_hours["id"]]
        )


async def test_goal_loop_continues_off_hours(client, llm, deferred):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    await set_hours(a["id"], off_now())
    async with SessionLocal() as db:
        t = Task(
            workspace_id=(await db.get(Agent, a["id"])).workspace_id,  # type: ignore[union-attr]
            title="Keep going",
            status="review",
            assignee_agent_id=a["id"],
            created_by="user:x",
            run_count=1,
        )
        db.add(t)
        await db.commit()
        assert await launch.launch(db, t, "goal-loop") is None  # continues: not new work
        assert t.run_count == 2
        later = await launch.launch(db, t, "user:someone")  # new work from a person: waits
        assert later is not None and later > datetime.now(UTC) and t.run_count == 2
        # Asked "as of" a moment inside the shift, it starts.
        inside = later + timedelta(minutes=5)
        assert await launch.launch(db, t, "user:someone", now=inside) is None
        assert t.run_count == 3
