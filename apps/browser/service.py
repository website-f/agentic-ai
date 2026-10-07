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
tool, which always needs a person's approval). Controls whose label says they change data
(save, simpan, upload, perakuan, serah, selesai, sediakan ...) count as submits whatever
their tag, links included.

Downloads (a click that downloads a file, a PDF a tab opens) are kept in the session until
the worker collects them into the company's files. A new tab becomes the page the agent
works on, and closing it (back on a tab with no history) returns to the one before. Files
are uploaded only with allow_submit (the agent's browser_upload, always approved by a
person). While an approval waits, the worker holds the session so the idle reaper keeps it.

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
import random
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
# A session held for an approval outlives IDLE_SECONDS, up to this long.
HOLD_MAX = int(os.environ.get("BROWSER_HOLD_MAX", "7200"))
DOWNLOAD_MAX = 25 * 1024 * 1024  # one downloaded file
DOWNLOADS_MAX = 80 * 1024 * 1024  # all files a session keeps until the worker collects them
DOWNLOAD_WAIT = 25  # seconds an action waits for the downloads it started
UPLOAD_MAX = 20 * 1024 * 1024  # one uploaded file
VIEWPORT = {"width": 1280, "height": 800}
TEXT_CHARS = 2500
READ_CHARS = 12_000
HTML_CHARS = 1_500_000
STATE_BYTES = 512 * 1024  # an exported session bigger than this keeps its cookies only
WAIT_MAX = 30
# Camoufox's humanized cursor deadlocks once 3+ contexts click at the same time (helpers
# working in parallel), so it is off unless asked for.
HUMANIZE = os.environ.get("BROWSER_HUMANIZE", "false").lower() in ("1", "true", "yes")
# Gentle pacing: keep to a human speed on the site so a portal does not see a burst of
# machine-speed requests from one session (every click on a server-form portal like
# ePerolehan is a POST). A minimum gap between server-touching actions, plus a cap per
# minute. Read-only looks at the already-loaded page are never paced. All tunable per env.
PACE_MIN = float(os.environ.get("BROWSER_PACE_MIN", "2.5"))  # seconds between server actions
PACE_JITTER = float(os.environ.get("BROWSER_PACE_JITTER", "1.5"))  # extra 0..this, random
PACE_WINDOW = 60.0
PACE_MAX = int(os.environ.get("BROWSER_PACE_MAX_PER_MIN", "20"))  # server actions per minute
# Actions that make the site's server work (a click, a form post, a navigation). Observing
# the already-loaded page (snapshot, find, look, read, wait, scroll) is not one of these.
SERVER_ACTIONS = frozenset(
    {
        "goto",
        "verify",
        "click",
        "type",
        "select",
        "check",
        "press",
        "login_submit",
        "upload",
        "back",
    }
)
# Self-healing: this many timeouts in one browser process within WEDGE_WINDOW seconds means
# it is stuck; it is restarted and its agents' next step opens a fresh session.
WEDGE_TIMEOUTS = 4
WEDGE_WINDOW = 120
# Dev only: extra host names allowed although they are private (the practice portal on the
# browser network). Empty in production.
ALLOW_HOSTS = {
    h.strip().lower() for h in os.environ.get("BROWSER_ALLOW_HOSTS", "").split(",") if h.strip()
}
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
# A PDF downloads (and is kept) instead of opening in Firefox's own viewer, which shows the
# agent nothing it can read or save.
DOWNLOAD_PREFS: dict[str, Any] = {
    "pdfjs.disabled": True,
    "browser.download.open_pdf_attachments_inline": False,
    "browser.download.always_ask_before_handling_new_types": False,
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

SUBMIT_JS = r"""(el) => {
  const label = [el.innerText, el.value, el.getAttribute('aria-label'), el.title, el.name, el.id]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const transaction = /\b(save|simpan|submit|hantar|serah|sign|tanda\s*tangan|tandatangan|declare|declaration|perakuan|akuan|register|daftar|upload|muat\s*naik|delete|remove|hapus|bayar|pay|confirm|sah|approve|lulus|selesai|finish|sediakan|kemaskini|batal|withdraw|tarik\s*balik)\b/i.test(label);
  const submit = (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit') && !!el.form)
    || (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'image'));
  return {submit: submit || transaction, transaction, label};
}"""


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
                extra: dict[str, Any] = {"firefox_user_prefs": dict(DOWNLOAD_PREFS)}
                if PROXY:
                    extra = {
                        "proxy": {"server": PROXY},
                        "firefox_user_prefs": {**PROXY_PREFS, **DOWNLOAD_PREFS},
                    }
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
    def __init__(
        self, sid: str, owner: dict[str, Any], slot: Slot, allowed: list[str] | None
    ) -> None:
        self.id, self.owner, self.slot = sid, owner, slot
        self.context: Any = None
        self.page: Any = None
        self.allowed = [h.lower() for h in (allowed or []) if h] or None
        self.blocked: str | None = None
        self.unsafe: str | None = None
        self.history = History()
        self.last = time.time()
        self.lock = asyncio.Lock()
        self.hold_until = 0.0  # an approval is waiting: the reaper keeps the session
        self.pages: list[Any] = []  # open tabs, oldest first; self.page is the one in use
        self.opened: list[Any] = []  # tabs opened since the last action
        self.downloads: dict[str, dict[str, Any]] = {}  # kept until the worker collects them
        self.new_downloads: list[str] = []
        self.download_notes: list[str] = []
        self.pending: set[asyncio.Task[None]] = set()
        self.last_server = 0.0  # when this session last made the site's server work
        self.act_times: list[float] = []  # recent server-action times, for the per-minute cap
        # P31: a Chrome/Edge on the person's own computer, reached over the API's CDP relay
        # (connect_over_cdp). Closing the session only disconnects; the PC closes its window.
        self.remote: Any = None


async def _pace(s: "Session", action: str) -> None:
    """Hold to a human pace: wait out the gap since this session's last server-touching
    action (with jitter), and never exceed PACE_MAX of them a minute. Read-only observation
    of the loaded page is not paced, so the agent still reads and thinks at full speed."""
    if action not in SERVER_ACTIONS:
        return
    now = time.time()
    wait = (s.last_server + PACE_MIN + random.uniform(0, PACE_JITTER)) - now
    s.act_times = [t for t in s.act_times if now - t < PACE_WINDOW]
    if len(s.act_times) >= PACE_MAX:  # over the per-minute cap: wait for the window to roll
        wait = max(wait, PACE_WINDOW - (now - s.act_times[0]) + 0.1)
    if wait > 0:
        await asyncio.sleep(min(wait, PACE_WINDOW))
    s.last_server = time.time()
    s.act_times.append(s.last_server)


def _kept_bytes(sess: "Session") -> int:
    return sum(len(d["data"]) for d in sess.downloads.values())


async def _take_download(sess: Session, download: Any) -> None:
    """Keep a finished download in the session (until the worker collects it)."""
    name = re.sub(r"[\\/\x00-\x1f]", "_", str(download.suggested_filename or "download"))[:200]
    try:
        path = await download.path()
        data = await asyncio.to_thread(lambda: open(path, "rb").read()) if path else b""  # noqa: ASYNC230
    except Exception as e:  # noqa: BLE001 - a failed download is reported, not raised
        sess.download_notes.append(f"{name}: the download failed ({e.__class__.__name__}).")
        return
    if not data:
        sess.download_notes.append(f"{name}: the download was empty.")
    elif len(data) > DOWNLOAD_MAX or _kept_bytes(sess) + len(data) > DOWNLOADS_MAX:
        sess.download_notes.append(f"{name}: too big to keep ({len(data) // 1024:,} KB).")
    else:
        did = "dl_" + secrets.token_hex(6)
        sess.downloads[did] = {"name": name, "data": data, "url": str(download.url or "")}
        sess.new_downloads.append(did)


def _on_page(sess: Session, page: Any) -> None:
    """Every tab in the context: watch its downloads; a tab the site opens becomes current."""
    sess.pages.append(page)
    if sess.page is not None:
        sess.opened.append(page)

    def on_download(d: Any) -> None:
        t = asyncio.create_task(_take_download(sess, d))
        sess.pending.add(t)
        t.add_done_callback(sess.pending.discard)

    def on_close(p: Any) -> None:
        if p in sess.pages:
            sess.pages.remove(p)
        if p in sess.opened:
            sess.opened.remove(p)
        if sess.page is p and sess.pages:
            sess.page = sess.pages[-1]

    page.on("download", on_download)
    page.on("close", on_close)


PAGE_FETCH_JS = """async (url) => {
  const r = await fetch(url, {credentials: 'include'});
  if (!r.ok) return null;
  const b = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}"""


async def _looks_pdf(page: Any) -> bool:
    if urlparse(page.url).path.lower().endswith(".pdf"):
        return True
    try:
        return await page.evaluate("() => document.contentType") == "application/pdf"
    except Exception:  # noqa: BLE001 - a page that is going away
        return False


async def _grab_pdf(s: Session, page: Any) -> bool:
    """Firefox showed a PDF instead of downloading it: fetch it again with the tab's cookies
    (inside the page, so through the same proxy and guard) and keep it as a download."""
    if not await host_ok(urlparse(page.url).hostname):
        return False
    body = b""
    try:
        b64 = await page.evaluate(PAGE_FETCH_JS, page.url)
        body = base64.b64decode(b64) if b64 else b""
    except Exception:  # noqa: BLE001 - try the context's own request next
        log.info("in-page fetch of %s failed", page.url, exc_info=True)
    if body[:5] != b"%PDF-":
        try:
            r = await s.context.request.get(page.url, timeout=30_000)
            body = await r.body() if r.ok else b""
        except Exception:  # noqa: BLE001
            log.info("could not fetch the PDF %s", page.url, exc_info=True)
            return False
    if body[:5] != b"%PDF-" or len(body) > DOWNLOAD_MAX:
        return False
    did = "dl_" + secrets.token_hex(6)
    name = os.path.basename(urlparse(page.url).path) or "document.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    s.downloads[did] = {"name": name[:200], "data": body, "url": page.url}
    s.new_downloads.append(did)
    return True


async def _settle(s: Session) -> str | None:
    """After an action: wait for the downloads it started, and move to a tab it opened.
    Returns a note for the agent, or None."""
    notes: list[str] = []
    deadline = time.time() + DOWNLOAD_WAIT
    if s.opened:  # a tab that turns into a download needs a moment to start it
        await asyncio.sleep(1.5)
    while s.pending and time.time() < deadline:
        await asyncio.wait(set(s.pending), timeout=max(0.1, deadline - time.time()))
    if s.pending:
        notes.append("A download is still running; it will be listed after your next action.")
    for page in list(s.opened):
        s.opened.remove(page)
        if page.is_closed():
            continue
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:  # noqa: BLE001 - use whatever is there
            pass
        if page.url in ("", "about:blank") and s.new_downloads:
            await page.close()  # the tab only delivered a download
            continue
        if await _looks_pdf(page) and await _grab_pdf(s, page):
            await page.close()  # the PDF is kept; stay where the agent was
            continue
        s.page = page
        notes.append(
            f"The site opened a new tab ({page.url}); you are on it now. browser_back on a "
            "tab with no history closes it and returns to the previous tab."
        )
    page = s.page
    if page is not None and not page.is_closed() and await _looks_pdf(page):
        if await _grab_pdf(s, page):
            try:  # back to the page that led here, when there is one
                if await page.go_back(timeout=15_000) is None and len(s.pages) > 1:
                    await page.close()
                    s.page = s.pages[-1]
            except Exception:  # noqa: BLE001 - stay on the PDF
                pass
    if s.download_notes:
        notes += s.download_notes
        s.download_notes = []
    return " ".join(notes) or None


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
            if now - sess.last > IDLE_SECONDS and now > sess.hold_until:
                await _close(sid)


async def _close(sid: str) -> None:
    sess = state["sessions"].pop(sid, None)
    if sess is None:
        return
    sess.slot.sessions.discard(sid)
    if sess.remote is not None:  # P31: let go of the person's browser (never close theirs)
        try:
            await asyncio.wait_for(sess.remote.close(), 15)
        except Exception:  # noqa: BLE001 - the relay may already be gone
            log.info("PC browser for %s already disconnected", sid)
        return
    try:
        await asyncio.wait_for(sess.context.close(), 15)
    except Exception:  # noqa: BLE001
        log.warning("could not close %s", sid, exc_info=True)
    # Keep the first browser warm; stop the others when they empty (memory).
    if not sess.slot.sessions and sess.slot.n > 0:
        await sess.slot.stop()


async def _restart_slot(slot: Slot) -> None:
    """Close the stuck browser's sessions and the browser; agents reopen on their next step."""
    log.warning(
        "browser %d looks stuck (%d timeouts in %ds): restarting it",
        slot.n,
        WEDGE_TIMEOUTS,
        WEDGE_WINDOW,
    )
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
    if state.get("pw") is not None:
        await state["pw"].stop()


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
    # P31: drive the browser on the person's own computer through the API's CDP relay
    # (ws://api:8501/internal/devices/cdp/{channel}) instead of one of ours.
    cdp_url: str | None = Field(default=None, max_length=300)


CDP_RELAY = re.compile(
    r"^wss?://[A-Za-z0-9.\-]+(:\d{1,5})?/internal/devices/cdp/[A-Za-z0-9_\-]{8,64}$"
)


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
    # upload: [{name, mime, b64}], put into the file field `ref` (or the chooser it opens);
    # then_ref is the button that sends them, pressed under the same approval.
    files: list[dict[str, str]] | None = Field(default=None, max_length=5)
    then_ref: str | None = Field(default=None, max_length=24)


class HoldIn(BaseModel):
    seconds: int = Field(ge=0, le=86_400)


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
    return (
        f"There is no element {ref} on the page now (it changed). Use the refs in the view below."
    )


async def _snapshot_nodes(
    page: Any, *, full: bool = False, scope: str | None = None
) -> dict[str, Any]:
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
            obs["snapshot"] += (
                "\n(a very long page: only its first part was read; use browser_find)"
            )
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
    cookies = [
        c
        for c in raw.get("cookies") or []
        if isinstance(c, dict) and c.get("name") and c.get("domain")
    ]
    origins = [
        o
        for o in raw.get("origins") or []
        if isinstance(o, dict) and str(o.get("origin", "")).startswith("http")
    ]
    if not cookies and not origins:
        return None
    return {"cookies": cookies[:300], "origins": origins[:20]}


@app.post("/sessions")
async def open_session(
    body: Open, x_browser_token: str | None = Header(default=None)
) -> dict[str, Any]:
    _auth(x_browser_token)
    for sess in state["sessions"].values():
        if sess.owner["task_id"] == body.task_id:
            sess.last = time.time()
            return {"id": sess.id, "restored": False, "reused": True}
    if body.cdp_url:
        return await _open_on_pc(body)
    slot = _slot_for_new()
    if slot is None:
        # Full: free the longest-idle session, but never one used in the last minute.
        idle = [
            x
            for x in state["sessions"].values()
            if time.time() - x.last > 60 and time.time() > x.hold_until
        ]
        if not idle:
            raise HTTPException(503, "All browsers are busy. Try again in a minute.")
        await _close(min(idle, key=lambda x: x.last).id)
        slot = _slot_for_new()
        assert slot is not None
    sid = "bs_" + secrets.token_hex(8)
    slot.sessions.add(sid)  # reserve the place before the (slow) launch
    restore = _clean_state(body.storage_state)
    sess = Session(
        sid, {"task_id": body.task_id, "agent_id": body.agent_id}, slot, body.allowed_hosts
    )
    try:
        browser = await slot.get()
        kwargs: dict[str, Any] = {"viewport": VIEWPORT, "accept_downloads": True}
        if restore:
            kwargs["storage_state"] = restore
        try:
            sess.context = await browser.new_context(**kwargs)
        except Exception:  # noqa: BLE001 - a damaged saved session: start clean
            if not restore:
                raise
            log.warning("saved session for %s could not be loaded; starting clean", sid)
            restore = None
            sess.context = await browser.new_context(viewport=VIEWPORT, accept_downloads=True)

        async def route(r: Any) -> None:
            await _route(r, sess)

        await sess.context.route("**/*", route)
        sess.context.on("page", lambda p: _on_page(sess, p))
        sess.page = await sess.context.new_page()
        if sess.page not in sess.pages:
            _on_page(sess, sess.page)
        sess.opened.clear()
    except Exception:
        slot.sessions.discard(sid)
        raise
    state["sessions"][sid] = sess
    return {"id": sid, "restored": bool(restore), "reused": False}


async def _playwright() -> Any:
    if state.get("pw") is None:
        from playwright.async_api import async_playwright

        state["pw"] = await async_playwright().start()
    return state["pw"]


async def _open_on_pc(body: Open) -> dict[str, Any]:
    """P31: a session on the person's own Chrome/Edge (a visible window, its own Agent
    profile, their own internet line). It takes no place in our browsers; the same page
    guards (allowed hosts, private addresses, pacing) apply."""
    if not CDP_RELAY.match(body.cdp_url or ""):
        raise HTTPException(422, "bad cdp_url")
    sid = "bs_" + secrets.token_hex(8)
    slot = Slot(-1)  # this session's own, never one of state["slots"]
    sess = Session(
        sid, {"task_id": body.task_id, "agent_id": body.agent_id}, slot, body.allowed_hosts
    )
    pw = await _playwright()
    try:
        browser = await pw.chromium.connect_over_cdp(
            body.cdp_url, headers={"x-browser-token": TOKEN}, timeout=45_000
        )
    except Exception as e:  # noqa: BLE001 - the PC went away or never connected
        raise HTTPException(502, "The browser on the person's computer did not connect.") from e
    sess.remote = slot.browser = browser
    try:
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        restore = _clean_state(body.storage_state)
        if restore and restore.get("cookies"):
            try:
                await ctx.add_cookies(restore["cookies"])
            except Exception:  # noqa: BLE001 - a damaged saved session: start clean
                log.warning("saved session for %s could not be loaded on the PC", sid)
        sess.context = ctx

        async def route(r: Any) -> None:
            await _route(r, sess)

        await ctx.route("**/*", route)
        ctx.on("page", lambda p: _on_page(sess, p))
        for p in ctx.pages:
            _on_page(sess, p)
        sess.page = ctx.pages[-1] if ctx.pages else await ctx.new_page()
        if sess.page not in sess.pages:
            _on_page(sess, sess.page)
        sess.page = sess.pages[-1]
        sess.opened.clear()
    except Exception:
        await browser.close()
        raise
    slot.sessions.add(sid)
    state["sessions"][sid] = sess
    # The person closed the window, the PC slept, or the relay ended: the next action reopens.
    browser.on("disconnected", lambda *_: asyncio.ensure_future(_close(sid)))
    return {"id": sid, "restored": False, "reused": False, "on_pc": True}


def _cookie_for(domain: str, hosts: list[str]) -> bool:
    d = domain.lower().lstrip(".")
    for h in hosts:
        h = h.lower()
        # the login's hosts and their subdomains, and parent-domain cookies they send
        if d == h or d.endswith("." + h) or (h.endswith("." + d) and "." in d):
            return True
    return False


@app.post("/sessions/{sid}/state")
async def export_state(
    sid: str, body: StateIn, x_browser_token: str | None = Header(default=None)
) -> dict[str, Any]:
    """The context's cookies and local storage for these hosts only (a saved login's)."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    async with s.lock:
        raw = await s.context.storage_state()
    cookies = [
        c for c in raw.get("cookies") or [] if _cookie_for(str(c.get("domain", "")), body.hosts)
    ]
    origins = [
        o for o in raw.get("origins") or [] if host_matches(str(o.get("origin", "")), body.hosts)
    ]
    out = {"cookies": cookies, "origins": origins}
    if len(json.dumps(out)) > STATE_BYTES:
        out = {"cookies": cookies, "origins": []}
    return {"state": out, "cookies": len(cookies), "origins": len(out["origins"])}


@app.post("/sessions/{sid}/forget")
async def forget_state(
    sid: str, body: StateIn, x_browser_token: str | None = Header(default=None)
) -> dict[str, bool]:
    """Drop a restored session that no longer works: its cookies, and the site's storage."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    async with s.lock:
        for h in body.hosts:
            await s.context.clear_cookies(
                domain=re.compile(r"^\.?(.*\.)?" + re.escape(h.lower()) + "$")
            )
        if host_matches(s.page.url, body.hosts):
            try:
                await s.page.evaluate(
                    "() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }"
                )
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True}


async def _do_snapshot(s: Session, body: Act) -> dict[str, Any]:
    """An explicit snapshot: always the whole tree (or one container, or every text block)."""
    page = s.page
    if not body.full and not body.scope:
        return await _observe(s, since=None, force_full=True, marks=body.marks)
    raw = await _snapshot_nodes(
        page, full=body.full, scope=parse_ref(body.scope) if body.scope else None
    )
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
            await page.wait_for_function(
                WAIT_TEXT_JS, arg=body.text.strip().lower(), timeout=ms, polling=250
            )
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
async def act(
    sid: str, body: Act, x_browser_token: str | None = Header(default=None)
) -> dict[str, Any]:
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session (it may have closed after being idle)")
    async with s.lock:
        s.last = time.time()
        await _pace(s, body.action)
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
                try:
                    await page.goto(body.url, wait_until="domcontentloaded", timeout=30_000)
                except Exception as e:  # noqa: BLE001 - a link to a file downloads it instead
                    if "Download is starting" not in str(e):
                        raise
            elif body.action == "verify":
                # Is a restored session still signed in? Load its check page: it must stay on
                # the login's hosts and show no sign-in or one-time-code form.
                u = urlparse(body.url or "")
                if u.scheme not in ("http", "https") or not host_matches(
                    body.url or "", body.hosts
                ):
                    return {
                        "error": "The check page is not on this login's site.",
                        "verified": False,
                    }
                # Same public-address guard as goto: a login's hosts list is no reason to
                # load an internal address.
                if not await host_ok(u.hostname):
                    return {
                        "error": "That address is not allowed (only public http/https sites).",
                        "verified": False,
                    }
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
                        what = (
                            "changes external data" if info.get("transaction") else "sends the form"
                        )
                        return {
                            "error": f"SUBMIT_NEEDS_APPROVAL: this control {what}. Use browser_submit."
                        }
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
                            return {
                                "error": "SUBMIT_NEEDS_APPROVAL: Enter would send the form. Use browser_submit."
                            }
                        await loc.press("Enter")
                elif body.action == "select":
                    try:
                        await loc.select_option(label=body.text or "", timeout=5000)
                    except Exception:  # noqa: BLE001 - try the value instead of the label
                        await loc.select_option(value=body.text or "", timeout=5000)
                else:
                    await loc.set_checked(
                        bool(body.text not in ("false", "off", "0")), timeout=5000
                    )
                try:
                    await page.wait_for_load_state("networkidle", timeout=4000)
                except Exception:  # noqa: BLE001
                    pass
            elif body.action == "upload":
                if not body.allow_submit:
                    return {
                        "error": "SUBMIT_NEEDS_APPROVAL: uploading sends a file. Use browser_upload."
                    }
                err, point = await _do_upload(s, body)
                if err:
                    obs = await _observe(s, since=body.since)
                    obs["error"] = err
                    return obs
            elif body.action == "capture":
                # The whole page as an image (Firefox cannot print to PDF); the worker turns it
                # into a PDF. A print or offer view is usually one long page.
                png = await page.screenshot(type="png", full_page=True, timeout=30_000)
                obs = await _observe(s, since=body.since)
                obs["capture_b64"] = base64.b64encode(png).decode()
                return obs
            elif body.action == "press":
                if body.key == "Enter" and not body.allow_submit:
                    return {
                        "error": "SUBMIT_NEEDS_APPROVAL: Enter may send a form. Use browser_submit."
                    }
                await page.keyboard.press(body.key or "Tab")
            elif body.action == "scroll":
                await page.mouse.wheel(0, body.dy)
                await asyncio.sleep(0.4)
            elif body.action == "back":
                went = await page.go_back(timeout=15_000)
                if went is None and len(s.pages) > 1:
                    # A tab the site opened, with nothing to go back to: close it.
                    await page.close()
                    s.page = s.pages[-1]
                    note = "Closed that tab; back on the previous one."
            elif body.action != "read":
                return {"error": f"unknown action {body.action}"}
        except Exception as e:  # noqa: BLE001 - tell the agent what went wrong, keep the session
            err = f"{e.__class__.__name__}: {str(e).splitlines()[0][:300]}"
            if "Timeout" in e.__class__.__name__:
                await _note_timeout(s)
                if sid not in state["sessions"]:  # the browser was just restarted
                    return {
                        "error": f"{err}. The browser was stuck and has been restarted: open the page again."
                    }
            if s.blocked and s.allowed:
                err = blocked_text(s.blocked, s.allowed)
                s.blocked = None
            try:
                obs = await asyncio.wait_for(_observe(s, since=body.since), 15)
            except Exception:  # noqa: BLE001 - the page itself is unusable
                return {"error": err}
            obs["error"] = err
            return obs
        if body.action in ("click", "upload", "press", "goto", "login_submit", "type"):
            settled = await _settle(s)
            note = " ".join(x for x in (note, settled) if x) or None
        obs = await _observe(
            s, point, read=body.action == "read", since=body.since, marks=body.marks
        )
        if note:
            obs["error" if body.action == "wait" else "note"] = note
        if s.new_downloads:
            obs["downloads"] = [
                {"id": d, "name": s.downloads[d]["name"], "size": len(s.downloads[d]["data"])}
                for d in s.new_downloads
                if d in s.downloads
            ]
            s.new_downloads = []
        return obs


async def _do_upload(s: Session, body: Act) -> tuple[str | None, dict[str, float] | None]:
    """Put the files into a file field: the field itself, the chooser a button opens, or the
    file field next to that button. Then press then_ref (the send button), if given."""
    page = s.page
    files = []
    for f in body.files or []:
        try:
            data = base64.b64decode(f.get("b64", ""), validate=True)
        except ValueError:
            return "A file was not valid base64.", None
        if not data or len(data) > UPLOAD_MAX:
            return f"{f.get('name')}: empty or bigger than {UPLOAD_MAX // (1024 * 1024)} MB.", None
        name = re.sub(r"[\\/\x00-\x1f]", "_", str(f.get("name") or "file"))[:200]
        files.append(
            {"name": name, "mimeType": f.get("mime") or "application/octet-stream", "buffer": data}
        )
    if not files:
        return "Give the files to upload.", None
    ref = _target(body)
    loc = await _locate(page, ref) if ref else None
    if loc is None:
        return _gone(ref), None
    box = await loc.bounding_box()
    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2} if box else None
    if await loc.evaluate("(el) => el.tagName === 'INPUT' && el.type === 'file'"):
        await loc.set_input_files(files, timeout=15_000)
    else:
        try:
            async with page.expect_file_chooser(timeout=8000) as chooser:
                await loc.click(timeout=10_000)
            await (await chooser.value).set_files(files, timeout=15_000)
        except Exception as e:  # noqa: BLE001 - a styled button: the file field next to it
            if "Timeout" not in e.__class__.__name__:
                raise
            near = await loc.evaluate_handle(
                "(el) => { for (let n = el, i = 0; n && i < 6; n = n.parentElement, i++) {"
                " const f = n.querySelector && n.querySelector('input[type=file]'); if (f) return f; }"
                " const all = document.querySelectorAll('input[type=file]');"
                " return all.length === 1 ? all[0] : null; }"
            )
            field = near.as_element()
            if field is None:
                return (
                    "No file field there: give the ref of the file field or of its choose-file button.",
                    point,
                )
            await field.set_input_files(files, timeout=15_000)
    try:
        await page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:  # noqa: BLE001
        pass
    if body.then_ref:
        then = await _locate(page, parse_ref(body.then_ref) or "")
        if then is None:
            return "The files are chosen, but the send button " + _gone(body.then_ref), point
        await _press(page, then)
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
    return None, point


@app.post("/sessions/{sid}/hold")
async def hold(
    sid: str, body: HoldIn, x_browser_token: str | None = Header(default=None)
) -> dict[str, Any]:
    """Keep the session while a person decides (0 releases it): at most HOLD_MAX seconds."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    s.hold_until = time.time() + min(body.seconds, HOLD_MAX) if body.seconds else 0.0
    s.last = time.time()
    return {"ok": True, "until": s.hold_until}


@app.get("/sessions/{sid}/downloads/{did}")
async def take_download(
    sid: str, did: str, x_browser_token: str | None = Header(default=None)
) -> Response:
    """Hand a kept download to the worker, once (it is dropped from the session)."""
    _auth(x_browser_token)
    s = state["sessions"].get(sid)
    if s is None:
        raise HTTPException(404, "no such session")
    d = s.downloads.pop(did, None)
    if d is None:
        raise HTTPException(404, "no such download")
    return Response(
        d["data"],
        media_type="application/octet-stream",
        headers={
            "x-file-name": base64.b64encode(d["name"].encode()).decode(),
            "x-file-url": d["url"][:500].encode("ascii", "ignore").decode(),
        },
    )


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
