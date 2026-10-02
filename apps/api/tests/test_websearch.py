"""P13 web search: backend order and fallback, DuckDuckGo HTML parsing, and the agent tool."""
# ruff: noqa: E501

import httpx

from agentic.agents import tools, websearch
from agentic.agents.tools import ToolContext

from .test_agents import llm, new_agent, office, temporal  # noqa: F401

DDG_HTML = """
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">First &amp; best</a>
  <a class="result__snippet">A snippet about <b>cleaning</b>.</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.org/b">Second result</a>
  <a class="result__snippet">Another snippet.</a>
</div>
"""


def _resp(status=200, text="", json_body=None):
    req = httpx.Request("GET", "https://x.test")
    if json_body is not None:
        return httpx.Response(status, json=json_body, request=req)
    return httpx.Response(status, text=text, request=req)


async def test_duckduckgo_parsing_unwraps_redirects(monkeypatch):
    async def fake_get(url, **kw):
        return _resp(text=DDG_HTML)

    monkeypatch.setattr(websearch, "_get", fake_get)
    monkeypatch.setattr(websearch.settings, "searxng_url", "")
    monkeypatch.setattr(websearch.settings, "brave_search_key", "")
    monkeypatch.setattr(websearch.settings, "tavily_key", "")
    backend, results = await websearch.search("office cleaning", 5)
    assert backend == "DuckDuckGo"
    assert results[0].url == "https://example.com/a" and "best" in results[0].title
    assert results[1].url == "https://example.org/b"


async def test_backends_are_tried_in_order_and_fall_through(monkeypatch):
    monkeypatch.setattr(websearch.settings, "searxng_url", "http://searxng.test")
    monkeypatch.setattr(websearch.settings, "brave_search_key", "")
    monkeypatch.setattr(websearch.settings, "tavily_key", "")
    calls = []

    async def fake_get(url, **kw):
        calls.append(url)
        if "searxng" in url:
            return _resp(status=502)  # SearXNG down -> fall through
        return _resp(text=DDG_HTML)

    monkeypatch.setattr(websearch, "_get", fake_get)
    backend, results = await websearch.search("x", 3)
    assert backend == "DuckDuckGo" and results
    assert any("searxng" in c for c in calls) and any("duckduckgo" in c for c in calls)


async def test_searxng_json_is_used_when_configured(monkeypatch):
    monkeypatch.setattr(websearch.settings, "searxng_url", "http://searxng.test")

    async def fake_get(url, **kw):
        assert "searxng" in url
        return _resp(
            json_body={"results": [{"title": "T", "url": "https://s.test/1", "content": "c"}]}
        )

    monkeypatch.setattr(websearch, "_get", fake_get)
    backend, results = await websearch.search("x", 3)
    assert backend == "SearXNG" and results[0].url == "https://s.test/1"


async def test_the_tool_formats_results(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    from agentic.core.db import SessionLocal
    from agentic.models import Agent, Workspace

    async def fake_search(query, count=6):
        return "DuckDuckGo", [websearch.Result("Guide", "https://e.test/g", "how to")]

    monkeypatch.setattr(websearch, "search", fake_search)
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        ws = await db.get(Workspace, a.workspace_id)
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)
        out = await tools.TOOLS["web_search"].handler(ctx, {"query": "cleaning sop"})
    assert "Guide" in out and "https://e.test/g" in out and "web_fetch" in out


def test_web_search_tool_is_registered_and_allowed():
    t = tools.TOOLS["web_search"]
    assert t.default_mode == "allow" and "query" in t.parameters["properties"]
