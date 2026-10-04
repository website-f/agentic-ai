"""Knowledge library (P18): build a source's searchable passages on the worker."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .knowledge_activities import knowledge_index


@workflow.defn
class KnowledgeIndexWorkflow:
    @workflow.run
    async def run(self, kind: str, target_id: str) -> int:
        """kind = file | sop | workspace (rebuild everything in it)."""
        # Embedding a 300-page manual on CPU takes a minute or two; a whole workspace longer.
        return await workflow.execute_activity(
            knowledge_index,
            args=[kind, target_id],
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=15)),
        )
