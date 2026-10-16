"""P35: customers and suppliers (parties), their contacts and timeline, importing them from a
sheet, finding duplicates, and the sales pipeline (deals).

Who sees what: crm/access.py. Everyone with `read` sees the shared parties and (office
roles) their own company's, workspace roles every company's; `work.write` in that company
creates and changes them; archiving needs `agents.manage` or `org.manage`. Money (balances,
invoices and payments on the timeline) only reaches people with `finance.view`, and a branch
manager only their own company's.

Lists take `limit` / `offset` and answer {items, total}.
"""

import re
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...crm import access
from ...crm import service as svc
from ...engine import privacy
from ...i18n import Msg, tr
from ...models import (
    Branch,
    Deal,
    Document,
    Interaction,
    Membership,
    MoneyDoc,
    Party,
    PartyContact,
    Task,
)
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["crm"])

IMPORT_PATH = "/api/parties/import"
MAX_LIMIT = 200
EMAIL_RX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

Role = Literal["customer", "supplier", "partner", "lead"]
Stage = Literal["lead", "qualified", "proposal", "negotiation", "won", "lost"]


# ---------------------------------------------------------------- shapes


def _email(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip().lower()
    if v and not EMAIL_RX.match(v):
        raise ValueError(Msg("Not a valid email address"))
    return v


def _blank_none(v: Any) -> Any:
    """An empty string from a form is "not given"."""
    return None if isinstance(v, str) and not v.strip() else v


def _tags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    out: list[str] = []
    for t in v:
        t = " ".join(str(t).split())[:40]
        if t and t not in out:
            out.append(t)
    return out


class AddressIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lines: list[str] = Field(default_factory=list, max_length=6)
    city: str = Field(default="", max_length=80)
    postcode: str = Field(default="", max_length=20)
    state: str = Field(default="", max_length=80)
    country: str = Field(default="", max_length=80)

    @field_validator("lines")
    @classmethod
    def _lines(cls, v: list[str]) -> list[str]:
        return [" ".join(x.split())[:200] for x in v if x.strip()]


class ContactIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=200)
    title: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=60)
    is_primary: bool = False
    notes: str = Field(default="", max_length=2000)

    _check_email = field_validator("email")(_email)


class ContactPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    title: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=60)
    is_primary: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)

    _check_email = field_validator("email")(_email)


class PartyFields(BaseModel):
    model_config = ConfigDict(extra="ignore")

    legal_name: str | None = Field(default=None, max_length=200)
    reg_no: str | None = Field(default=None, max_length=60)
    tin: str | None = Field(default=None, max_length=40)
    sst_no: str | None = Field(default=None, max_length=40)
    industry: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=60)
    website: str | None = Field(default=None, max_length=200)
    address: AddressIn | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    credit_limit: Decimal | None = Field(default=None, ge=0, le=Decimal("999999999999"))
    tags: list[str] | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=5000)
    owner_user_id: str | None = Field(default=None, max_length=40)
    external: dict[str, Any] | None = None

    _check_email = field_validator("email")(_email)
    _check_tags = field_validator("tags")(_tags)
    _blanks = field_validator(
        "currency", "owner_user_id", "payment_terms_days", "credit_limit", mode="before"
    )(_blank_none)


class PartyIn(PartyFields):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["company", "person"] = "company"
    roles: list[Role] = Field(default_factory=lambda: ["customer"], max_length=4)
    branch_id: str | None = Field(default=None, max_length=40)
    contacts: list[ContactIn] = Field(default_factory=list, max_length=20)
    contact: ContactIn | None = None  # one contact, the web form's way

    _blank_branch = field_validator("branch_id", mode="before")(_blank_none)

    @field_validator("contact", mode="before")
    @classmethod
    def _no_empty_contact(cls, v: Any) -> Any:
        return None if isinstance(v, dict) and not str(v.get("name") or "").strip() else v


class PartyPatch(PartyFields):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: Literal["company", "person"] | None = None
    roles: list[Role] | None = Field(default=None, max_length=4)
    branch_id: str | None = Field(default=None, max_length=40)
    move_to_shared: bool = False  # branch_id None means "unchanged"; this makes it shared

    _blank_branch = field_validator("branch_id", mode="before")(_blank_none)


class ArchiveIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    restore: bool = False


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=5000)


# ---------------------------------------------------------------- output


def _iso(v: Any) -> str | None:
    return v.isoformat() if v is not None else None


def contact_out(c: PartyContact) -> dict[str, Any]:
    return {
        "id": c.id,
        "party_id": c.party_id,
        "name": c.name,
        "title": c.title,
        "email": c.email,
        "phone": c.phone,
        "is_primary": c.is_primary,
        "notes": c.notes,
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


def party_out(
    p: Party,
    *,
    branch_name: str | None = None,
    primary: PartyContact | None = None,
    balances: dict[str, float] | None = None,
) -> dict[str, Any]:
    return {
        "id": p.id,
        "branch_id": p.branch_id,
        "branch_name": branch_name,
        "kind": p.kind,
        "roles": list(p.roles or []),
        "name": p.name,
        "legal_name": p.legal_name,
        "reg_no": p.reg_no,
        "tin": p.tin,
        "sst_no": p.sst_no,
        "industry": p.industry,
        "email": p.email,
        "phone": p.phone,
        "website": p.website,
        "address": p.address or {},
        "currency": p.currency,
        "payment_terms_days": p.payment_terms_days,
        "credit_limit": float(p.credit_limit) if p.credit_limit is not None else None,
        "tags": list(p.tags or []),
        "notes": p.notes,
        "owner_user_id": p.owner_user_id,
        "status": p.status,
        "source": p.source,
        "external": p.external or {},
        "created_by": p.created_by,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
        "primary_contact": contact_out(primary) if primary is not None else None,
        "balances": balances,
    }


def deal_out(d: Deal, party_name: str | None = None) -> dict[str, Any]:
    return {
        "id": d.id,
        "branch_id": d.branch_id,
        "party_id": d.party_id,
        "party_name": party_name,
        "title": d.title,
        "value": svc.fl(d.value),
        "currency": d.currency,
        "stage": d.stage,
        "probability": d.probability,
        "weighted_value": svc.fl(svc.q2(d.value) * d.probability / 100),
        "expected_close": _iso(d.expected_close),
        "owner_user_id": d.owner_user_id,
        "agent_id": d.agent_id,
        "source": d.source,
        "next_step": d.next_step,
        "next_step_due": _iso(d.next_step_due),
        "lost_reason": d.lost_reason,
        "position": d.position,
        "closed_at": _iso(d.closed_at),
        "created_by": d.created_by,
        "created_at": _iso(d.created_at),
        "updated_at": _iso(d.updated_at),
    }


# ---------------------------------------------------------------- helpers


def _crm_error(e: svc.CrmError) -> Exception:
    return api_error(e.status, e.code, e.message)


def _not_found() -> Exception:
    return api_error(
        status.HTTP_404_NOT_FOUND, "party_not_found", "That customer or supplier is not here."
    )


def _forbidden() -> Exception:
    return api_error(
        status.HTTP_403_FORBIDDEN, "forbidden", "You cannot change this company's customers."
    )


async def _party(db: AsyncSession, principal: Principal, party_id: str) -> Party:
    p = await db.get(Party, party_id)
    if not access.sees_party(principal, p):
        raise _not_found()
    assert p is not None
    return p


async def _branch_ok(db: AsyncSession, principal: Principal, branch_id: str | None) -> None:
    if branch_id is None:
        return
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here.")


async def _member_ok(db: AsyncSession, principal: Principal, user_id: str | None) -> None:
    if user_id and await db.get(Membership, (principal.workspace_id, user_id)) is None:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "not_a_member", "That person is not a member."
        )


async def _branch_names(db: AsyncSession, workspace_id: str) -> dict[str, str]:
    rows = (
        await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == workspace_id))
    ).all()
    return {r[0]: r[1] for r in rows}


async def _primaries(db: AsyncSession, ids: list[str]) -> dict[str, PartyContact]:
    if not ids:
        return {}
    out: dict[str, PartyContact] = {}
    for c in (
        await db.scalars(
            select(PartyContact)
            .where(PartyContact.party_id.in_(ids))
            .order_by(PartyContact.is_primary.desc(), PartyContact.created_at)
        )
    ).all():
        out.setdefault(c.party_id, c)
    return out


def _apply(p: Party, body: PartyFields) -> None:
    data = body.model_dump(exclude_unset=True)
    for k in ("legal_name", "reg_no", "tin", "sst_no", "industry", "email", "phone", "website",
              "currency", "payment_terms_days", "notes", "owner_user_id", "external"):  # fmt: skip
        if k in data and data[k] is not None:
            v = data[k]
            setattr(p, k, " ".join(v.split()) if isinstance(v, str) and k != "notes" else v)
    if "address" in data and body.address is not None:
        p.address = body.address.model_dump()
    if "credit_limit" in data:
        p.credit_limit = body.credit_limit
    if body.tags is not None:
        p.tags = body.tags


async def _possible_duplicates(db: AsyncSession, p: Party) -> list[dict[str, str]]:
    """Other parties that look like this one (shown when it is added)."""
    conds = [Party.name_key == p.name_key] if p.name_key else []
    for col, v in ((Party.tin, p.tin), (Party.reg_no, p.reg_no)):
        if len(svc.norm_id(v)) >= 4:
            conds.append(
                func.upper(func.regexp_replace(col, "[^A-Za-z0-9]", "", "g")) == svc.norm_id(v)
            )
    if p.email:
        conds.append(func.lower(Party.email) == p.email.lower())
    if not conds:
        return []
    rows = (
        await db.scalars(
            select(Party)
            .where(Party.workspace_id == p.workspace_id, Party.id != p.id, or_(*conds))
            .limit(10)
        )
    ).all()
    return [{"id": r.id, "name": r.name} for r in rows]


def _changed(principal: Principal) -> None:
    privacy.invalidate(principal.workspace_id)  # names, emails, ids are masked at once


# ---------------------------------------------------------------- parties


@router.get("/parties")
async def list_parties(
    q: str | None = Query(default=None, max_length=200),
    role: Role | None = None,
    branch_id: str | None = Query(default=None, max_length=40),
    tag: str | None = Query(default=None, max_length=40),
    status_: Literal["active", "archived", "all"] = Query(default="active", alias="status"),
    kind: Literal["company", "person"] | None = None,
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Customers and suppliers this person sees, with the primary contact and (for finance
    people) what is open: receivable_open, payable_open, overdue. `branch_id=shared` lists
    the ones shared by every company."""
    base = select(Party).where(
        Party.workspace_id == principal.workspace_id, access.party_where(principal)
    )
    if status_ != "all":
        base = base.where(Party.status == status_)
    if role:
        base = base.where(Party.roles.contains([role]))
    if kind:
        base = base.where(Party.kind == kind)
    if tag:
        base = base.where(Party.tags.contains([tag]))
    if branch_id == "shared":
        base = base.where(Party.branch_id.is_(None))
    elif branch_id:
        base = base.where(Party.branch_id == branch_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        in_contacts = select(PartyContact.party_id).where(
            PartyContact.workspace_id == principal.workspace_id,
            or_(
                func.lower(PartyContact.name).like(like), func.lower(PartyContact.email).like(like)
            ),
        )
        base = base.where(
            or_(
                func.lower(Party.name).like(like),
                func.lower(Party.legal_name).like(like),
                func.lower(Party.email).like(like),
                func.lower(Party.reg_no).like(like),
                func.lower(Party.tin).like(like),
                Party.id.in_(in_contacts),
            )
        )
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = (
        await db.scalars(
            base.order_by(func.lower(Party.name), Party.id).offset(offset).limit(limit)
        )
    ).all()
    ids = [p.id for p in rows]
    primaries = await _primaries(db, ids)
    names = await _branch_names(db, principal.workspace_id)
    bal: dict[str, dict[str, float]] = {}
    if access.has_finance(principal):
        on = await svc.today(db, principal.workspace_id)
        bal = await svc.balances(
            db, principal.workspace_id, ids, access.finance_where(principal), on
        )
    return {
        "items": [
            party_out(
                p,
                branch_name=names.get(p.branch_id or ""),
                primary=primaries.get(p.id),
                balances=bal.get(p.id) if access.has_finance(principal) else None,
            )
            for p in rows
        ],
        "total": total,
    }


@router.post("/parties", status_code=status.HTTP_201_CREATED)
async def create_party(
    body: PartyIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not access.may_write(principal, body.branch_id):
        raise _forbidden()
    await _branch_ok(db, principal, body.branch_id)
    await _member_ok(db, principal, body.owner_user_id)
    p = Party(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        kind=body.kind,
        roles=list(dict.fromkeys(body.roles)),
        name=" ".join(body.name.split()),
        name_key=svc.name_key(body.name),
        source="manual",
        created_by=principal.actor,
        address={},
        tags=[],
        external={},
        owner_user_id=principal.user.id,
    )
    _apply(p, body)
    db.add(p)
    await db.flush()
    contacts = [*body.contacts, *([body.contact] if body.contact is not None else [])]
    for i, c in enumerate(contacts):
        db.add(
            PartyContact(
                workspace_id=principal.workspace_id,
                party_id=p.id,
                **{
                    **c.model_dump(),
                    "is_primary": c.is_primary or i == 0,
                },
            )
        )
    dups = await _possible_duplicates(db, p)
    await db.commit()
    _changed(principal)
    out = await party_detail(p.id, principal, db)
    out["possible_duplicates"] = dups
    return out


@router.get("/parties/duplicates")
async def duplicates(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Groups of parties that look like the same one: the same tax id, registration number,
    email or normalised name."""
    rows = (
        await db.scalars(
            select(Party)
            .where(
                Party.workspace_id == principal.workspace_id,
                Party.status == "active",
                access.party_where(principal),
            )
            .order_by(Party.created_at)
            .limit(5000)
        )
    ).all()
    groups: dict[tuple[str, str], list[Party]] = {}
    for p in rows:
        keys = [
            ("tin", svc.norm_id(p.tin)),
            ("reg_no", svc.norm_id(p.reg_no)),
            ("email", (p.email or "").strip().lower()),
            ("name", p.name_key),
        ]
        for reason, value in keys:
            if value and (reason not in ("tin", "reg_no") or len(value) >= 4):
                groups.setdefault((reason, value), []).append(p)
    seen: set[frozenset[str]] = set()
    items = []
    names = await _branch_names(db, principal.workspace_id)
    for (reason, value), ps in groups.items():
        ids = frozenset(p.id for p in ps)
        if len(ids) < 2 or ids in seen:
            continue
        seen.add(ids)
        items.append(
            {
                "reason": reason,
                "value": value,
                "parties": [party_out(p, branch_name=names.get(p.branch_id or "")) for p in ps],
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/parties/{party_id}")
async def get_party(
    party_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await party_detail(party_id, principal, db)


async def party_detail(party_id: str, principal: Principal, db: AsyncSession) -> dict[str, Any]:
    p = await _party(db, principal, party_id)
    await db.refresh(p)  # server-set times after a change
    contacts = (
        await db.scalars(
            select(PartyContact)
            .where(PartyContact.party_id == p.id)
            .order_by(PartyContact.is_primary.desc(), PartyContact.created_at)
        )
    ).all()
    deals = (
        await db.scalars(
            select(Deal)
            .where(Deal.party_id == p.id, access.party_where(principal, Deal))
            .order_by(Deal.created_at.desc())
            .limit(50)
        )
    ).all()
    names = await _branch_names(db, principal.workspace_id)
    money: dict[str, Any] | None = None
    bal = None
    if access.has_finance(principal):
        from .money import doc_out

        on = await svc.today(db, principal.workspace_id)
        cond = access.finance_where(principal)
        bal = (await svc.balances(db, principal.workspace_id, [p.id], cond, on))[p.id]
        recent = (
            await db.scalars(
                select(MoneyDoc)
                .where(MoneyDoc.party_id == p.id, cond)
                .order_by(MoneyDoc.issue_date.desc(), MoneyDoc.created_at.desc())
                .limit(10)
            )
        ).all()
        money = {**bal, "recent": [doc_out(d, on, party_name=p.name) for d in recent]}
    out = party_out(
        p,
        branch_name=names.get(p.branch_id or ""),
        primary=contacts[0] if contacts else None,
        balances=bal,
    )
    out["contacts"] = [contact_out(c) for c in contacts]
    out["deals"] = [deal_out(d, p.name) for d in deals]
    out["money"] = money
    out["can_edit"] = access.may_write(principal, p.branch_id)
    out["can_archive"] = access.may_archive(principal, p.branch_id)
    return out


@router.patch("/parties/{party_id}")
async def update_party(
    party_id: str,
    body: PartyPatch,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    p = await _party(db, principal, party_id)
    if not access.may_write(principal, p.branch_id):
        raise _forbidden()
    if body.move_to_shared or (body.branch_id and body.branch_id != p.branch_id):
        target = None if body.move_to_shared else body.branch_id
        if not access.may_write(principal, target):
            raise _forbidden()
        await _branch_ok(db, principal, target)
        p.branch_id = target
    await _member_ok(db, principal, body.owner_user_id)
    if body.name is not None:
        p.name = " ".join(body.name.split())
        p.name_key = svc.name_key(p.name)
    if body.kind is not None:
        p.kind = body.kind
    if body.roles is not None:
        p.roles = list(dict.fromkeys(body.roles))
    _apply(p, body)
    await db.commit()
    _changed(principal)
    return await party_detail(p.id, principal, db)


@router.post("/parties/{party_id}/archive")
async def archive_party(
    party_id: str,
    body: ArchiveIn | None = None,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Archive (or with restore: true, bring back) a party. Its history stays."""
    p = await _party(db, principal, party_id)
    if not access.may_archive(principal, p.branch_id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only people who manage agents or the organisation can archive customers.",
        )
    restore = body is not None and body.restore
    p.status = "active" if restore else "archived"
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "party.restored" if restore else "party.archived",
        target=p.id,
        after={"name": p.name},
    )
    await db.commit()
    return await party_detail(p.id, principal, db)


# ---------------------------------------------------------------- contacts


async def _writable_party(db: AsyncSession, principal: Principal, party_id: str) -> Party:
    p = await _party(db, principal, party_id)
    if not access.may_write(principal, p.branch_id):
        raise _forbidden()
    return p


async def _only_primary(db: AsyncSession, c: PartyContact) -> None:
    if not c.is_primary:
        return
    for other in (
        await db.scalars(
            select(PartyContact).where(PartyContact.party_id == c.party_id, PartyContact.id != c.id)
        )
    ).all():
        other.is_primary = False


@router.post("/parties/{party_id}/contacts", status_code=status.HTTP_201_CREATED)
async def add_contact(
    party_id: str,
    body: ContactIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    p = await _writable_party(db, principal, party_id)
    first = await db.scalar(select(PartyContact.id).where(PartyContact.party_id == p.id)) is None
    c = PartyContact(
        workspace_id=principal.workspace_id,
        party_id=p.id,
        **{**body.model_dump(), "is_primary": body.is_primary or first},
    )
    db.add(c)
    await db.flush()
    await _only_primary(db, c)
    await db.commit()
    await db.refresh(c)
    _changed(principal)
    return contact_out(c)


async def _contact(db: AsyncSession, principal: Principal, contact_id: str) -> PartyContact:
    c = await db.get(PartyContact, contact_id)
    if c is None or c.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "contact_not_found", "That contact is not here.")
    await _writable_party(db, principal, c.party_id)
    return c


@router.patch("/party-contacts/{contact_id}")
async def update_contact(
    contact_id: str,
    body: ContactPatch,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    c = await _contact(db, principal, contact_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(c, k, v)
    await _only_primary(db, c)
    await db.commit()
    await db.refresh(c)
    _changed(principal)
    return contact_out(c)


@router.delete("/party-contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> None:
    c = await _contact(db, principal, contact_id)
    await db.delete(c)
    await db.commit()
    _changed(principal)


# ---------------------------------------------------------------- timeline and notes


async def _links(
    db: AsyncSession, principal: Principal, rows: list[Interaction]
) -> dict[tuple[str, str], str]:
    """Titles of what the timeline points at, for the rows this person may open."""
    titles: dict[tuple[str, str], str] = {}
    sc = principal.scope
    task_ids = {r.task_id for r in rows if r.task_id}
    if task_ids:
        for t in (await db.scalars(select(Task).where(Task.id.in_(task_ids)))).all():
            if sc.everything or (sc.branch_id and t.branch_id == sc.branch_id):
                titles[("task", t.id)] = t.title
    deal_ids = {r.deal_id for r in rows if r.deal_id}
    if deal_ids:
        for d in (
            await db.scalars(
                select(Deal).where(Deal.id.in_(deal_ids), access.party_where(principal, Deal))
            )
        ).all():
            titles[("deal", d.id)] = d.title
    doc_ids = {r.document_id for r in rows if r.document_id}
    if doc_ids:
        for d in (await db.scalars(select(Document).where(Document.id.in_(doc_ids)))).all():
            if sc.everything or d.branch_id in (None, sc.branch_id):
                titles[("document", d.id)] = d.title
    money_ids = {r.money_doc_id for r in rows if r.money_doc_id}
    if money_ids and access.has_finance(principal):
        for m in (
            await db.scalars(
                select(MoneyDoc).where(MoneyDoc.id.in_(money_ids), access.finance_where(principal))
            )
        ).all():
            titles[("money", m.id)] = m.number or m.id
    return titles


def interaction_out(r: Interaction, titles: dict[tuple[str, str], str]) -> dict[str, Any]:
    """`links`: the ids it points at (money only when this person may see it); `titles`: what
    those are called, for the ones this person may open."""
    money = r.money_doc_id if ("money", r.money_doc_id or "") in titles else None
    names = {
        kind: titles[(kind, value)]
        for kind, value in (
            ("task", r.task_id),
            ("deal", r.deal_id),
            ("document", r.document_id),
            ("money", r.money_doc_id),
        )
        if value and (kind, value) in titles
    }
    return {
        "id": r.id,
        "party_id": r.party_id,
        "kind": r.kind,
        "summary": r.summary,
        "text": (r.data or {}).get("text") if r.kind == "note" else None,
        "at": _iso(r.at),
        "actor": r.actor,
        "links": {
            "task_id": r.task_id,
            "document_id": r.document_id,
            "money_doc_id": money,
            "deal_id": r.deal_id,
            "mail_item_id": r.mail_item_id,
        },
        "titles": names,
    }


@router.get("/parties/{party_id}/timeline")
async def timeline(
    party_id: str,
    kind: str | None = Query(default=None, max_length=20),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Everything that happened with this party, newest first. Invoices and payments only
    for finance people (and a branch manager only their own company's)."""
    p = await _party(db, principal, party_id)
    q = select(Interaction).where(Interaction.party_id == p.id)
    if kind:
        q = q.where(Interaction.kind == kind)
    if access.has_finance(principal):
        visible_money = select(MoneyDoc.id).where(
            MoneyDoc.party_id == p.id, access.finance_where(principal)
        )
        q = q.where(
            or_(Interaction.money_doc_id.is_(None), Interaction.money_doc_id.in_(visible_money))
        )
    else:
        q = q.where(Interaction.kind.not_in(svc.MONEY_KINDS), Interaction.money_doc_id.is_(None))
    total = int(await db.scalar(select(func.count()).select_from(q.subquery())) or 0)
    rows = list(
        (
            await db.scalars(
                q.order_by(Interaction.at.desc(), Interaction.id.desc()).offset(offset).limit(limit)
            )
        ).all()
    )
    titles = await _links(db, principal, rows)
    return {"items": [interaction_out(r, titles) for r in rows], "total": total}


@router.post("/parties/{party_id}/notes", status_code=status.HTTP_201_CREATED)
async def add_note(
    party_id: str,
    body: NoteIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    p = await _writable_party(db, principal, party_id)
    row = await svc.log(
        db,
        principal.workspace_id,
        p.id,
        "note",
        body.text,
        principal.actor,
        data={"text": body.text},
    )
    await db.commit()
    return interaction_out(row, {})


# ---------------------------------------------------------------- import


FIELDS = (
    "name",
    "legal_name",
    "kind",
    "roles",
    "reg_no",
    "tin",
    "sst_no",
    "industry",
    "email",
    "phone",
    "website",
    "address",
    "city",
    "postcode",
    "state",
    "country",
    "currency",
    "payment_terms_days",
    "credit_limit",
    "tags",
    "notes",
    "contact_name",
    "contact_title",
    "contact_email",
    "contact_phone",
)

# Header words, English and Malay, normalised. Exact wins; else the longest word inside.
HEADERS: dict[str, tuple[str, ...]] = {
    "name": ("name", "company", "company name", "customer", "customer name", "supplier",
             "supplier name", "vendor", "client", "nama", "nama syarikat", "pelanggan",
             "nama pelanggan", "pembekal", "nama pembekal", "party", "account name"),
    "legal_name": ("legal name", "registered name", "nama berdaftar", "nama sah"),
    "kind": ("kind", "entity type", "jenis entiti"),
    "roles": ("type", "role", "category", "jenis", "kategori", "peranan"),
    "reg_no": ("ssm", "ssm no", "reg no", "registration", "registration no", "registration number",
               "company no", "company number", "roc", "no pendaftaran", "no syarikat", "brn"),
    "tin": ("tin", "tin no", "tax id", "tax no", "tax identification number", "no cukai",
            "lhdn", "no tin"),
    "sst_no": ("sst", "sst no", "sst registration", "no sst", "sales tax"),
    "industry": ("industry", "industri", "sector", "sektor"),
    "email": ("email", "e mail", "emel", "e mel", "email address", "alamat emel"),
    "phone": ("phone", "tel", "telephone", "telefon", "no telefon", "mobile", "hp", "h p",
              "office phone"),
    "website": ("website", "web", "url", "laman web", "site"),
    "address": ("address", "alamat", "address 1", "address line", "street"),
    "city": ("city", "bandar", "town"),
    "postcode": ("postcode", "poskod", "zip", "postal code", "zip code"),
    "state": ("state", "negeri"),
    "country": ("country", "negara"),
    "currency": ("currency", "mata wang"),
    "payment_terms_days": ("payment terms", "terms", "credit terms", "terma", "terma bayaran",
                           "days"),
    "credit_limit": ("credit limit", "had kredit"),
    "tags": ("tags", "tag", "label", "labels"),
    "notes": ("notes", "note", "remarks", "nota", "catatan", "ulasan"),
    "contact_name": ("contact", "contact person", "contact name", "pic", "person in charge",
                     "pegawai", "nama pegawai", "attention"),
    "contact_title": ("contact title", "designation", "jawatan", "position"),
    "contact_email": ("contact email", "pic email", "emel pegawai"),
    "contact_phone": ("contact phone", "pic phone", "contact mobile", "telefon pegawai"),
}  # fmt: skip

ROLE_WORDS = {
    "customer": "customer",
    "client": "customer",
    "pelanggan": "customer",
    "buyer": "customer",
    "supplier": "supplier",
    "vendor": "supplier",
    "pembekal": "supplier",
    "partner": "partner",
    "rakan": "partner",
    "rakan kongsi": "partner",
    "lead": "lead",
    "prospect": "lead",
    "bakal pelanggan": "lead",
}


def _norm(value: Any) -> str:
    return " ".join(re.sub(r"[^0-9a-z]+", " ", str(value or "").lower()).split())


def header_field(header: str) -> str | None:
    h = _norm(header)
    if not h:
        return None
    for field, words in HEADERS.items():
        if h in words:
            return field
    padded = f" {h} "
    best: tuple[int, str] | None = None
    for field, words in HEADERS.items():
        for w in words:
            if f" {w} " in padded and (best is None or len(w) > best[0]):
                best = (len(w), field)
    return best[1] if best else None


def _map_row(row: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, cell in enumerate(row):
        f = header_field(cell)
        if f and f not in out:
            out[f] = i
    return out


def _letter(i: int) -> str:
    from openpyxl.utils import get_column_letter

    return get_column_letter(i + 1)


async def _upload(request: Request, name: str | None, max_bytes: int) -> tuple[str, bytes]:
    """The sheet's bytes and name: raw bytes (application/octet-stream, ?name=...) like
    /api/files, or a multipart form with a `file` field (read with the standard library)."""
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > max_bytes + 64 * 1024:
            raise api_error(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "file_too_large",
                "Files can be up to {mb} MB.",
                mb=max_bytes // (1024 * 1024),
            )
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        from email.parser import BytesParser
        from email.policy import HTTP

        msg = BytesParser(policy=HTTP).parsebytes(
            f"Content-Type: {ctype}\r\n\r\n".encode("latin-1") + bytes(data)
        )
        for part in msg.iter_parts() if msg.is_multipart() else []:
            if part.get_param("name", header="content-disposition") != "file":
                continue
            payload = part.get_payload(decode=True)
            raw = payload if isinstance(payload, bytes) else b""
            return (part.get_filename() or name or "sheet.csv")[:200], raw
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    return (name or "sheet.csv")[:200], bytes(data)


def _column_names(head: list[str], width: int) -> list[str]:
    """One unique name per column: its header, else "Column B"."""
    out: list[str] = []
    for i in range(width):
        h = " ".join((head[i] if i < len(head) else "").split())[:80]
        label = h or tr("Column {letter}", letter=_letter(i))
        if label in out:
            label = f"{label} ({_letter(i)})"
        out.append(label)
    return out


@router.post("/parties/import")
async def import_preview(
    request: Request,
    name: str | None = Query(default=None, max_length=200),
    principal: Principal = Depends(require("work.write")),
) -> dict[str, Any]:
    """An Excel (.xlsx) or CSV sheet (raw bytes with ?name=, or a multipart form's `file`):
    its rows by column name and the mapping we suggest ({column: field or null}; English and
    Malay headers). Nothing is saved; the person checks the mapping and sends it back to
    /api/parties/import/commit."""
    from .member_import import HEADER_SCAN, MAX_BYTES, _read_rows

    name, data = await _upload(request, name, MAX_BYTES)
    if not data:
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
    if len(data) > MAX_BYTES:
        raise api_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "file_too_large",
            "Files can be up to {mb} MB.",
            mb=MAX_BYTES // (1024 * 1024),
        )
    sheet, rows = _read_rows(data, name)
    header, found = -1, {}
    for i, row in enumerate(rows[:HEADER_SCAN]):
        m = _map_row(row)
        if "name" in m and len(m) > len(found):
            header, found = i, m
    if header < 0 and rows:
        header = 0  # no header we know: the first row, mapped by hand
    head = rows[header] if 0 <= header < len(rows) else []
    body_rows = [r for r in rows[header + 1 :] if any(c.strip() for c in r)]
    width = max((len(r) for r in [head, *body_rows]), default=0)
    names = _column_names(head, width)
    by_index = {i: f for f, i in found.items()}
    return {
        "file_name": name,
        "sheet": sheet,
        "header_row": header + 1,
        "columns": names,
        "mapping": {names[i]: by_index.get(i) for i in range(width)},
        "column_info": [
            {
                "name": names[i],
                "letter": _letter(i),
                "header": head[i] if i < len(head) else "",
                "sample": next((r[i] for r in body_rows[:20] if i < len(r) and r[i].strip()), ""),
            }
            for i in range(width)
        ],
        "fields": list(FIELDS),
        "rows": [{names[i]: (r[i] if i < len(r) else "") for i in range(width)} for r in body_rows],
        "count": len(body_rows),
    }


class ImportCommitIn(BaseModel):
    """`rows` as objects ({column: value}, from the preview) with `mapping` {column: field or
    null}; or as lists with `mapping` {field: column index}."""

    model_config = ConfigDict(extra="ignore")

    mapping: dict[str, Any]
    rows: list[dict[str, Any] | list[Any]] = Field(min_length=1, max_length=1000)
    branch_id: str | None = Field(default=None, max_length=40)
    roles: list[Role] = Field(default_factory=lambda: ["customer"], max_length=4)
    kind: Literal["company", "person"] = "company"
    update_existing: bool = True

    def getter(self) -> Any:
        """get(row, field) -> the cell's text ("" when not mapped)."""
        if self.rows and isinstance(self.rows[0], dict):
            column = {f: c for c, f in self.mapping.items() if isinstance(f, str) and f}
            bad = [f for f in column if f not in FIELDS]
            if bad:
                raise ValueError(Msg("Unknown columns: {names}", names=", ".join(bad[:5])))

            def by_name(row: Any, field: str) -> str:
                c = column.get(field)
                v = row.get(c) if isinstance(row, dict) and c is not None else None
                return " ".join(str(v).split()) if v is not None else ""

            return by_name, set(column)
        index = {f: i for f, i in self.mapping.items() if isinstance(i, int) and 0 <= i <= 200}
        bad = [f for f in index if f not in FIELDS]
        if bad:
            raise ValueError(Msg("Unknown columns: {names}", names=", ".join(bad[:5])))

        def by_index(row: Any, field: str) -> str:
            i = index.get(field)
            if not isinstance(row, list) or i is None or i >= len(row) or row[i] is None:
                return ""
            return " ".join(str(row[i]).split())

        return by_index, set(index)


def _roles_of(text: str) -> list[str]:
    out = []
    for part in re.split(r"[,/;&]| and | dan ", (text or "").lower()):
        r = ROLE_WORDS.get(_norm(part))
        if r and r not in out:
            out.append(r)
    return out


@router.post("/parties/import/commit")
async def import_commit(
    body: ImportCommitIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add the rows (or fill in parties that exist already, matched by tax id, registration
    number, email or name). Rows without a name are skipped."""
    if not access.may_write(principal, body.branch_id):
        raise _forbidden()
    await _branch_ok(db, principal, body.branch_id)
    try:
        cell, mapped = body.getter()
    except ValueError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_mapping", e.args[0]) from e
    if "name" not in mapped:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_mapping",
            "Pick the column that holds the name.",
        )
    created = updated = skipped = 0
    errors: list[dict[str, Any]] = []
    for n, row in enumerate(body.rows, 1):

        def get(field: str, row: Any = row) -> str:
            return cell(row, field)

        name = get("name")[:200]
        if not name:
            skipped += 1
            errors.append({"row": n, "message": tr("Name is missing.")})
            continue
        email = get("email").lower()[:254]
        if email and not EMAIL_RX.match(email):
            errors.append(
                {"row": n, "message": tr("{email} is not a valid email address.", email=email)}
            )
            email = ""
        values: dict[str, Any] = {
            "legal_name": get("legal_name")[:200],
            "reg_no": get("reg_no")[:60],
            "tin": get("tin")[:40],
            "sst_no": get("sst_no")[:40],
            "industry": get("industry")[:80],
            "email": email,
            "phone": get("phone")[:60],
            "website": get("website")[:200],
            "notes": get("notes")[:5000],
        }
        cur = get("currency").upper()
        if re.fullmatch(r"[A-Z]{3}", cur):
            values["currency"] = cur
        terms = re.search(r"\d{1,3}", get("payment_terms_days"))
        if terms:
            values["payment_terms_days"] = min(int(terms.group(0)), 365)
        limit_v = svc.money(get("credit_limit"))
        if limit_v is not None and limit_v >= 0:
            values["credit_limit"] = svc.q2(limit_v)
        address = {
            "lines": [x.strip() for x in re.split(r"[\n;]", get("address")) if x.strip()][:6],
            "city": get("city")[:80],
            "postcode": get("postcode")[:20],
            "state": get("state")[:80],
            "country": get("country")[:80],
        }
        kind_text = _norm(get("kind"))
        kind = (
            "person"
            if kind_text in ("person", "individual", "individu", "orang")
            else "company"
            if kind_text
            else body.kind
        )
        roles = list(dict.fromkeys([*body.roles, *_roles_of(get("roles"))]))
        tags = [t for t in (_tags(re.split(r"[,;]", get("tags"))) or []) if t]
        try:
            async with db.begin_nested():
                p = await svc.match_party(
                    db,
                    principal.workspace_id,
                    body.branch_id,
                    tin=values["tin"],
                    reg_no=values["reg_no"],
                    email=email,
                    name=name,
                )
                if p is not None:
                    if not body.update_existing:
                        skipped += 1
                        continue
                    for k, v in values.items():
                        if v not in ("", None):
                            setattr(p, k, v)
                    if any(address.values()):
                        p.address = address
                    p.roles = [str(r) for r in dict.fromkeys([*(p.roles or []), *roles])]
                    p.tags = [str(x) for x in dict.fromkeys([*(p.tags or []), *tags])]
                    updated += 1
                else:
                    p = Party(
                        workspace_id=principal.workspace_id,
                        branch_id=body.branch_id,
                        kind=kind,
                        roles=roles,
                        name=name,
                        name_key=svc.name_key(name),
                        address=address if any(address.values()) else {},
                        tags=tags,
                        external={},
                        source="import",
                        created_by=principal.actor,
                        **{k: v for k, v in values.items() if v not in ("", None)},
                    )
                    db.add(p)
                    await db.flush()
                    created += 1
                await _import_contact(db, principal, p, get)
        except Exception as e:  # noqa: BLE001 - one bad row never undoes the others
            skipped += 1
            errors.append({"row": n, "message": str(e)[:200]})
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "parties.imported",
        after={"created": created, "updated": updated, "skipped": skipped},
    )
    await db.commit()
    _changed(principal)
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors[:200]}


async def _import_contact(db: AsyncSession, principal: Principal, p: Party, get: Any) -> None:
    cname = get("contact_name")[:200]
    cemail = get("contact_email").lower()[:254]
    if cemail and not EMAIL_RX.match(cemail):
        cemail = ""
    if not cname and not cemail:
        return
    existing = (await db.scalars(select(PartyContact).where(PartyContact.party_id == p.id))).all()
    for c in existing:
        if (cemail and c.email.lower() == cemail) or (cname and c.name.lower() == cname.lower()):
            c.title = get("contact_title")[:120] or c.title
            c.phone = get("contact_phone")[:60] or c.phone
            c.email = cemail or c.email
            return
    db.add(
        PartyContact(
            workspace_id=principal.workspace_id,
            party_id=p.id,
            name=cname or cemail,
            title=get("contact_title")[:120],
            email=cemail,
            phone=get("contact_phone")[:60],
            is_primary=not existing,
        )
    )
    await db.flush()


# ---------------------------------------------------------------- deals


class DealIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    party_id: str = Field(max_length=40)
    title: str = Field(min_length=1, max_length=200)
    value: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("999999999999"))
    currency: str = Field(default="MYR", pattern=r"^[A-Z]{3}$")
    stage: Stage = "lead"
    probability: int | None = Field(default=None, ge=0, le=100)
    expected_close: date | None = None
    owner_user_id: str | None = Field(default=None, max_length=40)
    agent_id: str | None = Field(default=None, max_length=40)
    source: str = Field(default="", max_length=40)
    next_step: str = Field(default="", max_length=300)
    next_step_due: date | None = None
    lost_reason: str = Field(default="", max_length=300)
    branch_id: str | None = Field(default=None, max_length=40)
    position: float | None = None

    _blanks = field_validator(
        "expected_close",
        "next_step_due",
        "owner_user_id",
        "agent_id",
        "branch_id",
        mode="before",
    )(_blank_none)

    @field_validator("currency", mode="before")
    @classmethod
    def _currency(cls, v: Any) -> Any:
        return "MYR" if v is None or (isinstance(v, str) and not v.strip()) else v


class DealPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    value: Decimal | None = Field(default=None, ge=0, le=Decimal("999999999999"))
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    stage: Stage | None = None
    probability: int | None = Field(default=None, ge=0, le=100)
    expected_close: date | None = None
    owner_user_id: str | None = Field(default=None, max_length=40)
    agent_id: str | None = Field(default=None, max_length=40)
    source: str | None = Field(default=None, max_length=40)
    next_step: str | None = Field(default=None, max_length=300)
    next_step_due: date | None = None
    lost_reason: str | None = Field(default=None, max_length=300)
    position: float | None = None

    _blanks = field_validator(
        "expected_close", "next_step_due", "owner_user_id", "agent_id", "currency", mode="before"
    )(_blank_none)


def _deal_not_found() -> Exception:
    return api_error(status.HTTP_404_NOT_FOUND, "deal_not_found", "That deal is not here.")


async def _deal(db: AsyncSession, principal: Principal, deal_id: str) -> Deal:
    d = await db.get(Deal, deal_id)
    if not access.sees_party(principal, d):
        raise _deal_not_found()
    assert d is not None
    return d


async def _agent_ok(db: AsyncSession, principal: Principal, agent_id: str | None) -> None:
    from ...models import Agent

    if not agent_id:
        return
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")


STAGE_LABEL = {
    "lead": "lead|deal stage",
    "qualified": "qualified|deal stage",
    "proposal": "proposal|deal stage",
    "negotiation": "negotiation|deal stage",
    "won": "won|deal stage",
    "lost": "lost|deal stage",
}


@router.get("/deals")
async def list_deals(
    branch_id: str | None = Query(default=None, max_length=40),
    stage: Stage | None = None,
    owner: str | None = Query(default=None, max_length=40),
    party_id: str | None = Query(default=None, max_length=40),
    q: str | None = Query(default=None, max_length=200),
    open_only: bool = Query(default=False, alias="open"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Deals this person sees (a board: by stage, then position). `owner=me` for their own."""
    base = (
        select(Deal, Party.name)
        .join(Party, Party.id == Deal.party_id)
        .where(Deal.workspace_id == principal.workspace_id, access.party_where(principal, Deal))
    )
    if branch_id == "shared":
        base = base.where(Deal.branch_id.is_(None))
    elif branch_id:
        base = base.where(Deal.branch_id == branch_id)
    if stage:
        base = base.where(Deal.stage == stage)
    if open_only:
        base = base.where(Deal.stage.in_(svc.OPEN_STAGES))
    if owner:
        base = base.where(Deal.owner_user_id == (principal.user.id if owner == "me" else owner))
    if party_id:
        base = base.where(Deal.party_id == party_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        base = base.where(or_(func.lower(Deal.title).like(like), func.lower(Party.name).like(like)))
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    rows = (
        await db.execute(
            base.order_by(Deal.position, Deal.created_at, Deal.id).offset(offset).limit(limit)
        )
    ).all()
    return {"items": [deal_out(d, n) for d, n in rows], "total": total}


@router.get("/deals/summary")
async def deals_summary(
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Per stage: how many deals, their value and the value weighted by probability."""
    q = select(Deal.stage, Deal.value, Deal.probability).where(
        Deal.workspace_id == principal.workspace_id, access.party_where(principal, Deal)
    )
    if branch_id:
        q = q.where(Deal.branch_id == branch_id)
    stages = {s: {"count": 0, "value": Decimal(0), "weighted": Decimal(0)} for s in svc.STAGES}
    for stage_, value, prob in (await db.execute(q)).all():
        s = stages[stage_]
        s["count"] += 1
        s["value"] += svc.q2(value)
        s["weighted"] += svc.q2(svc.q2(value) * (prob or 0) / 100)
    open_ = [stages[s] for s in svc.OPEN_STAGES]
    per_stage = {
        k: {"count": v["count"], "value": svc.fl(v["value"]), "weighted": svc.fl(v["weighted"])}
        for k, v in stages.items()
    }
    return {
        **per_stage,  # {stage: {count, value, weighted}} at the top, and under "stages"
        "stages": per_stage,
        "open": {
            "count": sum(int(s["count"]) for s in open_),
            "value": svc.fl(sum((s["value"] for s in open_), Decimal(0))),
            "weighted": svc.fl(sum((s["weighted"] for s in open_), Decimal(0))),
        },
    }


@router.post("/deals", status_code=status.HTTP_201_CREATED)
async def create_deal(
    body: DealIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    p = await _party(db, principal, body.party_id)
    branch_id = body.branch_id or p.branch_id or principal.scope.branch_id
    if p.branch_id and branch_id != p.branch_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "wrong_company",
            "That customer belongs to another company.",
        )
    if not access.may_write(principal, branch_id):
        raise _forbidden()
    await _branch_ok(db, principal, branch_id)
    await _member_ok(db, principal, body.owner_user_id)
    await _agent_ok(db, principal, body.agent_id)
    lowest = await db.scalar(
        select(func.min(Deal.position)).where(
            Deal.workspace_id == principal.workspace_id, Deal.stage == body.stage
        )
    )
    d = Deal(
        workspace_id=principal.workspace_id,
        branch_id=branch_id,
        party_id=p.id,
        title=" ".join(body.title.split()),
        value=svc.q2(body.value),
        currency=body.currency,
        stage=body.stage,
        probability=body.probability
        if body.probability is not None
        else svc.STAGE_PROBABILITY[body.stage],
        expected_close=body.expected_close,
        owner_user_id=body.owner_user_id or principal.user.id,
        agent_id=body.agent_id,
        source=body.source,
        next_step=body.next_step,
        next_step_due=body.next_step_due,
        lost_reason=body.lost_reason,
        position=body.position if body.position is not None else float(lowest or 0) - 1,
        closed_at=svc.now() if body.stage in ("won", "lost") else None,
        created_by=principal.actor,
    )
    db.add(d)
    await db.flush()
    lang = await svc.company_lang(db, principal.workspace_id, branch_id)
    await svc.log(
        db,
        principal.workspace_id,
        p.id,
        "deal",
        tr(
            "New deal: {title} ({amount}, {stage})",
            lang,
            title=d.title,
            amount=svc.amount_text(d.currency, d.value),
            stage=Msg(STAGE_LABEL[d.stage]),
        ),
        principal.actor,
        deal_id=d.id,
        data={"stage": d.stage},
    )
    await db.commit()
    await db.refresh(d)
    return deal_out(d, p.name)


@router.get("/deals/{deal_id}")
async def get_deal(
    deal_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    d = await _deal(db, principal, deal_id)
    p = await db.get(Party, d.party_id)
    return deal_out(d, p.name if p else None)


@router.patch("/deals/{deal_id}")
async def update_deal(
    deal_id: str,
    body: DealPatch,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Change a deal; moving it to another stage (and position on the board) is logged on the
    party's timeline. Won and lost close it; moving it back opens it again."""
    d = await _deal(db, principal, deal_id)
    if not access.may_write(principal, d.branch_id):
        raise _forbidden()
    data = body.model_dump(exclude_unset=True)
    await _member_ok(db, principal, data.get("owner_user_id"))
    await _agent_ok(db, principal, data.get("agent_id"))
    before = d.stage
    for k in ("title", "currency", "expected_close", "owner_user_id", "agent_id", "source",
              "next_step", "next_step_due", "lost_reason", "position"):  # fmt: skip
        if k in data:
            v = data[k]
            if v is None and k in ("title", "currency", "source", "next_step", "lost_reason",
                                   "position"):  # fmt: skip
                continue
            setattr(d, k, v)
    if body.value is not None:
        d.value = svc.q2(body.value)
    if body.stage is not None and body.stage != before:
        d.stage = body.stage
        d.probability = (
            body.probability if body.probability is not None else svc.STAGE_PROBABILITY[d.stage]
        )
        d.closed_at = svc.now() if d.stage in ("won", "lost") else None
        lang = await svc.company_lang(db, principal.workspace_id, d.branch_id)
        await svc.log(
            db,
            principal.workspace_id,
            d.party_id,
            "deal",
            tr(
                "Deal {title} moved from {before} to {after}",
                lang,
                title=d.title,
                before=Msg(STAGE_LABEL[before]),
                after=Msg(STAGE_LABEL[d.stage]),
            )
            + (f" ({d.lost_reason})" if d.stage == "lost" and d.lost_reason else ""),
            principal.actor,
            deal_id=d.id,
            data={"from": before, "to": d.stage},
        )
    elif body.probability is not None:
        d.probability = body.probability
    await db.commit()
    await db.refresh(d)
    p = await db.get(Party, d.party_id)
    return deal_out(d, p.name if p else None)
