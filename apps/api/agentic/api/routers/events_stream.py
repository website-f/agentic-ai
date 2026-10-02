"""Server-sent events: one stream per signed-in tab. Replays what was missed, then follows live."""

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ...core.db import SessionLocal
from ...core.security import can
from ...models import Agent, Event
from ...services.hub import CLOSE, hub
from ..deps import Principal, api_error, current_principal

router = APIRouter(tags=["events"])


async def stream_principal(request: Request) -> Principal:
    """Sign-in check on a session that closes at once. The usual get_db dependency keeps
    its connection until the response ends, and a live stream never ends: 20 open tabs
    would hold the whole pool and stall every other request."""
    async with SessionLocal() as db:
        principal = await current_principal(request, db)
    if not can(principal.role, "read"):
        raise api_error(403, "forbidden", "Your role cannot read this workspace.")
    return principal


HEARTBEAT = 15
REPLAY_LIMIT = 500
SCOPE_REFRESH = 30  # seconds: agents a scoped viewer may follow are re-read this often


async def _visible_ids(principal: Principal) -> set[str]:
    cond = principal.scope.agent_where()
    if cond is None:
        return set()
    async with SessionLocal() as db:
        return set(
            (
                await db.scalars(
                    select(Agent.id).where(Agent.workspace_id == principal.workspace_id, cond)
                )
            ).all()
        )


def _frame(seq: int, payload: dict) -> str:
    return f"id: {seq}\ndata: {json.dumps(payload, default=str)}\n\n"


@router.get("/api/events")
async def stream(
    request: Request,
    since: int | None = Query(default=None),
    principal: Principal = Depends(stream_principal),
) -> StreamingResponse:
    last_id = request.headers.get("last-event-id")
    start = (
        since if since is not None else (int(last_id) if last_id and last_id.isdigit() else None)
    )
    ws = principal.workspace_id
    scope = principal.scope
    loop = asyncio.get_running_loop()
    seen: dict[str, object] = {"ids": await _visible_ids(principal), "at": loop.time()}

    async def ok(type_: str, data: dict) -> bool:
        if scope.everything:
            return True
        if type_ == "agent.upsert" or loop.time() - float(seen["at"]) > SCOPE_REFRESH:
            seen["ids"], seen["at"] = await _visible_ids(principal), loop.time()
        return scope.event_visible(type_, data or {}, seen["ids"])  # type: ignore[arg-type]

    async def gen() -> AsyncIterator[str]:
        q = await hub.join(ws)  # listen first so nothing falls in the gap
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
                        if not await ok(e.type, e.data):
                            continue
                        yield _frame(
                            e.seq,
                            {"seq": e.seq, "ts": e.ts.isoformat(), "type": e.type, "data": e.data},
                        )
            yield f": connected at {cursor}\nretry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(q.get(), HEARTBEAT)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                if payload is CLOSE:
                    break  # the browser reconnects and replays from its last event id
                if payload["seq"] > cursor:
                    cursor = payload["seq"]
                    if await ok(payload.get("type", ""), payload.get("data") or {}):
                        yield _frame(cursor, payload)
        except asyncio.CancelledError:
            pass
        finally:
            hub.leave(ws, q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
