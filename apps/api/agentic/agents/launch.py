"""Starting a task run, shared by the API, heartbeats and schedules.

P19 working hours: an agent with `work_hours` only starts work in its hours. A task started
outside them (and not urgent, or urgent while the agent's hours do not allow urgent work any
time) is not started: it stays queued ("ready") with a note ("Starts when Aisyah's twin is
back at 09:00") and a durable Temporal timer (DeferredStartWorkflow) starts it at the agent's
next shift. That timer is idempotent: it only starts the task if nobody started, moved or
finished it in the meantime, and a second deferral of the same run at the same time is the
same workflow.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..assistants import access as assistant_access
from ..models import Agent, Task
from . import dispatch, runtime, work_hours

RUNNING = ("running", "blocked")
# A goal-loop nudge continues work already started in hours: it is not new work. (P29: the
# goal loop and the self-check now continue inside the same run and no longer launch.)
CONTINUES = ("goal-loop",)
WAKE_ACTOR = "system:work-hours"


class LaunchError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


async def launch(
    db: AsyncSession, t: Task, actor: str, now: datetime | None = None
) -> datetime | None:
    """Begin a fresh run: a new workflow, the same conversation. Returns None when it
    started, or the time it will start when the agent is off duty now."""
    if not t.assignee_agent_id:
        raise LaunchError(400, "no_assignee", "Assign an agent before starting.")
    agent = await db.get(Agent, t.assignee_agent_id)
    if agent is None or agent.status != "active":
        raise LaunchError(409, "agent_inactive", "The assigned agent is not active.")
    if await assistant_access.dormant(db, agent):  # P30: kept, but treated as paused
        raise LaunchError(
            409,
            "assistant_dormant",
            "This personal assistant is paused: personal assistants are for people who manage "
            "others.",
        )
    if t.status in RUNNING and not restartable(t):
        raise LaunchError(409, "already_running", "This task is already running.")
    now = now or datetime.now(UTC)
    if actor not in CONTINUES:
        later = work_hours.deferred_until(
            now, agent.work_hours, work_hours.task_is_urgent(t.priority, t.labels)
        )
        if later is not None:
            await _defer(db, t, agent, later, now, actor)
            return later
    t.run_count += 1
    t.status = "ready"
    t.result = t.error = t.blocked_reason = None
    t.blocked_owner = t.blocked_action = None
    # A retry is a fresh agent run. Keeping the previous run's call budget would make
    # a task that stopped at MAX_CALLS_PER_TASK fail again before the model gets a turn.
    t.steps_used = 0
    t.correction_used = False
    await db.commit()
    try:
        t.workflow_id = await dispatch.start_task(t.id, t.run_count)
    except Exception as e:
        t.status = "failed"
        msg = f"Could not start: the worker service is not reachable ({e.__class__.__name__})."
        t.error = msg
        await db.commit()
        raise LaunchError(503, "temporal_unavailable", msg) from e
    await db.commit()
    await runtime.task_event(db, t, "run", actor, f"started run {t.run_count}")
    return None


def restartable(t: Task) -> bool:
    """Blocked without a live run (P21): parked behind its blockers, or handed to a person by
    the liveness reconciler. A person may start these by hand."""
    from ..teams import blockers, reconcile  # late: both reach back into this module

    return t.status == "blocked" and (
        blockers.parked(t) or (t.blocked_action or "").startswith(reconcile.STOPPED)
    )


async def send_back(db: AsyncSession, t: Task, agent: Agent, feedback: str, actor: str) -> None:
    """Return finished work with feedback: the agent continues the same conversation in a new
    run. One path for a person's send-back and a reviewer agent's (P21), so skill learning
    sees both as a correction."""
    from ..models import AgentMessage
    from ..skills import store as skills_store

    await skills_store.settle(db, t.id, "sent_back")
    db.add(
        AgentMessage(
            workspace_id=t.workspace_id,
            agent_id=agent.id,
            task_id=t.id,
            role="user",
            content=f"Feedback on your last answer: {feedback}",
            created_at=datetime.now(UTC),
        )
    )
    await db.commit()
    await runtime.task_event(db, t, "feedback", actor, feedback[:500])
    await launch(db, t, actor)


async def _defer(
    db: AsyncSession, t: Task, agent: Agent, at: datetime, now: datetime, actor: str
) -> None:
    """Queue the task until the agent's next shift (see the module docstring)."""
    wh = agent.work_hours or {}
    note = work_hours.waiting_note(agent.name, at, now, wh)
    t.status = "ready"
    t.blocked_reason = note
    t.blocked_owner = t.blocked_action = None
    await db.commit()
    try:
        await dispatch.start_deferred(t.id, t.run_count, at)
    except Exception as e:
        msg = "Could not schedule the start: the worker service is not reachable."
        raise LaunchError(503, "temporal_unavailable", msg) from e
    await runtime.task_event(
        db, t, "deferred", actor, note, {"start_at": at.isoformat(), "run": t.run_count}
    )


async def recheck_waiting(db: AsyncSession, agent: Agent, actor: str) -> int:
    """The agent's hours changed: tasks waiting for its shift start now, or wait for the new
    one. Scheduled runs are left to their own workflow. Returns how many started now."""
    rows = (
        await db.scalars(
            select(Task).where(
                Task.assignee_agent_id == agent.id,
                Task.status == "ready",
                Task.source != "schedule",
                Task.blocked_reason.like("Starts when %"),
            )
        )
    ).all()
    started = 0
    for t in rows:
        try:
            started += 0 if await launch(db, t, actor) else 1
        except LaunchError:
            continue
    return started


async def start_deferred(db: AsyncSession, task_id: str, run_count: int) -> str:
    """The DeferredStartWorkflow's wake-up: start the task if it is still waiting for this
    shift. started | deferred (hours changed: waits again) | skipped (someone else moved it)."""
    t = await db.get(Task, task_id)
    if t is None or t.run_count != run_count or t.status not in ("ready", "triage"):
        return "skipped"
    try:
        later = await launch(db, t, WAKE_ACTOR)
    except LaunchError as e:
        t.blocked_reason = f"Did not start: {e.message}"[:300]
        await db.commit()
        return "skipped"
    return "deferred" if later else "started"
