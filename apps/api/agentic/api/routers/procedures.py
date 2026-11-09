"""P96: what each agent learned to do without the AI engine, and the tokens that saved.

A learned procedure is a routine (skills/routines.py) an agent may replay; a reused answer is
a chat answer given again to the same person (brain/answers.py).

- GET    /api/procedures/summary            one row per agent the person sees (AI use page)
- GET    /api/procedures/agents/{agent_id}  the agent's procedures, switch and savings
- PUT    /api/procedures/agents/{agent_id}  {"replay": bool}: reuse what it learned, or not
- DELETE /api/procedures/{routine_id}       forget one procedure

Who: anyone who sees the agent reads its numbers. The switch and forgetting are for whoever
may manage the agent (agents.manage in scope, or the person who owns their own AI); routine
managers (brain/agents/team.manage) may also forget an office routine. An office routine
another agent learned is listed for an agent only when that agent used it.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import Integer, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...brain import answers
from ...core.db import get_db
from ...core.security import can
from ...models import Agent, Routine, Task, TaskEvent, Workspace
from ...services import audit, events
from ...skills import routines
from ..deps import Principal, api_error, current_principal
from .agents import can_manage, get_agent

router = APIRouter(prefix="/api/procedures", tags=["procedures"])

ROUTINE_MANAGERS = ("brain.manage", "agents.manage", "team.manage")


class ProcedureOut(BaseModel):
    id: str
    name: str
    description: str
    status: str
    steps: int
    tools: list[str]
    browser: bool
    own: bool  # only this agent (and only for one person) replays it
    learned_here: bool
    uses: int
    successes: int
    failures: int
    tokens_saved: int
    baseline_tokens: int | None
    last_used_at: datetime | None
    note: str | None
    can_forget: bool


class AgentSavingsOut(BaseModel):
    agent_id: str
    agent_name: str
    replay: bool  # this agent's switch
    office_on: bool  # the office-wide switch (Skills > Routines)
    can_manage: bool
    procedures: int
    active: int
    replays: int  # tasks done by a procedure, without the agent's model
    tokens_saved: int  # against the first time each job was done
    answers_reused: int
    answer_tokens_saved: int


class AgentDetailOut(AgentSavingsOut):
    items: list[ProcedureOut]


class SwitchIn(BaseModel):
    replay: bool


def _routines_cfg(ws: Workspace | None) -> dict[str, Any]:
    return dict(((ws.settings if ws else None) or {}).get("routines") or {})


async def _replays(
    db: AsyncSession, workspace_id: str, agent_ids: list[str]
) -> dict[str, tuple[int, int]]:
    """{agent_id: (tasks a procedure finished, tokens it saved)} from the task timelines."""
    if not agent_ids:
        return {}
    saved = func.coalesce(TaskEvent.data["saved"].astext.cast(Integer), 0)
    rows = (
        await db.execute(
            select(Task.assignee_agent_id, func.count(), func.coalesce(func.sum(saved), 0))
            .join(Task, Task.id == TaskEvent.task_id)
            .where(
                Task.workspace_id == workspace_id,
                Task.assignee_agent_id.in_(agent_ids),
                TaskEvent.kind == "routine_run",
                TaskEvent.data["state"].astext == "done",
            )
            .group_by(Task.assignee_agent_id)
        )
    ).all()
    return {str(a): (int(n), int(s)) for a, n, s in rows}


async def _used_by(db: AsyncSession, agent: Agent) -> set[str]:
    """Routine ids this agent's tasks followed."""
    rows = (
        await db.scalars(
            select(TaskEvent.data["routine_id"].astext)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(
                Task.workspace_id == agent.workspace_id,
                Task.assignee_agent_id == agent.id,
                TaskEvent.kind == "routine_run",
            )
            .distinct()
        )
    ).all()
    return {r for r in rows if r}


def _may_forget(principal: Principal, agent: Agent, r: Routine) -> bool:
    if any(can(principal.role, p) for p in ROUTINE_MANAGERS):
        return True
    # A person's own AI: they forget what it learned for itself (never an office routine).
    return r.agent_only and r.agent_id == agent.id and can_manage(principal, agent)


def _item(principal: Principal, agent: Agent, r: Routine) -> ProcedureOut:
    return ProcedureOut(
        id=r.id,
        name=r.name,
        description=r.description,
        status=r.status,
        steps=len(r.steps or []),
        tools=r.tools or [],
        browser=any(routines.is_browser(str(s.get("tool") or "")) for s in r.steps or []),
        own=bool(r.agent_only),
        learned_here=r.agent_id == agent.id,
        uses=r.uses,
        successes=r.successes,
        failures=r.failures,
        tokens_saved=r.tokens_saved,
        baseline_tokens=r.baseline_tokens,
        last_used_at=r.last_used_at,
        note=r.note,
        can_forget=_may_forget(principal, agent, r),
    )


async def _row(
    principal: Principal,
    ws: Workspace | None,
    agent: Agent,
    counts: tuple[int, int],
    replays: tuple[int, int],
    reused: dict[str, int],
) -> AgentSavingsOut:
    cfg = _routines_cfg(ws)
    return AgentSavingsOut(
        agent_id=agent.id,
        agent_name=agent.name,
        replay=agent.id not in (cfg.get("agents_off") or []),
        office_on=cfg.get("enabled") is not False,
        can_manage=can_manage(principal, agent),
        procedures=counts[0],
        active=counts[1],
        replays=replays[0],
        tokens_saved=replays[1],
        answers_reused=int(reused.get("hits", 0)),
        answer_tokens_saved=int(reused.get("saved", 0)),
    )


@router.get("/summary")
async def summary(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[AgentSavingsOut]:
    ws = await db.get(Workspace, principal.workspace_id)
    agents = [
        a
        for a in (
            await db.scalars(
                select(Agent).where(
                    Agent.workspace_id == principal.workspace_id, Agent.status != "retired"
                )
            )
        ).all()
        if principal.scope.sees_agent(a)
    ]
    ids = [a.id for a in agents]
    learned: dict[str, tuple[int, int]] = {}
    if ids:
        for agent_id, n, live in (
            await db.execute(
                select(
                    Routine.agent_id,
                    func.count(),
                    func.count().filter(Routine.status == "active"),
                )
                .where(
                    Routine.workspace_id == principal.workspace_id,
                    Routine.agent_id.in_(ids),
                    Routine.status != "retired",
                )
                .group_by(Routine.agent_id)
            )
        ).all():
            learned[str(agent_id)] = (int(n), int(live))
    replays = await _replays(db, principal.workspace_id, ids)
    reused = await answers.stats(principal.workspace_id)
    rows = [
        await _row(
            principal,
            ws,
            a,
            learned.get(a.id, (0, 0)),
            replays.get(a.id, (0, 0)),
            reused.get(a.id, {}),
        )
        for a in agents
    ]
    rows.sort(key=lambda r: (-(r.tokens_saved + r.answer_tokens_saved), r.agent_name.lower()))
    return rows


@router.get("/agents/{agent_id}")
async def for_agent(
    agent_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> AgentDetailOut:
    agent = await get_agent(db, principal, agent_id)
    ws = await db.get(Workspace, principal.workspace_id)
    used = await _used_by(db, agent)
    rows = list(
        (
            await db.scalars(
                select(Routine)
                .where(
                    Routine.workspace_id == agent.workspace_id,
                    Routine.status != "retired",
                    or_(Routine.agent_id == agent.id, Routine.id.in_(used) if used else false()),
                )
                .order_by(Routine.last_used_at.desc().nulls_last(), Routine.created_at.desc())
                .limit(100)
            )
        ).all()
    )
    mine = [r for r in rows if r.agent_id == agent.id]
    replays = await _replays(db, agent.workspace_id, [agent.id])
    reused = (await answers.stats(agent.workspace_id)).get(agent.id, {})
    row = await _row(
        principal,
        ws,
        agent,
        (len(mine), sum(1 for r in mine if r.status == "active")),
        replays.get(agent.id, (0, 0)),
        reused,
    )
    return AgentDetailOut(**row.model_dump(), items=[_item(principal, agent, r) for r in rows])


@router.put("/agents/{agent_id}")
async def switch(
    agent_id: str,
    body: SwitchIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> SwitchIn:
    agent = await get_agent(db, principal, agent_id)
    if not can_manage(principal, agent):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only someone who manages this agent can do that.",
        )
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    cfg = _routines_cfg(ws)
    off = [a for a in cfg.get("agents_off") or [] if a != agent.id]
    if not body.replay:
        off.append(agent.id)
    ws.settings = {**(ws.settings or {}), "routines": {**cfg, "agents_off": off}}
    flag_modified(ws, "settings")
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "procedures.switch",
        target=agent.id,
        after={"replay": body.replay, "agent": agent.name},
    )
    await db.commit()
    return body


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def forget(
    routine_id: str,
    agent_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    agent = await get_agent(db, principal, agent_id)
    r = await db.get(Routine, routine_id)
    if r is None or r.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "routine_not_found", "That routine is not here.")
    sc = principal.scope
    if not sc.everything and sc.branch_id and r.branch_id not in (None, sc.branch_id):
        raise api_error(status.HTTP_404_NOT_FOUND, "routine_not_found", "That routine is not here.")
    if r.agent_id != agent.id and r.id not in await _used_by(db, agent):
        raise api_error(status.HTTP_404_NOT_FOUND, "routine_not_found", "That routine is not here.")
    if not _may_forget(principal, agent, r):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only managers can forget an office routine."
        )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "routine.deleted",
        target=r.id,
        before={"name": r.name, "status": r.status, "agent": agent.id},
    )
    await db.delete(r)
    await db.commit()
    await events.publish(
        principal.workspace_id, "routine.updated", {"routine_id": routine_id, "deleted": True}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
