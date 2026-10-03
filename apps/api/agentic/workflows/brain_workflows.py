"""Brain workflows: learning from a chat turn, the hourly dream tick, and a manual dream."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .brain_activities import (
        brain_dream_run,
        brain_dream_tick,
        brain_learn_chat,
    )
    from .skill_activities import skill_reflect_chat

LEARN_RETRY = RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=10))
DREAM_TIMEOUT = timedelta(minutes=30)


@workflow.defn
class LearnFromChatWorkflow:
    @workflow.run
    async def run(self, message_id: int) -> int:
        learned = await workflow.execute_activity(
            brain_learn_chat,
            message_id,
            start_to_close_timeout=timedelta(minutes=3),
            retry_policy=LEARN_RETRY,
        )
        # P17: a correction or "remember this" in chat can become (or fix) a skill.
        if workflow.patched("chat-skill-v1"):
            try:
                await workflow.execute_activity(
                    skill_reflect_chat,
                    message_id,
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=RetryPolicy(maximum_attempts=1),
                )
            except ActivityError:
                pass  # learning is best effort; the chat is answered already
        return learned


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
