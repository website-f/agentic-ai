"""A minimal MCP (Model Context Protocol) client over Streamable HTTP (P13, idea from Hermes
Agent's MCP support).

Connecting one MCP server gives agents many tools (Linear, Asana, a company's own server, …).
To keep the prompt small, their schemas are never sent to the model: agents find tools with
tool_search, read one with tool_describe, and run one with tool_call (which is approval-gated
like any outward action). Only HTTP servers are supported — the office never spawns local
processes from a model's request. Every request is SSRF-guarded and the auth header, if any,
is envelope-encrypted.
"""

import json
import logging
from typing import Any

import httpx

from ..core.ssrf import BlockedURL, pinned
from ..engine import client as engine_client

log = logging.getLogger("agentic.mcp")

PROTOCOL = "2025-06-18"
TIMEOUT = 30
# P21: results are no longer cut at 12,000 characters (an error at the end was lost). The full
# text is stored (up to this sanity limit, keeping head AND tail), and the model is sent a
# compressed version capped with a note that expand_result can page through (compress.py).
MAX_STORED = 200_000
STORED_TAIL = 50_000


class McpError(Exception):
    pass


def _auth(header: str) -> dict[str, str]:
    if header and ":" in header:
        name, _, value = header.partition(":")
        return {name.strip(): value.strip()}
    return {}


async def _rpc(url: str, header: str, method: str, params: dict[str, Any] | None = None) -> Any:
    """One JSON-RPC call. The server may answer with JSON or a one-event SSE stream."""
    try:
        target, pin, ext = await pinned(url)
    except BlockedURL as e:
        raise McpError(f"that address is not allowed ({e})") from e
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "agentic-ai/0.1",
        **_auth(header),
        **pin,
    }
    async with engine_client._client(timeout=TIMEOUT) as http:  # noqa: SLF001 - shared transport
        r = await http.post(target, json=body, headers=headers, extensions=ext)
    if r.status_code >= 400:
        raise McpError(f"server answered {r.status_code}: {r.text[:200]}")
    data = _parse(r)
    if "error" in data:
        raise McpError(str(data["error"].get("message") or data["error"])[:300])
    return data.get("result", {})


def _parse(r: httpx.Response) -> dict[str, Any]:
    ctype = r.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        for line in r.text.splitlines():
            if line.startswith("data:"):
                try:
                    return json.loads(line[5:].strip())
                except ValueError:
                    continue
        raise McpError("no data in the server's event stream")
    try:
        return r.json()
    except ValueError as e:
        raise McpError("server did not return JSON") from e


async def list_tools(url: str, header: str = "") -> list[dict[str, Any]]:
    """Discover a server's tools: [{name, description, schema}]. Used on connect/refresh."""
    await _rpc(
        url,
        header,
        "initialize",
        {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "agentic-ai", "version": "0.1"},
        },
    )
    result = await _rpc(url, header, "tools/list")
    out = []
    for t in (result.get("tools") or [])[:200]:
        if t.get("name"):
            out.append(
                {
                    "name": str(t["name"])[:80],
                    "description": str(t.get("description") or "")[:400],
                    "schema": t.get("inputSchema") or {"type": "object", "properties": {}},
                }
            )
    return out


async def call_tool(url: str, header: str, tool: str, arguments: dict[str, Any]) -> str:
    """Run one tool. Returns its text content (MCP returns a list of content blocks)."""
    result = await _rpc(url, header, "tools/call", {"name": tool, "arguments": arguments})
    parts: list[str] = []
    for block in result.get("content") or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            elif block.get("type") == "resource":
                res = block.get("resource") or {}
                parts.append(str(res.get("text") or res.get("uri") or ""))
            else:
                parts.append(json.dumps(block)[:1000])
    text = "\n".join(p for p in parts if p).strip() or json.dumps(result)[:2000]
    if result.get("isError"):
        return f"The tool reported an error: {_bounded(text)}"
    return _bounded(text)


def _bounded(text: str) -> str:
    """Huge answers keep their beginning and their end (where errors usually are)."""
    if len(text) <= MAX_STORED:
        return text
    head = MAX_STORED - STORED_TAIL
    cut = len(text) - MAX_STORED
    return f"{text[:head]}\n[… {cut:,} characters cut by the office …]\n{text[-STORED_TAIL:]}"
