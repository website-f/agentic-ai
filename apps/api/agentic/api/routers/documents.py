"""Document Studio (P10): company kits, templates, and documents (draft → review → approved).

A document is source markdown (placeholders intact) plus field values; the preview, the
checks and the PDF / Word / Excel exports are all rendered from that one source. Every save
keeps the previous version. Approved documents are locked until someone reopens them.
"""

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...documents import docx_template, service
from ...documents.fill import KIT_FIELDS, KIT_KEYS, clean_fields, detect_fields
from ...engine import gateway
from ...models import (
    Agent,
    Branch,
    CompanyKit,
    DocFile,
    DocTemplate,
    Document,
    DocumentVersion,
)
from ...services import audit, events
from .. import paging
from ..deps import Principal, api_error, require
from .files import check_branch, check_task, get_file

router = APIRouter(prefix="/api", tags=["documents"])


def _no_model(e: gateway.GatewayUnavailable) -> Exception:
    return api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e))


# ================================================================ company kits


class KitOut(BaseModel):
    branch_id: str
    branch_name: str
    data: dict[str, Any]
    logo_file_id: str | None
    fields: list[dict[str, str]]
    filled: int
    total: int
    can_edit: bool
    updated_at: datetime | None


def _kit_editable(principal: Principal, branch_id: str) -> bool:
    if can(principal.role, "org.manage"):
        return True
    sc = principal.scope
    return principal.role == "branch_manager" and sc.branch_id == branch_id


def _kit_out(b: Branch, kit: CompanyKit | None, principal: Principal) -> KitOut:
    data = dict(kit.data or {}) if kit else {}
    keys = [
        f["key"] for f in KIT_FIELDS if f["key"] not in ("accent", "footer_note", "trading_name")
    ]
    return KitOut(
        branch_id=b.id,
        branch_name=b.name,
        data=data,
        logo_file_id=kit.logo_file_id if kit else None,
        fields=KIT_FIELDS,
        filled=sum(1 for k in keys if str(data.get(k) or "").strip()),
        total=len(keys),
        can_edit=_kit_editable(principal, b.id),
        updated_at=kit.updated_at if kit else None,
    )


async def _branch(db: AsyncSession, principal: Principal, branch_id: str) -> Branch:
    b = await db.get(Branch, branch_id)
    sc = principal.scope
    if (
        b is None
        or b.workspace_id != principal.workspace_id
        or (sc.kind == "branch" and sc.branch_id != b.id)
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    return b


@router.get("/company-kits")
async def list_kits(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[KitOut]:
    q = select(Branch).where(Branch.workspace_id == principal.workspace_id).order_by(Branch.name)
    if principal.scope.kind == "branch" and principal.scope.branch_id:
        q = q.where(Branch.id == principal.scope.branch_id)
    out = []
    for b in (await db.scalars(q)).all():
        out.append(_kit_out(b, await db.get(CompanyKit, b.id), principal))
    return out


@router.get("/company-kits/{branch_id}")
async def read_kit(
    branch_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> KitOut:
    b = await _branch(db, principal, branch_id)
    return _kit_out(b, await db.get(CompanyKit, b.id), principal)


class KitIn(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)
    logo_file_id: str | None = None


def _clean_kit(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in KIT_KEYS:
        v = raw.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        if k == "tax_rate":
            try:
                out[k] = max(0.0, min(100.0, float(v)))
            except (TypeError, ValueError):
                continue
        elif k == "accent":
            if re.fullmatch(r"#[0-9a-fA-F]{6}", str(v).strip()):
                out[k] = str(v).strip()
        else:
            out[k] = str(v).strip()[:1500]
    custom = []
    for c in (raw.get("custom") or [])[:30]:
        if not isinstance(c, dict):
            continue
        key = re.sub(r"[^\w]", "_", str(c.get("key") or c.get("label") or "").strip().lower())[:40]
        if key and key not in KIT_KEYS:
            custom.append(
                {
                    "key": key,
                    "label": str(c.get("label") or key)[:80],
                    "value": str(c.get("value") or "")[:1000],
                }
            )
    if custom:
        out["custom"] = custom
    return out


@router.put("/company-kits/{branch_id}")
async def save_kit(
    branch_id: str,
    body: KitIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> KitOut:
    b = await _branch(db, principal, branch_id)
    if not _kit_editable(principal, b.id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only admins or this company's manager can change its kit.",
        )
    if body.logo_file_id:
        f = await get_file(db, principal, body.logo_file_id)
        if not f.mime.startswith("image/"):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_logo", "The logo must be an image.")
    kit = await db.get(CompanyKit, b.id)
    if kit is None:
        kit = CompanyKit(branch_id=b.id, workspace_id=principal.workspace_id)
        db.add(kit)
    kit.data = _clean_kit(body.data)
    kit.logo_file_id = body.logo_file_id
    kit.updated_by = principal.actor
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "company_kit.updated",
        target=b.id,
        after={"fields": len(kit.data)},
    )
    await db.commit()
    await db.refresh(kit)
    return _kit_out(b, kit, principal)


# ================================================================ templates


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="custom", max_length=40)
    description: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=60_000)
    fields: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    prefix: str = Field(default="", max_length=12, pattern=r"^[A-Za-z0-9]*$")
    branch_id: str | None = None


class TemplateOut(BaseModel):
    id: str
    name: str
    kind: str
    description: str
    body: str
    fields: list[dict[str, Any]]
    prefix: str
    builtin: bool
    branch_id: str | None
    docx_file_id: str | None
    docx_name: str | None
    used: int


async def _tpl_out(db: AsyncSession, t: DocTemplate) -> TemplateOut:
    name = None
    if t.docx_file_id:
        name = await db.scalar(select(DocFile.name).where(DocFile.id == t.docx_file_id))
    used = len(
        (await db.scalars(select(Document.id).where(Document.template_id == t.id).limit(999))).all()
    )
    return TemplateOut(
        id=t.id,
        name=t.name,
        kind=t.kind,
        description=t.description,
        body=t.body,
        fields=t.fields or [],
        prefix=t.prefix,
        builtin=t.builtin,
        branch_id=t.branch_id,
        docx_file_id=t.docx_file_id,
        docx_name=name,
        used=used,
    )


async def _tpl(db: AsyncSession, principal: Principal, template_id: str) -> DocTemplate:
    t = await db.get(DocTemplate, template_id)
    if t is None or t.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "template_not_found", "That template is not here."
        )
    return t


async def _name_free(db: AsyncSession, ws: str, name: str, exclude: str = "") -> None:
    found = await db.scalar(
        select(DocTemplate.id).where(DocTemplate.workspace_id == ws, DocTemplate.name == name)
    )
    if found and found != exclude:
        raise api_error(status.HTTP_409_CONFLICT, "name_taken", "A template with that name exists.")


@router.get("/doc-templates")
async def list_templates(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[TemplateOut]:
    await service.ensure_starters(db, principal.workspace_id)
    q = select(DocTemplate).where(DocTemplate.workspace_id == principal.workspace_id)
    sc = principal.scope
    if sc.kind == "branch" and sc.branch_id:
        q = q.where(or_(DocTemplate.branch_id.is_(None), DocTemplate.branch_id == sc.branch_id))
    rows = (await db.scalars(q.order_by(DocTemplate.builtin.desc(), DocTemplate.name))).all()
    return [await _tpl_out(db, t) for t in rows]


def _fields_for(body: TemplateIn) -> list[dict[str, Any]]:
    given = clean_fields(body.fields)
    # Every placeholder in the body gets a field; defined ones keep their settings.
    return clean_fields(
        detect_fields(body.body, given) + [f for f in given if f["key"] not in body.body]
    )


@router.post("/doc-templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    body: TemplateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TemplateOut:
    await _name_free(db, principal.workspace_id, body.name.strip())
    await check_branch(db, principal, body.branch_id)
    t = DocTemplate(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        name=body.name.strip(),
        kind=body.kind.strip() or "custom",
        description=body.description,
        body=body.body,
        fields=_fields_for(body),
        prefix=body.prefix.upper(),
        builtin=False,
        created_by=principal.actor,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return await _tpl_out(db, t)


@router.patch("/doc-templates/{template_id}")
async def update_template(
    template_id: str,
    body: TemplateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TemplateOut:
    t = await _tpl(db, principal, template_id)
    await _name_free(db, principal.workspace_id, body.name.strip(), t.id)
    t.name = body.name.strip()
    t.kind = body.kind.strip() or "custom"
    t.description = body.description
    if not t.docx_file_id:
        t.body = body.body
        t.fields = _fields_for(body)
    else:
        t.fields = clean_fields(body.fields) or t.fields
    t.prefix = body.prefix.upper()
    await db.commit()
    await db.refresh(t)
    return await _tpl_out(db, t)


@router.delete("/doc-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    t = await _tpl(db, principal, template_id)
    await db.delete(t)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class DetectIn(BaseModel):
    body: str = Field(default="", max_length=60_000)
    fields: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/doc-templates/detect")
async def detect(body: DetectIn, _: Principal = Depends(require("read"))) -> list[dict[str, Any]]:
    return clean_fields(detect_fields(body.body, clean_fields(body.fields)))


class FromDocxIn(BaseModel):
    file_id: str
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="custom", max_length=40)
    prefix: str = Field(default="", max_length=12, pattern=r"^[A-Za-z0-9]*$")
    branch_id: str | None = None


@router.post("/doc-templates/from-docx", status_code=status.HTTP_201_CREATED)
async def template_from_docx(
    body: FromDocxIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TemplateOut:
    """Your own Word file as a template: its {{placeholders}} become the fields."""
    f = await get_file(db, principal, body.file_id)
    if "wordprocessingml" not in f.mime:
        raise api_error(status.HTTP_400_BAD_REQUEST, "not_docx", "Upload a Word (.docx) file.")
    data = await db.scalar(select(DocFile.data).where(DocFile.id == f.id))
    try:
        keys = docx_template.scan(bytes(data or b""))
    except Exception as e:  # noqa: BLE001 - a broken file is reported
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_docx", "That Word file could not be opened."
        ) from e
    if not keys:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "no_placeholders",
            "No {{placeholders}} found. Type them into the Word file where values go, "
            "e.g. {{client_name}}, then upload it again.",
        )
    await _name_free(db, principal.workspace_id, body.name.strip())
    await check_branch(db, principal, body.branch_id)
    t = DocTemplate(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        name=body.name.strip(),
        kind=body.kind or "custom",
        description=f"From {f.name}",
        body="",
        fields=clean_fields(detect_fields(" ".join("{{" + k + "}}" for k in keys))),
        docx_file_id=f.id,
        prefix=body.prefix.upper(),
        builtin=False,
        created_by=principal.actor,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return await _tpl_out(db, t)


# ================================================================ documents


class DocOut(BaseModel):
    id: str
    title: str
    kind: str
    number: str
    status: str
    version: int
    branch_id: str | None
    branch_name: str | None
    template_id: str | None
    template_name: str | None
    task_id: str | None
    agent_id: str | None
    agent_name: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    approved_by: str | None
    approved_at: datetime | None
    errors: int
    warnings: int


class DocDetailOut(DocOut):
    body: str
    values: dict[str, Any]
    fields: list[dict[str, Any]]
    word_template: bool
    preview: str
    checks: list[dict[str, str]]
    missing: list[str]
    totals: dict[str, float] | None


async def _get(db: AsyncSession, principal: Principal, doc_id: str) -> Document:
    d = await db.scalar(
        service.scoped(
            select(Document).where(
                Document.id == doc_id, Document.workspace_id == principal.workspace_id
            ),
            Document,
            principal,
        )
    )
    if d is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "document_not_found", "That document is not here."
        )
    return d


async def _base(db: AsyncSession, d: Document, found: list[dict[str, str]]) -> dict[str, Any]:
    b = await db.get(Branch, d.branch_id) if d.branch_id else None
    t = await db.get(DocTemplate, d.template_id) if d.template_id else None
    a = await db.get(Agent, d.agent_id) if d.agent_id else None
    return {
        "id": d.id,
        "title": d.title,
        "kind": d.kind,
        "number": d.number,
        "status": d.status,
        "version": d.version,
        "branch_id": d.branch_id,
        "branch_name": b.name if b else None,
        "template_id": d.template_id,
        "template_name": t.name if t else None,
        "task_id": d.task_id,
        "agent_id": d.agent_id,
        "agent_name": a.name if a else None,
        "created_by": d.created_by,
        "created_at": d.created_at,
        "updated_at": d.updated_at,
        "approved_by": d.approved_by,
        "approved_at": d.approved_at,
        "errors": sum(1 for c in found if c["level"] == "error"),
        "warnings": sum(1 for c in found if c["level"] == "warn"),
    }


async def doc_detail(db: AsyncSession, d: Document) -> DocDetailOut:
    r = await service.render(db, d)
    return DocDetailOut(
        **await _base(db, d, r.checks),
        body=d.body,
        values=d.values or {},
        fields=r.fields,
        word_template=bool(r.template and r.template.docx_file_id and not d.body.strip()),
        preview=r.preview,
        checks=r.checks,
        missing=r.filled.missing,
        totals=r.filled.totals,
    )


DOC_ORDER: paging.Order = ((Document.updated_at, True), (Document.id, True))
FIX_SCAN = 300  # documents checked per call when looking for the ones that fail a check


def _doc_query(
    principal: Principal,
    status_: str | None,
    branch_id: str | None,
    task_id: str | None,
    q: str,
) -> Any:
    query = select(Document).where(Document.workspace_id == principal.workspace_id)
    if status_:
        query = query.where(Document.status == status_)
    if branch_id:
        query = query.where(Document.branch_id == branch_id)
    if task_id:
        query = query.where(Document.task_id == task_id)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(or_(Document.title.ilike(like), Document.number.ilike(like)))
    return service.scoped(query, Document, principal)


async def _failing(
    db: AsyncSession, query: Any, cursor: str | None, want: int
) -> tuple[list[DocOut], str | None]:
    """Documents that fail a check, in list order, from after `cursor`. Checks are computed,
    not stored, so this walks the list rendering each one: at most FIX_SCAN per call. Returns
    the matches and where to resume (None once the list is exhausted)."""
    out: list[DocOut] = []
    scanned = 0
    while len(out) < want and scanned < FIX_SCAN:
        batch_q = query
        if cursor:
            batch_q = batch_q.where(paging.after(DOC_ORDER, paging.decode(cursor, 2)))
        batch = list((await db.scalars(batch_q.order_by(*paging.sort(DOC_ORDER)).limit(50))).all())
        if not batch:
            return out, None
        for d in batch:
            scanned += 1
            cursor = paging.cursor_for(d, DOC_ORDER)
            r = await service.render(db, d)
            base = await _base(db, d, r.checks)
            if base["errors"]:
                out.append(DocOut(**base))
            if len(out) >= want or scanned >= FIX_SCAN:
                return out, cursor
        if len(batch) < 50:
            return out, None
    return out, cursor


@router.get("/documents")
async def list_documents(
    response: Response,
    status_: str | None = Query(default=None, alias="status", pattern="^(draft|review|approved)$"),
    branch_id: str | None = None,
    task_id: str | None = None,
    q: str = Query(default="", max_length=120),
    fix: bool = False,
    limit: int = Query(default=300, ge=1, le=300),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[DocOut]:
    """Most recently changed first. Pages with `limit` + `cursor` (X-Next-Cursor,
    X-Total-Count); filters and search apply to every page. `fix` keeps only documents that
    fail a check (pages can be short; follow X-Next-Cursor until it stops)."""
    query = _doc_query(principal, status_, branch_id, task_id, q)
    if fix:
        found, nxt = await _failing(db, query, cursor, limit)
        if nxt:
            response.headers[paging.NEXT] = nxt
        return found
    rows = await paging.paginate(
        db, query, DOC_ORDER, limit=limit, cursor=cursor, response=response
    )
    out = []
    for d in rows:
        r = await service.render(db, d)
        out.append(DocOut(**await _base(db, d, r.checks)))
    return out


@router.get("/documents/stats")
async def document_stats(
    branch_id: str | None = None,
    q: str = Query(default="", max_length=120),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Counts behind the Documents tiles and tabs for the same company and search as the
    list. `fix` counts failing documents among the latest FIX_SCAN (`fix_complete` says
    whether that covered them all)."""
    query = _doc_query(principal, None, branch_id, None, q)
    grouped = query.with_only_columns(Document.status, func.count()).group_by(Document.status)
    rows: list[Any] = list((await db.execute(grouped)).all())
    by_status: dict[str, int] = {r[0]: int(r[1]) for r in rows}
    found, more = await _failing(db, query, None, FIX_SCAN)
    return {
        "total": sum(by_status.values()),
        "draft": by_status.get("draft", 0),
        "review": by_status.get("review", 0),
        "approved": by_status.get("approved", 0),
        "fix": len(found),
        "fix_complete": more is None,
    }


class DocIn(BaseModel):
    title: str = Field(default="", max_length=200)
    template_id: str | None = None
    branch_id: str | None = None
    task_id: str | None = None
    values: dict[str, Any] = Field(default_factory=dict)
    body: str | None = Field(default=None, max_length=100_000)


@router.post("/documents", status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DocIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    tpl = await _tpl(db, principal, body.template_id) if body.template_id else None
    await check_branch(db, principal, body.branch_id)
    await check_task(db, principal, body.task_id)
    d = await service.create_document(
        db,
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        template=tpl,
        title=body.title,
        values=body.values,
        body=body.body,
        created_by=principal.actor,
        task_id=body.task_id,
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "document.created",
        target=d.id,
        after={"title": d.title, "template": d.template_id},
    )
    await db.commit()
    await db.refresh(d)
    return await doc_detail(db, d)


@router.get("/documents/{doc_id}")
async def read_document(
    doc_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    return await doc_detail(db, await _get(db, principal, doc_id))


class DocUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=100_000)
    values: dict[str, Any] | None = None
    note: str = Field(default="", max_length=300)


def _locked(d: Document) -> None:
    if d.status == "approved":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "document_locked",
            "This document is approved. Reopen it to change it.",
        )


@router.patch("/documents/{doc_id}")
async def update_document(
    doc_id: str,
    body: DocUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    d = await _get(db, principal, doc_id)
    _locked(d)
    changed = (
        (body.title is not None and body.title != d.title)
        or (body.body is not None and body.body != d.body)
        or (body.values is not None and body.values != (d.values or {}))
    )
    if changed:
        await service.snapshot(db, d, principal.actor, body.note or "edited")
        if body.title is not None:
            d.title = body.title.strip()
        if body.body is not None:
            d.body = body.body
        if body.values is not None:
            d.values = body.values
        d.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(d)
        await events.publish(
            principal.workspace_id,
            "document.updated",
            {"document_id": d.id, "agent_id": d.agent_id},
        )
    return await doc_detail(db, d)


class PreviewIn(BaseModel):
    body: str | None = Field(default=None, max_length=100_000)
    values: dict[str, Any] | None = None


@router.post("/documents/{doc_id}/preview")
async def preview_document(
    doc_id: str,
    body: PreviewIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    """The preview and checks for unsaved edits (nothing is stored)."""
    d = await _get(db, principal, doc_id)
    with db.no_autoflush:  # the edits live only in memory, never reach the database
        if body.body is not None:
            d.body = body.body
        if body.values is not None:
            d.values = body.values
        out = await doc_detail(db, d)
    await db.rollback()
    return out


class StatusIn(BaseModel):
    status: str = Field(pattern="^(draft|review|approved)$")


@router.post("/documents/{doc_id}/status")
async def set_status(
    doc_id: str,
    body: StatusIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    d = await _get(db, principal, doc_id)
    if body.status == "approved":
        if not can(principal.role, "approvals.decide"):
            raise api_error(
                status.HTTP_403_FORBIDDEN, "forbidden", "Your role cannot approve documents."
            )
        r = await service.render(db, d)
        errors = [c["text"] for c in r.checks if c["level"] == "error"]
        if errors:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "checks_failed",
                "Fix these first: {problems}",
                problems=" ".join(errors[:3]),
            )
        d.approved_by, d.approved_at = principal.actor, datetime.now(UTC)
    elif d.status == "approved":
        d.approved_by, d.approved_at = None, None
    before = d.status
    d.status = body.status
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "document.status",
        target=d.id,
        before={"status": before},
        after={"status": d.status},
    )
    await db.commit()
    await db.refresh(d)
    await events.publish(
        principal.workspace_id, "document.updated", {"document_id": d.id, "agent_id": d.agent_id}
    )
    return await doc_detail(db, d)


@router.get("/documents/{doc_id}/export")
async def export_document(
    doc_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|docx|xlsx)$"),  # noqa: A002 - API name
    inline: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    d = await _get(db, principal, doc_id)
    data, name, mime = await service.export(db, d, format)
    disposition = "inline" if inline and format == "pdf" else "attachment"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )


class VersionOut(BaseModel):
    version: int
    title: str
    note: str
    author: str
    created_at: datetime


@router.get("/documents/{doc_id}/versions")
async def versions(
    doc_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[VersionOut]:
    d = await _get(db, principal, doc_id)
    rows = (
        await db.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == d.id)
            .order_by(DocumentVersion.version.desc())
        )
    ).all()
    return [
        VersionOut(
            version=v.version, title=v.title, note=v.note, author=v.author, created_at=v.created_at
        )
        for v in rows
    ]


class RestoreIn(BaseModel):
    version: int


@router.post("/documents/{doc_id}/restore")
async def restore(
    doc_id: str,
    body: RestoreIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> DocDetailOut:
    d = await _get(db, principal, doc_id)
    _locked(d)
    v = await db.scalar(
        select(DocumentVersion).where(
            DocumentVersion.document_id == d.id, DocumentVersion.version == body.version
        )
    )
    if v is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "version_not_found", "That version is not kept.")
    await service.snapshot(db, d, principal.actor, f"before restoring version {v.version}")
    d.title, d.body, d.values = v.title, v.body, v.values
    await db.commit()
    await db.refresh(d)
    return await doc_detail(db, d)


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    d = await _get(db, principal, doc_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "document.deleted",
        target=d.id,
        before={"title": d.title},
    )
    await db.delete(d)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- AI help (people)


class RewriteIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    instruction: str = Field(min_length=2, max_length=500)


class TextOut(BaseModel):
    text: str


@router.post("/documents/{doc_id}/rewrite")
async def rewrite(
    doc_id: str,
    body: RewriteIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TextOut:
    """Rewrite a selected passage (shorten, more formal, translate...). Nothing is saved:
    the editor shows it and the person accepts or discards it."""
    await _get(db, principal, doc_id)
    try:
        text = await service.ai_rewrite(db, principal.workspace_id, body.text, body.instruction)
    except gateway.GatewayUnavailable as e:
        raise _no_model(e) from e
    if not text:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, "empty_reply", "The model gave no text. Try again."
        )
    return TextOut(text=text)


async def _reference(db: AsyncSession, principal: Principal, file_ids: list[str]) -> str:
    parts = []
    for fid in file_ids[:5]:
        f = await get_file(db, principal, fid)
        text = await db.scalar(select(DocFile.text).where(DocFile.id == f.id)) or ""
        parts.append(f"## {f.name}\n{text[:6000]}")
    return "\n\n".join(parts)


class AiFillIn(BaseModel):
    request: str = Field(min_length=3, max_length=6000)
    file_ids: list[str] = Field(default_factory=list, max_length=5)


class ValuesOut(BaseModel):
    values: dict[str, Any]


@router.post("/documents/{doc_id}/ai-fill")
async def ai_fill(
    doc_id: str,
    body: AiFillIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> ValuesOut:
    """Fill the fields from a plain-language request (and files). Returned, not saved."""
    d = await _get(db, principal, doc_id)
    r = await service.render(db, d)
    if not r.fields:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "no_fields", "This document has no fields to fill."
        )
    ref = await _reference(db, principal, body.file_ids)
    try:
        values = await service.ai_fill(
            db, principal.workspace_id, r.fields, body.request, r.kit, ref
        )
    except gateway.GatewayUnavailable as e:
        raise _no_model(e) from e
    return ValuesOut(values=values)


class AiWriteIn(BaseModel):
    request: str = Field(min_length=3, max_length=6000)
    branch_id: str | None = None
    file_ids: list[str] = Field(default_factory=list, max_length=5)


@router.post("/documents/ai-write")
async def ai_write(
    body: AiWriteIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TextOut:
    """Write a whole document from a request, for a new free-form document."""
    await check_branch(db, principal, body.branch_id)
    kit = await service.kit_data(db, body.branch_id)
    ref = await _reference(db, principal, body.file_ids)
    try:
        text = await service.ai_write(db, principal.workspace_id, body.request, kit, ref)
    except gateway.GatewayUnavailable as e:
        raise _no_model(e) from e
    return TextOut(text=text)


class IssuesOut(BaseModel):
    issues: list[dict[str, str]]


@router.post("/documents/{doc_id}/review")
async def ai_review(
    doc_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> IssuesOut:
    d = await _get(db, principal, doc_id)
    r = await service.render(db, d)
    try:
        issues = await service.ai_review(db, principal.workspace_id, r.filled.markdown, r.kit)
    except gateway.GatewayUnavailable as e:
        raise _no_model(e) from e
    return IssuesOut(issues=issues)
