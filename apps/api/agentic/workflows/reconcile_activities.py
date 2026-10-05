"""Activity behind the P21 liveness reconciler (teams/reconcile.py)."""

from temporalio import activity


@activity.defn
async def liveness_reconcile() -> dict[str, int]:
    from ..teams import reconcile  # late: it imports the agent runtime

    return await reconcile.tick()
