"""P80: linked SharePoint / OneDrive folders in the Library (sharepoint/library.py).

- LinkedSyncWorkflow: read one folder now (when it is connected, or "Sync now").
- LinkedSyncTickWorkflow: the `linked-sync` schedule, every 30 minutes: syncs each folder not
  synced for settings.sharepoint_sync_hours (one waiting for a reconnect only once its
  person's Microsoft 365 connection allows files again).
"""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


async def run_sync(source_id: str) -> str:
    """Shared by the activity and the API's fallback when the worker is unreachable."""
    from ..core.db import SessionLocal
    from ..sharepoint import library

    async with SessionLocal() as db:
        return (await library.sync_source(db, source_id)).status


@activity.defn
async def linked_sync(source_id: str) -> str:
    return await run_sync(source_id)


@activity.defn
async def linked_tick() -> dict[str, int]:
    from ..sharepoint import library

    return await library.tick()


@workflow.defn
class LinkedSyncWorkflow:
    @workflow.run
    async def run(self, source_id: str) -> str:
        # A first read of a big folder (hundreds of files, OCR of scans) takes a while.
        return await workflow.execute_activity(
            linked_sync,
            source_id,
            start_to_close_timeout=timedelta(minutes=55),
            retry_policy=RetryPolicy(maximum_attempts=1),  # the schedule tries again
        )


@workflow.defn
class LinkedSyncTickWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            linked_tick,
            start_to_close_timeout=timedelta(minutes=55),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
