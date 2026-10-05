"""The browser service: a real Camoufox (Firefox) that agents drive, one context per task.

Only the worker can reach it (its own Docker network, token checked). That network is
internal: the only way out is the egress proxy (apps/egress, BROWSER_PROXY), which refuses
non-public addresses for every connection, redirect hops included. Every request the page
makes also passes a guard here that refuses non-public addresses (defence in depth). A session may also carry an allow-list of hosts
(a "Browse for me" task stays on its site): pages elsewhere are refused with a clear error.

Pages are reduced to an accessibility-style tree (snapshot.py) whose element refs (e17, f1e3
inside an iframe) are stable: an element that survives a re-render keeps its ref, so a ref
the model picked never silently points at another element. After an action only what
changed since the model's last view is sent (a delta), the whole tree on a navigation or a
big change. Every action returns a JPEG frame for the live monitor.

Form submits are refused unless the call says allow_submit (the agent's browser_submit
tool, which always needs a person's approval).

Saved logins (P9) arrive as `secret` typing: the service types them only when the page is
on one of the login's hosts, marks the field, and never returns a secret or password
field's value, so neither the model nor the monitor ever sees it. A signed-in session can
be exported (cookies + local storage, only for the login's hosts) and handed back when a
later task opens its context, so agents stay signed in like a person does (P21); the worker
encrypts it, this service never stores it.
"""

import asyncio
import base64
import ipaddress
import json
import logging
import os
import re
import secrets
import socket
import time
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from snapshot import (
    MARKS_JS,
    SNAPSHOT_JS,
    Delta,
    History,
    diff,
    footer,
    form_elements,
    frame_of,
    host_matches,
    node_line,
    parse_ref,
    render,
    text_delta,
    uncovered_text,
)
from snapshot import find as find_nodes

log = logging.getLogger("browser")
TOKEN = os.environ.get("BROWSER_TOKEN", "dev-browser-token")
MAX_SESSIONS = int(os.environ.get("BROWSER_MAX_SESSIONS", "6"))
# Firefox stalls (clicks and page loads never finish) once 3 or more pages in one browser
# process work at the same time (measured: 2 per process always fine, 3+ not), so agents
# get their own processes, at most this many sessions each.
PER_PROCESS = max(1, int(os.environ.get("BROWSER_PER_PROCESS", "2")))
IDLE_SECONDS = int(os.environ.get("BROWSER_IDLE_SECONDS", "600"))
VIEWPORT = {"width": 1280, "height": 800}
TEXT_CHARS = 2500
READ_CHARS = 12_000
HTML_CHARS = 1_500_000
STATE_BYTES = 512 * 1024  # an exported session bigger than this keeps its cookies only
WAIT_MAX = 30
# Camoufox's humanized cursor deadlocks once 3+ contexts click at the same time (helpers
# working in parallel), so it is off unless asked for.
HUMANIZE = os.environ.get("BROWSER_HUMANIZE", "false").lower() in ("1", "true", "yes")
# Self-healing: this many timeouts in one browser process within WEDGE_WINDOW seconds means
# it is stuck; it is restarted and its agents' next step opens a fresh session.
WEDGE_TIMEOUTS = 4
WEDGE_WINDOW = 120
# Dev only: extra host names allowed although they are private (the practice portal on the
# browser network). Empty in production.
ALLOW_HOSTS = {h.strip().lower() for h in os.environ.get("BROWSER_ALLOW_HOSTS", "").split(",") if h.strip()}
# The egress proxy (apps/egress), e.g. http://egress:3128. The browser's network is internal,
# so every request leaves through it; it resolves each host itself, refuses non-public
# addresses (redirect hops included) and connects to the address it checked. Empty = direct.
PROXY = os.environ.get("BROWSER_PROXY", "").strip()
# Firefox must never go around the proxy: not for localhost (Firefox's default bypass, which
# would reach this service's own port), not as a fallback when the proxy fails.
PROXY_PREFS: dict[str, Any] = {
    "network.proxy.allow_hijacking_localhost": True,
    "network.proxy.no_proxies_on": "",
    "network.proxy.failover_direct": False,
    "network.dns.disablePrefetch": True,
    "network.predictor.enabled": False,
    "network.prefetch-next": False,
}


BOLD_ROWS_JS = """() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const cells = tr.querySelectorAll('td');
    if (!cells.length) continue;
    const w = parseInt(getComputedStyle(cells[0]).fontWeight, 10) || 400;
    if (w >= 600) out.push(String(tr.innerText).replace(/\\s+/g, ' ').trim().slice(0, 100));
    if (out.length >= 30) break;
  }
  return out;
}"""

# The page's text, plus the text of same-origin iframes (their fields are in the snapshot).
TEXT_JS = """() => {
  let t = document.body ? document.body.innerText : '';
  for (const f of document.querySelectorAll('iframe,frame')) {
    try {
      const d = f.contentDocument;
      if (d && d.body) t += '\\n[frame: ' + (f.title || f.name || 'untitled') + ']\\n' + d.body.innerText;
    } catch (e) {}
  }
  return t;
}"""

WAIT_TEXT_JS = """(needle) => {
  const has = (d) => !!(d && d.body && d.body.innerText.toLowerCase().includes(needle));
  if (has(document)) return true;
  for (const f of document.querySelectorAll('iframe,frame')) { try { if (has(f.contentDocument)) return true; } catch (e) {} }
  return false;
}"""

SUBMIT_JS = (
    "(el) => ({submit: (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit') && !!el.form)"
    " || (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'image'))})"
)


def blocked_text(url: str, allowed: list[str]) -> str:
    host = urlparse(url).hostname or url
    return (
        f"BLOCKED_SITE: this task may only open pages on {', '.join(allowed)}; {host} is not "
        "one of them. Do the work on the allowed site, or ask a person (ask_human) if you "
        "really need another site."
    )


# ---------------------------------------------------------------- the network guard

_dns: dict[str, tuple[float, bool]] = {}


def _ip_ok(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


async def host_ok(host: str | None) -> bool:
    if not host:
        return False
    host = host.strip("[]").lower()
    if host in ALLOW_HOSTS:
        return True
    try:
        return _ip_ok(host)
    except ValueError:
        pass
    hit = _dns.get(host)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        ok = bool(infos) and all(_ip_ok(str(i[4][0])) for i in infos)
    except OSError:
        # Behind the egress proxy the browser's internal network has no outside DNS, so a
        # public name does not resolve here: the proxy resolves it, checks and pins it.
        # Names that do resolve here (our own containers) are still judged above.
        ok = bool(PROXY)
    _dns[host] = (time.time() + 60, ok)
    return ok


def _top_navigation(request: Any) -> bool:
    try:
        return bool(request.is_navigation_request()) and request.frame.parent_frame is None
    except Exception:  # noqa: BLE001 - service-worker requests have no frame
        return False


async def _route(route: Any, sess: "Session | None" = None) -> None:
    u = urlparse(route.request.url)
    if u.scheme in ("data", "blob", "about"):
        await route.continue_()
    elif u.scheme in ("http", "https") and await host_ok(u.hostname):
        if (
            sess is not None
            and sess.allowed
            and _top_navigation(route.request)
            and not host_matches(route.request.url, sess.allowed)
        ):
            sess.blocked = route.request.url
            await route.abort("blockedbyclient")
            return
        await route.continue_()
    else:
        await route.abort("blockedbyclient")


# ---------------------------------------------------------------- sessions


class Slot:
    """One Camoufox process, holding at most PER_PROCESS agents' sessions."""

    def __init__(self, n: int) -> None:
        self.n, self.manager, self.browser = n, None, None
        self.sessions: set[str] = set()
        self.timeouts: list[float] = []
        self.starting = asyncio.Lock()

    async def get(self) -> Any:
        async with self.starting:
            if self.browser is None:
                from camoufox.async_api import AsyncCamoufox

                # block_webrtc: media.peerconnection.enabled=false, so no WebRTC (UDP/STUN)
                # traffic, which would not go through the proxy.
                extra: dict[str, Any] = {}
                if PROXY:
                    extra = {"proxy": {"server": PROXY}, "firefox_user_prefs": dict(PROXY_PREFS)}
                self.manager = AsyncCamoufox(
                    headless=True,
                    humanize=HUMANIZE,
                    block_webrtc=True,
                    i_know_what_im_doing=True,
                    **extra,
                )
                self.browser = await self.manager.__aenter__()
        return self.browser

    async def stop(self) -> None:
        manager, self.manager, self.browser, self.timeouts = self.manager, None, None, []
        if manager is not None:
            try:
                await asyncio.wait_for(manager.__aexit__(None, None, None), 20)
            except Exception:  # noqa: BLE001 - it is being replaced anyway
                log.warning("browser %d did not close cleanly", self.n, exc_info=True)


class Session:
    def __init__(self, sid: str, owner: dict[str, Any], slot: Slot, allowed: list[str] | None) -> None:
        self.id, self.owner, self.slot = sid, owner, slot
        self.context: Any = None
        self.page: Any = None
        self.allowed = [h.lower() for h in (allowed or []) if h] or None
        self.blocked: str | None = None
        self.unsafe: str | None = None
        self.history = History()
        self.last = time.time()
        self.lock = asyncio.Lock()


state: dict[str, Any] = {"slots": [], "sessions": {}, "restarts": 0}


def _slot_for_new() -> Slot | None:
    """A browser process with room, preferring a running one; None when all are full."""
    slots: list[Slot] = state["slots"]
    running = [x for x in slots if x.browser is not None and len(x.sessions) < PER_PROCESS]
    if running:
        return min(running, key=lambda x: len(x.sessions))
    idle = [x for x in slots if len(x.sessions) < PER_PROCESS]
    if idle:
        return idle[0]
    if len(slots) * PER_PROCESS < MAX_SESSIONS:
        slot = Slot(len(slots))
        slots.append(slot)
        return slot
    return None


async def _reaper() -> None:
    while True:
        await asyncio.sleep(30)
        now = time.time()
        for sid, sess in list(state["sessions"].items()):
            if now - sess.last > IDLE_SECONDS:
                await _close(sid)


async def _close(sid: str) -> None:
    sess = state["sessions"].pop(sid, None)
    if sess is None:
        return
    sess.slot.sessions.discard(sid)
    try:
        await asyncio.wait_for(sess.context.close(), 15)
    except Exception:  # noqa: BLE001
        log.warning("could not close %s", sid, exc_info=True)
    # Keep the first browser warm; stop the others when they empty (memory).
    if not sess.slot.sessions and sess.slot.n > 0:
        await sess.slot.stop()


async def _restart_slot(slot: Slot) -> None:
    """Close the stuck browser's sessions and the browser; agents reopen on their next step."""
    log.warning("browser %d looks stuck (%d timeouts in %ds): restarting it", slot.n, WEDGE_TIMEOUTS, WEDGE_WINDOW)
    for sid in list(slot.sessions):
        await _close(sid)
    await slot.stop()
    state["restarts"] += 1


async def _note_timeout(sess: Session) -> None:
    now = time.time()
    slot = sess.slot
    slot.timeouts = [t for t in slot.timeouts if now - t < WEDGE_WINDOW] + [now]
    if len(slot.timeouts) >= WEDGE_TIMEOUTS:
        await _restart_slot(slot)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_reaper())
    yield
    task.cancel()
    for sid in list(state["sessions"]):
        await _close(sid)
    for slot in state["slots"]:
        await slot.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


def _auth(token: str | None) -> None:
    if not token or not secrets.compare_digest(token, TOKEN):
        raise HTTPException(401, "bad token")


class Open(BaseModel):
    task_id: str = Field(max_length=60)
    agent_id: str = Field(max_length=60)
    # Pages (top-level navigations) only on these hosts and their subdomains; None = any
    # public site.
    allowed_hosts: list[str] | None = Field(default=None, max_length=40)
    # A saved session (cookies + origins) to open the context with. Never logged or echoed.
    storage_state: dict[str, Any] | None = None


class Act(BaseModel):
    # goto | click | type | select | check | press | scroll | back | read | look | snapshot |
    # find | wait | verify | login_submit
    action: str
    url: str | None = None
    element: int | None = None  # an old numbered view: element 7 is ref e7
    ref: str | None = Field(default=None, max_length=24)
    text: str | None = Field(default=None, max_length=5000)
    key: str | None = None
    dy: int = 600
    allow_submit: bool = False
    secret: bool = False  # a saved login: typed only on `hosts`, never echoed back
    secret_kind: str = ""  # username | password (a password goes only into a password field)
    hosts: list[str] = Field(default_factory=list, max_length=20)
    since: int | None = None  # the snapshot revision the model last saw (for deltas)
    full: bool = False  # snapshot: every text block too, not only what can be acted on
    scope: str | None = Field(default=None, max_length=24)  # snapshot: one container's ref
    marks: bool = False  # draw the refs on the returned frame (set-of-marks, for vision)
    role: str = Field(default="", max_length=40)  # find
    name: str = Field(default="", max_length=200)  # find: words in the accessible name
    timeout: float = 10  # wait, seconds (at most WAIT_MAX)
    state: str = "visible"  # wait for a ref: visible | hidden


class StateIn(BaseModel):
    hosts: list[str] = Field(min_length=1, max_length=20)


async def _shot(page: Any) -> bytes:
    return await page.screenshot(type="jpeg", quality=55, timeout=10_000, scale="css")


async def _frame(page: Any) -> str:
    return base64.b64encode(await _shot(page)).decode()


async def _marked_frame(page: Any) -> str:
    try:
        await page.evaluate(MARKS_JS, True)
        return await _frame(page)
    finally:
        try:
            await page.evaluate(MARKS_JS, False)
        except Exception:  # noqa: BLE001 - the page went away
            pass


async def _press(page: Any, loc: Any) -> None:
    """Click (Playwright waits for a page the click starts), then for that page to load."""
    await loc.click(timeout=10_000)
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:  # noqa: BLE001 - not every click opens a page
        pass


def _target(body: Act) -> str | None:
    return parse_ref(body.ref) if body.ref else parse_ref(body.element)


async def _locate(page: Any, ref: str) -> Any | None:
    """The element a ref names, now; None when it is gone (the page changed).

    A ref lives on the element (data-agentic-ref) and in the page's registry. A re-render
    can briefly leave a clone carrying the same attribute; the registry tells the real one
    apart, else the visible one is used.
    """
    fr = frame_of(ref)
    root = page.frame_locator(f'[data-agentic-ref="{fr}"]') if fr else page
    loc = root.locator(f'[data-agentic-ref="{ref}"]')
    count = await loc.count()
    if count == 0:
        return None
    if count == 1:
        return loc
    if not fr:
        idx = await loc.evaluate_all(
            "(els, ref) => els.findIndex(e => window.__agenticRefs && window.__agenticRefs.map.get(e) === ref)",
            ref,
        )
        if isinstance(idx, int) and idx >= 0:
            return loc.nth(idx)
    log.warning("ref %s matched %d nodes; using the first visible", ref, count)
    vis = root.locator(f'[data-agentic-ref="{ref}"]:visible')
    return vis.first if await vis.count() else loc.first


def _gone(ref: str | None) -> str:
    if not ref:
        return "Give the element's ref from the page view (for example e12)."
    return f"There is no element {ref} on the page now (it changed). Use the refs in the view below."


async def _snapshot_nodes(page: Any, *, full: bool = False, scope: str | None = None) -> dict[str, Any]:
    raw = await page.evaluate(SNAPSHOT_JS, {"full": full, "scope": scope})
    if not isinstance(raw, dict):
        return {"nodes": [], "doc": "", "auth_form": None}
    return raw


async def _guard_frames(s: Session) -> None:
    """Routes only see the first URL of a redirect chain, so a page can be redirected to a
    non-public address (or off the allowed hosts). Such a page or frame is blanked before
    anything of it is read or shown. The request itself is stopped by the egress proxy,
    which checks every hop; this is the second line for a browser run without one."""
    page = s.page
    for fr in list(page.frames):
        u = fr.url
        if not u.startswith(("http:", "https:")) or await host_ok(urlparse(u).hostname):
            continue
        s.unsafe = urlparse(u).hostname or u
        try:
            await fr.goto("about:blank", timeout=5000)
        except Exception:  # noqa: BLE001 - a detached frame
            pass
    if s.allowed and page.url.startswith("http") and not host_matches(page.url, s.allowed):
        s.blocked = page.url
        try:
            await page.go_back(timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        if page.url.startswith("http") and not host_matches(page.url, s.allowed):
            await page.goto("about:blank")


async def _observe(
    s: Session,
    point: dict[str, float] | None = None,
    *,
    read: bool = False,
    since: int | None = None,
    force_full: bool = False,
    marks: bool = False,
) -> dict[str, Any]:
    page = s.page
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=8000)
    except Exception:  # noqa: BLE001 - observe whatever is there
        pass
    try:  # frames load after the page: give them a moment so their fields are seen
        if await page.evaluate("() => !!document.querySelector('iframe,frame')"):
            await page.wait_for_load_state("load", timeout=4000)
    except Exception:  # noqa: BLE001
        pass
    await _guard_frames(s)
    raw = await _snapshot_nodes(page)
    nodes = raw.get("nodes") or []
    rendered = render(nodes)
    text = str(await page.evaluate(TEXT_JS) or "")
    flat = " ".join(text.split())
    prev = s.history.get(since) if since is not None else None
    snap = s.history.add(str(raw.get("doc") or ""), page.url, rendered.lines, text)
    d = Delta("full", [], [], [], 1.0) if force_full else diff(prev, snap)
    obs: dict[str, Any] = {
        "url": page.url,
        "title": await page.title(),
        "rev": snap.rev,
        "since": prev.rev if prev else None,
        "mode": d.mode,
        "auth_form": raw.get("auth_form"),
        "omitted": rendered.omitted,
        "elements": form_elements(nodes),
        "text_chars": len(flat),
        "point": point,
    }
    if d.mode == "full":
        obs["snapshot"] = rendered.text() + ("\n" + footer(rendered) if rendered.omitted else "")
        if raw.get("truncated"):
            obs["snapshot"] += "\n(a very long page: only its first part was read; use browser_find)"
        obs["text"] = flat[: (READ_CHARS if read else TEXT_CHARS)]
        obs["text_rest"] = uncovered_text(text, [line for _, line in rendered.lines])
        # Table rows in bold usually mean unread or new; the plain text loses that.
        obs["bold_rows"] = await page.evaluate(BOLD_ROWS_JS)
    else:
        obs["delta"] = d.text()
        obs["counts"] = [len(d.added), len(d.removed), len(d.changed)]
        obs["text_delta"] = text_delta(prev.text if prev else "", text)
        if read:
            obs["text"] = flat[:READ_CHARS]
    if read:
        try:
            obs["html"] = (await page.content())[:HTML_CHARS]
        except Exception:  # noqa: BLE001 - text is enough
            pass
    if s.blocked and s.allowed:
        obs["error"] = blocked_text(s.blocked, s.allowed)
        s.blocked = None
    if s.unsafe:
        obs["error"] = (
            f"The page sent the browser to {s.unsafe}, a non-public address; it was blocked."
        )
        s.unsafe = None
    obs["frame"] = await (_marked_frame(page) if marks else _frame(page))
    return obs


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "sessions": len(state["sessions"]),
        "processes": sum(1 for x in state["slots"] if x.browser is not None),
        "restarts": state["restarts"],
        "humanize": HUMANIZE,
        "snapshots": "a11y-refs",
    }


def _clean_state(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    cookies = [c for c in raw.get("cookies") or [] if isinstance(c, dict) and c.get("name") and c.get("domain")]
    origins = [o for o in raw.get("origins") or [] if isinstance(o, dict) and str(o.get("origin", "")).startswith("http")]
    if not cookies and not origins:
        return None
    return {"cookies": cookies[:300], "origins": origins[:20]}


@app.post("/sessions")
async def open_session(body: Open, x_browser_token: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_browser_token)
    for sess in state["sessions"].values():
        if sess.owner["task_id"] == body.task_id:
            sess.last = time.time()
            return {"id": sess.id, "restored": False, "reused": True}
    slot = _slot_for_new()
    if slot is None:
        # Full: free the longest-idle session, but never one used in the last minute.
        idle = [x for x in state["sessions"].values() if time.time() - x.last > 60]
        if not idle:
            raise HTTPException(503, "All browsers are busy. Try again in a minute.")
        await _close(min(idle, key=lambda x: x.last).id)
        slot = _slot_for_new()
        assert slot is not None
    sid = "bs_" + secrets.token_hex(8)
    slot.sessions.add(sid)  # reserve the place before the (slow) launch
    restore = _clean_state(body.storage_state)
    sess = Session(sid, {"task_id": body.task_id, "agent_id": body.agent_id}, slot, body.allowed_hosts)
    try:
        browser = await slot.get()
        kwargs: dict[str, Any] = {"viewport": VIEWPORT, "accept_downloads": False}
        if restore:
            kwargs["storage_state"] = restore
        try:
            sess.context = await browser.new_context(**kwargs)
        except Exception:  # noqa: BLE001 - a damaged saved session: start clean
            if not restore:
                raise
            log.warning("saved session for %s could not be loaded; starting clean", sid)
            restore = None
            sess.context = await browser.new_context(viewport=VIEWPORT, accept_downloads=False)

        async def route(r: Any) -> None:
            await _route(r, sess)

        await sess.context.route("**/*", route)
        sess.page = await sess.context.new_page()
    except Exception:
        slot.sessions.discard(sid)
        raise
    state["sessions"][sid] = sess
    return {"id": sid, "restored": bool(restore), "reused": False}


def _cookie_for(domain: str, hosts: list[str]) -> bool:
    d = domain.lower().lstrip(".")
    for h in hosts:
        h = h.lower()
        # the login's hosts and their subdomains, and parent-domain cookies they send
        if d == h or d.endswith("." + h) or (h.endswith("." + d) and "." in d):
            return True
    return False


@app.post("/sessions/{sid}/state")
async def export_state(sid: str, body: StateIn, x_browser_token: str | None = Header(default=None)) -> dict[str, Any]:
    """The context's cookies and local storage for these hosts only (a saved login's)."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    async with s.lock:
        raw = await s.context.storage_state()
    cookies = [c for c in raw.get("cookies") or [] if _cookie_for(str(c.get("domain", "")), body.hosts)]
    origins = [o for o in raw.get("origins") or [] if host_matches(str(o.get("origin", "")), body.hosts)]
    out = {"cookies": cookies, "origins": origins}
    if len(json.dumps(out)) > STATE_BYTES:
        out = {"cookies": cookies, "origins": []}
    return {"state": out, "cookies": len(cookies), "origins": len(out["origins"])}


@app.post("/sessions/{sid}/forget")
async def forget_state(sid: str, body: StateIn, x_browser_token: str | None = Header(default=None)) -> dict[str, bool]:
    """Drop a restored session that no longer works: its cookies, and the site's storage."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    async with s.lock:
        for h in body.hosts:
            await s.context.clear_cookies(domain=re.compile(r"^\.?(.*\.)?" + re.escape(h.lower()) + "$"))
        if host_matches(s.page.url, body.hosts):
            try:
                await s.page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True}


async def _do_snapshot(s: Session, body: Act) -> dict[str, Any]:
    """An explicit snapshot: always the whole tree (or one container, or every text block)."""
    page = s.page
    if not body.full and not body.scope:
        return await _observe(s, since=None, force_full=True, marks=body.marks)
    raw = await _snapshot_nodes(page, full=body.full, scope=parse_ref(body.scope) if body.scope else None)
    if raw.get("error"):
        obs = await _observe(s, since=body.since, marks=body.marks)
        obs["error"] = str(raw["error"]) + ". Use a ref from the view below."
        return obs
    rendered = render(raw.get("nodes") or [], full=True)
    return {
        "url": page.url,
        "title": await page.title(),
        "rev": s.history.rev,
        "mode": "full",
        "scope": body.scope,
        "snapshot": rendered.text() + ("\n" + footer(rendered) if rendered.omitted else ""),
        "omitted": rendered.omitted,
        "auth_form": raw.get("auth_form"),
        "elements": form_elements(raw.get("nodes") or []),
        "frame": await (_marked_frame(page) if body.marks else _frame(page)),
    }


async def _do_find(s: Session, body: Act) -> dict[str, Any]:
    raw = await _snapshot_nodes(s.page, full=True)
    hits = find_nodes(raw.get("nodes") or [], body.role, body.name, body.text or "")
    lines = []
    for n in hits[:25]:
        line = node_line(n)
        if n.get("ref") and f"[{n['ref']}]" not in line:
            line += f" [{n['ref']}]"
        lines.append(line)
    return {
        "url": s.page.url,
        "title": await s.page.title(),
        "rev": s.history.rev,
        "found": lines,
        "matches": len(hits),
        "frame": await _frame(s.page),
    }


async def _do_wait(s: Session, body: Act) -> str | None:
    """Wait for text, a URL or an element; an error text when it did not happen in time."""
    page = s.page
    ms = int(max(0.5, min(float(body.timeout or 10), WAIT_MAX)) * 1000)
    try:
        if body.text:
            await page.wait_for_function(WAIT_TEXT_JS, arg=body.text.strip().lower(), timeout=ms, polling=250)
        elif body.url:
            needle = body.url.strip()
            await page.wait_for_url(lambda u: needle in u, timeout=ms)
        else:
            ref = _target(body)
            if not ref:
                return "Say what to wait for: text, url or ref."
            loc = await _locate(page, ref)
            if loc is None:
                return None if body.state == "hidden" else _gone(ref)
            await loc.wait_for(state="hidden" if body.state == "hidden" else "visible", timeout=ms)
    except Exception as e:  # noqa: BLE001
        if "Timeout" in e.__class__.__name__:
            what = body.text or body.url or body.ref or body.element
            return f"Waited {ms // 1000} s: {what!s} did not show up."
        raise
    return None


@app.post("/sessions/{sid}/act")
async def act(sid: str, body: Act, x_browser_token: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session (it may have closed after being idle)")
    async with s.lock:
        s.last = time.time()
        page = s.page
        point = None
        note = None
        try:
            if body.action == "goto":
                u = urlparse(body.url or "")
                if u.scheme not in ("http", "https") or not await host_ok(u.hostname):
                    return {"error": "That address is not allowed (only public http/https sites)."}
                if s.allowed and not host_matches(body.url or "", s.allowed):
                    return {"error": blocked_text(body.url or "", s.allowed)}
                await page.goto(body.url, wait_until="domcontentloaded", timeout=30_000)
            elif body.action == "verify":
                # Is a restored session still signed in? Load its check page: it must stay on
                # the login's hosts and show no sign-in or one-time-code form.
                u = urlparse(body.url or "")
                if u.scheme not in ("http", "https") or not host_matches(body.url or "", body.hosts):
                    return {"error": "The check page is not on this login's site.", "verified": False}
                if s.allowed and not host_matches(body.url or "", s.allowed):
                    return {"error": blocked_text(body.url or "", s.allowed), "verified": False}
                await page.goto(body.url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:  # noqa: BLE001
                    pass
                obs = await _observe(s, since=None, force_full=True)
                obs["verified"] = host_matches(page.url, body.hosts) and not obs.get("auth_form")
                return obs
            elif body.action == "snapshot" or body.action == "look":
                return await _do_snapshot(s, body)
            elif body.action == "find":
                return await _do_find(s, body)
            elif body.action == "wait":
                note = await _do_wait(s, body)
            elif body.action == "login_submit":
                # The sign-in button of the form that holds the saved password: the only
                # submit that needs no person, because saving the login allowed it.
                if not body.hosts or not host_matches(page.url, body.hosts):
                    return {"error": "This saved login is not for this site."}
                ref = _target(body)
                loc = await _locate(page, ref) if ref else None
                if loc is None:
                    return {"error": _gone(ref)}
                same_form = await loc.evaluate(
                    "(el) => { const f = el.form || el.closest('form');"
                    " return !!f && !!f.querySelector('input[type=password][data-agentic-secret]'); }"
                )
                if not same_form:
                    return {"error": "That is not the sign-in button of the login form."}
                box = await loc.bounding_box()
                if box:
                    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
                await _press(page, loc)
                try:
                    await page.wait_for_load_state("networkidle", timeout=6000)
                except Exception:  # noqa: BLE001
                    pass
            elif body.action in ("click", "type", "select", "check"):
                ref = _target(body)
                loc = await _locate(page, ref) if ref else None
                if loc is None:
                    obs = await _observe(s, since=body.since)
                    obs["error"] = _gone(ref)
                    return obs
                info = await loc.evaluate(SUBMIT_JS)
                box = await loc.bounding_box()
                if box:
                    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
                if body.action == "click":
                    if info["submit"] and not body.allow_submit:
                        return {"error": "SUBMIT_NEEDS_APPROVAL: this button sends the form. Use browser_submit."}
                    await _press(page, loc)
                elif body.action == "type":
                    if body.secret:
                        if not body.hosts or not host_matches(page.url, body.hosts):
                            return {"error": "This saved login is not for this site."}
                        if body.secret_kind == "password" and not await loc.evaluate(
                            "(el) => el.tagName === 'INPUT' && el.type === 'password'"
                        ):
                            return {"error": "The password can only go into a password field."}
                        await loc.evaluate("(el) => el.setAttribute('data-agentic-secret', '1')")
                    await loc.fill(body.text or "", timeout=10_000)
                    if body.key == "Enter":
                        if not body.allow_submit:
                            return {"error": "SUBMIT_NEEDS_APPROVAL: Enter would send the form. Use browser_submit."}
                        await loc.press("Enter")
                elif body.action == "select":
                    try:
                        await loc.select_option(label=body.text or "", timeout=5000)
                    except Exception:  # noqa: BLE001 - try the value instead of the label
                        await loc.select_option(value=body.text or "", timeout=5000)
                else:
                    await loc.set_checked(bool(body.text not in ("false", "off", "0")), timeout=5000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=4000)
                except Exception:  # noqa: BLE001
                    pass
            elif body.action == "press":
                if body.key == "Enter" and not body.allow_submit:
                    return {"error": "SUBMIT_NEEDS_APPROVAL: Enter may send a form. Use browser_submit."}
                await page.keyboard.press(body.key or "Tab")
            elif body.action == "scroll":
                await page.mouse.wheel(0, body.dy)
                await asyncio.sleep(0.4)
            elif body.action == "back":
                await page.go_back(timeout=15_000)
            elif body.action != "read":
                return {"error": f"unknown action {body.action}"}
        except Exception as e:  # noqa: BLE001 - tell the agent what went wrong, keep the session
            err = f"{e.__class__.__name__}: {str(e).splitlines()[0][:300]}"
            if "Timeout" in e.__class__.__name__:
                await _note_timeout(s)
                if sid not in state["sessions"]:  # the browser was just restarted
                    return {"error": f"{err}. The browser was stuck and has been restarted: open the page again."}
            if s.blocked and s.allowed:
                err = blocked_text(s.blocked, s.allowed)
                s.blocked = None
            try:
                obs = await asyncio.wait_for(_observe(s, since=body.since), 15)
            except Exception:  # noqa: BLE001 - the page itself is unusable
                return {"error": err}
            obs["error"] = err
            return obs
        obs = await _observe(s, point, read=body.action == "read", since=body.since, marks=body.marks)
        if note:
            obs["error"] = note
        return obs


@app.get("/sessions/{sid}/frame")
async def frame(sid: str, x_browser_token: str | None = Header(default=None)) -> Response:
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    return Response(await _shot(s.page), media_type="image/jpeg")


@app.delete("/sessions/{sid}")
async def close(sid: str, x_browser_token: str | None = Header(default=None)) -> dict[str, bool]:
    _auth(x_browser_token)
    await _close(sid)
    return {"ok": True}
