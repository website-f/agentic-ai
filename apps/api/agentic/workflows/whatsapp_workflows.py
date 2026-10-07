"""P29: inbound WhatsApp messages are answered by the worker, not in the API process.

The webhook used to hand each message to FastAPI's BackgroundTasks, so an API restart lost
it. Now the webhook starts one small workflow per message (its id comes from the message id,
so a webhook the gateway sends twice is one workflow) and answers the gateway at once. When
Temporal cannot be reached the API falls back to answering in the background, as before.
"""

import logging
from dataclasses import asdict
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from ..core.db import SessionLocal

log = logging.getLogger("agentic.whatsapp.inbound")


def workflow_id(channel_id: str, message_id: str) -> str:
    return f"wa-in-{channel_id}-{message_id}"[:250]


@activity.defn
async def whatsapp_inbound(channel_id: str, msg: dict[str, Any]) -> None:
    from ..channels import wa_bot, whatsapp
    from ..models import Channel

    audio = msg.get("audio")
    inbound = whatsapp.Inbound(
        message_id=str(msg.get("message_id") or ""),
        sender=str(msg.get("sender") or ""),
        name=str(msg.get("name") or ""),
        text=str(msg.get("text") or ""),
        audio=whatsapp.Audio(**audio) if isinstance(audio, dict) else None,
    )
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        if ch is None or not ch.enabled:
            return
        await wa_bot.handle(db, ch, inbound)


@workflow.defn
class WhatsAppInboundWorkflow:
    @workflow.run
    async def run(self, channel_id: str, msg: dict[str, Any]) -> None:
        # One attempt: wa_bot answers each message at most once (its dedupe key is taken
        # first), so a retry could not answer it anyway.
        await workflow.execute_activity(
            whatsapp_inbound,
            args=[channel_id, msg],
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )


async def start(channel_id: str, msg: Any) -> bool:
    """Hand one inbound message to the worker. True when it is queued durably (or was
    already); False when Temporal is unreachable (the caller answers it itself)."""
    from temporalio.exceptions import WorkflowAlreadyStartedError

    from ..core.config import settings
    from ..core.temporal import temporal_client

    if not getattr(msg, "message_id", ""):
        return False  # no stable id to dedupe a durable start on
    try:
        client = await temporal_client()
        await client.start_workflow(
            WhatsAppInboundWorkflow.run,
            args=[channel_id, asdict(msg)],
            id=workflow_id(channel_id, msg.message_id),
            task_queue=settings.temporal_task_queue,
        )
    except WorkflowAlreadyStartedError:
        return True  # the gateway sent it twice
    except Exception:  # noqa: BLE001 - Temporal is unreachable: answer in the API instead
        log.warning("Temporal unreachable; answering WhatsApp in the API", exc_info=True)
        return False
    return True
