"""P35: the `money-reminders` schedule, hourly: payment-reminder drafts for receivables that
reached a reminder day (crm/reminders.py). Drafts only: people approve every send."""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn
async def money_reminders() -> int:
    from ..crm import reminders

    return await reminders.run()


@workflow.defn
class MoneyRemindersWorkflow:
    @workflow.run
    async def run(self) -> int:
        return await workflow.execute_activity(
            money_reminders,
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=1),  # the next hour tries again
        )
