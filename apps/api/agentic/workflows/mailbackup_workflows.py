"""P109: back up a person's other email account's attachments (mailbox/backup.py).

MailBackupWorkflow runs rounds of a few minutes each until the job is done, failed or
cancelled; every round resumes from the job's saved progress, so a worker restart or a
retried round never starts over. After many rounds it continues as new (short history).
"""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

ROUNDS_PER_RUN = 100


@activity.defn
async def mail_backup_round(job_id: str) -> str:
    from ..mailbox import backup

    return await backup.run_round(job_id)


@workflow.defn
class MailBackupWorkflow:
    @workflow.run
    async def run(self, job_id: str) -> str:
        result = "more"
        for _ in range(ROUNDS_PER_RUN):
            result = await workflow.execute_activity(
                mail_backup_round,
                job_id,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(
                    maximum_attempts=5,
                    initial_interval=timedelta(seconds=30),
                    backoff_coefficient=2.0,
                ),
            )
            if result != "more":
                return result
        workflow.continue_as_new(job_id)
