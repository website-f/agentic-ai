"""P58: one site's traffic out through a company computer (e.g. ePerolehan from the office's
own internet line instead of this server's address).

The agents' browser still runs on this server (each agent its own machine). Its requests go to
the egress proxy as always; for the sites a workspace chose, the egress proxy hands the CONNECT
to this gateway (inside the API process, where the computers' sockets live) with the
workspace's proxy credentials (the browser service signs them per workspace; a page cannot
forge them). The gateway checks the workspace's setting and that the computer's own person
allowed those sites (`agentic-pc tunnel on ...`, devices.tunnel_hosts), asks the computer to
open the connection (`net.open`), and passes the bytes both ways over a relay channel. TLS
stays end to end between the browser and the site: the computer only relays encrypted bytes.

Answers to the egress proxy:
- 200: tunnelled through the computer.
- 409: not for this gateway (setting off, another site, or the workspace lets it go direct
  when the computer is unavailable): the egress proxy goes out directly as before.
- 503: the computer is unavailable and the workspace said not to go direct; the message
  says why ("the computer is offline").

Settings ("pc_tunnel" in the workspace's settings): {on, device_id, hosts, fallback}.
fallback: "wait" (refuse while the computer is unavailable, the default) | "direct" |
"proxy" (P60: the company's own proxies, devices/proxies.py).

P60, three ways out, chosen per site on Settings > Web connections: this server (409, the egress
proxy goes direct), the company computer (above), or the company's proxies (the gateway opens
the CONNECT through one of them). A way out that is itself unavailable (the computer offline, a
proxy down) falls back as the setting says; a site refusing or blocking a request never moves
it elsewhere.
"""

import asyncio
import base64
import contextlib
import hashlib
import hmac
import logging
from dataclasses import dataclass
from typing import Any

from ..core.config import settings
from ..core.db import SessionLocal
from ..engine import compliance
from ..models import Device, Workspace
from . import bridge, core, relay
from . import proxies as proxies_mod
from .core import DeviceError

log = logging.getLogger("agentic.tunnel")

SETTINGS_KEY = "pc_tunnel"
DEFAULT_HOSTS = ["eperolehan.gov.my"]
HEAD_MAX = 8192
OPEN_TIMEOUT = 25.0
CHUNK = 64 * 1024
IDLE = 600.0


def sign(workspace_id: str) -> str:
    """The proxy password for a workspace (the browser service makes the same one)."""
    key = settings.browser_token.encode()
    return hmac.new(key, f"pc-tunnel:{workspace_id}".encode(), hashlib.sha256).hexdigest()[:40]


@dataclass(frozen=True)
class Setting:
    on: bool
    device_id: str
    hosts: list[str]
    fallback: str  # wait | direct
    # P59: a task that works only on these sites opens its browser on that computer's screen
    # (a real window its person can watch) instead of on the server.
    show: bool = True


def setting(ws: Workspace | None) -> Setting:
    raw = ((ws.settings if ws else None) or {}).get(SETTINGS_KEY) or {}
    return Setting(
        bool(raw.get("on")),
        str(raw.get("device_id") or ""),
        core.tunnel_hosts(raw.get("hosts")) or list(DEFAULT_HOSTS),
        raw.get("fallback") if raw.get("fallback") in ("direct", "proxy") else "wait",
        raw.get("show") is not False,
    )


def _credentials(headers: dict[str, str]) -> str | None:
    """The workspace id from a valid Proxy-Authorization (Basic ws_id:signature)."""
    auth = headers.get("proxy-authorization", "")
    if not auth.lower().startswith("basic "):
        return None
    try:
        user, _, pw = base64.b64decode(auth[6:].strip()).decode().partition(":")
    except Exception:  # noqa: BLE001 - not base64 / not text
        return None
    return user if user and hmac.compare_digest(sign(user), pw) else None


@dataclass
class Route:
    """How one connection leaves: "computer" (device_id), "proxy" (proxies), "server" (409:
    the egress proxy goes direct) or "refuse" (503 with why)."""

    kind: str
    why: str = ""
    device_id: str | None = None
    proxies: list[proxies_mod.Proxy] | None = None
    site: str = ""


async def route(workspace_id: str, host: str) -> Route:
    """P60: the way out for a connection to `host`."""
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        st = setting(ws)
        px = proxies_mod.setting(ws)

        async def proxy_ok() -> bool:
            # Asked only when proxies would carry it, so the approved-services lock records
            # a request only then.
            return bool(px.on and px.proxies) and await compliance.allowed(
                db, workspace_id, "proxy", "Web proxies", host
            )

        if st.on and core.host_in(host, st.hosts):
            site = next(h for h in st.hosts if core.host_in(host, [h]))
            d = await db.get(Device, st.device_id) if st.device_id else None
            why = ""
            if d is None or d.workspace_id != workspace_id or d.revoked_at is not None:
                why = "the chosen computer is no longer linked"
            elif d.paused:
                why = f"{d.name} is paused"
            elif not core.host_in(host, d.tunnel_hosts or []):
                why = f"{d.name} does not let {host} through (on it: agentic-pc tunnel on {host})"
            elif d.id not in await core.online_ids([d.id]):
                why = f"{d.name} is offline"
            if not why:
                return Route("computer", device_id=d.id, site=site)  # type: ignore[union-attr]
            if st.fallback == "proxy" and await proxy_ok():
                return Route("proxy", why, proxies=px.proxies, site=site)
            if st.fallback == "wait":
                return Route("refuse", why)
            return Route("server", f"going direct: {why}")
        if px.covers(host) and await proxy_ok():
            site = next((h for h in px.sites if h != "*" and core.host_in(host, [h])), host)
            return Route("proxy", proxies=px.proxies, site=site)
    return Route("server", "not routed")


async def decide(workspace_id: str, host: str) -> tuple[int, str, str | None]:
    """(status, message, device id) for the company computer: 200 through it, 409 not this
    way, 503 refuse. (Kept for the computer alone; `route` covers proxies too.)"""
    r = await route(workspace_id, host)
    if r.kind == "computer":
        return 200, "ok", r.device_id
    if r.kind == "refuse":
        return 503, r.why, None
    return 409, r.why or "not tunnelled", None


async def _read_head(r: asyncio.StreamReader) -> tuple[str, dict[str, str]] | None:
    try:
        raw = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 10)
    except Exception:  # noqa: BLE001 - closed, too long, too slow
        return None
    if len(raw) > HEAD_MAX:
        return None
    lines = raw.decode("latin-1").split("\r\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        k, sep, v = line.partition(":")
        if sep:
            headers[k.strip().lower()] = v.strip()
    return lines[0], headers


async def _reply(w: asyncio.StreamWriter, status: int, msg: str) -> None:
    reason = {200: "Connection established", 409: "Conflict", 503: "Service Unavailable"}.get(
        status, "Bad Request"
    )
    body = b"" if status == 200 else (msg + "\n").encode()
    head = f"HTTP/1.1 {status} {reason}\r\n"
    if status != 200:
        head += f"Content-Length: {len(body)}\r\nConnection: close\r\n"
    with contextlib.suppress(ConnectionError, OSError):
        w.write(head.encode() + b"\r\n" + body)
        await w.drain()


async def handle(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    channel: str | None = None
    try:
        head = await _read_head(r)
        if head is None:
            return
        first, headers = head
        parts = first.split(" ")
        if len(parts) != 3 or parts[0] != "CONNECT":
            await _reply(w, 400, "CONNECT only")
            return
        host, _, port_s = parts[1].rpartition(":")
        port = int(port_s) if port_s.isdigit() else 0
        ws_id = _credentials(headers)
        if ws_id is None or port != 443 or not host:
            await _reply(w, 409, "not tunnelled")  # the egress proxy goes on as usual
            return
        way = await route(ws_id, host)
        if way.kind == "proxy":
            await _through_proxy(ws_id, way, host, port, r, w)
            return
        if way.kind != "computer" or way.device_id is None:
            await _reply(w, 503 if way.kind == "refuse" else 409, way.why or "not routed")
            return
        device_id = way.device_id
        ch = relay.create(device_id)
        channel = ch.id
        try:
            await bridge.call(
                device_id,
                "net.open",
                {"channel": ch.id, "host": host, "port": port},
                OPEN_TIMEOUT,
                kind="tunnel",
            )
        except DeviceError as e:
            # The computer could not open it (it is the way out that failed): fall back.
            ws = await _workspace(ws_id)
            st, px = setting(ws), proxies_mod.setting(ws)
            if st.fallback == "proxy" and px.on and px.proxies:
                via = Route("proxy", e.message, proxies=px.proxies, site=way.site)
                await _through_proxy(ws_id, via, host, port, r, w)
                return
            await _reply(w, 409 if st.fallback == "direct" else 503, e.message or e.code)
            return
        if not await relay.wait_pc(ch.id, relay.PC_WAIT) or ch.pc is None:
            await _reply(w, 503, "the computer did not open the connection")
            return
        await _reply(w, 200, "")
        await _splice(r, w, ch)
    except Exception:  # noqa: BLE001 - one connection must never take the gateway down
        log.warning("tunnel connection failed", exc_info=True)
    finally:
        if channel:
            await relay.close(channel)
        with contextlib.suppress(Exception):
            w.close()


async def _through_proxy(
    ws_id: str, way: Route, host: str, port: int, r: asyncio.StreamReader, w: asyncio.StreamWriter
) -> None:
    """P60: the site's own proxy, or the next when it is down; all down: this server (409)."""
    pool = way.proxies or []
    for p in (await proxies_mod.order(ws_id, way.site, pool))[: proxies_mod.TRIES]:
        try:
            pr, pw = await proxies_mod.open_via(p, host, port)
        except (OSError, TimeoutError) as e:
            log.info("proxy %s unreachable for %s: %s", p.key, ws_id, e)
            await proxies_mod.set_aside(ws_id, p)
            continue
        await proxies_mod.remember(ws_id, way.site, pool, p)
        await _reply(w, 200, "")
        try:
            await _pipe_streams(r, w, pr, pw)
        finally:
            with contextlib.suppress(Exception):
                pw.close()
        return
    await _reply(w, 409, "no proxy answered: going direct")


async def _pipe_streams(
    r1: asyncio.StreamReader,
    w1: asyncio.StreamWriter,
    r2: asyncio.StreamReader,
    w2: asyncio.StreamWriter,
) -> None:
    async def one(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
        while data := await asyncio.wait_for(src.read(CHUNK), IDLE):
            dst.write(data)
            await dst.drain()

    tasks = [asyncio.create_task(one(r1, w2)), asyncio.create_task(one(r2, w1))]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t


async def _workspace(ws_id: str) -> Workspace | None:
    async with SessionLocal() as db:
        return await db.get(Workspace, ws_id)


async def _splice(r: asyncio.StreamReader, w: asyncio.StreamWriter, ch: relay.Channel) -> None:
    """Encrypted bytes both ways between the egress proxy and the computer."""
    pc = ch.pc
    assert pc is not None

    async def up() -> None:
        while data := await asyncio.wait_for(r.read(CHUNK), IDLE):
            await pc.send_bytes(data)

    async def down() -> None:
        while True:
            msg = await asyncio.wait_for(pc.receive(), IDLE)
            if msg.get("type") == "websocket.disconnect":
                return
            data = msg.get("bytes")
            if data is None:  # text: the computer closing with an error
                return
            w.write(data)
            await w.drain()

    tasks = [asyncio.create_task(up()), asyncio.create_task(down())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t


_server: asyncio.AbstractServer | None = None


async def start() -> None:
    """Listen for the egress proxy (AGENTIC_PC_TUNNEL_LISTEN, e.g. 0.0.0.0:3130); off when
    empty."""
    global _server
    addr = settings.pc_tunnel_listen.strip()
    if not addr or _server is not None:
        return
    host, _, port = addr.rpartition(":")
    _server = await asyncio.start_server(handle, host or "0.0.0.0", int(port))  # noqa: S104
    log.info("pc tunnel gateway listening on %s", addr)


async def stop() -> None:
    global _server
    if _server is not None:
        _server.close()
        with contextlib.suppress(Exception):
            await _server.wait_closed()
        _server = None


def describe(ws: Workspace | None) -> dict[str, Any]:
    st = setting(ws)
    return {
        "on": st.on,
        "device_id": st.device_id,
        "hosts": st.hosts,
        "fallback": st.fallback,
        "show": st.show,
    }


async def screen_for(db: Any, workspace_id: str, sites: list[str] | None) -> tuple[str, str]:
    """P59: (device id, "") when a task that works only on `sites` should open its browser on
    the workspace's chosen computer; ("", why) when it should but cannot (the workspace said
    wait); ("", "") to use the server's browser."""
    if not sites:
        return "", ""
    st = setting(await db.get(Workspace, workspace_id))
    if not (st.on and st.show and all(core.host_in(s, st.hosts) for s in sites)):
        return "", ""
    d = await db.get(Device, st.device_id) if st.device_id else None
    why = ""
    if d is None or d.workspace_id != workspace_id or d.revoked_at is not None:
        why = "the chosen computer is no longer linked"
    elif d.paused:
        why = f"{d.name} is paused"
    elif not all(core.host_in(s, d.tunnel_hosts or []) for s in sites):
        why = f"{d.name} does not let these sites through (on it: agentic-pc tunnel on)"
    elif d.id not in await core.online_ids([d.id]):
        why = f"{d.name} is offline"
    if why:
        return ("", "") if st.fallback == "direct" else ("", why)
    return d.id, ""
