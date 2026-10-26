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
    # P40: storage sources (B2, the server's disk, a file server) imported into the Library.
    try:
        from ..core.db import SessionLocal
        from ..documents import sources

        async with SessionLocal() as db:
            out["sources_synced"] = await sources.sync_due(db)
    except Exception:  # noqa: BLE001
        activity.logger.warning("storage source sync failed", exc_info=True)
    try:  # P47: a short summary when an agent's working day ends (if asked for)
        from ..core.db import SessionLocal
        from ..teams import timetable

        async with SessionLocal() as db:
            out["day_reports"] = await timetable.day_reports(db)
    except Exception:  # noqa: BLE001
        activity.logger.warning("day reports failed", exc_info=True)
    try:  # P50: CRM integrations whose time has come
        from ..core.db import SessionLocal
        from ..crm.hub import connectors

        async with SessionLocal() as db:
            out["crm_synced"] = await connectors.sync_due(db)
    except Exception:  # noqa: BLE001
        activity.logger.warning("crm sync failed", exc_info=True)
    return out
