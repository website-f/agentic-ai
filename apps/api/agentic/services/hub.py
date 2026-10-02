"""One Valkey subscription per API process, fanned out to every open event stream.

A subscription per browser tab would hold one Valkey connection each; a few hundred tabs
exhaust the client pool and then even publishing fails. Here a single pattern subscription
(`events:*`) feeds an in-memory queue per stream. A stream that falls behind, or a lost
Valkey connection, closes the stream; the browser reconnects with Last-Event-ID and the
missed events are replayed from Postgres, so nothing is lost.
"""

import asyncio
import contextlib
import json
import logging
from typing import Any

import redis.asyncio as aioredis

from ..core.config import settings

log = logging.getLogger("agentic.hub")

QUEUE_SIZE = 1000
CLOSE: dict[str, Any] = {"__close__": True}


class Hub:
    def __init__(self) -> None:
        self.queues: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self.reader: asyncio.Task[None] | None = None
        self.ready = asyncio.Event()

    def _ensure(self) -> None:
        if self.reader is None or self.reader.done():
            self.ready.clear()
            self.reader = asyncio.create_task(self._run())

    async def join(self, workspace_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.queues.setdefault(workspace_id, set()).add(q)
        self._ensure()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self.ready.wait(), 5)  # subscribed before we replay
        return q

    def leave(self, workspace_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        subs = self.queues.get(workspace_id)
        if subs is not None:
            subs.discard(q)
            if not subs:
                self.queues.pop(workspace_id, None)

    def _close_all(self) -> None:
        for subs in self.queues.values():
            for q in subs:
                self._offer(q, CLOSE)

    @staticmethod
    def _offer(q: asyncio.Queue[dict[str, Any]], item: dict[str, Any]) -> bool:
        try:
            q.put_nowait(item)
            return True
        except asyncio.QueueFull:
            return False

    def dispatch(self, channel: str, raw: str) -> None:
        ws = channel.removeprefix("events:")
        subs = self.queues.get(ws)
        if not subs:
            return
        payload = json.loads(raw)
        for q in list(subs):
            if not self._offer(q, payload):
                # Too slow to keep up: close it; the reconnect replays from the database.
                subs.discard(q)
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                self._offer(q, CLOSE)

    async def _run(self) -> None:
        client = aioredis.from_url(settings.valkey_url, decode_responses=True)
        pubsub = client.pubsub()
        try:
            await pubsub.psubscribe("events:*")
            self.ready.set()
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30)
                if msg and msg.get("type") == "pmessage":
                    self.dispatch(str(msg["channel"]), str(msg["data"]))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - Valkey went away: streams reconnect and replay
            log.warning("event hub lost Valkey; closing streams", exc_info=True)
            self._close_all()
        finally:
            self.ready.clear()
            with contextlib.suppress(Exception):
                await pubsub.aclose()
                await client.aclose()


hub = Hub()
