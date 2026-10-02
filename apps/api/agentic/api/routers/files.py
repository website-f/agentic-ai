"""Files people give the office (P10): upload, list, read, download, move, delete.

Uploads are the request body as application/octet-stream (the CSRF guard allows that type on
this one path only: like JSON, a cross-site form cannot send it). The worker then reads each
file once — text, OCR for scans, a short summary — so agents never re-read the raw bytes.
"""

import logging
from datetime import date, datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ...agents import dispatch
from ...core.db import SessionLocal, get_db
from ...documents import service
from ...models import Branch, CompanyKit, DocFile, Task
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/files", tags=["files"])
log = logging.getLogger("agentic.api.files")

# Shown in the browser (previews); everything else downloads. Never HTML or SVG inline.
INLINE_SAFE = {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"}


class FileOut(BaseModel):
    id: str
    name: str
    mime: str
    size: int
    status: str
    pages: int
    ocr: bool
    kind: str
    title: str
    summary: str
    fields: dict[str, Any]
    expires_on: date | None
    expired: bool
    error: str | None
    source: str
    branch_id: str | None
    branch_name: str | None
    task_id: str | None
    agent_id: str | None
    created_by: str
    created_at: datetime
    text: str | None = None
    text_length: int | None = None


async def file_out(db: AsyncSession, f: DocFile, *, text: bool = False) -> FileOut:
    b = await db.get(Branch, f.branch_id) if f.branch_id else None
    body = None
    if text:
        body = await db.scalar(select(DocFile.text).where(DocFile.id == f.id)) or ""
    return FileOut(
        id=f.id,
        name=f.name,
        mime=f.mime,
        size=f.size,
        status=f.status,
        pages=f.pages,
        ocr=f.ocr,
        kind=f.kind,
        title=f.title,
        summary=f.summary,
        fields=f.fields or {},
        expires_on=f.expires_on,
        expired=bool(f.expires_on and f.expires_on < date.today()),
        error=f.error,
        source=f.source,
        branch_id=f.branch_id,
        branch_name=b.name if b else None,
        task_id=f.task_id,
        agent_id=f.agent_id,
        created_by=f.created_by,
        created_at=f.created_at,
        text=body[:60_000] if body is not None else None,
        text_length=len(body) if body is not None else None,
    )


async def get_file(db: AsyncSession, principal: Principal, file_id: str) -> DocFile:
    f = await db.scalar(
        service.scoped(
            select(DocFile).where(
                DocFile.id == file_id, DocFile.workspace_id == principal.workspace_id
            ),
            DocFile,
            principal,
        )
    )
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    return f


async def check_branch(db: AsyncSession, principal: Principal, branch_id: str | None) -> None:
    if branch_id is None:
        return
    b = await db.get(Branch, branch_id)
    if (
        b is None
        or b.workspace_id != principal.workspace_id
        or not service.branch_ok(principal, branch_id)
    ):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company you work in.")


async def check_task(db: AsyncSession, principal: Principal, task_id: str | None) -> Task | None:
    if task_id is None:
        return None
    from ...models import Agent

    t = await db.get(Task, task_id)
    agent = await db.get(Agent, t.assignee_agent_id) if t and t.assignee_agent_id else None
    if (
        t is None
        or t.workspace_id != principal.workspace_id
        or not principal.scope.sees_task(t, agent)
    ):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_task", "That task is not here.")
    return t


async def start_reading(file_id: str) -> None:
    """Hand the file to the worker; if Temporal is down, read it here instead."""
    try:
        await dispatch.start_file_extract(file_id)
    except Exception:  # noqa: BLE001 - reading must not depend on the queue being up
        log.warning("worker unavailable; reading %s inline", file_id, exc_info=True)
        async with SessionLocal() as db:
            await service.process_file(db, file_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    branch_id: str | None = None,
    task_id: str | None = None,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    await check_branch(db, principal, branch_id)
    task = await check_task(db, principal, task_id)
    if task is not None and branch_id is None:
        branch_id = task.branch_id
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > service.MAX_FILE_BYTES:
            raise api_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "file_too_large",
                f"Files can be up to {service.MAX_FILE_BYTES // (1024 * 1024)} MB.",
            )
    if not data:
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    mime = request.headers.get("x-file-type", "")[:120]
    f = await service.create_file(
        db,
        workspace_id=principal.workspace_id,
        name=name,
        data=bytes(data),
        created_by=principal.actor,
        mime=mime,
        branch_id=branch_id,
        task_id=task_id,
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.uploaded",
        target=f.id,
        after={"name": f.name, "size": f.size},
    )
    await db.commit()
    await db.refresh(f)
    await start_reading(f.id)
    await db.refresh(f)
    return await file_out(db, f)


@router.get("")
async def list_files(
    branch_id: str | None = None,
    task_id: str | None = None,
    q: str = Query(default="", max_length=120),
    source: str | None = Query(default=None, pattern="^(upload|generated)$"),
    limit: int = Query(default=200, ge=1, le=500),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[FileOut]:
    query = select(DocFile).where(DocFile.workspace_id == principal.workspace_id)
    if branch_id:
        query = query.where(DocFile.branch_id == branch_id)
    if task_id:
        query = query.where(DocFile.task_id == task_id)
    if source:
        query = query.where(DocFile.source == source)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(
            or_(DocFile.name.ilike(like), DocFile.title.ilike(like), DocFile.kind.ilike(like))
        )
    rows = (
        await db.scalars(
            service.scoped(query, DocFile, principal)
            .order_by(DocFile.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [await file_out(db, f) for f in rows]


@router.get("/{file_id}")
async def read_file(
    file_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    return await file_out(db, await get_file(db, principal, file_id), text=True)


@router.get("/{file_id}/download")
async def download(
    file_id: str,
    inline: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    f = await get_file(db, principal, file_id)
    data = await db.scalar(select(DocFile.data).where(DocFile.id == f.id))
    show = inline and f.mime in INLINE_SAFE
    mime = f.mime if show else (f.mime if f.mime in INLINE_SAFE else "application/octet-stream")
    disposition = "inline" if show else "attachment"
    return Response(
        content=bytes(data or b""),
        media_type=mime,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(f.name)}",
            # A served file can never run script against this origin.
            "Content-Security-Policy": (
                "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
            ),
        },
    )


class FileUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    branch_id: str | None = None
    task_id: str | None = None
    clear_task: bool = False


@router.patch("/{file_id}")
async def update_file(
    file_id: str,
    body: FileUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    f = await get_file(db, principal, file_id)
    if body.name:
        f.name = body.name.strip()
    if "branch_id" in body.model_fields_set:
        await check_branch(db, principal, body.branch_id)
        f.branch_id = body.branch_id
    if body.task_id:
        await check_task(db, principal, body.task_id)
        f.task_id = body.task_id
    elif body.clear_task:
        f.task_id = None
    await db.commit()
    await db.refresh(f)
    return await file_out(db, f)


@router.post("/{file_id}/reread")
async def reread(
    file_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    f = await get_file(db, principal, file_id)
    if f.source != "upload":
        raise api_error(status.HTTP_400_BAD_REQUEST, "not_upload", "Only uploads are re-read.")
    f.status, f.error = "reading", None
    await db.commit()
    await start_reading(f.id)
    await db.refresh(f)
    return await file_out(db, f)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    f = await get_file(db, principal, file_id)
    for kit in (await db.scalars(select(CompanyKit).where(CompanyKit.logo_file_id == f.id))).all():
        kit.logo_file_id = None
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.deleted",
        target=f.id,
        before={"name": f.name},
    )
    await db.delete(f)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def load_bytes(db: AsyncSession, file_id: str) -> bytes:
    f = await db.scalar(select(DocFile).where(DocFile.id == file_id).options(undefer(DocFile.data)))
    return bytes(f.data) if f else b""
