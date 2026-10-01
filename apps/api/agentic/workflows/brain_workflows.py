"""Brain workflows: learning from a chat turn, the hourly dream tick, and a manual dream."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .brain_activities import (
        brain_dream_run,
        brain_dream_tick,
        brain_learn_chat,
    )

LEARN_RETRY = RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=10))
DREAM_TIMEOUT = timedelta(minutes=30)


@workflow.defn
class LearnFromChatWorkflow:
    @workflow.run
    async def run(self, message_id: int) -> int:
        return await workflow.execute_activity(
            brain_learn_chat,
            message_id,
            start_to_close_timeout=timedelta(minutes=3),
            retry_policy=LEARN_RETRY,
        )


@workflow.defn
class DreamTickWorkflow:
    @workflow.run
    async def run(self) -> int:
        return await workflow.execute_activity(
            brain_dream_tick,
            start_to_close_timeout=DREAM_TIMEOUT,
            retry_policy=RetryPolicy(maximum_attempts=1),
        )


@workflow.defn
class DreamWorkflow:
    @workflow.run
    async def run(self, workspace_id: str, force: bool) -> str:
        return await workflow.execute_activity(
            brain_dream_run,
            args=[workspace_id, force],
            start_to_close_timeout=DREAM_TIMEOUT,
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
