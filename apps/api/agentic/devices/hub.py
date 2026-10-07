"""The live PC sockets, in the API process (one uvicorn process: one registry).

Protocol (docs/PC-AGENT.md): the PC's first message is `hello` with its token; the server
answers `welcome` (or `error` and closes). Then `ping`/`pong`, `call`/`result`, `settings`
(server -> PC) and `state` (PC -> server). 60 s of silence = offline. A second connection for
the same device replaces the first.
"""

import asyncio
import contextlib
import json
import logging
import secrets
import time
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect

from ..core.db import SessionLocal
from ..models import Device
from . import core
from .core import DeviceError

log = logging.getLogger("agentic.devices")

HELLO_TIMEOUT = 15
SILENCE = 60


class Connection:
    def __init__(self, ws: WebSocket, device: Device, base: str) -> None:
        self.ws = ws
        self.id = secrets.token_hex(8)
        self.device_id = device.id
        self.user_id = device.user_id
        self.workspace_id = device.workspace_id
        self.base = base  # how this PC reaches us (upload / download links)
        self.pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._seen_written = time.monotonic()
        self.closed = False

    async def send(self, msg: dict[str, Any]) -> None:
        async with self._lock:
            await self.ws.send_text(json.dumps(msg, default=str))

    async def call(
        self, method: str, params: dict[str, Any], timeout: float, call_id: str
    ) -> dict[str, Any]:
        """Send one call and wait for its result message."""
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.pending[call_id] = fut
        try:
            try:
                await self.send({"type": "call", "id": call_id, "method": method, "params": params})
            except Exception as e:  # noqa: BLE001 - the socket went away under us
                raise DeviceError("offline", "The PC disconnected.") from e
            try:
                return await asyncio.wait_for(fut, timeout)
            except TimeoutError as e:
                raise DeviceError("timeout", "The PC did not answer in time.") from e
        finally:
            self.pending.pop(call_id, None)

    def resolve(self, msg: dict[str, Any]) -> None:
        fut = self.pending.get(str(msg.get("id") or ""))
        if fut is not None and not fut.done():
            fut.set_result(msg)

    def fail_all(self) -> None:
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(DeviceError("offline", "The PC disconnected."))

    async def close(self, code: int = 1000, error: tuple[str, str] | None = None) -> None:
        if self.closed:
            return
        self.closed = True
        with contextlib.suppress(Exception):
            if error:
                await self.send({"type": "error", "code": error[0], "message": error[1]})
            await self.ws.close(code)
        self.fail_all()


REGISTRY: dict[str, Connection] = {}


def connection(device_id: str) -> Connection | None:
    c = REGISTRY.get(device_id)
    return None if c is None or c.closed else c


async def push_settings(device: Device) -> None:
    """The person changed folders or pause on the web: tell the PC if it is connected here."""
    c = connection(device.id)
    if c is None:
        return
    with contextlib.suppress(Exception):
        await c.send(
            {"type": "settings", "folders": list(device.folders or []), "paused": device.paused}
        )


async def disconnect(device_id: str, code: str, message: str) -> None:
    c = REGISTRY.pop(device_id, None)
    if c is not None:
        await c.close(4401, (code, message))


async def _refuse(ws: WebSocket, code: str, message: str, close: int = 4401) -> None:
    with contextlib.suppress(Exception):
        await ws.send_text(json.dumps({"type": "error", "code": code, "message": message}))
        await ws.close(close)


async def _hello(ws: WebSocket) -> dict[str, Any] | None:
    try:
        raw = await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT)
        msg = json.loads(raw) if len(raw) <= core.MAX_MESSAGE else None
    except (TimeoutError, WebSocketDisconnect, ValueError, KeyError, RuntimeError):
        return None
    return msg if isinstance(msg, dict) and msg.get("type") == "hello" else None


async def serve(ws: WebSocket) -> None:
    """WS /api/devices/connect: one per PC."""
    await ws.accept()
    hello = await _hello(ws)
    if hello is None:
        await _refuse(ws, "bad_token", "Say hello with the device token first.")
        return
    async with SessionLocal() as db:
        d = await core.device_by_token(db, str(hello.get("token") or ""))
        if d is None:
            await _refuse(ws, "bad_token", "This computer is not linked. Link it again.")
            return
        if d.revoked_at is not None:
            await _refuse(ws, "revoked", "This computer was unlinked. Link it again to use it.")
            return
        d.version = core.clip(hello.get("version"), 40) or d.version
        if hello.get("os") in ("windows", "mac"):
            d.os = hello["os"]
        d.arch = core.clip(hello.get("arch"), 16) or d.arch
        d.hostname = core.clip(hello.get("hostname"), 120) or d.hostname
        if isinstance(hello.get("browsers"), list):
            d.browsers = core.short_list(hello["browsers"])
        if not d.folders:  # never set: the PC's defaults become the server's truth
            d.folders = core.reported_folders(hello.get("folders"))
        d.last_seen_at = core.now()
        await db.commit()
        await db.refresh(d)
        base = core.public_base(ws.headers, ws.url.scheme)
        conn = Connection(ws, d, base)
        welcome = {
            "type": "welcome",
            "device_id": d.id,
            "name": d.name,
            "settings": {"folders": list(d.folders or []), "paused": d.paused},
        }
        db.expunge(d)
    old = REGISTRY.get(d.id)
    REGISTRY[d.id] = conn
    if old is not None:
        await old.close(4409, ("replaced", "Another connection for this computer took over."))
    try:
        await conn.send(welcome)
        await core.set_online(d.id, conn.id, base)
        await core.publish(d, "device.status", online=True)
        await _loop(conn)
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:  # noqa: BLE001 - one PC's bad message never takes the API down
        log.warning("device socket failed: %s", d.id, exc_info=True)
    finally:
        conn.fail_all()
        conn.closed = True
        if REGISTRY.get(d.id) is conn:
            REGISTRY.pop(d.id, None)
            with contextlib.suppress(Exception):
                await core.clear_online(d.id, conn.id)
            await _seen(d.id)
            await core.publish(d, "device.status", online=False)


async def _loop(conn: Connection) -> None:
    while True:
        try:
            msg = await asyncio.wait_for(conn.ws.receive(), SILENCE)
        except TimeoutError:
            await conn.close(4408)
            return
        if msg.get("type") == "websocket.disconnect":
            return
        text = msg.get("text")
        if text is None:
            continue  # binary frames have no meaning on this socket
        if len(text) > core.MAX_MESSAGE:
            await conn.close(1009)
            return
        try:
            m = json.loads(text)
        except ValueError:
            continue
        if not isinstance(m, dict):
            continue
        await _alive(conn)
        kind = m.get("type")
        if kind == "ping":
            await conn.send({"type": "pong"})
        elif kind == "result":
            conn.resolve(m)
        elif kind == "state":
            await _state(conn, m)


async def _alive(conn: Connection) -> None:
    with contextlib.suppress(Exception):
        await core.touch_online(conn.device_id)
    if time.monotonic() - conn._seen_written >= core.LAST_SEEN_EVERY:  # noqa: SLF001
        conn._seen_written = time.monotonic()  # noqa: SLF001
        await _seen(conn.device_id)


async def _seen(device_id: str) -> None:
    with contextlib.suppress(Exception):
        async with SessionLocal() as db:
            d = await db.get(Device, device_id)
            if d is not None:
                d.last_seen_at = core.now()
                await db.commit()


async def _state(conn: Connection, m: dict[str, Any]) -> None:
    """Changed on the PC (folders, pause, browsers): the server stores it."""
    async with SessionLocal() as db:
        d = await db.get(Device, conn.device_id)
        if d is None or d.revoked_at is not None:
            return
        if isinstance(m.get("folders"), list):
            d.folders = core.reported_folders(m["folders"])
        if isinstance(m.get("browsers"), list):
            d.browsers = core.short_list(m["browsers"])
        if isinstance(m.get("paused"), bool) and m["paused"] != d.paused:
            d.paused = m["paused"]
            await core.log_activity(db, d, "pause" if d.paused else "resume", {"by": "pc"})
        await db.commit()
        await db.refresh(d)
        db.expunge(d)
    await core.publish(d, "device.updated")
