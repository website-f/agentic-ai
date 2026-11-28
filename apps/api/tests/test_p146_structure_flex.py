"""P146: the group structure made flexible (the owner, 28 Nov 2026).

- "In Companies why not the same [as Departments]?": every office company is a unit (kind
  company, linked to its branch) and each of its departments a unit under it, made on read,
  only what is missing, never touching what the owner built.
- "Add a department under a department ... and add members and roles there": sub-units.
- "Pick an existing role": a role copied into another unit keeps its other names (aliases).
- "Reports-to ... side by side, pair by pair": each member's reports_to in the read, and work
  groups (pairs, small teams) per unit, one group per member per unit, changed by editors only.
"""

from sqlalchemy import func, select

from agentic.core.db import SessionLocal
from agentic.models import OrgUnit, OrgWorkGroup

from .test_office_roles import as_role, member
from .test_p145_structure import actions, group, jh, read


async def unit_count(ws: str) -> int:
    async with SessionLocal() as db:
        return int(
            await db.scalar(
                select(func.count()).select_from(OrgUnit).where(OrgUnit.workspace_id == ws)
            )
            or 0
        )


async def test_company_units_made_once_and_custom_rows_kept(client):
    o = await group(client)
    s = await read(client)
    u = s["unit"]
    # Seeded companies stand for their branches (no second unit for them).
    assert u["goodwill_empire"]["branch_id"] == o["gw"]["id"]
    assert u["pw_venture"]["branch_id"] == o["pw"]["id"]
    companies = {x["branch_id"]: x for x in s["units"] if x["branch_id"] and not x["department_id"]}
    branches = (await client.get("/api/branches")).json()
    assert {b["id"] for b in branches} <= set(companies)
    assert companies[o["gw"]["id"]]["key"] == "goodwill_empire"
    # Every department of every company has a unit, under its company's unit when made here.
    by_dept = {x["department_id"]: x for x in s["units"] if x["department_id"]}
    for b in branches:
        for d in b["departments"]:
            assert d["id"] in by_dept, d["name"]
            made = by_dept[d["id"]]
            if made["key"].startswith("office_dept_"):
                assert made["parent_id"] == companies[b["id"]]["id"]
                assert made["kind"] == "department" and made["branch_id"] == b["id"]
    # PWVSB's seeded department links stay (Finance is the seed's own unit).
    assert by_dept[o["pw_depts"]["Finance"]]["key"] == "finance"

    # The owner's own work: a custom region with a role and a person in it.
    r = await client.post(
        "/api/org/structure/units",
        json={"name": "Zone Sabah East", "parent_id": u["region_sabah"]["id"], "kind": "region"},
        headers=jh(client),
    )
    zone = r.json()
    r = await client.post(
        "/api/org/structure/positions",
        json={"title": "Operations Manager", "unit_id": zone["id"]},
        headers=jh(client),
    )
    om = r.json()
    ali = (await member(client, "ali@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    await client.put(
        f"/api/members/{ali['user_id']}/position",
        json={"position_id": om["id"]},
        headers=jh(client),
    )
    n = await unit_count(o["ws"])
    again = await read(client)
    assert len(again["units"]) == n  # nothing new on a second read
    z = next(x for x in again["units"] if x["id"] == zone["id"])
    assert z == {**zone, "sort": z["sort"]} and z["parent_id"] == u["region_sabah"]["id"]
    assert again["member"][ali["user_id"]]["position_id"] == om["id"]

    # A new company: its unit under Group companies, its departments under it.
    nb = (
        await client.post("/api/branches", json={"name": "Jaya Guards Sdn Bhd"}, headers=jh(client))
    ).json()
    s3 = await read(client)
    co = next(x for x in s3["units"] if x["branch_id"] == nb["id"] and not x["department_id"])
    assert co["key"] == f"office_co_{nb['id']}" and co["kind"] == "company"
    assert co["parent_id"] == u["group_companies"]["id"] and not co["custom"]
    kids = {x["department_id"] for x in s3["units"] if x["parent_id"] == co["id"]}
    assert kids == {d["id"] for d in nb["departments"]}
    assert len(s3["units"]) == n + 1 + len(nb["departments"])

    # A company unit the owner made by hand (no link yet) is linked, not doubled.
    r = await client.post(
        "/api/org/structure/units",
        json={"name": "Acme Patrol", "parent_id": u["group_companies"]["id"], "kind": "company"},
        headers=jh(client),
    )
    acme_unit = r.json()
    acme = (
        await client.post("/api/branches", json={"name": "Acme Patrol"}, headers=jh(client))
    ).json()
    s4 = await read(client)
    linked = next(x for x in s4["units"] if x["id"] == acme_unit["id"])
    assert linked["branch_id"] == acme["id"] and linked["name"] == "Acme Patrol"
    assert not any(x["key"] == f"office_co_{acme['id']}" for x in s4["units"])
    # The owner's button runs it too and finds nothing more to make.
    r = await client.post("/api/org/structure/seed", json={}, headers=jh(client))
    assert r.status_code == 200 and r.json()["units"] == 0
    assert len((await read(client))["units"]) == len(s4["units"])


async def test_sub_department_and_copied_role(client):
    o = await group(client)
    s = await read(client)
    ops = s["unit"]["dept_operations"]
    r = await client.post(
        "/api/org/structure/units",
        json={"name": "Arms Control Desk", "parent_id": ops["id"], "kind": "department"},
        headers=jh(client),
    )
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["parent_id"] == ops["id"] and sub["kind"] == "department"
    src = s["pos"]["chairman"]
    r = await client.post(
        "/api/org/structure/positions",
        json={
            "title": src["title"],
            "title_ms": src["title_ms"],
            "unit_id": sub["id"],
            "default_role": "staff",
            "aliases": [*src["aliases"], "  ", src["aliases"][0]],
        },  # fmt: skip
        headers=jh(client),
    )
    assert r.status_code == 201, r.text
    copy = r.json()
    assert copy["unit_id"] == sub["id"] and copy["custom"]
    assert copy["aliases"] == src["aliases"] and copy["title_ms"] == src["title_ms"]
    # People into the new sub-department's role at once.
    a = (await member(client, "ali@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    r = await client.post(
        "/api/org/structure/assign",
        json={"user_ids": [a["user_id"]], "position_id": copy["id"]},
        headers=jh(client),
    )
    assert r.json()["done"] == 1


async def test_reports_to_in_the_read(client):
    o = await group(client)
    boss = (await member(client, "boss@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    a = (await member(client, "ali@example.com", "staff", branch_id=o["gw"]["id"]))["member"]
    r = await client.patch(
        f"/api/members/{a['user_id']}",
        json={"reports_to_user_id": boss["user_id"]},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    m = (await read(client))["member"]
    assert m[a["user_id"]]["reports_to_user_id"] == boss["user_id"]
    assert m[boss["user_id"]]["reports_to_user_id"] is None


async def test_work_groups(client):
    o = await group(client)
    s = await read(client)
    unit = s["unit"]["region_sabah"]["id"]
    other_unit = s["unit"]["region_perak"]["id"]
    ids = {}
    for name in ("mgr", "exe", "ana", "ben"):
        ids[name] = (await member(client, f"{name}@example.com", "staff", branch_id=o["gw"]["id"]))[
            "member"
        ]["user_id"]
    # The manager works with the executive; the other two work with each other.
    r = await client.post(
        "/api/org/structure/groups",
        json={"unit_id": unit, "member_ids": [ids["exe"]], "lead_user_id": ids["mgr"]},
        headers=jh(client),
    )
    assert r.status_code == 201, r.text
    g1 = r.json()
    assert g1["member_ids"] == [ids["exe"]] and g1["lead_user_id"] == ids["mgr"]
    r = await client.post(
        "/api/org/structure/groups",
        json={
            "unit_id": unit,
            "member_ids": [ids["ana"], ids["ben"], ids["ana"]],
            "name": " Pair ",
        },
        headers=jh(client),
    )
    g2 = r.json()
    assert g2["member_ids"] == [ids["ana"], ids["ben"]] and g2["name"] == "Pair"
    got = {g["id"]: g for g in (await read(client))["groups"]}
    assert set(got) == {g1["id"], g2["id"]}

    # One group per member per unit: refused, or moved when asked.
    r = await client.post(
        "/api/org/structure/groups",
        json={"unit_id": unit, "member_ids": [ids["ben"], ids["exe"]]},
        headers=jh(client),
    )
    assert r.status_code == 409 and r.json()["code"] == "group_member_taken"
    r = await client.patch(
        f"/api/org/structure/groups/{g2['id']}",
        json={"member_ids": [ids["ana"], ids["ben"], ids["exe"]], "move": True},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    got = {g["id"]: g for g in (await read(client))["groups"]}
    assert g1["id"] not in got  # its only person moved: it went
    assert got[g2["id"]]["member_ids"] == [ids["ana"], ids["ben"], ids["exe"]]
    # In another unit the same person may be in a group again.
    r = await client.post(
        "/api/org/structure/groups",
        json={"unit_id": other_unit, "member_ids": [ids["ana"]]},
        headers=jh(client),
    )
    assert r.status_code == 201
    # The lead is never one of the group's own people; nobody unknown.
    r = await client.patch(
        f"/api/org/structure/groups/{g2['id']}",
        json={"lead_user_id": ids["ana"]},
        headers=jh(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "group_lead_inside"
    r = await client.patch(
        f"/api/org/structure/groups/{g2['id']}",
        json={"member_ids": ["us_nobody"]},
        headers=jh(client),
    )
    assert r.status_code == 404
    r = await client.patch(
        f"/api/org/structure/groups/{g2['id']}",
        json={"lead_user_id": ids["mgr"], "name": "Field team"},
        headers=jh(client),
    )
    assert r.json()["lead_user_id"] == ids["mgr"] and r.json()["name"] == "Field team"

    # Only editors change groups; a member sees only the people in their own scope.
    staff = await as_role(client, "sam@example.com", "staff", branch_id=o["gw"]["id"])
    r = await staff.post(
        "/api/org/structure/groups",
        json={"unit_id": unit, "member_ids": [ids["mgr"]]},
        headers=jh(staff),
    )
    assert r.status_code == 403
    r = await staff.delete(f"/api/org/structure/groups/{g2['id']}", headers=jh(staff))
    assert r.status_code == 403
    assert (await read(staff))["groups"] == []
    r = await client.post(
        "/api/org/structure/groups",
        json={"unit_id": "ou_nothing", "member_ids": [ids["mgr"]]},
        headers=jh(client),
    )
    assert r.status_code == 404

    r = await client.delete(f"/api/org/structure/groups/{g2['id']}", headers=jh(client))
    assert r.status_code == 204
    async with SessionLocal() as db:
        left = (await db.scalars(select(OrgWorkGroup.unit_id))).all()
    assert left == [other_unit]
    done = await actions(o["ws"])
    for a in ("org.group_added", "org.group_changed", "org.group_removed"):
        assert a in done, a
