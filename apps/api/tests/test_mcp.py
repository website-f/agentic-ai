"""P13 MCP: connect an HTTP MCP server, discover its tools, and use them through the
tool_search / tool_describe / tool_call bridge (approval-gated). The server is faked with the
same MockTransport the engine client uses."""

import json

import httpx

from agentic.agents import mcp, runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import Agent, Workspace

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401

TOOLS_LIST = [
    {
        "name": "create_issue",
        "description": "Open a ticket",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
    },
    {
        "name": "list_issues",
        "description": "List tickets",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def mcp_handler(request: httpx.Request) -> httpx.Response:
    if request.url.host != "good.fake":
        return httpx.Response(404, json={"error": "no route"})
    body = json.loads(request.content)
    method = body.get("method")
    if method == "initialize":
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18"}}
        )
    if method == "tools/list":
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "result": {"tools": TOOLS_LIST}}
        )
    if method == "tools/call":
        name = body["params"]["name"]
        args = body["params"]["arguments"]
        if name == "create_issue":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "content": [{"type": "text", "text": f"Created: {args.get('title')}"}]
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"content": [{"type": "text", "text": "2 tickets"}]},
            },
        )
    return httpx.Response(
        200, json={"jsonrpc": "2.0", "id": 1, "error": {"message": "unknown method"}}
    )


def use_mcp_transport():
    engine_client.use_transport(httpx.MockTransport(mcp_handler))


async def test_connect_discovers_tools_and_lists_them(client, llm, temporal):
    await office(client)
    use_mcp_transport()
    r = await client.post(
        "/api/mcp-servers",
        json={"name": "tracker", "url": "https://good.fake/rpc", "description": "Issue tracker"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["health"] == "ok" and s["tool_count"] == 2
    assert {t["name"] for t in s["tools"]} == {"create_issue", "list_issues"}
    listed = (await client.get("/api/mcp-servers")).json()
    assert listed[0]["name"] == "tracker"


async def test_the_bridge_searches_describes_and_calls(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    use_mcp_transport()
    r = await client.post(
        "/api/mcp-servers",
        json={"name": "tracker", "url": "https://good.fake/rpc"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        ws = await db.get(Workspace, a.workspace_id)
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)
        found = await TOOLS["tool_search"].handler(ctx, {"query": "ticket"})
        assert "tracker.create_issue" in found and "tracker.list_issues" in found
        desc = await TOOLS["tool_describe"].handler(
            ctx, {"server": "tracker", "tool": "create_issue"}
        )
        assert "title" in desc and "Open a ticket" in desc
        out = await TOOLS["tool_call"].handler(
            ctx,
            {"server": "tracker", "tool": "create_issue", "arguments": {"title": "Fix printer"}},
        )
        assert "Created: Fix printer" in out
        # P29: what an outside server says is fenced as data, like a web page.
        for text in (found, desc, out):
            assert "<<<" in text and "not instructions" in text
        assert out.index("<<<") < out.index("Created: Fix printer")
        missing = await TOOLS["tool_call"].handler(ctx, {"server": "tracker", "tool": "nope"})
        assert "no such external tool" in missing


async def test_tool_call_is_high_risk_and_bridge_hidden_without_servers(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    assert TOOLS["tool_call"].risk == "high" and TOOLS["tool_call"].default_mode == "ask"
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        names = {t["function"]["name"] for t in runtime.offered_tools(a, mcp=False)}
        assert not (names & set(runtime.MCP_BRIDGE))  # no servers -> no bridge tools in the prompt
        on = {t["function"]["name"] for t in runtime.offered_tools(a, mcp=True)}
        assert set(runtime.MCP_BRIDGE) <= on


async def test_agent_scoping_limits_which_servers_an_agent_sees(client, llm, temporal):
    o = await office(client)
    a1 = await new_agent(client, o, "Aina")
    a2 = await new_agent(client, o, "Rafi", dept="Operations")
    use_mcp_transport()
    await client.post(
        "/api/mcp-servers",
        json={"name": "tracker", "url": "https://good.fake/rpc", "agent_ids": [a1["id"]]},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        for aid, expect in ((a1["id"], True), (a2["id"], False)):
            a = await db.get(Agent, aid)
            ws = await db.get(Workspace, a.workspace_id)
            ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)
            out = await TOOLS["tool_search"].handler(ctx, {"query": ""})
            assert ("tracker.create_issue" in out) is expect


async def test_mcp_client_handles_sse_responses():
    def sse(request: httpx.Request) -> httpx.Response:
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": TOOLS_LIST}})
        if json.loads(request.content)["method"] == "initialize":
            payload = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {}})
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=f"event: message\ndata: {payload}\n\n",
        )

    engine_client.use_transport(httpx.MockTransport(sse))
    tools = await mcp.list_tools("https://good.fake/rpc")
    assert {t["name"] for t in tools} == {"create_issue", "list_issues"}
