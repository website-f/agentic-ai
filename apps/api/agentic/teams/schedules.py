"""Recurring work and the cron ledger (Hermes pattern).

A Schedule row is mirrored as a Temporal Schedule (cron + time zone). Each firing writes a
JobRun row, claimed -> running -> completed | failed, and creates a fresh task. A failed run
is retried at 5, 15 and 30 minutes (same task, same conversation). Failures are grouped into
incidents by signature, so 50 identical failures raise one alert.
"""

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cronsim import CronSim, CronSimError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import work_hours
from ..core.db import SessionLocal
from ..models import Agent, Incident, JobRun, Schedule, Task
from ..services import events

log = logging.getLogger("agentic.teams.schedules")

RETRY_DELAYS = (0, 300, 900, 1800)  # first try, then +5, +15, +30 minutes
SYSTEM_JOBS = {
    "provider-health": "Checks every AI provider (every 30 minutes)",
    "brain-dream": "Nightly memory consolidation, per workspace (hourly tick)",
    "agent-heartbeat": "Agents with heartbeat pick up queued work (hourly, work hours)",
}


class ScheduleError(ValueError):
    pass


# ---------------------------------------------------------------- who set a schedule up
# Schedule.created_by is "user:<id>" for one made on the Schedules page. One an agent made
# when a person asked (agents/schedule_tools.py) reads "agent:<id>|for:<person>|chat[|once]":
# the agent that runs it, the person who gets each result, where they asked (chat | task),
# and whether it runs only once (then it switches itself off after firing).


@dataclass(frozen=True)
class Origin:
    agent_id: str | None = None  # the agent that set it up (always the one that runs it)
    person: str | None = None  # the person it reports to (asked for it, or made it)
    via: str = "page"  # page | chat | task
    once: bool = False


def by_agent(agent_id: str, person: str | None, via: str, once: bool) -> str:
    parts = [f"agent:{agent_id}", *([f"for:{person}"] if person else []), via]
    return "|".join([*parts, "once"] if once else parts)


def origin(created_by: str | None) -> Origin:
    raw = created_by or ""
    if raw.startswith("user:"):
        return Origin(person=raw.removeprefix("user:"))
    if not raw.startswith("agent:"):
        return Origin(via="other")
    parts = raw.split("|")
    person = next((p.removeprefix("for:") for p in parts if p.startswith("for:")), None)
    via = next((p for p in parts[1:] if p in ("chat", "task")), "task")
    return Origin(parts[0].removeprefix("agent:"), person, via, "once" in parts[1:])


def next_runs(cron: str, tz: str, n: int = 3, after: datetime | None = None) -> list[datetime]:
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ScheduleError(f"Unknown time zone {tz!r}.") from e
    expr = " ".join(cron.split())
    if len(expr.split(" ")) != 5:
        raise ScheduleError("Use five cron fields: minute hour day month weekday.")
    try:
        it = CronSim(expr, (after or datetime.now(UTC)).astimezone(zone))
        out = [next(it) for _ in range(n)]
    except (CronSimError, StopIteration) as e:
        raise ScheduleError(f"That cron expression is not valid ({e}).") from e
    if len(out) >= 2 and (out[1] - out[0]).total_seconds() < 15 * 60:
        raise ScheduleError("Run at most every 15 minutes.")
    return out


def signature(job: str, key: str, error: str | None) -> str:
    norm = re.sub(r"\b[a-z]{2}_[0-9a-z]+\b", "#", (error or "unknown").lower())
    norm = re.sub(r"\d+", "#", norm)[:200]
    return hashlib.sha256(f"{job}:{key}:{norm}".encode()).hexdigest()[:16]


async def record_incident(db: AsyncSession, ws_id: str, sig: str, title: str) -> bool:
    """True when this is a new incident or a resolved one came back (worth a notification)."""
    now = datetime.now(UTC)
    inc = await db.scalar(
        select(Incident).where(Incident.workspace_id == ws_id, Incident.signature == sig)
    )
    if inc is None:
        try:
            async with db.begin_nested():
                db.add(
                    Incident(
                        workspace_id=ws_id,
                        signature=sig,
                        title=title[:300],
                        first_seen=now,
                        last_seen=now,
                    )
                )
                await db.flush()
            await db.commit()
            return True
        except IntegrityError:
            inc = await db.scalar(
                select(Incident).where(Incident.workspace_id == ws_id, Incident.signature == sig)
            )
            assert inc is not None
    reopened = inc.resolved_at is not None
    inc.count += 1
    inc.last_seen = now
    inc.resolved_at = None
    await db.commit()
    return reopened


async def claim(schedule_id: str, manual: bool) -> dict[str, str] | None:
    from ..agents import runtime

    async with SessionLocal() as db:
        s = await db.get(Schedule, schedule_id)
        if s is None or (not s.enabled and not manual):
            return None
        now = datetime.now(UTC)
        agent = await db.get(Agent, s.agent_id)
        run = JobRun(
            workspace_id=s.workspace_id,
            job="schedule",
            schedule_id=s.id,
            status="claimed",
            started_at=now,
            detail={"name": s.name, "manual": manual},
        )
        db.add(run)
        s.last_run_at = now
        if agent is None or agent.status != "active":
            run.status, run.finished_at = "failed", now
            run.error = "The agent for this schedule is not active."
            run.signature = signature("schedule", s.id, run.error)
            await db.commit()
            await _incident(db, run, s.name)
            return None
        lowest = (
            await db.scalar(
                select(func.min(Task.position)).where(Task.workspace_id == s.workspace_id)
            )
            or 0
        )
        local = now.astimezone(ZoneInfo(s.timezone))
        # P19: an off-duty agent starts the run at its next shift (the workflow sleeps until
        # then). A schedule marked urgent runs now when the agent's hours allow urgent work.
        urgent = work_hours.schedule_is_urgent(s.name, s.title)
        later = work_hours.deferred_until(now, agent.work_hours, urgent)
        t = Task(
            workspace_id=s.workspace_id,
            branch_id=agent.branch_id,
            title=f"{s.title} ({local:%d %b})"[:200],
            brief=s.brief,
            priority="urgent" if urgent else "normal",
            blocked_reason=work_hours.waiting_note(agent.name, later, now, agent.work_hours or {})
            if later
            else None,
            status="ready",
            assignee_agent_id=agent.id,
            created_by=f"schedule:{s.id}",
            source="schedule",
            requires_review=s.requires_review,
            schedule_id=s.id,
            position=float(lowest) - 1,
        )
        db.add(t)
        await db.flush()
        run.task_id = t.id
        if later:
            run.detail = {**(run.detail or {}), "waits_until": later.isoformat()}
        once = origin(s.created_by).once and not manual
        if once:  # a one-off ("remind me Friday 4pm") switches itself off after firing
            s.enabled = False
        await db.commit()
        if once:
            await _pause(s)
        await runtime.task_event(db, t, "created", "system", f"created by the schedule {s.name}")
        await events.publish(
            s.workspace_id, "task.created", {"task_id": t.id, "agent_id": t.assignee_agent_id}
        )
        await _publish(run)
        out = {"run_id": str(run.id), "task_id": t.id}
        if later:
            out["wait_until"] = later.isoformat()
        return out


async def attempt(run_id: str, n: int) -> str:
    """Start (or retry) the run's task: returns the child workflow id to use."""
    from ..agents import runtime

    async with SessionLocal() as db:
        run = await db.get(JobRun, int(run_id))
        assert run is not None and run.task_id
        t = await db.get(Task, run.task_id)
        assert t is not None
        t.run_count += 1
        t.workflow_id = f"task-{t.id}-{t.run_count}"
        t.status = "ready"
        t.result = t.error = t.blocked_reason = None
        run.status, run.attempt = "running", n
        await db.commit()
        note = f"started run {t.run_count}" + (f" (retry {n - 1})" if n > 1 else "")
        await runtime.task_event(db, t, "run", "system", note)
        await _publish(run)
        return f"task-{t.id}-{t.run_count}"


async def finish(run_id: str, state: str) -> None:
    async with SessionLocal() as db:
        run = await db.get(JobRun, int(run_id))
        if run is None:
            return
        t = await db.get(Task, run.task_id) if run.task_id else None
        s = await db.get(Schedule, run.schedule_id) if run.schedule_id else None
        run.finished_at = datetime.now(UTC)
        if state == "done":
            run.status, run.error = "completed", None
        else:
            run.status = "failed"
            run.error = (t.error if t else None) or f"The task ended as {state}."
            run.signature = signature("schedule", run.schedule_id or "", run.error)
        await db.commit()
        await _publish(run)
        if run.status == "failed":
            await _incident(db, run, s.name if s else "A scheduled job")
        if s is not None and t is not None and state != "cancelled":
            await _report_to_person(db, s, t, run)


async def _pause(s: Schedule) -> None:
    """Pause a fired one-off in Temporal too (best effort: the row is already off, so a
    stray firing is skipped by claim anyway)."""
    from ..agents import dispatch  # late: dispatch imports the workflows

    try:
        await dispatch.upsert_schedule(s.id, s.cron, s.timezone, False, s.name)
    except Exception:  # noqa: BLE001
        log.warning("could not pause the one-off schedule %s", s.id, exc_info=True)


async def _report_to_person(db: AsyncSession, s: Schedule, t: Task, run: JobRun) -> None:
    """A schedule an agent set up for a person sends them each result (or the failure)."""
    from ..channels import deliver

    o = origin(s.created_by)
    if o.agent_id is None or not o.person:
        return
    agent = await db.get(Agent, s.agent_id)
    who = agent.name if agent else "Your agent"
    if run.status == "completed":
        title = f"{who}: {s.title}"[:120]
        body = (t.result or "Done.").strip()
    else:
        title = f"{who} could not finish: {s.title}"[:120]
        body = (run.error or "It failed.").strip()
    body = body[:1500] + ("…" if len(body) > 1500 else "")
    try:
        await deliver.start(
            await deliver.notify_user(
                db,
                s.workspace_id,
                o.person,
                title,
                body,
                f"/tasks?task={t.id}",
                dedupe=f"schedule-result:{run.id}",
            )
        )
    except Exception:  # noqa: BLE001 - a notice must never fail the run's bookkeeping
        log.warning("could not send the result of schedule %s", s.id, exc_info=True)


async def _incident(db: AsyncSession, run: JobRun, name: str) -> None:
    from ..channels import deliver

    if not run.workspace_id or not run.signature:
        return
    title = f"{name}: {run.error or 'failed'}"
    if await record_incident(db, run.workspace_id, run.signature, title):
        await deliver.start(
            await deliver.notify_people(
                db,
                run.workspace_id,
                f"Scheduled job failed: {name}",
                (run.error or "It failed.")[:300],
                "/schedules?tab=incidents",
                dedupe=f"incident:{run.signature}:{run.id}",
                perm="work.write",
            )
        )
    await events.publish(run.workspace_id, "incident.updated", {"signature": run.signature})


async def _publish(run: JobRun) -> None:
    if run.workspace_id:
        await events.publish(
            run.workspace_id,
            "job_run.updated",
            {"id": run.id, "status": run.status, "schedule_id": run.schedule_id},
        )
