"""The pixel office: one snapshot per branch. Live changes arrive over /api/events.

The office is a view onto real state, never a simulation: each agent's state here is derived
from its tasks and approvals, and the client only animates the walk between places.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Agent, Approval, Branch, Department, Meeting, Task, TaskEvent
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["office"])

ERROR_WINDOW = timedelta(hours=1)  # a failure this recent still shows at the bug corner


def derive_state(agent: Agent, tasks: list[Task], pending: int, in_meeting: bool = False) -> str:
    """paused | waiting_approval | in_meeting | working | error | idle, in that priority."""
    if agent.status == "paused":
        return "paused"
    if pending or any(t.status == "blocked" for t in tasks):
        return "waiting_approval"
    if in_meeting:
        return "in_meeting"
    if any(t.status == "running" for t in tasks):
        return "working"
    recent = datetime.now(UTC) - ERROR_WINDOW
    latest = max(tasks, key=lambda t: t.updated_at, default=None)
    if latest is not None and latest.status == "failed" and latest.updated_at >= recent:
        return "error"
    return "idle"


@router.get("/office/{branch_id}")
async def office_snapshot(
    branch_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    branch = await db.get(Branch, branch_id)
    if branch is None or branch.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    depts = list(
        (
            await db.scalars(
                select(Department)
                .where(Department.branch_id == branch.id)
                .order_by(Department.position, Department.name)
            )
        ).all()
    )
    agents = list(
        (
            await db.scalars(
                select(Agent)
                .where(
                    Agent.branch_id == branch.id,
                    Agent.status != "retired",
                    principal.scope.observe_where(),  # staff watch the whole office
                )
                .order_by(Agent.created_at)
            )
        ).all()
    )
    ids = [a.id for a in agents]
    since = datetime.now(UTC) - timedelta(days=1)
    tasks = (
        list(
            (
                await db.scalars(
                    select(Task).where(
                        Task.assignee_agent_id.in_(ids),
                        (Task.status.in_(("running", "blocked"))) | (Task.updated_at >= since),
                    )
                )
            ).all()
        )
        if ids
        else []
    )
    pending = (
        dict(
            (
                await db.execute(
                    select(Approval.agent_id, func.count())
                    .where(Approval.agent_id.in_(ids), Approval.status == "pending")
                    .group_by(Approval.agent_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    # Last thing each agent said or did, for the speech bubble on arrival.
    last: dict[str, dict[str, Any]] = {}
    if ids:
        actors = [f"agent:{i}" for i in ids]
        rows = (
            await db.execute(
                select(TaskEvent.actor, TaskEvent.text, TaskEvent.ts, TaskEvent.kind)
                .where(TaskEvent.actor.in_(actors), TaskEvent.ts >= since)
                .order_by(TaskEvent.ts.desc())
                .limit(200)
            )
        ).all()
        for actor, text, ts, kind in rows:
            last.setdefault(actor.removeprefix("agent:"), {"text": text, "ts": ts, "kind": kind})

    meeting_of: dict[str, str] = {}
    for mid, people in (
        await db.execute(
            select(Meeting.id, Meeting.participant_ids).where(
                Meeting.workspace_id == principal.workspace_id, Meeting.status == "running"
            )
        )
    ).all():
        for aid in people or []:
            meeting_of.setdefault(aid, mid)

    by_agent: dict[str, list[Task]] = {}
    for t in tasks:
        by_agent.setdefault(t.assignee_agent_id or "", []).append(t)
    out_agents = []
    for a in agents:
        mine = by_agent.get(a.id, [])
        current = next(
            (t for t in mine if t.status in ("running", "blocked")),
            max(mine, key=lambda t: t.updated_at, default=None),
        )
        out_agents.append(
            {
                "id": a.id,
                "name": a.name,
                "role": a.role,
                "color": a.color,
                "department_id": a.department_id,
                "view_only": not principal.scope.sees_agent(a),  # staff watching colleagues
                "status": a.status,
                "clone_of": a.clone_of,
                "owner_user_id": a.owner_user_id,
                "state": derive_state(a, mine, pending.get(a.id, 0), a.id in meeting_of),
                "meeting_id": meeting_of.get(a.id),
                "pending_approvals": pending.get(a.id, 0),
                "task": {"id": current.id, "title": current.title, "status": current.status}
                if current
                else None,
                "last": last.get(a.id),
            }
        )
    return {
        "branch": {
            "id": branch.id,
            "name": branch.name,
            "slug": branch.slug,
            "color": branch.color,
        },
        "departments": [{"id": d.id, "name": d.name, "slug": d.slug} for d in depts],
        "agents": out_agents,
    }
