"""P19: starter teams for new companies, and the impact report built from real records."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import Agent, Approval, AuditLog, LLMCall, Task, Workspace

from .conftest import csrf, setup_owner
from .test_office_roles import as_role

# ---------------------------------------------------------------- starter teams


async def new_company(client, name: str, industry: str | None, team: bool = True) -> dict:
    body: dict = {"name": name, "starter_team": team}
    if industry:
        body["industry"] = industry
    r = await client.post("/api/branches", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    return r.json()


async def agents_in(branch_id: str) -> list[Agent]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(Agent).where(Agent.branch_id == branch_id))).all())


async def test_catalog_lists_each_industry_and_its_team(client):
    await setup_owner(client)
    cat = (await client.get("/api/branches/starter-teams")).json()
    by = {i["key"]: i for i in cat}
    assert set(by) == {"general", "network", "engineering", "trading", "professional"}
    assert len(by["general"]["agents"]) == 5
    roles = {a["role"] for a in by["network"]["agents"]}
    assert {"Network Operations (NOC) Assistant", "IT Helpdesk Officer"} <= roles
    roles = {a["role"] for a in by["engineering"]["agents"]}
    assert {"Project Coordinator", "Quantity Surveyor (QS)"} <= roles
    fin = next(a for a in by["general"]["agents"] if a["key"] == "finance")
    assert fin["example_name"] == "Aisyah (Finance)" and "soul" not in fin
    assert fin["tools"]["finance_calc"] == "allow" and "cash-flow-forecast" in fin["skills"]


async def test_new_company_with_its_starter_team(client):
    await setup_owner(client)
    b = await new_company(client, "Merdeka Network Sdn Bhd", "network")
    assert b["industry"] == "network"
    made = b["starter"]["created"]
    assert len(made) == 7 and b["starter"]["skipped"] == []
    depts = {d["name"]: d["id"] for d in b["departments"]}
    # Reuses the standard departments, adds the missing ones.
    assert {"Finance", "Operations", "Sales & Marketing", "HR & Admin", "Customer Service"} <= set(
        depts
    )
    assert {"Network Operations", "IT Helpdesk"} <= set(depts)
    assert set(b["starter"]["departments_created"]) == {
        "Sales & Marketing",
        "HR & Admin",
        "Customer Service",
        "Network Operations",
        "IT Helpdesk",
    }

    rows = await agents_in(b["id"])
    assert len(rows) == 7 and len({a.name for a in rows}) == 7
    assert all(a.autonomy == "ask" and not a.heartbeat for a in rows)
    fin = next(a for a in rows if a.role == "Finance & Accounts Officer")
    assert fin.name.endswith("(Finance)") and fin.department_id == depts["Finance"]
    assert fin.tools["finance_calc"] == "allow" and fin.tools["forecast"] == "allow"
    assert fin.tools["run_python"] == "ask"
    assert "Merdeka Network Sdn Bhd" in fin.soul and "cash-flow-forecast" in fin.soul
    noc = next(a for a in rows if a.role.startswith("Network Operations"))
    assert noc.department_id == depts["Network Operations"]

    # Shows up like any agent, and the change is in the audit log.
    listed = (await client.get(f"/api/agents?branch_id={b['id']}")).json()
    assert len(listed) == 7
    async with SessionLocal() as db:
        actions = (await db.scalars(select(AuditLog.action))).all()
        assert "branch.starter_team" in actions


async def test_starter_team_is_idempotent_and_can_be_topped_up(client):
    await setup_owner(client)
    b = await new_company(client, "Sutera Engineering Sdn Bhd", None, team=False)
    assert b["industry"] == "" and await agents_in(b["id"]) == []

    r = await client.post(
        f"/api/branches/{b['id']}/starter-team", json={"industry": "general"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["created"]) == 5 and r.json()["branch"]["industry"] == "general"

    again = (
        await client.post(
            f"/api/branches/{b['id']}/starter-team",
            json={"industry": "general"},
            headers=csrf(client),
        )
    ).json()
    assert again["created"] == [] and len(again["skipped"]) == 5

    more = (
        await client.post(
            f"/api/branches/{b['id']}/starter-team",
            json={"industry": "engineering"},
            headers=csrf(client),
        )
    ).json()
    assert {p["role"] for p in more["created"]} == {"Project Coordinator", "Quantity Surveyor (QS)"}
    assert {p["department"] for p in more["created"]} == {"Projects", "Contracts & QS"}
    assert len(await agents_in(b["id"])) == 7

    r = await client.post(
        f"/api/branches/{b['id']}/starter-team", json={"industry": "piracy"}, headers=csrf(client)
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_industry"


async def test_two_companies_get_their_own_names(client):
    await setup_owner(client)
    a = await new_company(client, "Alpha Sdn Bhd", "general")
    b = await new_company(client, "Beta Sdn Bhd", "general")
    names_a = {p["name"] for p in a["starter"]["created"]}
    names_b = {p["name"] for p in b["starter"]["created"]}
    assert not names_a & names_b  # friendly names stay distinct across the workspace
    async with SessionLocal() as db:
        slugs = (await db.scalars(select(Agent.slug))).all()
        assert len(slugs) == len(set(slugs)) == 10


async def test_only_admins_add_teams(client):
    await setup_owner(client)
    b = await new_company(client, "Maju Sdn Bhd", "general", team=False)
    hod = await as_role(client, "hod@example.com", "hod", department_id=b["departments"][1]["id"])
    try:
        r = await hod.post(
            f"/api/branches/{b['id']}/starter-team", json={"industry": "general"}, headers=csrf(hod)
        )
        assert r.status_code == 403
    finally:
        await hod.aclose()


# ---------------------------------------------------------------- impact


async def _seed_work(branch: dict) -> dict:
    """Two finished tasks for finance, one for operations, a failure, spend and approvals."""
    now = datetime.now(UTC)
    rows = await agents_in(branch["id"])
    fin = next(a for a in rows if a.role.startswith("Finance"))
    ops = next(a for a in rows if a.role.startswith("Operations"))
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None

        def task(agent: Agent, status: str, labels: list[str], ago: timedelta) -> Task:
            t = Task(
                workspace_id=ws.id,
                branch_id=branch["id"],
                title=f"{agent.name} {status}",
                status=status,
                assignee_agent_id=agent.id,
                created_by="user:x",
                labels=labels,
                finished_at=now - ago if status in ("done", "failed") else None,
            )
            db.add(t)
            return t

        t1 = task(fin, "done", ["cash-flow"], timedelta(days=1))
        task(fin, "done", ["invoice"], timedelta(days=2))
        task(ops, "done", [], timedelta(hours=3))
        task(ops, "failed", [], timedelta(hours=1))
        task(fin, "done", ["old"], timedelta(days=60))  # outside a 30-day window
        task(fin, "review", [], timedelta(0))
        await db.flush()
        for aid, cost in ((fin.id, 0.25), (ops.id, 0.05), (None, 0.10)):
            db.add(
                LLMCall(
                    workspace_id=ws.id,
                    ts=now - timedelta(hours=2),
                    task="agent.step",
                    provider_name="Good",
                    model="m1",
                    agent_id=aid,
                    prompt_tokens=1000,
                    completion_tokens=200,
                    cost_usd=cost,
                    status="ok",
                )
            )
        db.add(
            LLMCall(
                workspace_id=ws.id,
                ts=now - timedelta(hours=2),
                task="agent.step",
                provider_name="Local",
                model="qwen",
                agent_id=fin.id,
                cost_usd=None,
                status="ok",
            )
        )
        for minutes, state in ((10, "approved"), (30, "denied"), (None, "pending")):
            created = now - timedelta(hours=5)
            db.add(
                Approval(
                    workspace_id=ws.id,
                    task_id=t1.id,
                    agent_id=fin.id,
                    tool_name="email_draft",
                    tool_call_id="c1",
                    status=state,
                    created_at=created,
                    expires_at=created + timedelta(days=1),
                    decided_at=created + timedelta(minutes=minutes) if minutes else None,
                )
            )
        await db.commit()
    return {"fin": fin, "ops": ops}


async def test_impact_counts_real_work_by_company_and_department(client):
    await setup_owner(client)
    b = await new_company(client, "Merdeka Network Sdn Bhd", "network")
    other = await new_company(client, "Quiet Sdn Bhd", "general", team=False)
    await _seed_work(b)
    await client.get("/api/skills")  # seeds the built-in starters

    out = (await client.get("/api/impact?days=30")).json()
    t = out["totals"]
    assert t["tasks_done"] == 3 and t["tasks_failed"] == 1 and t["in_review"] == 1
    assert t["success_rate"] == 0.75 and t["agents"] == 7
    assert t["usd"] == 0.4  # agents' spend plus office housekeeping for a full view
    assert t["calls"] == 4 and t["calls_unpriced"] == 1
    assert out["default_minutes"] == 30
    assert {x["label"] for x in out["labels"]} == {"cash-flow", "invoice"}
    assert {x["label"]: x["count"] for x in out["work_types"]} == {
        "cash-flow": 1,
        "invoice": 1,
        "": 1,
    }
    assert sum(d["count"] for d in out["done_by_day"]) == 3 and len(out["done_by_day"]) == 30

    by = {x["name"]: x for x in out["branches"]}
    assert set(by) == {"Merdeka Network Sdn Bhd", "Quiet Sdn Bhd"}
    m = by["Merdeka Network Sdn Bhd"]
    assert m["tasks_done"] == 3 and m["usd"] == 0.3 and m["industry"] == "network"
    depts = {d["name"]: d for d in m["departments"]}
    assert depts["Finance"]["tasks_done"] == 2 and depts["Finance"]["coverage"] == "working"
    assert depts["Operations"]["tasks_done"] == 1 and depts["Operations"]["tasks_failed"] == 1
    assert depts["Customer Service"]["coverage"] == "ready"  # an agent, nothing done yet
    assert depts["Research"]["coverage"] == "none"  # a standard department nobody staffs
    assert m["departments"][0]["name"] == "Finance"  # busiest first
    assert by["Quiet Sdn Bhd"]["tasks_done"] == 0 and other["id"] == by["Quiet Sdn Bhd"]["id"]

    ap = out["approvals"]
    assert (ap["decided"], ap["approved"], ap["denied"], ap["pending"]) == (2, 1, 1, 1)
    assert ap["median_minutes"] == 20.0
    assert out["coverage"]["with_agents"] == 7 and out["coverage"]["working"] == 2
    assert out["top_agents"][0]["done"] == 2
    assert out["skills"]["active"] >= 8 and out["skills"]["learned"] == 0

    # A longer window takes in the older work too.
    assert (await client.get("/api/impact?days=90")).json()["totals"]["tasks_done"] == 4
    assert (await client.get("/api/impact?days=0")).status_code == 422


async def test_impact_follows_the_viewers_scope(client):
    await setup_owner(client)
    b = await new_company(client, "Merdeka Network Sdn Bhd", "network")
    await new_company(client, "Sutera Engineering Sdn Bhd", "engineering")
    await _seed_work(b)
    fin_dept = next(d["id"] for d in b["departments"] if d["name"] == "Finance")
    hod = await as_role(client, "hod@example.com", "hod", department_id=fin_dept)
    staff = await as_role(client, "staff@example.com", "staff", branch_id=b["id"])
    try:
        out = (await hod.get("/api/impact?days=30")).json()
        assert out["scope"]["kind"] == "department"
        assert out["totals"]["tasks_done"] == 2 and out["totals"]["usd"] == 0.25
        assert [x["name"] for x in out["branches"]] == ["Merdeka Network Sdn Bhd"]
        assert [d["name"] for d in out["branches"][0]["departments"]] == ["Finance"]
        r = await staff.get("/api/impact")
        assert r.status_code == 403
    finally:
        await hod.aclose()
        await staff.aclose()
