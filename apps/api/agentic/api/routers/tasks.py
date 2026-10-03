"""Tasks (the board) and approvals (decisions agents wait on)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import decisions, dispatch, launch, runtime
from ...agents.tools import TOOLS
from ...core.db import get_db
from ...models import (
    Agent,
    AgentMessage,
    Approval,
    Meeting,
    Task,
    TaskEvent,
    User,
    WorkflowRun,
)
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
FINISHED = ("done", "failed", "cancelled")
LIST_TEXT = 400  # brief / result characters a list row carries
RETRY_CAP = 50  # failed tasks relaunched per bulk-retry call


def _clip(text: str | None) -> tuple[str | None, bool]:
    if text is None or len(text) <= LIST_TEXT:
        return text, False
    return text[:LIST_TEXT].rstrip() + "…", True


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


async def task_out(
    db: AsyncSession,
    t: Task,
    agents: dict[str, Agent] | None = None,
    pending_by_task: dict[str, int] | None = None,
    trim: bool = False,
) -> TaskOut:
    """One task. Lists pass preloaded agents and pending counts (no queries per row), and
    `trim` to cut brief and result short (the detail endpoint carries the full text)."""
    if agents is not None:
        agent = agents.get(t.assignee_agent_id or "")
    else:
        agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
    if pending_by_task is not None:
        pending = pending_by_task.get(t.id, 0)
    else:
        pending = (
            await db.scalar(
                select(func.count())
                .select_from(Approval)
                .where(Approval.task_id == t.id, Approval.status == "pending")
            )
            or 0
        )
    brief, result, cut = t.brief, t.result, False
    if trim:
        (brief_c, cut_b), (result, cut_r) = _clip(t.brief), _clip(t.result)
        brief, cut = brief_c or "", cut_b or cut_r
    return TaskOut(
        id=t.id,
        title=t.title,
        brief=brief,
        status=t.status,
        priority=t.priority,
        assignee_agent_id=t.assignee_agent_id,
        assignee_name=agent.name if agent else None,
        assignee_color=agent.color if agent else None,
        source=t.source,
        requires_review=t.requires_review,
        result=result,
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
        parent_task_id=t.parent_task_id,
        depth=t.depth,
        schedule_id=t.schedule_id,
        has_output_schema=t.output_schema is not None,
        labels=list(t.labels or []),
        branch_id=t.branch_id,
        goal=t.goal,
        goal_tries=t.goal_tries,
        truncated=cut,
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
        tool_label={"question": "Question", "budget": "More budget"}.get(a.kind)
        or (TOOLS[a.tool_name].label if a.tool_name in TOOLS else a.tool_name),
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


async def _task(db: AsyncSession, principal: Principal, task_id: str) -> Task:
    """The task, if it is in this workspace and inside the person's scope."""
    t = await db.get(Task, task_id)
    agent = await db.get(Agent, t.assignee_agent_id) if t and t.assignee_agent_id else None
    if (
        t is None
        or t.workspace_id != principal.workspace_id
        or not principal.scope.sees_task(t, agent)
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "task_not_found", "That task is not here.")
    return t


async def _assignee(db: AsyncSession, principal: Principal, agent_id: str | None) -> Agent | None:
    if not agent_id:
        return None
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_agent",
            f"Pick an agent from {principal.scope.label}.",
        )
    return a


def clean_labels(labels: list[str]) -> list[str]:
    out: list[str] = []
    for raw in labels:
        tag = " ".join(str(raw).lower().split())[:32]
        if tag and tag not in out:
            out.append(tag)
    return out[:8]


async def _attach_files(db: AsyncSession, principal: Principal, t: Task, ids: list[str]) -> None:
    """Hand files to a task (P10): the agent sees them in its brief and can read them."""
    from ...documents import service as doc_service
    from ...models import DocFile

    for fid in dict.fromkeys(ids):
        f = await db.scalar(
            doc_service.scoped(
                select(DocFile).where(
                    DocFile.id == fid, DocFile.workspace_id == principal.workspace_id
                ),
                DocFile,
                principal,
            )
        )
        if f is None:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_file", "Pick files you can see.")
        f.task_id = t.id
        if f.branch_id is None:
            f.branch_id = t.branch_id


async def start(db: AsyncSession, t: Task, actor: str) -> None:
    try:
        await launch.launch(db, t, actor)
    except launch.LaunchError as e:
        raise api_error(e.status, e.code, e.message) from e


# ---------------------------------------------------------------- tasks


@router.get("/tasks")
async def list_tasks(
    response: Response,
    status_: str | None = Query(default=None, alias="status"),
    agent_id: str | None = None,
    branch_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    before: str | None = Query(default=None, max_length=40),
    full: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskOut]:
    """The board, in board order (position, then newest). Rows carry brief and result cut to
    LIST_TEXT characters (`truncated` says so) unless `full`; GET /tasks/{id} has the full
    text. More rows than `limit`: the `X-Next-Before` header holds the cursor for the next
    page (pass it as `before`)."""
    q = select(Task).where(Task.workspace_id == principal.workspace_id)
    cond = principal.scope.task_where()
    if cond is not None:
        q = q.where(cond)
    if status_:
        q = q.where(Task.status.in_(status_.split(",")))
    if agent_id:
        q = q.where(Task.assignee_agent_id == agent_id)
    if branch_id:
        q = q.where(Task.branch_id == branch_id)
    if before:
        cur = await db.get(Task, before)
        if cur is None or cur.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid."
            )
        # Rows after the cursor in the same order: position asc, created_at desc, id asc.
        q = q.where(
            or_(
                Task.position > cur.position,
                and_(Task.position == cur.position, Task.created_at < cur.created_at),
                and_(
                    Task.position == cur.position,
                    Task.created_at == cur.created_at,
                    Task.id > cur.id,
                ),
            )
        )
    rows = list(
        (
            await db.scalars(
                q.order_by(Task.position, Task.created_at.desc(), Task.id).limit(limit + 1)
            )
        ).all()
    )
    if len(rows) > limit:
        rows = rows[:limit]
        response.headers["X-Next-Before"] = rows[-1].id
    return await tasks_out(db, rows, trim=not full)


async def tasks_out(db: AsyncSession, rows: list[Task], trim: bool = False) -> list[TaskOut]:
    """Many tasks in three queries, whatever the board size."""
    ids = [t.id for t in rows]
    agent_ids = {t.assignee_agent_id for t in rows if t.assignee_agent_id}
    agents = (
        {a.id: a for a in (await db.scalars(select(Agent).where(Agent.id.in_(agent_ids)))).all()}
        if agent_ids
        else {}
    )
    pending = (
        dict(
            (
                await db.execute(
                    select(Approval.task_id, func.count())
                    .where(Approval.task_id.in_(ids), Approval.status == "pending")
                    .group_by(Approval.task_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    return [await task_out(db, t, agents, pending, trim) for t in rows]


async def _with_workflow(db: AsyncSession, principal: Principal, wf_id: str, brief: str) -> str:
    """Add a workflow's procedure to a task's brief: the agent works through it step by step."""
    from ...models import Workflow
    from ...workflows.procedure import compile_text

    wf = await db.get(Workflow, wf_id)
    if wf is None or wf.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_workflow", "Pick a workflow you can see.")
    return (
        f'{brief.rstrip()}\n\n## Follow the workflow "{wf.name}"\n'
        "Work through these steps in order. Where a step is for a person (an approval, a "
        "decision or information only they have), ask them with ask_human and wait for the "
        "answer; where a step is another department's, ask that colleague (ask_colleague). "
        "Report what each step produced.\n\n"
        f"{compile_text(wf.name, wf.graph or {})}"
    ).strip()


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    agent = await _assignee(db, principal, body.assignee_agent_id)
    brief, labels = body.brief, list(body.labels)
    if body.workflow_id:
        brief = await _with_workflow(db, principal, body.workflow_id, brief)
        labels.append("workflow")
    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == principal.workspace_id)
        )
        or 0
    )
    t = Task(
        workspace_id=principal.workspace_id,
        title=body.title.strip(),
        brief=brief,
        priority=body.priority,
        assignee_agent_id=agent.id if agent else None,
        branch_id=agent.branch_id if agent else principal.branch_id,
        requires_review=body.requires_review,
        goal=(body.goal or "").strip() or None,
        labels=clean_labels(labels),
        created_by=principal.actor,
        status="ready" if agent else "triage",
        position=float(lowest) - 1,
    )
    db.add(t)
    await db.flush()
    await _attach_files(db, principal, t, body.file_ids)
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
    await events.publish(
        principal.workspace_id,
        "task.created",
        {"task_id": t.id, "agent_id": t.assignee_agent_id},
    )
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
    t = await _task(db, principal, task_id)
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
        children=await tasks_out(
            db,
            list(
                (
                    await db.scalars(
                        select(Task).where(Task.parent_task_id == t.id).order_by(Task.created_at)
                    )
                ).all()
            ),
        ),
        parent=await task_out(db, parent)
        if t.parent_task_id and (parent := await db.get(Task, t.parent_task_id))
        else None,
        meetings=[
            {"id": m.id, "topic": m.topic, "status": m.status, "outcome": m.outcome}
            for m in (
                await db.scalars(
                    select(Meeting).where(Meeting.task_id == t.id).order_by(Meeting.created_at)
                )
            ).all()
        ],
    )


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str,
    body: TaskUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal, task_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("labels") is not None:
        t.labels = clean_labels(changes["labels"])
    if "assignee_agent_id" in changes:
        if t.status in RUNNING:
            raise api_error(
                status.HTTP_409_CONFLICT, "running", "Cancel the run before reassigning."
            )
        agent = await _assignee(db, principal, changes["assignee_agent_id"])
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
        principal.workspace_id,
        "task.updated",
        {"task_id": t.id, "status": t.status, "agent_id": t.assignee_agent_id},
    )
    return await task_out(db, t)


@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal, task_id)
    await start(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


class RetryFailedIn(BaseModel):
    # Which failed tasks to relaunch; left out: every failed task in the person's scope that
    # failed within `since_hours`.
    task_ids: list[str] | None = Field(default=None, max_length=500)
    since_hours: int = Field(default=72, ge=1, le=24 * 90)


@router.post("/tasks/retry-failed")
async def retry_failed(
    body: RetryFailedIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Relaunch failed tasks in bulk, each exactly as the single Retry does (a fresh run of the
    same conversation). At most RETRY_CAP per call; the rest come back as skipped."""
    q = select(Task).where(Task.workspace_id == principal.workspace_id, Task.status == "failed")
    cond = principal.scope.task_where()
    if cond is not None:
        q = q.where(cond)
    if body.task_ids is not None:
        q = q.where(Task.id.in_(body.task_ids))
    else:
        since = datetime.now(UTC) - timedelta(hours=body.since_hours)
        q = q.where(func.coalesce(Task.finished_at, Task.updated_at) >= since)
    rows = list((await db.scalars(q.order_by(Task.updated_at.desc()).limit(500))).all())
    skipped: list[dict[str, str]] = []
    if body.task_ids is not None:
        found = {t.id for t in rows}
        skipped += [
            {"id": tid, "reason": "Not a failed task you can see."}
            for tid in dict.fromkeys(body.task_ids)
            if tid not in found
        ]
    retried: list[str] = []
    stop: str | None = None
    for i, t in enumerate(rows):
        if stop:
            skipped.append({"id": t.id, "reason": stop})
            continue
        if i >= RETRY_CAP:
            skipped.append({"id": t.id, "reason": f"Over {RETRY_CAP} per run: retry again."})
            continue
        agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
        if not principal.scope.sees_task(t, agent):
            skipped.append({"id": t.id, "reason": "Not a failed task you can see."})
            continue
        try:
            await launch.launch(db, t, principal.actor)
        except launch.LaunchError as e:
            skipped.append({"id": t.id, "reason": e.message})
            if e.code == "temporal_unavailable":  # the rest would fail the same way
                stop = "Not tried: the worker service is not reachable."
            continue
        retried.append(t.id)
    if retried:
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "task.retry_failed",
            after={"retried": len(retried), "skipped": len(skipped)},
        )
        await db.commit()
        await events.publish(principal.workspace_id, "task.updated", {"retried": retried})
    return {"retried": len(retried), "retried_ids": retried, "skipped": skipped}


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove finished work for good: its conversation, events, approvals and sub-tasks go
    with it (database cascades). Whoever can see the task in their scope may delete it: the
    person who asked for it, the owner of the assistant that did it, or a manager over it."""
    t = await _task(db, principal, task_id)
    if t.status not in FINISHED:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_finished",
            "Only done, failed or cancelled work can be deleted. Cancel it first.",
        )
    # Sub-tasks cascade with it: none of them may still be working.
    frontier, seen = [t.id], {t.id}
    while frontier:
        kids = (
            await db.execute(select(Task.id, Task.status).where(Task.parent_task_id.in_(frontier)))
        ).all()
        if any(s not in FINISHED for _, s in kids):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "children_active",
                "A sub-task of this work is still open. Let it finish or cancel it first.",
            )
        frontier = [k for k, _ in kids if k not in seen]
        seen.update(frontier)
    if t.workflow_run_id:
        run = await db.get(WorkflowRun, t.workflow_run_id)
        if run is not None and run.status in ("running", "waiting"):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "run_active",
                f'This is a step of the workflow run "{run.title}", which is still going.',
            )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.deleted",
        target=t.id,
        before={"title": t.title, "status": t.status, "sub_tasks": len(seen) - 1},
    )
    ws, tid, aid = t.workspace_id, t.id, t.assignee_agent_id
    await db.execute(delete(Task).where(Task.id == tid))
    await db.commit()
    await events.publish(ws, "task.deleted", {"task_id": tid, "agent_id": aid})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal, task_id)
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
    t = await _task(db, principal, task_id)
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
    await _wake_run(t)
    await db.refresh(t)
    return await task_out(db, t)


async def _wake_run(t: Task) -> None:
    """A reviewed workflow step moves its run on at once (P11), not at the next tick."""
    if not t.workflow_run_id:
        return
    try:
        await dispatch.poke_run(t.workflow_run_id)
    except Exception:  # noqa: BLE001 - the run's own tick catches up within 15 s
        return


@router.post("/tasks/{task_id}/revise")
async def revise_task(
    task_id: str,
    body: ReviseIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Send work back with feedback: the agent continues the same conversation."""
    t = await _task(db, principal, task_id)
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
    cond = principal.scope.approval_where()
    if cond is not None:
        q = q.where(cond)
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
    asker = await db.get(Agent, a.agent_id) if a is not None else None
    if (
        a is None
        or a.workspace_id != principal.workspace_id
        or not principal.scope.sees_agent(asker)
    ):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "approval_not_found", "That approval is not here."
        )
    try:
        await decisions.decide(db, a, principal.actor, body.decision, body.scope, body.answer)
    except decisions.DecisionError as e:
        raise api_error(e.status, e.code, e.message) from e
    return await approval_out(db, a)
