"""P18: AI twins, each staff member's one agent (their virtual self at work)."""

import pytest
from sqlalchemy.exc import IntegrityError

from agentic.agents import twin
from agentic.core.db import SessionLocal
from agentic.models import Agent

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role

ANSWERS = {
    "name": "Siti's twin",
    "role": "Accounts executive",
    "job": "I chase overdue invoices and prepare the monthly aging report.",
    "style": "Checks every figure twice and keeps a running list of what is pending.",
    "tone": "brief",
    "languages": ["English", "Malay"],
    "helps_with": ["numbers", "reports", "research"],
    "ask_first": ["web", "wiki"],
    "hours": "Weekdays, 8am to 5pm",
    "heartbeat": True,
    "color": "#2f6db5",
}


async def staff_in(client, o, email="siti@example.com", dept="Finance"):
    return await as_role(
        client, email, "staff", branch_id=o["branch"]["id"], department_id=o["depts"][dept]
    )


def test_persona_and_tools_come_from_the_answers():
    tools = twin.tools_for(["forms", "research"], ["web"])
    # Forms work in the browser; sending a form always asks.
    assert tools["browser_click"] == "allow" and tools["browser_submit"] == "ask"
    assert tools["web_fetch"] == "ask" and tools["browser_open"] == "ask"  # "ask me first: web"
    assert tools["notify_person"] == "allow"  # it reports to its person
    assert tools["run_python"] == "deny" and tools["tool_call"] == "deny"  # not chosen: off

    plain = twin.tools_for(["documents"], [])
    assert plain["browser_open"] == "deny" and plain["web_fetch"] == "deny"
    assert plain["draft_document"] == "allow"
    figures = twin.tools_for(["numbers"], [])
    assert figures["run_python"] == "ask"  # code always asks, even when chosen

    # A manager made a tool stricter: re-saving the wizard keeps it strict.
    kept = twin.keep_stricter(
        {"web_search": "allow"}, {"web_search": "deny"}, {"web_search": "allow"}
    )
    assert kept["web_search"] == "deny"

    soul = twin.soul({**ANSWERS}, "Siti Aminah", "Finance, Maju Sdn Bhd")
    assert soul.startswith("You are Siti's twin, the AI twin of Siti Aminah")
    assert "I chase overdue invoices" in soul and "Checks every figure twice" in soul
    assert "short and direct" in soul and "English and Malay" in soul
    assert "Always ask Siti first (ask_human) before: opening web pages" in soul
    assert "sending forms" in soul and "running code" in soul  # the locked ones, always
    assert "pick up queued work by yourself" in soul and "notify_person" in soul
    assert "never sign as Siti" in soul

    # Department-shaped suggestions.
    assert twin._dept_match("Finance")[1][0] == "numbers"
    assert "research" in twin._dept_match("Research & Strategy")[1]
    assert twin._dept_match("HR")[1] == ("documents", "files", "followups")
    assert twin._dept_match("Something else")[1] == twin._DEFAULT_HELPS


async def test_staff_create_one_twin_with_the_wizard(client, llm, temporal):
    o = await office(client)
    await client.post(
        "/api/sops",
        json={"scope": "department", "scope_id": o["depts"]["Finance"], "title": "Month end"},
        headers=csrf(client),
    )
    staff = await staff_in(client, o)
    try:
        state = (await staff.get("/api/me/twin")).json()
        assert state["eligible"] and state["can_create"] and state["twin"] is None
        assert state["suggested"]["name"] == "Siti's twin"
        assert state["suggested"]["role"] == "Finance staff"
        assert state["suggested"]["helps_with"][0] == "numbers"  # Finance: checking figures
        assert state["person"]["department_name"] == "Finance"
        assert state["person"]["initials"] == "S"
        assert [s["title"] for s in state["sops"]] == ["Month end"]
        assert {h["key"] for h in state["options"]["helps_with"]} >= {"documents", "forms"}

        # Preview: nothing saved; the AI polish falls back to the template without a model.
        r = await staff.post(
            "/api/me/twin/preview", json={**ANSWERS, "polish": True}, headers=csrf(staff)
        )
        assert r.status_code == 200, r.text
        assert r.json()["polished"] is False and "I chase overdue invoices" in r.json()["soul"]
        assert (await staff.get("/api/me/twin")).json()["twin"] is None

        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        assert r.status_code == 201, r.text
        t = r.json()["twin"]
        me = (await staff.get("/api/auth/me")).json()
        assert t["is_twin"] and t["owner_user_id"] == me["user"]["id"] and t["can_manage"]
        assert t["name"] == "Siti's twin" and t["role"] == "Accounts executive"
        assert t["branch_id"] == o["branch"]["id"] and t["department_id"] == o["depts"]["Finance"]
        assert t["autonomy"] == "ask" and t["role_kind"] == "leaf" and t["heartbeat"]
        assert t["tools"]["web_fetch"] == "ask" and t["tools"]["browser_open"] == "deny"
        assert t["tools"]["write_page"] == "ask" and t["tools"]["run_python"] == "ask"
        assert "I chase overdue invoices" in t["soul"]
        assert r.json()["profile"]["job"] == ANSWERS["job"]  # kept for "Edit persona"

        # What it knows about its person, seeded in USER.md.
        mem = (await staff.get(f"/api/agents/{t['id']}/memory")).json()
        assert mem["user"][0].startswith("I am the AI twin of Siti (siti@example.com)")
        assert any("chase overdue invoices" in e for e in mem["user"])

        # Exactly one: both doors refuse a second agent, with a friendly 409.
        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "twin_exists"
        assert "Siti's twin" in r.json()["message"]
        body = {"branch_id": o["branch"]["id"], "name": "Another", "role": "Helper"}
        r = await staff.post("/api/agents", json=body, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "twin_exists"
        assert r.json()["message"] == (
            "You already have your AI twin, Siti's twin. You can change it any time."
        )

        # Edit persona: only what changed is sent; the rest stays; memory follows.
        r = await staff.patch(
            "/api/me/twin",
            json={"job": "I run payroll for 40 people.", "tone": "friendly"},
            headers=csrf(staff),
        )
        assert r.status_code == 200, r.text
        t2 = r.json()["twin"]
        assert t2["id"] == t["id"] and t2["name"] == "Siti's twin"
        assert "I run payroll" in t2["soul"] and "chase overdue" not in t2["soul"]
        mem = (await staff.get(f"/api/agents/{t['id']}/memory")).json()
        assert any("payroll" in e for e in mem["user"])
        assert not any("chase overdue" in e for e in mem["user"])

        # Teach it: a fact about the person goes to its core memory; secrets do not.
        r = await staff.post(
            "/api/me/twin/teach",
            json={"text": "Siti's manager is Encik Rahman."},
            headers=csrf(staff),
        )
        assert r.status_code == 200 and "Siti's manager is Encik Rahman." in r.json()["user"]
        r = await staff.post(
            "/api/me/twin/teach",
            json={"text": "My password is hunter2-secret-123"},
            headers=csrf(staff),
        )
        assert r.status_code == 422
    finally:
        await staff.aclose()


async def test_first_generic_create_is_the_twin_and_retiring_frees_the_place(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o, "amir@example.com", "Operations")
    try:
        # The builder still works the first time: the agent becomes the twin, at home.
        body = {
            "branch_id": o["branch"]["id"],
            "department_id": o["depts"]["Finance"],  # not where Amir works
            "name": "Amir Bot",
            "role": "Coordinator",
        }
        r = await staff.post("/api/agents", json=body, headers=csrf(staff))
        assert r.status_code == 201, r.text
        first = r.json()
        assert first["is_twin"] and first["department_id"] == o["depts"]["Operations"]
        r = await staff.post("/api/agents", json={**body, "name": "Two"}, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "twin_exists"

        # Retired, it gives up its place; the next twin replaces it.
        r = await staff.patch(
            f"/api/agents/{first['id']}", json={"status": "retired"}, headers=csrf(staff)
        )
        assert r.status_code == 200
        state = (await staff.get("/api/me/twin")).json()
        assert state["twin"] is None and state["can_create"]
        r = await staff.post("/api/me/twin", json={}, headers=csrf(staff))
        assert r.status_code == 201, r.text
        assert r.json()["twin"]["name"] == "Amir's twin"  # all suggested values
        assert r.json()["twin"]["role"] == "Operations staff"
        async with SessionLocal() as db:
            assert not (await db.get(Agent, first["id"])).is_twin
    finally:
        await staff.aclose()


async def test_an_agent_from_before_twins_is_adopted_not_doubled(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        me = (await staff.get("/api/auth/me")).json()
        legacy = await new_agent(client, o, "Old Helper", "Research")
        async with SessionLocal() as db:  # owned by Siti before twins existed
            a = await db.get(Agent, legacy["id"])
            a.owner_user_id, a.tools = me["user"]["id"], {"run_python": "allow"}
            await db.commit()

        state = (await staff.get("/api/me/twin")).json()
        assert not state["can_create"] and [x["name"] for x in state["adoptable"]] == ["Old Helper"]
        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "adopt_instead"
        assert "Old Helper" in r.json()["message"]
        r = await staff.post(
            "/api/agents",
            json={"branch_id": o["branch"]["id"], "name": "New", "role": "R"},
            headers=csrf(staff),
        )
        assert r.status_code == 409 and r.json()["code"] == "adopt_instead"

        # Someone else's agent cannot be adopted.
        other = await new_agent(client, o, "Not Yours", "Finance")
        r = await staff.post(
            "/api/me/twin/adopt", json={"agent_id": other["id"]}, headers=csrf(staff)
        )
        assert r.status_code == 404

        r = await staff.post(
            "/api/me/twin/adopt", json={"agent_id": legacy["id"]}, headers=csrf(staff)
        )
        assert r.status_code == 200, r.text
        t = r.json()["twin"]
        assert t["id"] == legacy["id"] and t["is_twin"] and t["autonomy"] == "ask"
        assert t["department_id"] == o["depts"]["Finance"]  # moved to sit with Siti
        assert t["tools"]["run_python"] == "ask"  # code always asks for a twin
        assert r.json()["profile"] is None  # never through the wizard yet
        r = await staff.post(
            "/api/me/twin/adopt", json={"agent_id": legacy["id"]}, headers=csrf(staff)
        )
        assert r.status_code == 409

        # Its persona can now be written with the wizard; name and colour are kept.
        r = await staff.patch("/api/me/twin", json={"job": "I file things."}, headers=csrf(staff))
        assert r.status_code == 200 and r.json()["twin"]["name"] == "Old Helper"
        assert "I file things." in r.json()["twin"]["soul"]
    finally:
        await staff.aclose()


async def test_managers_and_owners_are_unaffected(client, llm, temporal):
    o = await office(client)
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    try:
        for name in ("A", "B", "C"):
            assert not (await new_agent(client, o, name, "Finance"))["is_twin"]
        body = {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}
        for name in ("H1", "H2"):
            r = await hod.post(
                "/api/agents", json={**body, "name": name, "role": "R"}, headers=csrf(hod)
            )
            assert r.status_code == 201 and not r.json()["is_twin"]
        state = (await client.get("/api/me/twin")).json()
        assert not state["eligible"] and not state["can_create"] and state["twin"] is None
        r = await client.post("/api/me/twin", json={}, headers=csrf(client))
        assert r.status_code == 403 and r.json()["code"] == "no_twin_role"
    finally:
        await hod.aclose()


async def test_who_sees_and_changes_a_twin(client, llm, temporal):
    o = await office(client)
    siti = await staff_in(client, o)
    amir = await staff_in(client, o, "amir@example.com", "Operations")
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    try:
        t = (await siti.post("/api/me/twin", json=ANSWERS, headers=csrf(siti))).json()["twin"]

        # A colleague in the branch watches it (view only) and cannot act on it.
        seen = {a["id"]: a for a in (await amir.get("/api/agents")).json()}
        assert seen[t["id"]]["view_only"] and seen[t["id"]]["is_twin"]
        assert seen[t["id"]]["owner_name"] == "Siti" and not seen[t["id"]]["can_manage"]
        r = await amir.patch(
            f"/api/agents/{t['id']}", json={"status": "paused"}, headers=csrf(amir)
        )
        assert r.status_code == 404
        r = await amir.post(
            f"/api/agents/{t['id']}/chat", json={"message": "hi"}, headers=csrf(amir)
        )
        assert r.status_code == 404
        r = await amir.put(
            f"/api/agents/{t['id']}/memory", json={"user": [], "memory": []}, headers=csrf(amir)
        )
        assert r.status_code == 404

        # Managers in scope govern it, but its persona belongs to its person.
        listed = {a["id"]: a for a in (await hod.get("/api/agents")).json()}
        assert listed[t["id"]]["can_manage"] and not listed[t["id"]]["view_only"]
        for c in (hod, client):
            r = await c.patch(f"/api/agents/{t['id']}", json={"name": "Bot"}, headers=csrf(c))
            assert r.status_code == 403 and r.json()["code"] == "twin_persona"
            r = await c.patch(f"/api/agents/{t['id']}", json={"soul": "x"}, headers=csrf(c))
            assert r.status_code == 403
        r = await client.patch(
            f"/api/agents/{t['id']}",
            json={"department_id": o["depts"]["Operations"]},
            headers=csrf(client),
        )
        assert r.status_code == 409 and r.json()["code"] == "twin_placement"
        r = await hod.patch(
            f"/api/agents/{t['id']}",
            json={"status": "paused", "tools": {**t["tools"], "web_search": "deny"}},
            headers=csrf(hod),
        )
        assert r.status_code == 200 and r.json()["status"] == "paused"

        # Its person still edits the persona, and the manager's stricter tool stays.
        r = await siti.patch(
            f"/api/agents/{t['id']}", json={"role": "Senior AE"}, headers=csrf(siti)
        )
        assert r.status_code == 200 and r.json()["role"] == "Senior AE"
        r = await siti.patch("/api/me/twin", json={"tone": "detailed"}, headers=csrf(siti))
        assert r.status_code == 200
        assert r.json()["twin"]["tools"]["web_search"] == "deny"
        assert "thorough" in r.json()["twin"]["soul"]
    finally:
        for c in (siti, amir, hod):
            await c.aclose()


async def test_the_database_keeps_one_twin_per_person(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        t = (await staff.post("/api/me/twin", json={}, headers=csrf(staff))).json()["twin"]
        async with SessionLocal() as db:
            first = await db.get(Agent, t["id"])
            db.add(
                Agent(
                    workspace_id=first.workspace_id,
                    branch_id=first.branch_id,
                    slug="sneaky-second",
                    name="Second",
                    role="R",
                    owner_user_id=first.owner_user_id,
                    is_twin=True,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
    finally:
        await staff.aclose()
