"""P21: the liveness reconciler, started every 10 minutes by the `liveness-reconcile`
schedule (worker.py)."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .reconcile_activities import liveness_reconcile


@workflow.defn
class LivenessReconcileWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            liveness_reconcile,
            start_to_close_timeout=timedelta(minutes=8),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
