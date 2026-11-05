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

P60, three ways out: this server (409, the egress proxy goes direct), the company computer
(above), or the company's proxies (the gateway opens the CONNECT through one of them).

P62, one choice on Settings > Web connections ("web_route": {mode, sites}): browse from this
server (the default), through a company computer, or through the company's proxies, for the
listed sites (proxies may also take every site). Whatever is chosen is used or the connection is
refused with the reason (503): it never quietly leaves from this server's address instead, the
way the old fallbacks and an unapproved proxy list did. A site refusing or blocking a request
never moves it elsewhere either.
"""

import asyncio
import base64
import contextlib
import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

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
    fallback: str  # wait | direct | proxy (before P62; no longer used)
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


MODE_KEY = "web_route"
MODES = ("server", "pc", "proxy")


@dataclass(frozen=True)
class Mode:
    """P62: how the agents' browsers reach `sites`: "server", "pc" or "proxy". ["*"] (every
    site) only with proxies: a computer carries only the sites listed, and allowed, on it."""

    mode: str
    sites: list[str]

    def covers(self, host: str) -> bool:
        return self.mode != "server" and ("*" in self.sites or core.host_in(host, self.sites))


def clean_sites(mode: str, raw: Any) -> list[str]:
    if mode == "proxy" and (raw in (None, "*") or (isinstance(raw, list) and "*" in raw)):
        return ["*"]
    return core.tunnel_hosts(raw) or list(DEFAULT_HOSTS)


def mode_of(ws: Workspace | None) -> Mode:
    s = (ws.settings if ws else None) or {}
    raw = s.get(MODE_KEY)
    if isinstance(raw, dict) and raw.get("mode") in MODES:
        return Mode(raw["mode"], clean_sites(raw["mode"], raw.get("sites")))
    # Saved before P62: the two switches of P58 and P60 (the computer's came first).
    pc, px = s.get(SETTINGS_KEY) or {}, s.get(proxies_mod.SETTINGS_KEY) or {}
    if pc.get("on"):
        return Mode("pc", clean_sites("pc", pc.get("hosts")))
    if px.get("on"):
        return Mode("proxy", clean_sites("proxy", px.get("sites")))
    # P69: nothing chosen yet: ePerolehan goes through a linked company computer (a residential
    # line), never from the server's own address. Other sites go from the server as before.
    return Mode("pc", list(DEFAULT_HOSTS))


def save_mode(ws: Workspace, mode: str, sites: list[str]) -> Mode:
    m = Mode(mode, clean_sites(mode, sites))
    ws.settings = {**(ws.settings or {}), MODE_KEY: {"mode": m.mode, "sites": m.sites}}
    return m


async def computer_down(db: Any, workspace_id: str, device_id: str, sites: list[str]) -> str:
    """Why the chosen computer cannot carry `sites` now ("" when it can)."""
    d = await db.get(Device, device_id) if device_id else None
    if d is None or d.workspace_id != workspace_id or d.revoked_at is not None:
        return "the chosen computer is no longer linked" if device_id else "no computer is chosen"
    if d.paused:
        return f"{d.name} is paused"
    if not all(core.host_in(s, d.tunnel_hosts or []) for s in sites):
        return (
            f"{d.name} has not allowed it yet (on that computer, press Allow on the Agentic "
            "Office page)"
        )
    if d.id not in await core.online_ids([d.id]):
        return f"{d.name} is offline"
    return ""


async def any_computer(db: Any, workspace_id: str, host: str) -> str:
    """P69: with no computer chosen, a linked one that has allowed `host` and is online now
    (most recently seen first), or ""."""
    rows = (
        await db.scalars(
            select(Device)
            .where(Device.workspace_id == workspace_id, Device.revoked_at.is_(None))
            .order_by(Device.last_seen_at.desc().nullslast())
        )
    ).all()
    ready = [d for d in rows if not d.paused and core.host_in(host, d.tunnel_hosts or [])]
    online = await core.online_ids([d.id for d in ready])
    return next((d.id for d in ready if d.id in online), "")


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
    """The way out for a connection to `host` (P62: the chosen one, or refused)."""
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        m = mode_of(ws)
        if not m.covers(host):
            return Route("server", "not routed")
        site = next((h for h in m.sites if h != "*" and core.host_in(host, [h])), host)
        if m.mode == "pc":
            device_id = setting(ws).device_id or await any_computer(db, workspace_id, host)
            why = await computer_down(db, workspace_id, device_id, [host])
            if why == "no computer is chosen":
                why = (
                    "ePerolehan is opened through a company computer, and none is linked or "
                    "has allowed it yet. Link your PC on Staff computers (download Agentic "
                    "Office PC), then press Allow on that PC"
                )
            if why:
                return Route("refuse", why)
            return Route("computer", device_id=device_id, site=site)
        px = proxies_mod.setting(ws)
        if not px.proxies:
            return Route("refuse", "no proxies are saved on Settings > Web connections")
        # Asked only when proxies would carry it, so the approved-services lock records a
        # request only then.
        if not await compliance.allowed(db, workspace_id, "proxy", "Web proxies", host):
            return Route(
                "refuse", "the web proxies wait for an owner's approval on Approved services"
            )
        return Route("proxy", proxies=px.proxies, site=site)


async def unavailable(workspace_id: str, host: str) -> str:
    """Why `host` cannot be opened now the chosen way ("" when it can): told to the agent
    before its browser tries, instead of a bare connection error."""
    if not workspace_id or not host:
        return ""
    try:
        r = await route(workspace_id, host)
    except Exception:  # noqa: BLE001 - the gateway decides again for real
        return ""
    return r.why if r.kind == "refuse" else ""


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
            # The computer could not open it: refused with why, never sent out from here.
            await _reply(w, 503, e.message or e.code)
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
    """P60: the site's own proxy, or the next when it is down; all down: refused (P62: never
    this server's address instead)."""
    pool = way.proxies or []
    last = ""
    for p in (await proxies_mod.order(ws_id, way.site, pool))[: proxies_mod.TRIES]:
        try:
            pr, pw = await proxies_mod.open_via(p, host, port)
        except (OSError, TimeoutError) as e:
            log.warning("proxy %s failed for %s: %s", p.key, host, e)
            last = str(e) or type(e).__name__
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
    await _reply(w, 503, f"none of the company's proxies answered ({last or 'no proxy'})")


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
    st, m = setting(ws), mode_of(ws)
    return {
        "on": m.mode == "pc",
        "device_id": st.device_id,
        "hosts": m.sites if m.mode == "pc" else st.hosts,
        "fallback": "wait",
        "show": st.show,
    }


_BLOCK_WORDS = re.compile(r"blocked|access denied|forbidden|not authori[sz]ed|captcha", re.I)
_SEEN_IP = re.compile(
    r"your ip(?: address)?\s*(?:is)?\s*:?\s*([0-9a-f]{1,4}(?:[.:][0-9a-f]{0,4}){3,7})", re.I
)
_TAGS = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.I | re.S)
CHECK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0"


def read_answer(status: int, html: str) -> dict[str, Any]:
    """What a site's answer means for the person: opened, or refused (and the address it says
    it saw, when its page shows one, as ePerolehan's block page does)."""
    text = re.sub(r"\s+", " ", _TAGS.sub(" ", html)).strip()
    seen = _SEEN_IP.search(text)
    blocked = status in (401, 403, 429, 451) or (status >= 400 and bool(_BLOCK_WORDS.search(text)))
    return {
        "status": status,
        "ok": 200 <= status < 400,
        "blocked": blocked,
        "seen_ip": seen.group(1) if seen else "",
        "says": text[:200] if status >= 400 else "",
    }


async def check(workspace_id: str, site: str) -> dict[str, Any]:
    """P62 (Settings > Web connections > Check): open `site` once the way the agents' browsers
    would (through the egress proxy with the workspace's credentials, so the gateway chooses
    as it does for them): the way it went, the site's answer, the address it saw."""
    import httpx

    host = site.strip().lower()
    r = await route(workspace_id, host)
    way = {"computer": "pc"}.get(r.kind, r.kind)
    out: dict[str, Any] = {"site": host, "way": way, "why": r.why if way == "refuse" else ""}
    if way == "refuse":
        return out
    if way == "proxy" and r.proxies:
        p = (await proxies_mod.order(workspace_id, r.site, r.proxies))[0]
        out["via"] = p.key
        t = await proxies_mod.test(p)
        out["proxy_ip"] = t.get("ip", "")
    if not settings.egress_url:
        return {**out, "error": "No egress proxy is set for checks."}
    u = httpx.URL(settings.egress_url)
    proxy = f"{u.scheme}://{workspace_id}:{sign(workspace_id)}@{u.host}:{u.port or 3128}"
    names = [host] if host.startswith("www.") else [host, f"www.{host}"]
    err = ""
    async with httpx.AsyncClient(
        proxy=proxy, timeout=30, follow_redirects=True, headers={"User-Agent": CHECK_UA}
    ) as c:
        for name in names:  # a bare site name may only answer as www.
            try:
                resp = await c.get(f"https://{name}/")
            except httpx.HTTPError as e:
                err = str(e)[:200] or type(e).__name__
                continue
            return {**out, "site": name, **read_answer(resp.status_code, resp.text[:40_000])}
    return {**out, "error": err}


async def screen_for(db: Any, workspace_id: str, sites: list[str] | None) -> tuple[str, str]:
    """P59: (device id, "") when a task that works only on `sites` should open its browser on
    the workspace's chosen computer; ("", why) when it should but cannot; ("", "") to use the
    server's browser."""
    if not sites:
        return "", ""
    ws = await db.get(Workspace, workspace_id)
    st, m = setting(ws), mode_of(ws)
    if not (m.mode == "pc" and st.show and all(m.covers(s) for s in sites)):
        return "", ""
    why = await computer_down(db, workspace_id, st.device_id, sites)
    return ("", why) if why else (st.device_id, "")
