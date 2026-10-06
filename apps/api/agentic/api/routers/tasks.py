"""Tasks (the board) and approvals (decisions agents wait on)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import decisions, dispatch, launch, runtime
from ...agents.tools import TOOLS
from ...core.db import get_db
from ...i18n import render, tr
from ...i18n.labels import task_status_label
from ...models import (
    Agent,
    AgentMessage,
    Approval,
    Blueprint,
    Department,
    Meeting,
    Objective,
    Task,
    TaskEvent,
    User,
    WorkflowRun,
)
from ...services import audit, events
from ...skills import store as skills_store
from ...teams import blockers, objectives, reconcile, review
from .. import paging
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
from .files import FileOut, file_out

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
# Board order (position, then newest), id as the tie-break: what list pages walk.
TASK_ORDER: paging.Order = ((Task.position, False), (Task.created_at, True), (Task.id, False))
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
    fill: bool = True,
) -> TaskOut:
    """One task. Lists pass preloaded agents and pending counts (no queries per row), and
    `trim` to cut brief and result short (the detail endpoint carries the full text).
    `fill=False`: the caller fills the P21 fields for many rows at once (fill_accountable)."""
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
    out = TaskOut(
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
        position=float(t.position or 0),
        goal=t.goal,
        goal_tries=t.goal_tries,
        truncated=cut,
        objective_id=t.objective_id,
        root_task_id=t.root_task_id or t.id,
        visibility=t.visibility or "private",
    )
    if fill:
        await fill_accountable(db, [t], [out])
    return out


async def fill_accountable(db: AsyncSession, rows: list[Task], outs: list[TaskOut]) -> None:
    """P21: who moves each task next, what it waits for, and its review round (2 queries)."""
    waits = await blockers.open_map(db, [t.id for t in rows if t.status in blockers.ADDABLE])
    owners = await _names(db, {t.blocked_owner for t in rows if t.blocked_owner})
    for t, out in zip(rows, outs, strict=True):
        out.blocked_owner = t.blocked_owner
        out.blocked_owner_name = owners.get(t.blocked_owner or "")
        out.blocked_action = t.blocked_action
        out.waiting_for = [
            {"id": b.id, "title": b.title, "status": b.status} for b in waits.get(t.id, [])
        ]
        out.restartable = launch.restartable(t)
        out.review_round = t.review_round or 0


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


SHARERS = ("agents.manage", "team.manage", "org.manage")


def _check_share(principal: Principal, visibility: str | None) -> None:
    """P26: only managers and owners decide who else may look at a task."""
    if (
        visibility
        and visibility != "private"
        and not any(p in principal.permissions for p in SHARERS)
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "cannot_share",
            "Only managers and owners choose who else may see a task.",
        )


async def _assignee(db: AsyncSession, principal: Principal, agent_id: str | None) -> Agent | None:
    if not agent_id:
        return None
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_agent",
            "Pick an agent from {where}.",
            where=principal.scope.label,
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
    cursor: str | None = Query(default=None, max_length=400),
    q_: str = Query(default="", alias="q", max_length=120),
    full: bool = False,
    who: str | None = Query(default=None, pattern="^(mine|pinned)$"),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskOut]:
    """The board, in board order (position, then newest). Rows carry brief and result cut to
    LIST_TEXT characters (`truncated` says so) unless `full`; GET /tasks/{id} has the full
    text. More rows than `limit`: `X-Next-Cursor` holds the token for the next page (pass it
    as `cursor`); `X-Next-Before` keeps the older id form (pass it as `before`). P26 `who`:
    mine (tasks the person gave or their own AI workers do, with their sub-tasks) or pinned
    (the cards pinned to their workspace)."""
    q = select(Task).where(Task.workspace_id == principal.workspace_id)
    cond = principal.scope.task_where()
    if cond is not None:
        shared = principal.scope.shared_task_where()
        q = q.where(or_(cond, shared) if shared is not None else cond)
    if status_:
        q = q.where(Task.status.in_(status_.split(",")))
    if agent_id:
        q = q.where(Task.assignee_agent_id == agent_id)
    if branch_id:
        q = q.where(Task.branch_id == branch_id)
    if who == "mine":
        own = select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id,
            Agent.owner_user_id == principal.user.id,
        )
        given = select(Task.id).where(
            Task.workspace_id == principal.workspace_id, Task.created_by == principal.actor
        )
        q = q.where(
            or_(
                Task.created_by == principal.actor,
                Task.assignee_agent_id.in_(own),
                Task.root_task_id.in_(given),
            )
        )
    elif who == "pinned":
        from ...models import DeskItem

        pinned = select(DeskItem.ref).where(
            DeskItem.user_id == principal.user.id, DeskItem.kind == "task"
        )
        q = q.where(Task.id.in_(pinned))
    if q_.strip():
        like = f"%{q_.strip()}%"
        named = select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id, Agent.name.ilike(like)
        )
        q = q.where(
            or_(
                Task.title.ilike(like),
                Task.brief.ilike(like),
                cast(Task.labels, String).ilike(like),
                Task.assignee_agent_id.in_(named),
            )
        )
    if before and not cursor:
        cur = await db.get(Task, before)
        if cur is None or cur.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid."
            )
        cursor = paging.cursor_for(cur, TASK_ORDER)
    rows = await paging.paginate(db, q, TASK_ORDER, limit=limit, cursor=cursor, response=response)
    if paging.NEXT in response.headers:
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
    out = [await task_out(db, t, agents, pending, trim, fill=False) for t in rows]
    await fill_accountable(db, rows, out)
    # P21: the objective chip on board cards (one query for the whole page).
    names = await objectives.titles(db, {t.objective_id for t in rows if t.objective_id})
    for o in out:
        o.objective_title = names.get(o.objective_id or "")
    return out


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
    _check_share(principal, body.visibility)
    agent = await _assignee(db, principal, body.assignee_agent_id)
    brief, labels = body.brief, list(body.labels)
    if body.workflow_id:
        brief = await _with_workflow(db, principal, body.workflow_id, brief)
        labels.append("workflow")
    objective_id = await _objective(
        db, principal, body.objective_id, agent.branch_id if agent else principal.branch_id
    )
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
        objective_id=objective_id,
        visibility=body.visibility,
    )
    db.add(t)
    await db.flush()
    t.root_task_id = t.id  # P21: a person's task starts its own request
    await _attach_files(db, principal, t, body.file_ids)
    if body.review_policy is not None:  # P21: this task's own review stages
        t.review_policy = await _policy(db, principal, body.review_policy, empty_is_off=True)
    if body.blocked_by:  # P21: start only when these are done
        await _add_blockers(db, principal, t, body.blocked_by)
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
    if body.blocked_by:
        await blockers.refresh(db, t, principal.actor, start=bool(body.start and agent))
    elif body.start and agent:
        await start(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


async def _shared_detail(db: AsyncSession, t: Task) -> TaskDetailOut:
    """P26: what someone a task was shared with may see: the task and its timeline, not the
    agent's transcript or approvals (they can hold what the files it read said)."""
    evs = (
        await db.scalars(
            select(TaskEvent)
            .where(TaskEvent.task_id == t.id, TaskEvent.kind.in_(SHARED_EVENTS))
            .order_by(TaskEvent.id)
        )
    ).all()
    names = await _names(db, {e.actor for e in evs})
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
                data={},
            )
            for e in evs
        ],
        approvals=[],
        transcript=[],
        read_only=True,
    )


# What a shared viewer sees of the timeline: who did what to the task, not tool calls.
SHARED_EVENTS = ("created", "status", "run", "progress", "plan", "feedback", "cancel")


@router.get("/tasks/{task_id}")
async def task_detail(
    task_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> TaskDetailOut:
    try:
        t = await _task(db, principal, task_id)
    except HTTPException:
        shared = await db.get(Task, task_id)
        agent = (
            await db.get(Agent, shared.assignee_agent_id)
            if shared and shared.assignee_agent_id
            else None
        )
        if (
            shared is None
            or shared.workspace_id != principal.workspace_id
            or not principal.scope.shares_task(shared, agent)
        ):
            raise
        return await _shared_detail(db, shared)
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
    detail = TaskDetailOut(
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
        objective=await _objective_brief(db, t),
        request=await objectives.request_cost(db, t),
        **(await _accountable_detail(db, t, list(evs))),
    )
    detail.task.quiet_minutes = await reconcile.quiet_minutes(db, t)  # P21: a silent run
    return detail


async def _objective_brief(db: AsyncSession, t: Task) -> dict | None:
    """P21: the objective a task serves, for the task sheet."""
    ob = await db.get(Objective, t.objective_id) if t.objective_id else None
    if ob is None or ob.workspace_id != t.workspace_id:
        return None
    parent = await db.get(Objective, ob.parent_id) if ob.parent_id else None
    return {
        "id": ob.id,
        "title": ob.title,
        "target": ob.target,
        "status": ob.status,
        "parent_title": parent.title if parent else None,
    }


async def _objective(
    db: AsyncSession, principal: Principal, objective_id: str | None, branch_id: str | None
) -> str | None:
    """P21: an objective the person may link this task to (or None to leave it unlinked)."""
    if not objective_id:
        return None
    ob = await objectives.linkable(
        db, principal.workspace_id, principal.scope, objective_id, branch_id
    )
    if isinstance(ob, str):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_objective", ob)
    return ob.id


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: str,
    body: TaskUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    t = await _task(db, principal, task_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("visibility"):
        _check_share(principal, "shared" if changes["visibility"] != t.visibility else None)
        t.visibility = changes["visibility"]
    if changes.get("labels") is not None:
        t.labels = clean_labels(changes["labels"])
    if "assignee_agent_id" in changes:
        if t.status in RUNNING and not launch.restartable(t):  # P21: parked work may move
            raise api_error(
                status.HTTP_409_CONFLICT, "running", "Cancel the run before reassigning."
            )
        agent = await _assignee(db, principal, changes["assignee_agent_id"])
        t.assignee_agent_id = agent.id if agent else None
        t.branch_id = agent.branch_id if agent else t.branch_id
    for k in ("title", "brief", "priority", "position"):
        if k in changes and changes[k] is not None:
            setattr(t, k, changes[k])
    if "objective_id" in changes and changes["objective_id"] != t.objective_id:
        old = t.objective_id
        t.objective_id = await _objective(db, principal, changes["objective_id"], t.branch_id)
        await objectives.relink_tree(db, t, old, t.objective_id)  # its parts follow it
    new_status = changes.get("status")
    if new_status and new_status != t.status:
        if new_status not in MANUAL_MOVES.get(t.status, set()):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "bad_move",
                "A {status} task cannot be moved to {new_status} by hand.",
                status=task_status_label(t.status),
                new_status=task_status_label(new_status),
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
            # P21: work that waits for other tasks parks instead of starting.
            if await blockers.refresh(db, t, principal.actor) == "unchanged":
                await start(db, t, principal.actor)
        if new_status in FINISHED:
            await blockers.on_finished(db, t)
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


class AttachIn(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=20)


async def _files_note(db: AsyncSession, t: Task, ids: list[str]) -> None:
    """Files given to a task whose agent already started: a note at the end of its
    conversation, so its next run (send back, retry) knows them. Never in the middle of a
    run, nor after a tool call still waiting for its answer (it would break the turn)."""
    from ...documents import service as doc_service
    from ...models import DocFile, Workspace

    last = await db.scalar(
        select(AgentMessage)
        .where(AgentMessage.task_id == t.id)
        .order_by(AgentMessage.id.desc())
        .limit(1)
    )
    if last is None or t.status in RUNNING or (last.role == "assistant" and last.tool_calls):
        return  # not started: the first message lists every file (runtime)
    ws = await db.get(Workspace, t.workspace_id)
    today = doc_service.today_in(ws.timezone if ws else None)
    files = (await db.scalars(select(DocFile).where(DocFile.id.in_(ids)))).all()
    lines = "\n".join(doc_service.file_line(f, today) for f in files)
    db.add(
        AgentMessage(
            workspace_id=t.workspace_id,
            agent_id=last.agent_id,
            task_id=t.id,
            role="user",
            content=f"Files added to this task (read them with read_file):\n{lines}",
            created_at=datetime.now(UTC),
        )
    )


@router.post("/tasks/{task_id}/files")
async def attach_files(
    task_id: str,
    body: AttachIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> list[FileOut]:
    """Give files to a task after it was made (P10 file_ids on create, later). The agent
    reads them with read_file; see _files_note for how a started agent hears of them."""
    from ...models import DocFile

    t = await _task(db, principal, task_id)
    ids = list(dict.fromkeys(body.file_ids))
    await _attach_files(db, principal, t, ids)
    await _files_note(db, t, ids)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.files_attached",
        target=t.id,
        after={"file_ids": ids},
    )
    await db.commit()
    files = (await db.scalars(select(DocFile).where(DocFile.id.in_(ids)))).all()
    names = ", ".join(f.name for f in files)
    await runtime.task_event(
        db, t, "files", principal.actor, f"attached {names}"[:500], {"file_ids": ids}
    )
    return [await file_out(db, f) for f in files]


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
            {"id": tid, "reason": tr("Not a failed task you can see.")}
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
            skipped.append(
                {"id": t.id, "reason": tr("Over {n} per run: retry again.", n=RETRY_CAP)}
            )
            continue
        agent = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
        if not principal.scope.sees_task(t, agent):
            skipped.append({"id": t.id, "reason": tr("Not a failed task you can see.")})
            continue
        try:
            await launch.launch(db, t, principal.actor)
        except launch.LaunchError as e:
            skipped.append({"id": t.id, "reason": render(e.message)})
            if e.code == "temporal_unavailable":  # the rest would fail the same way
                stop = tr("Not tried: the worker service is not reachable.")
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
                'This is a step of the workflow run "{title}", which is still going.',
                title=run.title,
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
    if t.status in RUNNING and t.workflow_id and not launch.restartable(t):
        try:
            await dispatch.cancel_task(t.workflow_id)
        except Exception:  # noqa: BLE001 - workflow already gone: mark it ourselves
            await runtime.finish(t.id, "cancelled", None)
        await runtime.task_event(db, t, "cancel", principal.actor, "asked to cancel")
    elif t.status not in ("done", "cancelled"):
        await _stop_reviews(db, t)
        await runtime.set_task_status(
            db, t, "cancelled", actor=principal.actor, note="cancelled the task"
        )
        await blockers.on_finished(db, t)  # P21: work waiting for it goes to its owner
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
    await _stop_reviews(db, t)  # P21: a person's acceptance ends any agent review
    await blockers.on_finished(db, t)  # P21: start the work that waited for this
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
    await _stop_reviews(db, t)
    t.review_round = 0  # P21: a person's feedback starts a fresh review cycle
    try:
        await launch.send_back(db, t, agent, body.feedback, principal.actor)
    except launch.LaunchError as e:
        raise api_error(e.status, e.code, e.message) from e
    await db.refresh(t)
    return await task_out(db, t)


async def _stop_reviews(db: AsyncSession, t: Task) -> None:
    """P21: a person acted on work an agent was reviewing: stop that review task."""
    open_reviews = (
        await db.scalars(
            select(Task).where(
                Task.parent_task_id == t.id,
                Task.source == "review",
                Task.status.in_(("triage", "ready", "running", "blocked")),
            )
        )
    ).all()
    for r in open_reviews:
        if r.status in RUNNING and r.workflow_id:
            try:
                await dispatch.cancel_task(r.workflow_id)
                continue
            except Exception:  # noqa: BLE001 - its run is gone: mark it ourselves
                await runtime.task_event(db, r, "cancel", "system", "its run was already gone")
        await runtime.set_task_status(db, r, "cancelled", note="a person decided first")


# ---------------------------------------------------------------- approvals


@router.get("/approvals")
async def list_approvals(
    response: Response,
    state: str = Query(default="pending", pattern="^(pending|history)$"),
    status_: str | None = Query(default=None, alias="status", max_length=80),
    limit: int = Query(default=200, ge=1, le=paging.MAX_LIMIT),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ApprovalOut]:
    """Newest first. History pages with `limit` + `cursor` (X-Next-Cursor); `status` narrows
    history to some outcomes (comma list, e.g. approved,denied)."""
    q = select(Approval).where(Approval.workspace_id == principal.workspace_id)
    cond = principal.scope.approval_where()
    if cond is not None:
        q = q.where(cond)
    q = (
        q.where(Approval.status == "pending")
        if state == "pending"
        else q.where(Approval.status != "pending")
    )
    if status_ and state == "history":
        q = q.where(Approval.status.in_(status_.split(",")))
    rows = await paging.paginate(
        db,
        q,
        ((Approval.created_at, True), (Approval.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
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


# ---------------------------------------------------------------- P21 accountable work


class BlockersIn(BaseModel):
    task_ids: list[str] = Field(min_length=1, max_length=20)


class ReviewPolicyIn(BaseModel):
    # {stages: [{type: agent, agent_id} | {type: human}], max_rounds}; null or no stages = off.
    review_policy: dict | None = None


async def _add_blockers(db: AsyncSession, principal: Principal, t: Task, ids: list[str]) -> int:
    """Blockers must be tasks the person can see; the rest is checked in teams/blockers."""
    for bid in dict.fromkeys(ids):
        b = await db.get(Task, bid)
        agent = await db.get(Agent, b.assignee_agent_id) if b and b.assignee_agent_id else None
        if (
            b is None
            or b.workspace_id != principal.workspace_id
            or not principal.scope.sees_task(b, agent)
        ):
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_blocker", "Pick tasks you can see to wait for."
            )
    try:
        return await blockers.add(db, t, ids)
    except blockers.BlockerError as e:
        raise api_error(e.status, e.code, e.message) from e


async def _policy(
    db: AsyncSession, principal: Principal, raw: dict | None, *, empty_is_off: bool = False
) -> dict | None:
    try:
        clean = await review.validate(db, principal.workspace_id, raw)
    except review.PolicyError as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_review_policy", str(e)) from e
    if clean is None and empty_is_off and raw is not None:
        return {"stages": [], "max_rounds": review.DEFAULT_ROUNDS}  # off for this task
    return clean


def _brief(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "status": t.status,
        "assignee_agent_id": t.assignee_agent_id,
    }


async def _accountable_detail(db: AsyncSession, t: Task, evs: list[TaskEvent]) -> dict:
    """The task sheet's P21 parts: what it waits for, what waits for it, its review trail
    and the review stages that apply."""
    policy = await review.effective_policy(db, t)
    names: dict[str, str] = {}
    if policy:
        ids = [s["agent_id"] for s in policy["stages"] if s["type"] == "agent"]
        if ids:
            rows = (await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(ids)))).all()
            names = {aid: name for aid, name in rows}
    return {
        "blockers": [_brief(b) for b in await blockers.blockers_of(db, t.id)],
        "blocking": [_brief(w) for w in await blockers.waiting_on(db, t.id)],
        "reviews": review.trail(evs),
        "review_policy": {**policy, "summary": review.describe(policy, names)} if policy else None,
    }


@router.post("/tasks/{task_id}/blockers")
async def add_blockers(
    task_id: str,
    body: BlockersIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Make a not-yet-started task wait for others: it parks in `blocked` ("Waiting for ...")
    and starts by itself when they are all done. Refuses loops (409 blocker_cycle)."""
    t = await _task(db, principal, task_id)
    if await _add_blockers(db, principal, t, body.task_ids):
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "task.blockers_added",
            target=t.id,
            after={"blocked_by": body.task_ids},
        )
        await db.commit()
        await runtime.task_event(
            db,
            t,
            "blockers",
            principal.actor,
            f"made it wait for {len(body.task_ids)} task(s)",
            {"added": body.task_ids},
        )
        # Parks it (or routes it); a queued task whose blockers are all done stays queued.
        await blockers.refresh(db, t, principal.actor, start=False)
    await db.refresh(t)
    return await task_out(db, t)


@router.delete("/tasks/{task_id}/blockers/{blocker_id}")
async def remove_blocker(
    task_id: str,
    blocker_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Stop waiting for one task. With nothing left to wait for, a parked task starts."""
    t = await _task(db, principal, task_id)
    if not await blockers.remove(db, t, blocker_id):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "blocker_not_found", "This task does not wait for that one."
        )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.blocker_removed",
        target=t.id,
        after={"blocker": blocker_id},
    )
    await db.commit()
    await runtime.task_event(
        db, t, "blockers", principal.actor, "stopped waiting for a task", {"removed": blocker_id}
    )
    await blockers.refresh(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


@router.put("/tasks/{task_id}/review-policy")
async def set_task_review_policy(
    task_id: str,
    body: ReviewPolicyIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """This task's own review stages; null goes back to the blueprint's or department's,
    {"stages": []} switches review off for it."""
    t = await _task(db, principal, task_id)
    t.review_policy = await _policy(db, principal, body.review_policy, empty_is_off=True)
    await db.commit()
    await db.refresh(t)
    return await task_out(db, t)


async def _department(db: AsyncSession, principal: Principal, dept_id: str) -> Department:
    d = await db.get(Department, dept_id)
    if d is None or d.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "department_not_found", "That department is not here."
        )
    return d


async def _blueprint(db: AsyncSession, principal: Principal, blueprint_id: str) -> Blueprint:
    bp = await db.get(Blueprint, blueprint_id)
    if bp is None or bp.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "blueprint_not_found", "That blueprint is not here."
        )
    return bp


@router.get("/departments/{dept_id}/review-policy")
async def get_department_review_policy(
    dept_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ReviewPolicyIn:
    d = await _department(db, principal, dept_id)
    return ReviewPolicyIn(review_policy=review.normalize(d.review_policy))


@router.put("/departments/{dept_id}/review-policy")
async def set_department_review_policy(
    dept_id: str,
    body: ReviewPolicyIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> ReviewPolicyIn:
    """Review stages for the department's top-level work (off by default)."""
    d = await _department(db, principal, dept_id)
    before = d.review_policy
    d.review_policy = await _policy(db, principal, body.review_policy)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "department.review_policy",
        target=d.id,
        before={"review_policy": before},
        after={"review_policy": d.review_policy},
    )
    await db.commit()
    return ReviewPolicyIn(review_policy=d.review_policy)


@router.get("/blueprints/{blueprint_id}/review-policy")
async def get_blueprint_review_policy(
    blueprint_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ReviewPolicyIn:
    bp = await _blueprint(db, principal, blueprint_id)
    return ReviewPolicyIn(review_policy=review.normalize(bp.review_policy))


@router.put("/blueprints/{blueprint_id}/review-policy")
async def set_blueprint_review_policy(
    blueprint_id: str,
    body: ReviewPolicyIn,
    principal: Principal = Depends(require("agents.manage")),
    db: AsyncSession = Depends(get_db),
) -> ReviewPolicyIn:
    """Review stages for work done by agents made from this blueprint (wins over the
    department's)."""
    bp = await _blueprint(db, principal, blueprint_id)
    before = bp.review_policy
    bp.review_policy = await _policy(db, principal, body.review_policy)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "blueprint.review_policy",
        target=bp.id,
        before={"review_policy": before},
        after={"review_policy": bp.review_policy},
    )
    await db.commit()
    return ReviewPolicyIn(review_policy=bp.review_policy)
