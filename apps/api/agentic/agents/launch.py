"""Starting a task run, shared by the API, heartbeats and schedules."""

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Task
from . import dispatch, runtime

RUNNING = ("running", "blocked")


class LaunchError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


async def launch(db: AsyncSession, t: Task, actor: str) -> None:
    """Begin a fresh run: a new workflow, the same conversation."""
    if not t.assignee_agent_id:
        raise LaunchError(400, "no_assignee", "Assign an agent before starting.")
    agent = await db.get(Agent, t.assignee_agent_id)
    if agent is None or agent.status != "active":
        raise LaunchError(409, "agent_inactive", "The assigned agent is not active.")
    if t.status in RUNNING:
        raise LaunchError(409, "already_running", "This task is already running.")
    t.run_count += 1
    t.status = "ready"
    t.result = t.error = t.blocked_reason = None
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
