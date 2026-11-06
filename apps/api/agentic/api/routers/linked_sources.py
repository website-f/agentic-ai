"""P80: SharePoint and OneDrive folders in the Library.

A manager pastes a folder's link (a sharing link or the folder's address). It is checked
(https on SharePoint or OneDrive only), opened with their own Microsoft 365 sign-in (read-only
Files.Read.All / Sites.Read.All, granted by reconnecting once) and previewed: the folder's name
and how many files will be read. Connected, its files are read on the worker and only their
searchable text is kept (sharepoint/library.py); agents search it with the rest of the Library
and cite the SharePoint link. A sync every few hours (and "Sync now") follows changes.

Who may connect, sync or disconnect: owners and admins (org.manage / brain.manage), for every
company or one; a company's manager (agents.manage, scoped to their company) for their own
company. Turning files into SOP drafts needs org.manage, like every SOP draft (P24: drafts
are never seen by agents until a person approves them).
"""

import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...core.db import SessionLocal, get_db
from ...core.security import can
from ...knowledge import indexer
from ...knowledge import search as library
from ...microsoft import access
from ...microsoft.errors import (
    Forbidden,
    GraphError,
    MicrosoftError,
    NotFound,
    ReconnectNeeded,
    Unauthorized,
)
from ...models import Branch
from ...services import audit
from ...sharepoint import library as linked
from ...sharepoint import links
from ...sharepoint.models import LinkedFile, LinkedSource
from ...workflows.linked_workflows import run_sync
from ..deps import Principal, api_error, require
from .library import Names

router = APIRouter(prefix="/api/library/linked", tags=["library"])
PREVIEW_SECONDS = 12.0  # P80: well inside the proxies' time limits
log = logging.getLogger("agentic.api.linked_sources")

MAX_SOP_DRAFTS = 10

SourceStatus = Literal["syncing", "ready", "needs_reconnect", "error"]


# ---------------------------------------------------------------- who may do what


def _manager(principal: Principal) -> bool:
    return can(principal.role, "org.manage") or can(principal.role, "brain.manage")


def may_connect(principal: Principal) -> bool:
    sc = principal.scope
    return _manager(principal) or (
        sc.kind == "branch" and bool(sc.branch_id) and can(principal.role, "agents.manage")
    )


def may_manage(principal: Principal, branch_id: str | None) -> bool:
    """Connect, sync or disconnect a folder for this scope (None = every company)."""
    if _manager(principal):
        return True
    sc = principal.scope
    return (
        sc.kind == "branch"
        and can(principal.role, "agents.manage")
        and branch_id is not None
        and branch_id == sc.branch_id
    )


def _forbid() -> Exception:
    return api_error(
        status.HTTP_403_FORBIDDEN,
        "forbidden",
        "Only an owner, an admin or the company's manager can connect SharePoint folders.",
    )


# ---------------------------------------------------------------- shapes


class LinkIn(BaseModel):
    url: str = Field(min_length=1, max_length=links.MAX_LINK)


class ConnectIn(LinkIn):
    branch_id: str | None = None  # None: every company


class PreviewOut(BaseModel):
    name: str
    is_folder: bool
    web_url: str
    provider: str
    files: int  # supported files that will be read
    skipped: int  # pictures, zips and other files that are not read
    capped: bool  # more than the limits: only the first files are read
    partial: bool = False  # P80: counted for a few seconds only; the import finds the rest
    already: bool  # this folder is in the Library already


class SourceOut(BaseModel):
    id: str
    name: str
    provider: str
    is_folder: bool
    web_url: str
    branch_id: str | None
    scope_label: str
    status: SourceStatus
    last_error: str | None
    last_sync_at: datetime | None
    files_indexed: int
    files_held: int
    files_failed: int
    files_seen: int
    passages: int
    capped: bool
    connected_by_name: str
    connected_by_me: bool
    can_manage: bool


class LinkedOut(BaseModel):
    sources: list[SourceOut]
    can_connect: bool
    can_draft_sops: bool
    max_files: int


class LinkedFileOut(BaseModel):
    id: str
    name: str
    path: str
    web_url: str
    status: str
    passages: int
    error: str | None
    indexed_at: datetime | None


class DraftsIn(BaseModel):
    # None: every file of the folder that reads like a procedure (SOP, guide, policy...).
    file_ids: list[str] | None = Field(default=None, max_length=MAX_SOP_DRAFTS)


class DraftsOut(BaseModel):
    jobs: list[str]
    count: int


# ---------------------------------------------------------------- helpers


async def _counts(db: AsyncSession, ws: str) -> dict[str, dict[str, int]]:
    """{source id: {status: files, "passages": n}} in one query."""
    rows = await db.execute(
        select(
            LinkedFile.source_id,
            LinkedFile.status,
            func.count(),
            func.coalesce(func.sum(LinkedFile.passages), 0),
        )
        .where(LinkedFile.workspace_id == ws)
        .group_by(LinkedFile.source_id, LinkedFile.status)
    )
    out: dict[str, dict[str, int]] = {}
    for sid, st, n, passages in rows.all():
        c = out.setdefault(sid, {"passages": 0})
        c[st] = int(n)
        c["passages"] += int(passages)
    return out


def _out(principal: Principal, s: LinkedSource, names: Names, counts: dict[str, int]) -> SourceOut:
    _, label = names.scope(s.branch_id, None)
    return SourceOut(
        id=s.id,
        name=s.name,
        provider=s.provider,
        is_folder=s.is_folder,
        web_url=s.web_url,
        branch_id=s.branch_id,
        scope_label=label,
        status=s.status,  # type: ignore[arg-type]
        last_error=s.last_error,
        last_sync_at=s.last_sync_at,
        files_indexed=counts.get("indexed", 0) + counts.get("empty", 0),
        files_held=counts.get("held", 0),
        files_failed=counts.get("failed", 0) + counts.get("too_large", 0),
        files_seen=s.files_seen,
        passages=counts.get("passages", 0),
        capped=s.capped,
        connected_by_name=s.connected_by_name,
        connected_by_me=s.connected_by == principal.user.id,
        can_manage=may_manage(principal, s.branch_id),
    )


async def _one(db: AsyncSession, principal: Principal, source_id: str) -> LinkedSource:
    s = await db.get(LinkedSource, source_id)
    if (
        s is None
        or s.workspace_id != principal.workspace_id
        or not library.sees(library.for_person(principal), s.branch_id, None)
    ):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "linked_not_found", "That SharePoint folder is not here."
        )
    return s


async def _source_out(db: AsyncSession, principal: Principal, s: LinkedSource) -> SourceOut:
    names = await Names.load(db, principal.workspace_id)
    counts = await _counts(db, principal.workspace_id)
    return _out(principal, s, names, counts.get(s.id, {}))


async def _my_files_graph(db: AsyncSession, principal: Principal) -> Any:
    from ...microsoft import graph

    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None or acct.status not in access.USABLE_ACCOUNT:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "microsoft_not_connected",
            "Connect your Microsoft 365 account first. The folder is opened with your own sign-in.",
        )
    if not linked.files_ok(acct):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "files_not_allowed",
            "Reconnect Microsoft 365 once to allow SharePoint, then paste the link again.",
        )
    return await graph.for_account(db, acct)


def _link(url: str) -> str:
    try:
        return links.check_link(url)
    except links.BadLink as e:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_link",
            e.message.template,
            **{k: str(v) for k, v in e.message.vars.items()},
        ) from e


def _graph_fail(e: MicrosoftError) -> Exception:
    if isinstance(e, ReconnectNeeded | Unauthorized):
        return api_error(
            status.HTTP_409_CONFLICT,
            "files_not_allowed",
            "Reconnect Microsoft 365 once to allow SharePoint, then paste the link again.",
        )
    if isinstance(e, Forbidden):
        return api_error(
            status.HTTP_400_BAD_REQUEST,
            "link_not_allowed",
            "Your Microsoft account cannot open that link. Check that it was shared with you, "
            "and that you connected the same Microsoft account.",
        )
    if isinstance(e, NotFound) or (isinstance(e, GraphError) and e.status == 400):
        return api_error(
            status.HTTP_400_BAD_REQUEST,
            "link_not_found",
            "Microsoft could not find what that link opens. Copy the link again from SharePoint "
            "or OneDrive.",
        )
    return api_error(
        status.HTTP_502_BAD_GATEWAY,
        "microsoft_error",
        "Microsoft did not answer as expected: {why}",
        why=str(e)[:200],
    )


async def _start(background: BackgroundTasks, source_id: str) -> None:
    """Sync on the worker; when it cannot be reached, right after this answer instead."""
    try:
        await dispatch.start_linked_sync(source_id)
    except Exception:  # noqa: BLE001 - the Library must not depend on the queue being up
        log.warning("worker unavailable; syncing linked source %s here", source_id, exc_info=True)
        background.add_task(run_sync, source_id)


# ---------------------------------------------------------------- the screens


@router.get("")
async def list_linked(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> LinkedOut:
    from ...core.config import settings

    reader = library.for_person(principal)
    names = await Names.load(db, principal.workspace_id)
    counts = await _counts(db, principal.workspace_id)
    rows = (
        await db.scalars(
            select(LinkedSource)
            .where(LinkedSource.workspace_id == principal.workspace_id)
            .order_by(LinkedSource.created_at.desc())
        )
    ).all()
    return LinkedOut(
        sources=[
            _out(principal, s, names, counts.get(s.id, {}))
            for s in rows
            if library.sees(reader, s.branch_id, None)
        ],
        can_connect=may_connect(principal),
        can_draft_sops=can(principal.role, "org.manage"),
        max_files=settings.sharepoint_max_files,
    )


@router.post("/resolve")
async def resolve_link(
    body: LinkIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PreviewOut:
    """What the link opens, and how many files would be read (nothing is stored)."""
    if not may_connect(principal):
        raise _forbid()
    url = _link(body.url)
    g = await _my_files_graph(db, principal)
    try:
        item = await links.resolve(g, url)
        # P80: a preview answers within the proxies' patience; the import walks it all.
        found = await links.walk(g, item, budget=PREVIEW_SECONDS)
    except MicrosoftError as e:
        raise _graph_fail(e) from e
    already = await db.scalar(
        select(LinkedSource.id).where(
            LinkedSource.workspace_id == principal.workspace_id,
            LinkedSource.drive_id == item.drive_id,
            LinkedSource.item_id == item.item_id,
        )
    )
    return PreviewOut(
        name=item.name,
        is_folder=item.is_folder,
        web_url=item.web_url,
        provider=links.provider_of(url),
        files=len(found.files),
        skipped=found.skipped,
        capped=found.capped,
        partial=found.partial,
        already=already is not None,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def connect_link(
    body: ConnectIn,
    background: BackgroundTasks,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    url = _link(body.url)
    if body.branch_id:
        b = await db.get(Branch, body.branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company.")
    if not may_manage(principal, body.branch_id):
        raise _forbid()
    g = await _my_files_graph(db, principal)
    try:
        item = await links.resolve(g, url)
    except MicrosoftError as e:
        raise _graph_fail(e) from e
    if item.is_folder is False and not links.supported(item.name):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "link_not_supported",
            "That link opens a file the Library cannot read. Link a folder, or a Word, Excel, "
            "PowerPoint, PDF, text or CSV file.",
        )
    s = await db.scalar(
        select(LinkedSource).where(
            LinkedSource.workspace_id == principal.workspace_id,
            LinkedSource.drive_id == item.drive_id,
            LinkedSource.item_id == item.item_id,
        )
    )
    me = principal.user.name or principal.user.email
    if s is not None and s.status != "needs_reconnect":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "already_linked",
            "That folder is in the Library already. Use Sync now on it instead.",
        )
    if s is not None:
        # Its person's sign-in stopped working: whoever connects it again now syncs it, with
        # their own sign-in (and the scope they picked).
        if not may_manage(principal, s.branch_id):
            raise _forbid()
        before = {"connected_by": s.connected_by, "branch_id": s.branch_id}
        s.connected_by, s.connected_by_name, s.branch_id = principal.user.id, me, body.branch_id
        s.status, s.last_error, s.sync_started_at = "syncing", None, None
        if body.branch_id != before["branch_id"]:
            # P80: passages carry the scope; they are rebuilt with the new one.
            for fid in (
                await db.scalars(select(LinkedFile.id).where(LinkedFile.source_id == s.id))
            ).all():
                await indexer.remove(db, linked.KIND, fid)
            await db.execute(update(LinkedFile).where(LinkedFile.source_id == s.id).values(ctag=""))
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "library.linked_reconnected",
            target=s.id,
            before=before,
            after={"connected_by": s.connected_by, "branch_id": s.branch_id},
        )
    else:
        s = LinkedSource(
            workspace_id=principal.workspace_id,
            connected_by=principal.user.id,
            connected_by_name=me,
            provider=links.provider_of(url),
            drive_id=item.drive_id,
            item_id=item.item_id,
            is_folder=item.is_folder,
            name=item.name,
            web_url=item.web_url or url,
            branch_id=body.branch_id,
            status="syncing",
        )
        db.add(s)
        await db.flush()
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "library.linked",
            target=s.id,
            after={"name": s.name, "web_url": s.web_url, "branch_id": s.branch_id},
        )
    await db.commit()
    await _start(background, s.id)
    return await _source_out(db, principal, s)


@router.post("/{source_id}/sync", status_code=status.HTTP_202_ACCEPTED)
async def sync_now(
    source_id: str,
    background: BackgroundTasks,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    s = await _one(db, principal, source_id)
    if not may_manage(principal, s.branch_id):
        raise _forbid()
    if s.status != "syncing":
        s.status, s.sync_started_at = "syncing", None
        await db.commit()
    await _start(background, s.id)
    return await _source_out(db, principal, s)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    source_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Take a folder out of the Library: its searchable text goes; the files stay in
    SharePoint, untouched."""
    s = await _one(db, principal, source_id)
    if not may_manage(principal, s.branch_id):
        raise _forbid()
    before = {"name": s.name, "web_url": s.web_url, "branch_id": s.branch_id}
    files = await linked.remove_source(db, s)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "library.unlinked",
        target=source_id,
        before={**before, "files": files},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{source_id}/files")
async def linked_files(
    source_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[LinkedFileOut]:
    s = await _one(db, principal, source_id)
    rows = (
        await db.scalars(
            select(LinkedFile).where(LinkedFile.source_id == s.id).order_by(LinkedFile.path)
        )
    ).all()
    return [
        LinkedFileOut(
            id=f.id,
            name=f.name,
            path=f.path,
            web_url=f.web_url,
            status=f.status,
            passages=f.passages,
            error=f.error,
            indexed_at=f.indexed_at,
        )
        for f in rows
    ]


async def _build_later(job_id: str) -> None:
    from ...intake import builders

    async with SessionLocal() as db:
        await builders.run_job(db, job_id)


@router.post("/{source_id}/sops", status_code=status.HTTP_202_ACCEPTED)
async def draft_sops(
    source_id: str,
    background: BackgroundTasks,
    body: DraftsIn | None = None,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> DraftsOut:
    """Turn SharePoint files into SOP drafts (one per file), written by the AI on the worker.
    They wait on the SOPs page for a person to approve them; agents never see a draft."""
    from ...intake import builders

    s = await _one(db, principal, source_id)
    q = select(LinkedFile).where(LinkedFile.source_id == s.id, LinkedFile.status == "indexed")
    if body and body.file_ids:
        q = q.where(LinkedFile.id.in_(body.file_ids))
        picked = list((await db.scalars(q.order_by(LinkedFile.path))).all())
        if len(picked) != len(set(body.file_ids)):
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "file_not_ready",
                "Some of those files have no readable text yet. Sync the folder first.",
            )
    else:
        picked = [
            f
            for f in (await db.scalars(q.order_by(LinkedFile.path))).all()
            if builders.is_howto(_howto_view(f))
        ][:MAX_SOP_DRAFTS]
        if not picked:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "no_procedures",
                "None of these files reads like a procedure (an SOP, guide, policy or "
                "checklist). Open Files and pick the ones to turn into SOP drafts.",
            )
    jobs: list[str] = []
    for f in picked:
        job = await builders.new_job(
            workspace_id=principal.workspace_id,
            what="sop",
            file_ids=[],
            branch_id=s.branch_id,
            department_id=None,
            actor=principal.actor,
            linked_ids=[f.id],
        )
        jobs.append(job["id"])
        try:
            await dispatch.start_build(job["id"])
        except Exception:  # noqa: BLE001 - Temporal is down: write it after this answer
            log.warning("could not start build job %s; building here", job["id"], exc_info=True)
            background.add_task(_build_later, job["id"])
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "library.linked_sop_drafts",
        target=s.id,
        after={"files": [f.id for f in picked], "jobs": jobs},
    )
    await db.commit()
    return DraftsOut(jobs=jobs, count=len(jobs))


class _HowtoView:
    """What builders.is_howto reads of a document (kind unknown: the name and folder say)."""

    def __init__(self, f: LinkedFile) -> None:
        self.kind = ""
        self.name = f.name
        self.title = linked.title_of(f.name)
        self.folder = f.path.rsplit("/", 1)[0] if "/" in f.path else ""


def _howto_view(f: LinkedFile) -> Any:
    return _HowtoView(f)
