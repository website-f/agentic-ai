"""Company documents intake (P24): upload a ZIP, several files or one file into a company;
the office unpacks it (folders kept), reads, scans, sorts and reports.

POST /api/intake takes the raw bytes like POST /api/files (application/octet-stream, the
CSRF token still checked; see RAW_UPLOAD_PATHS in api/main.py). Several files at once: one
call per file with the same `batch`.
"""

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...core.db import get_db
from ...documents import service
from ...intake import pipeline, unpack
from ...models import Department, DocFile, IntakeBatch
from ...services import audit
from .. import paging
from ..deps import Principal, api_error, require
from .files import FileOut, check_branch, clean_folder, file_out

router = APIRouter(prefix="/api/intake", tags=["intake"])
log = logging.getLogger("agentic.api.intake")

UPLOAD_PATH = "/api/intake"


class IntakeBatchOut(BaseModel):
    id: str
    branch_id: str | None
    name: str
    status: str
    total: int
    done: int
    report: dict[str, Any]
    error: str | None
    created_at: datetime
    created_by: str


class IntakeBatchDetail(IntakeBatchOut):
    files: list[FileOut]


def batch_out(b: IntakeBatch) -> IntakeBatchOut:
    return IntakeBatchOut(
        id=b.id,
        branch_id=b.branch_id,
        name=b.name,
        status=b.status,
        total=b.total,
        done=b.done,
        report={**pipeline.empty_report(), **(b.report or {})},
        error=b.error,
        created_at=b.created_at,
        created_by=b.created_by,
    )


def _sees(principal: Principal) -> ColumnElement[bool] | None:
    """Batches a person sees: all for workspace roles; a branch manager their company's;
    everyone their own uploads."""
    sc = principal.scope
    if sc.everything:
        return None
    mine = IntakeBatch.created_by == principal.actor
    if sc.kind == "branch" and sc.branch_id:
        return or_(mine, IntakeBatch.branch_id == sc.branch_id)
    return mine


async def get_batch(db: AsyncSession, principal: Principal, batch_id: str) -> IntakeBatch:
    q = select(IntakeBatch).where(
        IntakeBatch.id == batch_id, IntakeBatch.workspace_id == principal.workspace_id
    )
    cond = _sees(principal)
    if cond is not None:
        q = q.where(cond)
    b = await db.scalar(q)
    if b is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "batch_not_found", "That upload is not here.")
    return b


async def start(batch_id: str) -> None:
    """Hand the batch to the worker; if Temporal is down, sort it here instead."""
    try:
        await dispatch.start_intake(batch_id)
    except Exception:  # noqa: BLE001 - sorting must not depend on the queue being up
        log.warning("worker unavailable; sorting batch %s inline", batch_id, exc_info=True)
        await pipeline.run_inline(batch_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    name: str = Query(min_length=1, max_length=500),  # a folder upload sends the relative path
    branch_id: str | None = None,
    department_id: str | None = None,
    batch: str | None = Query(default=None, max_length=40),
    folder: str | None = Query(default=None, max_length=300),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> IntakeBatchOut:
    sc = principal.scope
    existing = await get_batch(db, principal, batch) if batch else None
    if existing is not None:
        branch_id = existing.branch_id
    elif branch_id is None and not sc.everything:
        branch_id = sc.branch_id  # an office role files under its own company
    await check_branch(db, principal, branch_id)
    if not sc.everything and branch_id != sc.branch_id:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "out_of_scope", "You can add documents to your company only."
        )
    if department_id is not None:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != principal.workspace_id or d.branch_id != branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department of that company."
            )
    base = clean_folder(folder) if folder else ""
    data = bytearray()
    limit = unpack.MAX_ZIP_BYTES
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > limit:
            raise api_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "upload_too_large",
                "One upload can be up to {mb} MB. Split the zip into smaller ones.",
                mb=limit // (1024 * 1024),
            )
    if not data:
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    raw = bytes(data)
    is_zip = unpack.is_zip(raw, name)
    if not is_zip and len(raw) > service.MAX_FILE_BYTES:
        raise api_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "file_too_large",
            "Files can be up to {mb} MB.",
            mb=service.MAX_FILE_BYTES // (1024 * 1024),
        )
    b = existing
    if b is None:
        b = IntakeBatch(
            workspace_id=principal.workspace_id,
            branch_id=branch_id,
            name=(unpack.stem(name) if is_zip else name.strip())[:200],
            status="unpacking",
            total=0,
            done=0,
            report=pipeline.empty_report(),
            created_by=principal.actor,
        )
        db.add(b)
        await db.flush()
    try:
        added = await pipeline.add_upload(
            db,
            batch=b,
            name=name,
            data=raw,
            mime=request.headers.get("x-file-type", "")[:120],
            created_by=principal.actor,
            folder=base,
            department_id=department_id,
        )
    except unpack.UnpackError as e:
        await db.rollback()
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_zip", "That zip file cannot be opened."
        ) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "intake.uploaded",
        target=b.id,
        after={"name": name[:200], "files": added, "zip": is_zip, "branch_id": branch_id},
    )
    await db.commit()
    await pipeline.publish(b)
    await start(b.id)
    await db.refresh(b)
    return batch_out(b)


@router.get("")
async def list_batches(
    response: Response,
    branch_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[IntakeBatchOut]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count)."""
    q = select(IntakeBatch).where(IntakeBatch.workspace_id == principal.workspace_id)
    if branch_id:
        q = q.where(IntakeBatch.branch_id == branch_id)
    cond = _sees(principal)
    if cond is not None:
        q = q.where(cond)
    rows = await paging.paginate(
        db,
        q,
        ((IntakeBatch.created_at, True), (IntakeBatch.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return [batch_out(b) for b in rows]


@router.get("/{batch_id}")
async def read_batch(
    batch_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> IntakeBatchDetail:
    b = await get_batch(db, principal, batch_id)
    files = (
        await db.scalars(
            service.scoped(
                select(DocFile).where(
                    DocFile.workspace_id == principal.workspace_id, DocFile.batch_id == b.id
                ),
                DocFile,
                principal,
            ).order_by(DocFile.folder, DocFile.name, DocFile.id)
        )
    ).all()
    out = batch_out(b)
    return IntakeBatchDetail(**out.model_dump(), files=[await file_out(db, f) for f in files])
