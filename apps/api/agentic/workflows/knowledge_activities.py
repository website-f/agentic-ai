"""Activities for the knowledge library (P18)."""

from temporalio import activity

from ..core.db import SessionLocal
from ..knowledge import indexer


async def run_index(kind: str, target_id: str) -> int:
    """Index one file or SOP, or a whole workspace. Returns the number of passages built.
    Shared by the activity and the API's inline fallback."""
    async with SessionLocal() as db:
        if kind == "file":
            return await indexer.index_file(db, target_id)
        if kind == "sop":
            return await indexer.index_sop(db, target_id)
        if kind == "workspace":
            return (await indexer.reindex_workspace(db, target_id))["passages"]
    raise ValueError(f"unknown library index kind {kind!r}")


@activity.defn
async def knowledge_index(kind: str, target_id: str) -> int:
    return await run_index(kind, target_id)
