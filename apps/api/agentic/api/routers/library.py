"""Knowledge library (P18): the guidelines, manuals, policies and SOPs agents search and cite.

A file joins the library with PATCH /api/files/{id}/library (and a scope: the whole
workspace, one company, or one department). Its text is cut into passages on the worker;
SOPs are indexed when saved. People see and search what an agent in their place would.
"""

import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from ...agents import dispatch
from ...core.db import get_db
from ...core.security import can
from ...i18n import Msg, render
from ...knowledge import indexer
from ...knowledge import library_units as units
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
    # P36: only its department's agents and managers read it.
    restricted: bool = False


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
    if not reader.everything and reader.grants is None:  # P144: grants: sees_file decides
        q = q.where(
            or_(DocFile.branch_id.is_(None), DocFile.branch_id == reader.branch_id)
            if reader.branch_id
            else DocFile.branch_id.is_(None)
        )
    out: list[LibrarySource] = []
    for f in (await db.scalars(q.order_by(DocFile.created_at.desc()))).all():
        # P36: a department is a filing label; only a restricted file is kept to it.
        # P109: and own-department-only readers keep to their department's files.
        if not library.sees_file(reader, f):
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
                restricted=f.restricted,
            )
        )
    # P148b: the list needs no SOP text (bodies are long), and each department SOP's company
    # comes from the departments loaded here once (it was one query per department SOP).
    sops = (
        await db.scalars(
            select(SOP)
            .where(SOP.workspace_id == principal.workspace_id)
            .options(load_only(SOP.id, SOP.title, SOP.scope, SOP.scope_id, SOP.updated_at))
            .order_by(SOP.title)
        )
    ).all()
    # Kept referenced: the session's identity map holds them weakly.
    depts = (
        (
            await db.scalars(
                select(Department).where(Department.workspace_id == principal.workspace_id)
            )
        ).all()
        if any(s.scope == "department" for s in sops)
        else []
    )
    for s in sops:
        bid, did = await indexer.sop_scope(db, s)
        if not library.sees(reader, bid, None):  # P36: every SOP of the company
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
    del depts
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
    # P36: only the department's own agents and managers may read it (never a staff
    # member's AI). Unset keeps what it was.
    restricted: bool | None = None


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
        ok = sc.in_branch(branch_id)
        where = Msg("your company")
    elif sc.department_id:
        ok = sc.in_branch(branch_id) and department_id == sc.department_id
        where = Msg("your department")
    else:
        ok = sc.in_branch(branch_id) and department_id is None
        where = Msg("your company")
    if not ok:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "out_of_scope",
            "You can add guidelines for {where} only.",
            where=where,
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
    if body.library and not f.library and body.restricted is None:
        # P36: confidential by its name or kind (pay, personnel, contracts): restricted until a
        # manager opens it up.
        from ...intake.sort import sensitive_words

        f.restricted = sensitive_words(f.kind, f.name, f.folder, f.title)
    f.library = body.library
    if body.restricted is not None and body.restricted != f.restricted:
        if not can(principal.role, "office.view"):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Only managers can restrict who reads a document.",
            )
        # P52: opening up a restricted document (pay, HR, contracts) to the whole company is
        # the risky direction: it needs a manager, not just anyone who can see the office.
        if (
            f.restricted
            and not body.restricted
            and not (can(principal.role, "agents.manage") or can(principal.role, "org.manage"))
        ):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Only a manager can open up a restricted document to everyone.",
            )
        f.restricted = body.restricted
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
        after={
            "library": f.library,
            "branch_id": f.branch_id,
            "department_id": f.department_id,
            "restricted": f.restricted,
        },
    )
    await db.commit()
    if f.library and f.status == "ready":
        await start_index("file", f.id)  # reading files are indexed when the read finishes
    await db.refresh(f)
    return await file_out(db, f)


# ---------------------------------------------------------------- P143b units


class UnitOut(BaseModel):
    key: str  # hr | audit | finance
    label: str  # "Unit HR", "Unit Audit", "Unit Kewangan"
    department_id: str
    department_name: str
    branch_id: str
    branch_name: str
    files: int  # the unit's files this person sees
    can_upload: bool  # may add files into it (the rule of an upload with a department)


class UnitsOut(BaseModel):
    units: list[UnitOut]


async def _unit_out(db: AsyncSession, principal: Principal, u: units.Unit) -> UnitOut:
    from .files import place_refused

    d = u.department
    return UnitOut(
        key=u.key,
        label=render(u.label),
        department_id=d.id,
        department_name=d.name,
        branch_id=d.branch_id,
        branch_name=u.branch.name,
        files=await units.file_count(db, principal, d),
        can_upload=can(principal.role, "work.write")
        and place_refused(principal, d.branch_id, d.id) is None,
    )


@router.get("/api/library/units")
async def list_units(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> UnitsOut:
    """P143b: the Library's units (HR, Audit, Kewangan) this person may open, first in Browse.
    A unit the workspace does not have, or whose files this person does not read, is left out."""
    found = await units.find(db, principal.workspace_id)
    return UnitsOut(
        units=[
            await _unit_out(db, principal, u)
            for u in found
            if units.may_open(principal, u.department)
        ]
    )


@router.get("/api/library/units/{key}")
async def get_unit(
    key: str, principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> UnitOut:
    u = next((x for x in await units.find(db, principal.workspace_id) if x.key == key), None)
    if u is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "unit_not_found", "That unit is not here.")
    if not units.may_open(principal, u.department):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "out_of_scope",
            "Only the people of this unit, their managers and the office's leaders open it.",
        )
    return await _unit_out(db, principal, u)


# ---------------------------------------------------------------- P144 company search


class PlaceOut(BaseModel):
    kind: Literal["unit", "company"]
    id: str  # the unit's key, or the company's id
    label: str  # "Unit HR · PW Venture Sdn Bhd (PWVSB)", or the company's name
    branch_id: str
    department_id: str | None = None
    # More words that find it: a unit's other names and department; a company's short name and
    # its departments' names.
    keywords: list[str] = []


def _fold(s: str) -> str:
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)
    ).casefold()


def _matches(q: str, p: PlaceOut) -> bool:
    hay = _fold(" ".join([p.label, *p.keywords]))
    return all(w in hay for w in _fold(q).split())


@router.get("/api/library/places")
async def library_places(
    q: str = Query(default="", max_length=100),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[PlaceOut]:
    """P144: the company search of the Library: the units this person opens ("HR", "Audit",
    "Kewangan" find them) and the companies they see, a company also found by its departments'
    names. `q` narrows it (every word, accents and case ignored); empty: all of them."""
    from ...knowledge import grants

    ws = principal.workspace_id
    out: list[PlaceOut] = []
    for u in await units.find(db, ws):
        if not units.may_open(principal, u.department):
            continue
        words = {u.key, u.label, render(u.label), u.department.name, u.branch.name}
        words |= units.ALIASES.get(u.key, set())
        out.append(
            PlaceOut(
                kind="unit",
                id=u.key,
                label=f"{render(u.label)} · {u.branch.name}",
                branch_id=u.branch.id,
                department_id=u.department.id,
                keywords=sorted(w.replace("-", " ") for w in words if w),
            )
        )
    bq = select(Branch).where(Branch.workspace_id == ws)
    sc = principal.scope
    g = grants.of(principal)
    if not sc.everything and not (g is not None and g.all_companies):
        given = sorted(g.companies) if g is not None else []
        bq = bq.where(or_(sc.branch_col(Branch.id), Branch.id.in_(given)))
    branches = (await db.scalars(bq.order_by(Branch.name))).all()
    depts: dict[str, list[str]] = {}
    if branches:
        rows = await db.execute(
            select(Department.branch_id, Department.name).where(
                Department.workspace_id == ws, Department.branch_id.in_([b.id for b in branches])
            )
        )
        for bid, name in rows.all():
            depts.setdefault(bid, []).append(name)
    for b in branches:
        out.append(
            PlaceOut(
                kind="company",
                id=b.id,
                label=b.name,
                branch_id=b.id,
                keywords=[x for x in [b.slug, *sorted(depts.get(b.id, []))] if x],
            )
        )
    return [p for p in out if _matches(q, p)] if q.strip() else out


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
    # P80: a SharePoint passage's file link and its place in the linked folder.
    url: str | None = None
    path: str | None = None


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
            url=h.url,
            path=h.path,
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


class PackIn(BaseModel):
    # Also overwrite sections a person edited in the app (and remove ones they edited that
    # are gone from the pack). Off: their edits are kept.
    force: bool = False


class PackOut(BaseModel):
    pack: str
    sections: int
    created: int
    updated: int
    unchanged: int
    kept: int
    removed: int
    indexing: int  # SOPs whose passages are being (re)built after this answer


@router.post("/api/library/packs/prima")
async def sync_prima_pack(
    background: BackgroundTasks,
    body: PackIn | None = None,
    principal: Principal = Depends(require("members.assign_owner")),
    db: AsyncSession = Depends(get_db),
) -> PackOut:
    """P65: import (or bring up to date) the Prima Secure SOPs, workflows, rules and forms as
    Library SOPs. Owner only, audited; a re-run changes only what changed."""
    from ...knowledge import prima_pack

    pack = prima_pack.load_pack()
    if pack is None or not pack.docs:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "pack_not_found",
            "The Prima Secure pack is not on this server.",
        )
    out = await prima_pack.apply(
        db,
        principal.workspace_id,
        pack,
        force=bool(body and body.force),
        actor=principal.actor,
        audit_always=True,
    )
    if out.to_index:
        background.add_task(prima_pack.index_later, out.to_index)
    c = out.counts()
    return PackOut(
        pack=prima_pack.PACK,
        sections=len(pack.docs),
        created=c["created"],
        updated=c["updated"],
        unchanged=c["unchanged"],
        kept=c["kept"],
        removed=c["removed"],
        indexing=len(out.to_index),
    )


# ---------------------------------------------------------------- P149c organize


class OrganizeRulesOut(BaseModel):
    branch_id: str | None
    department_id: str | None
    unit: str | None  # hr | audit | finance
    folders: dict[str, str]  # category -> folder name (every category)
    defaults: dict[str, str]  # category -> the default folder name
    dates: Literal["month", "year", "off"]
    keyword_folders: bool
    auto: bool  # "sort into folders automatically" starts on in the upload dialog
    can_edit: bool


class OrganizeRulesIn(BaseModel):
    branch_id: str | None = None
    department_id: str | None = None
    folders: dict[str, str] | None = None
    dates: Literal["month", "year", "off"] | None = None
    keyword_folders: bool | None = None
    auto: bool | None = None


async def _organize_place(
    db: AsyncSession, principal: Principal, branch_id: str | None, department_id: str | None
) -> tuple[str | None, str | None]:
    """A company (and department) of this workspace that this person sees."""
    from .files import check_branch

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
        if not units.may_open(principal, d):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "out_of_scope",
                "Only the people of this unit, their managers and the office's leaders open it.",
            )
        return d.branch_id, d.id
    await check_branch(db, principal, branch_id)
    return branch_id, None


def _may_sort(principal: Principal, branch_id: str | None, department_id: str | None) -> bool:
    from .files import place_refused

    return (
        can(principal.role, "work.write")
        and place_refused(principal, branch_id, department_id) is None
    )


def _rules_out(
    principal: Principal, branch_id: str | None, department_id: str | None, r: Any
) -> OrganizeRulesOut:
    from ...knowledge import organize

    o = r.out()
    return OrganizeRulesOut(
        branch_id=branch_id,
        department_id=department_id,
        unit=r.unit,
        folders=o["folders"],
        defaults={c.key: c.folder for c in organize.CATEGORIES},
        dates=r.dates,
        keyword_folders=r.keyword_folders,
        auto=r.auto,
        can_edit=_may_sort(principal, branch_id, department_id),
    )


@router.get("/api/library/organize/rules")
async def organize_rules(
    branch_id: str | None = None,
    department_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> OrganizeRulesOut:
    """P149c: how a unit (or company) sorts uploads into folders (knowledge/organize.py)."""
    from ...knowledge import organize

    branch_id, department_id = await _organize_place(db, principal, branch_id, department_id)
    r = await organize.load_rules(db, principal.workspace_id, branch_id, department_id)
    return _rules_out(principal, branch_id, department_id, r)


@router.put("/api/library/organize/rules")
async def save_organize_rules(
    body: OrganizeRulesIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> OrganizeRulesOut:
    """Change a unit's (or company's) sorting rules: folder names per category, date folders
    (month | year | off), keyword folders, and whether sorting starts on. Who may file into
    the place may change them; audited."""
    from ...knowledge import organize

    branch_id, department_id = await _organize_place(
        db, principal, body.branch_id, body.department_id
    )
    if not _may_sort(principal, branch_id, department_id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "out_of_scope",
            "You can add documents to your department only.",
        )
    r = await organize.load_rules(db, principal.workspace_id, branch_id, department_id)
    before = r.out()
    if body.folders is not None:
        for k, v in body.folders.items():
            if k not in organize.BY_KEY:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "bad_category",
                    "That is not one of the sorting categories.",
                )
            name = organize.clean_folder_name(v)
            if name and name != organize.BY_KEY[k].folder:
                r.folders[k] = name
            else:
                r.folders.pop(k, None)
    if body.dates is not None:
        r.dates = body.dates
    if body.keyword_folders is not None:
        r.keyword_folders = body.keyword_folders
    if body.auto is not None:
        r.auto = body.auto
    await organize.save_rules(db, principal.workspace_id, branch_id, department_id, r)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "library.organize_rules",
        target=department_id or branch_id,
        before=before,
        after=r.out(),
    )
    await db.commit()
    return _rules_out(principal, branch_id, department_id, r)


class PreviewIn(BaseModel):
    branch_id: str | None = None
    department_id: str | None = None
    folder: str = Field(default="", max_length=300)  # where the upload goes
    keywords: list[str] = Field(default_factory=list, max_length=40)
    names: list[str] = Field(min_length=1, max_length=1000)  # relative paths of a folder upload


class PreviewItem(BaseModel):
    name: str
    folder: str  # where it will go ("" = the top)
    sorted: bool  # placed by the rules (False: stays where it was uploaded)
    category: str | None = None
    date: str | None = None  # what was read, e.g. "Nov 2026"


class PreviewOut(BaseModel):
    auto: bool  # the place's default for "sort into folders automatically"
    keywords: list[str]  # the keywords as they will be saved
    items: list[PreviewItem]


@router.post("/api/library/organize/preview")
async def organize_preview(
    body: PreviewIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> PreviewOut:
    """P149c: the folders an upload's files would be sorted into, from their names and the
    keywords (before uploading; once read, a file's content can refine its folder). Files of
    a folder upload keep their own folders. A zip is unpacked on the server: shown as is."""
    from ...knowledge import organize
    from .files import clean_folder

    branch_id, department_id = await _organize_place(
        db, principal, body.branch_id, body.department_id
    )
    base = clean_folder(body.folder)
    keywords = organize.clean_keywords(body.keywords)
    rules = await organize.load_rules(db, principal.workspace_id, branch_id, department_id)
    paths = await organize.folder_paths(db, principal.workspace_id, branch_id, department_id)
    tree = organize.existing_tree(paths, base)
    items: list[PreviewItem] = []
    for raw in body.names:
        path = raw.replace("\\", "/").strip("/")[:500]
        parent, _, name = path.rpartition("/")
        if base or parent or name.lower().endswith(".zip"):  # a chosen folder: they stay
            kept = organize.join(base, clean_folder(parent))
            items.append(PreviewItem(name=path, folder=kept, sorted=False))
            continue
        p = organize.propose(organize.FileFacts(name=name, keywords=keywords), rules, tree)
        items.append(
            PreviewItem(
                name=path,
                folder=organize.join(base, p.folder) if p.folder else base,
                sorted=bool(p.folder),
                category=p.category,
                date=p.date.text if p.date else None,
            )
        )
    return PreviewOut(auto=rules.auto, keywords=keywords, items=items)
