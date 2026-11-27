"""P143b: the Library's units (Unit HR, Unit Audit, Unit Kewangan) instead of the long list of
companies: the central departments of the group employer (PWVSB), found by slug or name, opened
by exactly the people who read a department's files today."""

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.models import Branch, Department, DocFile

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

PWVSB = "PW Venture Sdn Bhd (PWVSB)"


def jh(c) -> dict[str, str]:
    return {**csrf(c), "content-type": "application/json"}


@pytest.fixture
def no_sorting(monkeypatch):
    """Uploads stay as they were sent (the worker's sorting is not under test here)."""

    async def start_intake(batch_id):
        return None

    monkeypatch.setattr(dispatch, "start_intake", start_intake)


async def add_dept(branch_id: str, name: str, slug: str) -> str:
    async with SessionLocal() as db:
        b = await db.scalar(select(Branch.workspace_id).where(Branch.id == branch_id))
        d = Department(workspace_id=b, branch_id=branch_id, name=name, slug=slug, position=50)
        db.add(d)
        await db.commit()
        return d.id


async def group(client) -> dict:
    """Maju (a subsidiary with its own Finance) and PWVSB with the three central units, made
    the way the Prima mirror makes them (HR with the mirror's short slug)."""
    o = await office(client)
    r = await client.post("/api/branches", json={"name": PWVSB}, headers=jh(client))
    assert r.status_code in (200, 201), r.text
    pw = r.json()
    o["pw"] = pw
    o["pw_depts"] = {d["name"]: d["id"] for d in pw["departments"]}
    o["hr"] = await add_dept(pw["id"], "Human Resources", "hr")
    o["audit"] = await add_dept(
        pw["id"],
        "ACT (Audit, Compliance and Transformation)",
        "act-audit-compliance-and-transformation",
    )
    o["finance"] = o["pw_depts"]["Finance"]
    return o


async def units_of(c) -> dict[str, dict]:
    r = await c.get("/api/library/units")
    assert r.status_code == 200, r.text
    return {u["key"]: u for u in r.json()["units"]}


async def send(c, branch_id: str, department_id: str, name: str, folder: str = ""):
    params = {"name": name, "branch_id": branch_id, "department_id": department_id}
    if folder:
        params["folder"] = folder
    return await c.post(
        "/api/intake",
        params=params,
        content=b"Minit mesyuarat unit.\n" * 20,
        headers={
            **csrf(c),
            "content-type": "application/octet-stream",
            "x-file-type": "text/plain",
        },
    )


async def test_who_sees_which_unit(client):
    o = await group(client)
    pw = o["pw"]["id"]

    # The owner: all three, in order, from PWVSB (not Maju's Finance), with the owner's labels.
    mine = await units_of(client)
    assert list(mine) == ["hr", "audit", "finance"]
    assert [u["label"] for u in mine.values()] == ["Unit HR", "Unit Audit", "Unit Kewangan"]
    assert {u["branch_id"] for u in mine.values()} == {pw}
    assert mine["hr"]["department_id"] == o["hr"]
    assert mine["finance"]["department_id"] == o["finance"] != o["depts"]["Finance"]
    assert all(u["can_upload"] for u in mine.values())

    hr_staff = await as_role(
        client, "hr1@example.com", "staff", branch_id=pw, department_id=o["hr"]
    )
    assert list(await units_of(hr_staff)) == ["hr"]
    assert (await hr_staff.get("/api/library/units/hr")).status_code == 200

    hr_head = await as_role(client, "hrh@example.com", "hod", branch_id=pw, department_id=o["hr"])
    assert list(await units_of(hr_head)) == ["hr"]

    manager = await as_role(client, "bm@example.com", "branch_manager", branch_id=pw)
    assert list(await units_of(manager)) == ["hr", "audit", "finance"]

    # Staff of another department of PWVSB, and Maju's finance staff: refused.
    ops = await as_role(
        client, "ops@example.com", "staff", branch_id=pw, department_id=o["pw_depts"]["Operations"]
    )
    assert await units_of(ops) == {}
    r = await ops.get("/api/library/units/hr")
    assert r.status_code == 403 and r.json()["code"] == "out_of_scope"
    maju = await as_role(client, "fin@example.com", "staff", department_id=o["depts"]["Finance"])
    assert await units_of(maju) == {}
    assert (await maju.get("/api/library/units/finance")).status_code == 403

    assert (await client.get("/api/library/units/nope")).status_code == 404


async def test_upload_into_a_unit_sets_its_department(client, no_sorting):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]

    hr_staff = await as_role(client, "hr1@example.com", "staff", branch_id=pw, department_id=hr)
    r = await send(hr_staff, pw, hr, "Minit HR.txt", folder="Mesyuarat")
    assert r.status_code == 201, r.text
    r = await send(client, pw, hr, "Polisi cuti.txt")
    assert r.status_code == 201, r.text
    async with SessionLocal() as db:
        files = (await db.scalars(select(DocFile).where(DocFile.branch_id == pw))).all()
    assert {f.name: (f.department_id, f.folder) for f in files} == {
        "Minit HR.txt": (hr, "Mesyuarat"),
        "Polisi cuti.txt": (hr, ""),
    }

    # The unit's folder space: its folders, its files and its count.
    tree = (
        await client.get("/api/files/tree", params={"branch_id": pw, "department_id": hr})
    ).json()
    assert [f["path"] for f in tree["folders"]] == ["Mesyuarat"] and tree["total_files"] == 2
    other = await client.get(
        "/api/files/tree", params={"branch_id": pw, "department_id": o["audit"]}
    )
    assert other.json()["total_files"] == 0
    listed = await client.get(
        "/api/files", params={"branch_id": pw, "department_id": hr, "folder": "Mesyuarat"}
    )
    assert [f["name"] for f in listed.json()] == ["Minit HR.txt"]
    assert (await units_of(client))["hr"]["files"] == 2
    assert (await units_of(hr_staff))["hr"]["files"] == 1  # their own; nothing wider

    # Staff of another department cannot file into Unit HR (nor make its folders).
    ops = await as_role(
        client, "ops@example.com", "staff", branch_id=pw, department_id=o["pw_depts"]["Operations"]
    )
    r = await send(ops, pw, hr, "Bukan saya.txt")
    assert r.status_code == 403 and r.json()["code"] == "out_of_scope"
    r = await ops.post(
        "/api/files/folders",
        json={"path": "Rahsia", "branch_id": pw, "department_id": hr},
        headers=jh(ops),
    )
    assert r.status_code == 403
    assert (await units_of(ops)) == {}


async def test_unit_folders_stay_in_their_unit(client):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]
    r = await client.post(
        "/api/files/folders",
        json={"path": "Polisi/2026", "branch_id": pw, "department_id": hr},
        headers=jh(client),
    )
    assert r.status_code == 201, r.text

    def paths(t):
        return [f["path"] for f in t.json()["folders"]]

    q = {"branch_id": pw}
    assert paths(await client.get("/api/files/tree", params={**q, "department_id": hr})) == [
        "Polisi",
        "Polisi/2026",
    ]
    assert (
        paths(await client.get("/api/files/tree", params={**q, "department_id": o["audit"]})) == []
    )
    # The company's own folders show every unit's too (as its files do).
    assert "Polisi/2026" in paths(await client.get("/api/files/tree", params=q))

    r = await client.post(
        "/api/files/folders/rename",
        json={"path": "Polisi", "to": "Dasar", "branch_id": pw, "department_id": hr},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    assert paths(await client.get("/api/files/tree", params={**q, "department_id": hr})) == [
        "Dasar",
        "Dasar/2026",
    ]
    r = await client.post(
        "/api/files/folders/delete",
        json={"path": "Dasar", "branch_id": pw, "department_id": hr},
        headers=jh(client),
    )
    assert r.status_code == 204
    assert paths(await client.get("/api/files/tree", params={**q, "department_id": hr})) == []

    # A department of another company is refused.
    r = await client.post(
        "/api/files/folders",
        json={"path": "X", "branch_id": pw, "department_id": o["depts"]["Finance"]},
        headers=jh(client),
    )
    assert r.status_code == 400


async def test_missing_units_are_hidden_and_renamed_ones_found(client):
    o = await office(client)
    # Maju has Finance only: one unit, from the company that holds it.
    found = await units_of(client)
    assert list(found) == ["finance"] and found["finance"]["department_id"] == o["depts"]["Finance"]
    assert (await client.get("/api/library/units/hr")).status_code == 404

    # HR renamed in Prima's chart keeps the mirror's slug: still Unit HR.
    hr = await add_dept(o["branch"]["id"], "People and Culture", "hr")
    found = await units_of(client)
    assert list(found) == ["hr", "finance"] and found["hr"]["department_id"] == hr
    assert found["hr"]["department_name"] == "People and Culture"


async def test_no_units_at_all(client):
    o = await office(client)
    async with SessionLocal() as db:
        d = await db.get(Department, o["depts"]["Finance"])
        d.name, d.slug = "Money", "money"
        await db.commit()
    assert await units_of(client) == {}
