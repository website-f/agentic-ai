"""Staff onboarding and the staff home (P19): "hire your AI worker".

A staff member signs in, says where they work (once, if their manager has not), meets their
AI worker (their AI twin, agents/twin.py), gives it a job (a blueprint, workflows it follows,
recurring duties, a first task), sets when it works and rests (agents/work_hours.py), and
hires it. Afterwards they land on "My AI worker" (GET /api/me/worker).

- GET  /api/me/staff            what the onboarding needs (placement, companies, options)
- PUT  /api/me/placement        pick company/department once (staff only, only when unset)
- GET  /api/me/worker/when      read plain words ("every Monday 9am") into a schedule
- POST /api/me/worker/hire      everything from steps 3-5 at once, then onboarding is done
- POST /api/me/worker/duties    add one recurring duty later
- PUT  /api/me/worker/workflows the workflows it follows
- GET  /api/me/worker           the staff home: status now, today, waiting for you, duties

Placement is self-service only for the plain staff role: a manager's branch or department
is their scope (it grants management power), so only an admin sets those (Members).
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Depends, Query, status
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch, hire, launch, twin, work_hours
from ...brain.store import Author
from ...core.db import get_db
from ...core.security import PERMISSIONS
from ...i18n import Msg, current_lang, lookup, tr
from ...i18n.labels import agent_status_label, role_label
from ...models import (
    Agent,
    Approval,
    Blueprint,
    Branch,
    Department,
    Membership,
    Schedule,
    Task,
    User,
    Workflow,
    Workspace,
)
from ...services import audit, events, prefs
from ...teams import schedules, when
from ..deps import Principal, api_error, require
from .agents import agent_out, clean_hours

router = APIRouter(prefix="/api/me", tags=["staff"])

OPEN = ("triage", "ready", "running", "blocked", "review")


# ---------------------------------------------------------------- helpers


def _is_staff(principal: Principal) -> bool:
    perms = PERMISSIONS.get(principal.role, frozenset())
    return "agents.own" in perms and "agents.manage" not in perms


def staff_perm():
    async def checker(principal: Principal = Depends(require("read"))) -> Principal:
        if not _is_staff(principal):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "not_staff",
                "This is for staff. Your role ({role}) adds agents from Agents.",
                role=role_label(principal.role),
            )
        return principal

    return checker


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return ws


async def _my_twin(db: AsyncSession, principal: Principal) -> Agent:
    a = await twin.twin_of(db, principal.workspace_id, principal.user.id)
    if a is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "no_twin", "Meet your AI worker first (step 2).")
    return a


def _tz(ws: Workspace, a: Agent | None) -> str:
    return ((a.work_hours or {}).get("tz") if a else None) or ws.timezone


async def _onboarding(db: AsyncSession, user_id: str) -> dict[str, Any]:
    u = await db.get(User, user_id)
    return prefs.visible(u.prefs if u else None)["onboarding"]


# ---------------------------------------------------------------- onboarding state


@router.get("/staff")
async def staff_state(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    m = await db.get(Membership, (ws.id, principal.user.id))
    branch = await db.get(Branch, m.branch_id) if m and m.branch_id else None
    dept = await db.get(Department, m.department_id) if m and m.department_id else None
    staff = _is_staff(principal)
    mine = await twin.twin_of(db, ws.id, principal.user.id) if staff else None
    branches = (
        await db.scalars(
            select(Branch).where(Branch.workspace_id == ws.id).order_by(Branch.created_at)
        )
    ).all()
    home_branch = branch.id if branch else None
    bps = (
        await db.scalars(
            select(Blueprint)
            .where(
                Blueprint.workspace_id == ws.id,
                or_(Blueprint.branch_id.is_(None), Blueprint.branch_id == home_branch),
            )
            .order_by(Blueprint.name)
        )
    ).all()
    wfs = (
        await db.scalars(
            select(Workflow).where(Workflow.workspace_id == ws.id).order_by(Workflow.name)
        )
    ).all()
    tz = _tz(ws, mine)
    return {
        "eligible": staff,
        "role": principal.role,
        "person": {"name": principal.user.name, "first_name": twin.first_name(principal.user.name)},
        "workspace": {"name": ws.name, "timezone": ws.timezone},
        "onboarding": await _onboarding(db, principal.user.id),
        "placement": {
            "branch_id": branch.id if branch else None,
            "branch_name": branch.name if branch else None,
            "department_id": dept.id if dept else None,
            "department_name": dept.name if dept else None,
            "branch_locked": branch is not None,
            "department_locked": dept is not None,
            "can_choose": staff and principal.role == "staff" and dept is None,
        },
        "companies": [
            {
                "id": b.id,
                "name": b.name,
                "color": b.color,
                "industry": b.industry,
                "departments": [{"id": d.id, "name": d.name} for d in b.departments],
            }
            for b in branches
        ],
        "twin": await agent_out(db, mine, None, principal) if mine else None,
        "blueprints": [
            {"id": b.id, "name": b.name, "description": b.description, "role": b.role} for b in bps
        ],
        "workflows": [
            {
                "id": w.id,
                "name": w.name,
                "description": w.description,
                "status": w.status,
                "steps": len((w.graph or {}).get("nodes") or []),
                "following": bool(mine and mine.id in (w.agent_ids or [])),
            }
            for w in wfs
        ],
        "default_hours": (mine.work_hours if mine and mine.work_hours else None)
        or work_hours.default(tz),
    }


class PlacementIn(BaseModel):
    branch_id: str = Field(min_length=1, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)


@router.put("/placement")
async def set_placement(
    body: PlacementIn,
    principal: Principal = Depends(staff_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Staff say where they work, once: only what their manager has not set yet."""
    if principal.role != "staff":
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "placement_by_admin",
            "Your company and department come with your role. Ask an admin to change them.",
        )
    ws_id = principal.workspace_id
    m = await db.get(Membership, (ws_id, principal.user.id))
    assert m is not None
    if m.branch_id and m.branch_id != body.branch_id:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "placement_locked",
            "Your company was set by your manager. Ask them to change it.",
        )
    if m.department_id and m.department_id != body.department_id:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "placement_locked",
            "Your department was set by your manager. Ask them to change it.",
        )
    b = await db.get(Branch, body.branch_id)
    if b is None or b.workspace_id != ws_id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick one of the companies.")
    if body.department_id:
        d = await db.get(Department, body.department_id)
        if d is None or d.branch_id != b.id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_department",
                "That department is not in the chosen company.",
            )
    before = {"branch_id": m.branch_id, "department_id": m.department_id}
    after = {"branch_id": b.id, "department_id": body.department_id}
    if before != after:
        m.branch_id, m.department_id = b.id, body.department_id
        mine = await twin.twin_of(db, ws_id, principal.user.id)
        if mine is not None:  # the twin sits with its person
            mine.branch_id, mine.department_id = b.id, body.department_id
        await audit.record(
            db,
            ws_id,
            principal.actor,
            "member.placement",
            target=principal.user.id,
            before=before,
            after=after,
            note="chosen by the person at onboarding",
        )
        await db.commit()
        if mine is not None:
            await events.publish(ws_id, "agent.upsert", {"agent_id": mine.id, "name": mine.name})
    return await staff_state(principal, db)


# ---------------------------------------------------------------- duties


@router.get("/worker/when")
async def read_when(
    text: str = Query(min_length=1, max_length=200),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Plain words -> a schedule ("every Monday at 9am"), or the question to ask back."""
    ws = await _ws(db, principal)
    mine = await twin.twin_of(db, ws.id, principal.user.id)
    try:
        w = when.parse(text, _tz(ws, mine))
    except when.Unclear as e:
        return {"ok": False, "question": str(e)}
    except schedules.ScheduleError as e:
        return {"ok": False, "question": str(e)}
    if w.once:
        return {
            "ok": False,
            "question": tr("Duties repeat. For a one-off, give it a task instead."),
        }
    return {
        "ok": True,
        "cron": w.cron,
        "summary": when.summary_in(w.summary, current_lang()),
        "first": w.first.isoformat(),
    }


class DutyIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    brief: str = Field(default="", max_length=4000)
    when: str = Field(min_length=1, max_length=200)
    urgent: bool = False


def _parse_duty(d: DutyIn, tz: str, n: int | None = None) -> when.When:
    label = (
        Msg("Duty {n} ({title})", n=n, title=d.title.strip()[:40]) if n else d.title.strip()[:60]
    )
    try:
        w = when.parse(d.when, tz)
    except (when.Unclear, schedules.ScheduleError) as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_when",
            "{label}: {problem}",
            label=label,
            problem=lookup(str(e)),
        ) from e
    if w.once:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_when",
            "{label}: duties repeat. For a one-off, give it a task instead.",
            label=label,
        )
    return w


async def _add_duty(
    db: AsyncSession, principal: Principal, a: Agent, d: DutyIn, w: when.When, tz: str
) -> Schedule:
    title = " ".join(d.title.split())
    s = Schedule(
        workspace_id=principal.workspace_id,
        name=(f"Urgent: {title}" if d.urgent else title)[:160],
        agent_id=a.id,
        title=title[:180],
        brief=d.brief.strip(),
        cron=w.cron,
        timezone=tz,
        enabled=True,
        requires_review=True,
        created_by=principal.actor,
    )
    db.add(s)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "schedule.created",
        target=s.id,
        after={"name": s.name, "cron": s.cron, "agent": a.id},
        note=f"duty of {a.name}: {w.summary}",
    )
    return s


async def _sync(s: Schedule) -> str | None:
    try:
        await dispatch.upsert_schedule(s.id, s.cron, s.timezone, s.enabled, s.name)
    except Exception:  # noqa: BLE001 - the row is saved; saving it again re-syncs
        return f"{s.title}: saved, but the worker service is not reachable, so it will not run yet."
    return None


@router.post("/worker/duties", status_code=status.HTTP_201_CREATED)
async def add_duty(
    body: DutyIn,
    principal: Principal = Depends(staff_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    a = await _my_twin(db, principal)
    tz = _tz(ws, a)
    w = _parse_duty(body, tz)
    s = await _add_duty(db, principal, a, body, w, tz)
    await db.commit()
    warning = await _sync(s)
    return {"id": s.id, "summary": when.summary_in(w.summary, current_lang()), "warning": warning}


class WorkflowsIn(BaseModel):
    workflow_ids: list[str] = Field(default_factory=list, max_length=20)


async def _set_workflows(
    db: AsyncSession, principal: Principal, a: Agent, ids: list[str]
) -> list[str]:
    """The twin follows exactly these workflows (other agents on them are left alone)."""
    rows = (
        await db.scalars(select(Workflow).where(Workflow.workspace_id == principal.workspace_id))
    ).all()
    known = {w.id for w in rows}
    if bad := [i for i in ids if i not in known]:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_workflow", "Unknown workflow: {name}.", name=bad[0]
        )
    want = set(ids)
    changed: list[str] = []
    for w in rows:
        has = a.id in (w.agent_ids or [])
        if w.id in want and not has:
            w.agent_ids = [*(w.agent_ids or []), a.id]
            changed.append(w.name)
        elif w.id not in want and has:
            w.agent_ids = [x for x in w.agent_ids if x != a.id]
            changed.append(w.name)
    if changed:
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "agent.updated",
            target=a.id,
            after={"workflows": sorted(want)},
            note="workflows it follows",
        )
    return changed


@router.put("/worker/workflows")
async def set_workflows(
    body: WorkflowsIn,
    principal: Principal = Depends(staff_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await _my_twin(db, principal)
    changed = await _set_workflows(db, principal, a, list(dict.fromkeys(body.workflow_ids)))
    await db.commit()
    if changed:
        await events.publish(principal.workspace_id, "agent.upsert", {"agent_id": a.id})
    return {"changed": changed}


# ---------------------------------------------------------------- hire


class FirstTaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(default="", max_length=8000)
    urgent: bool = False


class HireIn(BaseModel):
    blueprint_id: str | None = Field(default=None, max_length=40)
    workflow_ids: list[str] = Field(default_factory=list, max_length=20)
    duties: list[DutyIn] = Field(default_factory=list, max_length=10)
    work_hours: dict[str, Any] | None = None
    first_task: FirstTaskIn | None = None


async def new_task(
    db: AsyncSession, principal: Principal, a: Agent, title: str, brief: str, urgent: bool
) -> Task:
    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == principal.workspace_id)
        )
        or 0
    )
    t = Task(
        workspace_id=principal.workspace_id,
        branch_id=a.branch_id,
        title=" ".join(title.split())[:200],
        brief=brief.strip(),
        status="ready",
        priority="urgent" if urgent else "normal",
        labels=["urgent"] if urgent else [],
        assignee_agent_id=a.id,
        created_by=principal.actor,
        source="manual",
        requires_review=True,
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
        after={"title": t.title, "agent": a.id},
    )
    await db.commit()
    from ...agents import runtime

    await runtime.task_event(db, t, "created", principal.actor, "created at onboarding")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": a.id}
    )
    return t


@router.post("/worker/hire")
async def hire_worker(
    body: HireIn,
    principal: Principal = Depends(staff_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Steps 3-5 of the onboarding at once. Everything is checked before anything is saved,
    so a mistake in one duty does not leave half a hire behind."""
    ws = await _ws(db, principal)
    a = await _my_twin(db, principal)
    if a.status != "active":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "agent_inactive",
            "{name} is {status}.",
            name=a.name,
            status=agent_status_label(a.status),
        )
    hours = await clean_hours(db, ws.id, body.work_hours) if body.work_hours else a.work_hours
    tz = (hours or {}).get("tz") or ws.timezone
    bp = None
    if body.blueprint_id:
        bp = await db.get(Blueprint, body.blueprint_id)
        if (
            bp is None
            or bp.workspace_id != ws.id
            or (bp.branch_id is not None and bp.branch_id != a.branch_id)
        ):
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_blueprint", "Pick one of the blueprints."
            )
    parsed = [(d, _parse_duty(d, tz, i)) for i, d in enumerate(body.duties, 1)]

    if body.work_hours and hours != a.work_hours:
        before = a.work_hours
        a.work_hours = hours
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "agent.updated",
            target=a.id,
            before={"work_hours": before},
            after={"work_hours": hours},
            note="working hours set at onboarding",
        )
    if bp is not None:
        await hire.apply_blueprint_to_twin(
            db, ws, a, bp, Author(principal.actor, principal.user.name)
        )
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "blueprint.applied",
            target=a.id,
            after={"blueprint": bp.name},
            note="AI twin: persona kept, blueprint added as its playbook",
        )
    await _set_workflows(db, principal, a, list(dict.fromkeys(body.workflow_ids)))
    made = [(await _add_duty(db, principal, a, d, w, tz), w) for d, w in parsed]
    await prefs.update(
        db,
        principal.user.id,
        {"onboarding": {"done": True, "at": datetime.now(UTC).isoformat(), "agent_id": a.id}},
    )
    await db.commit()
    warnings = [w for s, _ in made if (w := await _sync(s))]
    first: dict[str, Any] | None = None
    if body.first_task:
        t = await new_task(
            db,
            principal,
            a,
            body.first_task.title,
            body.first_task.brief,
            body.first_task.urgent,
        )
        try:
            later = await launch.launch(db, t, principal.actor)
        except launch.LaunchError as e:
            warnings.append(
                tr("First task saved but not started: {problem}", problem=lookup(e.message))
            )
            later = None
        await db.refresh(t)
        first = {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "starts_at": later.isoformat() if later else None,
            "note": t.blocked_reason,
        }
    await db.refresh(a)
    await events.publish(ws.id, "agent.upsert", {"agent_id": a.id, "name": a.name})
    return {
        "twin": await agent_out(db, a, None, principal),
        "duties": [
            {"id": s.id, "title": s.title, "summary": when.summary_in(w.summary, current_lang())}
            for s, w in made
        ],
        "first_task": first,
        "warnings": warnings,
    }


# ---------------------------------------------------------------- the staff home


def _kind(t: Task) -> str:
    if t.status == "done":
        return "done"
    if t.status in ("failed", "cancelled"):
        return t.status
    if t.status == "review":
        return "review"
    if t.status == "blocked":
        return "waiting"
    if t.status == "running":
        return "working"
    return "queued"


@router.get("/worker")
async def my_worker(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    a = await twin.twin_of(db, ws.id, principal.user.id) if _is_staff(principal) else None
    base: dict[str, Any] = {
        "eligible": _is_staff(principal),
        "person": {"name": principal.user.name, "first_name": twin.first_name(principal.user.name)},
        "onboarding": await _onboarding(db, principal.user.id),
        "twin": None,
    }
    if a is None:
        return base
    now = datetime.now(UTC)
    tz = _tz(ws, a)
    zone = ZoneInfo(tz)
    day_start = datetime.combine(now.astimezone(zone).date(), datetime.min.time(), zone)
    rows = (
        await db.scalars(
            select(Task)
            .where(
                Task.assignee_agent_id == a.id,
                or_(
                    Task.status.in_(OPEN),
                    func.coalesce(Task.finished_at, Task.updated_at) >= day_start,
                ),
            )
            .order_by(Task.updated_at.desc())
            .limit(40)
        )
    ).all()
    approvals = (
        await db.execute(
            select(Approval, Task.title)
            .join(Task, Task.id == Approval.task_id)
            .where(Approval.agent_id == a.id, Approval.status == "pending")
            .order_by(Approval.created_at.desc())
            .limit(20)
        )
    ).all()
    duties = (
        await db.scalars(
            select(Schedule).where(Schedule.agent_id == a.id).order_by(Schedule.created_at)
        )
    ).all()
    following = (
        await db.scalars(
            select(Workflow)
            .where(Workflow.workspace_id == ws.id, Workflow.agent_ids.contains([a.id]))
            .order_by(Workflow.name)
        )
    ).all()
    tomorrow = day_start + timedelta(days=1)
    duty_rows: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    for s in duties:
        try:
            nxt = schedules.next_runs(s.cron, s.timezone, 1)[0] if s.enabled else None
        except schedules.ScheduleError:
            nxt = None
        duty_rows.append(
            {
                "id": s.id,
                "title": s.title,
                "brief": s.brief,
                "cron": s.cron,
                "enabled": s.enabled,
                "urgent": work_hours.schedule_is_urgent(s.name, s.title),
                "next_run": nxt.isoformat() if nxt else None,
                "last_run_at": s.last_run_at,
            }
        )
        if nxt and nxt < tomorrow:
            later = work_hours.deferred_until(
                nxt, a.work_hours, work_hours.schedule_is_urgent(s.name, s.title)
            )
            upcoming.append(
                {
                    "id": s.id,
                    "title": s.title,
                    "at": nxt.isoformat(),
                    "starts_at": (later or nxt).isoformat(),
                }
            )
    today = [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "kind": _kind(t),
            "priority": t.priority,
            "note": t.blocked_reason,
            "source": t.source,
            "updated_at": t.updated_at,
            "started_at": t.started_at,
            "finished_at": t.finished_at,
        }
        for t in rows
    ]
    out = await agent_out(db, a, None, principal)
    return {
        **base,
        "twin": out,
        "now": now.isoformat(),
        "timezone": tz,
        "duty": work_hours.duty(now, a.work_hours),
        "hours_label": work_hours.describe(a.work_hours),
        "today": today,
        "upcoming": upcoming,
        "waiting": {
            "approvals": [
                {
                    "id": ap.id,
                    "kind": ap.kind,
                    "tool_name": ap.tool_name,
                    "reason": ap.reason,
                    "task_id": ap.task_id,
                    "task_title": title,
                    "created_at": ap.created_at,
                }
                for ap, title in approvals
            ],
            "reviews": [x for x in today if x["kind"] == "review"],
        },
        "duties": duty_rows,
        "workflows": [{"id": w.id, "name": w.name, "status": w.status} for w in following],
        "blueprint": a.template if a.template and a.template != "twin" else None,
        "counts": {
            "done_today": sum(1 for x in today if x["kind"] == "done"),
            "open": sum(1 for x in today if x["status"] in OPEN),
            "waiting": len(approvals) + sum(1 for x in today if x["kind"] == "review"),
        },
    }
