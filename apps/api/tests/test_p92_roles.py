"""P92: management and HR roles, owner-set role access, and correcting a name or email.

- management / hr: everything admin has, without the AI engine, file storage and MCP tools;
  never owner powers; they cannot hand out more access than their own.
- Settings > Roles and access (owner only): grant / revoke per role, saved in the workspace's
  settings and followed from the person's next request, on the server and in /api/auth/me.
- PATCH /api/members/{id} name / email, POST .../reset-microsoft, PUT /api/account/email: the
  Microsoft binding is let go of, sessions end, Prima relinks on the next visit.

All people and addresses are synthetic (example.com).
"""

import asyncio
import os

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select

from agentic.api.scope import Scope
from agentic.core.db import SessionLocal
from agentic.core.security import (
    GRANTABLE,
    OWNER_ONLY,
    PERMISSIONS,
    ROLE_ACCESS_SETTING,
    ROLES,
    effective,
    role_overrides,
    use_settings,
)
from agentic.models import AuditLog, AuthSession, Membership, MicrosoftAccount, PrimaLink, User
from agentic.services import two_factor

from .conftest import PG, TEST_DB, csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import PW, as_role, member, signed_in
from .test_p63_microsoft_signin import sso  # noqa: F401
from .test_p66_prima import prima_on  # noqa: F401

NEW_AREAS = {"engine.manage", "engine.view", "storage.manage", "mcp.manage"}
TENANT_X = "11111111-2222-3333-4444-555555555555"


async def _uid(email: str) -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(User.id).where(User.email == email))) or ""


async def _audits(action: str) -> list[AuditLog]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(AuditLog).where(AuditLog.action == action))).all())


async def _put_access(owner: httpx.AsyncClient, roles: dict) -> httpx.Response:
    return await owner.put("/api/org/role-access", json={"roles": roles}, headers=csrf(owner))


# ---------------------------------------------------------------- the default table


def test_management_and_hr_are_admin_without_the_engine_storage_and_mcp():
    for role in ("management", "hr"):
        assert role in ROLES
        assert PERMISSIONS[role] == PERMISSIONS["admin"] - NEW_AREAS
        assert not PERMISSIONS[role] & OWNER_ONLY
        # They see the whole workspace, like an admin.
        assert Scope.of(role, "u1", None, None).everything
    # The three new switches go to exactly who reached those pages before (nothing changes).
    assert {r for r in ROLES if "engine.view" in PERMISSIONS[r]} == {
        "owner", "admin", "operator", "approver", "viewer",
    }  # fmt: skip
    assert {r for r in ROLES if "storage.manage" in PERMISSIONS[r]} == {"owner", "admin"}
    assert {r for r in ROLES if "mcp.manage" in PERMISSIONS[r]} == {"owner", "admin"}
    assert {r for r in ROLES if "members.assign_owner" in PERMISSIONS[r]} == {"owner"}
    # Two-step sign-in "owners and admins" covers them: they manage members and passwords.
    assert two_factor.covers("admins", "management") and two_factor.covers("admins", "hr")


def test_saved_role_access_is_cleaned_and_applied():
    raw = {
        ROLE_ACCESS_SETTING: {
            "hr": {
                "grant": ["engine.view", "audit.read", "nonsense"],
                "revoke": ["assistants.use"],
            },
            "owner": {"revoke": ["members.manage"]},  # the owner is never edited
            "viewer": {"grant": ["members.assign_owner", "roles.manage", "feedback.manage"]},
            "staff": {"revoke": ["read"]},  # signing in is never taken away
            "ghost": {"grant": ["audit.read"]},
        }
    }
    assert role_overrides(raw) == {"hr": {"grant": ["engine.view"], "revoke": ["assistants.use"]}}
    assert "engine.view" in effective("hr", raw) and "assistants.use" not in effective("hr", raw)
    assert effective("owner", raw) == PERMISSIONS["owner"]
    assert effective("viewer", raw) == PERMISSIONS["viewer"]
    assert "read" in effective("staff", raw)
    assert not GRANTABLE & OWNER_ONLY and "read" not in GRANTABLE


# ---------------------------------------------------------------- what management and HR reach


@pytest.mark.parametrize("role", ["management", "hr"])
async def test_management_and_hr_are_refused_the_engine_storage_and_mcp(
    client, llm, temporal, role
):
    await office(client)
    c = await as_role(client, f"{role}@example.com", role)
    try:
        me = (await c.get("/api/auth/me")).json()
        assert me["role"] == role
        assert not set(me["permissions"]) & (NEW_AREAS | OWNER_ONLY)
        for path in (
            "/api/ai/providers",
            "/api/ai/settings",
            "/api/ai/models",
            "/api/ai/usage?days=7",
            "/api/ai/cache-health?days=7",
            "/api/ai/privacy",
            "/api/ai/presets",
            "/api/storage",
            "/api/mcp-servers",
        ):
            assert (await c.get(path)).status_code == 403, path
        r = await c.put("/api/ai/groups/smart", json={"members": []}, headers=csrf(c))
        assert r.status_code == 403
        r = await c.post(
            "/api/mcp-servers",
            json={"name": "x", "url": "https://mcp.example.com"},
            headers=csrf(c),
        )
        assert r.status_code == 403
        # The model-group pickers (agents, voice notes) keep working for them.
        groups = await c.get("/api/ai/groups")
        assert groups.status_code == 200 and any(g["name"] == "smart" for g in groups.json())

        # Everywhere else an admin goes, they go.
        assert (await c.get("/api/audit")).status_code == 200
        assert (await c.get("/api/branches")).status_code == 200
        assert (await c.get("/api/members?page=1")).status_code == 200
        r = await c.post("/api/branches", json={"name": f"{role} Sdn Bhd"}, headers=csrf(c))
        assert r.status_code == 201, r.text
        staff = await member(c, f"staff.{role}@example.com", "staff", branch_id=r.json()["id"])
        assert staff["temp_password"]
        await member(c, f"peer.{role}@example.com", "hr")

        # Never owner powers, and never a role with more access than their own (admin has
        # the AI engine; a viewer sees it).
        for give in ("owner", "admin", "viewer"):
            r = await c.post(
                "/api/members",
                json={"email": f"{give}.x@example.com", "name": "X", "role": give},
                headers=csrf(c),
            )
            assert r.status_code == 403, (give, r.text)
        assert (await c.get("/api/org/role-access")).status_code == 403
        assert (await c.get("/api/workspace/data")).status_code == 403
    finally:
        await c.aclose()
    # Owners, admins and viewers keep what they had.
    assert (await client.get("/api/ai/providers")).status_code == 200
    v = await as_role(client, "viewer@example.com", "viewer")
    try:
        assert (await v.get("/api/ai/providers")).status_code == 200
        assert (await v.get("/api/storage")).status_code == 403
    finally:
        await v.aclose()
    a = await as_role(client, "admin@example.com", "admin")
    try:
        assert (await a.get("/api/storage")).status_code == 200
        assert (await a.get("/api/mcp-servers")).status_code == 200
        assert (await a.get("/api/ai/usage?days=7")).status_code == 200
    finally:
        await a.aclose()


def test_who_gives_which_role():
    from agentic.api.deps import Principal
    from agentic.api.routers import member_import, members

    use_settings(None)

    def p(role: str) -> Principal:
        return Principal(user=User(id="u1", email="x@example.com"), workspace_id="w", role=role,
                         session_id="s")  # fmt: skip

    assert members.assignable_roles(p("owner")) == list(ROLES)
    assert members.assignable_roles(p("admin")) == [r for r in ROLES if r != "owner"]
    leadership = ["branch_manager", "hod", "supervisor", "staff", "management", "hr"]
    assert members.assignable_roles(p("management")) == leadership
    assert members.assignable_roles(p("hr")) == leadership
    assert members.assignable_roles(p("branch_manager")) == ["hod", "supervisor", "staff"]
    assert members.assignable_roles(p("viewer")) == []
    # The Excel import offers the same roles the form does.
    assert member_import._assignable(p("management")) == leadership


async def test_an_admin_still_gives_every_role_but_owner(client, llm, temporal):
    await office(client)
    a = await as_role(client, "admin@example.com", "admin")
    try:
        for role in ("management", "hr", "viewer", "operator", "approver", "admin"):
            await member(a, f"{role}.made@example.com", role)
    finally:
        await a.aclose()


# ---------------------------------------------------------------- Roles and access


async def test_the_owner_changes_role_access_and_it_applies_on_the_next_request(
    client, llm, temporal
):
    await office(client)
    hr = await as_role(client, "hr@example.com", "hr")
    mg = await as_role(client, "mg@example.com", "management")
    try:
        d = (await client.get("/api/org/role-access")).json()
        rows = {r["role"]: r for r in d["roles"]}
        assert rows["owner"]["editable"] is False
        assert rows["hr"]["effective"] == rows["hr"]["default"]
        assert set(d["owner_only"]) == OWNER_ONLY

        assert (await hr.get("/api/ai/providers")).status_code == 403
        r = await _put_access(
            client,
            {"hr": {"grant": ["engine.view"]}, "management": {"revoke": ["audit.read"]}},
        )
        assert r.status_code == 200, r.text
        rows = {x["role"]: x for x in r.json()["roles"]}
        assert rows["hr"]["grant"] == ["engine.view"] and "engine.view" in rows["hr"]["effective"]
        assert rows["management"]["revoke"] == ["audit.read"]

        # The very next request of theirs follows it, and so does their menu (/me).
        assert (await hr.get("/api/ai/providers")).status_code == 200
        assert "engine.view" in (await hr.get("/api/auth/me")).json()["permissions"]
        r = await hr.put("/api/ai/groups/smart", json={"members": []}, headers=csrf(hr))
        assert r.status_code == 403
        assert (await mg.get("/api/audit")).status_code == 403
        assert "audit.read" not in (await mg.get("/api/auth/me")).json()["permissions"]
        assert (await hr.get("/api/audit")).status_code == 200  # only what changed changed

        # Granting a giving power makes the role able to give only within its own access.
        r = await _put_access(
            client,
            {
                "hr": {"grant": ["engine.view"]},
                "management": {"revoke": ["audit.read", "assistants.use"]},
            },
        )
        assert r.status_code == 200
        r = await mg.post(
            "/api/members",
            json={"email": "bm@example.com", "name": "Bm", "role": "branch_manager",
                  "branch_id": (await client.get("/api/branches")).json()[0]["id"]},
            headers=csrf(mg),
        )  # fmt: skip
        assert r.status_code == 403 and r.json()["code"] == "more_access"

        entries = await _audits("org.role_access_changed")
        assert len(entries) == 2
        assert "hr: +engine.view" in (entries[0].note or "")
        assert entries[1].after == {
            "roles": {
                "hr": {"grant": ["engine.view"], "revoke": []},
                "management": {"grant": [], "revoke": ["assistants.use", "audit.read"]},
            }
        }

        # Back to the defaults.
        r = await _put_access(client, {})
        assert r.status_code == 200
        assert all(x["effective"] == x["default"] for x in r.json()["roles"])
        assert (await hr.get("/api/ai/providers")).status_code == 403
        assert (await mg.get("/api/audit")).status_code == 200
        assert len(await _audits("org.role_access_changed")) == 3
        # Saving the same again writes nothing.
        await _put_access(client, {})
        assert len(await _audits("org.role_access_changed")) == 3
    finally:
        await hr.aclose()
        await mg.aclose()


async def test_role_access_refuses_what_can_never_change(client, llm, temporal):
    await office(client)
    cases = [
        ({"owner": {"revoke": ["audit.read"]}}, "owner_locked"),
        ({"hr": {"grant": ["members.assign_owner"]}}, "owner_only_permission"),
        ({"admin": {"grant": ["roles.manage"]}}, "owner_only_permission"),
        ({"staff": {"grant": ["feedback.manage"]}}, "owner_only_permission"),
        ({"staff": {"revoke": ["read"]}}, "locked_permission"),
        ({"hr": {"grant": ["engine.everything"]}}, "unknown_permission"),
        ({"chief": {"grant": ["audit.read"]}}, "unknown_role"),
        ({"hr": {"grant": ["audit.read"], "revoke": ["audit.read"]}}, "grant_and_revoke"),
    ]
    for body, code in cases:
        r = await _put_access(client, body)
        assert r.status_code == 422 and r.json()["code"] == code, (body, r.text)
    assert await _audits("org.role_access_changed") == []
    # Only an owner sees or changes it; an admin cannot give it to themselves either.
    a = await as_role(client, "admin@example.com", "admin")
    try:
        assert (await a.get("/api/org/role-access")).status_code == 403
        r = await _put_access(a, {"admin": {"grant": ["members.assign_owner"]}})
        assert r.status_code == 403
        assert "roles.manage" not in (await a.get("/api/auth/me")).json()["permissions"]
    finally:
        await a.aclose()
    assert "roles.manage" in (await client.get("/api/auth/me")).json()["permissions"]


# ---------------------------------------------------------------- correcting a name or email


async def _bind_microsoft(email: str, oid: str) -> None:
    """What a Microsoft sign-in leaves behind: the membership's object ID and the connection
    that finds them next time (microsoft/signin.finish, microsoft/auth.store)."""
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        m.ms_oid, m.ms_tenant_id = oid, TENANT_X
        db.add(
            MicrosoftAccount(
                workspace_id=m.workspace_id,
                user_id=user.id,
                ms_user_id=oid,
                tenant_id=TENANT_X,
                email=email,
                status="connected",
            )
        )
        await db.commit()


async def test_an_admin_corrects_a_name_and_email(client, llm, temporal):
    o = await office(client)
    bid = o["branch"]["id"]
    s = await member(client, "siti.typo@example.com", "staff", branch_id=bid)
    await member(client, "taken@example.com", "staff", branch_id=bid)
    sid = await _uid("siti.typo@example.com")
    staff = await signed_in("siti.typo@example.com", s["temp_password"])
    await _bind_microsoft("siti.typo@example.com", "oid-wrong-person")
    a = await as_role(client, "admin@example.com", "admin")
    try:
        # A name alone: nothing else changes (still signed in, still linked).
        r = await a.patch(f"/api/members/{sid}", json={"name": "  Siti   Aminah "}, headers=csrf(a))
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Siti Aminah" and r.json()["microsoft"] is True
        assert (await staff.get("/api/auth/me")).status_code == 200

        bad = await a.patch(f"/api/members/{sid}", json={"email": "not-an-email"}, headers=csrf(a))
        assert bad.status_code == 422
        r = await a.patch(
            f"/api/members/{sid}", json={"email": "Taken@Example.com"}, headers=csrf(a)
        )
        assert r.status_code == 409 and r.json()["code"] == "email_taken"
        assert (await a.patch(f"/api/members/{sid}", json={}, headers=csrf(a))).status_code == 422

        r = await a.patch(
            f"/api/members/{sid}", json={"email": " Siti.Aminah@Example.com "}, headers=csrf(a)
        )
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "siti.aminah@example.com"
        assert r.json()["microsoft"] is False
        # Signed out everywhere; the new email and the same password sign them in.
        assert (await staff.get("/api/auth/me")).status_code == 401
        async with SessionLocal() as db:
            assert not (
                await db.scalars(select(AuthSession).where(AuthSession.user_id == sid))
            ).all()
            m = await db.scalar(select(Membership).where(Membership.user_id == sid))
            assert (m.ms_oid, m.ms_tenant_id) == (None, None)
            acct = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == sid))
            assert acct.status == "disconnected" and acct.ms_user_id == "" and acct.token_enc == ""
        changed = await _audits("member.identity_changed")
        assert [(e.before, e.after) for e in changed][-1] == (
            {"name": "Siti Aminah", "email": "siti.typo@example.com"},
            {"name": "Siti Aminah", "email": "siti.aminah@example.com"},
        )
        reset = (await _audits("member.microsoft_reset"))[-1]
        assert reset.after["microsoft_link"] == "cleared" and reset.after["sessions_ended"] >= 1
        c = httpx.AsyncClient(transport=client._transport, base_url="http://test")
        try:
            r = await c.post(
                "/api/auth/login", json={"email": "siti.aminah@example.com", "password": PW}
            )
            assert r.status_code == 200, r.text
            r = await c.post(
                "/api/auth/login", json={"email": "siti.typo@example.com", "password": PW}
            )
            assert r.status_code == 401
        finally:
            await c.aclose()

        # Not themselves, and nobody but an owner touches an owner.
        me_id = await _uid("admin@example.com")
        r = await a.patch(f"/api/members/{me_id}", json={"name": "Me"}, headers=csrf(a))
        assert r.status_code == 400
        owner_id = await _uid("owner@example.com")
        r = await a.patch(f"/api/members/{owner_id}", json={"name": "Not Owner"}, headers=csrf(a))
        assert r.status_code == 403 and r.json()["code"] == "owner_only"
        r = await a.post(f"/api/members/{owner_id}/reset-microsoft", json={}, headers=csrf(a))
        assert r.status_code == 403
    finally:
        await staff.aclose()
        await a.aclose()


async def test_who_may_correct_names_and_emails(client, llm, temporal):
    o = await office(client)
    bid = o["branch"]["id"]
    await member(client, "staff1@example.com", "staff", branch_id=bid)
    await member(client, "admin2@example.com", "admin")
    await member(client, "owner2@example.com", "owner")
    sid = await _uid("staff1@example.com")
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=bid)
    mg = await as_role(client, "mg@example.com", "management")
    try:
        # A branch manager changes roles of their people, not who they are.
        r = await bm.patch(f"/api/members/{sid}", json={"name": "X"}, headers=csrf(bm))
        assert r.status_code == 403
        # Management corrects staff, but not an admin (more access than theirs).
        r = await mg.patch(f"/api/members/{sid}", json={"name": "Staff One"}, headers=csrf(mg))
        assert r.status_code == 200
        admin2 = await _uid("admin2@example.com")
        r = await mg.patch(f"/api/members/{admin2}", json={"name": "X"}, headers=csrf(mg))
        assert r.status_code == 403 and r.json()["code"] == "more_access"
        r = await mg.post(f"/api/members/{admin2}/reset-password", json={}, headers=csrf(mg))
        assert r.status_code == 403
    finally:
        await bm.aclose()
        await mg.aclose()
    # An owner corrects another owner.
    owner2 = await _uid("owner2@example.com")
    r = await client.patch(
        f"/api/members/{owner2}", json={"email": "owner.two@example.com"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["email"] == "owner.two@example.com"


async def test_reset_microsoft_link_keeps_the_email(client, llm, temporal):
    o = await office(client)
    s = await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    aid = await _uid("aina@example.com")
    c = await signed_in("aina@example.com", s["temp_password"])
    await _bind_microsoft("aina@example.com", "oid-someone-else")
    try:
        r = await client.post(f"/api/members/{aid}/reset-microsoft", json={}, headers=csrf(client))
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "aina@example.com" and r.json()["microsoft"] is False
        assert (await c.get("/api/auth/me")).status_code == 401
        async with SessionLocal() as db:
            acct = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == aid))
            assert acct.status == "disconnected" and acct.ms_user_id == ""
        e = (await _audits("member.microsoft_reset"))[-1]
        assert e.target == aid and "reset by hand" in (e.note or "")
        me_id = await _uid("owner@example.com")
        r = await client.post(
            f"/api/members/{me_id}/reset-microsoft", json={}, headers=csrf(client)
        )
        assert r.status_code == 400
    finally:
        await c.aclose()


# ---------------------------------------------------------------- the owner's own email


async def test_the_owner_changes_their_own_email_with_their_password(client, llm, temporal):
    await office(client)
    owner_id = await _uid("owner@example.com")
    other = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    try:
        r = await other.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "correct-horse-battery"},
        )
        assert r.status_code == 200
        await _bind_microsoft("owner@example.com", "oid-old-owner")

        url = "/api/account/email"
        r = await client.put(url, json={"email": "boss@example.com"}, headers=csrf(client))
        assert r.status_code == 400 and r.json()["code"] == "password_required"
        r = await client.put(
            url,
            json={"email": "boss@example.com", "current_password": "wrong-password-1"},
            headers=csrf(client),
        )
        assert r.status_code == 400 and r.json()["code"] == "bad_current_password"
        r = await client.put(
            url,
            json={"email": "Boss@Example.com", "current_password": "correct-horse-battery"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == "boss@example.com"
        # This device stays signed in; the others end. The Microsoft link is let go of.
        assert (await client.get("/api/auth/me")).status_code == 200
        assert (await other.get("/api/auth/me")).status_code == 401
        async with SessionLocal() as db:
            m = await db.scalar(select(Membership).where(Membership.user_id == owner_id))
            assert m.ms_oid is None
        e = (await _audits("account.email_changed"))[-1]
        assert (e.before, e.after) == (
            {"email": "owner@example.com"},
            {"email": "boss@example.com"},
        )
    finally:
        await other.aclose()
    a = await as_role(client, "admin@example.com", "admin")
    try:
        r = await a.put(
            "/api/account/email",
            json={"email": "a2@example.com", "current_password": PW},
            headers=csrf(a),
        )
        assert r.status_code == 403
        # Someone else's address is refused.
        r = await client.put(
            "/api/account/email",
            json={"email": "admin@example.com", "current_password": "correct-horse-battery"},
            headers=csrf(client),
        )
        assert r.status_code == 409
    finally:
        await a.aclose()


# ---------------------------------------------------------------- the migration


def _alembic(url: str, action: str, rev: str) -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = url
    getattr(command, action)(cfg, rev)


async def test_the_migration_goes_up_and_down_on_a_fresh_database():
    name = f"{TEST_DB}_p92mig"
    admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {name}")
    finally:
        await admin.close()
    url = f"postgresql+asyncpg://{PG}/{name}"
    check = (
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_memberships_role'"
    )
    column = (
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'prima_links' AND column_name = 'relink_needed'"
    )
    try:
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert "'hr'" in await conn.fetchval(check) and "'management'" in await conn.fetchval(
                check
            )  # noqa: E501
            assert await conn.fetchval(column) == 1
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "downgrade", "0053")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert "'hr'" not in await conn.fetchval(check)
            assert await conn.fetchval(column) == 0
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
    finally:
        admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        finally:
            await admin.close()


# ---------------------------------------------------------------- Microsoft and Prima follow


async def test_a_wrong_email_s_microsoft_account_lets_go_and_the_right_one_binds(
    client, llm, temporal, sso
):
    """The import had a typo that was someone else's address: that person's Microsoft sign-in
    came in as our member. After the owner corrects it, the wrong account is refused and the
    right one binds, everywhere (the membership's object ID is what Prima follows)."""
    from .test_p63_microsoft_signin import anon, configure, sign_in

    await office(client)
    await configure(client)
    await member(client, "hr.wrongaddr@example.com", "hr")
    hid = await _uid("hr.wrongaddr@example.com")
    wrong = anon(client)
    try:
        sso.me = {"id": "oid-wrong", "mail": "hr.wrongaddr@example.com",
                  "userPrincipalName": "hr.wrongaddr@example.com"}  # fmt: skip
        assert (await sign_in(wrong, sso))["sso"] == "done"
        assert (await wrong.get("/api/auth/me")).json()["user"]["id"] == hid

        r = await client.patch(
            f"/api/members/{hid}", json={"email": "hr.right@example.com"}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text
        assert (await wrong.get("/api/auth/me")).status_code == 401
    finally:
        await wrong.aclose()
    again = anon(client)  # a fresh browser: the old one still carries its ended session
    try:
        sso.nonce = ""
        got = await sign_in(again, sso)
        assert "No one with hr.wrongaddr@example.com" in got["sso_error"]
    finally:
        await again.aclose()
    right = anon(client)
    try:
        sso.nonce = ""
        sso.me = {"id": "oid-right", "mail": "hr.right@example.com",
                  "userPrincipalName": "hr.right@example.com"}  # fmt: skip
        assert (await sign_in(right, sso))["sso"] == "done"
        me = (await right.get("/api/auth/me")).json()
        assert me["user"]["id"] == hid and me["role"] == "hr"
        async with SessionLocal() as db:
            m = await db.scalar(select(Membership).where(Membership.user_id == hid))
            assert m.ms_oid == "oid-right"
            acct = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == hid))
            assert acct.ms_user_id == "oid-right" and acct.status == "connected"
        # P92: a Microsoft sign-in in the last ten minutes also proves it is the owner.
        sso.nonce = ""
        sso.me = {"id": "oid-owner", "mail": "owner@example.com",
                  "userPrincipalName": "owner@example.com"}  # fmt: skip
        own = anon(client)
        try:
            assert (await sign_in(own, sso))["sso"] == "done"
            r = await own.put(
                "/api/account/email", json={"email": "owner.new@example.com"}, headers=csrf(own)
            )
            assert r.status_code == 200, r.text
            assert r.json()["user"]["email"] == "owner.new@example.com"
        finally:
            await own.aclose()
    finally:
        await right.aclose()


async def test_prima_follows_a_corrected_email(client, prima_on):
    """Their own Prima account keeps its id (their Prima history) and is relinked from the
    new email after their next Microsoft sign-in; a link found by the old Microsoft account
    goes; a link the owner set stays."""
    from agentic.prima import client as prima

    from .test_p66_prima import OID, _accounts, _ids, _map_branch, _microsoft

    o = await office(client)
    await _map_branch(client, o["branch"]["id"])
    hr = await member(client, "hr.typo@example.com", "hr")
    await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    await _microsoft("hr.typo@example.com", "0a0a0a0a-0000-4000-8000-0000000000c1")
    await _microsoft("aina@example.com", OID)  # the Microsoft account IT gave a Prima record
    hid, ws = await _ids("hr.typo@example.com")
    aid, _ = await _ids("aina@example.com")

    c = await signed_in("hr.typo@example.com", hr["temp_password"])
    try:
        assert (await c.get("/api/prima/status")).json()["linked"]
    finally:
        await c.aclose()
    async with SessionLocal() as db:
        assert (await prima.link_for(db, ws, aid)).how == "microsoft"
        link = await db.get(PrimaLink, (ws, hid))
        assert (link.prima_user_id, link.how) == (f"u-off-{hid}", "auto")
    assert _accounts(prima_on)[-1]["email"] == "hr.typo@example.com"

    for uid, email in ((hid, "hr.fixed@example.com"), (aid, "aina.fixed@example.com")):
        r = await client.patch(f"/api/members/{uid}", json={"email": email}, headers=csrf(client))
        assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        link = await db.get(PrimaLink, (ws, hid))
        assert link.relink_needed and link.prima_user_id == f"u-off-{hid}"
        assert await db.get(PrimaLink, (ws, aid)) is None  # found by the old account: gone

    c = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    try:
        r = await c.post("/api/auth/login", json={"email": "hr.fixed@example.com", "password": PW})
        assert r.status_code == 200, r.text
        # No way into Prima until they sign in with Microsoft again.
        s = (await c.get("/api/prima/status")).json()
        assert not s["linked"] and s["code"] == "microsoft_needed", s
        await _microsoft("hr.fixed@example.com", "0a0a0a0a-0000-4000-8000-0000000000c2")
        s = (await c.get("/api/prima/status")).json()
        assert s["linked"], s
    finally:
        await c.aclose()
    last = _accounts(prima_on)[-1]
    assert last["officeUserId"] == hid and last["email"] == "hr.fixed@example.com"
    assert last["relink"] is True and last["title"] == "HR"
    async with SessionLocal() as db:
        link = await db.get(PrimaLink, (ws, hid))
        assert link.prima_user_id == f"u-off-{hid}" and not link.relink_needed
        # Opened again: nothing more to do.
        n = len(_accounts(prima_on))
        await prima.link_for(db, ws, hid)
        assert len(_accounts(prima_on)) == n
    assert (await _audits("prima.relink"))[-1].target == hid

    # A link the owner set by hand stays as it is.
    async with SessionLocal() as db:
        await db.merge(
            PrimaLink(workspace_id=ws, user_id=aid, prima_user_id="u-ahmad-2",
                      prima_name="Ahmad", how="owner", linked_by="user:owner")
        )  # fmt: skip
        await db.commit()
    r = await client.post(f"/api/members/{aid}/reset-microsoft", json={}, headers=csrf(client))
    assert r.status_code == 200
    async with SessionLocal() as db:
        link = await db.get(PrimaLink, (ws, aid))
        assert link.how == "owner" and not link.relink_needed
