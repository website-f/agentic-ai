"""P38: a person's way out of any stuck or failed task, so no work is ever left hanging.

- POST /api/tasks/{id}/stop          stop it now, even in the middle of a long step
- POST /api/tasks/{id}/finish        close it with my own result ("I'll do it myself")
- POST /api/tasks/{id}/retry-with    run it again on another AI (model group) and/or agent

Allowed for the person who gave the task and for the people who manage its agent (the same
people who may act on its approvals). A running run is terminated first: cancel only takes
effect between steps, and a stuck step can last minutes.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch, launch, runtime
from ...core.db import get_db
from ...core.security import can
from ...engine import media
from ...models import Agent, Approval, ModelGroup, Task
from ...teams import blockers
from ..agent_schemas import TaskOut
from ..deps import Principal, api_error, require
from .tasks import RUNNING, _task, task_out

router = APIRouter(prefix="/api", tags=["tasks"])

MANAGERS = ("org.manage", "team.manage", "agents.manage")


class FinishIn(BaseModel):
    result: str = Field(min_length=1, max_length=20_000)


class RetryWithIn(BaseModel):
    model_group: str | None = Field(default=None, max_length=40)
    agent_id: str | None = Field(default=None, max_length=40)


async def _acting_task(db: AsyncSession, principal: Principal, task_id: str) -> Task:
    t = await _task(db, principal, task_id)
    agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
    mine = t.created_by == principal.actor or (
        agent is not None and agent.owner_user_id == principal.user.id
    )
    manages = any(can(principal.role, p) for p in MANAGERS) and (
        agent is None or principal.scope.sees_agent(agent)
    )
    if not (mine or manages):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "not_yours",
            "Only the person who gave this task or a manager of its agent can do this.",
        )
    return t


async def _end_run(db: AsyncSession, t: Task, why: str) -> None:
    """Terminate the live run (if any) and close what it was waiting on."""
    if t.status in RUNNING and t.workflow_id and not launch.restartable(t):
        try:
            await dispatch.terminate_task(t.workflow_id, why)
        except Exception as e:  # noqa: BLE001 - Temporal down: nothing stopped, say so
            raise api_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "temporal_unavailable",
                "The worker service is not reachable, so the run could not be stopped. Try "
                "again in a moment.",
            ) from e
    for a in (
        await db.scalars(
            select(Approval).where(Approval.task_id == t.id, Approval.status == "pending")
        )
    ).all():
        a.status = "cancelled"
    await db.commit()
    agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
    if agent is not None:
        await runtime.agent_status(agent, "idle", t)


@router.post("/tasks/{task_id}/stop")
async def stop_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _acting_task(db, principal, task_id)
    if t.status in ("done", "failed", "cancelled"):
        raise api_error(status.HTTP_409_CONFLICT, "not_running", "This task is not running.")
    await _end_run(db, t, f"stopped by {principal.user.name}")
    await runtime.set_task_status(
        db,
        t,
        "failed",
        actor=principal.actor,
        note="stopped the run",
        error=f"Stopped by {principal.user.name}.",
        finished_at=datetime.now(UTC),
        blocked_reason=None,
        blocked_owner=None,
        blocked_action=None,
    )
    await blockers.on_finished(db, t)
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/finish")
async def finish_by_hand(
    task_id: str,
    body: FinishIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _acting_task(db, principal, task_id)
    if t.status in ("done", "cancelled"):
        raise api_error(status.HTTP_409_CONFLICT, "already_finished", "This task is finished.")
    await _end_run(db, t, f"finished by {principal.user.name}")
    await runtime.set_task_status(
        db,
        t,
        "done",
        actor=principal.actor,
        note="finished it by hand",
        result=body.result.strip(),
        error=None,
        finished_at=datetime.now(UTC),
        blocked_reason=None,
        blocked_owner=None,
        blocked_action=None,
    )
    await runtime.task_event(
        db, t, "by_hand", principal.actor, "finished the task with their own result"
    )
    await blockers.on_finished(db, t)  # work waiting on it can go ahead
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/retry-with")
async def retry_with(
    task_id: str,
    body: RetryWithIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _acting_task(db, principal, task_id)
    if body.model_group:
        g = await db.scalar(
            select(ModelGroup).where(
                ModelGroup.workspace_id == principal.workspace_id,
                ModelGroup.name == body.model_group,
            )
        )
        # Chat groups only; the tiny local backup model is too small for agent work.
        if g is None or g.name in media.NOT_CHAT or g.name == "local" or not g.members:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_group",
                "Pick an AI group that has models.",
            )
    if body.agent_id and body.agent_id != t.assignee_agent_id:
        from .tasks import _assignee

        agent = await _assignee(db, principal, body.agent_id)
        if agent is None:
            raise api_error(status.HTTP_400_BAD_REQUEST, "no_assignee", "Pick an agent.")
    else:
        agent = None
    await _end_run(db, t, f"restarted by {principal.user.name}")
    if t.status in RUNNING:
        t.status = "ready"  # the old run is gone: launch starts a fresh one
    t.model_group = body.model_group or None
    if agent is not None:
        t.assignee_agent_id, t.branch_id = agent.id, agent.branch_id
    await db.commit()
    await runtime.task_event(
        db,
        t,
        "retry_with",
        principal.actor,
        "started it again"
        + (f" on the {t.model_group} AI" if t.model_group else "")
        + (f" with {agent.name}" if agent is not None else ""),
        {"model_group": t.model_group, "agent_id": t.assignee_agent_id},
    )
    try:
        await launch.launch(db, t, principal.actor)
    except launch.LaunchError as e:
        raise api_error(e.status, e.code, e.message) from e
    await db.refresh(t)
    return await task_out(db, t)
