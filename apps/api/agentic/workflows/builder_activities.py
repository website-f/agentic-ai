"""P24: build a draft SOP or workflow from documents on the worker (long documents)."""

from temporalio import activity

from ..core.db import SessionLocal


@activity.defn
async def builder_run(job_id: str) -> str:
    """Carry out one background build (intake/builders.run_job). Returns its final status."""
    from ..intake import builders  # late: builders pulls in the engine and the models

    async with SessionLocal() as db:
        job = await builders.run_job(db, job_id)
    return (job or {}).get("status") or "missing"
