"""The live monitor: what an agent is doing right now, step by step, and its browser."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.valkey import valkey, valkey_bytes
from ...models import Agent, Event, LLMCall, Task
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["monitor"])

FEED_TYPES = ("agent.activity", "task.event", "meeting.turn", "approval.requested")


async def _agent(db: AsyncSession, ws: str, agent_id: str) -> Agent:
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != ws:
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    return a


def _s(v: Any) -> str | None:
    if v is None:
        return None
    return v.decode() if isinstance(v, bytes) else str(v)


@router.get("/agents/{agent_id}/activity")
async def activity(
    agent_id: str,
    limit: int = Query(default=150, ge=1, le=500),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The agent's recent steps (newest last), plus what it is working on and has spent."""
    a = await _agent(db, principal.workspace_id, agent_id)
    mine = or_(
        Event.data["agent_id"].astext == a.id,
        and_(Event.type == "task.event", Event.data["actor"].astext == f"agent:{a.id}"),
    )
    rows = (
        await db.scalars(
            select(Event)
            .where(Event.workspace_id == a.workspace_id, Event.type.in_(FEED_TYPES), mine)
            .order_by(Event.seq.desc())
            .limit(limit)
        )
    ).all()
    current = await db.scalar(
        select(Task)
        .where(Task.assignee_agent_id == a.id, Task.status.in_(("running", "blocked")))
        .order_by(Task.updated_at.desc())
        .limit(1)
    )
    since = datetime.now(UTC) - timedelta(days=1)
    spent = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
            ).where(LLMCall.agent_id == a.id, LLMCall.ts >= since)
        )
    ).one()
    task_spent = None
    if current is not None:
        t = (
            await db.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                ).where(LLMCall.task_id == current.id)
            )
        ).one()
        task_spent = {"calls": int(t[0]), "tokens": int(t[1])}
    sid = _s(await valkey().get(f"browser:agent:{a.id}"))
    return {
        "agent": {"id": a.id, "name": a.name, "role": a.role, "color": a.color, "status": a.status},
        "task": {
            "id": current.id,
            "title": current.title,
            "status": current.status,
            **(task_spent or {}),
        }
        if current
        else None,
        "today": {"calls": int(spent[0]), "tokens": int(spent[1]), "usd": float(spent[2] or 0)},
        "browser": {"session": sid} if sid else None,
        "events": [
            {"seq": e.seq, "ts": e.ts, "type": e.type, "data": e.data} for e in reversed(rows)
        ],
    }


@router.get("/browser/{session}/frame.jpg")
async def frame(
    session: str,
    principal: Principal = Depends(require("read")),
) -> Response:
    meta = _s(await valkey().get(f"browser:session:{session}"))
    if not meta or json.loads(meta).get("workspace_id") != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "no_browser", "That browser is not open.")
    data = await valkey_bytes().get(f"browser:frame:{session}")
    if not data:
        raise api_error(status.HTTP_404_NOT_FOUND, "no_frame", "Nothing on screen yet.")
    seq = _s(await valkey().get(f"browser:frame_seq:{session}")) or "0"
    body = data if isinstance(data, bytes) else str(data).encode()
    return Response(
        body,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Frame-Seq": seq},
    )
