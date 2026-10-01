"""System workflows. Workflow code runs in Temporal's deterministic sandbox, so this
module only imports temporalio and the stdlib; activities come in pass-through."""

from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .activities import pong
    from .engine_activities import check_all_providers


@workflow.defn
class PingWorkflow:
    """Round-trip through the worker: proves Temporal, the task queue and a live worker."""

    @workflow.run
    async def run(self, payload: str) -> str:
        return await workflow.execute_activity(
            pong, payload, start_to_close_timeout=timedelta(seconds=5)
        )


@workflow.defn
class ProviderHealthWorkflow:
    """Started every 30 minutes by the `provider-health` schedule (see worker.py)."""

    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            check_all_providers,
            start_to_close_timeout=timedelta(minutes=10),
            heartbeat_timeout=timedelta(minutes=3),
        )
