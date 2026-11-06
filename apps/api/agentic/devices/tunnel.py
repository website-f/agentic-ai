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
import json
import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

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
        from ..api.routers.devices import ASK_VERSION, _version

        if _version(d.version) < ASK_VERSION:
            # P84: an older app has no Allow button: say what to do, not "press Allow".
            return (
                f"{d.name} has not allowed it yet: it has an older Agentic Office app (on that "
                "computer, open My computers, download the app again and run it, then press Allow)"
            )
        return (
            f"{d.name} has not allowed it yet (on that computer, press Allow on the Agentic "
            "Office page)"
        )
    if d.id not in await core.online_ids([d.id]):
        return f"{d.name} is offline"
    return ""


# P72: whose work it is, for the gateway (which sees only the browser's agent). browser_tools sets
# it when an agent's browser starts for a task: the task's person.
PERSON_KEY = "browser:person:{agent_id}"
PERSON_TTL = 6 * 3600


async def remember_person(agent_id: str, person: str | None) -> None:
    from ..core.valkey import valkey

    key = PERSON_KEY.format(agent_id=agent_id)
    if person:
        await valkey().set(key, person, ex=PERSON_TTL)
    else:
        await valkey().delete(key)


async def person_of_agent(db: Any, agent_id: str) -> str | None:
    """The person an agent's browser works for: a personal AI's owner, else whoever gave the
    task it is on now (remember_person); None for the office's own work."""
    from ..core.valkey import valkey
    from ..models import Agent

    if not agent_id:
        return None
    a = await db.get(Agent, agent_id)
    if a is not None and a.owner_user_id:
        return a.owner_user_id
    v = await valkey().get(PERSON_KEY.format(agent_id=agent_id))
    return str(v) if v else None


async def person_computer(
    db: Any, workspace_id: str, person: str, sites: list[str]
) -> tuple[str, str]:
    """P72: (device id, "") of the person's OWN linked computer that has allowed every one of
    `sites` and is online now (most recently seen first), or ("", why)."""
    from ..models import User

    rows = (
        await db.scalars(
            select(Device)
            .where(
                Device.workspace_id == workspace_id,
                Device.user_id == person,
                Device.revoked_at.is_(None),
            )
            .order_by(Device.last_seen_at.desc().nullslast())
        )
    ).all()
    u = await db.get(User, person)
    who = (u.name if u else "") or "the person"
    if not rows:
        return "", (
            f"{who} has no linked PC. ePerolehan work runs on their own PC: link it on Staff "
            "computers (download Agentic Office PC), then press Allow on it"
        )
    ready = [
        d
        for d in rows
        if not d.paused and all(core.host_in(x, d.tunnel_hosts or []) for x in sites)
    ]
    if not ready:
        d = rows[0]
        return "", (
            f"{d.name} ({who}'s PC) is paused"
            if d.paused
            else f"{d.name} ({who}'s PC) has not allowed it yet: on that PC, press Allow on the "
            "Agentic Office page"
        )
    online = await core.online_ids([d.id for d in ready])
    d = next((d for d in ready if d.id in online), None)
    if d is None:
        return "", f"{ready[0].name} ({who}'s PC) is offline: turn it on and open Agentic Office PC"
    return d.id, ""


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


def _credentials(headers: dict[str, str]) -> tuple[str, str] | None:
    """(workspace id, agent id) from a valid Proxy-Authorization: Basic "ws_id.agent_id"
    (P72: the browser names its agent, so the agent's person's own computer is used) or
    "ws_id" (no agent), with the signature of that whole name."""
    auth = headers.get("proxy-authorization", "")
    if not auth.lower().startswith("basic "):
        return None
    try:
        user, _, pw = base64.b64decode(auth[6:].strip()).decode().partition(":")
    except Exception:  # noqa: BLE001 - not base64 / not text
        return None
    if not user or not hmac.compare_digest(sign(user), pw):
        return None
    ws_id, _, agent_id = user.partition(".")
    return ws_id, agent_id


@dataclass
class Route:
    """How one connection leaves: "computer" (device_id), "proxy" (proxies), "server" (409:
    the egress proxy goes direct) or "refuse" (503 with why)."""

    kind: str
    why: str = ""
    device_id: str | None = None
    proxies: list[proxies_mod.Proxy] | None = None
    site: str = ""


async def route(workspace_id: str, host: str, agent_id: str = "") -> Route:
    """The way out for a connection to `host` (P62: the chosen one, or refused). P72: through
    a computer, it is the agent's person's OWN linked computer; only the office's own work
    (no person) uses the company's chosen one."""
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        return await _route(db, ws, workspace_id, mode_of(ws), host, agent_id)


async def _route(
    db: Any,
    ws: Workspace | None,
    workspace_id: str,
    m: Mode,
    host: str,
    agent_id: str = "",
    device_id: str = "",
) -> Route:
    """route() for a given choice `m` (P84: the Check button tries the choice on the screen,
    saved or not; `device_id` is that choice's computer)."""
    if not m.covers(host):
        return Route("server", "not routed")
    site = next((h for h in m.sites if h != "*" and core.host_in(host, [h])), host)
    if m.mode == "pc":
        person = await person_of_agent(db, agent_id)
        if person:
            device_id, why = await person_computer(db, workspace_id, person, [host])
            if why:
                return Route("refuse", why)
            return Route("computer", device_id=device_id, site=site)
        device_id = device_id or setting(ws).device_id or await any_computer(db, workspace_id, host)
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
        return Route("refuse", "the web proxies wait for an owner's approval on Approved services")
    return Route("proxy", proxies=px.proxies, site=site)


async def unavailable(workspace_id: str, host: str, agent_id: str = "") -> str:
    """Why `host` cannot be opened now the chosen way ("" when it can): told to the agent
    before its browser tries, instead of a bare connection error."""
    if not workspace_id or not host:
        return ""
    try:
        r = await route(workspace_id, host, agent_id)
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
        who = _credentials(headers)
        if who is None or port != 443 or not host:
            await _reply(w, 409, "not tunnelled")  # the egress proxy goes on as usual
            return
        ws_id, agent_id = who
        way = await route(ws_id, host, agent_id)
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


async def check(
    workspace_id: str, site: str, choice: dict[str, Any] | None = None
) -> dict[str, Any]:
    """P62 (Settings > Web connections > Check): open `site` once the way the agents' browsers
    would (through the egress proxy with the workspace's credentials, so the gateway chooses
    as it does for them): the way it went, the site's answer, the address it saw.

    P84: `choice` is what is on the screen ({mode, sites, device_id, show}), saved or not, so
    the person checks the way they are choosing. Through a computer whose screen shows the
    AI's work, the site opens in that computer's own browser window (its person sees it),
    and the answer is read from that page."""
    import httpx

    host = site.strip().lower()
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        m, dev, show = mode_of(ws), "", setting(ws).show
        if choice and choice.get("mode") in MODES:
            m = Mode(choice["mode"], clean_sites(choice["mode"], choice.get("sites")))
            dev = str(choice.get("device_id") or "")
            show = choice.get("show") is not False
        r = await _route(db, ws, workspace_id, m, host, "", dev)
    way = {"computer": "pc"}.get(r.kind, r.kind)
    out: dict[str, Any] = {"site": host, "way": way, "why": r.why if way == "refuse" else ""}
    if way == "refuse":
        return out
    if way == "pc" and show and r.device_id:
        return await check_on_screen(r.device_id, host, out)
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


# P84: the Check window stays on the computer's screen this long, so its person sees it.
CHECK_SHOWN_FOR = 15.0
_closing: set[asyncio.Task[None]] = set()


async def check_on_screen(device_id: str, host: str, out: dict[str, Any]) -> dict[str, Any]:
    """Open `host` in the computer's own browser window (its own internet line), wait for the
    page, and read what it answered (the navigation status, the page text, the address a
    block page shows). The window closes CHECK_SHOWN_FOR seconds later."""
    name = host if host.startswith("www.") else f"www.{host}"
    try:
        channel, ws_url = await bridge.open_browser(
            device_id, f"https://{name}/", sites=[host], timeout=45
        )
    except DeviceError as e:
        why = {
            "offline": "the computer is offline (turned off, asleep, or the app is not running)",
            "paused": "the computer is paused",
            "revoked": "the computer was unlinked",
            "no_browser": "the computer has no Chrome or Edge",
            "busy": "its browser is in use by an AI task right now",
        }.get(e.code, e.message or e.code)
        return {**out, "screen": True, "error": f"The browser on the computer did not open: {why}"}
    try:
        page = await read_page(ws_url, host)
    finally:
        task = asyncio.create_task(_close_later(device_id, channel))
        _closing.add(task)
        task.add_done_callback(_closing.discard)
    if page is None:
        return {
            **out,
            "screen": True,
            "error": "The page did not finish loading on the computer within 25 seconds",
        }
    status = int(page.get("status") or 0)
    text = str(page.get("text") or "")
    if not status:  # an older browser does not report it: judge by the page
        status = 403 if _BLOCK_WORDS.search(text) else 200
    opened = urlsplit(str(page.get("url") or "")).hostname or name
    title = str(page.get("title") or "")
    return {**out, "screen": True, "site": opened, **read_answer(status, f"{title} {text}")}


async def _close_later(device_id: str, channel: str) -> None:
    await asyncio.sleep(CHECK_SHOWN_FOR)
    with contextlib.suppress(Exception):
        await bridge.close_browser(device_id, channel)


_PAGE_JS = (
    "JSON.stringify({ready: document.readyState, url: location.href, title: document.title,"
    " status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0,"
    " text: (document.body ? document.body.innerText : '').slice(0, 4000)})"
)


async def read_page(ws_url: str, host: str, wait: float = 25.0) -> dict[str, Any] | None:
    """The loaded page on the computer's browser, through its CDP relay: the tab that opened
    `host`, once it has finished loading (None when it does not within `wait` seconds)."""
    import websockets

    loop = asyncio.get_running_loop()
    until = loop.time() + wait
    bare = host.removeprefix("www.")
    try:
        async with websockets.connect(
            ws_url, additional_headers={"X-Browser-Token": settings.browser_token}, max_size=2**22
        ) as cdp:
            ids = iter(range(1, 10_000))

            async def send(method: str, params: dict[str, Any], session: str = "") -> Any:
                n = next(ids)
                msg: dict[str, Any] = {"id": n, "method": method, "params": params}
                if session:
                    msg["sessionId"] = session
                await cdp.send(json.dumps(msg))
                while True:
                    left = until - loop.time()
                    if left <= 0:
                        raise TimeoutError
                    data = json.loads(await asyncio.wait_for(cdp.recv(), left))
                    if data.get("id") == n:
                        return data.get("result") or {}

            session = ""
            while loop.time() < until:
                if not session:
                    targets = (await send("Target.getTargets", {})).get("targetInfos") or []
                    page = next(
                        (
                            t
                            for t in targets
                            if t.get("type") == "page" and bare in str(t.get("url") or "")
                        ),
                        None,
                    )
                    if page:
                        att = await send(
                            "Target.attachToTarget",
                            {"targetId": page["targetId"], "flatten": True},
                        )
                        session = str(att.get("sessionId") or "")
                if session:
                    res = await send(
                        "Runtime.evaluate", {"expression": _PAGE_JS, "returnByValue": True}, session
                    )
                    value = (res.get("result") or {}).get("value")
                    if isinstance(value, str):
                        info = json.loads(value)
                        if info.get("ready") == "complete":
                            return dict(info)
                await asyncio.sleep(1.0)
    except (TimeoutError, OSError, ValueError, websockets.WebSocketException):
        return None
    return None


async def screen_for(
    db: Any, workspace_id: str, sites: list[str] | None, person: str | None = None
) -> tuple[str, str]:
    """P59: (device id, "") when a task that works only on `sites` should open its browser on
    a computer's screen; ("", why) when it should but cannot; ("", "") to use the server's
    browser. P72: the task's person's OWN computer; the company's chosen one only for the
    office's own work (no person)."""
    if not sites:
        return "", ""
    ws = await db.get(Workspace, workspace_id)
    st, m = setting(ws), mode_of(ws)
    if not (m.mode == "pc" and st.show and all(m.covers(s) for s in sites)):
        return "", ""
    if person:
        return await person_computer(db, workspace_id, person, sites)
    why = await computer_down(db, workspace_id, st.device_id, sites)
    return ("", why) if why else (st.device_id, "")
