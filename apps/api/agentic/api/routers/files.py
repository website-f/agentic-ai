"""Files people give the office (P10): upload, list, read, download, move, delete.

Uploads are the request body as application/octet-stream (the CSRF guard allows that type on
this one path only: like JSON, a cross-site form cannot send it). The worker then reads each
file once — text, OCR for scans, a short summary — so agents never re-read the raw bytes.
"""

import logging
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ...agents import dispatch
from ...core.db import SessionLocal, get_db
from ...core.security import can
from ...documents import service
from ...models import Agent, Branch, CompanyKit, DocFile, Document, Task, WorkflowRun
from ...services import audit
from .. import paging
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
    # P18 knowledge library: agents search and cite it; scoped to branch_id + department_id.
    library: bool = False
    department_id: str | None = None
    indexed_at: datetime | None = None
    # P24 company documents: where it sits, the upload it came from, what the scan found.
    folder: str = ""
    source_path: str = ""
    batch_id: str | None = None
    sensitive: dict[str, Any] = Field(default_factory=dict)
    quarantined: bool = False
    # P25 provenance: uploaded | person | agent, the agent, task and workflow run it came
    # from, the document or report it is the saved copy of, and that document's review.
    origin: str = "uploaded"
    agent_name: str | None = None
    agent_color: str | None = None
    task_title: str | None = None
    workflow_run_id: str | None = None
    workflow_run_title: str | None = None
    document_id: str | None = None
    report_id: str | None = None
    review_status: str | None = None


def may_manage(principal: Principal) -> bool:
    """P24: who may release held-back files and open them (as with the vault and org)."""
    return can(principal.role, "org.manage") or can(principal.role, "vault.manage")


def clean_folder(raw: str | None) -> str:
    """ "/A//B/ " -> "A/B"; refuses "..". At most 300 characters."""
    from ...intake.unpack import join_folder

    parts = (raw or "").replace("\\", "/").split("/")
    if any(p.strip() == ".." for p in parts):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_folder", "That folder name is not valid.")
    return join_folder(raw or "")


async def file_out(db: AsyncSession, f: DocFile, *, text: bool = False) -> FileOut:
    from ...documents.provenance import review_status

    b = await db.get(Branch, f.branch_id) if f.branch_id else None
    body = None
    if text:
        body = await db.scalar(select(DocFile.text).where(DocFile.id == f.id)) or ""
    a = await db.get(Agent, f.agent_id) if f.agent_id else None
    task_title = (
        await db.scalar(select(Task.title).where(Task.id == f.task_id)) if f.task_id else None
    )
    run_title = (
        await db.scalar(select(WorkflowRun.title).where(WorkflowRun.id == f.workflow_run_id))
        if f.workflow_run_id
        else None
    )
    review = None
    if f.document_id:
        row = (
            await db.execute(
                select(Document.status, Document.review).where(Document.id == f.document_id)
            )
        ).first()
        review = review_status(row[0], row[1]) if row else None
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
        library=f.library,
        department_id=f.department_id,
        indexed_at=f.indexed_at,
        folder=f.folder or "",
        source_path=f.source_path or "",
        batch_id=f.batch_id,
        sensitive=f.sensitive or {},
        quarantined=f.quarantined,
        origin=f.origin or "uploaded",
        agent_name=a.name if a else None,
        agent_color=a.color if a else None,
        task_title=task_title,
        workflow_run_id=f.workflow_run_id,
        workflow_run_title=run_title,
        document_id=f.document_id,
        report_id=f.report_id,
        review_status=review,
    )


async def get_file(
    db: AsyncSession, principal: Principal, file_id: str, *, library_ok: bool = False
) -> DocFile:
    """A file this person may use. With library_ok, also a library guideline shared with
    them (P18): people read the guidelines of their company and department, not edit them."""
    f = await db.scalar(
        service.scoped(
            select(DocFile).where(
                DocFile.id == file_id, DocFile.workspace_id == principal.workspace_id
            ),
            DocFile,
            principal,
        )
    )
    if f is None and library_ok:
        from ...knowledge import search as library

        shared = await db.get(DocFile, file_id)
        if (
            shared is not None
            and shared.workspace_id == principal.workspace_id
            and shared.library
            and library.sees(library.for_person(principal), shared.branch_id, shared.department_id)
        ):
            f = shared
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
                "Files can be up to {mb} MB.",
                mb=service.MAX_FILE_BYTES // (1024 * 1024),
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


EXPIRING_DAYS = 60


def _expiring() -> ColumnElement[bool]:
    soon = date.today() + timedelta(days=EXPIRING_DAYS)
    return and_(DocFile.expires_on.is_not(None), DocFile.expires_on < soon)


def _filtered(
    principal: Principal, branch_id: str | None, task_id: str | None, q: str
) -> Select[tuple[DocFile]]:
    """Files this person sees, narrowed by company, task and search."""
    query = select(DocFile).where(DocFile.workspace_id == principal.workspace_id)
    if branch_id:
        query = query.where(DocFile.branch_id == branch_id)
    if task_id:
        query = query.where(DocFile.task_id == task_id)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(
            or_(DocFile.name.ilike(like), DocFile.title.ilike(like), DocFile.kind.ilike(like))
        )
    return visible_files(query, principal)


def visible_files(query: Any, principal: Principal) -> Any:
    """Files a person sees: their own and their agents' (service.scoped), plus the guidelines
    shared with them (library files of their company and department, not held back), which
    they open and download like get_file(library_ok=True) but do not change."""
    if principal.scope.everything:
        return query
    from ...knowledge import search as library
    from ...search.viewer import library_scope

    mine = service.scoped(
        select(DocFile.id).where(DocFile.workspace_id == principal.workspace_id), DocFile, principal
    )
    shared = and_(
        DocFile.library.is_(True),
        DocFile.quarantined.is_(False),
        library_scope(library.for_person(principal)),
    )
    return query.where(or_(DocFile.id.in_(mine), shared))


@router.get("/stats")
async def file_stats(
    branch_id: str | None = None,
    q: str = Query(default="", max_length=120),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Counts behind the Files page tiles and tabs, for the same company and search as the
    list (one query, so the paged list can show true totals)."""
    row = (
        await db.execute(
            _filtered(principal, branch_id, None, q).with_only_columns(
                func.count(),
                func.count().filter(DocFile.source == "upload"),
                func.count().filter(DocFile.source == "generated"),
                func.count().filter(_expiring()),
                func.count().filter(DocFile.status == "reading"),
                func.count().filter(DocFile.origin == "agent"),
                func.count().filter(DocFile.origin == "person"),
                func.count().filter(DocFile.origin == "uploaded"),
            )
        )
    ).one()
    total, upload, generated, expiring, reading, agent, person, uploaded = (
        int(n or 0) for n in row
    )
    return {
        "total": total,
        "upload": upload,
        "generated": generated,
        "expiring": expiring,
        "reading": reading,
        # P25: by who made them
        "agent": agent,
        "person": person,
        "uploaded": uploaded,
    }


@router.get("")
async def list_files(
    response: Response,
    branch_id: str | None = None,
    task_id: str | None = None,
    q: str = Query(default="", max_length=120),
    source: str | None = Query(default=None, pattern="^(upload|generated)$"),
    expiring: bool = False,
    folder: str | None = Query(default=None, max_length=300),
    recursive: bool = False,
    batch_id: str | None = Query(default=None, max_length=40),
    kind: str | None = Query(default=None, max_length=40),
    department_id: str | None = Query(default=None, max_length=40),  # "none" = no department
    origin: str | None = Query(default=None, pattern="^(uploaded|person|agent)$"),
    agent_id: str | None = Query(default=None, max_length=40),
    workflow_run_id: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[FileOut]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count). `expiring`
    keeps files that expired or expire within EXPIRING_DAYS. P24: `folder` (exact; with
    `recursive` everything under it too; "" = the top) and `batch_id` (one upload). P25:
    `origin` (uploaded, made by a person, made by an agent), `agent_id` (that agent and the
    helpers it copied itself into) and `workflow_run_id`."""
    query = _filtered(principal, branch_id, task_id, q)
    if source:
        query = query.where(DocFile.source == source)
    if origin:
        query = query.where(DocFile.origin == origin)
    if agent_id:
        helpers = select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id, Agent.clone_of == agent_id
        )
        query = query.where(or_(DocFile.agent_id == agent_id, DocFile.agent_id.in_(helpers)))
    if workflow_run_id:
        query = query.where(DocFile.workflow_run_id == workflow_run_id)
    if expiring:
        query = query.where(_expiring())
    if folder is not None:
        path = clean_folder(folder)
        if recursive and path:
            like = path.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.where(
                or_(DocFile.folder == path, DocFile.folder.like(f"{like}/%", escape="\\"))
            )
        elif not recursive:
            query = query.where(DocFile.folder == path)
    if batch_id:
        query = query.where(DocFile.batch_id == batch_id)
    if kind:
        query = query.where(DocFile.kind == kind)
    if department_id is not None:
        query = query.where(
            DocFile.department_id.is_(None)
            if department_id in ("", "none")
            else DocFile.department_id == department_id
        )
    rows = await paging.paginate(
        db,
        query,
        ((DocFile.created_at, True), (DocFile.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return [await file_out(db, f) for f in rows]


@router.get("/{file_id}")
async def read_file(
    file_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    f = await get_file(db, principal, file_id, library_ok=True)
    # P24: a held-back file's text (passwords, IC numbers) is for the people who review it.
    return await file_out(db, f, text=not f.quarantined or may_manage(principal))


def check_held_back(principal: Principal, f: DocFile) -> None:
    if f.quarantined and not may_manage(principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "file_held_back",
            "This file is held back for review: it contains passwords or personal data. "
            "Ask someone who manages files to release it.",
        )


@router.get("/{file_id}/download")
async def download(
    file_id: str,
    inline: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    f = await get_file(db, principal, file_id, library_ok=True)
    check_held_back(principal, f)
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
    # P24: where it sits and how it is sorted (kind is one of intake.sort.KINDS).
    folder: str | None = Field(default=None, max_length=300)
    kind: str | None = Field(default=None, max_length=40)
    department_id: str | None = None


@router.patch("/{file_id}")
async def update_file(
    file_id: str,
    body: FileUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    from ...intake.sort import KINDS

    f = await get_file(db, principal, file_id)
    before = (f.name, f.branch_id, f.department_id)
    if body.name:
        f.name = body.name.strip()
    if body.folder is not None:
        f.folder = clean_folder(body.folder)
    if body.kind is not None:
        if body.kind not in KINDS:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_kind",
                "Pick one of: {kinds}.",
                kinds=", ".join(KINDS),
            )
        f.kind = body.kind
    if "branch_id" in body.model_fields_set:
        await check_branch(db, principal, body.branch_id)
        f.branch_id = body.branch_id
        if f.department_id and body.branch_id is None:
            f.department_id = None  # a department belongs to one company
        elif f.department_id:
            from ...models import Department

            d = await db.get(Department, f.department_id)
            if d is None or d.branch_id != body.branch_id:
                f.department_id = None
    if "department_id" in body.model_fields_set:
        if body.department_id is not None:
            from ...models import Department

            d = await db.get(Department, body.department_id)
            if d is None or d.workspace_id != principal.workspace_id or d.branch_id != f.branch_id:
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "bad_department",
                    "Pick a department of this file's company.",
                )
        f.department_id = body.department_id
    if body.task_id:
        await check_task(db, principal, body.task_id)
        f.task_id = body.task_id
    elif body.clear_task:
        f.task_id = None
    await db.commit()
    if f.library and (f.name, f.branch_id, f.department_id) != before:  # P18: title + scope
        from .library import start_index

        await start_index("file", f.id)
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
    from ...knowledge import indexer

    await indexer.remove(db, "file", f.id)  # P18: its library passages go with it
    await db.delete(f)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def load_bytes(db: AsyncSession, file_id: str) -> bytes:
    f = await db.scalar(select(DocFile).where(DocFile.id == file_id).options(undefer(DocFile.data)))
    return bytes(f.data) if f else b""
