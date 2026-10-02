"""The browser service: a real Camoufox (Firefox) that agents drive, one context per task.

Only the worker can reach it (its own Docker network, token checked). Every request the
page makes passes a guard that refuses non-public addresses, so a hostile page cannot use
the browser to reach anything internal. Pages are reduced to numbered elements
(set-of-marks) so the model can act on "element 7" instead of guessing selectors, and
every action returns a JPEG frame for the live monitor.

Form submits are refused unless the call says allow_submit (the agent's browser_submit
tool, which always needs a person's approval).

Saved logins (P9) arrive as `secret` typing: the service types them only when the page is
on one of the login's hosts, marks the field, and never returns a secret or password
field's value, so neither the model nor the monitor ever sees it.
"""

import asyncio
import base64
import ipaddress
import logging
import os
import secrets
import socket
import time
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

log = logging.getLogger("browser")
TOKEN = os.environ.get("BROWSER_TOKEN", "dev-browser-token")
MAX_SESSIONS = int(os.environ.get("BROWSER_MAX_SESSIONS", "6"))
# Firefox stalls (clicks and page loads never finish) once 3 or more pages in one browser
# process work at the same time (measured: 2 per process always fine, 3+ not), so agents
# get their own processes, at most this many sessions each.
PER_PROCESS = max(1, int(os.environ.get("BROWSER_PER_PROCESS", "2")))
IDLE_SECONDS = int(os.environ.get("BROWSER_IDLE_SECONDS", "600"))
VIEWPORT = {"width": 1280, "height": 800}
MAX_ELEMENTS = 60
TEXT_CHARS = 2500
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

MARK_JS = """(max) => {
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], ' +
    '[role=link], [role=checkbox], [role=tab], [contenteditable=true], summary';
  document.querySelectorAll('[data-agentic-n]').forEach(e => e.removeAttribute('data-agentic-n'));
  const out = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.bottom < -50 || r.top > innerHeight * 2.5) continue;
    n++; el.setAttribute('data-agentic-n', String(n));
    const tag = el.tagName.toLowerCase(); const type = (el.getAttribute('type') || '').toLowerCase();
    let label = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText)
      || el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText || el.value
      || el.getAttribute('title') || el.getAttribute('href') || '';
    label = String(label).replace(/\\s+/g, ' ').trim().slice(0, 80);
    const submit = (tag === 'button' && (type === '' || type === 'submit') && !!el.form)
      || (tag === 'input' && (type === 'submit' || type === 'image'));
    const item = {n, tag, type, label, submit};
    if (tag === 'input' || tag === 'textarea') {
      const hide = type === 'password' || el.hasAttribute('data-agentic-secret');
      item.value = hide ? (el.value ? '(filled, hidden)' : '') : String(el.value || '').slice(0, 60);
    }
    if (type === 'checkbox' || type === 'radio') item.checked = !!el.checked;
    if (tag === 'select') {
      item.options = Array.from(el.options).slice(0, 20).map(o => o.text.trim());
      const chosen = el.options[el.selectedIndex];
      item.value = chosen && chosen.value !== '' ? chosen.text.trim().slice(0, 60) : '';
    }
    out.push(item);
    if (n >= max) break;
  }
  return out;
}"""


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
        ok = False
    _dns[host] = (time.time() + 60, ok)
    return ok


async def _route(route: Any) -> None:
    u = urlparse(route.request.url)
    if u.scheme in ("data", "blob", "about"):
        await route.continue_()
    elif u.scheme in ("http", "https") and await host_ok(u.hostname):
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

                self.manager = AsyncCamoufox(
                    headless=True, humanize=HUMANIZE, block_webrtc=True, i_know_what_im_doing=True
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
    def __init__(self, sid: str, context: Any, page: Any, owner: dict[str, str], slot: Slot) -> None:
        self.id, self.context, self.page, self.owner, self.slot = sid, context, page, owner, slot
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


class Act(BaseModel):
    action: str  # goto | click | type | select | check | press | scroll | back | read | look
    url: str | None = None
    element: int | None = None
    text: str | None = Field(default=None, max_length=5000)
    key: str | None = None
    dy: int = 600
    allow_submit: bool = False
    secret: bool = False  # a saved login: typed only on `hosts`, never echoed back
    secret_kind: str = ""  # username | password (a password goes only into a password field)
    hosts: list[str] = Field(default_factory=list, max_length=20)


def host_matches(url: str, hosts: list[str]) -> bool:
    h = (urlparse(url).hostname or "").lower()
    return any(h == x.lower() or h.endswith("." + x.lower()) for x in hosts if x)


async def _shot(page: Any) -> bytes:
    return await page.screenshot(type="jpeg", quality=55, timeout=10_000, scale="css")


async def _frame(page: Any) -> str:
    return base64.b64encode(await _shot(page)).decode()


async def _press(page: Any, loc: Any) -> None:
    """Click (Playwright waits for a page the click starts), then for that page to load."""
    await loc.click(timeout=10_000)
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:  # noqa: BLE001 - not every click opens a page
        pass


async def _marked(page: Any, element: int) -> Any | None:
    """Resolve a numbered element without letting a damaged DOM strand the task.

    The page is re-rendered by some portal applications between observation and action.
    That can briefly leave more than one node carrying the same marker.  Playwright's
    normal locator is strict and raises in that case; the agent then burns model steps
    retrying the same impossible click.  Prefer a visible match and, if a portal still
    exposes duplicates, use the first current match and let the next observation refresh
    the numbered view.
    """
    loc = page.locator(f'[data-agentic-n="{element}"]:visible')
    count = await loc.count()
    if count == 0:
        return None
    if count > 1:
        log.warning("element marker %s matched %d visible nodes; using the first", element, count)
    return loc.first


async def _observe(s: Session, point: dict[str, float] | None = None, read: bool = False) -> dict[str, Any]:
    page = s.page
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=8000)
    except Exception:  # noqa: BLE001 - observe whatever is there
        pass
    elements = await page.evaluate(MARK_JS, MAX_ELEMENTS)
    text = await page.evaluate("() => (document.body ? document.body.innerText : '')")
    text = " ".join(str(text).split())
    # Table rows in bold usually mean unread or new; the plain text loses that.
    bold = await page.evaluate(BOLD_ROWS_JS)
    return {
        "url": page.url,
        "title": await page.title(),
        "elements": elements,
        "text": text[: (12_000 if read else TEXT_CHARS)],
        "text_chars": len(text),
        "bold_rows": bold,
        "point": point,
        "frame": await _frame(page),
    }


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "sessions": len(state["sessions"]),
        "processes": sum(1 for x in state["slots"] if x.browser is not None),
        "restarts": state["restarts"],
        "humanize": HUMANIZE,
    }


@app.post("/sessions")
async def open_session(body: Open, x_browser_token: str | None = Header(default=None)) -> dict[str, str]:
    _auth(x_browser_token)
    for sess in state["sessions"].values():
        if sess.owner["task_id"] == body.task_id:
            sess.last = time.time()
            return {"id": sess.id}
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
    try:
        browser = await slot.get()
        context = await browser.new_context(viewport=VIEWPORT, accept_downloads=False)
        await context.route("**/*", _route)
        page = await context.new_page()
    except Exception:
        slot.sessions.discard(sid)
        raise
    state["sessions"][sid] = Session(sid, context, page, body.model_dump(), slot)
    return {"id": sid}


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
        try:
            if body.action == "goto":
                u = urlparse(body.url or "")
                if u.scheme not in ("http", "https") or not await host_ok(u.hostname):
                    return {"error": "That address is not allowed (only public http/https sites)."}
                await page.goto(body.url, wait_until="domcontentloaded", timeout=30_000)
            elif body.action == "login_submit":
                # The sign-in button of the form that holds the saved password: the only
                # submit that needs no person, because saving the login allowed it.
                if not body.hosts or not host_matches(page.url, body.hosts):
                    return {"error": "This saved login is not for this site."}
                loc = await _marked(page, int(body.element or 0))
                if loc is None:
                    return {"error": f"There is no element {body.element} now. Look at the page again."}
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
                loc = await _marked(page, int(body.element or 0))
                if loc is None:
                    return {"error": f"There is no element {body.element} now. Look at the page again."}
                info = await loc.evaluate(
                    "(el) => ({submit: (el.tagName === 'BUTTON' && (!el.type || el.type === 'submit') && !!el.form)"
                    " || (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'image'))})"
                )
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
            elif body.action not in ("read", "look"):
                return {"error": f"unknown action {body.action}"}
        except Exception as e:  # noqa: BLE001 - tell the agent what went wrong, keep the session
            err = f"{e.__class__.__name__}: {str(e).splitlines()[0][:300]}"
            if "Timeout" in e.__class__.__name__:
                await _note_timeout(s)
                if sid not in state["sessions"]:  # the browser was just restarted
                    return {"error": f"{err}. The browser was stuck and has been restarted: open the page again."}
            try:
                obs = await asyncio.wait_for(_observe(s), 15)
            except Exception:  # noqa: BLE001 - the page itself is unusable
                return {"error": err}
            obs["error"] = err
            return obs
        return await _observe(s, point, read=body.action == "read")


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
