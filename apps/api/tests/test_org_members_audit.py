import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from .conftest import csrf, setup_owner


async def _login_as(client: httpx.AsyncClient, email: str, password: str) -> None:
    client.cookies.clear()
    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text


async def _add_member(client: httpx.AsyncClient, email: str, role: str) -> str:
    r = await client.post(
        "/api/members",
        json={"email": email, "name": email.split("@")[0], "role": role},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    return r.json()["temp_password"]


async def _activate(client: httpx.AsyncClient, email: str, temp: str, new: str) -> None:
    await _login_as(client, email, temp)
    r = await client.post(
        "/api/auth/change-password",
        json={"current_password": temp, "new_password": new},
        headers=csrf(client),
    )
    assert r.status_code == 200


async def test_branch_seeds_default_departments(client: httpx.AsyncClient):
    await setup_owner(client)
    r = await client.post(
        "/api/branches", json={"name": "Syarikat Maju Sdn Bhd"}, headers=csrf(client)
    )
    assert r.status_code == 201
    body = r.json()
    assert body["slug"] == "syarikat-maju-sdn-bhd"
    assert [d["name"] for d in body["departments"]] == [
        "Management",
        "Finance",
        "Research",
        "Operations",
        "Data",
        "Writing",
    ]

    bare = await client.post(
        "/api/branches",
        json={"name": "Syarikat Maju Sdn Bhd", "seed_departments": False},
        headers=csrf(client),
    )
    assert bare.json()["slug"] == "syarikat-maju-sdn-bhd-2"
    assert bare.json()["departments"] == []


async def test_department_crud(client: httpx.AsyncClient):
    await setup_owner(client)
    b = (
        await client.post(
            "/api/branches", json={"name": "Alpha", "seed_departments": False}, headers=csrf(client)
        )
    ).json()
    d = await client.post(
        f"/api/branches/{b['id']}/departments", json={"name": "Legal"}, headers=csrf(client)
    )
    assert d.status_code == 201
    dept_id = d.json()["id"]

    renamed = await client.patch(
        f"/api/departments/{dept_id}", json={"name": "Legal & Risk"}, headers=csrf(client)
    )
    assert renamed.json()["name"] == "Legal & Risk"

    gone = await client.delete(
        f"/api/departments/{dept_id}", headers={"content-type": "application/json", **csrf(client)}
    )
    assert gone.status_code == 204
    branches = (await client.get("/api/branches")).json()
    assert branches[0]["departments"] == []


async def test_viewer_cannot_change_org(client: httpx.AsyncClient):
    await setup_owner(client)
    temp = await _add_member(client, "vic@example.com", "viewer")
    await _activate(client, "vic@example.com", temp, "viewer-password-1")
    assert (await client.get("/api/branches")).status_code == 200
    r = await client.post("/api/branches", json={"name": "Nope"}, headers=csrf(client))
    assert r.status_code == 403 and r.json()["code"] == "forbidden"


async def test_admin_cannot_touch_owner_and_last_owner_is_protected(client: httpx.AsyncClient):
    owner = await setup_owner(client)
    temp = await _add_member(client, "adm@example.com", "admin")
    await _activate(client, "adm@example.com", temp, "admin-password-1")

    promote = await client.post(
        "/api/members",
        json={"email": "x@example.com", "name": "X", "role": "owner"},
        headers=csrf(client),
    )
    assert promote.status_code == 403 and promote.json()["code"] == "owner_only"
    demote = await client.patch(
        f"/api/members/{owner['user']['id']}", json={"role": "viewer"}, headers=csrf(client)
    )
    assert demote.status_code == 403

    await _login_as(client, "owner@example.com", "correct-horse-battery")
    self_change = await client.patch(
        f"/api/members/{owner['user']['id']}", json={"role": "admin"}, headers=csrf(client)
    )
    assert self_change.status_code == 400 and self_change.json()["code"] == "self_change"


async def test_workspaces_are_isolated(client: httpx.AsyncClient):
    from agentic.core.db import SessionLocal
    from agentic.models import Branch, Workspace

    await setup_owner(client)
    async with SessionLocal() as db:
        other = Workspace(name="Someone Else", slug="someone-else")
        db.add(other)
        await db.flush()
        db.add(Branch(workspace_id=other.id, name="Hidden", slug="hidden"))
        await db.commit()
        hidden = await db.scalar(text("SELECT id FROM branches WHERE slug = 'hidden'"))

    names = [b["name"] for b in (await client.get("/api/branches")).json()]
    assert "Hidden" not in names
    r = await client.patch(f"/api/branches/{hidden}", json={"name": "Taken"}, headers=csrf(client))
    assert r.status_code == 404


async def test_audit_chain_verifies_and_is_append_only(client: httpx.AsyncClient):
    await setup_owner(client)
    await client.post("/api/branches", json={"name": "Alpha"}, headers=csrf(client))
    await client.post("/api/branches", json={"name": "Beta"}, headers=csrf(client))

    page = (await client.get("/api/audit")).json()
    actions = [i["action"] for i in page["items"]]
    assert actions[:2] == ["branch.created", "branch.created"]
    assert "workspace.created" in actions
    assert page["items"][0]["actor_name"] == "Owner One"

    verify = (await client.get("/api/audit/verify")).json()
    assert verify["ok"] is True and verify["checked"] >= 3

    from agentic.core.db import engine

    with pytest.raises(DBAPIError, match="append-only"):
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE audit_log SET action = 'tampered'"))
