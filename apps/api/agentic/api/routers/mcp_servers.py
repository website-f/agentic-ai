"""Connect external MCP servers (P13). Admins add a server URL (and optional auth header); the
office discovers its tools and offers them to agents through the tool_search / tool_call bridge.
Calls to them are approval-gated like any outward action."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import mcp
from ...core import crypto
from ...core.db import get_db
from ...core.ssrf import BlockedURL, guard_url
from ...models import Agent, McpServer
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/mcp-servers", tags=["mcp"])


class McpOut(BaseModel):
    id: str
    name: str
    url: str
    description: str
    enabled: bool
    has_auth: bool
    tool_count: int
    tools: list[dict[str, Any]]
    agent_ids: list[str]
    health: str
    last_error: str | None
    created_by: str
    created_at: datetime


def _out(s: McpServer) -> McpOut:
    return McpOut(
        id=s.id,
        name=s.name,
        url=s.url,
        description=s.description,
        enabled=s.enabled,
        has_auth=bool(s.auth_header_enc),
        tool_count=len(s.tools or []),
        tools=[{"name": t["name"], "description": t.get("description", "")} for t in s.tools or []],
        agent_ids=s.agent_ids or [],
        health=s.health,
        last_error=s.last_error,
        created_by=s.created_by,
        created_at=s.created_at,
    )


async def _get(db: AsyncSession, ws: str, sid: str) -> McpServer:
    s = await db.get(McpServer, sid)
    if s is None or s.workspace_id != ws:
        raise api_error(status.HTTP_404_NOT_FOUND, "mcp_not_found", "That server is not here.")
    return s


async def _check_url(url: str) -> None:
    if not url.startswith(("http://", "https://")):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_url", "Give an http(s) URL.")
    try:
        await guard_url(url)
    except BlockedURL as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "blocked_url", str(e)) from e


@router.get("")
async def list_servers(
    principal: Principal = Depends(require("org.read")), db: AsyncSession = Depends(get_db)
) -> list[McpOut]:
    rows = (
        await db.scalars(
            select(McpServer)
            .where(McpServer.workspace_id == principal.workspace_id)
            .order_by(McpServer.name)
        )
    ).all()
    return [_out(s) for s in rows]


class McpIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    url: str = Field(min_length=8, max_length=400)
    description: str = Field(default="", max_length=300)
    auth_header: str = Field(default="", max_length=800)
    agent_ids: list[str] = Field(default_factory=list, max_length=100)
    enabled: bool = True


async def _discover(s: McpServer) -> None:
    try:
        header = crypto.decrypt(s.auth_header_enc, s.aad) if s.auth_header_enc else ""
        s.tools = await mcp.list_tools(s.url, header)
        s.health, s.last_error = "ok", None
    except mcp.McpError as e:
        s.health, s.last_error = "down", str(e)[:300]


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_server(
    body: McpIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> McpOut:
    await _check_url(body.url)
    if await db.scalar(
        select(McpServer.id).where(
            McpServer.workspace_id == principal.workspace_id, McpServer.name == body.name
        )
    ):
        raise api_error(status.HTTP_409_CONFLICT, "name_taken", "A server with that name exists.")
    s = McpServer(
        workspace_id=principal.workspace_id,
        name=body.name,
        url=body.url,
        description=body.description,
        enabled=body.enabled,
        agent_ids=await _clean_agents(db, principal, body.agent_ids),
        created_by=principal.actor,
    )
    if body.auth_header.strip():
        s.auth_header_enc = crypto.encrypt(body.auth_header.strip(), s.aad)
    await _discover(s)
    db.add(s)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mcp.added",
        target=s.id,
        after={"name": s.name, "url": s.url, "tools": len(s.tools)},
    )
    await db.commit()
    await db.refresh(s)
    return _out(s)


async def _clean_agents(db: AsyncSession, principal: Principal, ids: list[str]) -> list[str]:
    out = []
    for aid in dict.fromkeys(ids):
        a = await db.get(Agent, aid)
        # P29: never someone else's private assistant (sees_agent leaves those out).
        if (
            a is None
            or a.workspace_id != principal.workspace_id
            or not principal.scope.sees_agent(a)
        ):
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick agents in this workspace."
            )
        out.append(aid)
    return out


class McpUpdateIn(BaseModel):
    description: str | None = Field(default=None, max_length=300)
    auth_header: str | None = Field(default=None, max_length=800)
    agent_ids: list[str] | None = None
    enabled: bool | None = None


@router.patch("/{sid}")
async def update_server(
    sid: str,
    body: McpUpdateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> McpOut:
    s = await _get(db, principal.workspace_id, sid)
    before = {"enabled": s.enabled, "agent_ids": list(s.agent_ids or [])}
    if body.description is not None:
        s.description = body.description
    if body.enabled is not None:
        s.enabled = body.enabled
    if body.agent_ids is not None:
        s.agent_ids = await _clean_agents(db, principal, body.agent_ids)
    if body.auth_header is not None:
        s.auth_header_enc = (
            crypto.encrypt(body.auth_header.strip(), s.aad) if body.auth_header.strip() else ""
        )
    # P29: like adding one, every change is on the record (never the header itself).
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mcp.updated",
        target=s.id,
        before=before,
        after={"enabled": s.enabled, "agent_ids": list(s.agent_ids or [])},
        note="auth header changed" if body.auth_header is not None else None,
    )
    await db.commit()
    await db.refresh(s)
    return _out(s)


@router.post("/{sid}/refresh")
async def refresh_server(
    sid: str,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> McpOut:
    s = await _get(db, principal.workspace_id, sid)
    await _discover(s)
    await db.commit()
    await db.refresh(s)
    if s.health != "ok":
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, "mcp_unreachable", s.last_error or "Could not reach it."
        )
    return _out(s)


@router.delete("/{sid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    sid: str,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    s = await _get(db, principal.workspace_id, sid)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mcp.deleted",
        target=s.id,
        before={"name": s.name},
    )
    await db.delete(s)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
