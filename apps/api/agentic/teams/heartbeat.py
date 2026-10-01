"""Heartbeats: once an hour, during work hours in the workspace's time zone, every agent with
heartbeat on either picks up its oldest queued task or (once a day) asks for work."""

import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from ..core.db import SessionLocal
from ..models import Agent, JobRun, Task, Workspace
from . import budget

log = logging.getLogger("agentic.teams.heartbeat")

DEFAULT_HOURS = {"days": [0, 1, 2, 3, 4], "start": 9, "end": 18}  # Mon-Fri 09:00-18:00
IDLE_MESSAGE = "Nothing in my queue. What should I pick up, boss?"
OPEN = ("triage", "ready", "running", "blocked")
# Started by their parent or their schedule, never by a heartbeat.
NOT_FOR_HEARTBEAT = ("delegation", "schedule")


def work_hours(ws: Workspace) -> dict:
    h = (ws.settings or {}).get("work_hours") or {}
    return {**DEFAULT_HOURS, **{k: v for k, v in h.items() if k in DEFAULT_HOURS}}


def in_work_hours(ws: Workspace, now: datetime) -> bool:
    h = work_hours(ws)
    local = now.astimezone(ZoneInfo(ws.timezone))
    return local.weekday() in h["days"] and int(h["start"]) <= local.hour < int(h["end"])


async def tick(now: datetime | None = None) -> dict[str, int]:
    from ..agents import launch  # late: launch imports the runtime
    from ..channels import deliver

    now = now or datetime.now(UTC)
    totals = {"workspaces": 0, "started": 0, "pinged": 0}
    async with SessionLocal() as db:
        for ws in (await db.scalars(select(Workspace))).all():
            if not in_work_hours(ws, now):
                continue
            agents = (
                await db.scalars(
                    select(Agent).where(
                        Agent.workspace_id == ws.id,
                        Agent.status == "active",
                        Agent.heartbeat.is_(True),
                    )
                )
            ).all()
            if not agents:
                continue
            totals["workspaces"] += 1
            run = JobRun(workspace_id=ws.id, job="heartbeat", status="running", started_at=now)
            db.add(run)
            await db.commit()
            started = pinged = 0
            errors: list[str] = []
            day = budget.periods(ws.timezone, now).day
            for a in agents:
                tasks = (
                    await db.scalars(
                        select(Task)
                        .where(Task.assignee_agent_id == a.id, Task.status.in_(OPEN))
                        .order_by(Task.created_at)
                    )
                ).all()
                if any(t.status in ("running", "blocked") for t in tasks):
                    continue
                queued = [
                    t
                    for t in tasks
                    if t.status == "ready"
                    and t.run_count == 0
                    and t.source not in NOT_FOR_HEARTBEAT
                ]
                if queued:
                    try:
                        await launch.launch(db, queued[0], f"agent:{a.id}")
                        started += 1
                    except launch.LaunchError as e:
                        errors.append(f"{a.name}: {e.message}")
                    continue
                if tasks:
                    continue  # triage work waits for a person to assign it properly
                if await budget.ping_once(db, a, "idle", day, IDLE_MESSAGE):
                    pinged += 1
                    await deliver.start(
                        await deliver.notify_people(
                            db,
                            ws.id,
                            f"{a.name} is free",
                            IDLE_MESSAGE,
                            f"/agents/{a.id}",
                            dedupe=f"idle:{a.id}:{day}",
                            perm="work.write",
                        )
                    )
            run.status = "failed" if errors and not started else "completed"
            run.error = "; ".join(errors)[:2000] or None
            run.detail = {"started": started, "pinged": pinged, "agents": len(agents)}
            run.finished_at = datetime.now(UTC)
            await db.commit()
            totals["started"] += started
            totals["pinged"] += pinged
    return totals
