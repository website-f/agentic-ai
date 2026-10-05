"""Activities for company-document intake (P24): read each file of a batch, then finish it."""

from temporalio import activity

from ..intake import pipeline


@activity.defn
async def intake_pending(batch_id: str) -> list[str]:
    return await pipeline.pending(batch_id)


@activity.defn
async def intake_read(batch_id: str, file_id: str) -> str:
    return await pipeline.read_one(batch_id, file_id)


@activity.defn
async def intake_finish(batch_id: str) -> str:
    return await pipeline.finish(batch_id)


@activity.defn
async def intake_fail(batch_id: str, error: str) -> None:
    await pipeline.fail(batch_id, error)
