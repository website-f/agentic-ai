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


async def _agent(db: AsyncSession, principal: Principal, agent_id: str) -> Agent:
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
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
    a = await _agent(db, principal, agent_id)
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
    if sid and current is not None:
        # While it works, show only this task's browser, not the last screen of an older one.
        meta = _s(await valkey().get(f"browser:session:{sid}"))
        if not meta or json.loads(meta).get("task_id") != current.id:
            sid = None
    return {
        "agent": {
            "id": a.id,
            "name": a.name,
            "role": a.role,
            "color": a.color,
            "status": a.status,
            "clone_of": a.clone_of,
        },
        "helpers": [
            {"id": h.id, "name": h.name, "color": h.color}
            for h in (
                await db.scalars(
                    select(Agent).where(Agent.clone_of == a.id, Agent.status == "active")
                )
            ).all()
        ],
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


@router.get("/monitor/wall")
async def wall(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Every agent at work right now (in scope), with its browser and last step: the
    owner's wall of screens."""
    q = select(Task).where(
        Task.workspace_id == principal.workspace_id, Task.status.in_(("running", "blocked"))
    )
    cond = principal.scope.task_where()
    if cond is not None:
        q = q.where(cond)
    tasks = (await db.scalars(q.order_by(Task.updated_at.desc()).limit(40))).all()
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for t in tasks:
        a = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
        if a is None or a.id in seen or not principal.scope.sees_agent(a):
            continue
        seen.add(a.id)
        last = await db.scalar(
            select(Event)
            .where(
                Event.workspace_id == principal.workspace_id,
                Event.type == "agent.activity",
                Event.data["agent_id"].astext == a.id,
            )
            .order_by(Event.seq.desc())
            .limit(1)
        )
        sid = _s(await valkey().get(f"browser:agent:{a.id}"))
        out.append(
            {
                "agent": {
                    "id": a.id,
                    "name": a.name,
                    "role": a.role,
                    "color": a.color,
                    "branch_id": a.branch_id,
                    "clone_of": a.clone_of,
                },
                "task": {"id": t.id, "title": t.title, "status": t.status},
                "browser": {"session": sid} if sid else None,
                "last": {"ts": last.ts, "data": last.data} if last else None,
            }
        )
    return out


@router.get("/browser/{session}/frame.jpg")
async def frame(
    session: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    meta = _s(await valkey().get(f"browser:session:{session}"))
    info = json.loads(meta) if meta else {}
    owner = await db.get(Agent, info.get("agent_id")) if info.get("agent_id") else None
    if (
        not meta
        or info.get("workspace_id") != principal.workspace_id
        or not principal.scope.sees_agent(owner)
    ):
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
