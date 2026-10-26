"""P46: approval limits by amount. Small routine money decisions go through without a person;
everything else still waits, exactly as before.

Set by the owner (Settings > Approval limits), in ws.settings["approval_limits"]:
- bills: a captured supplier bill or receipt is approved on its own when ALL hold: the limit
  is on, it is in RM, its total is at or under the limit, it is not a possible duplicate, and
  (unless turned off) a person has approved a bill from that supplier before. A receipt that
  was already paid is then recorded as paid; a staff member's claim waits to be paid back.
- invoices: an agent may draft a customer invoice (create_invoice_draft, which asks by
  default) without asking when its total is at or under the limit, unless a manager set that
  tool to "ask" for the agent on purpose.
- per_day: at most this many go through on their own a day (all kinds together); the rest
  wait for a person, so a burst of odd bills cannot slip through.

Every automatic approval is recorded (audit "money.approved" by system:limits, or a task
event "auto_approved") and listed on the settings page.
"""

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..models import MoneyDoc, Workspace
from . import service as svc

ACTOR = "system:limits"
KEY = "approval_limits"
MAX_LIMIT = Decimal(1_000_000)


class BillLimit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    max: Decimal = Field(default=Decimal(500), ge=0, le=MAX_LIMIT)
    known_suppliers_only: bool = True


class InvoiceLimit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    max: Decimal = Field(default=Decimal(2000), ge=0, le=MAX_LIMIT)


class Limits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bills: BillLimit = Field(default_factory=BillLimit)
    invoices: InvoiceLimit = Field(default_factory=InvoiceLimit)
    per_day: int = Field(default=20, ge=1, le=500)


def of(ws: Workspace | None) -> Limits:
    raw = ((ws.settings or {}) if ws is not None else {}).get(KEY) or {}
    try:
        return Limits.model_validate(raw)
    except ValueError:
        return Limits()


def stored(limits: Limits) -> dict[str, Any]:
    return limits.model_dump(mode="json")


async def _take_slot(workspace_id: str, per_day: int) -> bool:
    """One of today's automatic approvals (workspace day, roughly: UTC date is enough for a
    safety cap)."""
    key = f"limits:{workspace_id}:{svc.now().date().isoformat()}"
    n = await valkey().incr(key)
    if n == 1:
        await valkey().expire(key, 2 * 86400)
    return n <= per_day


async def _known_supplier(db: AsyncSession, doc: MoneyDoc) -> bool:
    """A person (not this limit) approved a bill from this supplier before."""
    return (
        await db.scalar(
            select(MoneyDoc.id)
            .where(
                MoneyDoc.workspace_id == doc.workspace_id,
                MoneyDoc.party_id == doc.party_id,
                MoneyDoc.direction == "payable",
                MoneyDoc.id != doc.id,
                MoneyDoc.approved_by.like("user:%"),
            )
            .limit(1)
        )
        is not None
    )


async def why_not_bill(db: AsyncSession, doc: MoneyDoc, limits: Limits) -> str | None:
    """None when the limit approves this bill, else the reason it waits (for the record)."""
    b = limits.bills
    if not b.enabled:
        return "off"
    if doc.direction != "payable" or doc.status != "awaiting_approval":
        return "not waiting"
    if doc.currency != "MYR":
        return "currency"
    if doc.duplicate_of:
        return "possible duplicate"
    if svc.q2(doc.total) <= 0 or svc.q2(doc.total) > svc.q2(b.max):
        return "over the limit"
    if b.known_suppliers_only and not await _known_supplier(db, doc):
        return "new supplier"
    return None


async def after_capture(db: AsyncSession, doc: MoneyDoc) -> bool:
    """Called once a bill is captured (committed). Approves it when the limit allows; True
    then (committed). Never raises: a problem here leaves the bill waiting, as before."""
    from ..i18n import tr

    ws = await db.get(Workspace, doc.workspace_id)
    limits = of(ws)
    if await why_not_bill(db, doc, limits) is not None:
        return False
    if not await _take_slot(doc.workspace_id, limits.per_day):
        return False
    lang = await svc.company_lang(db, doc.workspace_id, doc.branch_id)
    await svc.approve(
        db,
        doc,
        actor=ACTOR,
        by_name=tr("the approval limit", lang),
        why=tr(
            "under the RM {max} limit, from a supplier approved before",
            lang,
            max=f"{svc.q2(limits.bills.max):,.2f}",
        ),
    )
    await db.commit()
    return True


def invoice_total(args: dict[str, Any]) -> Decimal:
    lines = svc.clean_lines(args.get("lines"))
    _sub, _tax, total = svc.totals(lines, None, None, None)
    return svc.q2(total)


async def allows_tool(
    db: AsyncSession, workspace_id: str, name: str, args: dict[str, Any]
) -> str | None:
    """P46 for an agent's tool call that would ask: the reason it may go ahead under the
    limit, or None (it asks, as before)."""
    if name != "create_invoice_draft":
        return None
    limits = of(await db.get(Workspace, workspace_id))
    if not limits.invoices.enabled:
        return None
    total = invoice_total(args)
    currency = str(args.get("currency") or "MYR").upper()
    if currency != "MYR" or total <= 0 or total > svc.q2(limits.invoices.max):
        return None
    if not await _take_slot(workspace_id, limits.per_day):
        return None
    return (
        f"a draft invoice of RM {total:,.2f}, under the RM {svc.q2(limits.invoices.max):,.2f} limit"
    )


__all__ = ["ACTOR", "Limits", "after_capture", "allows_tool", "of", "stored", "why_not_bill"]
