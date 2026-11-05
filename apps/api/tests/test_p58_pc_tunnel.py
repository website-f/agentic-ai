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

        # P69: nothing chosen in the workspace: ePerolehan still goes through a linked computer
        # that allowed it (a residential line), never from the server's own address.
        _, w, status = await _connect(port, "www.eperolehan.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 200")
        w.close()
        # Other sites are not the gateway's (the egress proxy goes direct).
        _, w, status = await _connect(port, "example.com", ws_id)
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
    """P62: choosing a computer asks its person there (Allow / Not now); until they allow it
    the site is refused with why, and never goes out from the server instead."""
    o = await office(client)
    owner_id, ws_id = await ids_of("owner@example.com")
    await personal_agent(o, owner_id, ws_id, is_twin=True)
    dev = await link(client)
    pc = await SitePC(dev["token"]).start()
    try:
        r = await client.put(
            "/api/org/web",
            json={"mode": "pc", "sites": ["eperolehan.gov.my"], "device_id": dev["device_id"]},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        assert r.json()["asked"] is True and r.json()["mode"] == "pc"
        for _ in range(50):
            if any(m["type"] == "tunnel_ask" for m in pc.other):
                break
            await asyncio.sleep(0.05)
        ask = next(m for m in pc.other if m["type"] == "tunnel_ask")
        assert ask["hosts"] == ["eperolehan.gov.my"] and ask["by"]
        status, msg, device = await tunnel.decide(ws_id, "eperolehan.gov.my")
        assert status == 503 and "has not allowed it yet" in msg and device is None
        assert "has not allowed" in await tunnel.unavailable(ws_id, "www.eperolehan.gov.my")
        assert await tunnel.unavailable(ws_id, "example.com") == ""  # other sites: the server

        # Allow pressed on the computer's page: the agent reports it, and it goes through.
        await pc.ws.send_json(
            {"type": "state", "tunnel": {"on": True, "hosts": ["eperolehan.gov.my"]}}
        )
        for _ in range(50):
            if (await tunnel.route(ws_id, "www.eperolehan.gov.my")).kind == "computer":
                break
            await asyncio.sleep(0.05)
        assert (await tunnel.route(ws_id, "www.eperolehan.gov.my")).kind == "computer"
        got = (await client.get("/api/org/web")).json()
        me = next(c for c in got["computers"] if c["id"] == dev["device_id"])
        assert me["allows"] == ["eperolehan.gov.my"] and me["online"] and not me["can_ask"]

        # A computer carries only listed sites.
        r = await client.put(
            "/api/org/web",
            json={"mode": "pc", "sites": ["*"], "device_id": dev["device_id"]},
            headers=csrf(client),
        )
        assert r.status_code == 422
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


async def test_the_chosen_way_is_used_or_refused_never_the_servers_address(client, llm, temporal):
    """P62: with proxies chosen, a site whose proxies are all down, or whose proxies wait for
    approval on Approved services, is refused with why (503). Before, both quietly went out
    from the server's own address, the one the site had blocked."""
    await office(client)
    _, ws_id = await ids_of("owner@example.com")
    dead = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    dead_port = dead.sockets[0].getsockname()[1]
    dead.close()
    gateway = await asyncio.start_server(tunnel.handle, "127.0.0.1", 0)
    gport = gateway.sockets[0].getsockname()[1]
    try:
        none = await client.put(
            "/api/org/web", json={"mode": "proxy", "sites": ["*"]}, headers=csrf(client)
        )
        assert none.status_code == 422  # nothing to go through yet
        r = await client.put(
            "/api/org/web",
            json={
                "mode": "proxy",
                "sites": ["eperolehan.gov.my"],
                "proxy_list": f"127.0.0.1:{dead_port}:u:p",
            },
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["mode"] == "proxy" and got["sites"] == ["eperolehan.gov.my"]
        assert len(got["proxies"]) == 1 and got["proxies_approved"] is True

        rr, ww, status = await _connect(gport, "www.eperolehan.gov.my", ws_id)
        assert status.startswith(b"HTTP/1.1 503"), status
        assert b"proxies answered" in await asyncio.wait_for(rr.read(300), 5)
        ww.close()
        _, ww, status = await _connect(gport, "news.example.com", ws_id)  # not listed: server
        assert status.startswith(b"HTTP/1.1 409")
        ww.close()

        # The approved-services lock on, proxies not approved: refused with why.
        lock = await client.put("/api/compliance/lock", json={"on": True}, headers=csrf(client))
        assert lock.status_code == 200, lock.text
        assert "approval" in await tunnel.unavailable(ws_id, "www.eperolehan.gov.my")
        check = await client.post(
            "/api/org/web/check", json={"site": "eperolehan.gov.my"}, headers=csrf(client)
        )
        assert check.status_code == 200
        assert check.json()["way"] == "refuse" and "approval" in check.json()["why"]

        # Browsing from here again: every site goes out from the server.
        await client.put("/api/org/web", json={"mode": "server", "sites": []}, headers=csrf(client))
        assert (await tunnel.route(ws_id, "www.eperolehan.gov.my")).kind == "server"
        log = (await client.get("/api/audit")).json()["items"]
        assert any(e["action"] == "web.route" for e in log)
    finally:
        gateway.close()


def test_a_sites_answer_reads_as_opened_or_blocked():
    """P62: the check reads ePerolehan's block page: refused, and the address it saw."""
    page = (
        "<html><head><style>body{}</style></head><body><h1>ePerolehan Access Is Currently "
        "Unavailable</h1><p>Your request was blocked for security reasons.</p>"
        "<p>Your IP address: 84.46.249.133</p><script>x()</script></body></html>"
    )
    got = tunnel.read_answer(403, page)
    assert got["blocked"] and not got["ok"] and got["seen_ip"] == "84.46.249.133"
    assert "blocked for security reasons" in got["says"]
    fine = tunnel.read_answer(200, "<html><body>Welcome to ePerolehan</body></html>")
    assert fine["ok"] and not fine["blocked"] and fine["seen_ip"] == "" and fine["says"] == ""


def test_saved_before_p62_the_two_switches_become_one_choice():
    from agentic.models import Workspace

    ws = Workspace(id="w1", name="x", settings={"pc_tunnel": {"on": True, "hosts": ["a.gov.my"]}})
    assert tunnel.mode_of(ws) == tunnel.Mode("pc", ["a.gov.my"])
    ws.settings = {"web_proxy": {"on": True}}
    assert tunnel.mode_of(ws) == tunnel.Mode("proxy", ["*"])
    ws.settings = {}
    assert tunnel.mode_of(ws) == tunnel.Mode("pc", ["eperolehan.gov.my"])  # P69: the default
    ws.settings = {"web_route": {"mode": "pc", "sites": ["*"]}}
    assert tunnel.mode_of(ws).sites == ["eperolehan.gov.my"]  # a computer never takes every site


async def test_p72_each_persons_work_goes_through_their_own_pc(client, llm, temporal):
    """P72: ePerolehan work runs on the PC of the person it is for: a personal AI's owner, or
    whoever gave a shared agent its task. Never another person's PC; the office's own work
    (no person) alone uses the company's chosen one."""
    from agentic.core.valkey import valkey
    from agentic.devices.core import online_key
    from agentic.models import Agent

    from .test_office_roles import member

    o = await office(client)
    await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    owner_id, ws_id = await ids_of("owner@example.com")
    aina_id, _ = await ids_of("aina@example.com")
    async with SessionLocal() as db:
        mine = Device(workspace_id=ws_id, user_id=owner_id, name="Owner PC", token_hash="h-owner",
                      tunnel_hosts=["eperolehan.gov.my"])  # fmt: skip
        hers = Device(workspace_id=ws_id, user_id=aina_id, name="Aina PC", token_hash="h-aina",
                      tunnel_hosts=["eperolehan.gov.my"])  # fmt: skip
        db.add_all([mine, hers])
        await db.commit()
        mine_id, hers_id = mine.id, hers.id
    for d in (mine_id, hers_id):
        await valkey().set(online_key(d), "1", ex=60)

    twin = await personal_agent(o, owner_id, ws_id, is_twin=True)
    async with SessionLocal() as db:
        shared = Agent(workspace_id=ws_id, branch_id=o["branch"]["id"], slug="tender-clerk",
                       name="Tender Clerk", role="Tenders")  # fmt: skip
        db.add(shared)
        await db.commit()
        shared_id = shared.id

    # The owner's own AI: the owner's PC, nobody else's.
    r = await tunnel.route(ws_id, "www.eperolehan.gov.my", twin.id)
    assert (r.kind, r.device_id) == ("computer", mine_id)
    # A shared agent working on Aina's task: Aina's PC.
    await tunnel.remember_person(shared_id, aina_id)
    r = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert (r.kind, r.device_id) == ("computer", hers_id)
    # Aina's PC off: refused by name, never the owner's PC instead.
    await valkey().delete(online_key(hers_id))
    r = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert r.kind == "refuse" and "Aina PC" in r.why and "offline" in r.why
    # A person with no PC: told to link their own.
    await tunnel.remember_person(shared_id, owner_id)
    async with SessionLocal() as db:
        d = await db.get(Device, mine_id)
        d.tunnel_hosts = []
        await db.commit()
    r = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert r.kind == "refuse" and "has not allowed it yet" in r.why
    # The office's own work (no person): the company's choice, here none ready -> refused.
    await tunnel.remember_person(shared_id, None)
    r = await tunnel.route(ws_id, "www.eperolehan.gov.my", shared_id)
    assert r.kind == "refuse"
    # Other sites are not the gateway's.
    assert (await tunnel.route(ws_id, "example.com", twin.id)).kind == "server"
    # The browser's login names its agent; a forged one is ignored.
    user = f"{ws_id}.{twin.id}"
    good = base64.b64encode(f"{user}:{tunnel.sign(user)}".encode()).decode()
    assert tunnel._credentials({"proxy-authorization": f"Basic {good}"}) == (ws_id, twin.id)
    bad = base64.b64encode(f"{ws_id}.{shared_id}:{tunnel.sign(user)}".encode()).decode()
    assert tunnel._credentials({"proxy-authorization": f"Basic {bad}"}) is None
