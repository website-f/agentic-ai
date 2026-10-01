"""The API's only doorway into Temporal for agent work. Tests replace these functions."""

from datetime import UTC, datetime

from ..core.config import settings
from ..core.temporal import temporal_client
from ..workflows.agent_workflows import AgentTaskWorkflow, BroadcastRepliesWorkflow
from ..workflows.brain_workflows import DreamWorkflow, LearnFromChatWorkflow
from ..workflows.channel_workflows import DeliverWorkflow
from ..workflows.skill_workflows import SkillEvalWorkflow


async def start_task(task_id: str, run: int) -> str:
    client = await temporal_client()
    workflow_id = f"task-{task_id}-{run}"
    await client.start_workflow(
        AgentTaskWorkflow.run, task_id, id=workflow_id, task_queue=settings.temporal_task_queue
    )
    return workflow_id


async def signal_decision(workflow_id: str, approval_id: str) -> None:
    client = await temporal_client()
    await client.get_workflow_handle(workflow_id).signal(
        AgentTaskWorkflow.approval_decided, approval_id
    )


async def cancel_task(workflow_id: str) -> None:
    client = await temporal_client()
    await client.get_workflow_handle(workflow_id).signal(AgentTaskWorkflow.cancel)


async def start_broadcast_replies(broadcast_id: str, agent_ids: list[str]) -> None:
    client = await temporal_client()
    await client.start_workflow(
        BroadcastRepliesWorkflow.run,
        args=[broadcast_id, agent_ids],
        id=f"broadcast-{broadcast_id}",
        task_queue=settings.temporal_task_queue,
    )


async def start_chat_learning(message_id: int) -> None:
    client = await temporal_client()
    await client.start_workflow(
        LearnFromChatWorkflow.run,
        message_id,
        id=f"learn-chat-{message_id}",
        task_queue=settings.temporal_task_queue,
    )


async def start_dream(workspace_id: str) -> str:
    client = await temporal_client()
    workflow_id = f"dream-{workspace_id}-{datetime.now(UTC):%Y%m%d%H%M%S}"
    await client.start_workflow(
        DreamWorkflow.run,
        args=[workspace_id, True],
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def start_skill_eval(kind: str, target_id: str) -> str:
    """kind = skill | proposal."""
    client = await temporal_client()
    workflow_id = f"skill-eval-{target_id}-{datetime.now(UTC):%Y%m%d%H%M%S}"
    await client.start_workflow(
        SkillEvalWorkflow.run,
        args=[kind, target_id],
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def start_deliveries(delivery_ids: list[str]) -> None:
    client = await temporal_client()
    await client.start_workflow(
        DeliverWorkflow.run,
        delivery_ids,
        id=f"deliver-{delivery_ids[0]}-{len(delivery_ids)}",
        task_queue=settings.temporal_task_queue,
    )
