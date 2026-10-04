"""P19 working hours: start a task when its agent is next on duty (see agents/launch.py)."""

from datetime import datetime, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .hours_activities import deferred_start


@workflow.defn
class DeferredStartWorkflow:
    """Sleep (a durable timer) until the agent's shift starts, then start the task if it is
    still waiting for it. Started by dispatch.start_deferred."""

    @workflow.run
    async def run(self, task_id: str, run_count: int, at_iso: str) -> str:
        wait = (datetime.fromisoformat(at_iso) - workflow.now()).total_seconds()
        if wait > 0:
            await workflow.sleep(timedelta(seconds=wait))
        return await workflow.execute_activity(
            deferred_start,
            args=[task_id, run_count],
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=10)),
        )
