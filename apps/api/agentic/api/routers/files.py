"""Files people give the office (P10): upload, list, read, download, move, delete.

Uploads are the request body as application/octet-stream (the CSRF guard allows that type on
this one path only: like JSON, a cross-site form cannot send it). The worker then reads each
file once — text, OCR for scans, a short summary — so agents never re-read the raw bytes.
"""

import logging
from datetime import date, datetime, timedelta
from typing import Any, cast
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
        f = await db.scalar(
            service.visible_files(
                select(DocFile).where(
                    DocFile.id == file_id,
                    DocFile.workspace_id == principal.workspace_id,
                    DocFile.library.is_(True),
                ),
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


def place_refused(principal: Principal, branch_id: str | None, department_id: str | None) -> Any:
    """None when this person may put a file in that company + department (the rule of
    library._check_scope), else "company" or "department": what they got wrong. Workspace
    roles anywhere; a branch manager inside their company; a HOD, supervisor or staff member
    of a department only that department; anyone else their company with no department."""
    sc = principal.scope
    if sc.everything:
        return None
    if sc.kind == "branch":
        return None if branch_id is not None and branch_id == sc.branch_id else "company"
    if branch_id is None or branch_id != sc.branch_id:
        return "company"
    if department_id != sc.department_id:
        return "department"
    return None


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
    """Files a person sees (documents.service.visible_files): their own and their agents',
    plus the guidelines shared with them; never another person's private assistant's work."""
    return service.visible_files(query, principal)


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
                func.count().filter(DocFile.source == "download"),
                func.count().filter(DocFile.library.is_(True)),
                func.count().filter(DocFile.task_id.is_not(None)),
            )
        )
    ).one()
    total, upload, generated, expiring, reading, agent, person, uploaded, download, lib, tasks = (
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
        # the file store's views: fetched from websites, in the library, from tasks
        "download": download,
        "library": lib,
        "in_tasks": tasks,
    }


class TaskFilesOut(BaseModel):
    """One piece of work and every file it produced, fetched or was given (its helpers'
    sub-tasks included), for the file store's "By task" view."""

    task_id: str
    title: str
    status: str
    agent_name: str | None
    agent_color: str | None
    branch_id: str | None
    branch_name: str | None
    latest: datetime
    count: int
    files: list[FileOut]


TASK_FILES_SCAN = 800  # newest files looked at to build the groups
TASK_FILES_SHOWN = 30  # files listed per task (the count says how many there are)


@router.get("/by-task")
async def files_by_task(
    branch_id: str | None = None,
    task_id: str | None = Query(default=None, max_length=40),
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=12, ge=1, le=50),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[TaskFilesOut]:
    """Recent work with its files, newest first: what an agent made, downloaded or was given
    for a task, together, with a sub-task's files (helpers, delegated parts) under the task
    it belongs to. `task_id` gives that one task (and its sub-tasks) with all its files."""
    query = (
        _filtered(principal, branch_id, None, q)
        .where(DocFile.task_id.is_not(None))
        .order_by(DocFile.created_at.desc(), DocFile.id.desc())
        .limit(TASK_FILES_SCAN)
    )
    rows = cast(list[DocFile], list((await db.scalars(query)).all()))
    tasks: dict[str, Task | None] = {}

    async def task(tid: str) -> Task | None:
        if tid not in tasks:
            tasks[tid] = await db.get(Task, tid)
        return tasks[tid]

    async def root_of(tid: str) -> str:
        t, hops = await task(tid), 0
        while t is not None and t.parent_task_id and hops < 8:
            parent = await task(t.parent_task_id)
            if parent is None or parent.workspace_id != principal.workspace_id:
                break
            t, hops = parent, hops + 1
        return t.id if t is not None else tid

    groups: dict[str, list[DocFile]] = {}
    for f in rows:
        groups.setdefault(await root_of(f.task_id or ""), []).append(f)
    if task_id:
        groups = {k: v for k, v in groups.items() if k == task_id}
    out: list[TaskFilesOut] = []
    for root, files in list(groups.items())[:limit]:
        t = await task(root)
        a = await db.get(Agent, t.assignee_agent_id) if t and t.assignee_agent_id else None
        b = await db.get(Branch, t.branch_id) if t and t.branch_id else None
        shown = files if task_id else files[:TASK_FILES_SHOWN]
        out.append(
            TaskFilesOut(
                task_id=root,
                title=t.title if t else "",
                status=t.status if t else "",
                agent_name=a.name if a else None,
                agent_color=a.color if a else None,
                branch_id=t.branch_id if t else None,
                branch_name=b.name if b else None,
                latest=files[0].created_at,
                count=len(files),
                files=[await file_out(db, f) for f in shown],
            )
        )
    return out


@router.get("")
async def list_files(
    response: Response,
    branch_id: str | None = None,
    task_id: str | None = None,
    q: str = Query(default="", max_length=120),
    source: str | None = Query(default=None, pattern="^(upload|generated|download)$"),
    expiring: bool = False,
    folder: str | None = Query(default=None, max_length=300),
    recursive: bool = False,
    batch_id: str | None = Query(default=None, max_length=40),
    kind: str | None = Query(default=None, max_length=40),
    department_id: str | None = Query(default=None, max_length=40),  # "none" = no department
    origin: str | None = Query(default=None, pattern="^(uploaded|person|agent)$"),
    agent_id: str | None = Query(default=None, max_length=40),
    workflow_run_id: str | None = Query(default=None, max_length=40),
    library: bool | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[FileOut]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count). `expiring`
    keeps files that expired or expire within EXPIRING_DAYS. P24: `folder` (exact; with
    `recursive` everything under it too; "" = the top) and `batch_id` (one upload). P25:
    `origin` (uploaded, made by a person, made by an agent), `agent_id` (that agent and the
    helpers it copied itself into) and `workflow_run_id`. `source=download`: files agents
    fetched from websites; `library`: in (or not in) the knowledge library."""
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
    if library is not None:
        query = query.where(DocFile.library.is_(library))
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
    from ...models import Department

    branch_id, department_id = f.branch_id, f.department_id
    if "branch_id" in body.model_fields_set:
        await check_branch(db, principal, body.branch_id)
        branch_id = body.branch_id
        if department_id and branch_id is None:
            department_id = None  # a department belongs to one company
        elif department_id:
            d = await db.get(Department, department_id)
            if d is None or d.branch_id != branch_id:
                department_id = None
    if "department_id" in body.model_fields_set:
        if body.department_id is not None:
            d = await db.get(Department, body.department_id)
            if d is None or d.workspace_id != principal.workspace_id or d.branch_id != branch_id:
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "bad_department",
                    "Pick a department of this file's company.",
                )
        department_id = body.department_id
    if (branch_id, department_id) != (f.branch_id, f.department_id):
        # P29: an office role keeps files inside what it manages (as library._check_scope):
        # never to "whole workspace", no department, or another company or department.
        wrong = place_refused(principal, branch_id, department_id)
        if wrong == "company":
            raise api_error(
                status.HTTP_403_FORBIDDEN, "out_of_scope", "Pick a company you work in."
            )
        if wrong == "department":
            raise api_error(
                status.HTTP_403_FORBIDDEN, "out_of_scope", "Pick a department from here."
            )
        f.branch_id, f.department_id = branch_id, department_id
    if body.task_id:
        await check_task(db, principal, body.task_id)
        f.task_id = body.task_id
    elif body.clear_task:
        f.task_id = None
    await db.commit()
    if f.library and (f.name, f.branch_id, f.department_id) != before:
        # P18/P29: passages carry the title and the audience (company + department); rebuild
        # them whenever either changes, so search never answers with the old audience.
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
