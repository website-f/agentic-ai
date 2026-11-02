"""P58: one site's traffic through a company computer. The gateway tunnels the egress proxy's
CONNECT through the workspace's chosen computer only when the setting is on, the site is on
the list, the computer's own person allows it and the computer is online; otherwise it says
"not mine" (409, the egress goes direct) or refuses (503, the workspace said wait)."""

import asyncio
import base64

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.devices import tunnel
from agentic.models import Device

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_devices import FakePC, FakeWS, ids_of, link, personal_agent


class SitePC(FakePC):
    """A computer that opens the "site" itself: it echoes what the browser sends."""

    async def handle(self, method: str, params: dict) -> dict:
        if method != "net.open":
            return await super().handle(method, params)
        relay = await FakeWS(f"/api/devices/cdp/{params['channel']}").connect()
        await relay.send_json({"type": "hello", "token": self.token})
        self.opened = (params["host"], params["port"])

        async def echo() -> None:
            while (data := await relay.recv(timeout=None)) is not None:
                await relay.send_bytes(b"SITE:" + data)

        self.echo = asyncio.create_task(echo())
        return {"ok": True}


async def _connect(port: int, host: str, ws_id: str | None, password: str | None = None):
    r, w = await asyncio.open_connection("127.0.0.1", port)
    head = f"CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\n"
    if ws_id is not None:
        cred = base64.b64encode(f"{ws_id}:{password or tunnel.sign(ws_id)}".encode()).decode()
        head += f"Proxy-Authorization: Basic {cred}\r\n"
    w.write((head + "\r\n").encode())
    await w.drain()
    status = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 15)
    return r, w, status


async def test_a_site_goes_through_the_chosen_company_computer(client, llm, temporal):
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client)
    pc = await SitePC(dev["token"]).start()
    server = await asyncio.start_server(tunnel.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        # The computer's person lets the site through (what `agentic-pc tunnel on` sends).
        await pc.ws.send_json(
            {"type": "state", "tunnel": {"on": True, "hosts": ["eperolehan.gov.my"]}}
        )
        for _ in range(50):
            async with SessionLocal() as db:
                d = await db.scalar(select(Device).where(Device.id == dev["device_id"]))
                if d.tunnel_hosts == ["eperolehan.gov.my"]:
                    break
            await asyncio.sleep(0.05)
        assert d.tunnel_hosts == ["eperolehan.gov.my"]

        # Off in the workspace: not the gateway's (the egress proxy goes direct).
        _, w, status = await _connect(port, "www.eperolehan.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 409")
        w.close()

        r = await client.put(
            "/api/org/computers/tunnel",
            json={"on": True, "device_id": dev["device_id"], "hosts": ["eperolehan.gov.my"]},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["on"] and got["fallback"] == "wait"
        assert next(c for c in got["computers"] if c["id"] == dev["device_id"])["allows"] == [
            "eperolehan.gov.my"
        ]

        # Through the computer: the bytes reach the "site" it opened, and come back.
        r1, w1, status = await _connect(port, "www.eperolehan.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 200"), status
        assert pc.opened == ("www.eperolehan.gov.my", 443)
        w1.write(b"client hello")
        await w1.drain()
        assert await asyncio.wait_for(r1.read(100), 5) == b"SITE:client hello"
        w1.close()

        # A forged password, another site: never tunnelled.
        _, w, status = await _connect(port, "www.eperolehan.gov.my", ws_id, "forged")
        assert status.startswith(b"HTTP/1.1 409")
        w.close()
        _, w, status = await _connect(port, "www.other.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 409")
        w.close()

        # The computer goes offline: refused, with why (the workspace said wait).
        await pc.stop()
        _, w, status = await _connect(port, "www.eperolehan.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 503")
        w.close()
        log = (await client.get("/api/audit")).json()["items"]
        assert any(e["action"] == "devices.tunnel" for e in log)
    finally:
        server.close()
        await pc.stop()


async def test_the_computer_must_allow_the_site_itself(client, llm, temporal):
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client)
    pc = await SitePC(dev["token"]).start()
    try:
        await client.put(
            "/api/org/computers/tunnel",
            json={"on": True, "device_id": dev["device_id"], "fallback": "direct"},
            headers=csrf(client),
        )
        status, msg, device = await tunnel.decide(ws_id, "eperolehan.gov.my")
        # Not allowed on the computer, and the workspace lets it go direct meanwhile.
        assert status == 409 and "does not let" in msg and device is None
    finally:
        await pc.stop()


async def test_work_on_the_site_opens_on_the_computers_screen(client, llm, temporal):
    """P59: with "show" on, a task that works only on the chosen sites opens its browser on
    that computer (a real window its person watches); otherwise on the server."""
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client)
    pc = await SitePC(dev["token"]).start()
    try:
        await pc.ws.send_json(
            {"type": "state", "tunnel": {"on": True, "hosts": ["eperolehan.gov.my"]}}
        )
        await client.put(
            "/api/org/computers/tunnel",
            json={"on": True, "device_id": dev["device_id"], "show": True},
            headers=csrf(client),
        )
        for _ in range(50):
            async with SessionLocal() as db:
                got = await tunnel.screen_for(db, ws_id, ["eperolehan.gov.my"])
            if got[0]:
                break
            await asyncio.sleep(0.05)
        assert got == (dev["device_id"], "")
        async with SessionLocal() as db:
            assert await tunnel.screen_for(db, ws_id, None) == ("", "")  # any site: the server
            assert await tunnel.screen_for(db, ws_id, ["example.com"]) == ("", "")
        await pc.stop()
        async with SessionLocal() as db:  # offline, and the workspace said wait: why
            dev_id, why = await tunnel.screen_for(db, ws_id, ["eperolehan.gov.my"])
        assert dev_id == "" and "offline" in why
    finally:
        await pc.stop()


async def test_the_task_rests_when_the_site_needs_a_break(client, llm, temporal, monkeypatch):
    """P59: the site budget's rest becomes the task's rest (the workflow sleeps it), and the
    agent reads a plain note, not an error, so it carries on afterwards."""
    from agentic.agents import runtime
    from agentic.models import AgentMessage

    from .test_agents import new_agent, new_task

    o = await office(client)
    a = await new_agent(client, o, "Rina", tools={"browser_open": "allow"})
    t = await new_task(client, a, "Check tender QT123 on ePerolehan")
    await client.post(f"/api/tasks/{t['id']}/start", json={}, headers=csrf(client))

    async def resting(ctx, name, args, call_id):
        return "Error: SITE_REST 420: a short break after a long sitting, as a person takes"

    monkeypatch.setattr(runtime, "run_tool_once", resting)
    llm.call("browser_open", url="https://www.eperolehan.gov.my/")
    r = await runtime.run_task_step(t["id"])
    assert r.state == "rest" and r.timeout_seconds == 420
    async with SessionLocal() as db:
        note = await db.scalar(
            select(AgentMessage.content).where(
                AgentMessage.task_id == t["id"], AgentMessage.role == "tool"
            )
        )
    assert note.startswith("Paused on the site: a short break") and "SITE_REST" not in note


class FakeProxy:
    """An outbound proxy: checks its password, then echoes what passes through it."""

    def __init__(self, user: str = "u", password: str = "p") -> None:  # noqa: S107 - a test fake
        self.auth = base64.b64encode(f"{user}:{password}".encode()).decode()
        self.connects: list[str] = []

    async def handle(self, r, w) -> None:
        head = await r.readuntil(b"\r\n\r\n")
        if f"Proxy-Authorization: Basic {self.auth}".encode() not in head:
            w.write(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            await w.drain()
            w.close()
            return
        self.connects.append(head.split(b" ")[1].decode())
        w.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
        await w.drain()
        while data := await r.read(4096):
            w.write(b"VIA-PROXY:" + data)
            await w.drain()
        w.close()


async def test_sites_go_through_the_companys_proxies_with_failover(client, llm, temporal):
    """P60: on, every site goes through the company's own proxy; a dead proxy is set aside and
    the next one carries it; the same site keeps the same proxy."""
    await office(client)
    _, ws_id = await ids_of("owner@example.com")
    fake = FakeProxy()
    good = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
    good_port = good.sockets[0].getsockname()[1]
    dead = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    dead_port = dead.sockets[0].getsockname()[1]
    dead.close()  # nothing listens there any more
    gateway = await asyncio.start_server(tunnel.handle, "127.0.0.1", 0)
    gport = gateway.sockets[0].getsockname()[1]
    try:
        bad = await client.put(
            "/api/org/proxies", json={"on": True, "list": "not a proxy"}, headers=csrf(client)
        )
        assert bad.status_code == 422
        listing = f"127.0.0.1:{dead_port}:u:p\n127.0.0.1:{good_port}:u:p\n"
        r = await client.put(
            "/api/org/proxies", json={"on": True, "list": listing}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["on"] and len(got["proxies"]) == 2 and "password" not in str(got)
        assert all(p["user"].endswith("…") for p in got["proxies"])  # never the full name

        for _ in range(2):  # the second time it goes straight to the one that worked
            rr, ww, status = await _connect(gport, "news.example.com", ws_id)
            assert status.startswith(b"HTTP/1.1 200"), status
            ww.write(b"hi")
            await ww.drain()
            assert await asyncio.wait_for(rr.read(100), 5) == b"VIA-PROXY:hi"
            ww.close()
        assert fake.connects == ["news.example.com:443", "news.example.com:443"]

        # Off: not routed (the egress proxy goes out from the server as before).
        await client.put("/api/org/proxies", json={"on": False}, headers=csrf(client))
        _, ww, status = await _connect(gport, "news.example.com", ws_id)
        assert status.startswith(b"HTTP/1.1 409")
        ww.close()
        ov = (await client.get("/api/compliance")).json()
        assert any(s["key"] == "proxy" for s in ov["services"])  # an outside service to approve
    finally:
        good.close()
        gateway.close()
