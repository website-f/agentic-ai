"""P145: the group structure (the owner, 27 Nov 2026: "Roles come from DIRECTOR OFFICE
GORVERNANCE.pdf and GOVERNMENT OPERATION.pdf ... If a member's role can't be identified, I must
be able to sort them manually very easily ... I can add a new role when it's not listed").

Units and positions seeded once per workspace from agentic/org/structure_seed.json (by key, so
it can run again), linked to the office companies and PWVSB departments; changed only by
whoever manages the organization or its members (and the head of HR); members placed one by one
or many at once, their job title following the position; work email on the member."""

import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Branch, Department, Membership
from agentic.org import structure

from .conftest import csrf, setup_owner
from .test_office_roles import as_role, member

PWVSB = "PW Venture Sdn Bhd (PWVSB)"


def jh(c) -> dict[str, str]:
    return {**csrf(c), "content-type": "application/json"}


async def add_dept(branch_id: str, name: str, slug: str) -> str:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Branch.workspace_id).where(Branch.id == branch_id))
        d = Department(workspace_id=ws, branch_id=branch_id, name=name, slug=slug, position=50)
        db.add(d)
        await db.commit()
        return d.id


async def group(c) -> dict:
    """The owner, PWVSB (standard departments and Human Resources) and Goodwill Empire."""
    await setup_owner(c)
    pw = (await c.post("/api/branches", json={"name": PWVSB}, headers=jh(c))).json()
    gw = (
        await c.post("/api/branches", json={"name": "Goodwill Empire Sdn Bhd"}, headers=jh(c))
    ).json()
    hr = await add_dept(pw["id"], "Human Resources", "hr")
    ws = (await c.get("/api/auth/me")).json()["workspace"]["id"]
    return {
        "ws": ws,
        "pw": pw,
        "gw": gw,
        "hr": hr,
        "pw_depts": {d["name"]: d["id"] for d in pw["departments"]},
    }


async def read(c) -> dict:
    r = await c.get("/api/org/structure")
    assert r.status_code == 200, r.text
    s = r.json()
    s["unit"] = {u["key"]: u for u in s["units"]}
    s["pos"] = {p["key"]: p for p in s["positions"]}
    s["member"] = {m["user_id"]: m for m in s["members"]}
    return s


async def actions(ws: str) -> list[str]:
    async with SessionLocal() as db:
        return list(
            (await db.scalars(select(AuditLog.action).where(AuditLog.workspace_id == ws))).all()
        )


async def test_seed_once_linked_and_again_by_key(client):
    o = await group(client)
    s = await read(client)
    assert s["can_edit"] is True
    # P146: the office companies and departments the seed has no unit for are units too.
    seeded = [x for x in s["units"] if not x["key"].startswith("office_")]
    assert len(seeded) == len(structure.seed_units()) == 45
    assert len(s["positions"]) == len(structure.seed_positions()) == 57
    u, p = s["unit"], s["pos"]
    # The tree is connected: every unit but the group has a parent; positions report upward.
    assert [k for k, x in u.items() if x["parent_id"] is None] == ["pwvsb_group"]
    assert u["government_operations"]["parent_id"] == u["goodwill_empire"]["id"]
    assert u["dept_it"]["parent_id"] == u["pw_venture"]["id"]
    assert u["region_sabah"]["kind"] == "region"
    assert u["reserved_governance"]["kind"] == "governance"
    assert p["vice_chief_of_staff"]["reports_to_id"] == p["chief_of_staff"]["id"]
    assert p["dept_it_executive"]["reports_to_id"] == p["head_of_it"]["id"]
    assert p["operations_executive"]["headcount"] == 20
    assert p["ceo"]["default_role"] == "management"
    assert p["head_of_company"]["default_role"] == "branch_manager"
    assert p["chief_of_staff"]["default_role"] == "hr"
    assert all(x["default_role"] != "owner" for x in s["positions"])
    assert "PENGERUSI" in p["chairman"]["aliases"] and p["chairman"]["title_ms"] == "Pengerusi"
    # Linked to the office's companies and PWVSB's departments.
    assert u["goodwill_empire"]["branch_id"] == o["gw"]["id"]
    assert u["pw_venture"]["branch_id"] == o["pw"]["id"]
    assert u["finance"]["department_id"] == o["pw_depts"]["Finance"]
    assert u["do_hr_administration"]["department_id"] == o["hr"]
    assert u["dept_operations"]["department_id"] == o["pw_depts"]["Operations"]
    assert u["dept_legal"]["department_id"] is None  # PWVSB has no Legal department (yet)
    assert all(not x["custom"] for x in s["units"])
    me = next(m for m in s["members"] if m["role"] == "owner")
    assert me["position_id"] is None and me["work_email"] is None

    # Again: nothing new (by key), on its own and from the owner's button.
    async with SessionLocal() as db:
        again = await structure.ensure(db, o["ws"])
        await db.commit()
    assert (again.units, again.positions, again.linked) == (0, 0, 0)
    legal = await add_dept(o["pw"]["id"], "Legal", "legal")
    r = await client.delete(
        f"/api/org/structure/positions/{p['store_helper']['id']}", headers=jh(client)
    )
    assert r.status_code == 204, r.text
    r = await client.post("/api/org/structure/seed", json={}, headers=jh(client))
    assert r.status_code == 200, r.text
    assert r.json() == {"units": 0, "positions": 1, "linked": 1}
    s2 = await read(client)
    assert s2["unit"]["dept_legal"]["department_id"] == legal
    assert s2["pos"]["store_helper"]["reports_to_id"] == p["storekeeper"]["id"]
    assert "org.structure_seeded" in await actions(o["ws"])


async def test_changes_and_who_may(client):
    o = await group(client)
    s = await read(client)
    staff = await as_role(client, "sam@example.com", "staff", branch_id=o["pw"]["id"])
    seen = await read(staff)
    assert seen["can_edit"] is False and len(seen["units"]) == len(s["units"])
    assert {m["email"] for m in seen["members"]} == {"sam@example.com"}  # their own scope
    r = await staff.post("/api/org/structure/units", json={"name": "Mine"}, headers=jh(staff))
    assert r.status_code == 403
    r = await staff.put(
        f"/api/members/{seen['members'][0]['user_id']}/position",
        json={"position_id": s["pos"]["driver"]["id"]},
        headers=jh(staff),
    )
    assert r.status_code == 403

    gdo = s["unit"]["group_director_office"]["id"]
    r = await client.post(
        "/api/org/structure/units",
        json={
            "name": "  Corporate   Communications ",
            "name_ms": "Komunikasi Korporat",
            "parent_id": gdo,
            "kind": "department",
        },  # fmt: skip
        headers=jh(client),
    )
    assert r.status_code == 201, r.text
    cc = r.json()
    assert cc["name"] == "Corporate Communications" and cc["custom"] and cc["parent_id"] == gdo
    r = await client.patch(
        f"/api/org/structure/units/{cc['id']}", json={"name": "Corp Comms"}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["name"] == "Corp Comms"
    ceo = s["pos"]["ceo"]
    r = await client.post(
        "/api/org/structure/positions",
        json={
            "title": "Head of Corp Comms",
            "unit_id": cc["id"],
            "reports_to_id": ceo["id"],
            "default_role": "hod",
            "headcount": 1,
            "duties": "Press and staff news.",
        },  # fmt: skip
        headers=jh(client),
    )
    assert r.status_code == 201, r.text
    head = r.json()
    assert (
        head["level"] == ceo["level"] + 1 and head["custom"] and head["reports_to_id"] == ceo["id"]
    )
    r = await client.post(
        "/api/org/structure/positions",
        json={"title": "Comms Executive", "unit_id": cc["id"], "reports_to_id": head["id"]},
        headers=jh(client),
    )
    ex = r.json()
    r = await client.patch(
        f"/api/org/structure/positions/{ex['id']}",
        json={"title_ms": "Eksekutif Komunikasi", "default_role": "staff", "headcount": 2},
        headers=jh(client),
    )
    assert r.status_code == 200 and r.json()["headcount"] == 2
    r = await client.post(
        "/api/org/structure/positions",
        json={"title": "x", "unit_id": cc["id"], "default_role": "owner"},
        headers=jh(client),
    )
    assert r.status_code == 422  # never the owner role

    # A unit from the PDFs stays; a custom one goes only when empty.
    r = await client.delete(f"/api/org/structure/units/{gdo}", headers=jh(client))
    assert r.status_code == 409 and r.json()["code"] == "unit_standard"
    r = await client.delete(f"/api/org/structure/units/{cc['id']}", headers=jh(client))
    assert r.status_code == 409 and r.json()["code"] == "unit_not_empty"
    # The head goes: the executive then reports to the head's own boss (the CEO).
    r = await client.delete(f"/api/org/structure/positions/{head['id']}", headers=jh(client))
    assert r.status_code == 204
    assert (await read(client))["pos"][ex["key"]]["reports_to_id"] == ceo["id"]
    await client.delete(f"/api/org/structure/positions/{ex['id']}", headers=jh(client))
    r = await client.delete(f"/api/org/structure/units/{cc['id']}", headers=jh(client))
    assert r.status_code == 204
    done = await actions(o["ws"])
    for a in ("org.unit_added", "org.unit_changed", "org.unit_removed", "org.position_added",
              "org.position_changed", "org.position_removed"):  # fmt: skip
        assert a in done, a


async def test_head_of_hr_edits_too(client):
    o = await group(client)
    m = await member(
        client, "hana@example.com", "hod", branch_id=o["pw"]["id"], department_id=o["hr"]
    )
    hana = await as_role(client, "other@example.com", "hod", branch_id=o["pw"]["id"],
                         department_id=o["pw_depts"]["Finance"])  # fmt: skip
    assert (await read(hana))["can_edit"] is False
    async with SessionLocal() as db:
        row = await db.get(Membership, (o["ws"], m["member"]["user_id"]))
        row.heads_department = True
        await db.commit()
    from .test_office_roles import signed_in

    hr_head = await signed_in("hana@example.com", m["temp_password"])
    assert (await read(hr_head))["can_edit"] is True
    r = await hr_head.post(
        "/api/org/structure/units", json={"name": "Payroll"}, headers=jh(hr_head)
    )
    assert r.status_code == 201, r.text


async def test_no_reporting_or_unit_loops(client):
    await group(client)
    s = await read(client)
    p, u = s["pos"], s["unit"]
    for boss in ("chief_of_staff", "vice_chief_of_staff", "ceo"):
        r = await client.patch(
            f"/api/org/structure/positions/{p['ceo']['id']}",
            json={"reports_to_id": p[boss]["id"]},
            headers=jh(client),
        )
        assert r.status_code == 422 and r.json()["code"] == "reporting_loop", boss
    r = await client.patch(
        f"/api/org/structure/positions/{p['coo']['id']}",
        json={"reports_to_id": p["chairman"]["id"]},
        headers=jh(client),
    )
    assert r.status_code == 200 and r.json()["level"] == p["chairman"]["level"] + 1
    for under in ("do_hr_administration", "group_director_office"):
        r = await client.patch(
            f"/api/org/structure/units/{u['group_director_office']['id']}",
            json={"parent_id": u[under]["id"]},
            headers=jh(client),
        )
        assert r.status_code == 422 and r.json()["code"] == "unit_loop", under
    r = await client.patch(
        f"/api/org/structure/units/{u['transport']['id']}",
        json={"parent_id": u["pw_venture"]["id"]},
        headers=jh(client),
    )
    assert r.status_code == 200


async def test_assign_many_and_one(client):
    o = await group(client)
    s = await read(client)
    a = (await member(client, "ali@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    b = (await member(client, "bea@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    driver = s["pos"]["driver"]
    r = await client.post(
        "/api/org/structure/assign",
        json={"user_ids": [a["user_id"], b["user_id"], "us_nobody"], "position_id": driver["id"]},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["done"] == 2 and [x["user_id"] for x in out["skipped"]] == ["us_nobody"]
    assert out["skipped"][0]["message"] == "That member is not here."
    m = (await read(client))["member"]
    assert m[a["user_id"]]["position_id"] == driver["id"]
    assert m[a["user_id"]]["job_title"] == "Driver"
    one = (await client.get(f"/api/members/{a['user_id']}")).json()
    assert one["position_id"] == driver["id"]

    # One at a time; without set_job_title the title they have stays.
    store = s["pos"]["storekeeper"]
    r = await client.put(
        f"/api/members/{a['user_id']}/position",
        json={"position_id": store["id"], "set_job_title": False},
        headers=jh(client),
    )
    assert r.status_code == 200 and r.json() == {"ok": True}
    m = (await read(client))["member"]
    assert (
        m[a["user_id"]]["position_id"] == store["id"] and m[a["user_id"]]["job_title"] == "Driver"
    )
    r = await client.put(
        f"/api/members/{a['user_id']}/position", json={"position_id": None}, headers=jh(client)
    )
    assert r.status_code == 200
    assert (await read(client))["member"][a["user_id"]]["position_id"] is None

    # A held position goes only when confirmed; its people go to Unsorted.
    r = await client.delete(f"/api/org/structure/positions/{driver['id']}", headers=jh(client))
    assert r.status_code == 409 and r.json()["code"] == "position_held"
    r = await client.delete(
        f"/api/org/structure/positions/{driver['id']}?move_holders=true", headers=jh(client)
    )
    assert r.status_code == 204
    assert (await read(client))["member"][b["user_id"]]["position_id"] is None

    # An admin never changes the owner's position (the others still go through).
    admin = await as_role(client, "ada@example.com", "admin")
    owner_id = next(x["user_id"] for x in s["members"] if x["role"] == "owner")
    r = await admin.post(
        "/api/org/structure/assign",
        json={"user_ids": [owner_id, b["user_id"]], "position_id": store["id"]},
        headers=jh(admin),
    )
    assert r.json()["done"] == 1 and r.json()["skipped"][0]["user_id"] == owner_id
    assert "member.position_changed" in await actions(o["ws"])


async def test_work_email(client):
    o = await group(client)
    a = (await member(client, "ali@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    r = await client.patch(
        f"/api/members/{a['user_id']}", json={"work_email": "Ali.B@Work.Example.com"},
        headers=jh(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    assert r.json()["work_email"] == "ali.b@work.example.com"
    assert (await read(client))["member"][a["user_id"]]["work_email"] == "ali.b@work.example.com"
    r = await client.patch(
        f"/api/members/{a['user_id']}", json={"work_email": "not an email"}, headers=jh(client)
    )
    assert r.status_code == 422
    r = await client.patch(
        f"/api/members/{a['user_id']}", json={"work_email": None}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["work_email"] is None
    hod = await as_role(client, "hod@example.com", "branch_manager", branch_id=o["gw"]["id"])
    r = await hod.patch(
        f"/api/members/{a['user_id']}", json={"work_email": "x@example.com"}, headers=jh(hod)
    )
    assert r.status_code == 403
    assert "member.work_email_changed" in await actions(o["ws"])


@pytest.mark.parametrize("path", ["/api/org/structure/units", "/api/org/structure/positions"])
async def test_signed_out_refused(client, path):
    r = await client.get("/api/org/structure")
    assert r.status_code == 401
    r = await client.post(path, json={}, headers={"content-type": "application/json"})
    assert r.status_code in (401, 422)
