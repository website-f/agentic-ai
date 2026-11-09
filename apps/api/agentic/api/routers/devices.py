"""P31: a person's own computers (docs/PC-AGENT.md).

For the person (session): link codes, their computers, folders, pause, unlink, activity.
For the PC (no session; the code, then its bearer token): the install script, claim, the
connection socket, file uploads and downloads, the CDP relay socket.
Inside the stack (X-Internal-Token / X-Browser-Token): calls from the worker, the browser
service's side of the CDP relay. Nginx never proxies /internal/.

Personal like a private assistant: only the device's own person sees or changes it (404 for
anyone else, admins included).
"""

import hashlib
from typing import Any
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, WebSocket, status
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...assistants.access import may_assist
from ...core.config import settings
from ...core.db import SessionLocal, get_db
from ...core.security import can
from ...core.valkey import valkey
from ...devices import backup, bridge, core, hub, install, relay
from ...devices.core import DeviceError
from ...i18n.labels import role_label
from ...models import (
    Agent,
    Branch,
    Device,
    DeviceActivity,
    DeviceLinkCode,
    Membership,
    StorageTarget,
    User,
    Workspace,
)
from ...services import audit
from ..deps import Principal, api_error, client_ip, current_principal

router = APIRouter(tags=["devices"])

# P94: the API app (api/main.py) marks itself as the process holding the PC sockets. Not here:
# importing this module from the worker (P92 tunnel.py did) made the worker think it held
# them, so every PC call from an agent failed as "offline".

UPLOAD_PREFIX = "/api/devices/uploads/"
KINDS = frozenset(
    {"search", "list", "read", "upload", "save", "browser_open", "browser_close", "info"}
)


# ---------------------------------------------------------------- linking (the person)


async def _may_link(db: AsyncSession, principal: Principal) -> bool:
    """Whoever may have a personal AI: their AI twin, or personal assistants by role. P92:
    and anyone who gives work (work.write): their ePerolehan tasks run on their own PC, so the
    computer belongs to the person directly, with no AI of their own needed first. Only a
    personal AI ever gets the folder and screen tools (devices.core.personal), so linking
    without one gives no AI any new reach into the computer's files."""
    if may_assist(principal.role) or can(principal.role, "work.write"):
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
            "Your role does not give work to the AI, so it has no computer to link. Ask the "
            "owner if you need one.",
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
            "linux": f"curl -fsSL {base}/i/{code}/linux | sh",
        },
        # P42: the same lines that also allow seeing and using the computer from the web.
        "install_control": {
            "windows": f"irm {base}/i/{code}/win/control | iex",
            "mac": f"curl -fsSL {base}/i/{code}/mac/control | sh",
            "linux": f"curl -fsSL {base}/i/{code}/linux/control | sh",
        },
        # P52: the Windows program with this code inside (double-click: installs, links, starts
        # with Windows). None when this server has no build of it.
        "exe": (
            # Under /api/: the web app's offline worker never answers those with an app page.
            {
                "off": f"{base}/api/install/{code}/exe",
                "control": f"{base}/api/install/{code}/exe/control",
            }
            if install.exe_path() is not None
            else None
        ),
        # The desktop app (Electron) only when a build is published (AGENTIC_PC_APP_*_URL);
        # otherwise the one-line installer is the way in.
        "downloads": (
            {"windows": settings.pc_app_windows_url, "mac": settings.pc_app_mac_url}
            if settings.pc_app_windows_url and settings.pc_app_mac_url
            else None
        ),
    }


class AskIn(BaseModel):
    site: str = Field(default="", max_length=120)


@router.get("/api/devices/my-pc-status")
async def my_pc_status(
    site: str = Query(default="", max_length=120),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """P92: before ePerolehan work starts: is the person's OWN computer ready for `site`
    (ready | offline | not_allowed | not_linked | needs_update | paused), which one, when it
    was last seen, and the next step in plain words. An online PC that has not allowed the
    site is sent the Allow request by itself (at most once a minute)."""
    from ...devices import tunnel

    return await tunnel.pc_status(
        db, principal.workspace_id, principal.user.id, site, by=principal.user.name
    )


@router.post("/api/devices/my-pc-status/ask")
async def ask_my_pc(
    body: AskIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """P92 "Send the request again": the Allow request to the person's own online PC now."""
    from ...devices import tunnel

    site = (core.tunnel_hosts([body.site]) or tunnel.PC_ONLY)[0]
    ws = await db.get(Workspace, principal.workspace_id)
    m = tunnel.mode_of(ws)
    if not (tunnel.pc_only(site) or (m.mode == "pc" and m.covers(site))):
        return {"asked": False, "online": False}  # only sites that go through a computer
    sites = tunnel.ask_sites([site], m)
    rows = await core.live_devices(db, principal.workspace_id, principal.user.id)
    online = await core.online_ids(d.id for d in rows)
    live = [d for d in rows if d.id in online and not d.paused]
    if not live:
        await tunnel.remember_want(principal.user.id, sites)  # asked when it connects
        return {"asked": False, "online": False}
    d = live[0]
    asked = await tunnel.ask_own(d, sites, principal.user.name, force=True)
    return {"asked": asked, "online": True, "device": {"id": d.id, "name": d.name}}


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


@router.get("/api/install/{code}/{kind}/{remote}")
async def install_script_remote(code: str, kind: str, remote: str, request: Request) -> Response:
    """P42: the same, with seeing and using the computer from the web allowed at once
    (/i/{code}/win/control): the person chose it when making the code, and running the line
    on the computer is their consent there."""
    if remote not in core.REMOTE_LEVELS:
        return PlainTextResponse("Use /i/CODE/win/view or /i/CODE/win/control.\n", 404)
    return await install_script(code, kind, request, remote)


@router.get("/api/install/{code}/{kind}")
async def install_script(code: str, kind: str, request: Request, remote: str = "off") -> Response:
    """GET /i/{code}/win | /i/{code}/mac (nginx maps /i/ here). Does not use the code up.
    An unknown or expired code still answers a script (200) that prints why and stops:
    `curl -f` and `irm` would hide our message behind a bare 404."""
    if kind == "exe":
        return await _exe_download(code, request, remote)
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
    text = install.script(kind, base, core.norm_code(code), remote)
    if text is None:
        return PlainTextResponse(install.error_script(kind, _NO_INSTALLER_LINES), headers=headers)
    return PlainTextResponse(text, headers=headers)


async def _exe_download(code: str, request: Request, remote: str) -> Response:
    """P52: GET /i/{code}/exe: the Windows program, with this one-time code (and the office
    address) added to its end, so a double-click installs, links and starts it. An expired or
    unknown code still gets the program: it then asks for a code on its own page."""
    path = install.exe_path()
    if path is None:
        return PlainTextResponse("\n".join(_NO_INSTALLER_LINES) + "\n", status_code=404)
    trailer = b""
    if core.valid_code(code):
        async with SessionLocal() as db:
            row = await db.get(DeviceLinkCode, core.code_hash(code))
        if row is not None and row.used_at is None and row.expires_at > core.now():
            base = core.public_base(request.headers, request.url.scheme)
            if not install.safe_server(base):
                base = settings.public_url.rstrip("/")
            level = remote if remote in core.REMOTE_LEVELS else "off"
            trailer = install.exe_trailer(base, core.norm_code(code), level)
    size = path.stat().st_size
    total = size + len(trailer)
    # P52: byte ranges, so a download cut short (a proxy, a flaky line) resumes where it
    # stopped. The ETag covers the program and its link: a different link is a new file.
    stamp = f"{path.stat().st_mtime_ns}:{size}".encode()
    etag = '"' + hashlib.sha256(stamp + trailer).hexdigest()[:32] + '"'
    start, end = 0, total - 1
    rng = request.headers.get("range", "")
    if_range = request.headers.get("if-range")
    partial = False
    if rng.startswith("bytes=") and (if_range is None or if_range == etag):
        first = rng[6:].split(",")[0].strip()
        a, _, b = first.partition("-")
        try:
            if a:
                start, end = int(a), (int(b) if b else total - 1)
            elif b:
                start, end = max(0, total - int(b)), total - 1
            partial = True
        except ValueError:
            partial = False
        if partial and (start > end or start >= total):
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        end = min(end, total - 1)

    def chunks():
        pos = start
        with path.open("rb") as f:
            f.seek(min(pos, size))
            while pos <= end and pos < size:
                block = f.read(min(1 << 20, size - pos, end - pos + 1))
                if not block:
                    break
                pos += len(block)
                yield block
        if pos <= end:
            yield trailer[pos - size : end - size + 1]

    headers = {
        "Content-Disposition": f'attachment; filename="{install.EXE_NAME}"',
        "Content-Length": str(end - start + 1),
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(
        chunks(),
        status_code=206 if partial else 200,
        media_type="application/vnd.microsoft.portable-executable",
        headers=headers,
    )


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


@router.get("/api/devices/{device_id}")
async def get_device(
    device_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One computer: the caller's own, or (P53) a company computer of someone they manage."""
    d = await _managed_device(db, principal, device_id)
    online = await core.online_ids([d.id])
    return core.device_out(d, d.id in online)


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
    d = await _managed_device(db, principal, device_id)
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


# ------------------------------------------------- the owner's view of company computers (P53)


def _manages_computers(principal: Principal) -> bool:
    return can(principal.role, "members.manage") or can(principal.role, "team.manage")


async def _managed_device(db: AsyncSession, principal: Principal, device_id: str) -> Device:
    """A computer the caller may reach from the web: their own, or — for a manager — a company
    computer of someone they manage (owner/admin: all; a branch/department manager: their
    own branch/department). Company-owned machines, so a manager can see and fetch from them;
    the two remote locks and the on-screen notice on the computer still apply."""
    d = await db.get(Device, device_id)
    if (
        d is None
        or d.workspace_id != principal.workspace_id
        or d.revoked_at is not None
        or (d.user_id != principal.user.id and not _can_see_device(principal, None))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "device_not_found", "That computer is not here.")
    if d.user_id == principal.user.id:
        return d
    m = await db.get(Membership, (principal.workspace_id, d.user_id))
    if not _can_see_device(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "device_not_found", "That computer is not here.")
    return d


def _can_see_device(principal: Principal, m: Membership | None) -> bool:
    """Whether a manager's scope covers the person who owns a computer (m None is a pre-check)."""
    if not _manages_computers(principal):
        return False
    sc = principal.scope
    if sc.everything:
        return True
    if m is None:  # the id-only pre-check: a scoped manager may still reach some device
        return True
    if sc.kind == "branch":
        return m.branch_id == sc.branch_id
    if sc.kind == "department":
        return m.department_id == sc.department_id
    return False


@router.get("/api/org/computers")
async def org_computers(
    q: str = Query(default="", max_length=120),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Every linked company computer the manager may oversee, with who linked it and where,
    for the Staff computers page. Owner/admin: all; a branch or department manager: their own."""
    if not _manages_computers(principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Your role ({role}) cannot oversee staff computers.",
            role=role_label(principal.role),
        )
    sc = principal.scope
    query = (
        select(Device, User.name, User.email, Membership.branch_id, Membership.role)
        .join(User, User.id == Device.user_id)
        .join(
            Membership,
            (Membership.user_id == Device.user_id)
            & (Membership.workspace_id == Device.workspace_id),
        )
        .where(Device.workspace_id == principal.workspace_id, Device.revoked_at.is_(None))
    )
    if not sc.everything:
        query = query.where(Membership.branch_id == sc.branch_id)
        if sc.kind == "department":
            query = query.where(Membership.department_id == sc.department_id)
    rows = (await db.execute(query.order_by(User.name, Device.created_at.desc()))).all()
    online = await core.online_ids(d.id for d, *_ in rows)
    branches = {
        b.id: b.name
        for b in (
            await db.scalars(select(Branch).where(Branch.workspace_id == principal.workspace_id))
        ).all()
    }
    needle = q.strip().lower()
    out = []
    for d, name, email, branch_id, role in rows:
        company = branches.get(branch_id or "", "")
        if needle and needle not in f"{name} {email} {d.name} {d.hostname} {company}".lower():
            continue
        out.append(
            {
                **core.device_out(d, d.id in online),
                "person": {"id": d.user_id, "name": name, "email": email, "role": role},
                "company": company,
                "branch_id": branch_id,
            }
        )
    return {"computers": out, "can_backup": can(principal.role, "org.manage")}


class BackupIn(BaseModel):
    enabled: bool
    target_id: str = Field(default="", max_length=40)
    every_hours: int = Field(default=backup.EVERY_HOURS_DEFAULT, ge=1, le=168)


@router.get("/api/org/computers/backup")
async def get_backup(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    if not can(principal.role, "org.manage"):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Only the owner sets up backup.")
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    pol = backup.policy(ws)
    targets = (
        await db.scalars(
            select(StorageTarget).where(StorageTarget.workspace_id == principal.workspace_id)
        )
    ).all()
    return {
        "enabled": pol.enabled,
        "target_id": pol.target_id,
        "every_hours": pol.every_hours,
        "targets": [{"id": t.id, "name": t.name, "kind": t.kind} for t in targets],
    }


@router.put("/api/org/computers/backup")
async def set_backup(
    body: BackupIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not can(principal.role, "org.manage"):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Only the owner sets up backup.")
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    if body.enabled:
        t = await db.get(StorageTarget, body.target_id) if body.target_id else None
        if t is None or t.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "no_target",
                "Choose where to keep the backup first (Settings > Storage).",
            )
    before = backup.policy(ws).__dict__
    backup.save_policy(ws, backup.Policy(body.enabled, body.target_id, body.every_hours))
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "devices.backup",
        target=principal.workspace_id,
        before=before,
        after={"enabled": body.enabled, "target_id": body.target_id},
    )
    await db.commit()
    return await get_backup(principal, db)


# ---------------------------------------------------------------- P58 a site through a computer


class TunnelIn(BaseModel):
    on: bool
    device_id: str = Field(default="", max_length=40)
    hosts: list[str] = Field(default_factory=list, max_length=10)
    fallback: str = Field(default="wait", pattern="^(wait|direct|proxy)$")
    show: bool = True  # P59: on that computer's screen


@router.get("/api/org/computers/tunnel")
async def get_tunnel(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Which company computer ePerolehan (or other chosen sites) leaves through, and the
    computers that could: each with the sites its own person lets through it."""
    from ...devices import tunnel

    if not can(principal.role, "org.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only the owner chooses this computer."
        )
    ws = await db.get(Workspace, principal.workspace_id)
    rows = (
        await db.scalars(
            select(Device).where(
                Device.workspace_id == principal.workspace_id, Device.revoked_at.is_(None)
            )
        )
    ).all()
    online = await core.online_ids(d.id for d in rows)
    return {
        **tunnel.describe(ws),
        "computers": [
            {
                "id": d.id,
                "name": d.name,
                "online": d.id in online,
                "paused": d.paused,
                "allows": list(d.tunnel_hosts or []),
                "version": d.version,
            }
            for d in rows
        ],
    }


@router.put("/api/org/computers/tunnel")
async def set_tunnel(
    body: TunnelIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    from ...devices import tunnel

    if not can(principal.role, "org.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only the owner chooses this computer."
        )
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    hosts = core.tunnel_hosts(body.hosts) or list(tunnel.DEFAULT_HOSTS)
    if body.on:
        d = await db.get(Device, body.device_id) if body.device_id else None
        if d is None or d.workspace_id != principal.workspace_id or d.revoked_at is not None:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "no_computer",
                "Choose one of the company's linked computers.",
            )
    before = tunnel.describe(ws)
    after = {
        "on": body.on,
        "device_id": body.device_id,
        "hosts": hosts,
        "fallback": body.fallback,
        "show": body.show,
    }
    ws.settings = {**(ws.settings or {}), tunnel.SETTINGS_KEY: after}
    # P62: the one choice follows (the computer on; off ends it only if it was the computer).
    if body.on:
        tunnel.save_mode(ws, "pc", hosts)
    elif tunnel.mode_of(ws).mode == "pc":
        tunnel.save_mode(ws, "server", hosts)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "devices.tunnel",
        target=principal.workspace_id,
        before=before,
        after=after,
    )
    await db.commit()
    return await get_tunnel(principal, db)


# ---------------------------------------------------------------- P60 the company's proxies


class ProxiesIn(BaseModel):
    on: bool
    sites: list[str] = Field(default_factory=lambda: ["*"], max_length=10)
    # The pasted list (host:port:user:password per line, or proxy URLs). None keeps the saved
    # one; it is never sent back.
    list: str | None = Field(default=None, max_length=20_000)


def _owner_only(principal: Principal) -> None:
    if not can(principal.role, "org.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only the owner sets the web connections."
        )


@router.get("/api/org/proxies")
async def get_proxies(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    from ...devices import proxies

    _owner_only(principal)
    return proxies.public(await db.get(Workspace, principal.workspace_id))


@router.put("/api/org/proxies")
async def set_proxies(
    body: ProxiesIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Takes effect at once: the gateway reads the setting for every new connection."""
    from ...devices import proxies

    _owner_only(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    parsed = None
    if body.list is not None:
        try:
            parsed = proxies.parse(body.list)
        except proxies.ProxyListError as e:
            raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_proxy_list", str(e)) from e
    if body.on and not (parsed if parsed is not None else proxies.setting(ws).proxies):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "no_proxies", "Paste at least one proxy first."
        )
    before = proxies.public(ws)
    proxies.save(ws, body.on, body.sites, parsed)
    after = proxies.public(ws)
    from ...devices import tunnel

    if body.on:  # P62: the one choice follows
        tunnel.save_mode(ws, "proxy", body.sites)
    elif tunnel.mode_of(ws).mode == "proxy":
        tunnel.save_mode(ws, "server", [])
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "web.proxies",
        target=principal.workspace_id,
        before={"on": before["on"], "sites": before["sites"], "count": len(before["proxies"])},
        after={"on": after["on"], "sites": after["sites"], "count": len(after["proxies"])},
    )
    await db.commit()
    return after


@router.post("/api/org/proxies/test")
async def test_proxies(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Each saved proxy: does it answer, the address the sites see, how long it took."""
    import asyncio

    from ...devices import proxies

    _owner_only(principal)
    st = proxies.setting(await db.get(Workspace, principal.workspace_id))
    gate = asyncio.Semaphore(10)

    async def one(p: proxies.Proxy) -> dict[str, Any]:
        async with gate:
            return await proxies.test(p)

    return {"results": await asyncio.gather(*(one(p) for p in st.proxies))}


# ---------------------------------------------------------------- P62 how the AI browses


# P94: kept in devices/core.py so the worker can use them without importing this router.
ASK_VERSION = core.ASK_VERSION
_version = core.version_tuple


class WebIn(BaseModel):
    mode: str = Field(pattern="^(server|pc|proxy)$")
    sites: list[str] = Field(default_factory=list, max_length=10)
    device_id: str = Field(default="", max_length=40)
    show: bool = True  # P59: on that computer's screen
    # A new proxy list (host:port:user:password per line, or proxy URLs). None keeps the saved
    # one; it is never sent back.
    proxy_list: str | None = Field(default=None, max_length=20_000)


class SiteIn(BaseModel):
    site: str = Field(default="", max_length=120)


class CheckIn(SiteIn):
    """P84: the choice on the screen, saved or not, so Check tries the way being chosen."""

    mode: str | None = Field(default=None, pattern="^(server|pc|proxy)$")
    sites: list[str] | None = Field(default=None, max_length=50)
    device_id: str | None = Field(default=None, max_length=40)
    show: bool | None = None


async def _web(db: AsyncSession, workspace_id: str) -> dict[str, Any]:
    from ...devices import proxies, tunnel
    from ...engine import compliance

    ws = await db.get(Workspace, workspace_id)
    m, st = tunnel.mode_of(ws), tunnel.setting(ws)
    rows = (
        await db.scalars(
            select(Device)
            .where(Device.workspace_id == workspace_id, Device.revoked_at.is_(None))
            .order_by(Device.created_at)
        )
    ).all()
    online = await core.online_ids(d.id for d in rows)
    return {
        "mode": m.mode,
        "sites": m.sites,
        "device_id": st.device_id,
        "show": st.show,
        "computers": [
            {
                "id": d.id,
                "name": d.name,
                "online": d.id in online,
                "paused": d.paused,
                "allows": list(d.tunnel_hosts or []),
                "version": d.version,
                "can_ask": _version(d.version) >= ASK_VERSION,
            }
            for d in rows
        ],
        "proxies": proxies.public(ws)["proxies"],
        "proxies_approved": compliance.state(ws).allows("proxy"),
    }


@router.get("/api/org/web")
async def get_web(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """How the AI's browsers reach websites: this server, a company computer or the company's
    proxies, for which sites; the computers that could carry them; the saved proxies."""
    _owner_only(principal)
    return await _web(db, principal.workspace_id)


@router.put("/api/org/web")
async def set_web(
    body: WebIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Takes effect for the next connection. With a computer chosen that has not allowed the
    sites yet, its person is asked on that computer (Allow / Not now)."""
    from ...devices import proxies, tunnel

    _owner_only(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    parsed = None
    if body.proxy_list is not None and body.proxy_list.strip():
        try:
            parsed = proxies.parse(body.proxy_list)
        except proxies.ProxyListError as e:
            raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_proxy_list", str(e)) from e
    if body.mode == "proxy" and "*" not in body.sites:
        sites = core.tunnel_hosts(body.sites)
    else:
        sites = body.sites
    if body.mode == "pc" and "*" in body.sites:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "pc_sites",
            "A computer carries only the sites you list, such as eperolehan.gov.my.",
        )
    d = None
    if body.mode == "pc":
        d = await db.get(Device, body.device_id) if body.device_id else None
        if d is None or d.workspace_id != principal.workspace_id or d.revoked_at is not None:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "no_computer",
                "Choose one of the company's linked computers.",
            )
    if body.mode == "proxy" and not (parsed or proxies.setting(ws).proxies):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "no_proxies", "Paste at least one proxy first."
        )
    before = {**tunnel.describe(ws), "mode": tunnel.mode_of(ws).mode}
    m = tunnel.save_mode(ws, body.mode, sites)
    pc = dict((ws.settings or {}).get(tunnel.SETTINGS_KEY) or {})
    pc.update(
        on=m.mode == "pc",
        device_id=body.device_id or pc.get("device_id", ""),
        hosts=m.sites if m.mode == "pc" else pc.get("hosts") or list(tunnel.DEFAULT_HOSTS),
        fallback="wait",
        show=body.show,
    )
    ws.settings = {**(ws.settings or {}), tunnel.SETTINGS_KEY: pc}
    px = proxies.setting(ws)
    proxies.save(ws, m.mode == "proxy", m.sites if m.mode == "proxy" else px.sites, parsed)
    after = {"mode": m.mode, "sites": m.sites, "device_id": pc["device_id"], "show": body.show}
    if parsed is not None:
        after["proxies"] = len(parsed)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "web.route",
        target=principal.workspace_id,
        before=before,
        after=after,
    )
    await db.commit()
    asked = False
    if d is not None and not all(core.host_in(s, d.tunnel_hosts or []) for s in m.sites):
        asked = await hub.ask_tunnel(d.id, m.sites, principal.user.name)
    return {**await _web(db, principal.workspace_id), "asked": asked}


@router.post("/api/org/web/ask")
async def ask_web(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Ask the chosen computer's person again (its page opens there with Allow / Not now)."""
    from ...devices import tunnel

    _owner_only(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    m, st = tunnel.mode_of(ws), tunnel.setting(ws)
    if m.mode != "pc" or not st.device_id:
        raise api_error(
            status.HTTP_409_CONFLICT, "not_pc", "Choose Browse through a computer first."
        )
    return {"asked": await hub.ask_tunnel(st.device_id, m.sites, principal.user.name)}


@router.post("/api/org/web/check")
async def check_web(
    body: CheckIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Open a site once the way the agents' browsers would: the way it went, the site's
    answer, and the address the site saw when its page shows it."""
    from ...devices import tunnel

    _owner_only(principal)
    site = (core.tunnel_hosts([body.site]) or [""])[0]
    if not site:
        m = tunnel.mode_of(await db.get(Workspace, principal.workspace_id))
        site = next((s for s in m.sites if s != "*"), tunnel.DEFAULT_HOSTS[0])
    try:
        first = await valkey().set(f"web:check:{principal.workspace_id}", "1", ex=8, nx=True)
    except Exception:  # noqa: BLE001 - no cache: no limit
        first = True
    if not first:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "slow_down",
            "One check at a time. Try again shortly.",
        )
    choice = None
    if body.mode:
        if body.device_id:  # only this office's own linked computers
            d = await db.get(Device, body.device_id)
            if d is None or d.workspace_id != principal.workspace_id or d.revoked_at is not None:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "no_computer",
                    "Choose one of the company's linked computers.",
                )
        choice = {
            "mode": body.mode,
            "sites": body.sites or [],
            "device_id": body.device_id or "",
            "show": body.show is not False,
        }
    return await tunnel.check(principal.workspace_id, site, choice)


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
    sites: list[str] | None = Field(default=None, max_length=10)  # P59: a company computer


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


class InternalAskIn(BaseModel):
    hosts: list[str] = Field(default_factory=list, max_length=10)
    by: str = Field(default="", max_length=80)
    own: bool = False


@router.post("/internal/devices/{device_id}/ask")
async def internal_ask(device_id: str, body: InternalAskIn, request: Request) -> dict[str, Any]:
    """P92: the worker asks a person's PC to allow sites (its socket is in this process)."""
    _internal(request)
    hosts = core.tunnel_hosts(body.hosts)
    asked = bool(hosts) and await hub.ask_tunnel(device_id, hosts, body.by, own=body.own)
    return {"ok": True, "data": {"asked": asked}}


@router.post("/internal/devices/{device_id}/browser")
async def internal_browser(device_id: str, body: BrowserIn, request: Request) -> dict[str, Any]:
    """Start the PC's browser and its CDP relay; the browser service connects to ws_url."""
    _internal(request)
    try:
        channel, ws_url = await bridge.open_browser(
            device_id,
            body.start_url,
            agent_id=body.agent_id,
            task_id=body.task_id,
            sites=core.tunnel_hosts(body.sites) or None,
        )
    except DeviceError as e:
        return {"ok": False, "error": {"code": e.code, "message": e.message}}
    return {"ok": True, "data": {"channel": channel, "ws_url": ws_url}}
