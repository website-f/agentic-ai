"""P96: every role walked through the agents' real API.

Each role signs in, opens the agents page, creates an agent, edits it, gives it tools and a
skill, gives it a task, chats with it, reads the result, decides what it asks and opens AI
use. What each role may do follows core/security.py and api/scope.py: management and HR
create and manage their own and the team's agents like an admin (P92: admin minus the AI
engine, file storage and MCP tools); staff only their own AI twin.

All people and companies are synthetic (example.com).
"""

import pytest
from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Skill

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role

ROLES = (
    "owner",
    "admin",
    "management",
    "hr",
    "branch_manager",
    "hod",
    "supervisor",
    "staff",
    "operator",
    "approver",
    "viewer",
)
MANAGERS = {"owner", "admin", "management", "hr", "branch_manager", "hod"}
WHOLE = {"owner", "admin", "management", "hr"}  # publish skills for the whole workspace
WRITERS = MANAGERS | {"supervisor", "staff", "operator"}  # work.write
DECIDERS = MANAGERS | {"supervisor", "staff", "approver"}  # approvals.decide
PEOPLE = MANAGERS  # members.manage or team.manage: the AI use list of people


def _ok(code: int) -> bool:
    return 200 <= code < 300


async def _question(owner, llm, agent: dict, title: str) -> str:
    """A pending question from `agent` (it asks a person while working)."""
    task = await new_task(owner, agent, title)
    llm.replies.clear()  # a refused chat left its scripted answer unused
    llm.call("ask_human", question="Which month?")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    return r.approval_id


@pytest.mark.parametrize("role", ROLES)
async def test_every_role_walks_through_its_agents(client, llm, temporal, role):
    o = await office(client)
    a = o["branch"]["id"]
    fin = o["depts"]["Finance"]
    team = await new_agent(client, o, "Team Finance", "Finance")
    where = {
        "branch_manager": {"branch_id": a},
        "hod": {"department_id": fin},
        "supervisor": {"department_id": fin},
        "staff": {"branch_id": a, "department_id": fin},
    }.get(role, {})
    c = client if role == "owner" else await as_role(client, f"{role}@example.com", role, **where)
    got: dict[str, int] = {}
    try:
        got["me"] = (await c.get("/api/auth/me")).status_code
        got["agents page"] = (await c.get("/api/agents")).status_code
        # Create an agent of their own team (staff: their AI twin).
        r = await c.post(
            "/api/agents",
            json={
                "branch_id": a,
                "department_id": fin,
                "name": f"{role.title()} Bot",
                "role": "Finance helper",
            },
            headers=csrf(c),
        )
        got["create"] = r.status_code
        mine = r.json() if r.status_code == 201 else None
        if mine is not None:
            assert mine["can_manage"] is True
            if role == "staff":
                assert mine["is_twin"] is True  # staff have one agent: their AI twin
            else:
                assert mine["owner_user_id"] is None  # a team agent, not a personal one
            r = await c.patch(
                f"/api/agents/{mine['id']}", json={"role": "Finance clerk"}, headers=csrf(c)
            )
            got["edit own"] = r.status_code
            # Turning a tool OFF is always theirs; turning one on is a manager's (twins: P29).
            r = await c.patch(
                f"/api/agents/{mine['id']}", json={"tools": {"web_search": "deny"}}, headers=csrf(c)
            )
            got["tools own"] = r.status_code
        # The team's agent (the owner made it).
        r = await c.patch(f"/api/agents/{team['id']}", json={"role": "Accounts"}, headers=csrf(c))
        got["edit team"] = r.status_code
        r = await c.patch(
            f"/api/agents/{team['id']}",
            json={"tools": {"web_fetch": "allow"}},
            headers=csrf(c),
        )
        got["tools team"] = r.status_code
        # Choose who uses a skill: only the agents they manage, or everyone (whole workspace).
        skills = await client.get("/api/skills")
        notes = next(s for s in skills.json() if s["name"] == "meeting-notes")
        target = mine["id"] if mine else team["id"]
        r = await c.patch(
            f"/api/skills/{notes['id']}", json={"agent_ids": [target]}, headers=csrf(c)
        )
        got["skill to agent"] = r.status_code
        await client.patch(
            f"/api/skills/{notes['id']}", json={"agent_ids": []}, headers=csrf(client)
        )
        got["skills page"] = (await c.get("/api/skills")).status_code
        # The skill's page says whether they may publish it, so its buttons match (P96).
        detail = await c.get(f"/api/skills/{notes['id']}")
        if detail.status_code == 200:
            assert detail.json()["can_publish"] is (role in WHOLE), role
        # Give a task to an agent they work with, and start it.
        worker = mine if role == "staff" else team
        r = await c.post(
            "/api/tasks",
            json={"title": "Monthly summary", "assignee_agent_id": worker["id"], "start": True},
            headers=csrf(c),
        )
        got["task"] = r.status_code
        if r.status_code == 201:
            got["result"] = (await c.get(f"/api/tasks/{r.json()['id']}")).status_code
        llm.say("Hello, here is the summary.")
        r = await c.post(
            f"/api/agents/{worker['id']}/chat", json={"message": "Hi"}, headers=csrf(c)
        )
        got["chat"] = r.status_code
        # What the agent asks: they see it and decide it when they may.
        apv = await _question(client, llm, worker, "Payroll check")
        listed = [x["id"] for x in (await c.get("/api/approvals")).json()]
        got["approvals list"] = 200 if apv in listed else 404
        r = await c.post(
            f"/api/approvals/{apv}", json={"decision": "answer", "answer": "May"}, headers=csrf(c)
        )
        got["approve"] = r.status_code
        got["my AI use"] = (await c.get("/api/me/allowance")).status_code
        got["AI use people"] = (await c.get("/api/allowances")).status_code
    finally:
        if c is not client:
            await c.aclose()

    want = {
        "me": True,
        "agents page": True,
        "create": role in MANAGERS or role == "staff",
        "edit team": role in MANAGERS,
        "tools team": role in MANAGERS,
        "skill to agent": role in WHOLE,
        "skills page": role != "staff",  # staff keep to their own desk (P36)
        "task": role in WRITERS,
        "chat": role in WRITERS,
        # Everyone sees what the agents they see ask (operators and viewers too, read only).
        "approvals list": True,
        "approve": role in DECIDERS,
        "my AI use": True,
        "AI use people": role in PEOPLE,
    }
    if "edit own" in got:
        want |= {"edit own": True, "tools own": True, "result": True}
    if got.get("task") == 201:
        want["result"] = True
    assert {k: _ok(v) for k, v in got.items()} == {k: want[k] for k in got}, got


async def test_staff_cannot_change_a_team_agent_or_its_skills(client, llm, temporal):
    o = await office(client)
    a = o["branch"]["id"]
    fin = o["depts"]["Finance"]
    team = await new_agent(client, o, "Team Finance", "Finance")
    staff = await as_role(client, "s@example.com", "staff", branch_id=a, department_id=fin)
    try:
        for body in ({"role": "x"}, {"tools": {"browser_open": "allow"}}, {"status": "paused"}):
            r = await staff.patch(f"/api/agents/{team['id']}", json=body, headers=csrf(staff))
            assert r.status_code == 404, body  # outside their scope: not even shown as there
        async with SessionLocal() as db:
            sk = await db.scalar(select(Skill).where(Skill.name == "meeting-notes"))
        if sk is None:
            await client.get("/api/skills")
            async with SessionLocal() as db:
                sk = await db.scalar(select(Skill).where(Skill.name == "meeting-notes"))
        assert sk is not None
        r = await staff.patch(
            f"/api/skills/{sk.id}", json={"agent_ids": [team["id"]]}, headers=csrf(staff)
        )
        assert r.status_code == 403
    finally:
        await staff.aclose()
