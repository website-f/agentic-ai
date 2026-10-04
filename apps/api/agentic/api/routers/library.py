"""Knowledge library (P18): the guidelines, manuals, policies and SOPs agents search and cite.

A file joins the library with PATCH /api/files/{id}/library (and a scope: the whole
workspace, one company, or one department). Its text is cut into passages on the worker;
SOPs are indexed when saved. People see and search what an agent in their place would.
"""

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...core.db import get_db
from ...core.security import can
from ...knowledge import indexer
from ...knowledge import search as library
from ...models import SOP, Branch, Department, DocFile
from ...services import audit
from ...workflows.knowledge_activities import run_index
from ..deps import Principal, api_error, require
from .files import FileOut, file_out, get_file

router = APIRouter(tags=["library"])
log = logging.getLogger("agentic.api.library")

Scope = Literal["workspace", "branch", "department"]
Status = Literal["reading", "failed", "indexed", "empty", "not_indexed"]


async def start_index(kind: str, target_id: str) -> Literal["queued", "done"]:
    """Index on the worker; if Temporal is down, index here instead. queued | done."""
    try:
        await dispatch.start_library_index(kind, target_id)
        return "queued"
    except Exception:  # noqa: BLE001 - the library must not depend on the queue being up
        log.warning("worker unavailable; indexing %s %s inline", kind, target_id, exc_info=True)
        await run_index(kind, target_id)
        return "done"


class LibrarySource(BaseModel):
    kind: Literal["file", "sop"]
    id: str
    title: str
    name: str  # the file name ("" for an SOP)
    mime: str
    pages: int
    status: Status
    scope: Scope
    scope_label: str
    sop_scope: str | None  # workspace | branch | department | library, for SOPs
    branch_id: str | None
    department_id: str | None
    passages: int
    indexed_at: datetime | None
    updated_at: datetime


class LibraryOut(BaseModel):
    sources: list[LibrarySource]
    passages: int
    can_reindex: bool
    can_edit: bool


class Names:
    def __init__(self, branches: dict[str, str], depts: dict[str, tuple[str, str]]) -> None:
        self.branches = branches
        self.depts = depts  # id -> (name, branch id)

    @classmethod
    async def load(cls, db: AsyncSession, ws: str) -> "Names":
        rows = await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws))
        b = {i: n for i, n in rows.all()}
        rows = await db.execute(
            select(Department.id, Department.name, Department.branch_id).where(
                Department.workspace_id == ws
            )
        )
        d = {i: (n, bid) for i, n, bid in rows.all()}
        return cls(b, d)

    def scope(self, branch_id: str | None, department_id: str | None) -> tuple[Scope, str]:
        if department_id:
            name, bid = self.depts.get(department_id, ("Removed department", ""))
            return "department", f"{name}, {self.branches.get(bid, 'removed company')}"
        if branch_id:
            return "branch", self.branches.get(branch_id, "Removed company")
        return "workspace", "Whole company"


def _file_status(f: DocFile, passages: int) -> Status:
    if f.status == "reading":
        return "reading"
    if f.status == "failed":
        return "failed"
    if passages:
        return "indexed"
    return "empty" if f.indexed_at else "not_indexed"


@router.get("/api/library")
async def list_library(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> LibraryOut:
    reader = library.for_person(principal)
    names = await Names.load(db, principal.workspace_id)
    counts = await indexer.passage_counts(db, principal.workspace_id)
    q = select(DocFile).where(
        DocFile.workspace_id == principal.workspace_id, DocFile.library.is_(True)
    )
    if not reader.everything:
        q = q.where(
            or_(DocFile.branch_id.is_(None), DocFile.branch_id == reader.branch_id)
            if reader.branch_id
            else DocFile.branch_id.is_(None)
        )
    out: list[LibrarySource] = []
    for f in (await db.scalars(q.order_by(DocFile.created_at.desc()))).all():
        if not library.sees(reader, f.branch_id, f.department_id):
            continue
        n, _ = counts.get(("file", f.id), (0, None))
        scope, label = names.scope(f.branch_id, f.department_id)
        out.append(
            LibrarySource(
                kind="file",
                id=f.id,
                title=indexer.file_title(f),
                name=f.name,
                mime=f.mime,
                pages=f.pages,
                status=_file_status(f, n),
                scope=scope,
                scope_label=label,
                sop_scope=None,
                branch_id=f.branch_id,
                department_id=f.department_id,
                passages=n,
                indexed_at=f.indexed_at,
                updated_at=f.updated_at,
            )
        )
    sops = (
        await db.scalars(
            select(SOP).where(SOP.workspace_id == principal.workspace_id).order_by(SOP.title)
        )
    ).all()
    for s in sops:
        bid, did = await indexer.sop_scope(db, s)
        if not library.sees(reader, bid, did):
            continue
        n, last = counts.get(("sop", s.id), (0, None))
        scope, label = names.scope(bid, did)
        if s.scope == "library":
            label = "Library (attach to agents)"
        out.append(
            LibrarySource(
                kind="sop",
                id=s.id,
                title=s.title,
                name="",
                mime="text/markdown",
                pages=0,
                status="indexed" if n else "not_indexed",
                scope=scope,
                scope_label=label,
                sop_scope=s.scope,
                branch_id=bid,
                department_id=did,
                passages=n,
                indexed_at=last,
                updated_at=s.updated_at,
            )
        )
    return LibraryOut(
        sources=out,
        passages=sum(s.passages for s in out),
        can_reindex=can(principal.role, "brain.manage"),
        can_edit=can(principal.role, "work.write"),
    )


class LibraryIn(BaseModel):
    library: bool
    branch_id: str | None = None
    department_id: str | None = None


async def _check_scope(
    db: AsyncSession, principal: Principal, branch_id: str | None, department_id: str | None
) -> tuple[str | None, str | None]:
    """Validate a library scope and keep scoped people inside their own."""
    if department_id:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department.")
        if branch_id and branch_id != d.branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_department",
                "That department is in another company.",
            )
        branch_id = d.branch_id
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company.")
    sc = principal.scope
    if sc.everything:
        return branch_id, department_id
    if sc.kind == "branch":
        ok = branch_id is not None and branch_id == sc.branch_id
        where = "your company"
    elif sc.department_id:
        ok = branch_id == sc.branch_id and department_id == sc.department_id
        where = "your department"
    else:
        ok = branch_id is not None and branch_id == sc.branch_id and department_id is None
        where = "your company"
    if not ok:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "out_of_scope",
            f"You can add guidelines for {where} only.",
        )
    return branch_id, department_id


@router.patch("/api/files/{file_id}/library")
async def set_library(
    file_id: str,
    body: LibraryIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    f = await get_file(db, principal, file_id)
    before = {"library": f.library, "branch_id": f.branch_id, "department_id": f.department_id}
    branch_id = body.branch_id if "branch_id" in body.model_fields_set else f.branch_id
    department_id = (
        body.department_id if "department_id" in body.model_fields_set else f.department_id
    )
    if body.library:
        branch_id, department_id = await _check_scope(db, principal, branch_id, department_id)
    elif f.library:
        # Taking a file out is allowed to whoever could put it there.
        await _check_scope(db, principal, f.branch_id, f.department_id)
    f.library = body.library
    if body.library:
        f.branch_id, f.department_id = branch_id, department_id
    else:
        f.indexed_at = None
        await indexer.remove(db, "file", f.id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.library",
        target=f.id,
        before=before,
        after={"library": f.library, "branch_id": f.branch_id, "department_id": f.department_id},
    )
    await db.commit()
    if f.library and f.status == "ready":
        await start_index("file", f.id)  # reading files are indexed when the read finishes
    await db.refresh(f)
    return await file_out(db, f)


class PassageOut(BaseModel):
    n: int
    source_kind: str
    source_id: str
    title: str
    heading: str
    page: int | None
    cite: str
    text: str
    score: float
    similarity: float
    strong: bool
    via: list[str]


@router.get("/api/library/search")
async def search_library(
    q: str = Query(min_length=1, max_length=300),
    limit: int = Query(default=6, ge=1, le=12),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[PassageOut]:
    hits = await library.search(db, library.for_person(principal), q, limit=limit)
    return [
        PassageOut(
            n=i,
            source_kind=h.source_kind,
            source_id=h.source_id,
            title=h.title,
            heading=h.heading,
            page=h.page,
            cite=h.cite(),
            text=library.excerpt(h.text, q, 1200),
            score=h.score,
            similarity=h.similarity,
            strong=h.strong,
            via=h.via,
        )
        for i, h in enumerate(hits, 1)
    ]


class ReindexOut(BaseModel):
    state: Literal["queued", "done"]


@router.post("/api/library/reindex")
async def reindex(
    principal: Principal = Depends(require("brain.manage")), db: AsyncSession = Depends(get_db)
) -> ReindexOut:
    await audit.record(db, principal.workspace_id, principal.actor, "library.reindex")
    await db.commit()
    return ReindexOut(state=await start_index("workspace", principal.workspace_id))
