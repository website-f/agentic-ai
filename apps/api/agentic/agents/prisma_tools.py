"""P66: the AI works in Prima Secure (attendance, leave, claims, staff pay, tenders, assets,
cases...) for the person it acts for.

- prisma_find: which Prima action does a job (the catalog built from Prima's own API,
  agentic/prisma/routes.json), with what it takes;
- prisma_read: read from Prima (any GET), e.g. today's attendance or the leave waiting;
- prisma_record: record in Prima (any POST): apply for leave, file a claim, prepare a
  draft, decide a request... A person approves every one first (default mode "ask", high
  risk, so autonomy "auto" does not skip it).

Always as the person who asked: the one chatting, or who gave the task. Never as anyone else,
and never for the office's own work (a mail rule, an agent's own idea) where nobody asked.
The call is signed for that person (agentic/prisma/client.py) and Prima applies its own
roles, record rules and row-level security, so the AI can never do more in Prima than the
person themselves could. Prima's SOPs and workflows are in the Library (P65): read the
matching one before acting.
"""

import json
from typing import Any
from urllib.parse import urlencode

from ..prisma import client, routes
from ..prisma.client import PrimaError
from .tools import Tool, ToolContext, _threat_note

MAX_RESULT = 15_000


def _p(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


async def _person(ctx: ToolContext) -> str | None:
    if ctx.person:
        return ctx.person
    if ctx.task is not None:
        from ..teams import allowance  # late: teams reaches back into the agents package

        return await allowance.person_of_task(ctx.db, ctx.task)
    return None


def _path(raw: Any) -> str:
    p = str(raw or "").strip().lstrip("/")
    return p if p.startswith("api/") else f"api/{p}"


def _shown(ans: client.Answer) -> str:
    try:
        text = json.dumps(ans.json(), ensure_ascii=False, indent=1)
    except ValueError:
        text = ans.body.decode("utf-8", "replace")
    if len(text) > MAX_RESULT:
        text = text[:MAX_RESULT] + f"\n... (cut at {MAX_RESULT} characters: ask for less)"
    return text


async def _ask(ctx: ToolContext, method: str, path: str, query: str, body: bytes) -> str:
    if not client.enabled(ctx.workspace.id):
        return "Error: Prima is not set up on this server."
    person = await _person(ctx)
    if person is None:
        return (
            "Error: Prima is used only for a person who asked you (in chat, or by giving you "
            "the task). Nobody asked for this one."
        )
    try:
        ans = await client.call(
            ctx.db,
            workspace_id=ctx.workspace.id,
            user_id=person,
            method=method,
            path=path,
            query=query,
            body=body,
            via=client.via_agent(ctx.agent.name),
        )
    except PrimaError as e:
        return f"Error: {e.message}"
    text = _shown(ans)
    if ans.status >= 400:
        # Prima's own refusal (its roles and rules): say it as it is, never work around it.
        return f"Error: Prima refused ({ans.status}): {text}"
    # Prima's records hold what people typed: data, never instructions.
    return f"Prima {method} {path} ({ans.status}):\n{text}{_threat_note(text)}"


async def _find(ctx: ToolContext, args: dict[str, Any]) -> str:
    rows = routes.find(str(args.get("query") or ""), str(args.get("method") or ""))
    if not rows:
        return "No Prima action matches. Try other words (leave, claim, attendance, pay...)."
    return json.dumps(rows, ensure_ascii=False, indent=1)


async def _read(ctx: ToolContext, args: dict[str, Any]) -> str:
    q = args.get("query") or {}
    if not isinstance(q, dict):
        return "Error: query must be an object of names and values."
    query = urlencode({str(k): str(v) for k, v in q.items() if v is not None})
    return await _ask(ctx, "GET", _path(args.get("path")), query, b"")


async def _record(ctx: ToolContext, args: dict[str, Any]) -> str:
    body = args.get("body")
    if body is None:
        body = {}
    if not isinstance(body, dict | list):
        return "Error: body must be a JSON object."
    raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
    return await _ask(ctx, "POST", _path(args.get("path")), "", raw)


PRISMA_TOOLS = [
    Tool(
        "prisma_find",
        "Find a Prima action",
        "Which Prima Secure action does a job (attendance, leave, claims, staff pay, tenders, "
        "assets, cases, purchasing...): the method, the path (':id' parts to fill in), what it "
        "takes (query, body) and what it is for. Read the matching Prima SOP in the Library "
        "(search_library) before recording anything.",
        _p(
            {
                "query": {"type": "string", "description": "words, e.g. 'apply leave'"},
                "method": {"type": "string", "enum": ["GET", "POST"]},
            },
            ["query"],
        ),
        "low",
        "allow",
        _find,
    ),
    Tool(
        "prisma_read",
        "Read from Prima",
        "Read from Prima Secure as the person you are helping, with their access only: e.g. "
        "path 'api/me/home', 'api/leave', 'api/companies/co-1/attendance'. Use prisma_find for "
        "the path.",
        _p(
            {
                "path": {"type": "string", "description": "a GET path from prisma_find"},
                "query": {"type": "object", "description": "query values, e.g. {'date': '...'}"},
            },
            ["path"],
        ),
        "low",
        "allow",
        _read,
    ),
    Tool(
        "prisma_record",
        "Record in Prima",
        "Record something in Prima Secure as the person you are helping (apply for leave, file "
        "a claim, prepare a draft, decide a request...). They approve it first. Prima checks "
        "their role and its rules; if it refuses, say why and do not try another way. Follow "
        "the Prima SOP for the work; decisions on pay, discipline and contracts stay with "
        "people. Say what it records and why in `why`.",
        _p(
            {
                "path": {"type": "string", "description": "a POST path from prisma_find"},
                "body": {"type": "object", "description": "the JSON the action takes"},
                "why": {"type": "string", "description": "what this records, in one sentence"},
            },
            ["path", "body", "why"],
        ),
        "high",
        "ask",
        _record,
    ),
]
