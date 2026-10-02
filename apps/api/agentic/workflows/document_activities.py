"""Activities for Document Studio (reading an upload once) and workflow runs (P11)."""

from temporalio import activity

from ..core.db import SessionLocal
from ..documents import service
from ..models import DocFile
from ..services import events


@activity.defn
async def file_extract(file_id: str) -> str:
    async with SessionLocal() as db:
        status = await service.process_file(db, file_id)
        f = await db.get(DocFile, file_id)
        if f is not None:
            await events.publish(
                f.workspace_id,
                "file.ready",
                {"file_id": f.id, "status": f.status, "name": f.name, "agent_id": f.agent_id},
            )
        return status


@activity.defn
async def workflow_run_tick(run_id: str) -> bool:
    """Move a workflow run forward (P11). True when it has finished."""
    from . import runs

    async with SessionLocal() as db:
        return await runs.tick(db, run_id)
