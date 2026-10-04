"""Activities for P19 working hours."""

from temporalio import activity

from ..core.db import SessionLocal


@activity.defn
async def deferred_start(task_id: str, run_count: int) -> str:
    from ..agents import launch  # late: launch imports the runtime

    async with SessionLocal() as db:
        return await launch.start_deferred(db, task_id, run_count)
