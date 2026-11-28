"""P149a: the `storage-jobs` schedule, every 5 minutes: the storage jobs the owner switched on
(documents/offload.py) work for up to 4 minutes each run: file bytes moved off the VPS to the
company's S3 file server, older files made smaller (quiet hours). Overlaps are skipped, so one
run works at a time even with several worker replicas.
"""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn
async def storage_jobs_tick() -> dict[str, int]:
    from ..documents import offload

    return await offload.tick()


@workflow.defn
class StorageJobsTickWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            storage_jobs_tick,
            start_to_close_timeout=timedelta(minutes=15),
            retry_policy=RetryPolicy(maximum_attempts=1),  # the schedule tries again
        )
