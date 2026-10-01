import httpx

from agentic.core.db import SessionLocal
from agentic.seed import ACCOUNTS, seed

from .conftest import setup_owner


async def test_seed_creates_one_login_per_role(client: httpx.AsyncClient):
    async with SessionLocal() as db:
        emails = await seed(db)
    assert emails == [f"{local}@example.com" for _, _, local in ACCOUNTS]
    assert (await client.get("/api/auth/setup-status")).json() == {"needs_setup": False}

    # Last login wins on the shared client, so sign in as the owner last.
    for role, _, local in reversed(ACCOUNTS):
        client.cookies.clear()
        r = await client.post(
            "/api/auth/login",
            json={"email": f"{local}@example.com", "password": "agentic-test-2026"},
        )
        assert r.status_code == 200, r.text
        me = r.json()
        assert me["role"] == role
        assert me["workspace"]["name"] == "Qbot Group"

    branches = (await client.get("/api/branches")).json()
    assert [b["name"] for b in branches] == ["Qbot Studio Sdn Bhd"]
    assert len(branches[0]["departments"]) == 6


async def test_seed_runs_once(client: httpx.AsyncClient):
    async with SessionLocal() as db:
        assert await seed(db)
    async with SessionLocal() as db:
        assert await seed(db) == []


async def test_seed_never_touches_a_set_up_install(client: httpx.AsyncClient):
    await setup_owner(client)
    async with SessionLocal() as db:
        assert await seed(db) == []
    r = await client.post(
        "/api/auth/login", json={"email": "owner@example.com", "password": "agentic-test-2026"}
    )
    assert r.status_code == 401
