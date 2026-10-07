"""P31: a person's own computers (docs/PC-AGENT.md).

For the person (session): link codes, their computers, folders, pause, unlink, activity.
For the PC (no session; the code, then its bearer token): the install script, claim, the
connection socket, file uploads and downloads, the CDP relay socket.
Inside the stack (X-Internal-Token / X-Browser-Token): calls from the worker, the browser
service's side of the CDP relay. Nginx never proxies /internal/.

Personal like a private assistant: only the device's own person sees or changes it (404 for
anyone else, admins included).
"""

from typing import Any
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, WebSocket, status
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...assistants.access import may_assist
from ...core.config import settings
from ...core.db import SessionLocal, get_db
from ...core.valkey import valkey
from ...devices import bridge, core, hub, install, relay
from ...devices.core import DeviceError
from ...models import Agent, Device, DeviceActivity, DeviceLinkCode, Membership, User
from ..deps import Principal, api_error, client_ip, current_principal

router = APIRouter(tags=["devices"])

# This process holds the PC sockets: calls made here go straight to them.
bridge.serve_here()

UPLOAD_PREFIX = "/api/devices/uploads/"
KINDS = frozenset(
    {"search", "list", "read", "upload", "save", "browser_open", "browser_close", "info"}
)


# ---------------------------------------------------------------- linking (the person)


async def _may_link(db: AsyncSession, principal: Principal) -> bool:
    """Whoever may have a personal AI: their AI twin, or personal assistants by role."""
    if may_assist(principal.role):
        return True
    twin = await db.scalar(
        select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id,
            Agent.owner_user_id == principal.user.id,
            Agent.is_twin.is_(True),
            Agent.status != "retired",
        )
    )
    return twin is not None


@router.post("/api/devices/link-code", status_code=status.HTTP_201_CREATED)
async def link_code(
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not await _may_link(db, principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "no_personal_ai",
            "Linking a computer is for your own AI. Make your AI twin first (My AI), then "
            "link this computer.",
        )
    now = core.now()
    open_codes = await db.scalar(
        select(func.count())
        .select_from(DeviceLinkCode)
        .where(
            DeviceLinkCode.user_id == principal.user.id,
            DeviceLinkCode.used_at.is_(None),
            DeviceLinkCode.expires_at > now,
        )
    )
    if (open_codes or 0) >= core.MAX_OPEN_CODES:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_codes",
            "You have {n} link codes open. Use one, or wait 10 minutes.",
            n=core.MAX_OPEN_CODES,
        )
    code = core.new_code()
    expires = now + core.CODE_TTL
    db.add(
        DeviceLinkCode(
            code_hash=core.code_hash(code),
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            expires_at=expires,
            created_at=now,
        )
    )
    await db.commit()
    base = core.public_base(request.headers, request.url.scheme)
    return {
        "code": code,
        "expires_at": expires,
        "server": base,
        "install": {
            "windows": f"irm {base}/i/{code}/win | iex",
            "mac": f"curl -fsSL {base}/i/{code}/mac | sh",
        },
        # The desktop app (Electron) only when a build is published (AGENTIC_PC_APP_*_URL);
        # otherwise the one-line installer is the way in.
        "downloads": (
            {"windows": settings.pc_app_windows_url, "mac": settings.pc_app_mac_url}
            if settings.pc_app_windows_url and settings.pc_app_mac_url
            else None
        ),
    }


@router.get("/api/devices/link-code/{code}/status")
async def link_code_status(
    code: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = await db.get(DeviceLinkCode, core.code_hash(code)) if core.valid_code(code) else None
    if row is None or row.user_id != principal.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "code_not_found", "That link code is not here.")
    claimed = row.used_at is not None
    return {
        "claimed": claimed,
        "device_id": row.device_id if claimed else None,
        "expired": not claimed and row.expires_at <= core.now(),
        "expires_at": row.expires_at,
    }


# ---------------------------------------------------------------- the install script


_BAD_CODE_LINES = [
    "That link code expired or was already used.",
    "Make a new one on the My computers page and copy the new line.",
    "Kod pautan itu sudah tamat tempoh atau sudah digunakan.",
    "Buat kod baharu di halaman Komputer saya dan salin baris yang baharu.",
]
_NO_INSTALLER_LINES = [
    "The installer is not available on this server yet. Use the desktop app instead.",
    "Pemasang belum tersedia pada pelayan ini. Gunakan aplikasi desktop.",
]


@router.get("/api/install/{code}/{kind}")
async def install_script(code: str, kind: str, request: Request) -> PlainTextResponse:
    """GET /i/{code}/win | /i/{code}/mac (nginx maps /i/ here). Does not use the code up.
    An unknown or expired code still answers a script (200) that prints why and stops:
    `curl -f` and `irm` would hide our message behind a bare 404."""
    if kind not in install.TEMPLATES:
        return PlainTextResponse("Use /i/CODE/win or /i/CODE/mac.\n", status_code=404)
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    ok = False
    if core.valid_code(code):
        async with SessionLocal() as db:
            row = await db.get(DeviceLinkCode, core.code_hash(code))
            ok = row is not None and row.used_at is None and row.expires_at > core.now()
    if not ok:
        return PlainTextResponse(
            install.error_script(kind, _BAD_CODE_LINES), headers={**headers, "X-Link-Code": "bad"}
        )
    base = core.public_base(request.headers, request.url.scheme)
    if not install.safe_server(base):
        base = settings.public_url.rstrip("/")
    text = install.script(kind, base, core.norm_code(code))
    if text is None:
        return PlainTextResponse(install.error_script(kind, _NO_INSTALLER_LINES), headers=headers)
    return PlainTextResponse(text, headers=headers)


# ---------------------------------------------------------------- claim (the PC)


class ClaimIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(default="", max_length=80)
    os: str = Field(default="", max_length=16)
    arch: str = Field(default="", max_length=16)
    version: str = Field(default="", max_length=40)


async def _claim_allowed(ip: str) -> bool:
    key = f"devices:claim:ip:{ip}"
    r = valkey()
    async with r.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, core.CLAIM_WINDOW, nx=True)
        n, _ = await pipe.execute()
    return int(n) <= core.CLAIMS_PER_IP


@router.post("/api/devices/claim")
async def claim(
    body: ClaimIn, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """No session: the code is the credential (single use, 10 minutes)."""
    ip = client_ip(request)
    if not await _claim_allowed(ip):
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_attempts",
            "Too many link attempts from this network. Wait 10 minutes and try again.",
        )
    bad = api_error(
        status.HTTP_400_BAD_REQUEST,
        "bad_code",
        "That link code expired or was already used. Make a new one on the My computers page.",
    )
    if not core.valid_code(body.code):
        raise bad
    now = core.now()
    row = await db.get(DeviceLinkCode, core.code_hash(body.code), with_for_update=True)
    if row is None or row.used_at is not None or row.expires_at <= now:
        raise bad
    user = await db.get(User, row.user_id)
    member = await db.get(Membership, (row.workspace_id, row.user_id))
    if user is None or not user.is_active or member is None:
        raise bad
    os_ = body.os if body.os in ("windows", "mac") else ""
    name = core.clip(body.name.strip(), 80).strip() or core.default_name(user.name, os_)
    token = core.new_token()
    d = Device(
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        name=name,
        os=os_,
        arch=core.clip(body.arch, 16),
        version=core.clip(body.version, 40),
        token_hash=core.hash_token(token),
        folders=[],
        paused=False,
        browsers=[],
        created_at=now,
    )
    db.add(d)
    await db.flush()
    row.used_at, row.device_id = now, d.id
    await core.log_activity(db, d, "link", {"name": name, "os": os_})
    await db.commit()
    await db.refresh(d)
    await core.publish(d, "device.updated", linked=True)
    return {"device_id": d.id, "token": token, "name": d.name}


# ---------------------------------------------------------------- the PC's connection


@router.websocket("/api/devices/connect")
async def device_socket(ws: WebSocket) -> None:
    await hub.serve(ws)


@router.websocket("/api/devices/cdp/{channel}")
async def device_cdp(ws: WebSocket, channel: str) -> None:
    await relay.serve_pc(ws, channel)


@router.websocket("/internal/devices/cdp/{channel}")
async def browser_cdp(ws: WebSocket, channel: str) -> None:
    await relay.serve_browser(ws, channel)


async def _device_of(request: Request) -> Device:
    async with SessionLocal() as db:
        d = await core.device_by_token(db, core.bearer(request.headers))
    if d is None or d.revoked_at is not None:
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "bad_token", "This computer is not linked. Link it again."
        )
    return d


@router.post(UPLOAD_PREFIX + "{call_id}")
async def device_upload(call_id: str, request: Request) -> dict[str, Any]:
    """The bytes for one files.upload call (Bearer device token, octet-stream, 25 MB)."""
    d = await _device_of(request)
    pending = await bridge.pending_upload(call_id)
    if pending is None or pending.get("device") != d.id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "no_upload", "No file was asked for with this link."
        )
    cap = max(1, min(core.MAX_UPLOAD, int(pending.get("max") or core.MAX_UPLOAD)))
    too_big = api_error(
        status.HTTP_413_CONTENT_TOO_LARGE,
        "too_big",
        "That file is too big (over {mb} MB).",
        mb=max(1, cap // (1024 * 1024)),
    )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > cap:
        raise too_big
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > cap:
            raise too_big
    name = core.clip(unquote(request.headers.get("x-file-name", "")), 200)
    await bridge.keep_upload(call_id, name, bytes(data))
    return {"ok": True, "size": len(data)}


@router.get("/api/devices/downloads/{one_time_id}")
async def device_download(one_time_id: str, request: Request) -> Response:
    """The bytes for one files.save call: this device only, single use, 5 minutes."""
    d = await _device_of(request)
    got = await bridge.take_download(one_time_id, d.id)
    if got is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "no_download", "That download link expired or was used."
        )
    name, data = got
    return Response(
        data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "X-File-Name": quote(name),
        },
    )


@router.post("/api/devices/self/unlink")
async def unlink_self(request: Request) -> dict[str, Any]:
    """`agentic-pc unlink` / `uninstall` on the PC: the token stops working at once."""
    d = await _device_of(request)
    async with SessionLocal() as db:
        row = await db.get(Device, d.id)
        if row is None:
            return {"ok": True}
        row.revoked_at = core.now()
        await core.log_activity(db, row, "unlink", {"by": "pc"})
        await db.commit()
        await db.refresh(row)
        db.expunge(row)
    await hub.disconnect(d.id, "revoked", "This computer was unlinked on the computer.")
    for cid, ch in list(relay.CHANNELS.items()):
        if ch.device_id == d.id:
            await relay.close(cid)
    await core.publish(row, "device.updated", revoked=True)
    return {"ok": True}


# ---------------------------------------------------------------- the person's computers


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    folders: list[str] | None = None
    paused: bool | None = None

    @field_validator("folders")
    @classmethod
    def _folders(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else core.clean_folders(v)


async def _own(db: AsyncSession, principal: Principal, device_id: str) -> Device:
    d = await db.get(Device, device_id)
    if (
        d is None
        or d.user_id != principal.user.id
        or d.workspace_id != principal.workspace_id
        or d.revoked_at is not None
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "device_not_found", "That computer is not here.")
    return d


@router.get("/api/devices")
async def list_devices(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = await core.live_devices(db, principal.workspace_id, principal.user.id)
    online = await core.online_ids(d.id for d in rows)
    return [core.device_out(d, d.id in online) for d in rows]


@router.patch("/api/devices/{device_id}")
async def update_device(
    device_id: str,
    body: DevicePatch,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _own(db, principal, device_id)
    if body.name is not None and body.name.strip():
        d.name = core.clip(body.name.strip(), 80)
    if body.folders is not None:
        d.folders = body.folders
    if body.paused is not None and body.paused != d.paused:
        d.paused = body.paused
        await core.log_activity(db, d, "pause" if d.paused else "resume", {"by": "web"})
    await db.commit()
    await db.refresh(d)
    await hub.push_settings(d)
    await core.publish(d, "device.updated")
    online = await core.online_ids([d.id])
    return core.device_out(d, d.id in online)


@router.delete("/api/devices/{device_id}")
async def unlink_device(
    device_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _own(db, principal, device_id)
    d.revoked_at = core.now()
    await core.log_activity(db, d, "unlink", {"by": "web"})
    await db.commit()
    await db.refresh(d)
    await hub.disconnect(d.id, "revoked", "This computer was unlinked on the web.")
    for cid, ch in list(relay.CHANNELS.items()):
        if ch.device_id == d.id:
            await relay.close(cid)
    await core.publish(d, "device.updated", revoked=True)
    return {"ok": True, "id": d.id}


@router.get("/api/devices/{device_id}/activity")
async def device_activity(
    device_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    d = await _own(db, principal, device_id)
    rows = (
        await db.execute(
            select(DeviceActivity, Agent.name)
            .outerjoin(Agent, Agent.id == DeviceActivity.agent_id)
            .where(DeviceActivity.device_id == d.id)
            .order_by(DeviceActivity.ts.desc(), DeviceActivity.id.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": a.id,
            "kind": a.kind,
            "detail": a.detail,
            "ok": a.ok,
            "ts": a.ts,
            "agent_id": a.agent_id,
            "agent_name": agent_name,
            "task_id": a.task_id,
        }
        for a, agent_name in rows
    ]


# ---------------------------------------------------------------- inside the stack


class CallIn(BaseModel):
    method: str = Field(max_length=40)
    params: dict[str, Any] = Field(default_factory=dict)
    timeout: float = Field(default=30, gt=0, le=600)
    call_id: str | None = Field(default=None, max_length=80)
    kind: str | None = Field(default=None, max_length=16)
    agent_id: str | None = Field(default=None, max_length=40)
    task_id: str | None = Field(default=None, max_length=40)


class BrowserIn(BaseModel):
    start_url: str | None = Field(default=None, max_length=2000)
    agent_id: str | None = Field(default=None, max_length=40)
    task_id: str | None = Field(default=None, max_length=40)


def _internal(request: Request) -> None:
    if not core.internal_ok(request.headers.get("x-internal-token")):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Not allowed.")


@router.post("/internal/devices/{device_id}/call")
async def internal_call(device_id: str, body: CallIn, request: Request) -> dict[str, Any]:
    """The worker's call to a PC whose socket is in this process."""
    _internal(request)
    if body.method not in core.METHODS:
        return {"ok": False, "error": {"code": "failed", "message": "Unknown method."}}
    try:
        data = await bridge.call_here(
            device_id,
            body.method,
            body.params,
            body.timeout,
            call_id=body.call_id or bridge.new_call_id(),
            kind=body.kind if body.kind in KINDS else None,
            agent_id=body.agent_id,
            task_id=body.task_id,
        )
    except DeviceError as e:
        return {"ok": False, "error": {"code": e.code, "message": e.message}}
    return {"ok": True, "data": data}


@router.post("/internal/devices/{device_id}/browser")
async def internal_browser(device_id: str, body: BrowserIn, request: Request) -> dict[str, Any]:
    """Start the PC's browser and its CDP relay; the browser service connects to ws_url."""
    _internal(request)
    try:
        channel, ws_url = await bridge.open_browser(
            device_id, body.start_url, agent_id=body.agent_id, task_id=body.task_id
        )
    except DeviceError as e:
        return {"ok": False, "error": {"code": e.code, "message": e.message}}
    return {"ok": True, "data": {"channel": channel, "ws_url": ws_url}}
