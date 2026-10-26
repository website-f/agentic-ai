"""P39: research on the agent's own browser machine (its "laptop": one persistent Camoufox
profile per agent, P32), for what a plain HTTP fetch cannot do:
- pages built by JavaScript (a plain fetch gets an empty shell);
- sites that refuse bots (403, a captcha for scripts but not for a real browser);
- searching when every search API is down or blocking us.

The research tab is separate from the task's own browser tab (a browse-for-me task is locked
to its site; research may read any public page). Every page still goes through the browser's
egress proxy, which only reaches public addresses. Best effort: None / [] when the browser is
busy, down or the page does not load, and the caller carries on without it.
"""

import base64
import logging
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx

from ..core.config import settings
from ..core.valkey import valkey

log = logging.getLogger("agentic.browse_reader")

READ_TIMEOUT = 60
TAB_TTL = 900  # the research tab is reused for this long, then the browser's reaper closes it
ENGINES = (
    ("DuckDuckGo", "https://html.duckduckgo.com/html/?q={q}"),
    ("Bing", "https://www.bing.com/search?q={q}"),
)
_transport: httpx.AsyncBaseTransport | None = None  # tests replace it


def use_transport(t: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = t


def available() -> bool:
    return bool(settings.browser_url)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.browser_url,
        headers={"x-browser-token": settings.browser_token},
        timeout=READ_TIMEOUT,
        transport=_transport,
    )


async def _tab(agent_id: str, task_id: str) -> str | None:
    key = f"browser:research:{task_id}"
    try:
        sid = await valkey().get(key)
    except Exception:  # noqa: BLE001
        sid = None
    if sid:
        return sid.decode() if isinstance(sid, bytes) else str(sid)
    try:
        async with _client() as c:
            r = await c.post(
                "/sessions",
                json={"task_id": f"rs:{task_id}"[:60], "agent_id": agent_id, "allowed_hosts": None},
            )
    except httpx.HTTPError as e:
        log.info("research browser not reachable: %s", e)
        return None
    if r.status_code != 200:  # 503: every browser busy
        return None
    sid = str(r.json().get("id") or "")
    if sid:
        try:
            await valkey().set(key, sid, ex=TAB_TTL)
        except Exception:  # noqa: BLE001 - not remembered: the next call opens a new tab
            log.debug("research tab not remembered for %s", task_id)
    return sid or None


async def _act(agent_id: str, task_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    sid = await _tab(agent_id, task_id)
    if not sid:
        return None
    try:
        async with _client() as c:
            r = await c.post(f"/sessions/{sid}/act", json=payload)
            if r.status_code == 404:  # closed after being idle: a fresh tab, once
                await valkey().delete(f"browser:research:{task_id}")
                sid = await _tab(agent_id, task_id)
                if not sid:
                    return None
                r = await c.post(f"/sessions/{sid}/act", json=payload)
    except httpx.HTTPError as e:
        log.info("research browser action failed: %s", e)
        return None
    if r.status_code != 200:
        return None
    return r.json()


async def read(agent_id: str, task_id: str, url: str) -> tuple[str, str] | None:
    """(title, text) of a page as the agent's browser shows it, or None."""
    opened = await _act(agent_id, task_id, {"action": "goto", "url": url})
    if opened is None or (opened.get("error") and not opened.get("text")):
        return None
    got = await _act(agent_id, task_id, {"action": "read"})
    if got is None:
        return None
    text = str(got.get("text") or "").strip()
    return (str(got.get("title") or url), text) if text else None


def _unwrap(href: str) -> str:
    """A search engine's redirect link -> the page it points to."""
    u = urlparse(href)
    q = parse_qs(u.query)
    if "duckduckgo.com" in u.netloc and q.get("uddg"):
        return unquote(q["uddg"][0])
    if "bing.com" in u.netloc and u.path.startswith("/ck/") and q.get("u"):
        raw = q["u"][0]
        if raw.startswith("a1"):
            try:
                pad = "=" * (-len(raw[2:]) % 4)
                return base64.urlsafe_b64decode(raw[2:] + pad).decode("utf-8", "replace")
            except ValueError:
                return ""
    return href


def results_from(links: list[dict[str, Any]], engine_host: str, count: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for link in links:
        url = _unwrap(str(link.get("href") or ""))
        host = urlparse(url).netloc.lower()
        text = str(link.get("text") or "").strip()
        if (
            not url.startswith("http")
            or not host
            or engine_host in host
            or host.endswith(("microsoft.com", "duckduckgo.com", "bing.com", "msn.com"))
            or len(text) < 12
            or url in seen
        ):
            continue
        seen.add(url)
        near = str(link.get("near") or "")
        snippet = near.replace(text, "", 1).strip()[:400]
        out.append({"title": text[:200], "url": url, "snippet": snippet})
        if len(out) >= count:
            break
    return out


async def search(agent_id: str, task_id: str, query: str, count: int) -> tuple[str, list]:
    """(engine, [{title, url, snippet}]) from a search page in the agent's browser."""
    for name, pattern in ENGINES:
        url = pattern.format(q=quote_plus(query))
        opened = await _act(agent_id, task_id, {"action": "goto", "url": url})
        if opened is None:
            return "", []  # no browser now: no point trying the next engine
        got = await _act(agent_id, task_id, {"action": "links"})
        if not got:
            continue
        found = results_from(got.get("links") or [], urlparse(url).netloc, count)
        if found:
            return name, found
    return "", []
