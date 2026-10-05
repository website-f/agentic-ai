"""Submission packs (P10): a checklist of what a submission needs, matched to the company's
files and documents, compiled into one PDF people review and submit themselves."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import runtime
from ...core.db import get_db
from ...documents import packs as pack_svc
from ...documents import service
from ...engine import gateway
from ...models import Branch, DocFile, Document, Pack, Task
from ...services import audit, events
from ..deps import Principal, api_error, require
from .files import check_branch, check_task
from .tasks import _assignee, start

router = APIRouter(prefix="/api/packs", tags=["packs"])


class PackItemOut(BaseModel):
    id: str
    label: str
    hint: str
    required: bool
    status: str
    note: str
    auto: bool
    file_id: str | None
    file_name: str | None
    document_id: str | None
    document_title: str | None
    expired: bool


class PackOut(BaseModel):
    id: str
    title: str
    description: str
    status: str
    branch_id: str | None
    branch_name: str | None
    task_id: str | None
    items: list[PackItemOut]
    progress: dict[str, int]
    compiled_file_id: str | None
    compiled_at: datetime | None
    created_by: str
    created_at: datetime
    updated_at: datetime


async def pack_out(db: AsyncSession, p: Pack) -> PackOut:
    b = await db.get(Branch, p.branch_id) if p.branch_id else None
    today = service.today_in(None)
    items = []
    for it in p.items or []:
        f = await db.get(DocFile, it["file_id"]) if it.get("file_id") else None
        d = await db.get(Document, it["document_id"]) if it.get("document_id") else None
        items.append(
            PackItemOut(
                id=it["id"],
                label=it["label"],
                hint=it.get("hint", ""),
                required=it.get("required", True),
                status=it.get("status", "missing"),
                note=it.get("note", ""),
                auto=it.get("auto", False),
                file_id=it.get("file_id"),
                file_name=f.name if f else None,
                document_id=it.get("document_id"),
                document_title=d.title if d else None,
                expired=bool(f and f.expires_on and f.expires_on < today),
            )
        )
    return PackOut(
        id=p.id,
        title=p.title,
        description=p.description,
        status=p.status,
        branch_id=p.branch_id,
        branch_name=b.name if b else None,
        task_id=p.task_id,
        items=items,
        progress=pack_svc.progress(p.items or []),
        compiled_file_id=p.compiled_file_id,
        compiled_at=p.compiled_at,
        created_by=p.created_by,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


async def get_pack(db: AsyncSession, principal: Principal, pack_id: str) -> Pack:
    p = await db.scalar(
        service.scoped(
            select(Pack).where(Pack.id == pack_id, Pack.workspace_id == principal.workspace_id),
            Pack,
            principal,
        )
    )
    if p is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "pack_not_found", "That pack is not here.")
    return p


async def _check_refs(db: AsyncSession, principal: Principal, items: list[dict[str, Any]]) -> None:
    for it in items:
        if it.get("file_id"):
            f = await db.get(DocFile, it["file_id"])
            if f is None or f.workspace_id != principal.workspace_id:
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "bad_file",
                    "{label}: that file is not here.",
                    label=it["label"],
                )
        if it.get("document_id"):
            d = await db.get(Document, it["document_id"])
            if d is None or d.workspace_id != principal.workspace_id:
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "bad_document",
                    "{label}: that document is not here.",
                    label=it["label"],
                )


@router.get("")
async def list_packs(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[PackOut]:
    rows = (
        await db.scalars(
            service.scoped(
                select(Pack).where(Pack.workspace_id == principal.workspace_id), Pack, principal
            ).order_by(Pack.updated_at.desc())
        )
    ).all()
    return [await pack_out(db, p) for p in rows]


class PackIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    branch_id: str | None = None
    task_id: str | None = None
    items: list[dict[str, Any]] = Field(default_factory=list, max_length=60)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_pack(
    body: PackIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> PackOut:
    await check_branch(db, principal, body.branch_id)
    await check_task(db, principal, body.task_id)
    items = pack_svc.clean_items(body.items)
    await _check_refs(db, principal, items)
    p = Pack(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        task_id=body.task_id,
        title=body.title.strip(),
        description=body.description,
        items=items,
        status="collecting",
        created_by=principal.actor,
    )
    db.add(p)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "pack.created",
        target=p.id,
        after={"title": p.title},
    )
    await db.commit()
    await db.refresh(p)
    return await pack_out(db, p)


@router.get("/{pack_id}")
async def read_pack(
    pack_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PackOut:
    return await pack_out(db, await get_pack(db, principal, pack_id))


class PackUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    items: list[dict[str, Any]] | None = Field(default=None, max_length=60)


@router.patch("/{pack_id}")
async def update_pack(
    pack_id: str,
    body: PackUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> PackOut:
    p = await get_pack(db, principal, pack_id)
    if body.title is not None:
        p.title = body.title.strip()
    if body.description is not None:
        p.description = body.description
    if body.items is not None:
        items = pack_svc.clean_items(body.items, p.items)
        await _check_refs(db, principal, items)
        p.items = items
        if p.status == "compiled":
            p.status = "collecting"  # the compiled PDF is now out of date
    await db.commit()
    await db.refresh(p)
    return await pack_out(db, p)


@router.delete("/{pack_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pack(
    pack_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    p = await get_pack(db, principal, pack_id)
    await db.delete(p)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class DraftIn(BaseModel):
    description: str = Field(min_length=5, max_length=4000)


class ItemsOut(BaseModel):
    items: list[dict[str, Any]]


@router.post("/draft-checklist")
async def draft_checklist(
    body: DraftIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> ItemsOut:
    """An analyst agent proposes the checklist; the person edits it before saving."""
    try:
        items = await pack_svc.draft_checklist(db, principal.workspace_id, body.description)
    except gateway.GatewayUnavailable as e:
        raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    if not items:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, "empty_draft", "No checklist came back. Try rephrasing."
        )
    return ItemsOut(items=items)


class MatchOut(BaseModel):
    pack: PackOut
    matched: int


@router.post("/{pack_id}/auto-match")
async def auto_match(
    pack_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> MatchOut:
    p = await get_pack(db, principal, pack_id)
    items, matched = await pack_svc.auto_match(db, p)
    p.items = items
    await db.commit()
    await db.refresh(p)
    return MatchOut(pack=await pack_out(db, p), matched=matched)


class CompileOut(BaseModel):
    pack: PackOut
    file_id: str
    pages: int
    skipped: list[str]


@router.post("/{pack_id}/compile")
async def compile_pack(
    pack_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> CompileOut:
    p = await get_pack(db, principal, pack_id)
    try:
        f, skipped = await pack_svc.compile_pack(db, p, principal.actor)
    except ValueError as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "nothing_to_compile", str(e)) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "pack.compiled",
        target=p.id,
        after={"file": f.id, "pages": f.pages, "skipped": len(skipped)},
    )
    await db.commit()
    await db.refresh(p)
    return CompileOut(pack=await pack_out(db, p), file_id=f.id, pages=f.pages, skipped=skipped)


class DelegateIn(BaseModel):
    agent_id: str
    note: str = Field(default="", max_length=2000)


class DelegateOut(BaseModel):
    task_id: str


PACK_BRIEF = (
    "Prepare this submission pack for people to review. For each missing item: look for it in "
    "the company's files (list_files, read_file) and attach it (pack_attach); if it is a "
    "document we write ourselves (cover letter, quotation, company profile...), draft it from a "
    "template with the company kit (list_templates, company_kit, draft_document) and attach "
    "that. Check each draft (check_document) and fix what it finds. When something can only "
    "come from a person (a signed form, a certificate we do not have), ask them (ask_human). "
    "Do not submit anything anywhere: finish with a short summary of what is ready and what "
    "is still missing."
)


@router.post("/{pack_id}/delegate", status_code=status.HTTP_201_CREATED)
async def delegate(
    pack_id: str,
    body: DelegateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> DelegateOut:
    """Give the pack to an agent to prepare (find files, draft documents, ask for the rest)."""
    p = await get_pack(db, principal, pack_id)
    agent = await _assignee(db, principal, body.agent_id)
    assert agent is not None
    brief = PACK_BRIEF + "\n\n" + pack_svc.pack_brief(p)
    if body.note.strip():
        brief += f"\n\nNote from {principal.user.name}: {body.note.strip()}"
    t = Task(
        workspace_id=principal.workspace_id,
        title=f"Prepare pack: {p.title}"[:200],
        brief=brief,
        priority="normal",
        assignee_agent_id=agent.id,
        branch_id=p.branch_id or agent.branch_id,
        requires_review=True,
        labels=["pack"],
        created_by=principal.actor,
        status="ready",
        position=0,
    )
    db.add(t)
    await db.flush()
    p.task_id = t.id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "pack.delegated",
        target=p.id,
        after={"task": t.id, "agent": agent.id},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, "asked to prepare a pack")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": agent.id}
    )
    await start(db, t, principal.actor)
    return DelegateOut(task_id=t.id)
