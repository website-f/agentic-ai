"""Activities for meeting minutes from a recording (see minutes/service.py)."""

from typing import Any

from temporalio import activity

from ..core.db import SessionLocal
from ..minutes import service


def _beat() -> None:
    activity.heartbeat()


@activity.defn
async def minutes_prepare(rec_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return await service.prepare(db, rec_id, _beat)


@activity.defn
async def minutes_transcribe(rec_id: str, index: int) -> dict[str, Any]:
    async with SessionLocal() as db:
        return await service.transcribe_chunk(db, rec_id, index, _beat)


@activity.defn
async def minutes_write(rec_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        return await service.write(db, rec_id, _beat)


@activity.defn
async def minutes_fail(rec_id: str, message: str) -> None:
    async with SessionLocal() as db:
        await service.fail_by_id(db, rec_id, message)


@activity.defn
async def minutes_purge() -> dict[str, int]:
    async with SessionLocal() as db:
        return await service.purge(db)
