"""P36: routines, jobs the office learned to repeat without the paid model (skills/routines.py).

- GET    /api/routines                 every routine with its record (office.view)
- GET    /api/routines/summary         how much they saved (office.view)
- POST   /api/routines/{id}/{action}   trust (live now) | pause | resume | retire (managers)
- DELETE /api/routines/{id}            forget it (managers)
- PUT    /api/routines/settings        switch routines on or off for the workspace (owner, admin)
"""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...core.security import can
from ...models import Agent, Routine, Workspace
from ...services import audit, events
from ..deps import Principal, api_error, current_principal, require

router = APIRouter(prefix="/api/routines", tags=["routines"])

MANAGERS = ("brain.manage", "agents.manage", "team.manage")


class RoutineOut(BaseModel):
    id: str
    name: str
    description: str
    example: str
    status: str
    slots: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    answer: dict[str, Any]
    tools: list[str]
    agent_id: str | None
    agent_name: str | None
    branch_id: str | None
    confirmations: int
    needed: int
    uses: int
    successes: int
    failures: int
    tokens_saved: int
    baseline_tokens: int | None
    last_used_at: datetime | None
    note: str | None
    created_at: datetime


class SummaryOut(BaseModel):
    enabled: bool
    active: int
    candidates: int
    paused: int
    uses: int
    successes: int
    tokens_saved: int


class SettingsIn(BaseModel):
    enabled: bool


def _manager(principal: Principal) -> None:
    if not any(can(principal.role, p) for p in MANAGERS):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only managers can change routines."
        )


def _scoped(q: Any, principal: Principal) -> Any:
    q = q.where(Routine.workspace_id == principal.workspace_id)
    sc = principal.scope
    if not sc.everything and sc.branch_id:
        q = q.where(or_(Routine.branch_id.is_(None), Routine.branch_id == sc.branch_id))
    return q


def _out(r: Routine, names: dict[str, str]) -> RoutineOut:
    from ...skills.routines import CONFIRMATIONS

    return RoutineOut(
        id=r.id,
        name=r.name,
        description=r.description,
        example=r.example,
        status=r.status,
        slots=r.slots or [],
        steps=r.steps or [],
        answer=r.answer or {},
        tools=r.tools or [],
        agent_id=r.agent_id,
        agent_name=names.get(r.agent_id or ""),
        branch_id=r.branch_id,
        confirmations=len(r.source_task_ids or []),
        needed=CONFIRMATIONS,
        uses=r.uses,
        successes=r.successes,
        failures=r.failures,
        tokens_saved=r.tokens_saved,
        baseline_tokens=r.baseline_tokens,
        last_used_at=r.last_used_at,
        note=r.note,
        created_at=r.created_at,
    )


async def _get(db: AsyncSession, principal: Principal, routine_id: str) -> Routine:
    r = await db.scalar(_scoped(select(Routine), principal).where(Routine.id == routine_id))
    if r is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "routine_not_found", "That routine is not here.")
    return r


@router.get("")
async def list_routines(
    state: Literal["candidate", "active", "paused", "retired"] | None = Query(default=None),
    principal: Principal = Depends(require("office.view")),
    db: AsyncSession = Depends(get_db),
) -> list[RoutineOut]:
    q = _scoped(select(Routine), principal)
    q = q.where(Routine.status == state) if state else q.where(Routine.status != "retired")
    rows = (
        await db.scalars(q.order_by(Routine.status, Routine.last_used_at.desc().nulls_last()))
    ).all()
    ids = {r.agent_id for r in rows if r.agent_id}
    names = (
        dict((await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(ids)))).all())
        if ids
        else {}
    )
    return [_out(r, names) for r in rows]


@router.get("/summary")
async def summary(
    principal: Principal = Depends(require("office.view")), db: AsyncSession = Depends(get_db)
) -> SummaryOut:
    ws = await db.get(Workspace, principal.workspace_id)
    rows: list[Any] = (
        await db.execute(
            _scoped(
                select(
                    Routine.status,
                    func.count(),
                    func.coalesce(func.sum(Routine.uses), 0),
                    func.coalesce(func.sum(Routine.successes), 0),
                    func.coalesce(func.sum(Routine.tokens_saved), 0),
                ),
                principal,
            ).group_by(Routine.status)
        )
    ).all()  # type: ignore[assignment]
    by = {s: (int(n), int(u), int(ok), int(saved)) for s, n, u, ok, saved in rows}
    return SummaryOut(
        enabled=((ws.settings or {}).get("routines") or {}).get("enabled", True) if ws else True,
        active=by.get("active", (0, 0, 0, 0))[0],
        candidates=by.get("candidate", (0, 0, 0, 0))[0],
        paused=by.get("paused", (0, 0, 0, 0))[0],
        uses=sum(v[1] for v in by.values()),
        successes=sum(v[2] for v in by.values()),
        tokens_saved=sum(v[3] for v in by.values()),
    )


@router.put("/settings")
async def settings(
    body: SettingsIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> SettingsIn:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    ws.settings = {**(ws.settings or {}), "routines": {"enabled": body.enabled}}
    flag_modified(ws, "settings")
    await audit.record(
        db, ws.id, principal.actor, "routines.settings", target=ws.id, after=body.model_dump()
    )
    await db.commit()
    return body


ACTIONS = {
    "trust": ("candidate", "paused"),
    "pause": ("candidate", "active"),
    "resume": ("paused",),
    "retire": ("candidate", "active", "paused"),
}


@router.post("/{routine_id}/{action}")
async def act(
    routine_id: str,
    action: Literal["trust", "pause", "resume", "retire"],
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> RoutineOut:
    _manager(principal)
    r = await _get(db, principal, routine_id)
    if r.status not in ACTIONS[action]:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "routine_state",
            "This routine is {status} already.",
            status=r.status,
        )
    before = r.status
    if action in ("trust", "resume"):
        r.status, r.failure_streak, r.note = "active", 0, None
        if action == "trust":
            r.confirmed_by = principal.actor
    elif action == "pause":
        r.status, r.note = "paused", None
    else:
        r.status = "retired"
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        f"routine.{action}",
        target=r.id,
        before={"status": before},
        after={"status": r.status, "name": r.name},
    )
    await db.commit()
    await events.publish(
        principal.workspace_id, "routine.updated", {"routine_id": r.id, "status": r.status}
    )
    name = None
    if r.agent_id:
        a = await db.get(Agent, r.agent_id)
        name = a.name if a else None
    return _out(r, {r.agent_id: name} if r.agent_id and name else {})


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(
    routine_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    _manager(principal)
    r = await _get(db, principal, routine_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "routine.deleted",
        target=r.id,
        before={"name": r.name, "status": r.status},
    )
    await db.delete(r)
    await db.commit()
    await events.publish(
        principal.workspace_id, "routine.updated", {"routine_id": routine_id, "deleted": True}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
