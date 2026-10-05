"""P24: background builds of SOPs and workflows from documents."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .builder_activities import builder_run


@workflow.defn
class BuildFromDocsWorkflow:
    @workflow.run
    async def run(self, job_id: str) -> str:
        # A long handbook is read in ~20 parts; one retry covers a worker restart (a job that
        # already finished or failed is left alone by the retry).
        return await workflow.execute_activity(
            builder_run,
            job_id,
            start_to_close_timeout=timedelta(minutes=45),
            retry_policy=RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=20)),
        )
