"""Recurring work and the cron ledger (Hermes pattern).

A Schedule row is mirrored as a Temporal Schedule (cron + time zone). Each firing writes a
JobRun row, claimed -> running -> completed | failed, and creates a fresh task. A failed run
is retried at 5, 15 and 30 minutes (same task, same conversation). Failures are grouped into
incidents by signature, so 50 identical failures raise one alert.
"""

import hashlib
import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cronsim import CronSim, CronSimError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import Agent, Incident, JobRun, Schedule, Task
from ..services import events

RETRY_DELAYS = (0, 300, 900, 1800)  # first try, then +5, +15, +30 minutes
SYSTEM_JOBS = {
    "provider-health": "Checks every AI provider (every 30 minutes)",
    "brain-dream": "Nightly memory consolidation, per workspace (hourly tick)",
    "agent-heartbeat": "Agents with heartbeat pick up queued work (hourly, work hours)",
}


class ScheduleError(ValueError):
    pass


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
        t = Task(
            workspace_id=s.workspace_id,
            branch_id=agent.branch_id,
            title=f"{s.title} ({local:%d %b})"[:200],
            brief=s.brief,
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
        await db.commit()
        await runtime.task_event(db, t, "created", "system", f"created by the schedule {s.name}")
        await events.publish(s.workspace_id, "task.created", {"task_id": t.id})
        await _publish(run)
        return {"run_id": str(run.id), "task_id": t.id}


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
