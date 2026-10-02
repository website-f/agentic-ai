"""Operator CLI (agentic/admin.py): password reset for a locked-out owner."""

import httpx

from agentic import admin

from .conftest import setup_owner


async def test_reset_password_from_the_server(client: httpx.AsyncClient, capsys):
    await setup_owner(client)
    assert (await client.get("/api/auth/me")).status_code == 200
    await admin.reset_password("Owner@Example.com")
    temp = capsys.readouterr().out.split(": ", 1)[1].splitlines()[0]
    assert (await client.get("/api/auth/me")).status_code == 401  # old sessions ended

    r = await client.post(
        "/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-battery"}
    )
    assert r.status_code == 401
    r = await client.post("/api/auth/login", json={"email": "owner@example.com", "password": temp})
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is True

    from sqlalchemy import select

    from agentic.core.db import SessionLocal
    from agentic.models import AuditLog

    async with SessionLocal() as db:
        actions = (await db.scalars(select(AuditLog.action))).all()
    assert "member.password_reset" in actions
