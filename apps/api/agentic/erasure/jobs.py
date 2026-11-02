"""The erasure's doorway into Temporal. Tests replace these functions."""

from ..core.config import settings
from ..core.temporal import temporal_client


async def start_export(export_id: str) -> str:
    from ..workflows.erasure_workflows import ExportWorkspaceWorkflow

    client = await temporal_client()
    workflow_id = f"export-{export_id}"
    await client.start_workflow(
        ExportWorkspaceWorkflow.run,
        export_id,
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def start_erase(record_id: str) -> str:
    from ..workflows.erasure_workflows import EraseWorkspaceWorkflow

    client = await temporal_client()
    workflow_id = f"erase-{record_id}"
    await client.start_workflow(
        EraseWorkspaceWorkflow.run,
        record_id,
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def temporal_forget(workflow_id: str) -> bool:
    """Delete a workflow's run and its history (payloads carry task ids and text); a running
    one is terminated first by Temporal itself. False when there was none."""
    from temporalio.api.common.v1 import WorkflowExecution
    from temporalio.api.workflowservice.v1 import DeleteWorkflowExecutionRequest
    from temporalio.service import RPCError, RPCStatusCode

    client = await temporal_client()
    try:
        await client.workflow_service.delete_workflow_execution(
            DeleteWorkflowExecutionRequest(
                namespace=client.namespace,
                workflow_execution=WorkflowExecution(workflow_id=workflow_id),
            )
        )
    except RPCError as e:
        if e.status == RPCStatusCode.NOT_FOUND:
            return False
        raise
    return True


async def temporal_drop_schedule(schedule_id: str) -> None:
    from ..agents import dispatch

    await dispatch.delete_schedule(schedule_id)
