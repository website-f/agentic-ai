"""P109 Getting started: each role's checklist, ticked from real data, and the person's own
tour progress (memberships.getting_started), per person and per workspace."""

import httpx

from .conftest import csrf, setup_owner
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role


async def progress(c: httpx.AsyncClient) -> dict:
    r = await c.get("/api/getting-started")
    assert r.status_code == 200, r.text
    return r.json()


async def save(c: httpx.AsyncClient, body: dict) -> httpx.Response:
    return await c.put("/api/getting-started", json=body, headers=csrf(c))


def keys(p: dict) -> list[str]:
    return [s["key"] for s in p["steps"]]


def step(p: dict, key: str) -> dict:
    return next(s for s in p["steps"] if s["key"] == key)


async def test_needs_sign_in_and_csrf(client):
    assert (await client.get("/api/getting-started")).status_code == 401
    assert (await client.put("/api/getting-started", json={})).status_code == 401
    await setup_owner(client)
    r = await client.put("/api/getting-started", json={"tour_seen": "tasks"})
    assert r.status_code == 403  # no CSRF echo
    assert (await progress(client))["tours_seen"] == []


async def test_owner_steps_follow_real_data(client):
    await setup_owner(client)
    p = await progress(client)
    assert p["group"] == "owner" and p["role"] == "owner" and p["is_developer"] is False
    ks = keys(p)
    for k in ("system_mail", "workspace_settings", "ai_engine", "companies", "library_sources"):
        assert k in ks, k
    for k in ("members", "workspace", "own_ai", "first_task", "welcome"):
        assert k in ks, k
    assert "team" not in ks  # a branch manager's and a HOD's step
    assert step(p, "account")["done"] is True  # signed in with their own password
    assert not step(p, "companies")["done"] and not step(p, "ai_engine")["done"]
    assert p["complete"] is False and p["done"] < p["total"]
    assert p["welcome"] is None and p["resume"] is None

    r = await client.post("/api/branches", json={"name": "Maju Sdn Bhd"}, headers=csrf(client))
    assert r.status_code in (200, 201), r.text
    assert step(await progress(client), "companies") == {
        "key": "companies",
        "done": True,
        "by": "data",
        "optional": False,
        "manual": False,
    }

    # A pin on their desk sets up their workspace.
    r = await client.post(
        "/api/desk/items",
        json={"kind": "route", "ref": "/tasks", "title": "Board"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert step(await progress(client), "workspace")["by"] == "data"


async def test_tours_welcome_and_resume_are_saved(client):
    await setup_owner(client)
    # Starting the welcome tour, and where it is (survives a refresh or another device).
    r = await save(client, {"welcome": "started", "resume": {"tour": "welcome-owner", "step": 3}})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["welcome"] == "started" and p["resume"] == {"tour": "welcome-owner", "step": 3}
    assert not step(p, "welcome")["done"]

    # Taking a page's tour ticks the steps it covers (the Library look-around).
    p = (await save(client, {"tour_seen": "library"})).json()
    assert p["tours_seen"] == ["library"] and step(p, "library")["by"] == "tour"
    p = (await save(client, {"tour_seen": "library"})).json()
    assert p["tours_seen"] == ["library"]  # once

    # Finishing it: done, nothing to resume; an empty save changes nothing.
    p = (await save(client, {"welcome": "done", "resume": None})).json()
    assert p["welcome"] == "done" and p["resume"] is None and step(p, "welcome")["by"] == "data"
    assert (await save(client, {})).json() == p

    # By hand: only the steps nothing in the data can tell.
    p = (await save(client, {"mark": {"library_sources": True}})).json()
    assert step(p, "library_sources")["by"] == "hand"
    p = (await save(client, {"mark": {"library_sources": False}})).json()
    assert not step(p, "library_sources")["done"]
    r = await save(client, {"mark": {"companies": True}})
    assert r.status_code == 422 and r.json()["code"] == "bad_step"
    r = await save(client, {"mark": {"no_such_step": True}})
    assert r.status_code == 422

    # Ids are short slugs; a step number stays small.
    assert (await save(client, {"tour_seen": "../etc"})).status_code == 422
    assert (await save(client, {"resume": {"tour": "tasks", "step": 999}})).status_code == 422
    assert (await save(client, {"welcome": "maybe"})).status_code == 422


async def test_staff_have_their_own_steps_and_progress(client, temporal):  # noqa: F811
    o = await office(client)
    r = await save(client, {"tour_seen": "tasks", "welcome": "skipped", "mark": {"roles": True}})
    assert r.status_code == 200, r.text
    staff = await as_role(
        client,
        "siti@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        p = await progress(staff)
        assert p["group"] == "staff" and p["role"] == "staff"
        ks = keys(p)
        # Never the owner's setup steps.
        for k in (
            "system_mail",
            "workspace_settings",
            "ai_engine",
            "companies",
            "members",
            "roles",
        ):
            assert k not in ks, k
        # Email, their workspace, then their own AI, customised.
        for k in ("email", "workspace", "own_ai", "ai_custom", "library", "first_task"):
            assert k in ks, k
        assert (
            ks.index("email") < ks.index("workspace") < ks.index("own_ai") < ks.index("ai_custom")
        )
        # The owner's tours, welcome and marks are the owner's.
        assert p["tours_seen"] == [] and p["welcome"] is None
        assert not step(p, "own_ai")["done"]
        # A step only owners have cannot be ticked by a staff member.
        assert (await save(staff, {"mark": {"roles": True}})).status_code == 422

        p = (await save(staff, {"welcome": "started", "tour_seen": "my-ai"})).json()
        assert p["welcome"] == "started" and p["tours_seen"] == ["my-ai"]
        # ...and the owner's own progress did not move.
        mine = await progress(client)
        assert mine["welcome"] == "skipped" and mine["tours_seen"] == ["tasks"]
        assert step(mine, "roles")["by"] in ("hand", "tour", "data")
    finally:
        await staff.aclose()


async def test_managers_get_their_team_step(client, temporal):  # noqa: F811
    o = await office(client)
    hod = await as_role(
        client,
        "hod@example.com",
        "hod",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    admin = await as_role(client, "admin@example.com", "admin")
    try:
        p = await progress(hod)
        assert p["group"] == "hod" and "team" in keys(p) and "system_mail" not in keys(p)
        assert not step(p, "team")["done"]
        p = (await save(hod, {"tour_seen": "members"})).json()
        assert step(p, "team")["by"] == "tour"

        p = await progress(admin)
        assert p["group"] == "admin" and "team" not in keys(p)
        assert "system_mail" not in keys(p)  # the owner's own setting
        assert "members" in keys(p)
    finally:
        await hod.aclose()
        await admin.aclose()
