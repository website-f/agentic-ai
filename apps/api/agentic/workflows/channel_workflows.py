"""Send queued deliveries with retries and backoff."""

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .channel_activities import deliver_one


@workflow.defn
class DeliverWorkflow:
    @workflow.run
    async def run(self, delivery_ids: list[str]) -> int:
        async def one(did: str) -> bool:
            try:
                await workflow.execute_activity(
                    deliver_one,
                    did,
                    start_to_close_timeout=timedelta(seconds=40),
                    retry_policy=RetryPolicy(
                        maximum_attempts=3,
                        initial_interval=timedelta(seconds=5),
                        backoff_coefficient=3,
                    ),
                )
                return True
            except ActivityError:
                return False  # the row says why; nothing else to do

        done = await asyncio.gather(*[one(d) for d in delivery_ids])
        return sum(done)
