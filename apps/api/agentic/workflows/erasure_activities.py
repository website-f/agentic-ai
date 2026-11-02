"""P57 activities: export a workspace, and erase it step by step (agentic/erasure)."""

from typing import Any

from temporalio import activity

from ..erasure import erase, export

MAX_ATTEMPTS = 3  # erasure_workflows.EraseWorkspaceWorkflow retries each step this often


def _beat() -> None:
    if activity.in_activity():
        activity.heartbeat()


@activity.defn
async def export_build(export_id: str) -> dict[str, Any]:
    return await export.build(export_id, beat=_beat)


@activity.defn
async def erase_step(record_id: str, step: str) -> dict[str, Any]:
    _beat()
    return await erase.run_step(record_id, step, activity.info().attempt, MAX_ATTEMPTS)


@activity.defn
async def erase_failed(record_id: str, why: str) -> None:
    await erase.failed(record_id, why)
