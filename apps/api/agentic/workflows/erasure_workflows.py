"""P57: export a workspace into one ZIP; erase a workspace (revoke, delete, verify, certify)."""

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .erasure_activities import erase_failed, erase_step, export_build

STEPS = ("prepare", "revoke", "storage", "vault", "cache", "database", "certificate")


@workflow.defn
class ExportWorkspaceWorkflow:
    @workflow.run
    async def run(self, export_id: str) -> dict[str, Any]:
        return await workflow.execute_activity(
            export_build,
            export_id,
            start_to_close_timeout=timedelta(hours=6),
            heartbeat_timeout=timedelta(minutes=30),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )


@workflow.defn
class EraseWorkspaceWorkflow:
    @workflow.run
    async def run(self, record_id: str) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for step in STEPS:
            try:
                result[step] = await workflow.execute_activity(
                    erase_step,
                    args=[record_id, step],
                    start_to_close_timeout=timedelta(hours=2),
                    retry_policy=RetryPolicy(
                        maximum_attempts=3,
                        initial_interval=timedelta(seconds=30),
                        backoff_coefficient=4,
                    ),
                )
            except ActivityError as e:
                await workflow.execute_activity(
                    erase_failed,
                    args=[record_id, f"{step}: {e.cause or e}"],
                    start_to_close_timeout=timedelta(minutes=2),
                )
                raise
        return result
