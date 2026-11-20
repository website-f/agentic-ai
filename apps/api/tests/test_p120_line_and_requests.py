"""P120 (Fitri, 20 Nov 2026):
- everyone under a person on the organization chart, down the whole line, is theirs to give work
  to and follow, whatever their role (user 1 > user 2 > users 3 and 4; user 4 > users 6 and 7:
  user 1 gives tasks to all five);
- a group HOD runs every company they are added to;
- a person who may not connect a SharePoint folder asks for one, and the person above them
  approves or declines it on the Approvals page, with a reason.
"""

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.api.routers import linked_sources
from agentic.core.db import SessionLocal
from agentic.org import requests as asks
from agentic.sharepoint import links
from agentic.sharepoint.models import LinkedSource

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import member, signed_in

LINK = "https://maju.sharepoint.com/:f:/s/HQ/EabcDEF123"


async def _people(client, names, role="staff", **where):
    made = {}
    for n in names:
        made[n] = await member(client, f"{n}@example.com", role, **where)
    return made, {k: v["member"]["user_id"] for k, v in made.items()}


async def _under(client, boss, ids):
    r = await client.put(f"/api/members/{boss}/team", json={"user_ids": ids}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["skipped"] == 0, r.text


async def _give(c, who):
    return await c.post(
        "/api/tasks", json={"title": "Count the stock", "assignee_user_id": who}, headers=csrf(c)
    )


async def test_the_whole_line_below_is_theirs(client, llm, temporal):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    made, ids = await _people(client, ["u1", "u2", "u3", "u4", "u6", "u7", "u9"], branch_id=bid)
    await _under(client, ids["u1"], [ids["u2"]])
    await _under(client, ids["u2"], [ids["u3"], ids["u4"]])
    await _under(client, ids["u4"], [ids["u6"], ids["u7"]])
    u1 = await signed_in("u1@example.com", made["u1"]["temp_password"])
    u4 = await signed_in("u4@example.com", made["u4"]["temp_password"])
    try:
        # Staff at the top of a line give work to everyone under them, however deep.
        for who in ("u2", "u3", "u4", "u6", "u7"):
            r = await _give(u1, ids[who])
            assert r.status_code == 201, (who, r.text)
        r = await _give(u1, ids["u9"])
        assert r.status_code == 403 and r.json()["code"] == "cannot_assign"
        # Never upwards: user 4 gives to 6 and 7, not to 2 or 1.
        assert (await _give(u4, ids["u7"])).status_code == 201
        assert (await _give(u4, ids["u2"])).status_code == 403
        # The task picker lists the whole line (and themselves), nobody else.
        picker = {p["user_id"] for p in (await u1.get("/api/team/people")).json()}
        assert picker == {ids[n] for n in ("u1", "u2", "u3", "u4", "u6", "u7")}
        # My workspace shows the whole line under them, managers ahead of their people.
        mine = (await u1.get("/api/members/hierarchy/mine")).json()
        assert mine["below"] == 5 and [p["name"] for p in mine["reports"]] == ["U2"]
        order = [p["user_id"] for p in mine["line"]]
        assert set(order) == {ids[n] for n in ("u2", "u3", "u4", "u6", "u7")}
        assert order.index(ids["u4"]) < order.index(ids["u6"])
        # They follow the work of the whole line: a task user 4 gave user 7 reaches user 1.
        t7 = (await _give(u4, ids["u7"])).json()
        assert (await u1.get(f"/api/tasks/{t7['id']}")).status_code == 200
        # A role change keeps the line (the chart decides, not the role).
        r = await client.patch(
            f"/api/members/{ids['u2']}",
            json={"role": "supervisor", "department_id": o["depts"]["Finance"], "branch_id": bid},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        team = {m["user_id"] for m in (await client.get(f"/api/members/{ids['u2']}/team")).json()}
        assert team == {ids["u3"], ids["u4"]}
    finally:
        await u1.aclose()
        await u4.aclose()


async def test_a_group_hod_runs_every_company_added(client, llm, temporal):  # noqa: F811
    o = await office(client)
    b1 = o["branch"]["id"]
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    b3 = (
        await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    ).json()
    # A group HOD needs a company.
    r = await client.post(
        "/api/members",
        json={"email": "gh0@example.com", "name": "Gh0", "role": "group_hod"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "branch_required"
    g = await member(client, "gh@example.com", "group_hod", branch_id=b1, branch_ids=[b1, b2["id"]])
    await member(client, "ana@example.com", "staff", branch_id=b1)
    await member(client, "ben@example.com", "staff", branch_id=b2["id"])
    await member(client, "cal@example.com", "staff", branch_id=b3["id"])
    gh = await signed_in("gh@example.com", g["temp_password"])
    try:
        me = (await gh.get("/api/auth/me")).json()
        assert me["role"] == "group_hod" and me["scope"]["kind"] == "branch"
        seen = {m["name"] for m in (await gh.get("/api/members")).json()}
        assert {"Ana", "Ben"} <= seen and "Cal" not in seen
        # One member's own page: theirs to open, another company's person is not here.
        rows = {m["name"]: m["user_id"] for m in (await client.get("/api/members")).json()}
        r = await gh.get(f"/api/members/{rows['Ben']}")
        assert r.status_code == 200 and r.json()["name"] == "Ben"
        assert (await gh.get(f"/api/members/{rows['Cal']}")).status_code == 404
        assert (await gh.get("/api/members/hierarchy")).status_code == 200
    finally:
        await gh.aclose()


@pytest.fixture
def folder(monkeypatch):
    """The asker's Microsoft sign-in opens the link; syncing is only recorded."""
    synced: list[str] = []

    async def graph(db, principal):
        return None

    async def resolve(g, url):
        return links.Item("drive-1", "item-1", "HR Policies", LINK, True)

    async def start(source_id):
        synced.append(source_id)

    monkeypatch.setattr(linked_sources, "_my_files_graph", graph)
    monkeypatch.setattr(links, "resolve", resolve)
    monkeypatch.setattr(dispatch, "start_linked_sync", start)
    return synced


async def test_staff_ask_for_a_folder_and_their_manager_decides(client, llm, temporal, folder):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    made, ids = await _people(client, ["sam", "mia", "kai"], branch_id=bid)
    await _under(client, ids["mia"], [ids["sam"]])  # Sam reports to Mia (both staff)
    sam, mia, kai = [
        await signed_in(f"{n}@example.com", made[n]["temp_password"]) for n in ("sam", "mia", "kai")
    ]
    try:
        listed = (await sam.get("/api/library/linked")).json()
        assert listed["can_connect"] is False and listed["can_request"] is True
        r = await sam.post(
            "/api/library/linked/requests",
            json={"url": LINK, "note": "Our HR forms"},
            headers=csrf(sam),
        )
        assert r.status_code == 201, r.text
        req = r.json()
        assert req["status"] == "pending" and req["title"] == "HR Policies"
        assert req["approver_name"] == "Mia" and req["branch_id"] == bid
        assert req["can_cancel"] is True and req["can_decide"] is False
        assert "drive_id" not in req["detail"] and req["detail"]["name"] == "HR Policies"
        # The same folder is not asked for twice.
        again = await sam.post(
            "/api/library/linked/requests", json={"url": LINK}, headers=csrf(sam)
        )
        assert again.status_code == 409 and again.json()["code"] == "already_asked"

        # Mia sees it waiting (and in her bell); a colleague who is not above Sam does not.
        box = (await mia.get("/api/requests")).json()
        assert [x["id"] for x in box["to_decide"]] == [req["id"]]
        assert box["to_decide"][0]["can_decide"] is True
        needs = (await mia.get("/api/me/needs")).json()
        assert any(i["key"] == "requests" for i in needs["items"])
        assert (await kai.get("/api/requests")).json()["to_decide"] == []
        r = await kai.post(
            f"/api/requests/{req['id']}/decide",
            json={"decision": "approve", "reason": "fine"},
            headers=csrf(kai),
        )
        assert r.status_code == 404
        # Nobody approves their own; every decision has a reason.
        r = await sam.post(
            f"/api/requests/{req['id']}/decide",
            json={"decision": "approve", "reason": "mine"},
            headers=csrf(sam),
        )
        assert r.status_code == 403 and r.json()["code"] == "own_request"
        r = await mia.post(
            f"/api/requests/{req['id']}/decide", json={"decision": "approve"}, headers=csrf(mia)
        )
        assert r.status_code == 422 and r.json()["code"] == "reason_needed"

        r = await mia.post(
            f"/api/requests/{req['id']}/decide",
            json={"decision": "approve", "reason": "Needed by the HR team"},
            headers=csrf(mia),
        )
        assert r.status_code == 200, r.text
        done = r.json()
        assert done["status"] == "approved" and done["decided_by_name"] == "Mia"
        async with SessionLocal() as db:
            s = (await db.scalars(select(LinkedSource))).one()
        assert s.connected_by == ids["sam"] and s.branch_id == bid and s.name == "HR Policies"
        assert done["result_id"] == s.id and folder == [s.id]
        # Decided once only; Sam sees the answer under his own requests.
        r = await mia.post(
            f"/api/requests/{req['id']}/decide",
            json={"decision": "decline", "reason": "no"},
            headers=csrf(mia),
        )
        assert r.status_code == 409
        mine = (await sam.get("/api/requests")).json()["mine"]
        assert (
            mine[0]["status"] == "approved" and mine[0]["decision_note"] == "Needed by the HR team"
        )
        # Now it is in the Library: asking again is refused.
        r = await sam.post("/api/library/linked/requests", json={"url": LINK}, headers=csrf(sam))
        assert r.status_code == 409 and r.json()["code"] == "already_linked"
    finally:
        for c in (sam, mia, kai):
            await c.aclose()


async def test_declined_cancelled_and_who_else_decides(client, llm, temporal, folder):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    made, ids = await _people(client, ["zed"], branch_id=bid)
    zed = await signed_in("zed@example.com", made["zed"]["temp_password"])
    try:
        # Zed reports to no one: the office's managers (the owner here) decide.
        req = (
            await zed.post("/api/library/linked/requests", json={"url": LINK}, headers=csrf(zed))
        ).json()
        assert req["approver_name"] is None
        box = (await client.get("/api/requests")).json()
        assert [x["id"] for x in box["to_decide"]] == [req["id"]]
        r = await client.post(
            f"/api/requests/{req['id']}/decide",
            json={"decision": "decline", "reason": "Use the HQ folder instead"},
            headers=csrf(client),
        )
        assert r.status_code == 200 and r.json()["status"] == "declined"
        async with SessionLocal() as db:
            assert (await db.scalars(select(LinkedSource))).all() == []
        # A new ask may be taken back while it waits, by its asker only.
        req = (
            await zed.post("/api/library/linked/requests", json={"url": LINK}, headers=csrf(zed))
        ).json()
        r = await client.post(f"/api/requests/{req['id']}/cancel", json={}, headers=csrf(client))
        assert r.status_code == 403
        r = await zed.post(f"/api/requests/{req['id']}/cancel", json={}, headers=csrf(zed))
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        # Someone who may link folders themselves is told to do that instead.
        r = await client.post(
            "/api/library/linked/requests",
            json={"url": LINK, "branch_id": bid},
            headers=csrf(client),
        )
        assert r.status_code == 409 and r.json()["code"] == "may_connect"
    finally:
        await zed.aclose()
    assert asks.MIN_REASON == 3
