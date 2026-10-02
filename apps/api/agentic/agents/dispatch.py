"""The API's only doorway into Temporal for agent work. Tests replace these functions."""

from datetime import UTC, datetime
from typing import Any

from temporalio.client import (
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleSpec,
    ScheduleState,
    ScheduleUpdate,
)
from temporalio.service import RPCError

from ..core.config import settings
from ..core.temporal import temporal_client
from ..workflows.agent_workflows import AgentTaskWorkflow, BroadcastRepliesWorkflow
from ..workflows.brain_workflows import DreamWorkflow, LearnFromChatWorkflow
from ..workflows.channel_workflows import DeliverWorkflow
from ..workflows.document_workflows import FileExtractWorkflow
from ..workflows.skill_workflows import SkillEvalWorkflow
from ..workflows.teams_workflows import MeetingWorkflow, ScheduledTaskWorkflow


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


async def start_meeting(meeting_id: str) -> str:
    client = await temporal_client()
    workflow_id = f"meeting-{meeting_id}"
    await client.start_workflow(
        MeetingWorkflow.run, meeting_id, id=workflow_id, task_queue=settings.temporal_task_queue
    )
    return workflow_id


def _schedule(schedule_id: str, cron: str, tz: str, enabled: bool, note: str) -> Schedule:
    return Schedule(
        action=ScheduleActionStartWorkflow(
            ScheduledTaskWorkflow.run,
            args=[schedule_id, False],
            id=f"scheduled-{schedule_id}",
            task_queue=settings.temporal_task_queue,
        ),
        spec=ScheduleSpec(cron_expressions=[cron], time_zone_name=tz),
        policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
        state=ScheduleState(paused=not enabled, note=note[:200]),
    )


async def upsert_schedule(schedule_id: str, cron: str, tz: str, enabled: bool, note: str) -> None:
    """Mirror a Schedule row into Temporal (create, or replace spec and paused state)."""
    client = await temporal_client()
    sched = _schedule(schedule_id, cron, tz, enabled, note)
    handle = client.get_schedule_handle(f"sched-{schedule_id}")
    try:
        await handle.describe()
    except RPCError:
        await client.create_schedule(f"sched-{schedule_id}", sched)
        return
    await handle.update(lambda _: ScheduleUpdate(schedule=sched))


async def delete_schedule(schedule_id: str) -> None:
    client = await temporal_client()
    try:
        await client.get_schedule_handle(f"sched-{schedule_id}").delete()
    except RPCError:
        pass  # already gone


async def run_schedule_now(schedule_id: str) -> str:
    client = await temporal_client()
    workflow_id = f"scheduled-{schedule_id}-now-{datetime.now(UTC):%Y%m%d%H%M%S}"
    await client.start_workflow(
        ScheduledTaskWorkflow.run,
        args=[schedule_id, True],
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def describe_schedules(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Next and recent firings straight from Temporal, for the ledger page."""
    client = await temporal_client()
    out: dict[str, dict[str, Any]] = {}
    for sid in ids:
        try:
            d = await client.get_schedule_handle(sid).describe()
        except RPCError:
            continue
        out[sid] = {
            "paused": d.schedule.state.paused,
            "next": [t.isoformat() for t in d.info.next_action_times[:3]],
            "recent": [
                {
                    "scheduled_at": a.scheduled_at.isoformat(),
                    "started_at": a.started_at.isoformat(),
                }
                for a in d.info.recent_actions[-5:]
            ],
        }
    return out


async def start_deliveries(delivery_ids: list[str]) -> None:
    client = await temporal_client()
    await client.start_workflow(
        DeliverWorkflow.run,
        delivery_ids,
        id=f"deliver-{delivery_ids[0]}-{len(delivery_ids)}",
        task_queue=settings.temporal_task_queue,
    )


async def start_file_extract(file_id: str) -> None:
    """Read an upload in the background (text, OCR, summary)."""
    client = await temporal_client()
    await client.start_workflow(
        FileExtractWorkflow.run,
        file_id,
        id=f"file-{file_id}",
        task_queue=settings.temporal_task_queue,
    )
