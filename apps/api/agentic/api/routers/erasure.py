"""P57: Settings > Data and privacy (owner only): export all data, erase this workspace.

- GET    /api/workspace/data                      what there is, the latest export, an open erase
- POST   /api/workspace/data/exports              {password, code?} start an export
- GET    /api/workspace/data/exports/{id}         progress; a signed download link when ready
- GET    /api/workspace/data/exports/{id}/download?exp=&sig=   the ZIP, once
- DELETE /api/workspace/data/exports/{id}         throw the ZIP away
- POST   /api/workspace/data/erasure              {confirm_name, password, code?} request it
- DELETE /api/workspace/data/erasure/{id}         cancel (only before the erase starts)
- POST   /api/workspace/data/erasure/{id}/start   {confirm_name, password, code?} erase now

The erase signs everyone out, so its progress and the certificate are read with the access
token the start answered with (no session needed):
- GET /api/erasure/{id}?token=
- GET /api/erasure/{id}/certificate.pdf?token=   |   /certificate.json?token=
"""

import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from ...core.config import settings
from ...core.db import get_db
from ...core.security import new_token, token_hash, verify_password
from ...erasure import certificate, erase, export, inventory, jobs
from ...erasure.models import ErasureRecord, WorkspaceExport
from ...models import User, Workspace
from ...services import audit
from ..deps import Principal, api_error, current_principal

router = APIRouter(tags=["data and privacy"])

LINK_MINUTES = 15
OPEN = ("requested", "erasing", "failed")


def _owner(principal: Principal) -> None:
    if principal.role != "owner":
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "owner_only",
            "Only an owner can export or erase this workspace's data.",
        )


def _two_factor() -> Any:
    try:
        from ...services import two_factor
    except ImportError:  # pragma: no cover - before two-step sign-in existed
        return None
    return two_factor


class Confirm(BaseModel):
    password: str = Field(default="", max_length=200)
    code: str = Field(default="", max_length=40)


class ConfirmName(Confirm):
    confirm_name: str = Field(default="", max_length=200)


async def _check(db: AsyncSession, principal: Principal, body: Confirm) -> User:
    """The owner's password, and their authenticator code when they turned that on."""
    user = await db.scalar(select(User).where(User.id == principal.user.id).with_for_update())
    if user is None or not verify_password(user.password_hash, body.password):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "password_required", "Your password is not right."
        )
    tf = _two_factor()
    if tf is not None and tf.enabled(user):
        ok = bool(body.code) and (
            tf.check_code(user, body.code) or tf.use_recovery_code(user, body.code)
        )
        if not ok:
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "code_required",
                "Enter the code from your authenticator app.",
            )
    return user


def _check_name(ws: Workspace, typed: str) -> None:
    if typed.strip() != ws.name.strip():
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "name_mismatch",
            "Type the workspace's name exactly as shown to confirm.",
        )


def _sig(export_id: str, user_id: str, exp: int) -> str:
    msg = f"export:{export_id}:{user_id}:{exp}".encode()
    return hmac.new(settings.secret_key.encode(), msg, hashlib.sha256).hexdigest()


def _export_out(ex: WorkspaceExport | None, user_id: str) -> dict[str, Any] | None:
    if ex is None:
        return None
    out: dict[str, Any] = {
        "id": ex.id,
        "status": ex.status,
        "progress": ex.progress,
        "step": ex.step,
        "size": ex.size,
        "sha256": ex.sha256,
        "counts": ex.counts or {},
        "error": ex.error,
        "created_at": ex.created_at,
        "finished_at": ex.finished_at,
        "expires_at": ex.expires_at,
        "downloaded_at": ex.downloaded_at,
        "download_url": None,
    }
    if ex.status == "ready":
        exp = int(time.time()) + LINK_MINUTES * 60
        sig = _sig(ex.id, user_id, exp)
        out["download_url"] = f"/api/workspace/data/exports/{ex.id}/download?exp={exp}&sig={sig}"
    return out


def _erasure_out(r: ErasureRecord | None) -> dict[str, Any] | None:
    if r is None:
        return None
    return {
        "id": r.id,
        "status": r.status,
        "step": r.step,
        "progress": r.progress,
        "workspace_name": r.workspace_name,
        "requested_at": r.requested_at,
        "due_by": r.due_by,
        "started_at": r.started_at,
        "completed_at": r.completed_at,
        "certificate_sha256": r.certificate_sha256,
        "error": r.error,
    }


async def _expire(db: AsyncSession, ex: WorkspaceExport | None) -> None:
    if (
        ex is not None
        and ex.status == "ready"
        and ex.expires_at
        and ex.expires_at < datetime.now(UTC)
    ):
        export.discard(ex)
        ex.status = "expired"
        await db.commit()


async def _latest_export(db: AsyncSession, ws_id: str) -> WorkspaceExport | None:
    ex = await db.scalar(
        select(WorkspaceExport)
        .where(WorkspaceExport.workspace_id == ws_id)
        .order_by(WorkspaceExport.created_at.desc())
        .limit(1)
    )
    await _expire(db, ex)
    return ex


async def _open_erasure(db: AsyncSession, ws_id: str) -> ErasureRecord | None:
    return await db.scalar(
        select(ErasureRecord)
        .where(ErasureRecord.erased_workspace_id == ws_id, ErasureRecord.status.in_(OPEN))
        .order_by(ErasureRecord.requested_at.desc())
        .limit(1)
    )


@router.get("/api/workspace/data")
async def overview(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    _owner(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    counts = await inventory.counts(db, ws.id)
    only = await inventory.users_only_here(db, ws.id)
    tf = _two_factor()
    return {
        "workspace": {"id": ws.id, "name": ws.name},
        "export": _export_out(await _latest_export(db, ws.id), principal.user.id),
        "erasure": _erasure_out(await _open_erasure(db, ws.id)),
        "summary": inventory.categorize(counts),
        "members": {"total": counts.get("memberships", 0), "only_here": len(only)},
        "providers": await inventory.providers(db, ws.id),
        "due_days": erase.DUE_DAYS,
        "backup_days": erase.BACKUP_RETENTION_DAYS,
        "needs_code": bool(tf is not None and tf.enabled(principal.user)),
    }


# ---------------------------------------------------------------- export


@router.post("/api/workspace/data/exports", status_code=status.HTTP_201_CREATED)
async def start_export(
    body: Confirm,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _owner(principal)
    await _check(db, principal, body)
    busy = await db.scalar(
        select(WorkspaceExport.id).where(
            WorkspaceExport.workspace_id == principal.workspace_id,
            WorkspaceExport.status.in_(("queued", "running")),
        )
    )
    if busy:
        raise api_error(
            status.HTTP_409_CONFLICT, "export_running", "An export is already being made."
        )
    # One ZIP at a time: an older one not downloaded is thrown away.
    for old in (
        await db.scalars(
            select(WorkspaceExport).where(
                WorkspaceExport.workspace_id == principal.workspace_id,
                WorkspaceExport.status == "ready",
            )
        )
    ).all():
        export.discard(old)
        old.status = "expired"
    ex = WorkspaceExport(workspace_id=principal.workspace_id, requested_by=principal.user.id)
    db.add(ex)
    await db.flush()
    await audit.record(
        db, principal.workspace_id, principal.actor, "workspace.export", target=ex.id
    )
    await db.commit()
    await db.refresh(ex)
    try:
        await jobs.start_export(ex.id)
    except Exception as e:
        ex.status, ex.error = "failed", "The job engine could not be reached."
        await db.commit()
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "jobs_unavailable",
            "The background job engine is not reachable. Try again in a minute.",
        ) from e
    return _export_out(ex, principal.user.id) or {}


async def _own_export(db: AsyncSession, principal: Principal, export_id: str) -> WorkspaceExport:
    _owner(principal)
    ex = await db.get(WorkspaceExport, export_id)
    if ex is None or ex.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That export was not found.")
    return ex


@router.get("/api/workspace/data/exports/{export_id}")
async def get_export(
    export_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ex = await _own_export(db, principal, export_id)
    await _expire(db, ex)
    return _export_out(ex, principal.user.id) or {}


@router.get("/api/workspace/data/exports/{export_id}/download")
async def download_export(
    export_id: str,
    exp: int = Query(...),
    sig: str = Query(..., max_length=128),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    ex = await _own_export(db, principal, export_id)
    if exp < int(time.time()) or not hmac.compare_digest(sig, _sig(ex.id, principal.user.id, exp)):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "link_expired",
            "This download link has expired. Open Data and privacy again for a new one.",
        )
    await _expire(db, ex)
    path = export.file_of(ex)
    if ex.status != "ready" or path is None or not path.exists():
        raise api_error(
            status.HTTP_410_GONE,
            "export_gone",
            "This export was already downloaded or has expired. Make a new one.",
        )
    ex.status, ex.downloaded_at = "downloaded", datetime.now(UTC)
    await audit.record(
        db, principal.workspace_id, principal.actor, "workspace.export_downloaded", target=ex.id
    )
    await db.commit()
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    name = f"{export.safe_name(principal.workspace_id)}-export-{stamp}.zip"
    return FileResponse(
        path,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(lambda: path.unlink(missing_ok=True)),
    )


@router.delete("/api/workspace/data/exports/{export_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_export(
    export_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> Response:
    ex = await _own_export(db, principal, export_id)
    export.discard(ex)
    if ex.status in ("ready", "queued", "running"):
        ex.status = "expired"
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- erase


@router.post("/api/workspace/data/erasure", status_code=status.HTTP_201_CREATED)
async def request_erasure(
    body: ConfirmName,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _owner(principal)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    _check_name(ws, body.confirm_name)
    await _check(db, principal, body)
    if await _open_erasure(db, ws.id):
        raise api_error(
            status.HTTP_409_CONFLICT, "erasure_open", "An erase of this workspace is already open."
        )
    token = new_token()
    now = datetime.now(UTC)
    r = ErasureRecord(
        erased_workspace_id=ws.id,
        workspace_name=ws.name,
        requested_by=principal.user.id,
        status="requested",
        access_hash=token_hash(token),
        requested_at=now,
        due_by=now + timedelta(days=erase.DUE_DAYS),
    )
    db.add(r)
    await audit.record(db, ws.id, principal.actor, "workspace.erase_requested", target=r.id)
    await db.commit()
    await db.refresh(r)
    return {**(_erasure_out(r) or {}), "access_token": token}


async def _own_erasure(db: AsyncSession, principal: Principal, rid: str) -> ErasureRecord:
    _owner(principal)
    r = await db.get(ErasureRecord, rid)
    if r is None or r.erased_workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That erase request was not found.")
    return r


@router.delete("/api/workspace/data/erasure/{rid}")
async def cancel_erasure(
    rid: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    r = await _own_erasure(db, principal, rid)
    if r.status != "requested":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "erasure_started",
            "The erase has started and cannot be stopped.",
        )
    r.status, r.cancelled_at = "cancelled", datetime.now(UTC)
    await audit.record(
        db, principal.workspace_id, principal.actor, "workspace.erase_cancelled", target=r.id
    )
    await db.commit()
    return _erasure_out(r) or {}


@router.post("/api/workspace/data/erasure/{rid}/start")
async def start_erasure(
    rid: str,
    body: ConfirmName,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    r = await _own_erasure(db, principal, rid)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    _check_name(ws, body.confirm_name)
    await _check(db, principal, body)
    if r.status not in ("requested", "failed"):
        raise api_error(
            status.HTTP_409_CONFLICT, "erasure_not_open", "This erase request is not open."
        )
    token = new_token()
    was, was_started = r.status, r.started_at
    r.status, r.step, r.error = "erasing", r.step or "prepare", None
    r.started_at = r.started_at or datetime.now(UTC)
    r.access_hash = token_hash(token)
    await audit.record(db, ws.id, principal.actor, "workspace.erase_started", target=r.id)
    await db.commit()
    try:
        await jobs.start_erase(r.id)
    except Exception as e:
        r.status, r.started_at = was, was_started
        await db.commit()
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "jobs_unavailable",
            "The background job engine is not reachable. Try again in a minute.",
        ) from e
    return {**(_erasure_out(r) or {}), "access_token": token}


# ---------------------------------------------------------------- after the session is gone


async def _by_token(db: AsyncSession, rid: str, token: str) -> ErasureRecord:
    r = await db.get(ErasureRecord, rid)
    if r is None or not r.access_hash or not hmac.compare_digest(r.access_hash, token_hash(token)):
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That erase request was not found.")
    return r


@router.get("/api/erasure/{rid}")
async def erasure_status(
    rid: str, token: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return _erasure_out(await _by_token(db, rid, token)) or {}


class TokenIn(BaseModel):
    token: str = Field(max_length=200)


@router.post("/api/erasure/{rid}/retry")
async def retry_erasure(
    rid: str, body: TokenIn, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """An erase that failed part-way (after everyone was signed out) is finished from the
    progress page with the same access token: the steps already done are safe to repeat."""
    r = await _by_token(db, rid, body.token)
    if r.status != "failed":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "erasure_not_failed",
            "Only a failed erase can be tried again.",
        )
    r.status, r.error = "erasing", None
    await db.commit()
    try:
        await jobs.start_erase(r.id)
    except Exception as e:
        r.status = "failed"
        await db.commit()
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "jobs_unavailable",
            "The background job engine is not reachable. Try again in a minute.",
        ) from e
    return _erasure_out(r) or {}


@router.get("/api/erasure/{rid}/certificate.{fmt}")
async def erasure_certificate(
    rid: str,
    fmt: str,
    token: str = Query(..., max_length=200),
    db: AsyncSession = Depends(get_db),
) -> Response:
    r = await _by_token(db, rid, token)
    j, p = certificate.paths(r.id)
    path = {"json": j, "pdf": p}.get(fmt)
    if path is None or r.status != "done" or not path.exists():
        raise api_error(status.HTTP_404_NOT_FOUND, "not_ready", "The certificate is not ready yet.")
    return FileResponse(
        path,
        media_type="application/pdf" if fmt == "pdf" else "application/json",
        headers={
            "Content-Disposition": f"attachment; filename=certificate-of-deletion-{r.id}.{fmt}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
