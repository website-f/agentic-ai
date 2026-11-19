"""P115 (Fitri, 19 Nov 2026: "WAHA sessions keeps on failing"). On live, WhatsApp removed the office
phone's linked device ("conflict: device_removed"); the session went FAILED and every Start reused
its dead login ("Connection Failure"). Now Start restarts it once and, if that fails, drops the
dead login and shows a new QR; a watchdog on the 10-minute round restarts dropped sessions and
tells whoever manages channels when only the office phone can fix it."""

import httpx
import pytest
from sqlalchemy import select

from agentic.channels import wa_watch, whatsapp
from agentic.core.db import SessionLocal
from agentic.models import Channel, Delivery

from .conftest import csrf
from .test_agents import office


class Gateway:
    """A WAHA whose session can be dead (restart fails again) or only dropped (restart works)."""

    def __init__(self, status: str = "FAILED", dead: bool = True) -> None:
        self.status, self.dead = status, dead
        self.calls: list[str] = []

    def handler(self, r: httpx.Request) -> httpx.Response:
        path, m = r.url.path, r.method
        self.calls.append(f"{m} {path}")
        if path == "/api/sessions" and m == "POST":
            return httpx.Response(422, json={"error": "exists"})
        if path == "/api/sessions/default" and m == "GET":
            me = {"id": "60198712081@c.us", "pushName": "Office"}
            return httpx.Response(200, json={"name": "default", "status": self.status, "me": me})
        if path == "/api/sessions/default" and m == "PUT":
            return httpx.Response(200, json={})
        if path == "/api/sessions/default/restart":
            self.status = "FAILED" if self.dead else "WORKING"
            return httpx.Response(201, json={})
        if path == "/api/sessions/default/logout":
            self.status, self.dead = "STOPPED", False
            return httpx.Response(201, json={})
        if path == "/api/sessions/default/start":
            self.status = "SCAN_QR_CODE"
            return httpx.Response(201, json={})
        if path == "/api/default/auth/qr":
            return httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
        return httpx.Response(404, json={"error": path})


@pytest.fixture
def gateway(monkeypatch):
    from agentic.core.config import settings

    g = Gateway()
    whatsapp.transport = httpx.MockTransport(g.handler)
    monkeypatch.setattr(settings, "waha_url", "http://waha.test:3000")
    monkeypatch.setattr(settings, "waha_api_key", "waha-key")
    monkeypatch.setattr(whatsapp, "RECOVER_WAIT", 0.0)
    yield g
    whatsapp.transport = None


async def _channel(client, gateway) -> str:
    await office(client)
    gateway.status = "WORKING"
    r = await client.post("/api/channels/whatsapp", json={"provider": "waha"}, headers=csrf(client))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_start_on_a_dead_login_shows_a_new_qr(client, gateway):
    ch = await _channel(client, gateway)
    gateway.status, gateway.dead, gateway.calls = "FAILED", True, []
    r = await client.post(f"/api/channels/{ch}/whatsapp/start", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["rescan"] is True and out["status"] == "SCAN_QR_CODE" and out["qr"]
    assert "POST /api/sessions/default/restart" in gateway.calls
    assert "POST /api/sessions/default/logout" in gateway.calls  # the dead login is dropped


async def test_start_after_a_drop_just_reconnects(client, gateway):
    ch = await _channel(client, gateway)
    gateway.status, gateway.dead, gateway.calls = "FAILED", False, []
    r = await client.post(f"/api/channels/{ch}/whatsapp/start", json={}, headers=csrf(client))
    out = r.json()
    assert out["rescan"] is False and out["status"] == "WORKING"
    assert "POST /api/sessions/default/logout" not in gateway.calls  # no new scan needed


async def test_the_watchdog_restarts_then_tells_the_channel_managers(client, gateway):
    ch = await _channel(client, gateway)
    gateway.status, gateway.dead = "FAILED", True
    for _ in range(wa_watch.MAX_RESTARTS):
        async with SessionLocal() as db:
            out = await wa_watch.watch(db)
        assert out["wa_restarted"] == 1 and out["wa_down"] == 0
    async with SessionLocal() as db:
        out = await wa_watch.watch(db)
        assert out["wa_restarted"] == 0 and out["wa_down"] == 1
        row = await db.get(Channel, ch)
        assert row.state["needs_scan"] is True and row.state["status"] == "FAILED"
        # Told once a day (the owner manages channels): no second notice on the next round.
        before = len((await db.scalars(select(Delivery))).all())
        await wa_watch.watch(db)
        assert len((await db.scalars(select(Delivery))).all()) == before
    # Back to work: the count resets.
    gateway.status = "WORKING"
    async with SessionLocal() as db:
        await wa_watch.watch(db)
        row = await db.get(Channel, ch)
        assert row.state["restarts"] == 0 and "needs_scan" not in row.state


async def test_the_watchdog_brings_back_a_dropped_session(client, gateway):
    ch = await _channel(client, gateway)
    gateway.status, gateway.dead = "FAILED", False
    async with SessionLocal() as db:
        out = await wa_watch.watch(db)
    assert out["wa_restarted"] == 1 and gateway.status == "WORKING"
    async with SessionLocal() as db:
        await wa_watch.watch(db)
        row = await db.get(Channel, ch)
        assert row.state["status"] == "WORKING" and row.state["restarts"] == 0
