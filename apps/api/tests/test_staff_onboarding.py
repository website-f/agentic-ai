"""P19 staff onboarding, "hire your AI worker": placement, the hire (blueprint, workflows,
duties, working hours, first task), the staff home, and twin-safe blueprints."""

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, Schedule, User, Workflow

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_twins import ANSWERS

ALWAYS = {"days": [1, 2, 3, 4, 5, 6, 7], "start": "00:00", "end": "24:00", "breaks": []}


@pytest.fixture
def hire_temporal(temporal, monkeypatch):  # noqa: F811
    temporal.update({"schedules": [], "deferred": []})

    async def upsert_schedule(sid, cron, tz, enabled, note):
        temporal["schedules"].append((sid, cron, tz, enabled))

    async def start_deferred(task_id, run, at):
        temporal["deferred"].append((task_id, run, at))
        return "defer"

    monkeypatch.setattr(dispatch, "upsert_schedule", upsert_schedule)
    monkeypatch.setattr(dispatch, "start_deferred", start_deferred)
    return temporal


async def audit_actions(action: str) -> list[AuditLog]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(AuditLog).where(AuditLog.action == action))).all())


async def test_staff_pick_their_company_once(client, llm, hire_temporal):
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    staff = await as_role(client, "aisyah@example.com", "staff", branch_id=b2["id"])
    # No company yet (Members always sets one, but a deleted company leaves it empty).
    async with SessionLocal() as db:
        m = await db.scalar(select(Membership).where(Membership.role == "staff"))
        assert m is not None
        m.branch_id = m.department_id = None
        await db.commit()
    try:
        s = (await staff.get("/api/me/staff")).json()
        assert s["eligible"] and s["placement"]["can_choose"]
        assert not s["placement"]["branch_locked"] and s["onboarding"] == {}
        assert {c["name"] for c in s["companies"]} == {"Maju Sdn Bhd", "Jaya Bhd"}
        assert s["default_hours"]["tz"] == "Asia/Kuala_Lumpur"
        assert s["default_hours"]["breaks"] == [{"start": "13:00", "end": "14:00"}]

        r = await staff.put(
            "/api/me/placement",
            json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]},
            headers=csrf(staff),
        )
        assert r.status_code == 200, r.text
        p = r.json()["placement"]
        assert p["branch_name"] == "Maju Sdn Bhd" and p["department_name"] == "Finance"
        assert p["branch_locked"] and p["department_locked"] and not p["can_choose"]
        [row] = await audit_actions("member.placement")
        assert row.after == {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}

        # Once chosen it is locked: moving needs an admin.
        r = await staff.put("/api/me/placement", json={"branch_id": b2["id"]}, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "placement_locked"
        r = await staff.put(
            "/api/me/placement",
            json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Operations"]},
            headers=csrf(staff),
        )
        assert r.status_code == 409
        # The same answer again is fine (the wizard's Next can be pressed twice).
        r = await staff.put(
            "/api/me/placement",
            json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]},
            headers=csrf(staff),
        )
        assert r.status_code == 200 and len(await audit_actions("member.placement")) == 1
        # The twin wizard now knows where they sit.
        twin_state = (await staff.get("/api/me/twin")).json()
        assert twin_state["person"]["department_name"] == "Finance" and twin_state["can_create"]
    finally:
        await staff.aclose()


async def test_set_by_manager_and_who_may_choose(client, llm, hire_temporal):
    o = await office(client)
    # The company is set, the department is not: staff may pick a department in it only.
    staff = await as_role(client, "badrul@example.com", "staff", branch_id=o["branch"]["id"])
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    try:
        s = (await staff.get("/api/me/staff")).json()["placement"]
        assert s["branch_locked"] and not s["department_locked"] and s["can_choose"]
        bad = await staff.put(
            "/api/me/placement",
            json={"branch_id": o["branch"]["id"], "department_id": "dp_nope"},
            headers=csrf(staff),
        )
        assert bad.status_code == 400
        r = await staff.put(
            "/api/me/placement",
            json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Operations"]},
            headers=csrf(staff),
        )
        assert r.status_code == 200 and r.json()["placement"]["department_name"] == "Operations"
        # A manager's place is their scope: never self-service.
        r = await hod.put(
            "/api/me/placement", json={"branch_id": o["branch"]["id"]}, headers=csrf(hod)
        )
        assert r.status_code == 403
        assert (await hod.get("/api/me/staff")).json()["eligible"] is False
        assert (
            await hod.post("/api/me/worker/hire", json={}, headers=csrf(hod))
        ).status_code == 403
        home = (await client.get("/api/me/worker")).json()  # the owner: no worker page
        assert home["eligible"] is False and home["twin"] is None
    finally:
        await staff.aclose()
        await hod.aclose()


async def test_hire_gives_the_worker_its_job_hours_and_first_task(client, llm, hire_temporal):
    o = await office(client)
    sop = (
        await client.post(
            "/api/sops",
            json={"scope": "library", "title": "Invoice checklist", "body": "1. Check totals."},
            headers=csrf(client),
        )
    ).json()
    bp = (
        await client.post(
            "/api/blueprints",
            json={
                "name": "Accounts clerk",
                "role": "Accounts clerk",
                "soul": "Match every invoice to a purchase order before anything else.",
                "tools": {"run_python": "allow", "web_search": "allow", "calc": "deny"},
                "autonomy": "auto",
                "sop_ids": [sop["id"]],
                "color": "#c2412d",
            },
            headers=csrf(client),
        )
    ).json()
    wf = (
        await client.post(
            "/api/workflows",
            json={"name": "Month end", "status": "active", "graph": {"nodes": [], "edges": []}},
            headers=csrf(client),
        )
    ).json()
    staff = await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        # No worker yet: hire refuses, the home says so.
        r = await staff.post("/api/me/worker/hire", json={}, headers=csrf(staff))
        assert r.status_code == 404 and r.json()["code"] == "no_twin"
        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        assert r.status_code == 201, r.text
        tw = r.json()["twin"]

        # A plain-words duty is read back; unclear words come back as a question.
        ok = (await staff.get("/api/me/worker/when", params={"text": "every Monday at 9am"})).json()
        assert ok["ok"] and ok["cron"] == "0 9 * * 1"
        q = (await staff.get("/api/me/worker/when", params={"text": "every other week"})).json()
        assert q["ok"] is False and q["question"]
        once = (await staff.get("/api/me/worker/when", params={"text": "tomorrow 9am"})).json()
        assert once["ok"] is False and "task" in once["question"]

        body = {
            "blueprint_id": bp["id"],
            "workflow_ids": [wf["id"]],
            "duties": [
                {
                    "title": "Weekly aging report",
                    "brief": "Overdue invoices",
                    "when": "every Monday at 9am",
                },
                {"title": "Bank feed check", "when": "every weekday at 8am", "urgent": True},
            ],
            "work_hours": {**ALWAYS, "urgent_anytime": True},
            "first_task": {"title": "List overdue invoices", "brief": "From the aging file."},
        }
        # One bad duty: nothing is saved.
        bad = {**body, "duties": [*body["duties"], {"title": "Odd", "when": "every other week"}]}
        r = await staff.post("/api/me/worker/hire", json=bad, headers=csrf(staff))
        assert r.status_code == 422 and r.json()["message"].startswith("Duty 3 (Odd)")
        r = await staff.post(
            "/api/me/worker/hire",
            json={**body, "work_hours": {**ALWAYS, "start": "18:00", "end": "09:00"}},
            headers=csrf(staff),
        )
        assert r.status_code == 422
        async with SessionLocal() as db:
            assert (await db.scalars(select(Schedule))).all() == []

        r = await staff.post("/api/me/worker/hire", json=body, headers=csrf(staff))
        assert r.status_code == 200, r.text
        out = r.json()
        w = out["twin"]
        # The blueprint is its playbook: who it is stays (a twin speaks for its person).
        assert w["name"] == ANSWERS["name"] and w["role"] == ANSWERS["role"]
        assert w["color"] == ANSWERS["color"] and w["autonomy"] == "ask"
        assert w["soul"].startswith("You are Siti's twin")
        assert "Your role playbook (Accounts clerk):" in w["soul"]
        assert "Match every invoice" in w["soul"]
        assert w["tools"]["run_python"] == "ask"  # code always asks, whatever the blueprint
        assert w["tools"]["web_search"] == "allow" and w["tools"]["calc"] == "deny"
        assert sop["id"] in w["sop_ids"] and w["template"] == "Accounts clerk"
        assert w["work_hours"]["tz"] == "Asia/Kuala_Lumpur" and w["work_hours"]["urgent_anytime"]
        assert w["duty"]["on"] is True
        assert [d["summary"] for d in out["duties"]] == [
            "every Monday at 09:00",
            "every weekday at 08:00",
        ]
        assert len(hire_temporal["schedules"]) == 2 and out["warnings"] == []
        async with SessionLocal() as db:
            names = sorted(s.name for s in (await db.scalars(select(Schedule))).all())
            assert names == ["Urgent: Bank feed check", "Weekly aging report"]
            flow = await db.get(Workflow, wf["id"])
            assert flow and flow.agent_ids == [tw["id"]]
            u = await db.scalar(select(User).where(User.email == "siti@example.com"))
            assert u and u.prefs["onboarding"]["done"] is True
        # On duty any time, so the first task started right away.
        assert out["first_task"]["status"] == "ready" and out["first_task"]["starts_at"] is None
        assert hire_temporal["start"] == [(out["first_task"]["id"], 1)]
        assert (await staff.get("/api/me/prefs")).json()["onboarding"]["done"] is True

        # The staff home.
        home = (await staff.get("/api/me/worker")).json()
        assert home["eligible"] and home["twin"]["id"] == tw["id"]
        assert home["duty"]["state"] == "working" and home["hours_label"] == "Every day 00:00–24:00"
        assert [t["title"] for t in home["today"]] == ["List overdue invoices"]
        assert home["today"][0]["kind"] == "queued"
        assert {d["title"] for d in home["duties"]} == {"Weekly aging report", "Bank feed check"}
        assert [d["urgent"] for d in home["duties"]] == [False, True]
        assert home["workflows"] == [{"id": wf["id"], "name": "Month end", "status": "active"}]
        assert home["blueprint"] == "Accounts clerk"
        assert home["counts"]["open"] == 1 and home["waiting"]["approvals"] == []

        # Re-saving the twin wizard keeps the playbook.
        r = await staff.patch("/api/me/twin", json={"tone": "friendly"}, headers=csrf(staff))
        assert "Your role playbook (Accounts clerk)" in r.json()["twin"]["soul"]

        # Later: one more duty, and the workflows it follows.
        r = await staff.post(
            "/api/me/worker/duties",
            json={"title": "Cash position", "when": "every day at 5pm"},
            headers=csrf(staff),
        )
        assert r.status_code == 201 and r.json()["summary"] == "every day at 17:00"
        r = await staff.put(
            "/api/me/worker/workflows", json={"workflow_ids": []}, headers=csrf(staff)
        )
        assert r.status_code == 200 and r.json()["changed"] == ["Month end"]

        # The owner applying a blueprint to the twin keeps the persona too.
        r = await client.post(
            f"/api/blueprints/{bp['id']}/apply", json={"agent_id": tw["id"]}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text
        a = (await client.get(f"/api/agents/{tw['id']}")).json()
        assert a["role"] == ANSWERS["role"] and a["autonomy"] == "ask"
        assert a["tools"]["run_python"] == "ask"
    finally:
        await staff.aclose()


async def test_first_task_waits_for_working_hours(client, llm, hire_temporal):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    o = await office(client)
    staff = await as_role(
        client,
        "nur@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        today = datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).isoweekday()
        hours = {
            **ALWAYS,
            "days": [d for d in range(1, 8) if d != today],
            "start": "09:00",
            "end": "18:00",
        }
        r = await staff.post(
            "/api/me/worker/hire",
            json={"work_hours": hours, "first_task": {"title": "Say hello"}},
            headers=csrf(staff),
        )
        assert r.status_code == 200, r.text
        first = r.json()["first_task"]
        assert first["starts_at"] and first["note"].startswith(
            "Starts when Siti's twin is back at 09:00"
        )
        assert hire_temporal["start"] == [] and len(hire_temporal["deferred"]) == 1
        home = (await staff.get("/api/me/worker")).json()
        assert home["duty"]["state"] == "off" and home["duty"]["label"].startswith(
            "Off duty until 09:00"
        )
        assert home["today"][0]["note"] == first["note"]
        # The office floor and agent lists show the same pill data.
        a = (await client.get(f"/api/agents/{r.json()['twin']['id']}")).json()
        assert a["duty"]["on"] is False
        async with SessionLocal() as db:
            m = await db.scalar(select(Membership).where(Membership.role == "staff"))
            assert m and m.department_id == o["depts"]["Finance"]
    finally:
        await staff.aclose()
