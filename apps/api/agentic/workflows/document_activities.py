"""Activities for Document Studio: reading an upload once (text, OCR, summary)."""

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
