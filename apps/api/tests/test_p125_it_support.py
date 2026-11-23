"""P125: the IT support role, whose admin changes wait for an owner or global admin.

The owner (23 Nov 2026): "Add another high-privilege role under admin: IT support. ... IT
support can do most of what admins do ... But whatever IT support does, an owner, the developer
or a global admin must approve it first; it shows on the Approvals page with what they want
approved, and only once approved does it take effect. Rename 'Admin' to 'Global admin'. Check
for any loophole."

- IT support's state-changing calls to the admin areas answer 202 {"held": true, ...} and do
  nothing; an owner or global admin (never the asker) approves (with a reason): the call runs
  again with the APPROVER's sign-in, audited as them; or declines with a reason.
- A failed run shows "Could not be applied" and stays open. Nothing runs twice.
- Every mutating route under the held prefixes is held (walked from the app's routes).
- Loopholes: their own account, the high roles, bulk, direct calls, DELETE, edits, approving
  twice or one's own, expiry, a role removed meanwhile, who sees what.

All people and addresses are synthetic (example.com).
"""

import asyncio
import contextlib
import os
import re
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi.routing import APIRoute
from sqlalchemy import select, update

from agentic.agents.tools import TOOLS
from agentic.core.db import SessionLocal
from agentic.core.security import (
    HIGH_ROLES,
    PERMISSIONS,
    ROLES,
    reset_acting_for,
    set_acting_for,
    use_settings,
)
from agentic.i18n.labels import role_label
from agentic.models import AuditLog, Branch, Membership, User
from agentic.org import held
from agentic.org.held_models import HeldChange

from .conftest import PG, TEST_DB, csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role, member

HELD = "/api/held-changes"
REASON = "Checked with HR, fine"


@contextlib.asynccontextmanager
async def _open(*clients: httpx.AsyncClient):
    try:
        yield
    finally:
        for c in clients:
            await c.aclose()


async def _uid(email: str) -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(User.id).where(User.email == email))) or ""


async def _role(uid: str) -> str | None:
    async with SessionLocal() as db:
        return await db.scalar(select(Membership.role).where(Membership.user_id == uid))


async def _it(client, o, email="it.one@example.com") -> httpx.AsyncClient:
    return await as_role(client, email, "it_support")


async def _staff(client, o, email) -> str:
    m = await member(
        client,
        email,
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    return m["member"]["user_id"]


async def _ask_add(it: httpx.AsyncClient, o, email="new.person@example.com", role="staff"):
    return await it.post(
        "/api/members",
        json={
            "email": email,
            "name": "New Person",
            "role": role,
            "branch_id": o["branch"]["id"],
            "department_id": o["depts"]["Finance"],
        },
        headers=csrf(it),
    )


async def _approve(c, cid, reason=REASON):
    return await c.post(f"{HELD}/{cid}/approve", json={"reason": reason}, headers=csrf(c))


async def _decline(c, cid, reason=REASON):
    return await c.post(f"{HELD}/{cid}/decline", json={"reason": reason}, headers=csrf(c))


# ---------------------------------------------------------------- the role


def test_it_support_is_an_admin_below_admin_that_never_gives_the_high_roles():
    from agentic.api.deps import Principal
    from agentic.api.routers import members

    use_settings(None)
    assert ROLES.index("it_support") == ROLES.index("admin") + 1
    assert PERMISSIONS["it_support"] == PERMISSIONS["admin"]
    assert str(role_label("admin")) == "Global admin"
    assert str(role_label("it_support")) == "IT support"

    def p(role: str) -> Principal:
        return Principal(user=User(id="u1", email="x@example.com"), workspace_id="w", role=role,
                         session_id="s")  # fmt: skip

    mine = members.assignable_roles(p("it_support"))
    assert not set(mine) & HIGH_ROLES and "management" in mine and "staff" in mine
    assert "it_support" in members.assignable_roles(p("admin"))
    assert "it_support" in members.assignable_roles(p("owner"))
    # A change approved on IT support's behalf follows their rules too, even run by the owner.
    token = set_acting_for(("it_support", "u9"))
    try:
        assert not set(members.assignable_roles(p("owner"))) & HIGH_ROLES
        assert not members.within_own(p("owner"), "admin")
        assert members.within_own(p("owner"), "staff")
    finally:
        reset_acting_for(token)
    assert members.within_own(p("owner"), "admin")


def test_no_agent_tool_changes_members_or_the_organization():
    """Point 4: an IT support person's AI has no path around the hold (it has no such tool;
    any call with their own sign-in is held like theirs)."""
    pat = re.compile(r"(?<!re)member|branch|department|hierarch|role|invite|allowance|access", re.I)
    assert [n for n in TOOLS if pat.search(n)] == []


# ---------------------------------------------------------------- hold, approve, decline


async def test_a_new_member_waits_and_is_added_with_the_approvers_sign_in(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    async with _open(it):
        r = await _ask_add(it, o)
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["held"] is True and body["code"] == "held_for_approval"
        assert "New Person" in body["summary"] and "Staff" in body["summary"]
        assert await _uid("new.person@example.com") == ""  # nothing happened yet

        mine = (await it.get(HELD)).json()
        assert [c["id"] for c in mine["mine"]] == [body["request_id"]]
        assert mine["to_decide"] == [] and mine["is_approver"] is False
        # The asker cannot approve their own.
        r = await _approve(it, body["request_id"])
        assert r.status_code == 403 and r.json()["code"] == "own_request"

        listing = (await client.get(HELD)).json()
        [c] = listing["to_decide"]
        assert c["can_decide"] and c["requested_by_name"] == "It.One"
        assert c["requester_still_it_support"] is True
        assert {d["field"]: d["value"] for d in c["details"]}["role"] == "Staff"

        # A reason is required.
        r = await _approve(client, c["id"], reason="")
        assert r.status_code == 422 and r.json()["code"] == "reason_needed"
        r = await _approve(client, c["id"])
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["applied"] is True and out["change"]["status"] == "applied"
        # The one-time password is the approver's, once; the row never keeps it.
        assert out["result"]["temp_password"]
    uid = await _uid("new.person@example.com")
    assert uid and await _role(uid) == "staff"
    owner_id = await _uid("owner@example.com")
    async with SessionLocal() as db:
        row = await db.get(HeldChange, body["request_id"])
        assert row.body_json is None and row.decided_by == owner_id
        assert out["result"]["temp_password"] not in repr(
            (row.details, row.apply_message, row.summary)
        )
        added = (await db.scalars(select(AuditLog).where(AuditLog.action == "member.added"))).all()
        assert [a.actor for a in added if a.target == uid] == [f"user:{owner_id}"]
        ok = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "held_change.approved"))
        ).one()
        assert ok.after["note"] == "approved IT support It.One's request"
    # Approving twice does nothing.
    r = await _approve(client, body["request_id"])
    assert r.status_code == 409


async def test_decline_needs_a_reason_and_cancel_is_the_askers_only(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    async with _open(it):
        a = (await _ask_add(it, o, "a@example.com")).json()["request_id"]
        b = (await _ask_add(it, o, "b@example.com")).json()["request_id"]
        assert (await _decline(client, a, reason=" ")).status_code == 422
        r = await _decline(client, a)
        assert r.status_code == 200 and r.json()["status"] == "declined"
        assert r.json()["decision_note"] == REASON
        assert (await _approve(client, a)).status_code == 409
        # Only the asker cancels.
        r = await client.post(f"{HELD}/{b}/cancel", json={}, headers=csrf(client))
        assert r.status_code == 403
        r = await it.post(f"{HELD}/{b}/cancel", json={}, headers=csrf(it))
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        assert (await _approve(client, b)).status_code == 409
    assert await _uid("a@example.com") == "" and await _uid("b@example.com") == ""


async def test_a_change_that_fails_shows_why_and_stays_open(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    async with _open(it):
        cid = (await _ask_add(it, o, "dup@example.com")).json()["request_id"]
    # Meanwhile someone adds the same person: the run is refused, the request stays open.
    await _staff(client, o, "dup@example.com")
    r = await _approve(client, cid)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["applied"] is False and out["result"] is None
    c = out["change"]
    assert c["status"] == "pending" and c["apply_status"] >= 400 and c["apply_message"]
    assert c["can_decide"] and c["attempts"] == 1
    r = await _decline(client, cid, "Already added by hand")
    assert r.json()["status"] == "declined"


async def test_an_admin_approves_and_concurrent_approvals_run_once(client, llm, temporal):
    o = await office(client)
    admin = await as_role(client, "global.admin@example.com", "admin")
    it = await _it(client, o)
    async with _open(it, admin):
        cid = (await _ask_add(it, o, "once@example.com")).json()["request_id"]
        r1, r2 = await asyncio.gather(_approve(client, cid), _approve(admin, cid))
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [200, 409], (r1.text, r2.text)
    async with SessionLocal() as db:
        n = await db.scalar(select(User.id).where(User.email == "once@example.com"))
        assert n
        row = await db.get(HeldChange, cid)
        assert row.status == "applied" and row.attempts == 1


async def test_reset_password_goes_to_the_approver_only(client, llm, temporal):
    o = await office(client)
    sid = await _staff(client, o, "sam@example.com")
    it = await _it(client, o)
    async with _open(it):
        r = await it.post(f"/api/members/{sid}/reset-password", json={}, headers=csrf(it))
        assert r.status_code == 202 and "Sam" in r.json()["summary"]
        cid = r.json()["request_id"]
    out = (await _approve(client, cid)).json()
    assert out["applied"] and out["result"]["temp_password"]
    async with SessionLocal() as db:
        row = await db.get(HeldChange, cid)
        assert out["result"]["temp_password"] not in repr(
            (row.details, row.apply_message, row.summary, row.title, row.body_json)
        )


# ---------------------------------------------------------------- every admin route is held

ADMIN_PERMS = {
    "members.manage",
    "org.manage",
    "channels.manage",
    "engine.manage",
    "storage.manage",
    "mcp.manage",
    "people_manager",
}
# Routes needing an admin permission that are not administration: company content and agent
# work an admin does day to day (their outcome is work, not access or settings).
NOT_ADMINISTRATION = {
    ("POST", "/api/sops"),
    ("PATCH", "/api/sops/{sop_id}"),
    ("DELETE", "/api/sops/{sop_id}"),
    ("POST", "/api/builders/sop"),
    ("POST", "/api/library/linked/{source_id}/sops"),
    ("POST", "/api/deliveries/{delivery_id}/retry"),
}


def _walk(routes, prefix=""):
    for r in routes:
        if type(r).__name__ == "_IncludedRouter":
            yield from _walk(r.original_router.routes, prefix + r.include_context.prefix)
        elif isinstance(r, APIRoute):
            yield prefix + r.path, r


def _perms(dep, out: set[str]) -> set[str]:
    call = dep.call
    if call is not None and getattr(call, "__qualname__", "").endswith("<locals>.checker"):
        out.add(call.__qualname__.split(".")[0])
        for cell in call.__closure__ or ():
            try:
                v = cell.cell_contents
            except ValueError:
                continue
            if isinstance(v, str):
                out.add(v)
    for d in dep.dependencies:
        _perms(d, out)
    return out


def _sample(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x1", path)


def _mutating():
    from agentic.api.main import app

    for path, r in _walk(app.routes):
        for m in sorted(r.methods - {"GET", "HEAD", "OPTIONS"}):
            yield m, path, r


def test_every_mutating_route_under_the_held_prefixes_is_held():
    missed, under = [], 0
    for m, path, _ in _mutating():
        sample = _sample(path)
        if not any(sample == p or sample.startswith(p + "/") for p, _ in held.HELD_PREFIXES):
            continue
        under += 1
        if held.area_of(m, sample) is None and not any(
            re.fullmatch(rx, sample) for rx, _ in held.NOT_HELD
        ):
            missed.append((m, path))
    assert under > 80 and missed == []
    # Every exception names a real route (none left behind by a rename).
    samples = {_sample(p) for _, p, _ in _mutating()}
    for rx, why in held.NOT_HELD:
        assert why in ("own", "check", "owner", "webhook", "sync")  # sync: P127
        assert any(re.fullmatch(rx, s) for s in samples), rx


def test_every_mutating_route_that_needs_an_admin_permission_is_held():
    missed = []
    for m, path, r in _mutating():
        if not _perms(r.dependant, set()) & ADMIN_PERMS or (m, path) in NOT_ADMINISTRATION:
            continue
        sample = _sample(path)
        if held.area_of(m, sample) is None and not any(
            re.fullmatch(rx, sample) for rx, _ in held.NOT_HELD
        ):
            missed.append((m, path))
    assert missed == []


def test_paths_are_matched_however_they_are_written():
    assert held.area_of("POST", "/api/members") == "members.manage"
    assert held.area_of("post", "/api/members/") == "members.manage"
    assert held.area_of("POST", "/api//members") == "members.manage"
    assert held.area_of("DELETE", "/api/branches/b1") == "org.manage"
    assert held.area_of("GET", "/api/members") is None
    assert held.area_of("POST", "/api/members/import/preview") is None
    assert held.area_of("POST", "/api/ai-engine/privacy") == "engine.manage"
    assert held.area_of("POST", "/api/prima/api/anything") is None  # Prima's own calls
    assert held.area_of("POST", "/api/membersx") is None


# ---------------------------------------------------------------- loopholes


async def test_it_support_cannot_touch_their_own_account_or_the_high_roles(client, llm, temporal):
    o = await office(client)
    admin_id = (await member(client, "ga@example.com", "admin"))["member"]["user_id"]
    sid = await _staff(client, o, "sara@example.com")
    it = await _it(client, o)
    me = await _uid("it.one@example.com")
    owner_id = await _uid("owner@example.com")
    async with _open(it):
        refused = [
            # their own role, access and password
            await it.patch(f"/api/members/{me}", json={"role": "admin"}, headers=csrf(it)),
            await it.put(
                f"/api/members/{me}/prima-access", json={"access": "agentic"}, headers=csrf(it)
            ),  # fmt: skip
            await it.post(f"/api/members/{me}/reset-password", json={}, headers=csrf(it)),
            await it.put(f"/api/allowances/{me}", json={"daily_tokens": 0}, headers=csrf(it)),
            # making someone owner, global admin or IT support
            await _ask_add(it, o, "boss@example.com", role="admin"),
            await _ask_add(it, o, "boss2@example.com", role="owner"),
            await _ask_add(it, o, "it2@example.com", role="it_support"),
            await it.patch(f"/api/members/{sid}", json={"role": "it_support"}, headers=csrf(it)),
            await it.post(
                "/api/members/bulk",
                json={"user_ids": [sid], "action": "access", "role": "admin"},
                headers=csrf(it),
            ),  # fmt: skip
            await it.post(
                "/api/members/import",
                json={"rows": [{"row": 2, "name": "X", "email": "x@example.com", "role": "owner"}]},
                headers=csrf(it),
            ),  # fmt: skip
            # changing a global admin or the owner
            await it.patch(f"/api/members/{admin_id}", json={"name": "Renamed"}, headers=csrf(it)),
            await it.post(f"/api/members/{admin_id}/reset-password", json={}, headers=csrf(it)),
            await it.request("DELETE", f"/api/members/{owner_id}", json={}, headers=csrf(it)),
            await it.post(
                "/api/members/bulk",
                json={"user_ids": [sid, admin_id], "action": "remove"},
                headers=csrf(it),
            ),  # fmt: skip
            await it.post(
                "/api/members/bulk", json={"user_ids": [me], "action": "remove"}, headers=csrf(it)
            ),  # fmt: skip
            await it.post(f"/api/auth/2fa/members/{admin_id}/reset", json={}, headers=csrf(it)),
        ]
        assert [r.status_code for r in refused] == [403] * len(refused), [
            r.text for r in refused if r.status_code != 403
        ]
        assert {r.json()["code"] for r in refused} == {"own_account", "high_role"}
        # A bulk action on ordinary people is held, not refused.
        r = await it.post(
            "/api/members/bulk", json={"user_ids": [sid], "action": "remove"}, headers=csrf(it)
        )
        assert r.status_code == 202 and "Sara" in r.json()["summary"]
    async with SessionLocal() as db:
        assert (await db.scalars(select(HeldChange))).all().__len__() == 1


async def test_direct_calls_delete_and_any_admin_area_are_held(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    bid = o["branch"]["id"]
    async with _open(it):
        calls = [
            await it.request("DELETE", f"/api/branches/{bid}", json={}, headers=csrf(it)),
            await it.patch(f"/api/branches/{bid}", json={"name": "Renamed Bhd"}, headers=csrf(it)),
            await it.post("/api/branches", json={"name": "New Bhd"}, headers=csrf(it)),
            await it.post("/api/members/", json={"email": "s@example.com"}, headers=csrf(it)),
            await it.put("/api/auth/2fa/policy", json={"policy": "everyone"}, headers=csrf(it)),
            await it.put("/api/allowances/policy", json={"daily_tokens": 5}, headers=csrf(it)),
            await it.put("/api/compliance/lock", json={"on": True}, headers=csrf(it)),
            await it.post("/api/tokens", json={"name": "x"}, headers=csrf(it)),
            await it.post("/api/prima/people/link", json={}, headers=csrf(it)),
        ]
        assert [r.status_code for r in calls] == [202] * len(calls), [r.text for r in calls]
        assert "Renamed Bhd" in calls[1].json()["summary"]
        # Nothing changed.
        async with SessionLocal() as db:
            b = await db.get(Branch, bid)
            assert b is not None and b.name.upper() == "MAJU SDN BHD"
            assert (await db.scalar(select(Branch.id).where(Branch.name == "NEW BHD"))) is None
        # Without the CSRF echo nothing is even held.
        r = await it.post("/api/branches", json={"name": "Sneaky"})
        assert r.status_code == 403 and r.json()["code"] == "csrf_failed"
        # A request cannot be edited after it was sent: there is no such route.
        cid = calls[0].json()["request_id"]
        r = await it.patch(f"{HELD}/{cid}", json={"path": "/api/members"}, headers=csrf(it))
        assert r.status_code == 405
        # Their own work is not held.
        r = await it.put("/api/me/prefs", json={"locale": {"language": "en"}}, headers=csrf(it))
        assert r.status_code == 200, r.text
        # Role access (owner only) is refused outright, not held.
        r = await it.put("/api/org/role-access", json={"roles": {}}, headers=csrf(it))
        assert r.status_code == 403
    rename = calls[1].json()["request_id"]
    assert (await _approve(client, rename)).json()["applied"] is True
    async with SessionLocal() as db:
        assert (await db.get(Branch, bid)).name.upper() == "RENAMED BHD"


async def test_it_support_needs_the_permission_to_ask(client, llm, temporal):
    o = await office(client)
    r = await client.put(
        "/api/org/role-access",
        json={"roles": {"it_support": {"grant": [], "revoke": ["members.manage"]}}},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    it = await _it(client, o)
    async with _open(it):
        r = await _ask_add(it, o)
        assert r.status_code == 403 and r.json()["code"] == "forbidden"
        r = await it.post("/api/branches", json={"name": "Still Ok"}, headers=csrf(it))
        assert r.status_code == 202


async def test_expired_changes_cannot_be_approved(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    async with _open(it):
        cid = (await _ask_add(it, o)).json()["request_id"]
    async with SessionLocal() as db:
        await db.execute(
            update(HeldChange)
            .where(HeldChange.id == cid)
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await db.commit()
    r = await _approve(client, cid)
    assert r.status_code == 409 and r.json()["code"] == "expired"
    listing = (await client.get(HELD)).json()
    assert listing["to_decide"] == [] and listing["decided"][0]["status"] == "expired"
    async with SessionLocal() as db:
        assert (await db.get(HeldChange, cid)).body_json is None


async def test_a_role_removed_meanwhile_still_decides_under_it_supports_rules(
    client, llm, temporal
):
    o = await office(client)
    sid = await _staff(client, o, "tom@example.com")
    it = await _it(client, o)
    me = await _uid("it.one@example.com")
    async with _open(it):
        cid = (
            await it.patch(f"/api/members/{sid}", json={"job_title": "Clerk"}, headers=csrf(it))
        ).json()["request_id"]
    r = await client.patch(
        f"/api/members/{me}",
        json={"role": "staff", "branch_id": o["branch"]["id"],
              "department_id": o["depts"]["Finance"]},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    [c] = (await client.get(HELD)).json()["to_decide"]
    assert c["requester_still_it_support"] is False and c["requester_role_now"] == "staff"
    assert (await _approve(client, cid)).json()["applied"] is True
    # The rules of the role they asked in still apply when it runs.
    async with SessionLocal() as db:
        db.add(
            HeldChange(
                workspace_id=(await db.get(Branch, o["branch"]["id"])).workspace_id,
                requested_by=me,
                requested_role="it_support",
                method="PATCH",
                path=f"/api/members/{sid}",
                content_type="application/json",
                body_json={"role": "management"},
                title="x",
                summary={"p": "x"},
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
    [c] = (await client.get(HELD)).json()["to_decide"]
    assert (await _approve(client, c["id"])).json()["applied"] is True
    assert await _role(sid) == "management"


async def test_only_approvers_and_the_asker_see_a_change(client, llm, temporal):
    o = await office(client)
    it = await _it(client, o)
    other_it = await _it(client, o, "it.two@example.com")
    mgmt = await as_role(client, "boss@example.com", "management")
    staff = await as_role(
        client,
        "plain@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    async with _open(it, other_it, mgmt, staff):
        cid = (await _ask_add(it, o)).json()["request_id"]
        for c in (other_it, mgmt, staff):
            listing = (await c.get(HELD)).json()
            assert listing["to_decide"] == [] and listing["decided"] == []
            assert listing["mine"] == []
            assert (await c.get(f"{HELD}/{cid}")).status_code == 404
            assert (await _approve(c, cid)).status_code == 404
            assert (await _decline(c, cid)).status_code == 404
        assert (await it.get(f"{HELD}/{cid}")).status_code == 200
        # The approvers' bell counts it; IT support's own does not.
        needs = (await client.get("/api/me/needs")).json()
        assert any(i["key"] == "it_changes" and i["count"] == 1 for i in needs["items"])
        needs = (await it.get("/api/me/needs")).json()
        assert not any(i["key"] == "it_changes" for i in needs["items"])


async def test_the_approver_rule_never_lets_anyone_decide_their_own():
    """Approvers are owners and global admins, never the asker (checked before anything)."""

    class P:
        def __init__(self, uid, role):
            self.user, self.role = User(id=uid, email="x@example.com"), role

    row = HeldChange(requested_by="u1")
    with pytest.raises(held.HoldError) as e:
        held.check_decider(P("u1", "owner"), row)
    assert e.value.code == "own_request"
    with pytest.raises(held.HoldError) as e:
        held.check_decider(P("u2", "it_support"), row)
    assert e.value.code == "not_approver"
    for role in ("management", "hr", "branch_manager"):
        with pytest.raises(held.HoldError):
            held.check_decider(P("u2", role), row)
    held.check_decider(P("u2", "admin"), row)
    held.check_decider(P("u2", "owner"), row)


# ---------------------------------------------------------------- the migration


def _alembic(url: str, action: str, rev: str) -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = url
    getattr(command, action)(cfg, rev)


async def test_the_migration_goes_up_down_and_up():
    name = f"{TEST_DB}_p125mig"
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
    table = "SELECT to_regclass('held_changes') IS NOT NULL"
    try:
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert "'it_support'" in await conn.fetchval(check)
            assert await conn.fetchval(table)
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "downgrade", "0075")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert "'it_support'" not in await conn.fetchval(check)
            assert not await conn.fetchval(table)
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
    finally:
        admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        finally:
            await admin.close()
