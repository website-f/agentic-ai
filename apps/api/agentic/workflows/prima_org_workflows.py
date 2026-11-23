"""P127: the `prima-org-sync` schedule, every 30 minutes: the office's organization hierarchy
and Prima's org chart kept in step (prima/org_sync.py). Lines changed in the office also go at
once (in the background, after the save) and from "Sync with Prima" on the org chart page; this
picks up changes made in Prima and retries lines still waiting for Prima.
"""

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn
async def prima_org_tick() -> dict[str, int]:
    from ..prima import org_sync

    return await org_sync.tick()


@workflow.defn
class PrimaOrgSyncTickWorkflow:
    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            prima_org_tick,
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=RetryPolicy(maximum_attempts=1),  # the schedule tries again
        )
