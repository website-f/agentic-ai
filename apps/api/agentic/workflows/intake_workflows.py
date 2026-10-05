"""Company-document intake (P24): read, scan and sort every file of an upload, then report.

One workflow per batch (id `intake-<batch id>`). Uploading more files into a running batch
pokes it, and it goes round again for the new files before finishing.
"""

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .intake_activities import intake_fail, intake_finish, intake_pending, intake_read

PARALLEL = 3  # files read at once (OCR is CPU-heavy; the worker caps activities anyway)
MAX_ROUNDS = 50
FAILED = "Sorting stopped on the worker. Upload the files again, or ask an admin to check it."


@workflow.defn
class IntakeWorkflow:
    def __init__(self) -> None:
        self.poked = False

    @workflow.signal
    def poke(self) -> None:
        self.poked = True

    @workflow.run
    async def run(self, batch_id: str) -> str:
        status = "reading"
        quick = RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=5))
        try:
            for _ in range(MAX_ROUNDS):
                self.poked = False
                ids = await workflow.execute_activity(
                    intake_pending,
                    batch_id,
                    start_to_close_timeout=timedelta(minutes=2),
                    retry_policy=quick,
                )
                for i in range(0, len(ids), PARALLEL):
                    await asyncio.gather(
                        *(
                            workflow.execute_activity(
                                intake_read,
                                args=[batch_id, fid],
                                # OCR of a long scan takes minutes (like FileExtractWorkflow).
                                start_to_close_timeout=timedelta(minutes=20),
                                retry_policy=RetryPolicy(
                                    maximum_attempts=2, initial_interval=timedelta(seconds=15)
                                ),
                            )
                            for fid in ids[i : i + PARALLEL]
                        )
                    )
                status = await workflow.execute_activity(
                    intake_finish,
                    batch_id,
                    start_to_close_timeout=timedelta(minutes=15),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                if status != "reading" and not self.poked:
                    return status
        except ActivityError:
            await workflow.execute_activity(
                intake_fail,
                args=[batch_id, FAILED],
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=quick,
            )
            return "failed"
        return status
