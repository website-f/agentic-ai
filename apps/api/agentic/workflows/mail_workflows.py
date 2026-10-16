"""P34: Outlook mail sync runs in the worker (microsoft/sync.py).

- MailPendingWorkflow: started by the Graph webhook (after it answered 202) to drain the
  `ms:pending` queue right away: delta rounds, renewals, re-subscriptions.
- MailSyncTickWorkflow: the `mail-sync` schedule, every minute: drains the queue too (the
  backstop when a kick was lost), renews subscriptions, subscribes mailboxes without one,
  and polls mailboxes that are due (every 3 min without webhooks).
"""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn
async def mail_pending() -> dict[str, int]:
    from ..microsoft import sync

    return await sync.process_pending()


@activity.defn
async def mail_tick() -> dict[str, int]:
    from ..microsoft import sync

    return await sync.tick()


@workflow.defn
class MailPendingWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            mail_pending,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=1),  # the schedule retries anyway
        )


@workflow.defn
class MailSyncTickWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            mail_tick,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
