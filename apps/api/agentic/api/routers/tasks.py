"""Tasks (the board) and approvals (decisions agents wait on)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import decisions, dispatch, runtime
from ...agents.tools import TOOLS
from ...core.db import get_db
from ...models import Agent, AgentMessage, Approval, Task, TaskEvent, User
from ...services import audit, events
from ...skills import store as skills_store
from ..agent_schemas import (
    ApprovalOut,
    DecisionIn,
    ReviseIn,
    TaskDetailOut,
    TaskEventOut,
    TaskIn,
    TaskOut,
    TaskUpdateIn,
)
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["tasks"])

RUNNING = ("running", "blocked")
# Moves a person can make by dragging a card. Running/blocked cards are driven by the agent.
MANUAL_MOVES = {
    "triage": {"ready", "cancelled"},
    "ready": {"triage", "cancelled"},
    "review": {"done", "cancelled"},
    "failed": {"triage", "cancelled"},
    "done": {"triage"},
    "cancelled": {"triage"},
}


async def _names(db: AsyncSession, actors: set[str]) -> dict[str, str]:
    users = {a.removeprefix("user:") for a in actors if a.startswith("user:")}
    agents = {a.removeprefix("agent:") for a in actors if a.startswith("agent:")}
    out: dict[str, str] = {}
    if users:
        for uid, name in (
            await db.execute(select(User.id, User.name).where(User.id.in_(users)))
        ).all():
            out[f"user:{uid}"] = name
    if agents:
        for aid, name in (
            await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agents)))
        ).all():
            out[f"agent:{aid}"] = name
    return out


async def task_out(db: AsyncSession, t: Task) -> TaskOut:
    agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
    pending = (
        await db.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.task_id == t.id, Approval.status == "pending")
        )
        or 0
    )
    return TaskOut(
        id=t.id,
        title=t.title,
        brief=t.brief,
        status=t.status,
        priority=t.priority,
        assignee_agent_id=t.assignee_agent_id,
        assignee_name=agent.name if agent else None,
        assignee_color=agent.color if agent else None,
        source=t.source,
        requires_review=t.requires_review,
        result=t.result,
        error=t.error,
        blocked_reason=t.blocked_reason,
        run_count=t.run_count,
        steps_used=t.steps_used,
        pending_approvals=pending,
        created_by=t.created_by,
        created_at=t.created_at,
        updated_at=t.updated_at,
        started_at=t.started_at,
        finished_at=t.finished_at,
    )


async def approval_out(
    db: AsyncSession, a: Approval, names: dict[str, str] | None = None
) -> ApprovalOut:
    task = await db.get(Task, a.task_id)
    agent = await db.get(Agent, a.agent_id)
    names = names or (await _names(db, {a.decided_by}) if a.decided_by else {})
    return ApprovalOut(
        id=a.id,
        kind=a.kind,
        tool_name=a.tool_name,
        tool_label="Question"
        if a.kind == "question"
        else (TOOLS[a.tool_name].label if a.tool_name in TOOLS else a.tool_name),
        args=a.args,
        reason=a.reason,
        risk=a.risk,
        rule=a.rule,
        status=a.status,
        scope=a.scope,
        answer=a.answer,
        decided_by=a.decided_by,
        decided_by_name=names.get(a.decided_by or ""),
        decided_at=a.decided_at,
        created_at=a.created_at,
        expires_at=a.expires_at,
        task_id=a.task_id,
        task_title=task.title if task else "",
        agent_id=a.agent_id,
        agent_name=agent.name if agent else "Removed agent",
        agent_color=agent.color if agent else "#888888",
    )


async def _task(db: AsyncSession, ws: str, task_id: str) -> Task:
    t = await db.get(Task, task_id)
    if t is None or t.workspace_id != ws:
        raise api_error(status.HTTP_404_NOT_FOUND, "task_not_found", "That task is not here.")
    return t


async def _assignee(db: AsyncSession, ws: str, agent_id: str | None) -> Agent | None:
    if not agent_id:
        return None
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != ws:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick an agent from this workspace."
        )
    return a


async def start(db: AsyncSession, t: Task, actor: str) -> None:
    """Begin a fresh run: a new workflow, the same conversation."""
    if not t.assignee_agent_id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "no_assignee", "Assign an agent before starting."
        )
    agent = await db.get(Agent, t.assignee_agent_id)
    if agent is None or agent.status != "active":
        raise api_error(
            status.HTTP_409_CONFLICT, "agent_inactive", "The assigned agent is not active."
        )
    if t.status in RUNNING:
        raise api_error(
            status.HTTP_409_CONFLICT, "already_running", "This task is already running."
        )
    t.run_count += 1
    t.status = "ready"
    t.result = t.error = t.blocked_reason = None
    await db.commit()
    try:
        t.workflow_id = await dispatch.start_task(t.id, t.run_count)
    except Exception as e:
        t.status = "failed"
        msg = f"Could not start: the worker service is not reachable ({e.__class__.__name__})."
        t.error = msg
        await db.commit()
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "temporal_unavailable", msg) from e
    await db.commit()
    await runtime.task_event(db, t, "run", actor, f"started run {t.run_count}")


# ---------------------------------------------------------------- tasks


@router.get("/tasks")
async def list_tasks(
    status_: str | None = Query(default=None, alias="status"),
    agent_id: str | None = None,
    branch_id: str | None = None,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskOut]:
    q = select(Task).where(Task.workspace_id == principal.workspace_id)
    if status_:
        q = q.where(Task.status.in_(status_.split(",")))
    if agent_id:
        q = q.where(Task.assignee_agent_id == agent_id)
    if branch_id:
        q = q.where(Task.branch_id == branch_id)
    rows = (await db.scalars(q.order_by(Task.position, Task.created_at.desc()).limit(500))).all()
    return [await task_out(db, t) for t in rows]


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    agent = await _assignee(db, principal.workspace_id, body.assignee_agent_id)
    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == principal.workspace_id)
        )
        or 0
    )
    t = Task(
        workspace_id=principal.workspace_id,
        title=body.title.strip(),
        brief=body.brief,
        priority=body.priority,
        assignee_agent_id=agent.id if agent else None,
        branch_id=agent.branch_id if agent else None,
        requires_review=body.requires_review,
        created_by=principal.actor,
        status="ready" if agent else "triage",
        position=float(lowest) - 1,
    )
    db.add(t)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=t.id,
        after={"title": t.title, "assignee": t.assignee_agent_id},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, "created the task")
    await events.publish(principal.workspace_id, "task.created", {"task_id": t.id})
    if body.start and agent:
        await start(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


@router.get("/tasks/{task_id}")
async def task_detail(
    task_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> TaskDetailOut:
    t = await _task(db, principal.workspace_id, task_id)
    evs = (
        await db.scalars(select(TaskEvent).where(TaskEvent.task_id == t.id).order_by(TaskEvent.id))
    ).all()
    aps = (
        await db.scalars(
            select(Approval).where(Approval.task_id == t.id).order_by(Approval.created_at)
        )
    ).all()
    names = await _names(db, {e.actor for e in evs} | {a.decided_by for a in aps if a.decided_by})
    msgs = (
        await db.scalars(
            select(AgentMessage).where(AgentMessage.task_id == t.id).order_by(AgentMessage.id)
        )
    ).all()
    transcript = [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "name": m.name,
            "tool_calls": [c.get("function", {}).get("name") for c in (m.tool_calls or [])],
            "created_at": m.created_at,
            "meta": m.meta,
        }
        for m in msgs
    ]
    return TaskDetailOut(
        task=await task_out(db, t),
        events=[
            TaskEventOut(
                id=e.id,
                ts=e.ts,
                kind=e.kind,
                actor=e.actor,
                actor_name=names.get(e.actor),
                text=e.text,
                data=e.data,
            )
            for e in evs
        ],
        approvals=[await approval_out(db, a, names) for a in aps],
        transcript=transcript,
    )


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str,
    body: TaskUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal.workspace_id, task_id)
    changes = body.model_dump(exclude_unset=True)
    if "assignee_agent_id" in changes:
        if t.status in RUNNING:
            raise api_error(
                status.HTTP_409_CONFLICT, "running", "Cancel the run before reassigning."
            )
        agent = await _assignee(db, principal.workspace_id, changes["assignee_agent_id"])
        t.assignee_agent_id = agent.id if agent else None
        t.branch_id = agent.branch_id if agent else t.branch_id
    for k in ("title", "brief", "priority", "position"):
        if k in changes and changes[k] is not None:
            setattr(t, k, changes[k])
    new_status = changes.get("status")
    if new_status and new_status != t.status:
        if new_status not in MANUAL_MOVES.get(t.status, set()):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "bad_move",
                f"A {t.status} task cannot be moved to {new_status} by hand.",
            )
        await runtime.set_task_status(
            db,
            t,
            new_status,
            actor=principal.actor,
            note=f"moved it to {new_status}",
            finished_at=datetime.now(UTC) if new_status in ("done", "cancelled") else t.finished_at,
        )
        if new_status == "ready" and t.assignee_agent_id:
            await start(db, t, principal.actor)
    await db.commit()
    await db.refresh(t)
    await events.publish(
        principal.workspace_id, "task.updated", {"task_id": t.id, "status": t.status}
    )
    return await task_out(db, t)


@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal.workspace_id, task_id)
    await start(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal.workspace_id, task_id)
    if t.status in RUNNING and t.workflow_id:
        try:
            await dispatch.cancel_task(t.workflow_id)
        except Exception:  # noqa: BLE001 - workflow already gone: mark it ourselves
            await runtime.finish(t.id, "cancelled", None)
        await runtime.task_event(db, t, "cancel", principal.actor, "asked to cancel")
    elif t.status not in ("done", "cancelled"):
        await runtime.set_task_status(
            db, t, "cancelled", actor=principal.actor, note="cancelled the task"
        )
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/accept")
async def accept_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal.workspace_id, task_id)
    if t.status != "review":
        raise api_error(
            status.HTTP_409_CONFLICT, "not_in_review", "Only work in review can be accepted."
        )
    await runtime.set_task_status(
        db,
        t,
        "done",
        actor=principal.actor,
        note="accepted the result",
        finished_at=datetime.now(UTC),
    )
    await skills_store.settle(db, t.id, "accepted")
    await audit.record(db, principal.workspace_id, principal.actor, "task.accepted", target=t.id)
    await db.commit()
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/revise")
async def revise_task(
    task_id: str,
    body: ReviseIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Send work back with feedback: the agent continues the same conversation."""
    t = await _task(db, principal.workspace_id, task_id)
    if t.status not in ("review", "done", "failed"):
        raise api_error(
            status.HTTP_409_CONFLICT, "cannot_revise", "Only finished work can be sent back."
        )
    agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
    if agent is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "no_assignee", "Assign an agent first.")
    await skills_store.settle(db, t.id, "sent_back")
    db.add(
        AgentMessage(
            workspace_id=t.workspace_id,
            agent_id=agent.id,
            task_id=t.id,
            role="user",
            content=f"Feedback on your last answer: {body.feedback}",
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await runtime.task_event(db, t, "feedback", principal.actor, body.feedback[:500])
    await start(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


# ---------------------------------------------------------------- approvals


@router.get("/approvals")
async def list_approvals(
    state: str = Query(default="pending", pattern="^(pending|history)$"),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ApprovalOut]:
    q = select(Approval).where(Approval.workspace_id == principal.workspace_id)
    q = (
        q.where(Approval.status == "pending")
        if state == "pending"
        else q.where(Approval.status != "pending")
    )
    rows = (await db.scalars(q.order_by(Approval.created_at.desc()).limit(200))).all()
    names = await _names(db, {a.decided_by for a in rows if a.decided_by})
    return [await approval_out(db, a, names) for a in rows]


@router.post("/approvals/{approval_id}")
async def decide(
    approval_id: str,
    body: DecisionIn,
    principal: Principal = Depends(require("approvals.decide")),
    db: AsyncSession = Depends(get_db),
) -> ApprovalOut:
    a = await db.get(Approval, approval_id)
    if a is None or a.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "approval_not_found", "That approval is not here."
        )
    try:
        await decisions.decide(db, a, principal.actor, body.decision, body.scope, body.answer)
    except decisions.DecisionError as e:
        raise api_error(e.status, e.code, e.message) from e
    return await approval_out(db, a)
