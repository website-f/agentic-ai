"""Activity behind the P21 liveness reconciler (teams/reconcile.py)."""

from temporalio import activity


@activity.defn
async def liveness_reconcile() -> dict[str, int]:
    from ..knowledge import indexer
    from ..teams import reconcile  # late: it imports the agent runtime

    out = await reconcile.tick()
    # P36: library files whose indexing never finished are retried here too.
    try:
        caught = await indexer.catch_up()
        out.update({f"library_{k}": v for k, v in caught.items()})
    except Exception:  # noqa: BLE001 - the liveness round already did its work
        activity.logger.warning("library catch-up failed", exc_info=True)
    return out
