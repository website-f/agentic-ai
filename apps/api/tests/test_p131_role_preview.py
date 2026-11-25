"""P131: an owner or a global admin signs in as another role on a practice account and comes
back. Never as the owner; never started by anyone else; the practice account cannot be signed in
to with a password; the way back is the starter's own session. Synthetic people only."""

import httpx
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

URL = "/api/role-preview"


async def _me(c: httpx.AsyncClient) -> dict:
    r = await c.get("/api/auth/me")
    assert r.status_code == 200, r.text
    return r.json()


async def test_owner_tries_staff_and_comes_back(client):
    o = await office(client)
    r = await client.get(URL)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["can_start"] and not st["previewing"]
    roles = {x["role"] for x in st["roles"]}
    assert "owner" not in roles and {"admin", "staff", "hod", "hr"} <= roles
    assert st["branches"] and st["branches"][0]["departments"]

    r = await client.post(URL + "/start", json={"role": "owner"}, headers=csrf(client))
    assert r.status_code == 400

    r = await client.post(
        URL + "/start", json={"role": "staff", "branch_id": o["branch"]["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    me = await _me(client)
    assert me["role"] == "staff" and me["user"]["email"].endswith("@role-preview.local")
    assert (await client.get(URL)).json()["previewing"] is True
    practice = me["user"]["email"]
    # A practice account starts nothing of its own.
    r = await client.post(URL + "/start", json={"role": "hod"}, headers=csrf(client))
    assert r.status_code == 403

    r = await client.post(URL + "/stop", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json() == {"signed_out": False}
    me = await _me(client)
    assert me["role"] == "owner" and me["user"]["email"] == "owner@example.com"

    # The same practice account next time (kept), and no password opens it.
    r = await client.post(
        URL + "/start", json={"role": "staff", "branch_id": o["branch"]["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert (await _me(client))["user"]["email"] == practice
    await client.post(URL + "/stop", json={}, headers=csrf(client))
    async with SessionLocal() as db:
        users = (await db.scalars(select(User).where(User.email == practice))).all()
        assert len(users) == 1
        m = await db.scalar(select(Membership).where(Membership.user_id == users[0].id))
        assert m is not None and m.role == "staff" and m.branch_id == o["branch"]["id"]
        assert m.department_id is not None
        logs = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "auth.role_preview_start"))
        ).all()
        assert len(logs) == 2
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as other:
        r = await other.post("/api/auth/login", json={"email": practice, "password": "x" * 12})
        assert r.status_code in (401, 422)  # the address is not even accepted


async def test_global_admin_may_staff_may_not(client):
    await office(client)
    admin = await as_role(client, "ga@example.com", "admin")
    staff = await as_role(client, "st@example.com", "viewer")
    try:
        assert (await staff.get(URL)).json()["can_start"] is False
        r = await staff.post(URL + "/start", json={"role": "viewer"}, headers=csrf(staff))
        assert r.status_code == 403
        r = await staff.post(URL + "/stop", json={}, headers=csrf(staff))
        assert r.status_code == 400

        r = await admin.post(URL + "/start", json={"role": "management"}, headers=csrf(admin))
        assert r.status_code == 200, r.text
        assert (await _me(admin))["role"] == "management"
        r = await admin.post(URL + "/stop", json={}, headers=csrf(admin))
        assert r.status_code == 200
        assert (await _me(admin))["user"]["email"] == "ga@example.com"
    finally:
        await admin.aclose()
        await staff.aclose()
