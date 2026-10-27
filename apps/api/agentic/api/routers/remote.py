"""P42: a person's own linked computer, used directly from the web while they are away: its
health, its shared folders (browse, download), its screen live, and mouse and keyboard.

The computer's owner, or (P53, company-owned computers) a manager who oversees it
(devices._managed_device), never an AI. Screen and input need two locks: `agentic-pc remote
view|control` run ON the computer (remote_pc), and the same level allowed on the web with the
viewer's own password (remote_allowed). The computer shows a notification when a remote
session starts, whoever is viewing, and every session is in its activity log.

- GET  /api/devices/{id}/health
- GET  /api/devices/{id}/files?path=  |  ?q=        list a shared folder, or search
- GET  /api/devices/{id}/files/download?path=
- PUT  /api/devices/{id}/remote          {level, password}
- GET  /api/devices/{id}/screen?w=&q=    one JPEG frame (the page asks again for a live view)
- POST /api/devices/{id}/input           {kind: mouse|key, ...}
"""

from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import verify_password
from ...devices import bridge, core
from ...devices.core import DeviceError
from ...models import Device
from ...services import audit
from ..deps import Principal, api_error, current_principal
from .devices import _managed_device

router = APIRouter(tags=["devices"])

ERRORS = {
    "offline": (status.HTTP_409_CONFLICT, "This computer is offline."),
    "paused": (status.HTTP_409_CONFLICT, "This computer is paused."),
    "timeout": (status.HTTP_504_GATEWAY_TIMEOUT, "The computer did not answer in time."),
    "not_allowed": (status.HTTP_403_FORBIDDEN, ""),
    "not_found": (status.HTTP_404_NOT_FOUND, ""),
    "too_big": (status.HTTP_413_CONTENT_TOO_LARGE, ""),
    "no_screen": (status.HTTP_409_CONFLICT, ""),
}


def _fail(e: DeviceError) -> Exception:
    code, default = ERRORS.get(e.code, (status.HTTP_502_BAD_GATEWAY, ""))
    return api_error(code, f"device_{e.code}", e.message or default or "The computer said no.")


def _need(d: Device, level: str) -> None:
    order = {lvl: i for i, lvl in enumerate(core.REMOTE_LEVELS)}
    if order[core.remote_level(d)] >= order[level]:
        return
    if order.get(d.remote_pc or "off", 0) < order[level]:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "remote_off_on_pc",
            "Remote {level} is off on the computer itself. On it, run: agentic-pc remote {level}",
            level=level,
        )
    raise api_error(
        status.HTTP_403_FORBIDDEN,
        "remote_off_on_web",
        "Turn on remote {level} for this computer first (My computers).",
        level=level,
    )


@router.get("/api/devices/{device_id}/health")
async def health(
    device_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _managed_device(db, principal, device_id)
    try:
        return await bridge.call(d.id, "system.health", {}, 20.0)
    except DeviceError as e:
        raise _fail(e) from e


@router.get("/api/devices/{device_id}/files")
async def files(
    device_id: str,
    path: str = Query(default="", max_length=1000),
    q: str = Query(default="", max_length=200),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A shared folder's contents (no path: the shared folders), or a search in them."""
    d = await _managed_device(db, principal, device_id)
    if not path and not q:
        return {"folders": list(d.folders or []), "items": []}
    try:
        if q:
            return await bridge.call(d.id, "files.search", {"query": q, "limit": 50}, 30.0)
        return await bridge.call(d.id, "files.list", {"folder": path}, 30.0)
    except DeviceError as e:
        raise _fail(e) from e


@router.get("/api/devices/{device_id}/files/download")
async def download(
    device_id: str,
    path: str = Query(min_length=1, max_length=1000),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    d = await _managed_device(db, principal, device_id)
    try:
        name, data = await bridge.fetch_file(d.id, path, kind="download", timeout=110.0)
    except DeviceError as e:
        raise _fail(e) from e
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


class RemoteIn(BaseModel):
    level: Literal["off", "view", "control"]
    password: str = Field(default="", max_length=200)


@router.put("/api/devices/{device_id}/remote")
async def set_remote(
    device_id: str,
    body: RemoteIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _managed_device(db, principal, device_id)
    if body.level != "off" and not verify_password(principal.user.password_hash, body.password):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "password_required",
            "Enter your password to allow seeing or using this computer from the web.",
        )
    before = d.remote_allowed
    d.remote_allowed = body.level
    await core.log_activity(db, d, "remote", {"by": "web", "level": body.level})
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "device.remote",
        target=d.id,
        before={"level": before},
        after={"level": body.level},
    )
    await db.commit()
    await db.refresh(d)
    await core.publish(d, "device.updated")
    online = await core.online_ids([d.id])
    return core.device_out(d, d.id in online)


@router.get("/api/devices/{device_id}/screen")
async def screen(
    device_id: str,
    w: int = Query(default=1600, ge=320, le=3840),
    q: int = Query(default=65, ge=20, le=90),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    d = await _managed_device(db, principal, device_id)
    _need(d, "view")
    try:
        raw, info = await bridge.fetch_screen(d.id, w, q)
    except DeviceError as e:
        raise _fail(e) from e
    return Response(
        content=raw,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Screen-Width": str(info.get("screen_width") or ""),
            "X-Screen-Height": str(info.get("screen_height") or ""),
        },
    )


class InputIn(BaseModel):
    kind: Literal["mouse", "key"]
    # mouse: where, as a share of the screen (0..1), and what
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    action: Literal["move", "click", "double", "right", "scroll"] = "click"
    dy: int = Field(default=0, ge=-20, le=20)  # scroll notches, down positive
    # key: text to type, or one named key / combination (enter, tab, esc, ctrl+c, alt+tab...)
    text: str = Field(default="", max_length=2000)
    key: str = Field(default="", max_length=40, pattern=r"^[a-z0-9+]*$")


@router.post("/api/devices/{device_id}/input")
async def send_input(
    device_id: str,
    body: InputIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _managed_device(db, principal, device_id)
    _need(d, "control")
    if body.kind == "mouse" and (body.x is None or body.y is None):
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "where", "Say where to point.")
    if body.kind == "key" and not (body.text or body.key):
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "what", "Say what to type.")
    try:
        return await bridge.call(d.id, "input.send", body.model_dump(), 20.0)
    except DeviceError as e:
        raise _fail(e) from e
