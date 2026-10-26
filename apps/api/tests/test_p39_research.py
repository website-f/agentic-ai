"""P39: research that works: the agent's own browser reads what a plain fetch cannot and
searches when every search API fails, PDFs are read as text, links from the task's own
results open without waiting on a person, and findings become a shared wiki page."""

import io
import json
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browse_reader, runtime, websearch
from agentic.brain import learn
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import AgentMessage, Approval, BrainPage, Task

from .test_agents import ScriptedLLM, new_agent, new_task, office, temporal  # noqa: F401

JS_SHELL = "<html><head><title>App</title></head><body><div id='root'></div></body></html>"
ARTICLE = (
    "Crude palm oil closed at RM 4,120 a tonne on 22 October 2026, up 1.2 % on the week, "
    "as Malaysian export demand from India rose. Analysts expect prices to hold until year end. "
) * 3


def _pdf(text: str) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=11)
    pdf.multi_cell(0, 6, text)
    return bytes(pdf.output())


class Web:
    """The fake internet (pages on good.fake, the AI provider) and a fake browser service."""

    def __init__(self, llm: ScriptedLLM) -> None:
        self.llm = llm
        self.browser_calls: list[dict] = []

    def internet(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "good.fake" and path.endswith("/chat/completions"):
            return self.llm.handler(request)
        if request.url.host == "good.fake" and path == "/js-app":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=JS_SHELL)
        if request.url.host == "good.fake" and path == "/blocked":
            return httpx.Response(403, text="Forbidden")
        if request.url.host == "good.fake" and path == "/report.pdf":
            return httpx.Response(
                200, headers={"content-type": "application/pdf"}, content=_pdf(ARTICLE)
            )
        if request.url.host == "good.fake" and path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(404)

    def browser(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        self.browser_calls.append({"path": request.url.path, **body})
        if request.url.path == "/sessions":
            return httpx.Response(200, json={"id": "bs_research"})
        action = body.get("action")
        if action == "goto":
            self.url = body["url"]
            return httpx.Response(200, json={"url": body["url"], "title": "Loaded"})
        if action == "read":
            return httpx.Response(
                200, json={"url": self.url, "title": "Palm oil prices", "text": ARTICLE}
            )
        if action == "links":
            return httpx.Response(
                200,
                json={
                    "links": [
                        {"text": "DuckDuckGo", "href": "https://duckduckgo.com/about"},
                        {
                            "text": "MPOB daily palm oil prices for Malaysia",
                            "href": "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fmpob.example%2Fprices",
                            "near": "MPOB daily palm oil prices for Malaysia Latest CPO price",
                        },
                    ]
                },
            )
        return httpx.Response(400)


@pytest.fixture
def web(monkeypatch):
    s = ScriptedLLM()
    w = Web(s)
    engine_client.use_transport(httpx.MockTransport(w.internet))
    browse_reader.use_transport(httpx.MockTransport(w.browser))
    monkeypatch.setattr(browse_reader.settings, "browser_url", "http://browser:8600")
    yield w
    engine_client.use_transport(None)
    browse_reader.use_transport(None)


async def _ctx(client, web):
    o = await office(client)
    agent = await new_agent(client, o, "Rina", "Research")
    task = await new_task(client, agent, "Palm oil price", "What is the CPO price this week?")
    return agent, task


async def test_a_page_built_by_javascript_or_refusing_scripts_is_read_in_the_browser(
    client, web, temporal
):
    agent, task = await _ctx(client, web)
    web.llm.call("web_fetch", url="https://good.fake/js-app").call(
        "web_fetch", url="https://good.fake/blocked"
    ).say("CPO is RM 4,120 a tonne.")
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        t.status = "running"
        await db.commit()
    # The agent may open pages without asking (a person set web_fetch to allow).
    async with SessionLocal() as db:
        from agentic.models import Agent

        a = await db.get(Agent, agent["id"])
        a.tools = {**(a.tools or {}), "web_fetch": "allow"}
        await db.commit()
    step = await runtime.run_task_step(task["id"])
    assert step.state == "done", step
    async with SessionLocal() as db:
        results = [
            m.content
            for m in (
                await db.scalars(
                    select(AgentMessage).where(
                        AgentMessage.task_id == task["id"], AgentMessage.role == "tool"
                    )
                )
            ).all()
        ]
    assert all("RM 4,120" in (c or "") for c in results), results
    assert any(
        c["path"] == "/sessions" and c["task_id"].startswith("rs:") for c in web.browser_calls
    )


async def test_a_pdf_is_read_as_text():
    from agentic.agents.tools import pdf_text

    text = pdf_text(_pdf(ARTICLE))
    assert text.startswith("[page 1]") and "RM 4,120" in text
    assert "could not be opened" in pdf_text(b"not a pdf")


async def test_when_every_search_api_fails_the_agents_browser_searches(web, monkeypatch):
    async def down(query, count):
        raise websearch.SearchUnavailable("captcha")

    monkeypatch.setattr(websearch, "_backends", lambda: [("DuckDuckGo", down)])
    backend, results = await websearch.search("palm oil price", 5, agent_id="ag_1", task_id="tk_1")
    assert backend == "your browser (DuckDuckGo)"
    assert [r.url for r in results] == ["https://mpob.example/prices"]
    with pytest.raises(websearch.SearchUnavailable):
        await websearch.search("palm oil price", 5)  # no agent: no browser to fall back on


async def test_links_from_the_tasks_own_results_open_without_waiting(client, web, temporal):
    agent, task = await _ctx(client, web)
    async with SessionLocal() as db:
        db.add(
            AgentMessage(
                workspace_id=(await db.get(Task, task["id"])).workspace_id,
                agent_id=agent["id"],
                task_id=task["id"],
                role="tool",
                name="web_search",
                tool_call_id="c0",
                created_at=datetime.now(UTC),
                content="1. Report\n   https://good.fake/report.pdf",
            )
        )
        await db.commit()
    web.llm.call("web_fetch", url="https://good.fake/report.pdf").call(
        "web_fetch", url="https://good.fake/made-up?leak=1"
    ).say("done")
    step = await runtime.run_task_step(task["id"])
    # The known link ran at once (and its PDF was read); the invented one waits for a person.
    assert step.state == "needs_approval"
    async with SessionLocal() as db:
        a = await db.get(Approval, step.approval_id)
        assert a.tool_name == "web_fetch" and "made-up" in a.args["url"]
        pdf = await db.scalar(
            select(AgentMessage.content).where(
                AgentMessage.task_id == task["id"], AgentMessage.tool_call_id == "call_1"
            )
        )
    assert pdf and "RM 4,120" in pdf


async def test_findings_become_a_shared_research_page(client, web, temporal):
    agent, task = await _ctx(client, web)
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        t.status, t.result = "done", "CPO closed at RM 4,120 a tonne this week. " * 8
        db.add(
            AgentMessage(
                workspace_id=t.workspace_id,
                agent_id=agent["id"],
                task_id=t.id,
                role="tool",
                name="research_gather",
                tool_call_id="c1",
                created_at=datetime.now(UTC),
                content="Sources:\n[1] MPOB - https://mpob.example/prices\n[2] B - https://b.example/x.",
            )
        )
        await db.commit()
    async with SessionLocal() as db:
        await learn.learn_from_task(db, task["id"])
        pages = (
            await db.scalars(select(BrainPage).where(BrainPage.path.like("wiki/research/%")))
        ).all()
    assert len(pages) == 1
    body = pages[0].body
    assert "## Findings" in body and "RM 4,120" in body
    assert "- https://mpob.example/prices" in body and "- https://b.example/x" in body


def test_search_result_links_are_unwrapped():
    assert (
        browse_reader._unwrap("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fp&rut=x")
        == "https://a.example/p"
    )
    raw = "aHR0cHM6Ly9iLmV4YW1wbGUvcQ"  # https://b.example/q
    assert browse_reader._unwrap(f"https://www.bing.com/ck/a?u=a1{raw}") == "https://b.example/q"
    assert io  # (kept for pdf bytes in other tests)
