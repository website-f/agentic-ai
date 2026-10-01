"""Activities behind AgentTaskWorkflow and BroadcastRepliesWorkflow."""

import logging
from datetime import UTC, datetime
from typing import Any

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
