"""Temporal worker entrypoint: `python -m agentic.workflows.worker`."""

import asyncio
import logging
import signal
import tempfile
from datetime import timedelta
from pathlib import Path

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleAlreadyRunningError,
    ScheduleIntervalSpec,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleSpec,
)
from temporalio.worker import Worker

from ..brain import embed
from ..core.config import settings
from .activities import pong
from .agent_activities import (
    broadcast_reply,
    task_apply_approval,
    task_expire_approval,
    task_finish,
    task_start,
    task_step,
)
from .agent_workflows import AgentTaskWorkflow, BroadcastRepliesWorkflow
from .brain_activities import (
    brain_dream_run,
    brain_dream_tick,
    brain_learn_chat,
    brain_learn_task,
)
from .brain_workflows import DreamTickWorkflow, DreamWorkflow, LearnFromChatWorkflow
from .engine_activities import check_all_providers
from .system import PingWorkflow, ProviderHealthWorkflow

log = logging.getLogger("agentic.worker")

WORKFLOWS = [
    PingWorkflow,
    ProviderHealthWorkflow,
    AgentTaskWorkflow,
    BroadcastRepliesWorkflow,
    LearnFromChatWorkflow,
    DreamTickWorkflow,
    DreamWorkflow,
]
ACTIVITIES = [
    pong,
    check_all_providers,
    task_start,
    task_step,
    task_apply_approval,
    task_expire_approval,
    task_finish,
    broadcast_reply,
    brain_learn_task,
    brain_learn_chat,
    brain_dream_tick,
    brain_dream_run,
]


async def ensure_schedules(client: Client) -> None:
    """Idempotent: create the recurring jobs this worker serves if they do not exist."""
    jobs = [
        ("provider-health", ProviderHealthWorkflow.run, timedelta(minutes=30)),
        # Hourly tick; each workspace dreams once, at settings.dream_hour in its own time zone.
        ("brain-dream", DreamTickWorkflow.run, timedelta(hours=1)),
    ]
    for schedule_id, run, every in jobs:
        try:
            await client.create_schedule(
                schedule_id,
                Schedule(
                    action=ScheduleActionStartWorkflow(
                        run, id=schedule_id, task_queue=settings.temporal_task_queue
                    ),
                    spec=ScheduleSpec(intervals=[ScheduleIntervalSpec(every=every)]),
                    policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
                ),
            )
            log.info("created schedule %s (every %s)", schedule_id, every)
        except ScheduleAlreadyRunningError:
            pass


async def _connect() -> Client:
    delay = 1.0
    while True:
        try:
            return await Client.connect(
                settings.temporal_address, namespace=settings.temporal_namespace
            )
        except Exception as e:  # noqa: BLE001 - Temporal may still be booting
            log.warning(
                "Temporal not reachable at %s (%s); retrying in %.0fs",
                settings.temporal_address,
                e,
                delay,
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    client = await _connect()
    await ensure_schedules(client)
    asyncio.create_task(embed.warm())  # noqa: RUF006 - fire and forget; logs its own failure
    worker = Worker(
        client, task_queue=settings.temporal_task_queue, workflows=WORKFLOWS, activities=ACTIVITIES
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows dev shells
            pass
    log.info("worker polling task queue %s", settings.temporal_task_queue)
    async with worker:
        beat = asyncio.create_task(_heartbeat(stop))
        await stop.wait()
        beat.cancel()


async def _heartbeat(stop: asyncio.Event) -> None:
    """Touch a file the container healthcheck reads; stale file = unhealthy worker."""
    path = Path(tempfile.gettempdir()) / "worker-alive"
    while not stop.is_set():
        path.touch()
        await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(main())
