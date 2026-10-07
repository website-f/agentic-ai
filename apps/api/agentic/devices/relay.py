"""The CDP relay: the browser service drives the Chrome/Edge on a person's PC.

`browser.open` (bridge.open_browser) creates a channel for one device; the PC opens
WS /api/devices/cdp/{channel} (first message `hello` with its token, then raw CDP frames) and
the browser service opens WS /internal/devices/cdp/{channel} (X-Browser-Token). The two are
paired and every text and binary frame is piped both ways until either side closes (16 MB a
frame, 2 h idle).
"""

import asyncio
import contextlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass, field

from starlette.websockets import WebSocket

from ..core.config import settings
from ..core.db import SessionLocal
from . import core

log = logging.getLogger("agentic.devices")

MAX_FRAME = 16 * 1024 * 1024
IDLE = 2 * 3600
PC_WAIT = 30  # the browser side waits this long for the PC's socket
UNUSED = 120  # a channel nobody connected to is dropped after this


@dataclass
class Channel:
    id: str
    device_id: str
    created: float = field(default_factory=time.monotonic)
    pc: WebSocket | None = None
    browser: WebSocket | None = None
    pc_ready: asyncio.Event = field(default_factory=asyncio.Event)
    done: asyncio.Event = field(default_factory=asyncio.Event)


CHANNELS: dict[str, Channel] = {}


def create(device_id: str) -> Channel:
    _sweep()
    ch = Channel(secrets.token_urlsafe(18), device_id)
    CHANNELS[ch.id] = ch
    return ch


def _sweep() -> None:
    stale = time.monotonic() - UNUSED
    for cid, ch in list(CHANNELS.items()):
        if ch.pc is None and ch.browser is None and ch.created < stale:
            CHANNELS.pop(cid, None)


async def wait_pc(channel_id: str, timeout: float) -> bool:
    ch = CHANNELS.get(channel_id)
    if ch is None:
        return False
    try:
        await asyncio.wait_for(ch.pc_ready.wait(), timeout)
    except TimeoutError:
        return False
    return True


async def close(channel_id: str) -> None:
    ch = CHANNELS.pop(channel_id, None)
    if ch is None:
        return
    ch.done.set()
    for ws in (ch.pc, ch.browser):
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.close(1000)


def browser_token_ok(given: str | None) -> bool:
    return bool(given) and hmac.compare_digest(settings.browser_token, given or "")


async def serve_pc(ws: WebSocket, channel_id: str) -> None:
    """WS /api/devices/cdp/{channel}: the PC's side."""
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), 15)
        hello = json.loads(raw) if len(raw) <= core.MAX_MESSAGE else {}
    except Exception:  # noqa: BLE001 - timeout, disconnect, bad JSON
        hello = {}
    ch = CHANNELS.get(channel_id)
    ok = False
    if isinstance(hello, dict) and hello.get("type") == "hello" and ch is not None:
        async with SessionLocal() as db:
            d = await core.device_by_token(db, str(hello.get("token") or ""))
            ok = (
                d is not None
                and d.revoked_at is None
                and d.id == ch.device_id
                and ch.pc is None
                and not ch.done.is_set()
            )
    if not ok or ch is None:
        with contextlib.suppress(Exception):
            await ws.send_text(
                json.dumps({"type": "error", "code": "bad_channel", "message": "Not your channel."})
            )
            await ws.close(4404)
        return
    ch.pc = ws
    ch.pc_ready.set()
    try:
        # The browser side runs the pipe (it always arrives after this); this handler only
        # keeps the PC's socket open until the pair ends.
        await asyncio.wait_for(ch.done.wait(), IDLE)
    except TimeoutError:
        pass
    finally:
        if not ch.done.is_set():
            await close(channel_id)


async def serve_browser(ws: WebSocket, channel_id: str) -> None:
    """WS /internal/devices/cdp/{channel}: the browser service's side."""
    if not browser_token_ok(ws.headers.get("x-browser-token")):
        await ws.close(4403)
        return
    ch = CHANNELS.get(channel_id)
    if ch is None or ch.browser is not None or ch.done.is_set():
        await ws.close(4404)
        return
    await ws.accept()
    try:
        await asyncio.wait_for(ch.pc_ready.wait(), PC_WAIT)
    except TimeoutError:
        await close(channel_id)
        with contextlib.suppress(Exception):
            await ws.close(4408)
        return
    ch.browser = ws
    assert ch.pc is not None
    try:
        await pipe(ch.pc, ws)
    finally:
        await close(channel_id)


async def _pump(src: WebSocket, dst: WebSocket) -> None:
    while True:
        msg = await asyncio.wait_for(src.receive(), IDLE)
        if msg.get("type") == "websocket.disconnect":
            return
        text, data = msg.get("text"), msg.get("bytes")
        if text is not None:
            if len(text) > MAX_FRAME:
                return
            await dst.send_text(text)
        elif data is not None:
            if len(data) > MAX_FRAME:
                return
            await dst.send_bytes(data)


async def pipe(a: WebSocket, b: WebSocket) -> None:
    """Both ways until either side closes, goes quiet for 2 h, or sends an oversized frame."""
    tasks = [asyncio.create_task(_pump(a, b)), asyncio.create_task(_pump(b, a))]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
