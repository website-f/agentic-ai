"""Live events: persisted for replay, fanned out over Valkey pub/sub.

Both the API and the worker publish. The SSE endpoint replays from the `events` table
(so a phone that slept catches up) and then follows the Valkey channel.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete

from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..models import Event

log = logging.getLogger("agentic.events")

RETENTION = timedelta(days=7)


def channel(workspace_id: str) -> str:
    return f"events:{workspace_id}"


async def publish(workspace_id: str, type_: str, data: dict[str, Any]) -> int | None:
    """Never raises: a lost live update must not break the work that caused it."""
    try:
        async with SessionLocal() as db:
            ev = Event(workspace_id=workspace_id, ts=datetime.now(UTC), type=type_, data=data)
            db.add(ev)
            await db.commit()
            seq = ev.seq
        payload = {"seq": seq, "ts": ev.ts.isoformat(), "type": type_, "data": data}
        await valkey().publish(channel(workspace_id), json.dumps(payload, default=str))
        return seq
    except Exception:  # noqa: BLE001
        log.warning("event publish failed: %s", type_, exc_info=True)
        return None


async def prune() -> int:
    async with SessionLocal() as db:
        res = await db.execute(delete(Event).where(Event.ts < datetime.now(UTC) - RETENTION))
        await db.commit()
        return res.rowcount or 0  # type: ignore[attr-defined]
