"""Server-sent events: one stream per signed-in tab. Replays what was missed, then follows live."""

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ...core.db import SessionLocal
from ...core.valkey import valkey
from ...models import Event
from ...services.events import channel
from ..deps import Principal, require

router = APIRouter(tags=["events"])

HEARTBEAT = 15
REPLAY_LIMIT = 500


def _frame(seq: int, payload: dict) -> str:
    return f"id: {seq}\ndata: {json.dumps(payload, default=str)}\n\n"


@router.get("/api/events")
async def stream(
    request: Request,
    since: int | None = Query(default=None),
    principal: Principal = Depends(require("read")),
) -> StreamingResponse:
    last_id = request.headers.get("last-event-id")
    start = (
        since if since is not None else (int(last_id) if last_id and last_id.isdigit() else None)
    )
    ws = principal.workspace_id

    async def gen() -> AsyncIterator[str]:
        pubsub = valkey().pubsub()
        await pubsub.subscribe(channel(ws))  # subscribe first so nothing falls in the gap
        try:
            async with SessionLocal() as db:
                if start is None:
                    cursor = (
                        await db.scalar(select(func.max(Event.seq)).where(Event.workspace_id == ws))
                        or 0
                    )
                else:
                    cursor = start
                    rows = (
                        await db.scalars(
                            select(Event)
                            .where(Event.workspace_id == ws, Event.seq > start)
                            .order_by(Event.seq)
                            .limit(REPLAY_LIMIT)
                        )
                    ).all()
                    for e in rows:
                        cursor = e.seq
                        yield _frame(
                            e.seq,
                            {"seq": e.seq, "ts": e.ts.isoformat(), "type": e.type, "data": e.data},
                        )
            yield f": connected at {cursor}\nretry: 3000\n\n"
            while not await request.is_disconnected():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=HEARTBEAT)
                if msg is None:
                    yield ": ping\n\n"
                    continue
                payload = json.loads(msg["data"])
                if payload["seq"] > cursor:
                    cursor = payload["seq"]
                    yield _frame(cursor, payload)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
