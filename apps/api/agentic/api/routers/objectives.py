"""Objectives (P21): what the company's work is for, how far along it is, and what it cost.

Scoped like other org data: owners and admins manage every objective; a branch manager their
company's, a HOD their department's; everyone else (supervisors, staff, operators, viewers)
reads the ones in their scope so they can link work to them. Progress and cost come from the
tasks linked directly and through their request trees (teams/objectives.py)."""

from datetime import UTC, date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ...core.db import get_db
from ...core.security import PERMISSIONS
from ...i18n import Msg
from ...models import Branch, Department, Objective, Task, User, Workspace
from ...services import audit, events
from ...teams import objectives as obj
from .. import paging
from ..agent_schemas import TaskOut
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/objectives", tags=["objectives"])

Status = Literal["active", "done", "dropped"]


class ObjectiveIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    target: str = Field(default="", max_length=300)
    branch_id: str | None = Field(default=None, max_length=40)  # None: every company
    department_id: str | None = Field(default=None, max_length=40)
    parent_id: str | None = Field(default=None, max_length=40)
    due_on: date | None = None
    status: Status = "active"
    budget_usd: float | None = Field(default=None, ge=0, le=1_000_000)


class ObjectiveUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    target: str | None = Field(default=None, max_length=300)
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)
    parent_id: str | None = Field(default=None, max_length=40)
    due_on: date | None = None
    status: Status | None = None
    budget_usd: float | None = Field(default=None, ge=0, le=1_000_000)


class Progress(BaseModel):
    total: int = 0
    done: int = 0
    failed: int = 0
    open: int = 0
    cancelled: int = 0
    requests: int = 0


class ObjectiveOut(BaseModel):
    id: str
    title: str
    target: str
    status: str
    due_on: date | None
    budget_usd: float | None
    branch_id: str | None
    branch_name: str | None
    department_id: str | None
    department_name: str | None
    parent_id: str | None
    created_by: str
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime
    can_edit: bool
    progress: Progress
    # Its own work (tasks linked to it and their request trees), in US$ as billed.
    usd: float
    tokens: int
    last_activity: datetime | None
    # With the objectives nested under it; what the budget is checked against.
    rollup_usd: float
    budget_state: str  # none | ok | near | over


class ObjectiveDetailOut(BaseModel):
    objective: ObjectiveOut
    parent: ObjectiveOut | None
    children: list[ObjectiveOut]
    cost_by_day: list[dict[str, Any]]
    timezone: str


# ---------------------------------------------------------------- helpers


def _perms(p: Principal) -> frozenset[str]:
    return PERMISSIONS.get(p.role, frozenset())


async def _visible(db: AsyncSession, p: Principal) -> list[Objective]:
    q = select(Objective).where(Objective.workspace_id == p.workspace_id)
    cond = obj.visible_where(p.scope)
    if cond is not None:
        q = q.where(cond)
    return list((await db.scalars(q.order_by(Objective.created_at))).all())


async def _get(db: AsyncSession, p: Principal, objective_id: str) -> Objective:
    ob = await db.get(Objective, objective_id)
    if ob is None or ob.workspace_id != p.workspace_id or not obj.sees(p.scope, ob):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "objective_not_found", "That objective is not here."
        )
    return ob


def _edit_check(p: Principal, branch_id: str | None, department_id: str | None) -> None:
    if not obj.may_edit(p.scope, _perms(p), branch_id, department_id):
        where = {
            "branch": Msg("your company"),
            "department": Msg("your department"),
        }.get(p.scope.kind, "")
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            Msg("You can manage objectives for {where} only.", where=where)
            if where and "team.manage" in _perms(p)
            else "Only owners, admins and managers set objectives.",
        )


async def _placement(
    db: AsyncSession, p: Principal, branch_id: str | None, department_id: str | None
) -> tuple[str | None, str | None]:
    """A HOD's objective always sits in their department; the rest pick."""
    if p.scope.kind == "department" and "org.manage" not in _perms(p):
        department_id = department_id or p.scope.department_id
    if department_id:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != p.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department.")
        if branch_id and d.branch_id != branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_department",
                "That department is in another company.",
            )
        branch_id = d.branch_id
    if p.scope.kind == "branch" and "org.manage" not in _perms(p):
        branch_id = branch_id or p.scope.branch_id
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != p.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company.")
    return branch_id, department_id


async def _parent_check(
    db: AsyncSession, p: Principal, parent_id: str, branch_id: str | None, me: str | None
) -> None:
    parent = await db.get(Objective, parent_id)
    if parent is None or parent.workspace_id != p.workspace_id or not obj.sees(p.scope, parent):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_parent", "Pick an objective you see.")
    if parent.branch_id and parent.branch_id != branch_id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_parent",
            '"{title}" belongs to another company.',
            title=parent.title,
        )
    depth, cur, seen = 1, parent, set()
    while cur is not None:
        if me is not None and cur.id == me:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_parent",
                "An objective cannot sit under itself or one of its own parts.",
            )
        if cur.id in seen:
            break
        seen.add(cur.id)
        depth += 1
        cur = await db.get(Objective, cur.parent_id) if cur.parent_id else None
    if depth > obj.MAX_DEPTH:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "too_deep",
            "Objectives nest at most {n} levels deep.",
            n=obj.MAX_DEPTH,
        )


async def _outs(db: AsyncSession, p: Principal, rows: list[Objective]) -> list[ObjectiveOut]:
    """Many objectives with their numbers: a few grouped queries in all."""
    if not rows:
        return []
    every = list(
        (await db.scalars(select(Objective).where(Objective.workspace_id == p.workspace_id))).all()
    )
    own = await obj.stats(db, p.workspace_id, [o.id for o in every])
    branch_ids = {o.branch_id for o in rows if o.branch_id}
    dept_ids = {o.department_id for o in rows if o.department_id}
    users = {o.created_by.removeprefix("user:") for o in rows if o.created_by.startswith("user:")}
    branches = (
        dict(
            (
                await db.execute(select(Branch.id, Branch.name).where(Branch.id.in_(branch_ids)))
            ).all()
        )
        if branch_ids
        else {}
    )
    depts = (
        dict(
            (
                await db.execute(
                    select(Department.id, Department.name).where(Department.id.in_(dept_ids))
                )
            ).all()
        )
        if dept_ids
        else {}
    )
    names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(users)))).all())
        if users
        else {}
    )
    perms = _perms(p)
    out = []
    for o in rows:
        s = own.get(o.id) or obj.Stats()
        rolled = obj.rollup(every, own, o.id)
        budget = float(o.budget_usd) if o.budget_usd is not None else None
        out.append(
            ObjectiveOut(
                id=o.id,
                title=o.title,
                target=o.target,
                status=o.status,
                due_on=o.due_on,
                budget_usd=budget,
                branch_id=o.branch_id,
                branch_name=branches.get(o.branch_id or ""),
                department_id=o.department_id,
                department_name=depts.get(o.department_id or ""),
                parent_id=o.parent_id,
                created_by=o.created_by,
                created_by_name=names.get(o.created_by.removeprefix("user:")),
                created_at=o.created_at,
                updated_at=o.updated_at,
                can_edit=obj.may_edit(p.scope, perms, o.branch_id, o.department_id),
                progress=Progress(
                    total=s.total,
                    done=s.done,
                    failed=s.failed,
                    open=s.open,
                    cancelled=s.cancelled,
                    requests=s.requests,
                ),
                usd=round(s.usd, 6),
                tokens=s.tokens,
                last_activity=s.last_activity,
                rollup_usd=round(rolled, 6),
                budget_state=obj.budget_state(rolled, budget),
            )
        )
    return out


async def _publish(p: Principal, ob: Objective, kind: str) -> None:
    await events.publish(
        p.workspace_id, "objective.updated", {"objective_id": ob.id, "change": kind}
    )


# ---------------------------------------------------------------- endpoints


@router.get("")
async def list_objectives(
    status_: str | None = Query(default=None, alias="status", max_length=40),
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ObjectiveOut]:
    """Every objective the person sees, oldest first, each with progress (tasks total, done,
    failed, open), cost and tokens (its tasks and their request trees) and last activity.
    `status` filters (comma list); `branch_id` keeps one company's plus every-company ones."""
    rows = await _visible(db, principal)
    if status_:
        wanted = set(status_.split(","))
        rows = [o for o in rows if o.status in wanted]
    if branch_id:
        rows = [o for o in rows if o.branch_id in (None, branch_id)]
    return await _outs(db, principal, rows)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_objective(
    body: ObjectiveIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ObjectiveOut:
    want_branch = body.branch_id
    if body.parent_id and not want_branch and not body.department_id:
        parent = await db.get(Objective, body.parent_id)  # a part sits in its parent's company
        if parent is not None and parent.workspace_id == principal.workspace_id:
            want_branch = parent.branch_id
    branch_id, department_id = await _placement(db, principal, want_branch, body.department_id)
    _edit_check(principal, branch_id, department_id)
    if body.parent_id:
        await _parent_check(db, principal, body.parent_id, branch_id, None)
    ob = Objective(
        workspace_id=principal.workspace_id,
        branch_id=branch_id,
        department_id=department_id,
        parent_id=body.parent_id or None,
        title=body.title.strip(),
        target=body.target.strip(),
        due_on=body.due_on,
        status=body.status,
        budget_usd=body.budget_usd,
        created_by=principal.actor,
    )
    db.add(ob)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "objective.created",
        target=ob.id,
        after={"title": ob.title, "branch_id": branch_id, "budget_usd": body.budget_usd},
    )
    await db.commit()
    await db.refresh(ob)
    await _publish(principal, ob, "created")
    return (await _outs(db, principal, [ob]))[0]


@router.get("/{objective_id}")
async def objective_detail(
    objective_id: str,
    days: int = Query(default=30, ge=7, le=180),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ObjectiveDetailOut:
    """One objective, the one above it, the ones nested under it (that the person sees), and
    its daily spend (with nested objectives) over the last `days` days."""
    ob = await _get(db, principal, objective_id)
    visible = await _visible(db, principal)
    every = list(
        (
            await db.scalars(
                select(Objective).where(Objective.workspace_id == principal.workspace_id)
            )
        ).all()
    )
    kids = [o for o in visible if o.parent_id == ob.id]
    parent = next((o for o in visible if o.id == ob.parent_id), None)
    outs = await _outs(db, principal, [ob, *kids, *([parent] if parent else [])])
    ws = await db.get(Workspace, principal.workspace_id)
    tz = ws.timezone if ws else "UTC"
    return ObjectiveDetailOut(
        objective=outs[0],
        children=outs[1 : 1 + len(kids)],
        parent=outs[-1] if parent else None,
        cost_by_day=await obj.cost_by_day(
            db, principal.workspace_id, obj.subtree(every, ob.id), tz, days
        ),
        timezone=tz,
    )


@router.get("/{objective_id}/tasks")
async def objective_tasks(
    objective_id: str,
    response: Response,
    status_: str | None = Query(default=None, alias="status", max_length=80),
    limit: int = Query(default=50, ge=1, le=paging.MAX_LIMIT),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskOut]:
    """The objective's work, newest first, paged (X-Next-Cursor / X-Total-Count): tasks linked
    to it and the parts of their requests, within what the person may see."""
    from .tasks import tasks_out  # late: tasks imports teams.objectives, not this router

    ob = await _get(db, principal, objective_id)
    root = aliased(Task)
    q = (
        select(Task)
        .outerjoin(root, root.id == Task.root_task_id)
        .where(
            Task.workspace_id == principal.workspace_id,
            or_(Task.objective_id == ob.id, root.objective_id == ob.id),
            func.coalesce(Task.objective_id, root.objective_id) == ob.id,
        )
    )
    cond = principal.scope.task_where()
    if cond is not None:
        q = q.where(cond)
    if status_:
        q = q.where(Task.status.in_(status_.split(",")))
    rows = await paging.paginate(
        db,
        q,
        ((Task.created_at, True), (Task.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return await tasks_out(db, rows, trim=True)


@router.patch("/{objective_id}")
async def update_objective(
    objective_id: str,
    body: ObjectiveUpdateIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ObjectiveOut:
    ob = await _get(db, principal, objective_id)
    _edit_check(principal, ob.branch_id, ob.department_id)
    changes = body.model_dump(exclude_unset=True)
    before = {"title": ob.title, "status": ob.status, "budget_usd": ob.budget_usd}
    if "branch_id" in changes or "department_id" in changes:
        branch_id, department_id = await _placement(
            db,
            principal,
            changes.get("branch_id", ob.branch_id),
            changes.get("department_id", ob.department_id if "branch_id" not in changes else None),
        )
        _edit_check(principal, branch_id, department_id)
        ob.branch_id, ob.department_id = branch_id, department_id
    if "parent_id" in changes:
        if changes["parent_id"]:
            await _parent_check(db, principal, changes["parent_id"], ob.branch_id, ob.id)
        ob.parent_id = changes["parent_id"] or None
    elif "branch_id" in changes and ob.parent_id:
        await _parent_check(db, principal, ob.parent_id, ob.branch_id, ob.id)
    for k in ("title", "target"):
        if changes.get(k) is not None:
            setattr(ob, k, changes[k].strip())
    if changes.get("status") is not None:
        ob.status = changes["status"]
    for k in ("due_on", "budget_usd"):
        if k in changes:
            setattr(ob, k, changes[k])
    ob.updated_at = datetime.now(UTC)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "objective.updated",
        target=ob.id,
        before={
            k: (float(v) if k == "budget_usd" and v is not None else v) for k, v in before.items()
        },
        after={k: str(v) if isinstance(v, date) else v for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(ob)
    await _publish(principal, ob, "updated")
    return (await _outs(db, principal, [ob]))[0]


@router.delete("/{objective_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_objective(
    objective_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove an objective. Its work stays (unlinked) and its nested objectives move up to
    its parent. Marking it done or dropped keeps its history instead."""
    ob = await _get(db, principal, objective_id)
    _edit_check(principal, ob.branch_id, ob.department_id)
    linked = Task.workspace_id == principal.workspace_id, Task.objective_id == ob.id
    unlinked = await db.scalar(select(func.count()).select_from(Task).where(*linked)) or 0
    await db.execute(update(Task).where(*linked).values(objective_id=None))
    await db.execute(
        update(Objective)
        .where(Objective.workspace_id == principal.workspace_id, Objective.parent_id == ob.id)
        .values(parent_id=ob.parent_id)
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "objective.deleted",
        target=ob.id,
        before={"title": ob.title, "tasks_unlinked": int(unlinked or 0)},
    )
    await db.delete(ob)
    await db.commit()
    await events.publish(
        principal.workspace_id,
        "objective.updated",
        {"objective_id": objective_id, "change": "deleted"},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
