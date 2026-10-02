"""Activities behind AgentTaskWorkflow and BroadcastRepliesWorkflow."""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from temporalio import activity

from ..agents import runtime
from ..core.db import SessionLocal
from ..engine import gateway
from ..models import Agent, Broadcast, BroadcastReceipt
from ..services import events

log = logging.getLogger("agentic.worker.agents")


@activity.defn
async def task_start(task_id: str) -> None:
    await runtime.start_run(task_id)


@activity.defn
async def task_step(task_id: str) -> dict[str, Any]:
    return (await runtime.run_task_step(task_id)).dict()


@activity.defn
async def task_apply_approval(approval_id: str) -> None:
    await runtime.apply_approval(approval_id)


@activity.defn
async def task_expire_approval(approval_id: str) -> None:
    await runtime.expire_approval(approval_id)


@activity.defn
async def task_finish(task_id: str, state: str, message: str | None) -> None:
    await runtime.finish(task_id, state, message)
    await _poke_run(task_id)


async def _poke_run(task_id: str) -> None:
    """A finished step wakes its workflow run at once instead of at the next tick (P11)."""
    from ..agents import dispatch
    from ..models import Task

    async with SessionLocal() as db:
        run_id = await db.scalar(select(Task.workflow_run_id).where(Task.id == task_id))
    if run_id:
        try:
            await dispatch.poke_run(run_id)
        except Exception:  # noqa: BLE001 - the run's own tick catches up within 15 s
            log.info("could not poke workflow run %s", run_id)


@activity.defn
async def broadcast_reply(broadcast_id: str, agent_id: str) -> None:
    """One agent reads an announcement and writes a one or two sentence reply."""
    async with SessionLocal() as db:
        b = await db.get(Broadcast, broadcast_id)
        agent = await db.get(Agent, agent_id)
        receipt = await db.get(BroadcastReceipt, (broadcast_id, agent_id))
        if b is None or agent is None or receipt is None or receipt.ack_at:
            return
        prompt = [
            {
                "role": "system",
                "content": f"You are {agent.name}, {agent.role}. {agent.soul[:600]}",
            },
            {
                "role": "user",
                "content": "Management sent this message to staff:\n\n"
                f"{b.body}\n\nAcknowledge it in one or two sentences: confirm you understood and "
                "say how it affects your work. No greeting.",
            },
        ]
        reply = None
        for group in ("fast", agent.model_group):
            try:
                r = await gateway.chat(
                    db,
                    agent.workspace_id,
                    group,
                    prompt,
                    task="broadcast.reply",
                    max_tokens=160,
                    agent_id=agent.id,
                )
                reply = r.content.strip()
                break
            except gateway.GatewayUnavailable:
                continue
        receipt.ack_at = datetime.now(UTC)
        receipt.reply = reply or "Received."
        await db.commit()
        await events.publish(
            agent.workspace_id,
            "broadcast.ack",
            {
                "broadcast_id": b.id,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "reply": receipt.reply,
            },
        )
