"""P109: files uploaded for other companies (org/handoffs.py has the rules).

GET    /api/handoffs/targets        may I upload for others, and to which companies
POST   /api/handoffs                one file (the body) for one or more companies
GET    /api/handoffs/mine           my uploads: waiting for my check, and what I approved
PATCH  /api/handoffs/{id}           fix the title or the company (waiting only)
POST   /api/handoffs/{id}/approve   checked: it joins the company's Library, leaves my view
DELETE /api/handoffs/{id}           take it back (waiting only): the file is removed
GET    /api/handoffs/incoming       what came in for the companies I answer for
GET    /api/handoffs/{id}/file      the file itself (uploader while waiting; the target's heads)
"""

from datetime import UTC, datetime
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...documents import service
from ...i18n import Msg
from ...models import Branch, DocFile, Task
from ...org import handoffs as rules
from ...org.models import FileHandoff
from ...services import audit, notices
from ..deps import Principal, api_error, require
from .files import INLINE_SAFE, check_task, start_reading

router = APIRouter(prefix="/api/handoffs", tags=["handoffs"])


class CompanyRef(BaseModel):
    id: str
    name: str


class TargetsOut(BaseModel):
    allowed: bool
    companies: list[CompanyRef]


class HandoffOut(BaseModel):
    id: str
    status: Literal["pending", "approved"]
    file_id: str | None
    file_name: str
    title: str  # what the uploader typed, else what the AI wrote, else the name
    typed_title: bool
    summary: str
    reading: bool  # the file is still being read
    mime: str
    size: int
    company_id: str | None
    company_name: str | None
    task_id: str | None
    task_title: str | None
    uploader_id: str | None
    uploader_name: str | None
    created_at: datetime
    approved_at: datetime | None
    new: bool = False  # incoming: not opened by me yet


class MineOut(BaseModel):
    pending: list[HandoffOut]
    approved: list[HandoffOut]  # audit lines: what I handed over, no way back in


class HandoffPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    company_id: str | None = Field(default=None, max_length=40)


async def _outs(
    db: AsyncSession, principal: Principal, rows: list[FileHandoff], *, details: bool = True
) -> list[HandoffOut]:
    files = {
        f.id: f
        for f in (
            await db.scalars(
                select(DocFile).where(DocFile.id.in_([h.file_id for h in rows if h.file_id]))
            )
        ).all()
    }
    people = await rules.names(db, {h.uploader_user_id or "" for h in rows})
    companies = await rules.branch_names(db, principal.workspace_id)
    task_ids = [h.task_id for h in rows if h.task_id]
    tasks = (
        dict((await db.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids)))).all())
        if task_ids
        else {}
    )
    out = []
    for h in rows:
        f = files.get(h.file_id or "")
        show = details and f is not None
        out.append(
            HandoffOut(
                id=h.id,
                status=h.status,  # type: ignore[arg-type]
                file_id=h.file_id if show else None,
                file_name=h.file_name,
                title=(h.title or (f.title if f else "") or h.file_name),
                typed_title=bool(h.title),
                summary=(f.summary if show and f else ""),
                reading=bool(f and f.status == "reading"),
                mime=f.mime if f else "",
                size=f.size if f else 0,
                company_id=h.target_branch_id,
                company_name=companies.get(h.target_branch_id or ""),
                task_id=h.task_id,
                task_title=tasks.get(h.task_id or ""),
                uploader_id=h.uploader_user_id,
                uploader_name=people.get(h.uploader_user_id or ""),
                created_at=h.created_at,
                approved_at=h.approved_at,
                new=principal.user.id not in (h.seen_by or []),
            )
        )
    return out


async def _company(db: AsyncSession, principal: Principal, branch_id: str) -> Branch:
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_company", "Pick a company from the list.")
    return b


async def _allowed(db: AsyncSession, principal: Principal) -> None:
    if not await rules.may_upload(db, principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "cannot_upload_for_others",
            "You cannot upload files for other companies. Ask your manager or an owner to "
            "switch it on for you.",
        )


async def _mine(db: AsyncSession, principal: Principal, hid: str) -> FileHandoff:
    """An upload of mine (an owner or admin may act on anyone's)."""
    h = await db.get(FileHandoff, hid)
    if (
        h is None
        or h.workspace_id != principal.workspace_id
        or (h.uploader_user_id != principal.user.id and not rules.everywhere(principal))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "handoff_not_found", "That upload is not here.")
    return h


async def _tell(db: AsyncSession, principal: Principal, hs: list[FileHandoff]) -> None:
    """The target company's heads hear what came in (one notice per company)."""
    by_company: dict[str, list[FileHandoff]] = {}
    for h in hs:
        if h.target_branch_id:
            by_company.setdefault(h.target_branch_id, []).append(h)
    who = principal.user.name
    for bid, items in by_company.items():
        people = [u for u in await rules.recipients(db, principal.workspace_id, bid) if u]
        people = [u for u in people if u != principal.user.id]
        for h in items:
            h.notified = sorted(set(h.notified or []) | set(people))
            flag_modified(h, "notified")
        await db.commit()
        if not people:
            continue
        b = await db.get(Branch, bid)
        company = b.name if b else ""
        names = ", ".join(h.title or h.file_name for h in items[:5])
        more = f" (+{len(items) - 5})" if len(items) > 5 else ""
        n = len(items)
        await notices.tell(
            db,
            principal.workspace_id,
            people,
            title=Msg("Files uploaded for {company}", company=company),
            body=Msg(
                "{name} uploaded {n} file(s) for {company}: {files}",
                name=who,
                n=n,
                company=company,
                files=names + more,
            ),
            path="/handoffs?tab=received",
            subject=f"Files uploaded for {company} / Fail dimuat naik untuk {company}",
            en=[
                f"{who} uploaded {n} file(s) for {company}: {names}{more}.",
                "They check each file before it joins your company's Library.",
            ],
            ms=[
                f"{who} telah memuat naik {n} fail untuk {company}: {names}{more}.",
                "Mereka menyemak setiap fail sebelum ia masuk ke Pustaka syarikat anda.",
            ],
            dedupe=f"handoff:{items[0].id}",
            actor=principal.actor,
        )


@router.get("/targets")
async def targets(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> TargetsOut:
    """The companies this person may upload for (none unless they may)."""
    if not await rules.may_upload(db, principal):
        return TargetsOut(allowed=False, companies=[])
    rows = (
        await db.execute(
            select(Branch.id, Branch.name)
            .where(Branch.workspace_id == principal.workspace_id)
            .order_by(Branch.name)
        )
    ).all()
    return TargetsOut(allowed=True, companies=[CompanyRef(id=i, name=n) for i, n in rows])


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    companies: str = Query(min_length=1, max_length=2000),
    title: str = Query(default="", max_length=200),
    task_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> list[HandoffOut]:
    """One file (the request body) for each company in `companies` (comma separated). An empty
    `title` lets the AI describe it when the file is read."""
    await _allowed(db, principal)
    ids = list(dict.fromkeys(c.strip() for c in companies.split(",") if c.strip()))
    if not ids or len(ids) > rules.MAX_TARGETS:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_companies",
            "Pick 1 to {n} companies for each file.",
            n=rules.MAX_TARGETS,
        )
    for bid in ids:
        await _company(db, principal, bid)
    task = await check_task(db, principal, task_id)
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
    typed = " ".join(title.split())[:200]
    made: list[FileHandoff] = []
    for bid in ids:
        f = await service.create_file(
            db,
            workspace_id=principal.workspace_id,
            name=name,
            data=bytes(data),
            created_by=principal.actor,
            mime=mime,
            branch_id=bid,
        )
        f.owner_user_id = None  # company work of the target, never the uploader's desk
        if typed:
            f.title = typed
        h = FileHandoff(
            workspace_id=principal.workspace_id,
            file_id=f.id,
            file_name=f.name,
            uploader_user_id=principal.user.id,
            target_branch_id=bid,
            task_id=task.id if task else None,
            title=typed,
            status="pending",
            notified=[],
            seen_by=[],
        )
        db.add(h)
        await db.flush()
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "file.handoff_uploaded",
            target=h.id,
            after={
                "file_id": f.id,
                "name": f.name,
                "size": f.size,
                "company_id": bid,
                "task_id": h.task_id,
            },
        )
        made.append(h)
    await db.commit()
    for h in made:
        await start_reading(h.file_id or "")
    await _tell(db, principal, made)
    for h in made:
        await db.refresh(h)
    return await _outs(db, principal, made)


@router.get("/mine")
async def mine(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> MineOut:
    rows = list(
        (
            await db.scalars(
                select(FileHandoff)
                .where(
                    FileHandoff.workspace_id == principal.workspace_id,
                    FileHandoff.uploader_user_id == principal.user.id,
                )
                .order_by(FileHandoff.created_at.desc())
                .limit(500)
            )
        ).all()
    )
    pending = [h for h in rows if h.status == "pending"]
    done = [h for h in rows if h.status == "approved"][:200]
    return MineOut(
        pending=await _outs(db, principal, pending),
        # Approved: only the line (name, company, when); the file is the company's now.
        approved=await _outs(db, principal, done, details=False),
    )


@router.patch("/{hid}")
async def edit(
    hid: str,
    body: HandoffPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    h = await _mine(db, principal, hid)
    if h.status != "pending":
        raise api_error(
            status.HTTP_409_CONFLICT, "handoff_done", "This file was already handed over."
        )
    f = await rules.file_of(db, h)
    before = {"title": h.title, "company_id": h.target_branch_id}
    moved = False
    if body.title is not None:
        h.title = " ".join(body.title.split())[:200]
        if f is not None and h.title:
            f.title = h.title
    if body.company_id is not None and body.company_id != h.target_branch_id:
        await _allowed(db, principal)
        await _company(db, principal, body.company_id)
        h.target_branch_id = body.company_id
        if f is not None:
            f.branch_id, f.department_id = body.company_id, None
        h.notified, h.seen_by = [], []
        moved = True
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.handoff_changed",
        target=h.id,
        before=before,
        after={"title": h.title, "company_id": h.target_branch_id},
    )
    await db.commit()
    if moved:
        await _tell(db, principal, [h])
    await db.refresh(h)
    return (await _outs(db, principal, [h]))[0]


@router.post("/{hid}/approve")
async def approve(
    hid: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> HandoffOut:
    """Checked: the file joins the target company's Library and leaves the uploader's view."""
    h = await _mine(db, principal, hid)
    if h.status == "approved":
        return (await _outs(db, principal, [h], details=False))[0]
    f = await rules.file_of(db, h)
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    from ...intake.sort import sensitive_words

    if h.title:
        f.title = h.title
    f.library = True
    # P36: confidential by its name or kind (pay, personnel, contracts): restricted to its
    # department's agents and the managers until someone opens it up.
    f.restricted = sensitive_words(f.kind, f.name, f.folder, f.title)
    h.status, h.approved_at = "approved", datetime.now(UTC)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.handoff_approved",
        target=h.id,
        after={"file_id": f.id, "company_id": h.target_branch_id, "restricted": f.restricted},
    )
    await db.commit()
    if f.status == "ready":
        from .library import start_index

        await start_index("file", f.id)  # a file still being read is indexed when it is read
    await db.refresh(h)
    return (await _outs(db, principal, [h], details=False))[0]


@router.delete("/{hid}", status_code=status.HTTP_204_NO_CONTENT)
async def take_back(
    hid: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Uploaded by mistake: the file is removed (waiting ones only)."""
    h = await _mine(db, principal, hid)
    if h.status != "pending":
        raise api_error(
            status.HTTP_409_CONFLICT, "handoff_done", "This file was already handed over."
        )
    f = await rules.file_of(db, h)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.handoff_withdrawn",
        target=h.id,
        before={"file_id": h.file_id, "name": h.file_name, "company_id": h.target_branch_id},
    )
    if f is not None:
        from ...documents import storage
        from ...knowledge import indexer

        await indexer.remove(db, "file", f.id)
        await storage.forget(db, f)
        await db.delete(f)
    await db.delete(h)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/incoming")
async def incoming(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[HandoffOut]:
    """What came in for the companies this person answers for (heads of its departments, its
    branch managers, whoever was told; workspace roles every company). Opening it marks them
    seen for this person."""
    rows = list(
        (
            await db.scalars(
                select(FileHandoff)
                .where(rules.incoming_where(principal))
                .order_by(FileHandoff.created_at.desc())
                .limit(300)
            )
        ).all()
    )
    out = await _outs(db, principal, rows)
    changed = False
    for h in rows:
        if principal.user.id in (h.notified or []) and principal.user.id not in (h.seen_by or []):
            h.seen_by = [*(h.seen_by or []), principal.user.id]
            flag_modified(h, "seen_by")
            changed = True
    if changed:
        await db.commit()
    return out


@router.get("/{hid}/file")
async def file(
    hid: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The file: its uploader while it waits for their check; the people it came in for."""
    h = await db.get(FileHandoff, hid)
    ok = h is not None and h.workspace_id == principal.workspace_id
    if ok and h is not None:
        mine_waiting = h.uploader_user_id == principal.user.id and h.status == "pending"
        theirs = (
            await db.scalar(
                select(FileHandoff.id).where(
                    and_(FileHandoff.id == h.id, rules.incoming_where(principal))
                )
            )
        ) is not None
        ok = mine_waiting or theirs
    f = await rules.file_of(db, h) if ok and h is not None else None
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "handoff_not_found", "That upload is not here.")
    if f.quarantined and not rules.everywhere(principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "held_back",
            "This file is held back for review. A manager can open it.",
        )
    from ...documents import storage

    data = await storage.read_id(db, f.id)
    inline = f.mime in INLINE_SAFE
    disp = "inline" if inline else "attachment"
    return Response(
        content=data,
        media_type=f.mime if inline else "application/octet-stream",
        headers={
            "Content-Disposition": f"{disp}; filename*=UTF-8''{quote(f.name)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Cache-Control": "private, no-store",
        },
    )
