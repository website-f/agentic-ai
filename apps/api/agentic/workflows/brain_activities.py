"""Activities for the brain: learning after work, and the nightly dream."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from temporalio import activity

from ..agents import runtime
from ..brain import dream, learn, weekly
from ..core.config import settings
from ..core.db import SessionLocal
from ..models import BrainDream, Task, Workspace

log = logging.getLogger("agentic.worker.brain")


@activity.defn
async def brain_learn_task(task_id: str) -> int:
    async with SessionLocal() as db:
        learned = await learn.learn_from_task(db, task_id)
        if learned is None:
            return 0
        task = await db.get(Task, task_id)
        if task is not None and (learned.total or learned.reinforced):
            await runtime.task_event(
                db,
                task,
                "memory",
                f"agent:{task.assignee_agent_id}",
                f"learned from this task: {learned.summary()}",
                {
                    "added": learned.added,
                    "replaced": [{"old": o, "new": n} for o, n in learned.replaced],
                    "confirmed": learned.reinforced,
                },
            )
        if learned.error:
            log.info("learning skipped for %s: %s", task_id, learned.error)
        return learned.total


@activity.defn
async def brain_learn_chat(message_id: int) -> int:
    async with SessionLocal() as db:
        learned = await learn.learn_from_chat(db, message_id)
        return learned.total if learned else 0


@activity.defn
async def brain_dream_tick() -> int:
    """Hourly: start the dream for every workspace where it is now the dream hour."""
    ran = 0
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        for ws in (await db.scalars(select(Workspace))).all():
            local = now.astimezone(ZoneInfo(ws.timezone))
            if local.hour != settings.dream_hour:
                continue
            done = await db.scalar(
                select(BrainDream.id).where(
                    BrainDream.workspace_id == ws.id, BrainDream.day == local.date()
                )
            )
            if done is None:
                await dream.run_dream(db, ws, local.date())
                ran += 1
    # P45: Monday morning, last week's "what the AI team learned" report.
    try:
        async with SessionLocal() as db:
            await weekly.tick(db, now)
    except Exception:  # noqa: BLE001 - the weekly report must never stop the dream tick
        logging.getLogger("agentic.brain").warning("weekly learning report failed", exc_info=True)
    return ran


STUCK = timedelta(hours=1)  # a dream "running" this long died with its worker


@activity.defn
async def brain_dream_due() -> list[list[Any]]:
    """P56, hourly: the workspaces whose dream is due ([id, force] pairs), each then dreamed in
    its own workflow with its own time limit, so one big office cannot starve the rest. Due
    means past today's dream hour where the workspace is, with no dream yet today: a night
    the worker was down is caught up the same day. A dream stuck "running" is redone."""
    now = datetime.now(UTC)
    due: list[list[Any]] = []
    async with SessionLocal() as db:
        for ws in (await db.scalars(select(Workspace))).all():
            local = now.astimezone(ZoneInfo(ws.timezone))
            if local.hour < settings.dream_hour:
                continue
            d = await db.scalar(
                select(BrainDream).where(
                    BrainDream.workspace_id == ws.id, BrainDream.day == local.date()
                )
            )
            if d is None or d.status not in ("done", "running"):
                due.append([ws.id, False])
            elif d.status == "running" and d.started_at and now - d.started_at > STUCK:
                due.append([ws.id, True])
    # P45: Monday morning, last week's "what the AI team learned" report.
    try:
        async with SessionLocal() as db:
            await weekly.tick(db, now)
    except Exception:  # noqa: BLE001 - the weekly report must never stop the dream tick
        logging.getLogger("agentic.brain").warning("weekly learning report failed", exc_info=True)
    return due


@activity.defn
async def brain_dream_run(workspace_id: str, force: bool) -> str:
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        if ws is None:
            return "missing"
        d = await dream.run_dream(db, ws, force=force)
        return d.status
