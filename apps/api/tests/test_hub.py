"""The event hub: one subscription per process, fanned out per workspace."""

import asyncio
import json

from agentic.services import hub as hub_mod
from agentic.services.hub import CLOSE, Hub


def ev(seq: int) -> str:
    return json.dumps({"seq": seq, "type": "task.created", "data": {}})


async def test_fan_out_only_to_the_right_workspace():
    h = Hub()
    a1: asyncio.Queue = asyncio.Queue(maxsize=10)
    a2: asyncio.Queue = asyncio.Queue(maxsize=10)
    b: asyncio.Queue = asyncio.Queue(maxsize=10)
    h.queues = {"ws_a": {a1, a2}, "ws_b": {b}}
    h.dispatch("events:ws_a", ev(1))
    assert a1.get_nowait()["seq"] == 1 and a2.get_nowait()["seq"] == 1 and b.empty()
    h.leave("ws_a", a1)
    h.leave("ws_a", a2)
    assert "ws_a" not in h.queues


async def test_slow_stream_is_closed_not_blocking(monkeypatch):
    monkeypatch.setattr(hub_mod, "QUEUE_SIZE", 2)
    h = Hub()
    slow: asyncio.Queue = asyncio.Queue(maxsize=2)
    fast: asyncio.Queue = asyncio.Queue(maxsize=100)
    h.queues = {"ws": {slow, fast}}
    for seq in range(1, 5):
        h.dispatch("events:ws", ev(seq))
        fast.get_nowait()
    items = [slow.get_nowait() for _ in range(slow.qsize())]
    assert items[-1] is CLOSE  # told to reconnect (and replay) instead of stalling others
    assert slow not in h.queues["ws"] and fast in h.queues["ws"]
