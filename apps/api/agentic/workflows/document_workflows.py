"""Document Studio workflows."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .document_activities import file_extract


@workflow.defn
class FileExtractWorkflow:
    @workflow.run
    async def run(self, file_id: str) -> str:
        # OCR of a long scan takes minutes; one retry covers a worker restart mid-read.
        return await workflow.execute_activity(
            file_extract,
            file_id,
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=15)),
        )
