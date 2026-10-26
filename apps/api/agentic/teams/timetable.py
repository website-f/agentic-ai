"""P47: an agent's working day, like a person's: when it works (its hours, breaks cut out),
what it does at set times (its duties: the schedules that run as it), and, if asked, a short
summary at the end of each working day of what it did (built from its tasks, no model).

- day_plan(): one agent, one date: working stretches, breaks, duties at their times (and
  whether each falls outside its hours, so it waits for the next shift unless urgent), and
  how much work waits for its shift to start.
- day_reports(): every 10 minutes (the liveness round): agents whose working day ended in the
  last half hour and that have `day_report` on get a Report ("day") and their person (a
  twin's or a private assistant's owner) or the people who manage agents get a notice. Once
  a day each (Valkey key + the report's call_id).
"""

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cronsim import CronSim, CronSimError
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import work_hours
from ..core.valkey import valkey
from ..i18n import Msg, tr
from ..models import Agent, Approval, Report, Schedule, Task, Workspace

log = logging.getLogger("agentic.teams.timetable")

REPORT_WINDOW = timedelta(minutes=30)  # a working day that ended this recently gets its report
MAX_DUTY_RUNS = 48  # in one day, per duty (every 15 minutes at the most)


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _runs_on(cron: str, tz: str, day: date) -> list[str]:
    """The times ("09:00") a cron fires on `day`, in its zone."""
    zone = _zone(tz)
    start = datetime.combine(day, time(0), zone)
    try:
        it = CronSim(" ".join(cron.split()), start - timedelta(seconds=1))
        out: list[str] = []
        for _ in range(MAX_DUTY_RUNS):
            at = next(it)
            if at.date() != day:
                break
            out.append(at.strftime("%H:%M"))
        return out
    except (CronSimError, StopIteration, ValueError):
        return []


async def day_plan(db: AsyncSession, agent: Agent, day: date, ws_tz: str) -> dict[str, Any]:
    wh = agent.work_hours
    tz = (wh or {}).get("tz") or ws_tz
    works = wh is None or day.isoweekday() in (wh.get("days") or [])
    stretches = (
        [{"start": _hhmm(a), "end": _hhmm(b)} for a, b in work_hours.segments(wh)]
        if wh and works
        else ([{"start": "00:00", "end": "24:00"}] if wh is None else [])
    )
    breaks = list((wh or {}).get("breaks") or []) if wh and works else []
    duties: list[dict[str, Any]] = []
    for s in (
        await db.scalars(
            select(Schedule)
            .where(Schedule.agent_id == agent.id, Schedule.workspace_id == agent.workspace_id)
            .order_by(Schedule.created_at)
        )
    ).all():
        for at in _runs_on(s.cron, s.timezone or tz, day):
            inside = wh is None or any(
                _mins(x["start"]) <= _mins(at) < _mins(x["end"]) for x in stretches
            )
            duties.append(
                {
                    "schedule_id": s.id,
                    "time": at,
                    "title": s.title,
                    "name": s.name,
                    "enabled": s.enabled,
                    "outside_hours": not inside,
                    "urgent": work_hours.schedule_is_urgent(s.name, s.title),
                }
            )
    duties.sort(key=lambda d: d["time"])
    waiting = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.assignee_agent_id == agent.id,
                Task.status == "ready",
                Task.blocked_reason.like("Starts when %"),
            )
        )
        or 0
    )
    return {
        "agent_id": agent.id,
        "name": agent.name,
        "role": agent.role,
        "color": agent.color,
        "is_twin": agent.is_twin,
        "status": agent.status,
        "date": day.isoformat(),
        "tz": tz,
        "any_time": wh is None,
        "works": works,
        "hours": stretches,
        "breaks": breaks,
        "work_hours": wh,
        "label": work_hours.describe(wh) if wh else None,
        "duties": duties,
        "waiting_for_shift": waiting,
        "day_report": bool((wh or {}).get("day_report")),
    }


async def office_day(
    db: AsyncSession, ws: Workspace, day: date, agents_where: ColumnElement[bool] | None
) -> list[dict[str, Any]]:
    q = select(Agent).where(
        Agent.workspace_id == ws.id, Agent.status != "retired", Agent.clone_of.is_(None)
    )
    if agents_where is not None:
        q = q.where(agents_where)
    agents = (await db.scalars(q.order_by(Agent.name))).all()
    return [await day_plan(db, a, day, ws.timezone) for a in agents]


# ---------------------------------------------------------------- the end-of-day summary


async def _summary(
    db: AsyncSession, agent: Agent, start: datetime, end: datetime, lang: str
) -> tuple[str, str, list[list[Any]]]:
    done = (
        await db.scalars(
            select(Task)
            .where(
                Task.assignee_agent_id == agent.id,
                Task.status == "done",
                Task.finished_at >= start,
                Task.finished_at < end,
            )
            .order_by(Task.finished_at)
            .limit(30)
        )
    ).all()
    failed = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.assignee_agent_id == agent.id,
                Task.status == "failed",
                Task.finished_at >= start,
                Task.finished_at < end,
            )
        )
        or 0
    )
    blocked = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.assignee_agent_id == agent.id, Task.status == "blocked")
        )
        or 0
    )
    asking = (
        await db.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.agent_id == agent.id, Approval.status == "pending")
        )
        or 0
    )
    headline = tr(
        "{name} finished {done} tasks today. {failed} failed, {blocked} wait for a person and "
        "{asking} approvals are open.",
        lang,
        name=agent.name,
        done=len(done),
        failed=failed,
        blocked=blocked,
        asking=asking,
    )
    body = "\n".join([headline, "", *[f"- {t.title}" for t in done]]).strip()
    rows = [[t.title, t.finished_at.isoformat() if t.finished_at else ""] for t in done]
    return headline, body, rows


async def day_reports(db: AsyncSession, now: datetime | None = None) -> int:
    """Agents whose working day just ended, with `day_report` on: a Report and a notice."""
    from ..channels import deliver
    from ..documents import provenance

    now = now or datetime.now(UTC)
    made = 0
    agents = (
        await db.scalars(
            select(Agent).where(Agent.status == "active", Agent.work_hours.is_not(None))
        )
    ).all()
    for a in agents:
        wh = a.work_hours or {}
        if not wh.get("day_report"):
            continue
        local = now.astimezone(_zone(wh.get("tz") or "UTC"))
        if local.isoweekday() not in (wh.get("days") or []):
            continue
        end = datetime.combine(local.date(), time(0), local.tzinfo) + timedelta(
            minutes=_mins(wh["end"])
        )
        if not (end <= local < end + REPORT_WINDOW):
            continue
        key = f"dayreport:{a.id}:{local.date().isoformat()}"
        if not await valkey().set(key, "1", nx=True, ex=2 * 86400):
            continue
        start = datetime.combine(local.date(), time(0), local.tzinfo).astimezone(UTC)
        lang = await provenance.folder_lang(db, a.workspace_id, a.branch_id)
        headline, body, rows = await _summary(db, a, start, now, lang)
        r = Report(
            workspace_id=a.workspace_id,
            branch_id=a.branch_id,
            agent_id=a.id,
            owner_user_id=a.owner_user_id if (a.is_twin or a.private) else None,
            call_id=f"day:{a.id}:{local.date().isoformat()}",
            title=tr("{name}'s day: {date}", lang, name=a.name, date=local.date().isoformat()),
            summary=headline[:600],
            body=body,
            tables=[
                {
                    "title": tr("Finished today", lang),
                    "columns": [tr("Task", lang), tr("Finished", lang)],
                    "rows": rows,
                }
            ],
            labels=["day", "agent"],
            created_at=now,
        )
        db.add(r)
        await db.commit()
        made += 1
        title = Msg("{name}'s day", name=a.name)
        url = f"/reports?r={r.id}"
        try:
            if a.owner_user_id and (a.is_twin or a.private):
                await deliver.notify_user(
                    db, a.workspace_id, a.owner_user_id, title, headline, url, dedupe=key
                )
            else:
                await deliver.notify_people(
                    db, a.workspace_id, title, headline, url, dedupe=key, perm="agents.manage"
                )
        except Exception:  # noqa: BLE001 - the report is saved whatever happens to the notice
            log.info("day report notice failed for %s", a.id, exc_info=True)
    return made


__all__ = ["day_plan", "day_reports", "office_day"]
