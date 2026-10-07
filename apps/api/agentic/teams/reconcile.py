"""P21 liveness reconciler: never leave work where nobody is responsible for the next move and
nothing will wake it. Runs every 10 minutes (the `liveness-reconcile` schedule, worker.py).

1. A task that says "running" but whose Temporal workflow is gone (a worker crash, a restore)
   gets one automatic relaunch per run (a `reconcile` task event). If the run the reconciler
   started stops the same way, the task goes to `blocked` with blocked_owner = its creator and
   the action "Stopped unexpectedly twice: retry or reassign", and the owner is notified.
2. A running task with no agent activity (agent.activity events, task events, model calls,
   its sub-tasks' and meetings' activity) for 15 minutes is marked silent: a `silent` task
   event the monitor shows as "Quiet for 18 min". Silent runs are never stopped. Idempotent:
   the event carries a fingerprint (run + last activity time), so one quiet spell is
   reported once, and new activity followed by a new quiet spell is reported again.

3. P29: a task `blocked` on a pending approval whose workflow is gone (nobody would ever
   receive the decision) is treated like 1: one relaunch (the new run waits on the same
   approval), then its owner.

Temporal unreachable: the run is skipped entirely (nothing is relaunched or blocked blind).
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import Approval, Event, LLMCall, Meeting, MeetingTurn, Task, TaskEvent

log = logging.getLogger("agentic.teams.reconcile")

ACTOR = "system:reconcile"
SILENT_AFTER = timedelta(minutes=15)
# A run that just started may not have its workflow visible yet.
GRACE = timedelta(minutes=3)
STOPPED = "Stopped unexpectedly"
STOPPED_TWICE = f"{STOPPED} twice: retry or reassign"
# Our own bookkeeping is not agent activity.
NOT_ACTIVITY = ("silent", "reconcile")


def _now() -> datetime:
    return datetime.now(UTC)


async def workflow_open(workflow_id: str) -> bool | None:
    """True running, False gone/closed, None when Temporal cannot tell right now."""
    from temporalio.service import RPCError, RPCStatusCode

    from ..core.temporal import temporal_client

    client = await temporal_client()
    try:
        d = await client.get_workflow_handle(workflow_id).describe()
    except RPCError as e:
        return False if e.status == RPCStatusCode.NOT_FOUND else None
    return d.status is not None and d.status.name == "RUNNING"


async def last_activity(db: AsyncSession, t: Task) -> datetime | None:
    """The newest sign of life of a run: its (and its sub-tasks') events and model calls,
    the agent's live activity lines for it, and turns of meetings it called."""
    since = t.started_at or t.created_at
    kids = list((await db.scalars(select(Task.id).where(Task.parent_task_id == t.id))).all())
    ids = [t.id, *kids]
    stamps = [
        await db.scalar(
            select(func.max(TaskEvent.ts)).where(
                TaskEvent.task_id.in_(ids), TaskEvent.kind.not_in(NOT_ACTIVITY)
            )
        ),
        await db.scalar(
            select(func.max(LLMCall.ts)).where(
                LLMCall.workspace_id == t.workspace_id,
                LLMCall.task_id.in_(ids),
                LLMCall.ts >= since,
            )
        ),
        await db.scalar(
            select(func.max(Event.ts)).where(
                Event.workspace_id == t.workspace_id,
                Event.type == "agent.activity",
                Event.ts >= since,
                Event.data["task_id"].astext.in_(ids),
            )
        ),
        await db.scalar(
            select(func.max(MeetingTurn.created_at))
            .join(Meeting, Meeting.id == MeetingTurn.meeting_id)
            .where(Meeting.task_id == t.id)
        ),
    ]
    found = [s for s in stamps if s is not None]
    return max(found) if found else None


async def quiet_minutes(db: AsyncSession, t: Task, now: datetime | None = None) -> int | None:
    """Minutes a running task has been silent, when that is SILENT_AFTER or more (else None)."""
    if t.status != "running":
        return None
    now = now or _now()
    since = await last_activity(db, t) or t.started_at or t.updated_at
    if since is None or now - since < SILENT_AFTER:
        return None
    return int((now - since).total_seconds() // 60)


async def _mark_silent(db: AsyncSession, t: Task, now: datetime) -> bool:
    from ..agents import runtime

    since = await last_activity(db, t) or t.started_at or t.updated_at
    if since is None or now - since < SILENT_AFTER:
        return False
    fp = f"{t.run_count}:{since.isoformat()}"
    seen = await db.scalar(
        select(TaskEvent.id).where(
            TaskEvent.task_id == t.id,
            TaskEvent.kind == "silent",
            TaskEvent.data["fingerprint"].astext == fp,
        )
    )
    if seen is not None:
        return False
    mins = int((now - since).total_seconds() // 60)
    await runtime.task_event(
        db,
        t,
        "silent",
        ACTOR,
        f"has been quiet for {mins} min (no agent activity); still running, not stopped",
        {"fingerprint": fp, "since": since.isoformat(), "minutes": mins, "run": t.run_count},
    )
    return True


async def _gone(db: AsyncSession, t: Task) -> str:
    """The run's workflow is gone: relaunch once, or hand it to its owner."""
    from ..agents import launch, runtime
    from . import blockers

    last_run = await db.scalar(
        select(TaskEvent)
        .where(TaskEvent.task_id == t.id, TaskEvent.kind == "run")
        .order_by(TaskEvent.id.desc())
        .limit(1)
    )
    action = STOPPED_TWICE
    if last_run is None or last_run.actor != ACTOR:
        await runtime.task_event(
            db,
            t,
            "reconcile",
            ACTOR,
            f"run {t.run_count} stopped unexpectedly (its workflow is gone); starting it again",
            {"run": t.run_count, "action": "relaunched", "workflow_id": t.workflow_id},
        )
        t.status = "ready"  # launch only starts work that is not running
        await db.commit()
        try:
            await launch.launch(db, t, ACTOR)
            return "relaunched"
        except launch.LaunchError as e:
            action = f"{STOPPED} and could not restart ({e.message}): retry or reassign"[:300]
    await runtime.set_task_status(
        db,
        t,
        "blocked",
        actor=ACTOR,
        note="stopped unexpectedly again; a person decides what happens next",
        blocked_reason="The run stopped unexpectedly twice"
        if action == STOPPED_TWICE
        else action[:300],
        blocked_owner=t.created_by,
        blocked_action=action,
    )
    await runtime.task_event(
        db,
        t,
        "reconcile",
        ACTOR,
        "handed it to its owner",
        {"run": t.run_count, "action": "blocked"},
    )
    await blockers.notify_owner(
        db,
        t,
        f"Stopped unexpectedly: {t.title}"[:120],
        "The run stopped unexpectedly twice. Retry it or give it to another agent.",
        dedupe=f"stopped:{t.id}:{t.run_count}",
    )
    return "blocked"


async def tick(now: datetime | None = None) -> dict[str, int]:
    now = now or _now()
    totals = {"checked": 0, "relaunched": 0, "blocked": 0, "silent": 0}
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(Task)
                .where(Task.status == "running", Task.updated_at < now - GRACE)
                .order_by(Task.updated_at)
                .limit(500)
            )
        ).all()
        waiting = await _waiting_on_approval(db, now)
        alive: list[Task] = []
        for t in [*rows, *waiting]:
            totals["checked"] += 1
            try:
                open_ = await workflow_open(t.workflow_id) if t.workflow_id else False
            except Exception:  # noqa: BLE001 - Temporal is down: never act blind
                log.warning("Temporal not reachable; skipping the liveness check", exc_info=True)
                return totals
            if open_ is None:
                continue
            if open_:
                if t.status == "running":
                    alive.append(t)
                continue
            try:
                totals[await _gone(db, t)] += 1
            except Exception:  # noqa: BLE001 - one bad task must not stop the round
                log.warning("could not reconcile %s", t.id, exc_info=True)
        for t in alive:
            try:
                totals["silent"] += int(await _mark_silent(db, t, now))
            except Exception:  # noqa: BLE001
                log.warning("could not check %s for silence", t.id, exc_info=True)
    return totals


async def _waiting_on_approval(db: AsyncSession, now: datetime) -> list[Task]:
    """P29: blocked tasks whose run waits on a pending approval (not the ones parked behind
    blockers or already handed to a person: those have no run on purpose)."""
    from ..agents import launch

    pending = select(Approval.task_id).where(Approval.status == "pending")
    rows = (
        await db.scalars(
            select(Task)
            .where(
                Task.status == "blocked",
                Task.updated_at < now - GRACE,
                Task.id.in_(pending),
            )
            .order_by(Task.updated_at)
            .limit(500)
        )
    ).all()
    return [t for t in rows if not launch.restartable(t)]
