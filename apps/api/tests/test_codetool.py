"""P13 code sandbox: the run_python tool sends code to the sandbox, saves produced files, and
is only offered when a sandbox is configured. (The sandbox's own isolation is verified against
the running container, not here.)"""

import base64

import httpx

from agentic.agents import codetool, runtime
from agentic.agents.tools import TOOLS, ToolContext  # noqa: I001 - load tools before doc_tools
from agentic.core.db import SessionLocal
from agentic.documents import service
from agentic.models import Agent, DocFile, Workspace

from .test_agents import llm, new_agent, office, temporal  # noqa: F401


class FakeSandbox:
    def __init__(self, response):
        self.response = response
        self.seen = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        import json

        self.seen = json.loads(request.content)
        return httpx.Response(200, json=self.response)


async def _ctx(db, agent_id):
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, task=None), a


async def test_run_python_returns_output_and_saves_files(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(codetool.settings, "sandbox_url", "http://sandbox.test")
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n fake").decode()
    fake = FakeSandbox(
        {
            "stdout": "total = 42",
            "stderr": "",
            "exit_code": 0,
            "timed_out": False,
            "files": [{"name": "chart.png", "b64": png}],
        }
    )
    monkeypatch.setattr(httpx, "AsyncClient", _mock_client(fake))
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        out = await codetool.run_python(ctx, {"code": "print('total =', 6*7)"})
        assert "total = 42" in out and "chart.png" in out
        saved = (await db.scalars(select_files(a.workspace_id))).all()
        assert any(f.name == "chart.png" and f.source == "generated" for f in saved)
    assert fake.seen["code"].startswith("print(")


async def test_run_python_passes_input_files(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(codetool.settings, "sandbox_url", "http://sandbox.test")
    fake = FakeSandbox(
        {"stdout": "rows 2", "stderr": "", "exit_code": 0, "timed_out": False, "files": []}
    )
    monkeypatch.setattr(httpx, "AsyncClient", _mock_client(fake))
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        f = await service.create_file(
            db,
            workspace_id=a.workspace_id,
            name="data.csv",
            data=b"a,b\n1,2\n",
            created_by="user:x",
            branch_id=a.branch_id,
            status="ready",
        )
        await db.commit()
        out = await codetool.run_python(ctx, {"code": "x", "file_ids": [f.id]})
    assert "rows 2" in out
    assert fake.seen["files"][0]["name"] == "data.csv"
    assert base64.b64decode(fake.seen["files"][0]["b64"]) == b"a,b\n1,2\n"


async def test_run_python_reports_a_stopped_process(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(codetool.settings, "sandbox_url", "http://sandbox.test")
    fake = FakeSandbox(
        {"stdout": "", "stderr": "", "exit_code": -9, "timed_out": False, "files": []}
    )
    monkeypatch.setattr(httpx, "AsyncClient", _mock_client(fake))
    async with SessionLocal() as db:
        ctx, _ = await _ctx(db, agent["id"])
        out = await codetool.run_python(ctx, {"code": "while True: pass"})
    assert "too much CPU or memory" in out


async def test_run_python_reports_a_busy_sandbox(client, llm, temporal, monkeypatch):
    # The sandbox runs one job at a time and answers 503 when the queue wait runs out.
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(codetool.settings, "sandbox_url", "http://sandbox.test")

    def busy(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "sandbox busy, try again shortly"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client(busy))
    async with SessionLocal() as db:
        ctx, _ = await _ctx(db, agent["id"])
        out = await codetool.run_python(ctx, {"code": "print(1)"})
    assert out.startswith("Error:") and "busy" in out


async def test_run_python_off_without_a_sandbox(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(codetool.settings, "sandbox_url", "")
    async with SessionLocal() as db:
        ctx, a = await _ctx(db, agent["id"])
        out = await codetool.run_python(ctx, {"code": "print(1)"})
        assert "not set up" in out
        names = {t["function"]["name"] for t in runtime.offered_tools(a)}
        assert "run_python" not in names  # hidden from the prompt when no sandbox
    monkeypatch.setattr(runtime.settings, "sandbox_url", "http://sandbox.test")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        on = {t["function"]["name"] for t in runtime.offered_tools(a)}
        assert "run_python" in on


def test_run_python_is_high_risk_and_asks():
    t = TOOLS["run_python"]
    assert t.risk == "high" and t.default_mode == "ask"


def _mock_client(handler):
    real = httpx.AsyncClient  # capture before monkeypatch replaces httpx.AsyncClient

    class _Client:
        def __init__(self, *a, **k):
            self._c = real(transport=httpx.MockTransport(handler))

        async def __aenter__(self):
            return self._c

        async def __aexit__(self, *a):
            await self._c.aclose()

    return _Client


def select_files(ws_id):
    from sqlalchemy import select

    return select(DocFile).where(DocFile.workspace_id == ws_id)
