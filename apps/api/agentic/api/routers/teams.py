"""P7 teams and governance: meetings, schedules and their ledger, incidents, pings, budgets."""

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...core.db import get_db
from ...models import (
    Agent,
    AgentPing,
    Incident,
    JobRun,
    LLMCall,
    Meeting,
    MeetingTurn,
    Schedule,
    Task,
    Workspace,
)
from ...services import audit, events
from ...teams import budget, meetings, schedules
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["teams"])


async def _ws(db: AsyncSession, ws_id: str) -> Workspace:
    ws = await db.get(Workspace, ws_id)
    assert ws is not None
    return ws


# ---------------------------------------------------------------- meetings


class MeetingIn(BaseModel):
    topic: str = Field(min_length=3, max_length=2000)
    participant_ids: list[str] = Field(min_length=2, max_length=meetings.MAX_PARTICIPANTS)
    rounds: int = Field(default=2, ge=1, le=meetings.MAX_ROUNDS)
    task_id: str | None = None
    token_budget: int = Field(default=meetings.DEFAULT_TOKEN_BUDGET, ge=2000, le=100_000)


class InterjectIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


async def _meeting_out(
    db: AsyncSession, m: Meeting, with_turns: bool = False, names: dict[str, Agent] | None = None
) -> dict[str, Any]:
    names = names or {
        a.id: a for a in (await db.scalars(select(Agent).where(Agent.id.in_(m.participant_ids))))
    }
    task = await db.get(Task, m.task_id) if m.task_id else None
    out: dict[str, Any] = {
        "id": m.id,
        "topic": m.topic,
        "status": m.status,
        "participants": [
            {"id": i, "name": names[i].name, "color": names[i].color, "role": names[i].role}
            for i in m.participant_ids
            if i in names
        ],
        "initiator_agent_id": m.initiator_agent_id,
        "started_by": m.started_by,
        "task": {"id": task.id, "title": task.title} if task else None,
        "max_rounds": m.max_rounds,
        "rounds_done": m.rounds_done,
        "token_budget": m.token_budget,
        "tokens_used": m.tokens_used,
        "outcome": m.outcome,
        "decision_path": m.decision_path,
        "error": m.error,
        "created_at": m.created_at,
        "finished_at": m.finished_at,
    }
    if with_turns:
        out["turns"] = [
            {
                "id": t.id,
                "round": t.round,
                "speaker": t.speaker,
                "name": t.name,
                "kind": t.kind,
                "content": t.content,
                "tokens": t.tokens,
                "created_at": t.created_at,
            }
            for t in await meetings.turns(db, m.id)
        ]
    return out


async def _visible(db: AsyncSession, principal: Principal) -> set[str] | None:
    """Agent ids the person may see, or None for everything (workspace roles)."""
    cond = principal.scope.agent_where()
    if cond is None:
        return None
    return set(
        (
            await db.scalars(
                select(Agent.id).where(Agent.workspace_id == principal.workspace_id, cond)
            )
        ).all()
    )


def _meeting_ok(m: Meeting, principal: Principal, visible: set[str] | None) -> bool:
    return (
        visible is None
        or m.started_by == principal.actor
        or any(p in visible for p in m.participant_ids or [])
    )


async def _meeting(db: AsyncSession, principal: Principal, meeting_id: str) -> Meeting:
    m = await db.get(Meeting, meeting_id)
    if (
        m is None
        or m.workspace_id != principal.workspace_id
        or not _meeting_ok(m, principal, await _visible(db, principal))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "meeting_not_found", "That meeting is not here.")
    return m


async def _seen_agent(db: AsyncSession, principal: Principal, agent_id: str | None) -> Agent:
    a = await db.get(Agent, agent_id) if agent_id else None
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    return a


@router.get("/meetings")
async def list_meetings(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(Meeting)
            .where(Meeting.workspace_id == principal.workspace_id)
            .order_by(Meeting.created_at.desc())
            .limit(100)
        )
    ).all()
    visible = await _visible(db, principal)
    rows = [m for m in rows if _meeting_ok(m, principal, visible)]
    ids = {i for m in rows for i in m.participant_ids}
    names = {a.id: a for a in (await db.scalars(select(Agent).where(Agent.id.in_(ids))))}
    return [await _meeting_out(db, m, names=names) for m in rows]


@router.post("/meetings", status_code=status.HTTP_201_CREATED)
async def start_meeting(
    body: MeetingIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if body.task_id:
        t = await db.get(Task, body.task_id)
        if t is None or t.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_task", "Pick a task from here.")
    for aid in body.participant_ids:
        await _seen_agent(db, principal, aid)
    try:
        people = await meetings.resolve_agents(db, principal.workspace_id, body.participant_ids)
        m = await meetings.create(
            db,
            principal.workspace_id,
            body.topic,
            people,
            principal.actor,
            task_id=body.task_id,
            rounds=body.rounds,
            token_budget=body.token_budget,
        )
    except meetings.MeetingError as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_meeting", str(e)) from e
    try:
        await dispatch.start_meeting(m.id)
    except Exception as e:
        msg = "The worker service is not reachable."
        m.status, m.error = "failed", msg
        await db.commit()
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "temporal_unavailable", msg) from e
    await audit.record(db, principal.workspace_id, principal.actor, "meeting.started", target=m.id)
    await db.commit()
    return await _meeting_out(db, m, with_turns=True)


@router.get("/meetings/{meeting_id}")
async def meeting_detail(
    meeting_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await _meeting_out(db, await _meeting(db, principal, meeting_id), with_turns=True)


@router.post("/meetings/{meeting_id}/interject")
async def interject(
    meeting_id: str,
    body: InterjectIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A person adds a line; every agent reads it from its next turn."""
    m = await _meeting(db, principal, meeting_id)
    if m.status != "running":
        raise api_error(status.HTTP_409_CONFLICT, "meeting_over", "This meeting has ended.")
    db.add(
        MeetingTurn(
            meeting_id=m.id,
            round=m.rounds_done + 1,
            speaker=principal.actor,
            name=principal.user.name,
            kind="human",
            content=body.text.strip(),
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await events.publish(
        m.workspace_id,
        "meeting.turn",
        {
            "meeting_id": m.id,
            "name": principal.user.name,
            "kind": "human",
            "content": body.text,
            "participants": m.participant_ids,
        },
    )
    return await _meeting_out(db, m, with_turns=True)


@router.post("/meetings/{meeting_id}/cancel")
async def cancel_meeting(
    meeting_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    m = await _meeting(db, principal, meeting_id)
    await meetings.cancel(db, m)  # the workflow stops at its next turn
    return await _meeting_out(db, m, with_turns=True)


# ---------------------------------------------------------------- schedules


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    agent_id: str
    title: str = Field(min_length=1, max_length=180)
    brief: str = Field(default="", max_length=8000)
    cron: str = Field(min_length=9, max_length=120)
    timezone: str | None = None
    enabled: bool = True
    requires_review: bool = True


class ScheduleUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    agent_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    brief: str | None = Field(default=None, max_length=8000)
    cron: str | None = Field(default=None, min_length=9, max_length=120)
    timezone: str | None = None
    enabled: bool | None = None
    requires_review: bool | None = None


async def _schedule_out(db: AsyncSession, s: Schedule) -> dict[str, Any]:
    agent = await db.get(Agent, s.agent_id)
    last = await db.scalar(
        select(JobRun).where(JobRun.schedule_id == s.id).order_by(JobRun.id.desc()).limit(1)
    )
    try:
        nxt = [t.isoformat() for t in schedules.next_runs(s.cron, s.timezone)] if s.enabled else []
    except schedules.ScheduleError:
        nxt = []
    return {
        "id": s.id,
        "name": s.name,
        "agent_id": s.agent_id,
        "agent_name": agent.name if agent else "Removed agent",
        "agent_color": agent.color if agent else "#888888",
        "title": s.title,
        "brief": s.brief,
        "cron": s.cron,
        "timezone": s.timezone,
        "enabled": s.enabled,
        "requires_review": s.requires_review,
        "last_run_at": s.last_run_at,
        "last_status": last.status if last else None,
        "next_runs": nxt,
        "created_at": s.created_at,
    }


async def _schedule(db: AsyncSession, principal: Principal, schedule_id: str) -> Schedule:
    s = await db.get(Schedule, schedule_id)
    agent = await db.get(Agent, s.agent_id) if s else None
    if (
        s is None
        or s.workspace_id != principal.workspace_id
        or not principal.scope.sees_agent(agent)
    ):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "schedule_not_found", "That schedule is not here."
        )
    return s


async def _sync(db: AsyncSession, s: Schedule) -> None:
    try:
        await dispatch.upsert_schedule(s.id, s.cron, s.timezone, s.enabled, s.name)
    except Exception as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "temporal_unavailable",
            "Saved, but the worker service is not reachable, so it will not run yet. Save again "
            "in a moment.",
        ) from e


@router.get("/schedules")
async def list_schedules(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(Schedule)
            .where(Schedule.workspace_id == principal.workspace_id)
            .order_by(Schedule.created_at)
        )
    ).all()
    visible = await _visible(db, principal)
    return [await _schedule_out(db, s) for s in rows if visible is None or s.agent_id in visible]


@router.get("/schedules/preview")
async def preview_cron(
    cron: str,
    tz: str | None = None,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    zone = tz or (await _ws(db, principal.workspace_id)).timezone
    try:
        return {"ok": True, "next": [t.isoformat() for t in schedules.next_runs(cron, zone, 5)]}
    except schedules.ScheduleError as e:
        return {"ok": False, "error": str(e), "next": []}


@router.post("/schedules", status_code=status.HTTP_201_CREATED)
async def create_schedule(
    body: ScheduleIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    agent = await _seen_agent(db, principal, body.agent_id)
    tz = body.timezone or (await _ws(db, principal.workspace_id)).timezone
    try:
        schedules.next_runs(body.cron, tz)
    except schedules.ScheduleError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_cron", str(e)) from e
    s = Schedule(
        workspace_id=principal.workspace_id,
        name=body.name.strip(),
        agent_id=agent.id,
        title=body.title.strip(),
        brief=body.brief,
        cron=" ".join(body.cron.split()),
        timezone=tz,
        enabled=body.enabled,
        requires_review=body.requires_review,
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
        after={"name": s.name, "cron": s.cron, "agent": s.agent_id},
    )
    await db.commit()
    await _sync(db, s)
    return await _schedule_out(db, s)


@router.patch("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    body: ScheduleUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    s = await _schedule(db, principal, schedule_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "agent_id" in changes:
        await _seen_agent(db, principal, changes["agent_id"])
    if "cron" in changes:
        changes["cron"] = " ".join(changes["cron"].split())
    try:
        schedules.next_runs(changes.get("cron", s.cron), changes.get("timezone", s.timezone))
    except schedules.ScheduleError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_cron", str(e)) from e
    before = {k: getattr(s, k) for k in changes}
    for k, v in changes.items():
        setattr(s, k, v)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "schedule.updated",
        target=s.id,
        before={k: v for k, v in before.items() if k != "brief"},
        after={k: v for k, v in changes.items() if k != "brief"},
    )
    await db.commit()
    await db.refresh(s)
    await _sync(db, s)
    return await _schedule_out(db, s)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    s = await _schedule(db, principal, schedule_id)
    try:
        await dispatch.delete_schedule(s.id)
    except Exception as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "temporal_unavailable",
            "The worker service is not reachable; try again so the schedule really stops.",
        ) from e
    await audit.record(db, principal.workspace_id, principal.actor, "schedule.deleted", target=s.id)
    await db.delete(s)
    await db.commit()


@router.post("/schedules/{schedule_id}/run")
async def run_now(
    schedule_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    s = await _schedule(db, principal, schedule_id)
    try:
        await dispatch.run_schedule_now(s.id)
    except Exception as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "temporal_unavailable",
            "The worker service is not reachable.",
        ) from e
    await audit.record(db, principal.workspace_id, principal.actor, "schedule.run", target=s.id)
    await db.commit()
    return await _schedule_out(db, s)


# ---------------------------------------------------------------- the ledger


def _run_out(r: JobRun, names: dict[str, str], titles: dict[str, str]) -> dict[str, Any]:
    return {
        "id": r.id,
        "job": r.job,
        "schedule_id": r.schedule_id,
        "schedule_name": names.get(r.schedule_id or "") or (r.detail or {}).get("name"),
        "status": r.status,
        "task_id": r.task_id,
        "task_title": titles.get(r.task_id or ""),
        "attempt": r.attempt,
        "error": r.error,
        "detail": r.detail,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
    }


@router.get("/runs")
async def list_runs(
    job: str | None = None,
    schedule_id: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    q = select(JobRun).where(JobRun.workspace_id == principal.workspace_id)
    if job:
        q = q.where(JobRun.job == job)
    if schedule_id:
        q = q.where(JobRun.schedule_id == schedule_id)
    if status_:
        q = q.where(JobRun.status.in_(status_.split(",")))
    visible = await _visible(db, principal)
    if visible is not None:  # office roles: only runs of schedules they can see
        q = q.where(
            JobRun.schedule_id.in_(
                select(Schedule.id).where(Schedule.agent_id.in_(visible or {""}))
            )
        )
    rows = (await db.scalars(q.order_by(JobRun.id.desc()).limit(limit))).all()
    sids = {r.schedule_id for r in rows if r.schedule_id}
    tids = {r.task_id for r in rows if r.task_id}
    names = dict(
        (await db.execute(select(Schedule.id, Schedule.name).where(Schedule.id.in_(sids)))).all()
    )
    titles = dict((await db.execute(select(Task.id, Task.title).where(Task.id.in_(tids)))).all())
    return [_run_out(r, names, titles) for r in rows]


@router.get("/system-jobs")
async def system_jobs(
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    try:
        info = await dispatch.describe_schedules(list(schedules.SYSTEM_JOBS))
        reachable = True
    except Exception:  # noqa: BLE001 - show the list anyway
        info, reachable = {}, False
    last = dict(
        (
            await db.execute(
                select(JobRun.job, func.max(JobRun.started_at))
                .where(JobRun.workspace_id == principal.workspace_id)
                .group_by(JobRun.job)
            )
        ).all()
    )
    return [
        {
            "id": sid,
            "description": desc,
            "reachable": reachable,
            "paused": info.get(sid, {}).get("paused"),
            "next": info.get(sid, {}).get("next", []),
            "recent": info.get(sid, {}).get("recent", []),
            "last_logged": last.get(sid.removeprefix("agent-")),
        }
        for sid, desc in schedules.SYSTEM_JOBS.items()
    ]


@router.get("/incidents")
async def list_incidents(
    open_only: bool = False,
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    q = select(Incident).where(Incident.workspace_id == principal.workspace_id)
    if open_only:
        q = q.where(Incident.resolved_at.is_(None))
    rows = (await db.scalars(q.order_by(Incident.last_seen.desc()).limit(200))).all()
    return [
        {
            "id": i.id,
            "signature": i.signature,
            "title": i.title,
            "count": i.count,
            "first_seen": i.first_seen,
            "last_seen": i.last_seen,
            "resolved_at": i.resolved_at,
        }
        for i in rows
    ]


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: int,
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    i = await db.get(Incident, incident_id)
    if i is None or i.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "incident_not_found", "Not here.")
    i.resolved_at = datetime.now(UTC)
    await audit.record(
        db, principal.workspace_id, principal.actor, "incident.resolved", target=str(i.id)
    )
    await db.commit()
    await events.publish(principal.workspace_id, "incident.updated", {"id": i.id})
    return {"id": i.id, "resolved_at": i.resolved_at}


# ---------------------------------------------------------------- pings and budgets


@router.get("/pings")
async def list_pings(
    include_resolved: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    q = (
        select(AgentPing, Agent)
        .join(Agent, Agent.id == AgentPing.agent_id)
        .where(AgentPing.workspace_id == principal.workspace_id)
    )
    if not include_resolved:
        q = q.where(AgentPing.resolved_at.is_(None))
    cond = principal.scope.agent_where()
    if cond is not None:
        q = q.where(cond)
    rows = (await db.execute(q.order_by(AgentPing.created_at.desc()).limit(100))).all()
    return [
        {
            "id": p.id,
            "agent_id": a.id,
            "agent_name": a.name,
            "agent_color": a.color,
            "kind": p.kind,
            "message": p.message,
            "created_at": p.created_at,
            "resolved_at": p.resolved_at,
        }
        for p, a in rows
    ]


class ResolvePingIn(BaseModel):
    action: Literal["dismiss", "done"] = "dismiss"


@router.post("/pings/{ping_id}/resolve")
async def resolve_ping(
    ping_id: str,
    body: ResolvePingIn | None = None,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    p = await db.get(AgentPing, ping_id)
    if p is None or p.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "ping_not_found", "Not here.")
    await _seen_agent(db, principal, p.agent_id)
    p.resolved_at, p.resolved_by = datetime.now(UTC), principal.actor
    await db.commit()
    await events.publish(principal.workspace_id, "agent.ping", {"id": p.id, "resolved": True})
    return {"id": p.id, "resolved_at": p.resolved_at}


async def _usage_by_day(db: AsyncSession, agent_id: str, tz: str, days: int = 14) -> list[dict]:
    p = budget.periods(tz)
    start = p.day_start.timestamp() - (days - 1) * 86400
    day = func.date(func.timezone(tz, LLMCall.ts))
    rows = (
        await db.execute(
            select(
                day,
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
            )
            .where(
                LLMCall.agent_id == agent_id,
                LLMCall.ts >= datetime.fromtimestamp(start, UTC),
            )
            .group_by(day)
            .order_by(day)
        )
    ).all()
    return [{"day": str(d), "tokens": int(t or 0), "usd": float(u or 0)} for d, t, u in rows]


@router.get("/agents/{agent_id}/budget")
async def agent_budget(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    a = await _seen_agent(db, principal, agent_id)
    ws = await _ws(db, principal.workspace_id)
    st = await budget.state(db, a, ws.timezone)
    return {**st.dict(), "by_day": await _usage_by_day(db, a.id, ws.timezone)}


@router.get("/budgets")
async def budgets(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Spend against budget for every active agent (the command center card)."""
    ws = await _ws(db, principal.workspace_id)
    out = []
    for a in (
        await db.scalars(
            select(Agent)
            .where(
                Agent.workspace_id == ws.id,
                Agent.status != "retired",
                Agent.clone_of.is_(None),
                *([c] if (c := principal.scope.agent_where()) is not None else []),
            )
            .order_by(Agent.name)
        )
    ).all():
        st = await budget.state(db, a, ws.timezone)
        out.append({"agent_id": a.id, "name": a.name, "color": a.color, **st.dict()})
    return out
