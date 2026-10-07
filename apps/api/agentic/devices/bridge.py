"""Calls to a person's PC from any process.

The PC's socket lives in the API process (`hub`). There `call` sends and awaits the result
directly; anywhere else (the worker, where agent tools run) it POSTs to the API's internal
endpoint `/internal/devices/{id}/call` with X-Internal-Token (HMAC of the app secret), which
performs the call and answers with the PC's result. Every call writes a `device_activity` row
(in the API process, once).
"""

import json
import os
import secrets
from typing import Any

import httpx

from ..core.db import SessionLocal
from ..core.valkey import valkey, valkey_bytes
from ..models import Device
from . import core, hub, relay
from .core import DeviceError

# Set by api/routers/devices.py on import: this process holds the PC sockets.
SERVE_HERE = False
_transport: httpx.AsyncBaseTransport | None = None  # tests: reach the API in-process


def serve_here(on: bool = True) -> None:
    global SERVE_HERE
    SERVE_HERE = on


def use_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = transport


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _bytes(value: Any) -> bytes | None:
    if value is None:
        return None
    return value if isinstance(value, bytes) else str(value).encode("latin-1")


def new_call_id() -> str:
    return f"c_{secrets.token_urlsafe(12)}"


def _up_key(call_id: str) -> str:
    return f"devices:up:{call_id}"


def _file_key(call_id: str) -> str:
    return f"devices:file:{call_id}"


def _name_key(call_id: str) -> str:
    return f"devices:fname:{call_id}"


def _down_key(oid: str) -> str:
    return f"devices:down:{oid}"


def _down_meta(oid: str) -> str:
    return f"devices:downmeta:{oid}"


# ---------------------------------------------------------------- calls


async def call(
    device_id: str,
    method: str,
    params: dict[str, Any] | None = None,
    timeout: float = 30.0,
    *,
    call_id: str | None = None,
    kind: str | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """The PC's `data` for this call, or DeviceError (offline, timeout, paused, revoked, or
    the PC's own code: not_allowed, not_found, too_big, no_browser, busy, failed)."""
    if method not in core.METHODS:
        raise DeviceError("failed", "Unknown method.")
    timeout = max(1.0, min(float(timeout), 600.0))
    call_id = call_id or new_call_id()
    if SERVE_HERE:
        return await call_here(
            device_id,
            method,
            params or {},
            timeout,
            call_id=call_id,
            kind=kind,
            agent_id=agent_id,
            task_id=task_id,
        )
    body = {
        "method": method,
        "params": params or {},
        "timeout": timeout,
        "call_id": call_id,
        "kind": kind,
        "agent_id": agent_id,
        "task_id": task_id,
    }
    return await _remote(f"/internal/devices/{device_id}/call", body, timeout + 15)


async def _remote(path: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=timeout) as c:
            r = await c.post(
                f"{core.internal_url()}{path}",
                json=body,
                headers={"x-internal-token": core.internal_token()},
            )
    except httpx.HTTPError as e:
        raise DeviceError("offline", "The server could not reach the PC connection.") from e
    try:
        out = r.json()
    except ValueError:
        out = {}
    if r.status_code != 200 or not isinstance(out, dict):
        raise DeviceError("failed", f"The PC connection answered {r.status_code}.")
    if out.get("ok"):
        return _dict(out.get("data"))
    err = _dict(out.get("error"))
    raise DeviceError(str(err.get("code") or "failed"), str(err.get("message") or ""))


def _summary(method: str, data: dict[str, Any]) -> dict[str, Any]:
    """What the activity log keeps of a result: counts, sizes and where things landed."""
    if method == "files.search":
        return {"found": len(data.get("items") or [])}
    if method == "files.list":
        return {"items": len(data.get("items") or [])}
    if method == "files.upload":
        return {"size": data.get("size") if isinstance(data.get("size"), int) else None}
    if method == "files.save":
        return {"saved_to": data.get("path"), "size": data.get("size")}
    if method == "browser.open":
        return {"browser": data.get("browser")}
    return {}


async def call_here(
    device_id: str,
    method: str,
    params: dict[str, Any],
    timeout: float,
    *,
    call_id: str,
    kind: str | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """In the API process: send to the live socket and wait for the result."""
    kind = kind or core.METHOD_KIND[method]
    params = dict(params)
    detail = core.safe_detail(params)

    async def failed(code: str, message: str) -> DeviceError:
        await core.record(
            device_id,
            kind,
            {**detail, "error": code},
            ok=False,
            agent_id=agent_id,
            task_id=task_id,
        )
        return DeviceError(code, message)

    async with SessionLocal() as db:
        d = await db.get(Device, device_id)
        revoked, paused = (d is None or d.revoked_at is not None), bool(d and d.paused)
    if d is None:
        raise DeviceError("not_found", "There is no such computer.")
    if revoked:
        raise await failed("revoked", "This computer was unlinked.")
    if paused:
        raise await failed("paused", "This computer is paused.")
    conn = hub.connection(device_id)
    if conn is None:
        raise await failed("offline", "This computer is offline.")
    if method == "files.upload":
        params["upload_url"] = f"{conn.base}/api/devices/uploads/{call_id}"
    elif method == "files.save" and "download_url" not in params:
        oid = str(params.pop("download_id", "") or "")
        params["download_url"] = f"{conn.base}/api/devices/downloads/{oid}"
    try:
        try:
            res = await conn.call(method, params, timeout, call_id)
        except DeviceError as e:
            raise await failed(e.code, e.message) from None
        if res.get("ok"):
            data = _dict(res.get("data"))
            await core.record(
                device_id,
                kind,
                core.safe_detail(params, _summary(method, data)),
                ok=True,
                agent_id=agent_id,
                task_id=task_id,
            )
            return data
        err = _dict(res.get("error"))
        code = core.clip(err.get("code") or "failed", 40)
        raise await failed(code, core.clip(err.get("message"), 500))
    finally:
        if method == "browser.close" and params.get("channel"):
            await relay.close(str(params["channel"]))


# ---------------------------------------------------------------- files


async def fetch_file(
    device_id: str,
    path: str,
    *,
    max_bytes: int = core.MAX_UPLOAD,
    kind: str = "upload",
    agent_id: str | None = None,
    task_id: str | None = None,
    timeout: float = 180.0,
) -> tuple[str, bytes]:
    """The PC uploads one file (files.upload); returns (name, bytes). Nothing is stored."""
    max_bytes = max(1, min(int(max_bytes), core.MAX_UPLOAD))
    call_id = new_call_id()
    await valkey().set(
        _up_key(call_id),
        json.dumps({"device": device_id, "max": max_bytes}),
        ex=core.FILE_TTL,
    )
    try:
        data = await call(
            device_id,
            "files.upload",
            {"path": path, "max_bytes": max_bytes},
            timeout,
            call_id=call_id,
            kind=kind,
            agent_id=agent_id,
            task_id=task_id,
        )
    finally:
        await valkey().delete(_up_key(call_id))
    raw = _bytes(await valkey_bytes().getdel(_file_key(call_id)))
    sent_name = await valkey().getdel(_name_key(call_id))
    if raw is None:
        raise DeviceError("failed", "The PC did not send the file.")
    name = str(data.get("name") or sent_name or os.path.basename(path.replace("\\", "/")))
    want = str(data.get("sha256") or "").lower()
    if want:
        import hashlib

        if hashlib.sha256(raw).hexdigest() != want:
            raise DeviceError("failed", "The file changed on the way. Try again.")
    return core.clip(name, 200) or "file", bytes(raw)


async def pending_upload(call_id: str) -> dict[str, Any] | None:
    raw = await valkey().get(_up_key(call_id))
    try:
        out = json.loads(raw) if raw else None
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


async def keep_upload(call_id: str, name: str, data: bytes) -> None:
    """Bytes the PC posted for a files.upload call, until the tool picks them up."""
    await valkey_bytes().set(_file_key(call_id), data, ex=core.FILE_TTL)
    await valkey().set(_name_key(call_id), name, ex=core.FILE_TTL)
    await valkey().delete(_up_key(call_id))  # one upload per call


async def offer_download(device_id: str, data: bytes, name: str) -> str:
    """A one-time link (5 minutes) for files.save, for this device only."""
    oid = secrets.token_urlsafe(24)
    await valkey_bytes().set(_down_key(oid), data, ex=core.FILE_TTL)
    await valkey().set(
        _down_meta(oid), json.dumps({"device": device_id, "name": name}), ex=core.FILE_TTL
    )
    return oid


async def take_download(oid: str, device_id: str) -> tuple[str, bytes] | None:
    """Single use: the bytes for this device's one-time link, or None."""
    raw = await valkey().get(_down_meta(oid))
    try:
        meta = json.loads(raw) if raw else None
    except ValueError:
        meta = None
    if not isinstance(meta, dict) or meta.get("device") != device_id:
        return None
    await valkey().delete(_down_meta(oid))
    data = _bytes(await valkey_bytes().getdel(_down_key(oid)))
    if data is None:
        return None
    return str(meta.get("name") or "file"), data


# ---------------------------------------------------------------- the browser on the PC


def internal_ws(channel: str) -> str:
    base = core.internal_url()
    base = "ws" + base[4:] if base.startswith("http") else base
    return f"{base}/internal/devices/cdp/{channel}"


async def open_browser(
    device_id: str,
    start_url: str | None = None,
    *,
    agent_id: str | None = None,
    task_id: str | None = None,
    timeout: float = 60.0,
) -> tuple[str, str]:
    """Start the PC's browser (its own Agent profile) and its CDP relay. Returns (channel,
    the internal ws:// URL the browser service connects to with its X-Browser-Token)."""
    if not SERVE_HERE:
        body = {"start_url": start_url, "agent_id": agent_id, "task_id": task_id}
        data = await _remote(f"/internal/devices/{device_id}/browser", body, timeout + 30)
        return str(data.get("channel") or ""), str(data.get("ws_url") or "")
    ch = relay.create(device_id)
    params: dict[str, Any] = {"channel": ch.id}
    if start_url:
        params["start_url"] = start_url
    try:
        await call(
            device_id,
            "browser.open",
            params,
            timeout,
            agent_id=agent_id,
            task_id=task_id,
        )
        if not await relay.wait_pc(ch.id, 20):
            raise DeviceError("failed", "The browser on the PC did not connect.")
    except BaseException:
        await relay.close(ch.id)
        raise
    return ch.id, internal_ws(ch.id)


async def close_browser(
    device_id: str, channel: str, *, agent_id: str | None = None, task_id: str | None = None
) -> None:
    await call(
        device_id,
        "browser.close",
        {"channel": channel},
        20,
        agent_id=agent_id,
        task_id=task_id,
    )
