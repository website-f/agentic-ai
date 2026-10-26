"""Web search for agents (P13, idea from Hermes Agent's multi-backend web_search).

Backends are tried in order and the first that answers wins: a self-hosted SearXNG (private,
keyless), Brave or Tavily (API key), then a keyless DuckDuckGo fallback so search works with no
setup at all. Every request goes through the same SSRF guard and shared HTTP client as
web_fetch, and only public hosts are reachable. Results are titles + urls + snippets; the agent
then opens the ones it wants with web_fetch.
"""

import html
import logging
import re
from dataclasses import dataclass

import httpx

from ..core.config import settings
from ..core.ssrf import BlockedURL, pinned
from ..engine import client as engine_client

log = logging.getLogger("agentic.websearch")

MAX_RESULTS = 10
UA = "agentic-ai/0.1 (+research assistant)"


@dataclass
class Result:
    title: str
    url: str
    snippet: str


class SearchUnavailable(Exception):
    pass


async def _get(
    url: str, *, params: dict | None = None, headers: dict | None = None
) -> httpx.Response:
    target, pin, ext = await pinned(url)
    async with engine_client._client(timeout=15) as http:  # noqa: SLF001 - shared transport
        return await http.get(
            target,
            params=params,
            headers={"User-Agent": UA, **(headers or {}), **pin},
            extensions=ext,
        )


async def _searxng(query: str, count: int) -> list[Result]:
    # P39: our own private service on an internal network, set by the operator: called
    # directly (the SSRF guard is for addresses that come from pages and models).
    base = settings.searxng_url.rstrip("/")
    async with engine_client._client(timeout=20) as http:  # noqa: SLF001 - shared transport
        r = await http.get(
            f"{base}/search",
            params={"q": query, "format": "json", "safesearch": "1"},
            headers={"User-Agent": UA, "X-Real-IP": "127.0.0.1"},
        )
    if r.status_code >= 400:
        raise SearchUnavailable(f"SearXNG answered {r.status_code}")
    out = []
    for item in (r.json().get("results") or [])[:count]:
        if item.get("url") and item.get("title"):
            out.append(Result(item["title"][:200], item["url"], (item.get("content") or "")[:400]))
    return out


async def _brave(query: str, count: int) -> list[Result]:
    r = await _get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": count},
        headers={"X-Subscription-Token": settings.brave_search_key, "Accept": "application/json"},
    )
    if r.status_code >= 400:
        raise SearchUnavailable(f"Brave answered {r.status_code}")
    out = []
    for item in ((r.json().get("web") or {}).get("results") or [])[:count]:
        out.append(
            Result(
                item.get("title", "")[:200],
                item.get("url", ""),
                (item.get("description") or "")[:400],
            )
        )
    return [x for x in out if x.url]


async def _tavily(query: str, count: int) -> list[Result]:
    target, pin, ext = await pinned("https://api.tavily.com/search")
    async with engine_client._client(timeout=20) as http:  # noqa: SLF001
        r = await http.post(
            target,
            json={"api_key": settings.tavily_key, "query": query, "max_results": count},
            headers={"User-Agent": UA, **pin},
            extensions=ext,
        )
    if r.status_code >= 400:
        raise SearchUnavailable(f"Tavily answered {r.status_code}")
    out = []
    for item in (r.json().get("results") or [])[:count]:
        out.append(
            Result(
                item.get("title", "")[:200], item.get("url", ""), (item.get("content") or "")[:400]
            )
        )
    return [x for x in out if x.url]


_DDG_ROW = re.compile(
    r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
    r'(?:class="result__snippet"[^>]*>(.*?)</a>)?',
    re.S,
)
_TAG = re.compile(r"<[^>]+>")


def _text(raw: str) -> str:
    return html.unescape(_TAG.sub("", raw or "")).strip()


async def _duckduckgo(query: str, count: int) -> list[Result]:
    # The keyless HTML endpoint. Fragile by nature, so it is the last resort.
    r = await _get("https://html.duckduckgo.com/html/", params={"q": query})
    if r.status_code >= 400:
        raise SearchUnavailable(f"DuckDuckGo answered {r.status_code}")
    out = []
    for m in _DDG_ROW.finditer(r.text):
        url, title, snippet = m.group(1), _text(m.group(2)), _text(m.group(3) or "")
        if url.startswith("//duckduckgo.com/l/?uddg="):  # unwrap the redirect
            from urllib.parse import parse_qs, unquote, urlparse

            q = parse_qs(urlparse("https:" + url).query).get("uddg")
            url = unquote(q[0]) if q else url
        if url.startswith("http") and title:
            out.append(Result(title[:200], url, snippet[:400]))
        if len(out) >= count:
            break
    return out


def _backends() -> list[tuple[str, object]]:
    chain: list[tuple[str, object]] = []
    if settings.searxng_url:
        chain.append(("SearXNG", _searxng))
    if settings.brave_search_key:
        chain.append(("Brave", _brave))
    if settings.tavily_key:
        chain.append(("Tavily", _tavily))
    chain.append(("DuckDuckGo", _duckduckgo))
    return chain


async def search(
    query: str, count: int = 6, *, agent_id: str | None = None, task_id: str | None = None
) -> tuple[str, list[Result]]:
    """(backend name, results). Raises SearchUnavailable only if every backend fails.
    P39: with an agent and a task, the last resort is a search page in the agent's own
    browser (a real browser passes bot checks a script does not)."""
    count = max(1, min(MAX_RESULTS, count))
    errors = []
    for name, fn in _backends():
        try:
            results = await fn(query, count)  # type: ignore[operator]
            if results:
                return name, results
            errors.append(f"{name}: no results")
        except (SearchUnavailable, BlockedURL) as e:
            errors.append(f"{name}: {e}")
        except Exception as e:  # noqa: BLE001 - try the next backend, never crash the tool
            log.warning("search backend %s failed: %s", name, e)
            errors.append(f"{name}: {e.__class__.__name__}")
    if agent_id and task_id:
        from . import browse_reader

        if browse_reader.available():
            try:
                engine, found = await browse_reader.search(agent_id, task_id, query, count)
            except Exception as e:  # noqa: BLE001 - the browser is a last resort
                log.warning("browser search failed: %s", e)
                engine, found = "", []
            if found:
                return f"your browser ({engine})", [
                    Result(r["title"], r["url"], r["snippet"]) for r in found
                ]
            errors.append("your browser: no results")
    raise SearchUnavailable("; ".join(errors) or "no search backend available")
