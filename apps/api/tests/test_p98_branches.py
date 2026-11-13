"""P98: a member in several branches at once (membership_branches, migration 0061).

A branch manager of two branches sees and manages both and never a third; members lists,
detail, add, update, bulk change and the Excel import carry every branch; who reports to a
manager is set many at once; the owner's Roles and access matrix saves, resets and audits.
"""

import asyncio
import os

import asyncpg
from alembic import command
from alembic.config import Config
from sqlalchemy import select

from agentic.api.scope import Scope
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership

from .conftest import PG, TEST_DB, csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_member_import import by_email, preview, xlsx
from .test_office_roles import as_role, member


async def three_branches(client):
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    b3 = (
        await client.post("/api/branches", json={"name": "Cahaya Bhd"}, headers=csrf(client))
    ).json()
    o["b2"], o["b3"] = b2, b3
    await new_agent(client, o, "Alpha Agent", "Finance")
    for b, name in ((b2, "Beta Agent"), (b3, "Gamma Agent")):
        r = await client.post(
            "/api/agents",
            json={
                "branch_id": b["id"],
                "department_id": b["departments"][0]["id"],
                "name": name,
                "role": "Helper",
            },
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    return o


def names(rows):
    return sorted(a["name"] for a in rows)


def branch_ids(row):
    return [b["id"] for b in row["branches"]]


async def test_a_branch_manager_of_two_branches_sees_both_and_never_a_third(client, llm, temporal):
    o = await three_branches(client)
    a, b, c = o["branch"]["id"], o["b2"]["id"], o["b3"]["id"]
    made = await member(client, "bm2@example.com", "branch_manager", branch_id=a, branch_ids=[a, b])
    assert made["member"]["branch_id"] == a and branch_ids(made["member"]) == [a, b]
    staff_b = (await member(client, "sb@example.com", "staff", branch_ids=[b]))["member"]
    staff_c = (await member(client, "sc@example.com", "staff", branch_ids=[c]))["member"]
    assert staff_b["branch_id"] == b
    from .test_office_roles import signed_in

    bm = await signed_in("bm2@example.com", made["temp_password"])
    try:
        assert names((await bm.get("/api/agents")).json()) == ["Alpha Agent", "Beta Agent"]
        assert sorted(x["id"] for x in (await bm.get("/api/branches")).json()) == sorted([a, b])
        me = (await bm.get("/api/auth/me")).json()
        assert me["scope"]["kind"] == "branch" and [x["id"] for x in me["scope"]["branches"]] == [
            a,
            b,
        ]
        seen = {m["email"] for m in (await bm.get("/api/members")).json()}
        assert "sb@example.com" in seen and "sc@example.com" not in seen
        page = (await bm.get("/api/members", params={"page": 1, "company": b})).json()
        assert sorted(m["email"] for m in page["items"]) == ["bm2@example.com", "sb@example.com"]
        # Members outside their branches are "not here".
        r = await bm.patch(
            f"/api/members/{staff_c['user_id']}",
            json={"role": "staff", "branch_ids": [a]},
            headers=csrf(bm),
        )
        assert r.status_code == 404
        # They add people to either of their branches, never to the third.
        r = await bm.post(
            "/api/members",
            json={"email": "nb@example.com", "name": "Nb", "role": "staff", "branch_ids": [b]},
            headers=csrf(bm),
        )
        assert r.status_code == 201, r.text
        r = await bm.post(
            "/api/members",
            json={"email": "nc@example.com", "name": "Nc", "role": "staff", "branch_ids": [b, c]},
            headers=csrf(bm),
        )
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        # Back to one branch: the second one is gone from their next request on.
        r = await client.patch(
            f"/api/members/{made['member']['user_id']}",
            json={"role": "branch_manager", "branch_ids": [a]},
            headers=csrf(client),
        )
        assert r.status_code == 200 and branch_ids(r.json()) == [a]
        assert names((await bm.get("/api/agents")).json()) == ["Alpha Agent"]
        async with SessionLocal() as db:
            m = await db.scalar(
                select(Membership).where(Membership.user_id == made["member"]["user_id"])
            )
            assert m is not None and m.branch_ids == [a] and len(m.branch_rows) == 1
    finally:
        await bm.aclose()


async def test_a_manager_never_drops_a_branch_outside_their_own(client, llm, temporal):
    o = await three_branches(client)
    a, b, c = o["branch"]["id"], o["b2"]["id"], o["b3"]["id"]
    bm = await as_role(client, "bm3@example.com", "branch_manager", branch_ids=[a, b])
    both = (await member(client, "both@example.com", "staff", branch_ids=[b, c]))["member"]
    try:
        r = await bm.patch(
            f"/api/members/{both['user_id']}",
            json={"role": "staff", "branch_ids": [a]},
            headers=csrf(bm),
        )
        assert r.status_code == 200, r.text
        assert branch_ids(r.json()) == [a, c]  # B taken away, C (not theirs) kept
    finally:
        await bm.aclose()


async def test_scope_reads_every_branch_of_the_membership():
    sc = Scope.of("branch_manager", "u1", "br_a", None, branch_ids=["br_a", "br_b"])
    assert sc.in_branch("br_b") and not sc.in_branch("br_c") and not sc.in_branch(None)
    assert str(sc.label) == "your branches"
    staff = Scope.of("staff", "u2", "br_a", None, branch_ids=["br_b"])
    assert staff.kind == "own" and staff.branch_ids == {"br_a", "br_b"}
    assert Scope.of("admin", "u3", "br_a", None, branch_ids=["br_b"]).branch_ids == frozenset()


async def test_bulk_change_and_detail_carry_every_branch(client, llm, temporal):
    o = await three_branches(client)
    a, b, c = o["branch"]["id"], o["b2"]["id"], o["b3"]["id"]
    ids = [
        (await member(client, f"p{i}@example.com", "staff", branch_id=a))["member"]["user_id"]
        for i in range(3)
    ]
    r = await client.post(
        "/api/members/bulk",
        json={"user_ids": ids, "action": "access", "role": "staff", "branch_ids": [b, c]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["done"] == 3, r.text
    rows = {m["user_id"]: m for m in (await client.get("/api/members")).json()}
    assert all(branch_ids(rows[i]) == [b, c] and rows[i]["branch_id"] == b for i in ids)
    # A department fixes the home branch (its own), the others stay.
    fin_c = o["b3"]["departments"][0]["id"]
    r = await client.patch(
        f"/api/members/{ids[0]}",
        json={"role": "hod", "department_id": fin_c, "branch_ids": [b, c]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["branch_id"] == c
    assert branch_ids(r.json()) == [c, b]
    # Workspace roles sit nowhere: no branches left.
    r = await client.patch(
        f"/api/members/{ids[1]}",
        json={"role": "viewer", "branch_ids": [b]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["branches"] == [] and r.json()["branch_id"] is None
    # A company filter finds people by any of their branches.
    page = (await client.get("/api/members", params={"page": 1, "company": c})).json()
    assert {m["user_id"] for m in page["items"]} == {ids[0], ids[2]}
    audits = []
    async with SessionLocal() as db:
        audits = list(
            (
                await db.scalars(select(AuditLog).where(AuditLog.action == "member.role_changed"))
            ).all()
        )
    assert any((x.after or {}).get("branch_ids") == [b, c] for x in audits)


async def test_who_a_manager_manages_is_set_many_at_once(client, llm, temporal):
    o = await three_branches(client)
    a = o["branch"]["id"]
    boss = (await member(client, "boss@example.com", "hod", department_id=o["depts"]["Finance"]))[
        "member"
    ]
    ids = [
        (await member(client, f"t{i}@example.com", "staff", branch_id=a))["member"]["user_id"]
        for i in range(3)
    ]
    r = await client.put(
        f"/api/members/{boss['user_id']}/team", json={"user_ids": ids}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["done"] == 3, r.text
    team = (await client.get(f"/api/members/{boss['user_id']}/team")).json()
    assert sorted(m["user_id"] for m in team) == sorted(ids)
    r = await client.put(
        f"/api/members/{boss['user_id']}/team", json={"user_ids": ids[:1]}, headers=csrf(client)
    )
    assert r.status_code == 200
    rows = {m["user_id"]: m for m in (await client.get("/api/members")).json()}
    assert rows[ids[0]]["reports_to_user_id"] == boss["user_id"]
    assert rows[ids[1]]["reports_to_user_id"] is None and rows[ids[2]]["reports_to_user_id"] is None
    assert rows[boss["user_id"]]["manages"] == 1


async def test_the_import_reads_several_companies_in_one_cell(client, llm, temporal):
    o = await three_branches(client)
    a, b = o["branch"]["id"], o["b2"]["id"]
    data = xlsx(
        [
            ["Name", "Email", "Role", "Company"],
            ["Ana Example", "ana@example.com", "Staff", "Maju Sdn Bhd; Jaya Bhd"],
            ["Ben Example", "ben@example.com", "Staff", "Maju Sdn Bhd, Jaya Bhd"],
            ["Cik Example", "cik@example.com", "Staff", "Maju Sdn Bhd; Nowhere Bhd"],
        ]
    )
    r = await preview(client, data)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = by_email(body["rows"])
    assert rows["ana@example.com"]["branch_ids"] == [a, b]
    assert rows["ana@example.com"]["branch_names"] == ["Maju Sdn Bhd", "Jaya Bhd"]
    assert rows["ben@example.com"]["branch_ids"] == [a, b]
    assert rows["cik@example.com"]["status"] == "error"
    assert body["missing_companies"] == ["Nowhere Bhd"]
    sent = [rows["ana@example.com"]]
    r = await client.post("/api/members/import", json={"rows": sent}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["added"] == 1, r.text
    assert r.json()["results"][0]["branch_names"] == ["Maju Sdn Bhd", "Jaya Bhd"]
    listed = {m["email"]: m for m in (await client.get("/api/members")).json()}
    assert branch_ids(listed["ana@example.com"]) == [a, b]


async def test_the_roles_matrix_saves_resets_and_is_owner_only(client, llm, temporal):
    await three_branches(client)
    admin = await as_role(client, "adm@example.com", "admin")
    try:
        r = await client.put(
            "/api/org/role-access",
            json={"roles": {"hr": {"grant": ["engine.view"], "revoke": ["assistants.use"]}}},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        hr = next(x for x in r.json()["roles"] if x["role"] == "hr")
        assert "engine.view" in hr["effective"] and "assistants.use" not in hr["effective"]
        owner = next(x for x in r.json()["roles"] if x["role"] == "owner")
        assert owner["editable"] is False
        r = await client.put(
            "/api/org/role-access",
            json={"roles": {"owner": {"grant": [], "revoke": ["read"]}}},
            headers=csrf(client),
        )
        assert r.status_code == 422 and r.json()["code"] == "owner_locked"
        # An admin neither reads nor changes it.
        assert (await admin.get("/api/org/role-access")).status_code == 403
        r = await admin.put("/api/org/role-access", json={"roles": {}}, headers=csrf(admin))
        assert r.status_code == 403
        # Back to the defaults (one role reset = that role left out).
        r = await client.put("/api/org/role-access", json={"roles": {}}, headers=csrf(client))
        hr = next(x for x in r.json()["roles"] if x["role"] == "hr")
        assert hr["grant"] == [] and hr["revoke"] == [] and hr["effective"] == hr["default"]
        async with SessionLocal() as db:
            rows = list(
                (
                    await db.scalars(
                        select(AuditLog)
                        .where(AuditLog.action == "org.role_access_changed")
                        .order_by(AuditLog.id)
                    )
                ).all()
            )
        assert len(rows) == 2
        assert rows[0].after == {
            "roles": {"hr": {"grant": ["engine.view"], "revoke": ["assistants.use"]}}
        }
        assert rows[1].after == {"roles": {}} and "hr: default" in (rows[1].note or "")
    finally:
        await admin.aclose()


# ---------------------------------------------------------------- the migration


def _alembic(url: str, action: str, rev: str) -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = url
    getattr(command, action)(cfg, rev)


async def test_migration_0061_goes_up_down_and_up_again():
    name = f"{TEST_DB}_p98mig"
    admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {name}")
    finally:
        await admin.close()
    url = f"postgresql+asyncpg://{PG}/{name}"
    table = "SELECT to_regclass('public.membership_branches') IS NOT NULL"
    rows = "SELECT workspace_id, user_id, branch_id FROM membership_branches ORDER BY user_id"
    try:
        await asyncio.to_thread(_alembic, url, "upgrade", "0060")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            await conn.execute(
                "INSERT INTO workspaces (id, name, slug, timezone, settings, created_at, "
                "updated_at) VALUES ('ws_m', 'W', 'w', 'Asia/Kuala_Lumpur', '{}', now(), now())"
            )
            for uid in ("us_1", "us_2"):
                await conn.execute(
                    "INSERT INTO users (id, email, name, password_hash, is_active, "
                    "must_change_password, created_at, updated_at) VALUES "
                    "($1, $2, 'X', 'x', true, false, now(), now())",
                    uid,
                    f"{uid}@example.com",
                )
            await conn.execute(
                "INSERT INTO branches (id, workspace_id, name, slug, color, isolated, created_at, "
                "updated_at) VALUES ('br_1', 'ws_m', 'B', 'b', '#000000', false, now(), now())"
            )
            await conn.execute(
                "INSERT INTO memberships (workspace_id, user_id, role, branch_id, created_at, "
                "updated_at) VALUES ('ws_m', 'us_1', 'staff', 'br_1', now(), now()), "
                "('ws_m', 'us_2', 'admin', NULL, now(), now())"
            )
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert await conn.fetchval(table)
            got = [tuple(r) for r in await conn.fetch(rows)]
            assert got == [("ws_m", "us_1", "br_1")]  # the home branch is copied in
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "downgrade", "0060")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert not await conn.fetchval(table)
            home = "SELECT branch_id FROM memberships WHERE user_id = 'us_1'"
            assert await conn.fetchval(home) == "br_1"  # the home branch stays
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert [tuple(r) for r in await conn.fetch(rows)] == [("ws_m", "us_1", "br_1")]
        finally:
            await conn.close()
    finally:
        admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        finally:
            await admin.close()
