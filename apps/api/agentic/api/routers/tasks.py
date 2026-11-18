"""Tasks (the board) and approvals (decisions agents wait on)."""

import contextlib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import String, and_, cast, delete, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import decisions, dispatch, launch, runtime
from ...agents.tools import TOOLS
from ...core.db import get_db
from ...core.security import can
from ...i18n import Msg, render, tr
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
from ...services import audit, events, task_mail
from ...skills import store as skills_store
from ...teams import allowance, blockers, objectives, people, reconcile, review, task_parts
from ...teams.task_models import ASSIGNEE, WATCHER, TaskAttachment, TaskChecklistItem
from .. import paging
from ..agent_schemas import (
    ApprovalOut,
    DecisionIn,
    ReviseIn,
    SubtaskIn,
    TaskDetailOut,
    TaskEventOut,
    TaskIn,
    TaskOut,
    TaskUpdateIn,
)
from ..deps import Principal, api_error, ensure_work_scope, require
from ..table import TableParams, like, sql_page
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
        assignee_user_id=t.assignee_user_id,
        due_at=t.due_at,
        start_at=t.start_at,
        category=t.category,
    )
    if fill:
        await fill_accountable(db, [t], [out])
        await fill_people(db, [t], [out])
    return out


async def fill_people(db: AsyncSession, rows: list[Task], outs: list[TaskOut]) -> None:
    """P97: the person each task is for and who gave it, by name (one query)."""
    ids = {t.assignee_user_id for t in rows if t.assignee_user_id}
    ids |= {g for t in rows if (g := people.giver_id(t))}
    # P109: everyone each task is for and who follows it, and the card's counts (3 queries).
    on = await task_parts.people_of(db, [t.id for t in rows])
    ids |= {r.user_id for rs in on.values() for r in rs}
    counts = await task_parts.card_counts(db, [t.id for t in rows])
    # P114: whose request each agent task is (their allowance pays) and whose AI does it.
    agent_tasks = [t for t in rows if t.assignee_agent_id]
    for_whom = await allowance.people_of_tasks(db, agent_tasks) if agent_tasks else {}
    owners: dict[str, str] = {}
    if agent_tasks:
        owners = {
            a: o
            for a, o in (
                await db.execute(
                    select(Agent.id, Agent.owner_user_id).where(
                        Agent.id.in_({t.assignee_agent_id for t in agent_tasks})
                    )
                )
            ).all()
            if o
        }
    ids |= {u for u in for_whom.values() if u} | set(owners.values())
    known = await people.names(db, ids)
    for t, out in zip(rows, outs, strict=True):
        out.assignee_user_name = known.get(t.assignee_user_id or "")
        out.created_by_name = known.get(people.giver_id(t) or "")
        if t.assignee_agent_id:
            out.for_user_id = for_whom.get(t.id)
            out.for_user_name = known.get(out.for_user_id or "")
            out.assignee_owner_id = owners.get(t.assignee_agent_id)
            out.assignee_owner_name = known.get(out.assignee_owner_id or "")
        rs = on.get(t.id, [])
        doers = task_parts.by_role(rs, ASSIGNEE)
        if t.assignee_user_id:
            doers = [t.assignee_user_id, *[u for u in doers if u != t.assignee_user_id]]
        out.assignees = [{"user_id": u, "name": known.get(u, "")} for u in doers]
        out.watchers = [
            {"user_id": u, "name": known.get(u, "")} for u in task_parts.by_role(rs, WATCHER)
        ]
        c = counts.get(t.id, {})
        out.checklist_done, out.checklist_total = c.get("check_done", 0), c.get("check_total", 0)
        out.subtasks_done, out.subtasks_total = c.get("sub_done", 0), c.get("sub_total", 0)
        out.files_count = c.get("files", 0)


def people_error(e: people.PeopleError) -> HTTPException:
    return api_error(e.status, e.code, e.message)


async def people_event(db: AsyncSession, t: Task, actor: str, **extra: Any) -> dict[str, Any]:
    """P109: a live event about a person's task that reaches everyone on it (assignees and
    watchers), whoever gave it and the managers of its assignees (scope.event_visible)."""
    rows = (await task_parts.people_of(db, [t.id])).get(t.id, [])
    return people.event_data(
        t,
        actor,
        people=[r.user_id for r in rows],
        assignees=task_parts.by_role(rows, ASSIGNEE),
        giver=people.giver_id(t),
        **extra,
    )


async def tell_assigned(
    db: AsyncSession, principal: Principal, t: Task, user_ids: list[str]
) -> None:
    """P109: each new assignee hears of the task (the bell and their phone, people.notify)
    and gets an email with the link when the office's system mail is set up. Never the
    person who gave it."""
    me = principal.user.id
    for uid in dict.fromkeys(user_ids):
        if uid and uid != me:
            await people.notify(
                db,
                t,
                uid,
                Msg("New task for you: {title}", title=t.title[:100]),
                Msg("{name} gave you a task. Open it to accept it.", name=principal.user.name),
                f"assigned:{t.id}:{uid}",
            )
    task_mail.tell_by_email(principal.workspace_id, t.id, user_ids, me)


async def link_files(db: AsyncSession, principal: Principal, t: Task, ids: list[str]) -> None:
    """P109: files for a person's task. A file of the person's own (no task yet) moves onto
    the task, so everyone on it can open it; a Library guideline or another task's file is
    only linked (it stays where it is)."""
    from ...documents import service as doc_service
    from ...models import DocFile

    have = set(
        (
            await db.scalars(select(TaskAttachment.file_id).where(TaskAttachment.task_id == t.id))
        ).all()
    )
    for fid in dict.fromkeys(ids):
        f = await db.scalar(
            doc_service.visible_files(
                select(DocFile).where(
                    DocFile.id == fid, DocFile.workspace_id == principal.workspace_id
                ),
                principal,
            )
        )
        if f is None:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_file", "Pick files you can see.")
        if not f.task_id and not f.library:
            f.task_id = t.id
            if f.branch_id is None:
                f.branch_id = t.branch_id
        if fid not in have:
            db.add(TaskAttachment(task_id=t.id, file_id=fid, added_by=principal.actor))
            have.add(fid)
    await db.flush()


async def checklist_out(db: AsyncSession, t: Task) -> list[dict[str, Any]]:
    """P109: the task's checklist in order, with who ticked each item."""
    items = (
        await db.scalars(
            select(TaskChecklistItem)
            .where(TaskChecklistItem.task_id == t.id)
            .order_by(TaskChecklistItem.position, TaskChecklistItem.created_at)
        )
    ).all()
    names = await _names(db, {i.done_by for i in items if i.done_by})
    return [
        {
            "id": i.id,
            "text": i.text,
            "done": i.done,
            "position": i.position,
            "done_by_name": names.get(i.done_by or ""),
            "done_at": i.done_at.isoformat() if i.done_at else None,
        }
        for i in items
    ]


def _check_dates(start_at: datetime | None, due_at: datetime | None) -> None:
    if start_at and due_at and start_at > due_at:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "start_after_due",
            "The start is after the due date.",
        )


async def _add_checklist(db: AsyncSession, t: Task, items: list[str], actor: str) -> None:
    """P109: checklist items in the order given (blank ones skipped)."""
    last = await db.scalar(
        select(func.max(TaskChecklistItem.position)).where(TaskChecklistItem.task_id == t.id)
    )
    pos = float(last or 0)
    for raw in items:
        text = " ".join(str(raw).split())[:300]
        if text:
            pos += 1
            db.add(TaskChecklistItem(task_id=t.id, text=text, position=pos, created_by=actor))
    await db.flush()


async def new_subtask(db: AsyncSession, principal: Principal, parent: Task, s: SubtaskIn) -> Task:
    """P109: a sub-task of a person's task: its own person's task under it (same company,
    labels and visibility). Its person: the one named (who the actor may give work to), else
    the parent's first assignee when the actor may give them work, else the actor."""
    who = s.assignee_user_id
    if not who:
        who = principal.user.id
        if parent.assignee_user_id and parent.assignee_user_id != who:
            with contextlib.suppress(people.PeopleError):
                await people.may_assign(db, people.actor_of(principal), parent.assignee_user_id)
                who = parent.assignee_user_id
    person = await _person(db, principal, who)
    if person is None:  # never: `who` is always someone
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_person", "Pick someone who is a member here."
        )
    _check_dates(None, s.due_at)
    kid = Task(
        workspace_id=principal.workspace_id,
        title=s.title.strip()[:200],
        brief="",
        priority=parent.priority,
        assignee_user_id=person.user_id,
        branch_id=parent.branch_id or person.branch_id,
        requires_review=parent.requires_review,
        labels=list(parent.labels or []),
        created_by=principal.actor,
        source="subtask",
        status="ready" if person.user_id == principal.user.id else "triage",
        parent_task_id=parent.id,
        depth=(parent.depth or 0) + 1,
        root_task_id=parent.root_task_id or parent.id,
        objective_id=parent.objective_id,
        visibility=parent.visibility or "private",
        due_at=s.due_at,
        category=parent.category,
        position=float(parent.position or 0),
    )
    db.add(kid)
    await db.flush()
    await task_parts.set_people(db, kid, [person.user_id], None, principal.actor)
    return kid


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
        or not (
            principal.scope.sees_task(t, agent)
            # P109: a person's task they are on (assignee or watcher) or follow down their line
            or (t.assignee_agent_id is None and await task_parts.sees_by_chain(db, principal, t))
        )
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


def _guard_personal_instruction(principal: Principal, agent: Agent | None) -> None:
    """P51: only the owner may put new instructions into their own AI (a twin or private
    assistant), so a manager who can see the task cannot steer it into using the owner's
    mail, PC or Teams. They can still see, cancel, reassign or delete the work."""
    if (
        agent is not None
        and agent.owner_user_id
        and (agent.is_twin or agent.private)
        and agent.owner_user_id != principal.user.id
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "not_your_ai",
            "Only the person this AI belongs to can set or change its instructions.",
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


async def _person(db: AsyncSession, principal: Principal, user_id: str | None):
    """P97: the member a task may be given to (teams/people.py may_assign), or None."""
    if not user_id:
        return None
    try:
        return await people.may_assign(db, people.actor_of(principal), user_id)
    except people.PeopleError as e:
        raise people_error(e) from e


def clean_labels(labels: list[str]) -> list[str]:
    out: list[str] = []
    for raw in labels:
        tag = " ".join(str(raw).lower().split())[:32]
        if tag and tag not in out:
            out.append(tag)
    return out[:8]


async def _attach_files(db: AsyncSession, principal: Principal, t: Task, ids: list[str]) -> None:
    """Hand files to a task (P10): the agent sees them in its brief and can read them. A file
    another task made or fetched stays with that task (its "By task" files stay whole); this
    task's brief names it instead."""
    from ...documents import service as doc_service
    from ...models import DocFile

    borrowed: list[str] = []
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
        if f.task_id and f.task_id != t.id:
            borrowed.append(f"- [{f.id}] {f.name}")
            continue
        f.task_id = t.id
        if f.branch_id is None:
            f.branch_id = t.branch_id
    if borrowed and not all(line in (t.brief or "") for line in borrowed):
        t.brief = (
            (t.brief or "").rstrip()
            + "\n\nFiles for this task (from other work; read them with read_file):\n"
            + "\n".join(line for line in borrowed if line not in (t.brief or ""))
        )


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
    who: str | None = Query(default=None, pattern="^(mine|pinned|assigned|team|created|watching)$"),
    assignee: str | None = Query(default=None, max_length=60),
    has_due: bool = False,
    kind: str | None = Query(default=None, pattern="^(people|ai)$"),
    label: str | None = Query(default=None, max_length=32),
    due_from: datetime | None = None,
    due_to: datetime | None = None,
    span_from: datetime | None = None,
    span_to: datetime | None = None,
    top: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskOut]:
    """The board, in board order (position, then newest). Rows carry brief and result cut to
    LIST_TEXT characters (`truncated` says so) unless `full`; GET /tasks/{id} has the full
    text. More rows than `limit`: `X-Next-Cursor` holds the token for the next page (pass it
    as `cursor`); `X-Next-Before` keeps the older id form (pass it as `before`). P26 `who`:
    mine (tasks the person gave or their own AI workers do, with their sub-tasks) or pinned
    (the cards pinned to their workspace). P97: `who` assigned (tasks given to the person
    themselves) or team (their people's tasks and their people's and department's agents'
    tasks); `assignee` one person (user:<id>) or agent (agent:<id>), or people / agents /
    none; `has_due` only tasks with a due date, soonest first. P109: `who` created (tasks
    they gave) or watching (tasks they follow); `kind` people or ai; `label` one label;
    `due_from`/`due_to` a due range; `span_from`/`span_to` tasks whose start-to-due span
    touches that range (calendar, Gantt); `top` leaves sub-tasks out."""
    q = select(Task).where(Task.workspace_id == principal.workspace_id)
    cond = principal.scope.task_where()
    if cond is not None:
        shared = principal.scope.shared_task_where()
        chain = await task_parts.chain_where(db, principal)  # P109: down a manager's line
        q = q.where(or_(*[c for c in (cond, shared, chain) if c is not None]))
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
    elif who == "assigned":
        q = q.where(task_parts.assigned_to([principal.user.id]))
    elif who == "created":
        q = q.where(Task.created_by == principal.actor)
    elif who == "watching":
        q = q.where(Task.id.in_(task_parts.people_task_ids([principal.user.id], WATCHER)))
    elif who == "team":
        q = q.where(await _team_where(db, principal))
    elif who == "pinned":
        from ...models import DeskItem

        pinned = select(DeskItem.ref).where(
            DeskItem.user_id == principal.user.id, DeskItem.kind == "task"
        )
        q = q.where(Task.id.in_(pinned))
    if assignee:
        q = q.where(_assignee_where(assignee))
    if has_due:
        q = q.where(Task.due_at.is_not(None))
    if kind == "people":
        q = q.where(Task.assignee_agent_id.is_(None), Task.assignee_user_id.is_not(None))
    elif kind == "ai":
        q = q.where(Task.assignee_agent_id.is_not(None))
    if label and label.strip():
        q = q.where(Task.labels.contains([clean_labels([label])[0]]))
    if due_from:
        q = q.where(Task.due_at >= due_from)
    if due_to:
        q = q.where(Task.due_at <= due_to)
    if span_from and span_to:
        q = q.where(task_parts.overlapping(span_from, span_to))
    if top:
        q = q.where(Task.parent_task_id.is_(None))
    if q_.strip():
        like = f"%{q_.strip()}%"
        named = select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id, Agent.name.ilike(like)
        )
        person = select(User.id).where(User.name.ilike(like))
        q = q.where(
            or_(
                Task.title.ilike(like),
                Task.brief.ilike(like),
                cast(Task.labels, String).ilike(like),
                Task.assignee_agent_id.in_(named),
                Task.assignee_user_id.in_(person),
            )
        )
    if before and not cursor:
        cur = await db.get(Task, before)
        if cur is None or cur.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid."
            )
        cursor = paging.cursor_for(cur, TASK_ORDER)
    order = DUE_ORDER if has_due else TASK_ORDER
    rows = await paging.paginate(db, q, order, limit=limit, cursor=cursor, response=response)
    if paging.NEXT in response.headers:
        response.headers["X-Next-Before"] = rows[-1].id
    return await tasks_out(db, rows, trim=not full)


DUE_ORDER: paging.Order = ((Task.due_at, False), (Task.id, False))


def _assignee_where(value: str) -> Any:
    """P97 board filter: user:<id>, agent:<id>, people, agents or none."""
    if value == "people":
        return Task.assignee_user_id.is_not(None)
    if value == "agents":
        return Task.assignee_agent_id.is_not(None)
    if value == "none":
        return and_(Task.assignee_user_id.is_(None), Task.assignee_agent_id.is_(None))
    kind, _, ref = value.partition(":")
    if kind == "user" and ref:
        return task_parts.assigned_to([ref])  # P109: any of its assignees
    if kind == "agent" and ref:
        return Task.assignee_agent_id == ref
    raise api_error(status.HTTP_400_BAD_REQUEST, "bad_assignee", "That filter is not known.")


async def team_ids(db: AsyncSession, principal: Principal) -> list[str]:
    """The person and their direct reports (P97)."""
    if principal.team or principal.scope.kind != "all":
        return [principal.user.id, *sorted(principal.team)]
    return [
        principal.user.id,
        *await people.direct_reports(db, principal.workspace_id, principal.user.id),
    ]


async def _team_where(db: AsyncSession, principal: Principal) -> Any:
    """P97 the team board: tasks of the person and their people, their people's own AI, and
    (an HOD or supervisor) their department's agents. The scope still applies on top."""
    ids = await team_ids(db, principal)
    agents = select(Agent.id).where(
        Agent.workspace_id == principal.workspace_id,
        or_(
            Agent.owner_user_id.in_(ids),
            Agent.department_id == principal.department_id
            if principal.scope.kind == "department" and principal.department_id
            else false(),
        ),
    )
    return or_(
        task_parts.assigned_to(ids),  # P109: any of its assignees
        Task.assignee_agent_id.in_(agents),
        and_(Task.created_by == principal.actor, Task.parent_task_id.is_(None)),
    )


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
    await fill_people(db, rows, out)
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
    # P109: one or many people (assignee_user_id, if set, first).
    doers = list(
        dict.fromkeys(
            [*([body.assignee_user_id] if body.assignee_user_id else []), *body.assignee_user_ids]
        )
    )
    if body.assignee_agent_id and doers:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "two_assignees",
            "Give it to a person or an agent, not both.",
        )
    if not doers and (body.watcher_user_ids or body.subtasks):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "people_only",
            "Watchers and sub-tasks are for tasks given to people.",
        )
    _check_dates(body.start_at, body.due_at)
    agent = await _assignee(db, principal, body.assignee_agent_id)
    person = await _person(db, principal, doers[0] if doers else None)
    watchers: list[str] = []
    if doers:
        try:
            _, watchers = await task_parts.check_people(
                db, people.actor_of(principal), doers, body.watcher_user_ids
            )
        except people.PeopleError as e:
            raise people_error(e) from e
    if person is None:  # P36 checks work given to an AI; a person's task uses no AI
        await ensure_work_scope(db, principal, f"{body.title}\n{body.brief}")
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
        assignee_user_id=person.user_id if person else None,
        branch_id=agent.branch_id
        if agent
        else (person.branch_id or principal.branch_id)
        if person
        else principal.branch_id,
        requires_review=body.requires_review,
        goal=(body.goal or "").strip() or None,
        labels=clean_labels(labels),
        created_by=principal.actor,
        # P97: a task someone gives a person waits for them to take it (triage); one a person
        # gives themselves (only themselves) is on their list straight away (ready).
        status="ready" if agent or doers == [principal.user.id] else "triage",
        position=float(lowest) - 1,
        objective_id=objective_id,
        visibility=body.visibility,
        due_at=body.due_at,
        start_at=body.start_at,
        category=task_parts.clean_category(body.category),
    )
    db.add(t)
    await db.flush()
    t.root_task_id = t.id  # P21: a person's task starts its own request
    told: list[str] = []
    if doers:  # P109: everyone it is for and who follows it, its checklist and sub-tasks
        told, _ = await task_parts.set_people(db, t, doers, watchers, principal.actor)
        await link_files(db, principal, t, body.file_ids)
    else:
        await _attach_files(db, principal, t, body.file_ids)
    await _add_checklist(db, t, body.checklist, principal.actor)
    kids = [await new_subtask(db, principal, t, s) for s in body.subtasks]
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
        after={
            "title": t.title,
            "assignee": t.assignee_agent_id or t.assignee_user_id,
            **({"assignees": doers} if len(doers) > 1 else {}),
        },
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, "created the task")
    await events.publish(
        principal.workspace_id,
        "task.created",
        await people_event(db, t, principal.actor)
        if person
        else {"task_id": t.id, "agent_id": t.assignee_agent_id},
    )
    if person:
        await tell_assigned(db, principal, t, told)
        for kid in kids:
            await tell_assigned(db, principal, kid, [kid.assignee_user_id or ""])
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
        checklist=await checklist_out(db, t),
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
        checklist=await checklist_out(db, t),
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
    if changes.get("brief") is not None or changes.get("title") is not None:
        # P51: changing the brief/title re-instructs the agent; not into someone else's own AI.
        cur = await db.get(Agent, t.assignee_agent_id) if t.assignee_agent_id else None
        _guard_personal_instruction(principal, cur)
    if changes.get("visibility"):
        _check_share(principal, "shared" if changes["visibility"] != t.visibility else None)
        t.visibility = changes["visibility"]
    if changes.get("labels") is not None:
        t.labels = clean_labels(changes["labels"])
    was_person, before_person = people.is_person_task(t), t.assignee_user_id
    switching = (changes.get("assignee_agent_id") and was_person) or (
        changes.get("assignee_user_id") and t.assignee_agent_id
    )
    if switching and t.status not in ("triage", "ready"):  # P97: person <-> agent
        raise api_error(
            status.HTTP_409_CONFLICT,
            "move_back_first",
            "Move it back to To do before giving it to someone else.",
        )
    if "assignee_agent_id" in changes and not (was_person and changes["assignee_agent_id"] is None):
        if t.status in RUNNING and not launch.restartable(t) and not was_person:
            raise api_error(  # P21: parked work may move
                status.HTTP_409_CONFLICT, "running", "Cancel the run before reassigning."
            )
        agent = await _assignee(db, principal, changes["assignee_agent_id"])
        t.assignee_agent_id = agent.id if agent else None
        t.branch_id = agent.branch_id if agent else t.branch_id
        if agent:
            t.assignee_user_id = None
            await task_parts.set_people(db, t, [], [], principal.actor)  # P109: AI work now
    told: list[str] = []
    if "assignee_user_id" in changes and changes["assignee_user_id"] != t.assignee_user_id:
        person = await _person(db, principal, changes["assignee_user_id"])
        # P109: the new person takes the first one's place; the other assignees stay.
        rest = [u for u in await task_parts.assignee_ids(db, t) if u != before_person]
        t.assignee_user_id = person.user_id if person else None
        if person:
            t.assignee_agent_id = None
            t.branch_id = person.branch_id or t.branch_id
        new_list = [person.user_id, *rest] if person else rest
        told, _ = await task_parts.set_people(db, t, new_list, None, principal.actor)
    if "due_at" in changes:
        t.due_at = changes["due_at"]
    if "start_at" in changes:  # P109
        t.start_at = changes["start_at"]
    if "category" in changes:
        t.category = task_parts.clean_category(changes["category"])
    if {"due_at", "start_at"} & changes.keys():
        _check_dates(t.start_at, t.due_at)
    for k in ("title", "brief", "priority", "position"):
        if k in changes and changes[k] is not None:
            setattr(t, k, changes[k])
    if "objective_id" in changes and changes["objective_id"] != t.objective_id:
        old = t.objective_id
        t.objective_id = await _objective(db, principal, changes["objective_id"], t.branch_id)
        await objectives.relink_tree(db, t, old, t.objective_id)  # its parts follow it
    new_status = changes.get("status")
    before = t.status
    if new_status and new_status != t.status and people.is_person_task(t):
        try:  # P97: a person's task moves by its own rules and never starts a run
            new_status = people.land(
                t, new_status, people.actor_of(principal), await task_parts.assignee_ids(db, t)
            )
        except people.PeopleError as e:
            raise people_error(e) from e
        await runtime.set_task_status(
            db,
            t,
            new_status,
            actor=principal.actor,
            note=people.MOVE_NOTES.get(new_status, f"moved it to {new_status}"),
            finished_at=datetime.now(UTC) if new_status in ("done", "cancelled") else None,
            started_at=t.started_at or (datetime.now(UTC) if new_status == "running" else None),
        )
        if new_status in FINISHED:
            await blockers.on_finished(db, t)
        new_status = None  # handled
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
    if people.is_person_task(t) or was_person:
        await events.publish(
            principal.workspace_id,
            "task.updated",
            await people_event(db, t, principal.actor, was=before_person),
        )
        who = people.actor_of(principal)
        if told:
            await tell_assigned(db, principal, t, told)
        elif t.status != before:
            await people.told_moved(db, t, who, principal.user.name, before)
    else:
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
    if people.is_person_task(t):  # P109: linked (a Library file stays in the Library)
        await link_files(db, principal, t, ids)
    else:
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


async def _cancel_open_descendants(db: AsyncSession, root: Task, actor: str) -> int:
    """Cancel every still-open sub-task below `root` (its whole subtree, however deep), so a
    stopped or cancelled parent leaves nothing running. Stops each live run best-effort, then
    marks the row cancelled either way, so the subtree is terminal. Returns how many."""
    frontier, seen, n = [root.id], {root.id}, 0
    while frontier:
        kids = (await db.scalars(select(Task).where(Task.parent_task_id.in_(frontier)))).all()
        frontier = []
        for k in kids:
            if k.id in seen:
                continue
            seen.add(k.id)
            frontier.append(k.id)
            if k.status in FINISHED:
                continue
            if k.workflow_id and not launch.restartable(k):
                with contextlib.suppress(Exception):  # stop the live run; the DB is set below
                    await dispatch.cancel_task(k.workflow_id)
            await _stop_reviews(db, k)
            await runtime.set_task_status(
                db, k, "cancelled", actor=actor, note="its parent task was cancelled"
            )
            await blockers.on_finished(db, k)  # P21: work waiting for it goes to its owner
            n += 1
    return n


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    cascade: bool = Query(default=False),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove finished work for good: its conversation, events, approvals and sub-tasks go
    with it (database cascades). Whoever can see the task in their scope may delete it: the
    person who asked for it, the owner of the assistant that did it, or a manager over it.
    `cascade=true`: cancel any sub-tasks still open first, so a stopped task can be removed."""
    t = await _task(db, principal, task_id)
    if t.status not in FINISHED:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_finished",
            "Only done, failed or cancelled work can be deleted. Cancel it first.",
        )
    # Sub-tasks cascade with it: none of them may still be working (cancel them with cascade).
    if cascade:
        await _cancel_open_descendants(db, t, principal.actor)
    frontier, seen = [t.id], {t.id}
    while frontier:
        kids = (
            await db.execute(select(Task.id, Task.status).where(Task.parent_task_id.in_(frontier)))
        ).all()
        if any(s not in FINISHED for _, s in kids):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "children_active",
                "A sub-task of this work is still open. Cancel it first, or delete with "
                "“also cancel its open sub-tasks”.",
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
    # Cancelling a task cancels the sub-tasks it started, so nothing is left running (and the
    # task can then be deleted).
    await _cancel_open_descendants(db, t, principal.actor)
    await db.refresh(t)
    return await task_out(db, t)


@router.post("/tasks/{task_id}/wake")
async def wake_task(
    task_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """P95: "Carry on now" while the agent rests on a site (office hours, a break): the rest
    ends and the agent goes on. Only a running task that is resting; anything else is 409."""
    t = await _task(db, principal, task_id)
    last = (
        await db.execute(
            select(TaskEvent.kind)
            .where(TaskEvent.task_id == t.id, TaskEvent.kind.in_(("rest", "status")))
            .order_by(TaskEvent.ts.desc(), TaskEvent.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if t.status != "running" or not t.workflow_id or last != "rest":
        raise api_error(status.HTTP_409_CONFLICT, "not_resting", "It is not paused now.")
    await dispatch.wake_task(t.workflow_id)
    await runtime.task_event(db, t, "wake", principal.actor, "asked it to carry on now")
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
    if people.is_person_task(t):  # P97: the person who did it does not accept their own work
        try:
            people.land(t, "done", people.actor_of(principal))
        except people.PeopleError as e:
            raise people_error(e) from e
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
    _guard_personal_instruction(principal, agent)  # P51: no injecting into someone's own AI
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
    table: TableParams = Depends(),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ApprovalOut]:
    """Newest first. History pages with `limit` + `cursor` (X-Next-Cursor); `status` narrows
    history to some outcomes (comma list, e.g. approved,denied). P96 (the history table):
    `page` + `size` for numbered pages, `q` finds words in what was asked, the answer, the
    agent or the task, `sort` is "created" or "decided" ("-" newest first, the default)."""
    ws = principal.workspace_id
    q = select(Approval).where(Approval.workspace_id == ws)
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
    for w in table.words:
        pat = like(w)
        q = q.where(
            or_(
                Approval.tool_name.ilike(pat, escape="\\"),
                Approval.reason.ilike(pat, escape="\\"),
                Approval.answer.ilike(pat, escape="\\"),
                Approval.agent_id.in_(
                    select(Agent.id).where(
                        Agent.workspace_id == ws, Agent.name.ilike(pat, escape="\\")
                    )
                ),
                Approval.task_id.in_(
                    select(Task.id).where(
                        Task.workspace_id == ws, Task.title.ilike(pat, escape="\\")
                    )
                ),
            )
        )
    if table.paged:
        key, desc = table.sort_by(("created", "decided"), default="-created")
        col = Approval.decided_at if key == "decided" else Approval.created_at
        rows = await sql_page(db, q, ((col, desc), (Approval.id, desc)), table, response)
    else:
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


@router.post("/approvals/{approval_id}/stop")
async def stop_from_approval(
    approval_id: str,
    principal: Principal = Depends(require("approvals.decide")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """P56: "Stop the task" right where it asks: no to this, and the whole task (and the
    sub-tasks it started) stops, so it cannot come back with the same question."""
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
    if not can(principal.role, "work.write"):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Your role cannot stop tasks.")
    out = await cancel_task(a.task_id, principal, db)
    # The run stops on its own shortly; its questions end now, not when it gets there.
    t = await db.get(Task, a.task_id)
    void = await runtime._void_approvals(db, t) if t is not None else []  # noqa: SLF001
    await db.commit()
    if t is not None:
        for v in void:
            await events.publish(
                v.workspace_id,
                "approval.resolved",
                {
                    "approval_id": v.id,
                    "status": "cancelled",
                    "task_id": t.id,
                    "agent_id": v.agent_id,
                },
            )
    return out


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
    sc = principal.scope
    if not sc.everything and not sc.in_branch(d.branch_id):
        # P108: an office role reads only its own companies' departments.
        raise api_error(
            status.HTTP_404_NOT_FOUND, "department_not_found", "That department is not here."
        )
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
