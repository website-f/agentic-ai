"""P144: per-member Library grants (the owner, 27 Nov 2026: "Give the units access to Azizan B.
Abdul Rahman ... for each user, I (admin) can edit the member and have one section to give
Library access: which module or library I can give, like the units, or all companies").

Extra access on top of a person's role and place, never less: the units and companies given
open their Library files (as their own people read them: restricted ones not for staff, never
someone's own desk files) to the person and their own agents, and the person may file into
them. Only who may set Library access gives it (never for themselves), and only what they open."""

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.documents import service
from agentic.knowledge import search as library
from agentic.models import DocFile, Membership

from .test_agents import llm, temporal  # noqa: F401
from .test_office_roles import as_role, member, signed_in
from .test_p143_library_units import add_dept, group, jh, send, units_of


@pytest.fixture
def no_sorting(monkeypatch):
    async def start_intake(batch_id):
        return None

    monkeypatch.setattr(dispatch, "start_intake", start_intake)


async def setting(o: dict, client) -> dict:
    """Goodwill Empire (a school operator) with Pengurusan Sekolah, its staff member Azizan, and
    Library files across the group."""
    r = await client.post(
        "/api/branches", json={"name": "GOODWILL EMPIRE SDN BHD"}, headers=jh(client)
    )
    assert r.status_code in (200, 201), r.text
    gw = r.json()["id"]
    o["gw"] = gw
    o["school"] = await add_dept(gw, "Pengurusan Sekolah", "pengurusan-sekolah")
    m = await member(client, "azizan@example.com", "staff", department_id=o["school"])
    o["az_id"] = m["member"]["user_id"]
    o["az"] = await signed_in("azizan@example.com", m["temp_password"])
    ws = (await client.get("/api/auth/me")).json()["workspace"]["id"]
    o["ws"] = ws
    pw, maju = o["pw"]["id"], o["branch"]["id"]
    files = {
        "hr-open": (pw, o["hr"], True, False, ""),
        "hr-secret": (pw, o["hr"], True, True, ""),
        "audit-open": (pw, o["audit"], True, False, ""),
        "pw-ops": (pw, o["pw_depts"]["Operations"], True, False, ""),
        "maju-open": (maju, None, True, False, ""),
        "maju-secret": (maju, o["depts"]["Finance"], True, True, ""),
        "maju-desk": (maju, None, False, False, "My workspace"),
    }
    ids = {}
    async with SessionLocal() as db:
        owner = await db.scalar(
            select(Membership.user_id).where(
                Membership.workspace_id == ws, Membership.role == "owner"
            )
        )
        for name, (bid, did, lib, restricted, folder) in files.items():
            f = DocFile(
                workspace_id=ws,
                branch_id=bid,
                department_id=did,
                name=f"{name}.txt",
                mime="text/plain",
                status="ready",
                created_by="user:someone-else",
                library=lib,
                restricted=restricted,
                folder=folder,
                owner_user_id=owner if folder else None,
            )
            db.add(f)
            await db.flush()
            ids[name] = f.id
        await db.commit()
    o["files"] = ids
    o["owner_id"] = owner
    return o


async def names_seen(c, **params) -> set[str]:
    r = await c.get("/api/files", params=params)
    assert r.status_code == 200, r.text
    return {f["name"].removesuffix(".txt") for f in r.json()}


async def give(client, user_id: str, grants) -> dict:
    r = await client.put(
        f"/api/members/{user_id}/library", json={"grants": grants}, headers=jh(client)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def agent_reads(o: dict) -> set[str]:
    """What Azizan's own agent reads (documents.service.agent_files)."""
    agent = SimpleNamespace(
        id="ag_azizan",
        workspace_id=o["ws"],
        branch_id=o["gw"],
        department_id=o["school"],
        owner_user_id=o["az_id"],
        clone_of=None,
        is_twin=True,
    )
    async with SessionLocal() as db:
        rows = await db.scalars(select(DocFile.name).where(service.agent_files(agent)))
        names = {n.removesuffix(".txt") for n in rows.all()}
        # Its library search reads the same grant (in SQL, from its owner's membership).
        await library.search(db, library.for_agent(agent), "minit mesyuarat")
        return names


async def test_units_given_to_a_staff_member_of_another_company(client, no_sorting):
    o = await setting(await group(client), client)
    az, pw, hr = o["az"], o["pw"]["id"], o["hr"]

    assert await units_of(az) == {}
    assert await names_seen(az, branch_id=pw) == set()
    assert await agent_reads(o) == set()

    out = await give(client, o["az_id"], {"units": "all"})
    assert out["library_grants"] == {"units": "all", "companies": [], "departments": []}

    # The three units, at once (no new sign-in), with their files: never a restricted one
    # (staff), never another department of PWVSB.
    assert list(await units_of(az)) == ["hr", "audit", "finance"]
    assert (await az.get("/api/library/units/hr")).status_code == 200
    assert await names_seen(az, branch_id=pw, department_id=hr) == {"hr-open"}
    assert await names_seen(az, branch_id=pw) == {"hr-open", "audit-open"}
    assert (await az.get(f"/api/files/{o['files']['hr-open']}")).status_code == 200
    assert (await az.get(f"/api/files/{o['files']['pw-ops']}")).status_code == 404
    assert (await az.get(f"/api/files/{o['files']['hr-secret']}")).status_code == 404
    assert await agent_reads(o) == {"hr-open", "audit-open"}
    for path in ("/api/library/search", "/api/search"):
        r = await az.get(path, params={"q": "minit"})
        assert r.status_code == 200, (path, r.text)

    # They file into the units (and make their folders), not into another department.
    r = await send(az, pw, hr, "Minit Azizan.txt", folder="Mesyuarat")
    assert r.status_code == 201, r.text
    async with SessionLocal() as db:
        f = await db.scalar(select(DocFile).where(DocFile.name == "Minit Azizan.txt"))
        assert (f.branch_id, f.department_id, f.created_by) == (pw, hr, f"user:{o['az_id']}")
    r = await az.post(
        "/api/files/folders",
        json={"path": "Polisi", "branch_id": pw, "department_id": hr},
        headers=jh(az),
    )
    assert r.status_code == 201, r.text
    tree = (await az.get("/api/files/tree", params={"branch_id": pw, "department_id": hr})).json()
    assert {f["path"] for f in tree["folders"]} == {"Mesyuarat", "Polisi"}
    r = await send(az, pw, o["pw_depts"]["Operations"], "Bukan.txt")
    assert r.status_code == 403
    r = await send(az, o["branch"]["id"], o["depts"]["Finance"], "Bukan.txt")
    assert r.status_code == 403

    # Taking it back closes everything again (their own upload stays theirs).
    out = await give(client, o["az_id"], None)
    assert out["library_grants"] is None
    assert await units_of(az) == {}
    assert await names_seen(az, branch_id=pw) == {"Minit Azizan"}
    assert await agent_reads(o) == set()


async def test_every_company_given(client):
    o = await setting(await group(client), client)
    az, maju = o["az"], o["branch"]["id"]

    assert maju not in {b["id"] for b in (await az.get("/api/branches")).json()}
    await give(client, o["az_id"], {"companies": "all"})

    # Every company's shared files: never a restricted one, never someone's own desk file.
    assert await names_seen(az, branch_id=maju) == {"maju-open"}
    assert await names_seen(az, branch_id=o["pw"]["id"]) == {"hr-open", "audit-open", "pw-ops"}
    assert (await az.get(f"/api/files/{o['files']['maju-desk']}")).status_code == 404
    assert (await az.get(f"/api/files/{o['files']['maju-secret']}")).status_code == 404
    assert await agent_reads(o) == {"maju-open", "hr-open", "audit-open", "pw-ops"}
    # The companies show in their company list and switcher; the units stay theirs only if given.
    assert maju in {b["id"] for b in (await az.get("/api/branches")).json()}
    me = (await az.get("/api/auth/me")).json()
    assert maju in {b["id"] for b in me["scope"]["library_branches"]}
    assert await units_of(az) == {}
    lib = {s["name"] for s in (await az.get("/api/library")).json()["sources"]}
    assert {"maju-open.txt", "hr-open.txt"} <= lib and "maju-secret.txt" not in lib

    # Filing into a company given (no department) is theirs; its departments are not.
    r = await az.post(
        "/api/files/folders", json={"path": "Kongsi", "branch_id": maju}, headers=jh(az)
    )
    assert r.status_code == 201, r.text

    await give(client, o["az_id"], {"companies": []})
    assert await names_seen(az, branch_id=maju) == set()
    assert maju not in {b["id"] for b in (await az.get("/api/branches")).json()}


async def test_who_may_give(client):
    o = await setting(await group(client), client)
    gw = o["gw"]

    # Someone who does not manage them: refused.
    other = await as_role(
        client, "hod2@example.com", "hod", branch_id=gw, department_id=o["school"]
    )
    r = await other.put(
        f"/api/members/{o['az_id']}/library", json={"grants": {"units": "all"}}, headers=jh(other)
    )
    assert r.status_code == 403
    # Themselves: refused.
    r = await o["az"].put(
        f"/api/members/{o['az_id']}/library", json={"grants": {"units": "all"}}, headers=jh(o["az"])
    )
    assert r.status_code in (403, 404)
    r = await client.put(
        f"/api/members/{o['owner_id']}/library",
        json={"grants": {"companies": "all"}},
        headers=jh(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "self_change"

    # Their own manager gives only what they open themselves.
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=gw)
    bm_id = (await bm.get("/api/auth/me")).json()["user"]["id"]
    async with SessionLocal() as db:
        m = await db.get(Membership, (o["ws"], o["az_id"]))
        m.reports_to_user_id = bm_id
        await db.commit()
    for grants in ({"units": "all"}, {"companies": "all"}, {"companies": [o["branch"]["id"]]}):
        r = await bm.put(
            f"/api/members/{o['az_id']}/library", json={"grants": grants}, headers=jh(bm)
        )
        assert r.status_code == 403, (grants, r.text)
    r = await bm.put(
        f"/api/members/{o['az_id']}/library",
        json={"grants": {"departments": [o["school"]]}},
        headers=jh(bm),
    )
    assert r.status_code == 200, r.text

    # Bad values.
    for grants, code in (
        ({"units": ["nope"]}, 422),
        ({"companies": ["br_nope"]}, 400),
        ({"departments": ["dp_nope"]}, 400),
    ):
        r = await client.put(
            f"/api/members/{o['az_id']}/library", json={"grants": grants}, headers=jh(client)
        )
        assert r.status_code == code, (grants, r.text)


async def test_units_in_the_company_search(client):
    o = await setting(await group(client), client)
    az = o["az"]

    def labels(r) -> list[str]:
        assert r.status_code == 200, r.text
        return [p["label"].upper() for p in r.json()]  # P111: company names in capitals

    assert labels(await az.get("/api/library/places", params={"q": "HR"})) == []
    await give(client, o["az_id"], {"units": ["hr", "finance"]})
    hr = (await az.get("/api/library/places", params={"q": "hr"})).json()
    assert [(p["kind"], p["id"], p["label"].upper()) for p in hr] == [
        ("unit", "hr", "UNIT HR · PW VENTURE SDN BHD (PWVSB)")
    ]
    assert labels(await az.get("/api/library/places", params={"q": "kewangan"})) == [
        "UNIT KEWANGAN · PW VENTURE SDN BHD (PWVSB)"
    ]
    assert labels(await az.get("/api/library/places", params={"q": "audit"})) == []
    # Their own company, found by its department's name too.
    assert labels(await az.get("/api/library/places", params={"q": "pengurusan sekolah"})) == [
        "GOODWILL EMPIRE SDN BHD"
    ]
    # The owner: every unit and company.
    every = (await client.get("/api/library/places")).json()
    assert [p["id"] for p in every if p["kind"] == "unit"] == ["hr", "audit", "finance"]
    assert {p["label"].upper() for p in every if p["kind"] == "company"} >= {
        "MAJU SDN BHD",
        "GOODWILL EMPIRE SDN BHD",
        "PW VENTURE SDN BHD (PWVSB)",
    }
    found = labels(await client.get("/api/library/places", params={"q": "audit"}))
    assert found[0] == "UNIT AUDIT · PW VENTURE SDN BHD (PWVSB)"
    assert "PW VENTURE SDN BHD (PWVSB)" in found  # by its department ACT (Audit, ...)
