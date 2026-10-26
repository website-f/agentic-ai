"""P35: money owed to the companies (receivables: our invoices) and by them (payables:
suppliers' bills), payments, payment reminders, and the reports (aging, cash-flow forecast,
summary).

`finance.view` reads, `finance.manage` changes (create, edit drafts, approve, record a
payment, void, send a reminder, capture a bill). Owner and admin for every company, a branch
manager for their own company only (crm/access.py); a row of another company answers 404.
"Overdue" is computed: open (awaiting approval, approved, sent, partly paid) and past its due
date in the workspace's time zone.

Lists take `limit` / `offset` and answer {items, total}.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...crm import access, reminders
from ...crm import service as svc
from ...i18n import tr
from ...models import Branch, DocFile, Document, MoneyDoc, Party, Payment, Task
from ...services import audit
from ..deps import Principal, api_error, ensure_allowance, require

router = APIRouter(prefix="/api", tags=["money"])

MAX_LIMIT = 200
Direction = Literal["receivable", "payable"]
Status = Literal["draft", "awaiting_approval", "approved", "sent", "partially_paid", "paid", "void"]
Method = Literal["bank_transfer", "duitnow", "fpx", "cash", "cheque", "card", "online", "other"]
MAX = Decimal("999999999999")


# ---------------------------------------------------------------- shapes


def _blank_none(v: Any) -> Any:
    return None if isinstance(v, str) and not v.strip() else v


class LineIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    description: str = Field(default="", max_length=500)
    qty: Decimal = Field(default=Decimal(1), ge=0, le=MAX)
    unit_price: Decimal = Field(default=Decimal(0), ge=-MAX, le=MAX)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)
    amount: Decimal | None = Field(default=None, ge=-MAX, le=MAX)


class MoneyFields(BaseModel):
    model_config = ConfigDict(extra="ignore")  # e.g. the web's status: "draft" on create

    number: str | None = Field(default=None, max_length=60)
    reference: str | None = Field(default=None, max_length=120)
    issue_date: date | None = None
    due_date: date | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    lines: list[LineIn] | None = Field(default=None, max_length=200)
    subtotal: Decimal | None = Field(default=None, ge=0, le=MAX)
    tax_total: Decimal | None = Field(default=None, ge=0, le=MAX)
    total: Decimal | None = Field(default=None, ge=0, le=MAX)
    notes: str | None = Field(default=None, max_length=5000)
    document_id: str | None = Field(default=None, max_length=40)
    file_id: str | None = Field(default=None, max_length=40)

    _blank = field_validator(
        "issue_date", "due_date", "subtotal", "tax_total", "total", mode="before"
    )(_blank_none)


class MoneyIn(MoneyFields):
    direction: Direction
    party_id: str = Field(max_length=40)
    branch_id: str | None = Field(default=None, max_length=40)


class MoneyPatch(MoneyFields):
    party_id: str | None = Field(default=None, max_length=40)


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    amount: Decimal = Field(gt=0, le=MAX)
    paid_at: date | None = None
    method: Method = "bank_transfer"

    _blank = field_validator("paid_at", mode="before")(_blank_none)
    reference: str = Field(default="", max_length=120)


class VoidIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=300)


class CaptureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_id: str = Field(max_length=40)
    branch_id: str | None = Field(default=None, max_length=40)


# ---------------------------------------------------------------- output


def _iso(v: date | datetime | None) -> str | None:
    return v.isoformat() if v is not None else None


def doc_out(
    d: MoneyDoc, on: date, *, party_name: str | None = None, branch_name: str | None = None
) -> dict[str, Any]:
    overdue, days = svc.overdue_info(d, on)
    return {
        "id": d.id,
        "branch_id": d.branch_id,
        "branch_name": branch_name,
        "party_id": d.party_id,
        "party_name": party_name,
        "direction": d.direction,
        "number": d.number,
        "reference": d.reference,
        "issue_date": _iso(d.issue_date),
        "due_date": _iso(d.due_date),
        "currency": d.currency,
        "subtotal": svc.fl(d.subtotal),
        "tax_total": svc.fl(d.tax_total),
        "total": svc.fl(d.total),
        "amount_paid": svc.fl(d.amount_paid),
        "outstanding": svc.fl(svc.outstanding(d)) if d.status != "void" else 0.0,
        "status": d.status,
        "overdue": overdue,
        "days_overdue": days,
        "lines": d.lines or [],
        "document_id": d.document_id,
        "file_id": d.file_id,
        "mail_item_id": d.mail_item_id,
        "source": d.source,
        "external": d.external or {},
        "notes": d.notes,
        "approved_by": d.approved_by,
        "approved_at": _iso(d.approved_at),
        "duplicate_of": d.duplicate_of,
        "task_id": d.task_id,
        "reminders": d.reminders or [],
        "created_by": d.created_by,
        "created_at": _iso(d.created_at),
        "updated_at": _iso(d.updated_at),
    }


def payment_out(p: Payment) -> dict[str, Any]:
    return {
        "id": p.id,
        "money_doc_id": p.money_doc_id,
        "amount": svc.fl(p.amount),
        "paid_at": _iso(p.paid_at),
        "method": p.method,
        "reference": p.reference,
        "recorded_by": p.recorded_by,
        "created_at": _iso(p.created_at),
    }


# ---------------------------------------------------------------- helpers


def _crm_error(e: svc.CrmError) -> Exception:
    return api_error(e.status, e.code, e.message)


def _not_found() -> Exception:
    return api_error(
        status.HTTP_404_NOT_FOUND, "money_not_found", "That invoice or bill is not here."
    )


async def _doc(
    db: AsyncSession, principal: Principal, doc_id: str, *, lock: bool = False
) -> MoneyDoc:
    # `lock`: for the endpoints that change money (approve, payment, void, sent, correct),
    # hold a row lock so two concurrent requests cannot both pass the status check and, say,
    # record the payment twice. The status is re-checked by the caller after the lock.
    d = await db.get(MoneyDoc, doc_id, with_for_update=lock, populate_existing=lock)
    if d is None or d.workspace_id != principal.workspace_id:
        raise _not_found()
    if not access.finance_sees(principal, d.branch_id):
        raise _not_found()
    return d


async def _branch(db: AsyncSession, principal: Principal, branch_id: str | None) -> str:
    """The company a new money doc is for: the one given (if this person handles its money),
    else their own, else the only one."""
    if branch_id is None:
        if principal.scope.branch_id and not principal.scope.everything:
            branch_id = principal.scope.branch_id
        else:
            ids = (
                await db.scalars(
                    select(Branch.id).where(Branch.workspace_id == principal.workspace_id).limit(2)
                )
            ).all()
            if len(ids) != 1:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "branch_required",
                    "Pick the company this is for.",
                )
            branch_id = ids[0]
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    if not access.finance_sees(principal, branch_id):
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    return branch_id


def _filter_branch(principal: Principal, branch_id: str | None) -> Any:
    cond = access.finance_where(principal)
    if branch_id:
        if not access.finance_sees(principal, branch_id):
            raise api_error(
                status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here."
            )
        cond = cond & (MoneyDoc.branch_id == branch_id)
    return cond


async def _party_for(
    db: AsyncSession, principal: Principal, party_id: str, branch_id: str
) -> Party:
    p = await db.get(Party, party_id)
    if not access.sees_party(principal, p):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "party_not_found", "That customer or supplier is not here."
        )
    assert p is not None
    if p.branch_id and p.branch_id != branch_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "wrong_company",
            "That customer belongs to another company.",
        )
    return p


async def _links_ok(db: AsyncSession, principal: Principal, body: MoneyFields) -> None:
    if body.file_id:
        f = await db.get(DocFile, body.file_id)
        if f is None or f.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    if body.document_id:
        d = await db.get(Document, body.document_id)
        if d is None or d.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "document_not_found", "That document is not here."
            )


def _lines(body: MoneyFields) -> list[dict[str, Any]] | None:
    if body.lines is None:
        return None
    return svc.clean_lines([line.model_dump() for line in body.lines])


async def detail(db: AsyncSession, principal: Principal, d: MoneyDoc) -> dict[str, Any]:
    await db.refresh(d)
    on = await svc.today(db, principal.workspace_id)
    party = await db.get(Party, d.party_id)
    branch = await db.get(Branch, d.branch_id)
    out = doc_out(
        d, on, party_name=party.name if party else None, branch_name=branch.name if branch else None
    )
    pays = (
        await db.scalars(
            select(Payment)
            .where(Payment.money_doc_id == d.id)
            .order_by(Payment.paid_at, Payment.created_at)
        )
    ).all()
    out["payments"] = [payment_out(p) for p in pays]
    out["party"] = (
        {"id": party.id, "name": party.name, "email": party.email, "tin": party.tin}
        if party
        else None
    )
    f = await db.get(DocFile, d.file_id) if d.file_id else None
    out["file"] = {"id": f.id, "name": f.name, "mime": f.mime} if f else None
    doc = await db.get(Document, d.document_id) if d.document_id else None
    out["document"] = {"id": doc.id, "title": doc.title} if doc else None
    dup = await db.get(MoneyDoc, d.duplicate_of) if d.duplicate_of else None
    out["duplicate"] = (
        {"id": dup.id, "number": dup.number, "total": svc.fl(dup.total), "status": dup.status,
         "issue_date": _iso(dup.issue_date)}
        if dup is not None and access.finance_sees(principal, dup.branch_id)
        else None
    )  # fmt: skip
    t = await db.get(Task, d.task_id) if d.task_id else None
    out["task"] = {"id": t.id, "title": t.title, "status": t.status} if t else None
    return out


async def _lang(db: AsyncSession, d: MoneyDoc) -> str:
    return await svc.company_lang(db, d.workspace_id, d.branch_id)


# ---------------------------------------------------------------- lists and reports


@router.get("/money")
async def list_money(
    direction: Direction | None = None,
    status_: Status | None = Query(default=None, alias="status"),
    branch_id: str | None = Query(default=None, max_length=40),
    party_id: str | None = Query(default=None, max_length=40),
    overdue: bool | None = None,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require("finance.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    on = await svc.today(db, principal.workspace_id)
    base = (
        select(MoneyDoc, Party.name, Branch.name)
        .join(Party, Party.id == MoneyDoc.party_id)
        .join(Branch, Branch.id == MoneyDoc.branch_id)
        .where(
            MoneyDoc.workspace_id == principal.workspace_id, _filter_branch(principal, branch_id)
        )
    )
    if direction:
        base = base.where(MoneyDoc.direction == direction)
    if status_:
        base = base.where(MoneyDoc.status == status_)
    if party_id:
        base = base.where(MoneyDoc.party_id == party_id)
    late = MoneyDoc.status.in_(svc.OPEN) & (MoneyDoc.due_date < on)
    if overdue is True:
        base = base.where(late)
    elif overdue is False:
        base = base.where(~late | MoneyDoc.due_date.is_(None))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        base = base.where(
            or_(
                func.lower(MoneyDoc.number).like(like),
                func.lower(MoneyDoc.reference).like(like),
                func.lower(Party.name).like(like),
            )
        )
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = (
        await db.execute(
            base.order_by(MoneyDoc.issue_date.desc(), MoneyDoc.created_at.desc(), MoneyDoc.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {
        "items": [doc_out(d, on, party_name=pn, branch_name=bn) for d, pn, bn in rows],
        "total": total,
    }


@router.get("/money/aging")
async def aging(
    direction: Direction = "receivable",
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("finance.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """What is still owed by how late it is: current (not yet due), 1-30, 31-60, 61-90 and
    over 90 days past due; amounts and counts."""
    on = await svc.today(db, principal.workspace_id)
    out = await svc.aging(
        db, principal.workspace_id, direction, _filter_branch(principal, branch_id), on
    )
    return {**out["buckets"], **out}  # each bucket at the top too: {current: {...}, ...}


@router.get("/money/forecast")
async def forecast(
    days: int = Query(default=30, ge=7, le=365),
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("finance.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Money expected in (receivables) and out (payables) per week from due dates (30, 60 or
    90 days; others are rounded to one of them)."""
    days = 30 if days <= 30 else 60 if days <= 60 else 90
    on = await svc.today(db, principal.workspace_id)
    out = await svc.forecast(
        db, principal.workspace_id, _filter_branch(principal, branch_id), on, days
    )
    out["items"] = [{**w, "week_start": w["start"]} for w in out["weeks"]]
    return out


@router.get("/money/summary")
async def summary(
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("finance.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    on = await svc.today(db, principal.workspace_id)
    return await svc.summary(db, principal.workspace_id, _filter_branch(principal, branch_id), on)


# ---------------------------------------------------------------- create, capture, edit


@router.post("/money", status_code=status.HTTP_201_CREATED)
async def create_money(
    body: MoneyIn,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A draft invoice (receivable) or bill (payable). Totals follow from the lines unless
    given. Our invoices are numbered INV-00001... when no number is given."""
    branch_id = await _branch(db, principal, body.branch_id)
    party = await _party_for(db, principal, body.party_id, branch_id)
    await _links_ok(db, principal, body)
    on = await svc.today(db, principal.workspace_id)
    lines = _lines(body) or []
    sub, tax, total = svc.totals(lines, body.subtotal, body.tax_total, body.total)
    issue = body.issue_date or on
    number = (body.number or "").strip()
    if not number and body.direction == "receivable":
        number = await svc.next_number(db, principal.workspace_id, branch_id)
    d = MoneyDoc(
        workspace_id=principal.workspace_id,
        branch_id=branch_id,
        party_id=party.id,
        direction=body.direction,
        number=number,
        reference=(body.reference or "").strip(),
        issue_date=issue,
        due_date=body.due_date or svc.add_days(issue, party.payment_terms_days),
        currency=body.currency or party.currency or "MYR",
        subtotal=sub,
        tax_total=tax,
        total=total,
        amount_paid=Decimal(0),
        status="draft",
        lines=lines,
        document_id=body.document_id,
        file_id=body.file_id,
        source="document" if body.document_id else "manual",
        external={},
        reminders=[],
        notes=body.notes or "",
        created_by=principal.actor,
    )
    db.add(d)
    await db.flush()
    if d.direction == "payable":
        dup = await svc.find_duplicate(db, d)
        d.duplicate_of = dup.id if dup else None
    lang = await _lang(db, d)
    await svc.log(
        db,
        principal.workspace_id,
        party.id,
        "invoice",
        tr(
            "Invoice {number} drafted: {amount}"
            if d.direction == "receivable"
            else "Bill {number} recorded: {amount}",
            lang,
            number=d.number or "-",
            amount=svc.amount_text(d.currency, d.total),
        ),
        principal.actor,
        money_doc_id=d.id,
        document_id=d.document_id,
    )
    await db.commit()
    return await detail(db, principal, d)


@router.post("/money/capture", status_code=status.HTTP_201_CREATED)
async def capture_bill(
    body: CaptureIn,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A supplier bill read from a file in the office files (a PDF or a picture): saved as
    awaiting approval, with the supplier matched or added and a duplicate check."""
    await ensure_allowance(db, principal)  # P51: AI work counts against the daily allowance
    from ...crm import capture
    from ...documents import service as doc_service

    f = await db.scalar(
        doc_service.visible_files(
            select(DocFile).where(
                DocFile.id == body.file_id, DocFile.workspace_id == principal.workspace_id
            ),
            principal,
        )
    )
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    if f.quarantined:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "file_held_back",
            "This file is held back for review, so it cannot be read.",
        )
    if not capture.capturable(f):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_a_bill_file",
            "Bills are read from a PDF or a picture.",
        )
    branch_id = await _branch(db, principal, body.branch_id or f.branch_id)
    try:
        d = await capture.capture(db, f=f, branch_id=branch_id, actor=principal.actor)
    except capture.CaptureFailed as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "capture_failed", e.message) from e
    return await detail(db, principal, d)


@router.post("/money/receipts", status_code=status.HTTP_201_CREATED)
async def upload_receipt(
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    branch_id: str | None = Query(default=None, max_length=40),
    paid_by: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """P43: drop a receipt or bill (a photo or PDF) straight onto the Money page. It is kept in
    the company's "Bills and receipts" folder and read at once. `paid_by`: a member who paid
    it from their own money (an expense claim), so finance knows to pay them back."""
    await ensure_allowance(db, principal)  # P51: AI work counts against the daily allowance
    from ...crm import capture
    from ...documents import provenance
    from ...documents import service as doc_service
    from ...models import Membership, User
    from .files import start_reading

    branch = await _branch(db, principal, branch_id)
    payer: User | None = None
    if paid_by:
        member = await db.scalar(
            select(Membership).where(
                Membership.workspace_id == principal.workspace_id, Membership.user_id == paid_by
            )
        )
        payer = await db.get(User, paid_by) if member is not None else None
        if payer is None:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "member_not_found", "That person is not here."
            )
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > doc_service.MAX_FILE_BYTES:
            raise api_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "file_too_large",
                "Files can be up to {mb} MB.",
                mb=doc_service.MAX_FILE_BYTES // (1024 * 1024),
            )
    if not data:
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    lang = await provenance.folder_lang(db, principal.workspace_id, branch)
    f = await doc_service.create_file(
        db,
        workspace_id=principal.workspace_id,
        name=name,
        data=bytes(data),
        created_by=principal.actor,
        mime=request.headers.get("x-file-type", "")[:120],
        branch_id=branch,
        folder="Bil dan resit" if lang == "ms" else "Bills and receipts",
    )
    if not capture.capturable(f):
        await db.rollback()
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_a_bill_file",
            "Bills are read from a PDF or a picture.",
        )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.uploaded",
        target=f.id,
        after={"name": f.name, "size": f.size, "as": "receipt"},
    )
    await db.commit()
    file_id = f.id
    await start_reading(file_id)
    f = await db.get(DocFile, file_id)
    if f is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    await db.refresh(f)
    try:
        d = await capture.capture(
            db, f=f, branch_id=branch, actor=principal.actor, paid_by=payer, source="upload"
        )
    except capture.CaptureFailed as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "capture_failed",
            e.message,
        ) from e
    return await detail(db, principal, d)


@router.get("/money/{doc_id}")
async def get_money(
    doc_id: str,
    principal: Principal = Depends(require("finance.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await detail(db, principal, await _doc(db, principal, doc_id))


@router.patch("/money/{doc_id}")
async def update_money(
    doc_id: str,
    body: MoneyPatch,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Only a draft or a bill awaiting approval changes; after that, void it and start again."""
    d = await _doc(db, principal, doc_id, lock=True)
    if d.status not in svc.EDITABLE:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_editable",
            "Only drafts and bills waiting for approval can be changed.",
        )
    data = body.model_dump(exclude_unset=True)
    if body.party_id and body.party_id != d.party_id:
        d.party_id = (await _party_for(db, principal, body.party_id, d.branch_id)).id
    await _links_ok(db, principal, body)
    for k in ("number", "reference", "issue_date", "due_date", "currency", "notes",
              "document_id", "file_id"):  # fmt: skip
        if k in data and (data[k] is not None or k in ("due_date", "document_id", "file_id")):
            setattr(d, k, data[k].strip() if isinstance(data[k], str) else data[k])
    lines = _lines(body)
    if lines is not None or any(k in data for k in ("subtotal", "tax_total", "total")):
        use = lines if lines is not None else (d.lines or [])
        if lines is not None and not any(k in data for k in ("subtotal", "tax_total", "total")):
            sub, tax, total = svc.totals(use)
        else:
            sub, tax, total = svc.totals(use, body.subtotal, body.tax_total, body.total)
        d.lines, d.subtotal, d.tax_total, d.total = use, sub, tax, total
    if d.direction == "payable":
        dup = await svc.find_duplicate(db, d)
        d.duplicate_of = dup.id if dup else None
    await db.commit()
    return await detail(db, principal, d)


# ---------------------------------------------------------------- decisions (people only)


@router.post("/money/{doc_id}/approve")
async def approve(
    doc_id: str,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A person approves a bill (or finalises an invoice draft). Never an agent."""
    d = await _doc(db, principal, doc_id, lock=True)
    if d.status not in svc.EDITABLE:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_pending",
            "This was already {status}.",
            status=svc.status_label(d.status),
        )
    if svc.q2(d.total) <= 0:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "no_total", "Set the amount before approving."
        )
    await svc.approve(db, d, actor=principal.actor, by_name=principal.user.name)
    await db.commit()
    return await detail(db, principal, d)


@router.post("/money/{doc_id}/sent")
async def mark_sent(
    doc_id: str,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """An invoice went out to the customer. A draft is finalised by the same step (the person
    marking it sent is the one who approves it); totals must be set."""
    d = await _doc(db, principal, doc_id, lock=True)
    if d.direction != "receivable" or d.status not in ("draft", "approved"):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_sendable",
            "Only an approved invoice can be marked as sent.",
        )
    if svc.q2(d.total) <= 0:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "no_total", "Set the amount before approving."
        )
    if d.status == "draft":
        d.approved_by, d.approved_at = principal.actor, svc.now()
    d.status = "sent"
    await db.commit()
    return await detail(db, principal, d)


@router.post("/money/{doc_id}/payments", status_code=status.HTTP_201_CREATED)
async def record_payment(
    doc_id: str,
    body: PaymentIn,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _doc(db, principal, doc_id, lock=True)
    on = await svc.today(db, principal.workspace_id)
    try:
        p = await svc.add_payment(
            db,
            d,
            amount=body.amount,
            paid_at=body.paid_at or on,
            method=body.method,
            reference=body.reference,
            actor=principal.actor,
        )
    except svc.CrmError as e:
        raise _crm_error(e) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "money.payment",
        target=d.id,
        after={"amount": str(p.amount), "method": p.method, "status": d.status},
    )
    await db.commit()
    return await detail(db, principal, d)


@router.post("/money/{doc_id}/void")
async def void(
    doc_id: str,
    body: VoidIn,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _doc(db, principal, doc_id, lock=True)
    if d.status in ("paid", "void"):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_voidable",
            "This was already {status}.",
            status=svc.status_label(d.status),
        )
    before = d.status
    d.status = "void"
    reason = " ".join(body.reason.split())
    d.notes = (f"{d.notes}\n" if d.notes else "") + f"Void: {reason}"
    lang = await _lang(db, d)
    await svc.close_task(db, d, "cancelled", tr("Voided: {reason}", lang, reason=reason))
    await svc.log(
        db,
        principal.workspace_id,
        d.party_id,
        "invoice",
        tr("{number} voided: {reason}", lang, number=d.number or d.id, reason=reason),
        principal.actor,
        money_doc_id=d.id,
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "money.voided",
        target=d.id,
        before={"status": before},
        after={"reason": reason[:300]},
    )
    await db.commit()
    return await detail(db, principal, d)


@router.post("/money/{doc_id}/remind")
async def remind(
    doc_id: str,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A payment-reminder email DRAFT for a person to approve: in the company's shared
    Outlook mailbox when it has one, else the caller's own Outlook, else their Gmail; else
    the text comes back to copy. Nothing is sent here."""
    d = await _doc(db, principal, doc_id)
    if d.direction != "receivable" or d.status not in svc.PAYABLE_NOW:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_remindable",
            "Reminders are for approved invoices that are not paid yet.",
        )
    try:
        out = await reminders.draft(
            db, d, step="manual", actor=principal.actor, person_id=principal.user.id
        )
    except svc.CrmError as e:
        raise _crm_error(e) from e
    d = await _doc(db, principal, doc_id)
    text = None if out["draft_id"] else out["subject"] + "\n\n" + out["body"]
    return {**out, "text": text, "money": await detail(db, principal, d)}


# ---------------------------------------------------------------- reminder settings


async def _reminder_branch(db: AsyncSession, principal: Principal, branch_id: str) -> Branch:
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    if not access.finance_sees(principal, b.id):
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")
    return b


@router.get("/branches/{branch_id}/reminders")
async def get_reminders(
    branch_id: str,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    b = await _reminder_branch(db, principal, branch_id)
    mailbox = await reminders.company_mailbox(db, b.id)
    return {
        **reminders.policy_of(b),
        "branch_id": b.id,
        "mailbox": mailbox.address if mailbox else None,
    }


@router.put("/branches/{branch_id}/reminders")
async def put_reminders(
    branch_id: str,
    body: reminders.ReminderPolicy,
    principal: Principal = Depends(require("finance.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Reminder days are relative to the due date: -3 is three days before, 7 a week late."""
    b = await _reminder_branch(db, principal, branch_id)
    before = reminders.policy_of(b)
    b.reminder_policy = body.model_dump()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "money.reminders_set",
        target=b.id,
        before=before,
        after=b.reminder_policy,
    )
    await db.commit()
    mailbox = await reminders.company_mailbox(db, b.id)
    return {
        **reminders.policy_of(b),
        "branch_id": b.id,
        "mailbox": mailbox.address if mailbox else None,
    }
