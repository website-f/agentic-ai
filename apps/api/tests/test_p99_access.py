"""P99: what each member reaches (migration 0062). The office and Prima ("agentic", everyone by
default) or Prima only; and all of Prima their Prima role allows, or chosen Prima screens.

A Prima-only person signs in on the same page and reaches Prima; the office's API refuses the
rest. Chosen screens narrow every call the office signs for the person (their screens and their
AI); Prima's own role checks still apply. Owners, admins, management and HR set it, in their
scope, never for themselves or an owner, and never beyond what they have. Every change is audited.
"""

import asyncio

import asyncpg
from sqlalchemy import select

from agentic.core.access import prima_only_allows
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership
from agentic.prima import client as prima
from agentic.prima import modules
from agentic.prima.client import PrimaError

from .conftest import PG, TEST_DB, csrf
from .test_agents import office
from .test_office_roles import as_role, member, signed_in
from .test_p66_prima import _ids, _map_branch, _microsoft, prima_on  # noqa: F401
from .test_p98_branches import _alembic


async def _set(c, user_id: str, **body):
    return await c.put(f"/api/members/{user_id}/prima-access", json=body, headers=csrf(c))


# ---------------------------------------------------------------- the rules, without a server


def test_the_office_answers_a_prima_only_person_only_what_prima_needs():
    ok = [
        ("GET", "/api/auth/me"),
        ("POST", "/api/auth/logout"),
        ("POST", "/api/auth/change-password"),
        ("GET", "/api/prima/status"),
        ("GET", "/api/prima/api/items"),
        ("POST", "/api/prima/api/leave"),
        ("PUT", "/api/me/prefs"),
        ("POST", "/api/feedback"),
        ("GET", "/api/auth/2fa"),
        ("POST", "/api/auth/2fa/setup"),
    ]
    refused = [
        ("GET", "/api/tasks"),
        ("GET", "/api/desk"),
        ("GET", "/api/agents"),
        ("POST", "/api/chat"),
        ("GET", "/api/members"),
        ("GET", "/api/prima/people"),
        ("PUT", "/api/prima/companies"),
        ("GET", "/api/auth/2fa/members"),
        ("PUT", "/api/auth/2fa/policy"),
        ("GET", "/api/feedback"),
        ("DELETE", "/api/prima/api/items"),
        ("GET", "/api/me/twin"),
    ]
    assert all(prima_only_allows(m, p) for m, p in ok)
    assert not any(prima_only_allows(m, p) for m, p in refused)


def test_chosen_screens_allow_their_calls_and_nothing_else():
    assert modules.allows("GET", "api/items", ["items"])
    assert modules.allows("POST", "api/items/act", ["items"])
    assert not modules.allows("GET", "api/staff-pay", ["items"])
    assert modules.allows("GET", "api/staff-pay", ["staffpay"])
    assert not modules.allows("GET", "api/finance/dashboard", ["items"])
    # Prima's frame on every screen, and everyone's own things (their record, clock, memos).
    assert modules.allows("GET", "api/me", [])
    assert modules.allows("GET", "api/memos", [])
    # A call no screen makes is judged by its first part; unknown parts are refused.
    assert not modules.allows("GET", "api/no-such-thing", ["items"])
    assert modules.allows("GET", "api/anything", None)  # nothing chosen: all of Prima
    # Every chosen screen is a screen of Prima's menu, and the ones everyone keeps are too.
    assert set(modules.ALWAYS) <= set(modules.ids())
    assert modules.clean(["claims", "mine", "nope", "items"]) == ["items", "claims"]
    assert modules.clean(None) is None


# ---------------------------------------------------------------- Prima only


async def test_a_prima_only_person_reaches_prima_and_nothing_else(client, prima_on):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    await _map_branch(client, bid)
    m = await member(client, "siti@example.com", "staff", branch_id=bid, access="prima_only")
    assert m["member"]["access"] == "prima_only"
    await _microsoft("siti@example.com", "0a0a0a0a-0000-4000-8000-0000000000b1")
    siti_id, ws = await _ids("siti@example.com")
    c = await signed_in("siti@example.com", m["temp_password"])  # same sign-in page
    try:
        me = (await c.get("/api/auth/me")).json()
        assert me["access"] == "prima_only" and me["prima_modules"] is None
        for path in ("/api/tasks", "/api/desk", "/api/agents", "/api/chat/recent", "/api/members"):
            r = await c.get(path)
            assert r.status_code == 403 and r.json()["code"] == "prima_only", (path, r.text)
        r = await c.post("/api/tasks", json={}, headers=csrf(c))
        assert r.status_code == 403 and r.json()["code"] == "prima_only"
        assert (await c.get("/api/prima/status")).json()["linked"]
        r = await c.get("/api/prima/api/me")
        assert r.status_code == 200
        office_part = r.json()["office"]
        # P101: the office person, for Prima's greeting
        assert office_part.pop("name") == me["user"]["name"]
        assert office_part == {
            "primaOnly": True, "modules": None, "always": list(modules.ALWAYS), "asTop": False
        }  # fmt: skip
        assert (await c.get("/api/prima/api/leave")).json()["as"] == f"u-off-{siti_id}"
        assert (await c.get("/api/me/prefs")).status_code == 200
        assert (await c.post("/api/auth/logout", json={}, headers=csrf(c))).status_code == 204
    finally:
        await c.aclose()

    # Back to the office and Prima: the office opens again, from their next call.
    r = await _set(client, siti_id, access="agentic")
    assert r.status_code == 200 and r.json()["access"] == "agentic"
    c = await signed_in_again(client, "siti@example.com", siti_id)
    try:
        assert (await c.get("/api/tasks")).status_code == 200
        assert (await c.get("/api/auth/me")).json()["access"] == "agentic"
    finally:
        await c.aclose()


async def signed_in_again(owner, email: str, user_id: str):
    r = await owner.post(f"/api/members/{user_id}/reset-password", json={}, headers=csrf(owner))
    assert r.status_code == 200, r.text
    return await signed_in(email, r.json()["temp_password"])


async def test_a_session_open_when_made_prima_only_is_refused_at_once(client):
    o = await office(client)
    c = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await c.get("/api/tasks")).status_code == 200
        uid, _ = await _ids("aina@example.com")
        assert (await _set(client, uid, access="prima_only")).status_code == 200
        r = await c.get("/api/tasks")
        assert r.status_code == 403 and r.json()["code"] == "prima_only"
        # In Malay too.
        r = await c.get("/api/tasks", headers={"x-lang": "ms"})
        assert r.json()["message"] == "Akses anda hanya untuk Prima. Buka Prima untuk teruskan."
    finally:
        await c.aclose()


# ---------------------------------------------------------------- chosen Prima screens


async def test_chosen_screens_narrow_the_screens_and_the_ai(client, prima_on):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    await _map_branch(client, bid)
    m = await member(client, "siti@example.com", "staff", branch_id=bid)
    await _microsoft("siti@example.com", "0a0a0a0a-0000-4000-8000-0000000000b1")
    siti_id, ws = await _ids("siti@example.com")
    r = await _set(client, siti_id, prima_modules=["items"])
    assert r.status_code == 200 and r.json()["prima_modules"] == ["items"]
    c = await signed_in("siti@example.com", m["temp_password"])
    try:
        assert (await c.get("/api/prima/api/items")).status_code == 200
        n = len(prima_on)
        r = await c.get("/api/prima/api/staff-pay")
        assert r.status_code == 403 and r.json()["code"] == "module_not_chosen"
        assert "Staff payroll" in r.json()["message"]
        assert len(prima_on) == n  # never reached Prima
        r = await c.get("/api/prima/api/staff-pay", headers={"x-lang": "ms"})
        assert r.json()["message"].startswith("Gaji staf tiada dalam akses Prima anda")
        # Their own things always come; Prima's web is told which screens to show.
        assert (await c.get("/api/prima/api/leave")).status_code == 200
        office_part = (await c.get("/api/prima/api/me")).json()["office"]
        assert office_part["modules"] == ["items"] and office_part["primaOnly"] is False
        # The office itself stays open to them (Agentic + Prima).
        assert (await c.get("/api/tasks")).status_code == 200
    finally:
        await c.aclose()
    # Their AI works in Prima with the same screens only.
    async with SessionLocal() as db:
        ans = await prima.call(
            db, workspace_id=ws, user_id=siti_id, method="GET", path="api/items", via="agent:AI"
        )
        assert ans.status == 200
        try:
            await prima.call(
                db, workspace_id=ws, user_id=siti_id, method="GET", path="api/staff-pay"
            )
            raise AssertionError("the AI reached a screen that was not chosen")
        except PrimaError as e:
            assert e.status == 403 and e.code == "module_not_chosen"

    # All of Prima again.
    r = await _set(client, siti_id, prima_modules=None)
    assert r.status_code == 200 and r.json()["prima_modules"] is None
    async with SessionLocal() as db:
        ans = await prima.call(db, workspace_id=ws, user_id=siti_id, method="GET", path="api/x")
        assert ans.status == 200


async def test_the_screens_to_choose_from_follow_prima_s_menu(client):
    await office(client)
    d = (await client.get("/api/members/prima-modules")).json()
    assert d["mine"] is None and d["always"] == list(modules.ALWAYS)
    apps = {a["id"]: a for a in d["apps"]}
    assert {"home", "equip", "hr", "pay", "finance"} <= set(apps)
    equip = [x["id"] for g in apps["equip"]["groups"] for x in g["modules"]]
    assert "items" in equip
    home = [x for g in apps["home"]["groups"] for x in g["modules"]]
    assert all(x["always"] for x in home if x["id"] in modules.ALWAYS)
    ms = (await client.get("/api/members/prima-modules", headers={"x-lang": "ms"})).json()
    assert next(a for a in ms["apps"] if a["id"] == "pay")["title"] == "Gaji"


# ---------------------------------------------------------------- who may set it


async def test_who_may_set_access_and_never_beyond_their_own(client):
    o = await office(client)
    bid = o["branch"]["id"]
    _, staff_id, _ = await _staff_member(client, "staff1@example.com", bid)
    _, staff2_id, _ = await _staff_member(client, "staff2@example.com", bid)

    # Nobody changes their own access; an owner never becomes Prima only.
    owner_id, _ = await _ids("owner@example.com")
    r = await _set(client, owner_id, access="prima_only")
    assert r.status_code == 400 and r.json()["code"] == "self_change"
    await member(client, "owner2@example.com", "owner")
    owner2_id, _ = await _ids("owner2@example.com")
    for body in ({"access": "prima_only"}, {"prima_modules": ["items"]}):
        r = await _set(client, owner2_id, **body)
        assert r.status_code == 400 and r.json()["code"] == "owner_access", r.text

    # HR (members.manage) sets it; a branch manager (team.manage) and staff cannot.
    hr = await as_role(client, "hr@example.com", "hr")
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=bid)
    st = await as_role(client, "st@example.com", "staff", branch_id=bid)
    try:
        assert (await _set(hr, staff_id, access="prima_only")).status_code == 200
        assert (await _set(hr, owner2_id, access="agentic")).status_code == 403  # owners: owners
        for who in (bm, st):
            r = await _set(who, staff2_id, access="prima_only")
            assert r.status_code == 403, r.text
        r = await bm.post(
            "/api/members",
            json={"email": "new@example.com", "name": "New", "role": "staff", "branch_id": bid,
                  "access": "prima_only"},
            headers=csrf(bm),
        )  # fmt: skip
        assert r.status_code == 403, r.text
        hr_id, _ = await _ids("hr@example.com")
        assert (await _set(hr, hr_id, prima_modules=["items"])).json()["code"] == "self_change"

        # HR with some Prima screens gives only those (or narrows what someone already had).
        assert (await _set(client, hr_id, prima_modules=["items", "claims"])).status_code == 200
        r = await _set(hr, staff2_id, prima_modules=["items", "staffpay"])
        assert r.status_code == 200  # staff2 had all of Prima: this narrows
        r = await _set(hr, staff2_id, prima_modules=["items", "staffpay", "finance"])
        assert r.status_code == 403 and r.json()["code"] == "more_access"
        r = await _set(hr, staff2_id, prima_modules=None)  # all of Prima: more than HR has
        assert r.status_code == 403 and r.json()["code"] == "more_access"
        r = await _set(hr, staff2_id, prima_modules=["items", "claims"])
        assert r.status_code == 200 and r.json()["prima_modules"] == ["items", "claims"]
        r = await _set(hr, staff2_id, prima_modules=["bogus"])
        assert r.status_code == 422
        # Bulk: everyone ticked; anyone the rules stop is skipped and says why.
        r = await hr.post(
            "/api/members/bulk",
            json={"user_ids": [staff_id, staff2_id, hr_id], "action": "prima",
                  "prima_modules": ["items"]},
            headers=csrf(hr),
        )  # fmt: skip
        assert r.status_code == 200 and r.json()["done"] == 2 and r.json()["skipped"] == 1
    finally:
        for c in (hr, bm, st):
            await c.aclose()

    # Every change is audited, with what it was and what it became.
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(AuditLog)
                .where(AuditLog.action == "member.prima_access", AuditLog.target == staff_id)
                .order_by(AuditLog.id)
            )
        ).all()
        assert rows[0].before == {"access": "agentic", "prima_modules": None}
        assert rows[0].after == {"access": "prima_only", "prima_modules": None}
        assert rows[-1].after == {"access": "prima_only", "prima_modules": ["items"]}


async def _staff_member(client, email: str, bid: str):
    m = await member(client, email, "staff", branch_id=bid)
    uid, ws = await _ids(email)
    return m, uid, ws


async def test_members_list_and_patch_carry_access_and_an_owner_keeps_everything(client):
    o = await office(client)
    bid = o["branch"]["id"]
    _, uid, ws = await _staff_member(client, "siti@example.com", bid)
    r = await client.patch(
        f"/api/members/{uid}",
        json={"access": "prima_only", "prima_modules": ["items", "items", "mine"]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["prima_modules"] == ["items"]  # cleaned
    page = (await client.get("/api/members?page=1")).json()
    row = next(x for x in page["items"] if x["user_id"] == uid)
    assert row["access"] == "prima_only" and row["prima_modules"] == ["items"]
    # Made an owner: the office and all of Prima again, in the same audited change.
    r = await client.patch(f"/api/members/{uid}", json={"role": "owner"}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["access"] == "agentic"
    assert r.json()["prima_modules"] is None
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        assert (m.access, m.prima_modules) == ("agentic", None)


async def test_the_prima_role_and_where_it_is_set(client, prima_on):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    await _map_branch(client, bid)
    _, uid, _ = await _staff_member(client, "siti@example.com", bid)
    d = (await client.get(f"/api/members/{uid}/prima")).json()
    assert d["enabled"] and d["role"] == "pwvsb_officer" and "Not opened Prima yet" in d["where"]
    owner_id, _ = await _ids("owner@example.com")
    d = (await client.get(f"/api/members/{owner_id}/prima")).json()
    assert d["role"] == "director" and "top record" in d["where"]
    await _microsoft("owner@example.com", "0a0a0a0a-0000-4000-8000-0000000000aa")
    await _microsoft("siti@example.com")  # Prima's record u-aina has this Microsoft account
    async with SessionLocal() as db:
        _, ws = await _ids("siti@example.com")
        await prima.link_for(db, ws, uid)
    d = (await client.get(f"/api/members/{uid}/prima")).json()
    assert d["record"] == "Aina Binti Ali" and d["role"] == "company_hr"
    assert "set in Prima" in d["where"]


# ---------------------------------------------------------------- the migration


async def test_migration_0062_goes_up_down_and_up_again():
    name = f"{TEST_DB}_p99mig"
    admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {name}")
    finally:
        await admin.close()
    url = f"postgresql+asyncpg://{PG}/{name}"
    cols = (
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'memberships' "
        "AND column_name IN ('access', 'prima_modules') ORDER BY 1"
    )
    try:
        await asyncio.to_thread(_alembic, url, "upgrade", "0061")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            await conn.execute(
                "INSERT INTO workspaces (id, name, slug, timezone, settings, created_at, "
                "updated_at) VALUES ('ws_m', 'W', 'w', 'Asia/Kuala_Lumpur', '{}', now(), now())"
            )
            await conn.execute(
                "INSERT INTO users (id, email, name, password_hash, is_active, "
                "must_change_password, created_at, updated_at) VALUES "
                "('us_1', 'us_1@example.com', 'X', 'x', true, false, now(), now())"
            )
            await conn.execute(
                "INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) "
                "VALUES ('ws_m', 'us_1', 'staff', now(), now())"
            )
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert [r[0] for r in await conn.fetch(cols)] == ["access", "prima_modules"]
            row = await conn.fetchrow("SELECT access, prima_modules FROM memberships")
            assert tuple(row) == ("agentic", None)  # everyone stays as they were
            try:
                await conn.execute("UPDATE memberships SET access = 'office_only'")
                raise AssertionError("an unknown access was saved")
            except asyncpg.CheckViolationError:
                pass
            await conn.execute(
                "UPDATE memberships SET access = 'prima_only', prima_modules = '[\"items\"]'"
            )
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "downgrade", "0061")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert await conn.fetch(cols) == []
            assert await conn.fetchval("SELECT role FROM memberships") == "staff"
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            row = await conn.fetchrow("SELECT access, prima_modules FROM memberships")
            assert tuple(row) == ("agentic", None)
        finally:
            await conn.close()
    finally:
        admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        finally:
            await admin.close()
