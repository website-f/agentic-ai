"""P35: the shared rules of parties, deals and money.

Amounts are Decimal inside (2 places, half up) and float in JSON. A money doc is OPEN while
something is owed on it: a bill awaiting approval is owed already, a draft invoice not yet.
Overdue = open and its due date has passed (the workspace's own today).
"""

import re
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg, tr
from ..models import (
    Interaction,
    MoneyDoc,
    Party,
    PartyContact,
    Payment,
    Task,
    Workspace,
)
from .access import company_where

PARTY_KINDS = ("company", "person")
PARTY_ROLES = ("customer", "supplier", "partner", "lead")
PARTY_SOURCES = ("manual", "email", "import", "accounting")
STAGES = ("lead", "qualified", "proposal", "negotiation", "won", "lost")
OPEN_STAGES = ("lead", "qualified", "proposal", "negotiation")
STAGE_PROBABILITY = {
    "lead": 10,
    "qualified": 25,
    "proposal": 50,
    "negotiation": 75,
    "won": 100,
    "lost": 0,
}
DIRECTIONS = ("receivable", "payable")
STATUSES = ("draft", "awaiting_approval", "approved", "sent", "partially_paid", "paid", "void")
OPEN = ("awaiting_approval", "approved", "sent", "partially_paid")
EDITABLE = ("draft", "awaiting_approval")
PAYABLE_NOW = ("approved", "sent", "partially_paid")
METHODS = ("bank_transfer", "duitnow", "fpx", "cash", "cheque", "card", "online", "other")
INTERACTION_KINDS = (
    "email_in",
    "email_out",
    "note",
    "call",
    "meeting",
    "task",
    "document",
    "invoice",
    "payment",
    "deal",
)
MONEY_KINDS = ("invoice", "payment")  # timeline entries only finance people see
# Statuses in sentences ("This was already {status}."), translated with them.
STATUS_LABEL = {
    "draft": "draft|money status",
    "awaiting_approval": "awaiting approval|money status",
    "approved": "approved|money status",
    "sent": "sent|money status",
    "partially_paid": "partly paid|money status",
    "paid": "paid|money status",
    "void": "void|money status",
}
CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("1000000000000")

# Words that do not tell companies apart ("Maju Sdn. Bhd." is "maju").
NAME_NOISE = frozenset(
    "sdn bhd berhad sendirian plt ltd limited inc co corp corporation llc pte m".split()
)
# Mail services anyone can sign up to: their domain says nothing about the company.
FREE_MAIL = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "yahoo.com",
        "yahoo.com.my",
        "ymail.com",
        "hotmail.com",
        "hotmail.my",
        "outlook.com",
        "outlook.my",
        "live.com",
        "msn.com",
        "icloud.com",
        "me.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "gmx.com",
        "mail.com",
        "zoho.com",
        "tm.net.my",
        "streamyx.com",
    }
)


class CrmError(Exception):
    """A rule was broken: the router answers `status` with `code` and the sentence."""

    def __init__(self, status: int, code: str, message: Msg) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def now() -> datetime:
    return datetime.now(UTC)


def status_label(status: str) -> Msg:
    return Msg(STATUS_LABEL.get(status, status))


async def company_lang(db: AsyncSession, workspace_id: str, branch_id: str | None) -> str:
    """The language text written for a company (timeline lines, task titles, reminders) is
    in: its kit's language, else the workspace's."""
    from ..documents import provenance

    return await provenance.folder_lang(db, workspace_id, branch_id)


async def today(db: AsyncSession, workspace_id: str) -> date:
    ws = await db.get(Workspace, workspace_id)
    try:
        zone = ZoneInfo((ws.timezone if ws else "") or "UTC")
    except Exception:  # noqa: BLE001 - a bad zone name: UTC
        zone = ZoneInfo("UTC")
    return datetime.now(zone).date()


# ---------------------------------------------------------------- normalising


def name_key(name: str) -> str:
    words = re.sub(r"[^0-9a-z]+", " ", (name or "").casefold()).split()
    kept = [w for w in words if w not in NAME_NOISE]
    return " ".join(kept or words)[:200]


def norm_id(value: str) -> str:
    """A TIN or registration number without spaces, dashes or brackets, upper case."""
    return re.sub(r"[^0-9A-Za-z]", "", value or "").upper()


def domain_of(value: str) -> str:
    """example.com from an email address or a website."""
    v = (value or "").strip().lower()
    if "@" in v:
        v = v.rsplit("@", 1)[1]
    v = re.sub(r"^[a-z]+://", "", v).split("/", 1)[0].split(":", 1)[0]
    return v.removeprefix("www.").strip(".")


def clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def money(value: Any) -> Decimal | None:
    """A number from a person, a sheet or a model: 1234.5, "1,234.50", "RM 1,234.50"."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float | Decimal):
        try:
            d = Decimal(str(value))
        except InvalidOperation:
            return None
    else:
        s = str(value).strip()
        s = re.sub(r"(?i)^(rm|myr|usd|sgd|eur|gbp|\$)\s*", "", s)
        s = s.replace(",", "").replace(" ", "")
        if s.startswith("(") and s.endswith(")"):
            s = "-" + s[1:-1]
        if not s:
            return None
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None
    if not d.is_finite() or abs(d) >= MAX_AMOUNT:
        return None
    return d


def q2(value: Decimal | float | int | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def fl(value: Any) -> float:
    return float(q2(value))


DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y")


def parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = " ".join(str(value or "").split())[:40]
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            d = datetime.strptime(s, fmt).date()
        except ValueError:
            continue
        if 2000 <= d.year <= 2100:
            return d
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if m:
        return parse_date(m.group(1))
    return None


def add_days(d: date, days: int | None) -> date:
    return d + timedelta(days=max(0, int(days or 0)))


def amount_text(currency: str, amount: Any) -> str:
    """RM 1,234.50 (the code for other currencies)."""
    label = "RM" if (currency or "MYR").upper() == "MYR" else (currency or "").upper()
    return f"{label} {q2(amount):,.2f}"


# ---------------------------------------------------------------- lines and totals


def clean_lines(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in raw if isinstance(raw, list) else []:
        if not isinstance(line, dict):
            continue
        desc = clean(line.get("description"), 500)
        qty = money(line.get("qty"))
        qty = qty if qty is not None and qty != 0 else Decimal(1)
        price = money(line.get("unit_price"))
        rate = money(line.get("tax_rate")) or Decimal(0)
        if not Decimal(0) <= rate <= Decimal(100):
            rate = Decimal(0)
        amount = money(line.get("amount"))
        if amount is None:
            amount = q2(qty * (price or Decimal(0)))
        if price is None:
            price = q2(amount / qty)
        if not desc and not amount:
            continue
        out.append(
            {
                "description": desc,
                "qty": float(qty),
                "unit_price": float(q2(price)),
                "tax_rate": float(rate),
                "amount": fl(amount),
            }
        )
        if len(out) >= 200:
            break
    return out


def totals(
    lines: list[dict[str, Any]],
    subtotal: Decimal | None = None,
    tax_total: Decimal | None = None,
    total: Decimal | None = None,
) -> tuple[Decimal, Decimal, Decimal]:
    """Subtotal, tax and total: what was given wins; the rest follows from the lines."""
    line_sum = sum((Decimal(str(x["amount"])) for x in lines), Decimal(0))
    line_tax = sum(
        (q2(Decimal(str(x["amount"])) * Decimal(str(x["tax_rate"])) / 100) for x in lines),
        Decimal(0),
    )
    if tax_total is None:
        tax_total = line_tax if lines or total is None or subtotal is not None else Decimal(0)
    if subtotal is None:
        subtotal = line_sum if lines or total is None else total - tax_total
    if total is None:
        total = subtotal + tax_total
    return q2(subtotal), q2(tax_total), q2(total)


def outstanding(doc: MoneyDoc) -> Decimal:
    return max(q2(doc.total) - q2(doc.amount_paid), Decimal(0))


def is_open(doc: MoneyDoc) -> bool:
    return doc.status in OPEN


def overdue_info(doc: MoneyDoc, on: date) -> tuple[bool, int]:
    if not is_open(doc) or doc.due_date is None or doc.due_date >= on:
        return False, 0
    return True, (on - doc.due_date).days


# ---------------------------------------------------------------- interactions


async def log(
    db: AsyncSession,
    workspace_id: str,
    party_id: str,
    kind: str,
    summary: str = "",
    actor: str = "system",
    *,
    at: datetime | None = None,
    data: dict[str, Any] | None = None,
    mail_item_id: str | None = None,
    task_id: str | None = None,
    document_id: str | None = None,
    money_doc_id: str | None = None,
    deal_id: str | None = None,
) -> Interaction:
    row = Interaction(
        workspace_id=workspace_id,
        party_id=party_id,
        kind=kind,
        summary=" ".join((summary or "").split())[:500],
        data=data or {},
        at=at or now(),
        actor=actor[:80],
        mail_item_id=mail_item_id,
        task_id=task_id,
        document_id=document_id,
        money_doc_id=money_doc_id,
        deal_id=deal_id,
    )
    db.add(row)
    await db.flush()
    return row


# ---------------------------------------------------------------- matching


def _id_col(col: Any) -> Any:
    return func.upper(func.regexp_replace(col, "[^A-Za-z0-9]", "", "g"))


async def match_party(
    db: AsyncSession,
    workspace_id: str,
    branch_id: str | None,
    *,
    tin: str = "",
    reg_no: str = "",
    email: str = "",
    name: str = "",
) -> Party | None:
    """The party these details name, among the company's own and the shared ones: by tax id,
    then registration number, then email (the party's or a contact's), then the normalised
    name. Archived parties are not matched."""
    base = (
        select(Party)
        .where(
            Party.workspace_id == workspace_id,
            Party.status == "active",
            company_where(Party, branch_id),
        )
        .order_by(Party.created_at)
        .limit(1)
    )
    for col, value in ((Party.tin, tin), (Party.reg_no, reg_no)):
        v = norm_id(value)
        if len(v) >= 4:
            hit = await db.scalar(base.where(_id_col(col) == v))
            if hit is not None:
                return hit
    e = (email or "").strip().lower()
    if "@" in e:
        hit = await db.scalar(base.where(func.lower(Party.email) == e))
        if hit is not None:
            return hit
        hit = await db.scalar(
            base.where(
                Party.id.in_(
                    select(PartyContact.party_id).where(
                        PartyContact.workspace_id == workspace_id,
                        func.lower(PartyContact.email) == e,
                    )
                )
            )
        )
        if hit is not None:
            return hit
    k = name_key(name)
    if k:
        return await db.scalar(base.where(Party.name_key == k))
    return None


async def match_email(
    db: AsyncSession, workspace_id: str, branch_id: str | None, address: str
) -> tuple[Party, PartyContact | None] | None:
    """The party an email address belongs to: a contact's or the party's own address, else
    (for a company domain, never gmail.com and the like) the one party whose email or
    website has that domain."""
    e = (address or "").strip().lower()
    if "@" not in e:
        return None
    where = (
        Party.workspace_id == workspace_id,
        Party.status == "active",
        company_where(Party, branch_id),
    )
    row = (
        await db.execute(
            select(Party, PartyContact)
            .join(PartyContact, PartyContact.party_id == Party.id)
            .where(*where, func.lower(PartyContact.email) == e)
            .order_by(PartyContact.is_primary.desc(), Party.created_at)
            .limit(1)
        )
    ).first()
    if row is not None:
        return row[0], row[1]
    p = await db.scalar(
        select(Party).where(*where, func.lower(Party.email) == e).order_by(Party.created_at)
    )
    if p is not None:
        return p, None
    dom = domain_of(e)
    if not dom or dom in FREE_MAIL:
        return None
    hits = (
        await db.scalars(
            select(Party)
            .where(
                *where,
                or_(
                    func.lower(Party.email).like(f"%@{dom}"),
                    func.lower(Party.website).like(f"%{dom}%"),
                ),
            )
            .limit(5)
        )
    ).all()
    exact = [p for p in hits if domain_of(p.email) == dom or domain_of(p.website) == dom]
    return (exact[0], None) if len(exact) == 1 else None


# ---------------------------------------------------------------- money docs


async def next_number(db: AsyncSession, workspace_id: str, branch_id: str) -> str:
    n = (
        int(
            await db.scalar(
                select(func.count())
                .select_from(MoneyDoc)
                .where(
                    MoneyDoc.workspace_id == workspace_id,
                    MoneyDoc.branch_id == branch_id,
                    MoneyDoc.direction == "receivable",
                )
            )
            or 0
        )
        + 1
    )
    while True:
        number = f"INV-{n:05d}"
        taken = await db.scalar(
            select(MoneyDoc.id).where(
                MoneyDoc.workspace_id == workspace_id,
                MoneyDoc.branch_id == branch_id,
                MoneyDoc.direction == "receivable",
                MoneyDoc.number == number,
            )
        )
        if taken is None:
            return number
        n += 1


DUPLICATE_DAYS = 3


async def find_duplicate(db: AsyncSession, doc: MoneyDoc) -> MoneyDoc | None:
    """An earlier doc this one repeats: the same party and number, or the same party and
    total issued within three days. Void docs do not count."""
    q = (
        select(MoneyDoc)
        .where(
            MoneyDoc.workspace_id == doc.workspace_id,
            MoneyDoc.party_id == doc.party_id,
            MoneyDoc.direction == doc.direction,
            MoneyDoc.status != "void",
        )
        .order_by(MoneyDoc.created_at)
        .limit(1)
    )
    if doc.id:
        q = q.where(MoneyDoc.id != doc.id)
    number = (doc.number or "").strip().lower()
    if number:
        hit = await db.scalar(q.where(func.lower(MoneyDoc.number) == number))
        if hit is not None:
            return hit
    if doc.total and doc.issue_date:
        span = timedelta(days=DUPLICATE_DAYS)
        hit = await db.scalar(
            q.where(
                MoneyDoc.total == q2(doc.total),
                MoneyDoc.issue_date.between(doc.issue_date - span, doc.issue_date + span),
            )
        )
        if hit is not None:
            return hit
    return None


async def close_task(db: AsyncSession, doc: MoneyDoc, status: str, result: str) -> None:
    """The approval task of a captured bill is done once a person decided."""
    if not doc.task_id:
        return
    t = await db.get(Task, doc.task_id)
    if t is not None and t.status not in ("done", "cancelled", "failed"):
        t.status, t.result, t.finished_at = status, result[:2000], now()


async def add_payment(
    db: AsyncSession,
    doc: MoneyDoc,
    *,
    amount: Decimal,
    paid_at: date,
    method: str,
    reference: str,
    actor: str,
) -> Payment:
    if doc.status not in PAYABLE_NOW:
        raise CrmError(
            409,
            "not_payable",
            Msg("Approve it before recording a payment.")
            if doc.status in EDITABLE
            else Msg("This was already {status}.", status=status_label(doc.status)),
        )
    amount = q2(amount)
    if amount <= 0:
        raise CrmError(422, "bad_amount", Msg("The amount must be more than zero."))
    left = outstanding(doc)
    if amount > left:
        raise CrmError(
            422,
            "overpaid",
            Msg(
                "That is more than the {amount} still owed.", amount=amount_text(doc.currency, left)
            ),
        )
    p = Payment(
        workspace_id=doc.workspace_id,
        money_doc_id=doc.id,
        amount=amount,
        paid_at=paid_at,
        method=method,
        reference=clean(reference, 120),
        recorded_by=actor,
    )
    db.add(p)
    doc.amount_paid = q2(doc.amount_paid) + amount
    doc.status = "paid" if q2(doc.amount_paid) >= q2(doc.total) else "partially_paid"
    lang = await company_lang(db, doc.workspace_id, doc.branch_id)
    await log(
        db,
        doc.workspace_id,
        doc.party_id,
        "payment",
        tr(
            "Paid {amount} on bill {number}"
            if doc.direction == "payable"
            else "Payment received: {amount} on invoice {number}",
            lang,
            amount=amount_text(doc.currency, amount),
            number=doc.number or doc.id,
        ),
        actor,
        money_doc_id=doc.id,
        data={"amount": float(amount), "method": method, "status": doc.status},
    )
    if doc.status == "paid":
        await close_task(db, doc, "done", tr("Paid in full.", lang))
    await db.flush()
    return p


# ---------------------------------------------------------------- balances and reports


def _open_rows(workspace_id: str, cond: ColumnElement[bool]) -> Any:
    return select(
        MoneyDoc.party_id,
        MoneyDoc.direction,
        MoneyDoc.total,
        MoneyDoc.amount_paid,
        MoneyDoc.due_date,
        MoneyDoc.currency,
    ).where(MoneyDoc.workspace_id == workspace_id, MoneyDoc.status.in_(OPEN), cond)


def _left(r: Any) -> Decimal:
    return max(q2(r.total) - q2(r.amount_paid), Decimal(0))


async def balances(
    db: AsyncSession,
    workspace_id: str,
    party_ids: list[str],
    cond: ColumnElement[bool],
    on: date,
) -> dict[str, dict[str, float]]:
    if not party_ids:
        return {}
    acc: dict[str, dict[str, Decimal]] = {}
    keys = ("receivable_open", "receivable_overdue", "payable_open", "payable_overdue")
    for r in (
        await db.execute(_open_rows(workspace_id, cond).where(MoneyDoc.party_id.in_(party_ids)))
    ).all():
        a = acc.setdefault(r.party_id, {k: Decimal(0) for k in keys})
        left = _left(r)
        a[f"{r.direction}_open"] += left
        if r.due_date is not None and r.due_date < on:
            a[f"{r.direction}_overdue"] += left
    out: dict[str, dict[str, float]] = {}
    for pid in party_ids:
        a = acc.get(pid) or {k: Decimal(0) for k in keys}
        out[pid] = {
            "receivable_open": fl(a["receivable_open"]),
            "payable_open": fl(a["payable_open"]),
            "receivable_overdue": fl(a["receivable_overdue"]),
            "payable_overdue": fl(a["payable_overdue"]),
            "overdue": fl(a["receivable_overdue"] + a["payable_overdue"]),
        }
    return out


BUCKETS = ("current", "d1_30", "d31_60", "d61_90", "d90_plus")


def bucket_of(due: date | None, on: date) -> str:
    days = (on - due).days if due is not None else 0
    if days <= 0:
        return "current"
    if days <= 30:
        return "d1_30"
    if days <= 60:
        return "d31_60"
    if days <= 90:
        return "d61_90"
    return "d90_plus"


async def aging(
    db: AsyncSession, workspace_id: str, direction: str, cond: ColumnElement[bool], on: date
) -> dict[str, Any]:
    sums: dict[str, Decimal] = {b: Decimal(0) for b in BUCKETS}
    counts: dict[str, int] = dict.fromkeys(BUCKETS, 0)
    rows = (
        await db.execute(_open_rows(workspace_id, cond).where(MoneyDoc.direction == direction))
    ).all()
    for r in rows:
        b = bucket_of(r.due_date, on)
        sums[b] += _left(r)
        counts[b] += 1
    return {
        "direction": direction,
        "as_of": on.isoformat(),
        "buckets": {b: {"amount": fl(sums[b]), "count": counts[b]} for b in BUCKETS},
        "total": {"amount": fl(sum(sums.values(), Decimal(0))), "count": len(rows)},
    }


async def forecast(
    db: AsyncSession, workspace_id: str, cond: ColumnElement[bool], on: date, days: int
) -> dict[str, Any]:
    """Expected money in (receivables) and out (payables) per week, from due dates. What is
    already overdue, and what has no due date, are counted apart."""
    weeks = -(-days // 7)
    rows = [
        {"start": on + timedelta(days=7 * i), "end": on + timedelta(days=7 * i + 6)}
        for i in range(weeks)
    ]
    last = on + timedelta(days=days - 1)
    rows[-1]["end"] = min(rows[-1]["end"], last)
    flows = [{"in": Decimal(0), "out": Decimal(0)} for _ in rows]
    overdue = {"in": Decimal(0), "out": Decimal(0)}
    undated = {"in": Decimal(0), "out": Decimal(0)}
    for r in (await db.execute(_open_rows(workspace_id, cond))).all():
        way = "in" if r.direction == "receivable" else "out"
        left = _left(r)
        if r.due_date is None:
            undated[way] += left
        elif r.due_date < on:
            overdue[way] += left
        elif r.due_date <= last:
            flows[(r.due_date - on).days // 7][way] += left
    week_out = [
        {
            "start": w["start"].isoformat(),
            "end": w["end"].isoformat(),
            "in": fl(f["in"]),
            "out": fl(f["out"]),
            "net": fl(f["in"] - f["out"]),
        }
        for w, f in zip(rows, flows, strict=True)
    ]
    return {
        "as_of": on.isoformat(),
        "days": days,
        "weeks": week_out,
        "overdue": {k: fl(v) for k, v in overdue.items()},
        "undated": {k: fl(v) for k, v in undated.items()},
        "total_in": fl(sum((f["in"] for f in flows), Decimal(0))),
        "total_out": fl(sum((f["out"] for f in flows), Decimal(0))),
    }


async def summary(
    db: AsyncSession, workspace_id: str, cond: ColumnElement[bool], on: date
) -> dict[str, Any]:
    acc = {
        k: Decimal(0)
        for k in (
            "receivable_open",
            "receivable_overdue",
            "payable_open",
            "payable_overdue",
            "due_7d_in",
            "due_7d_out",
        )
    }
    soon = on + timedelta(days=7)
    currencies: set[str] = set()
    for r in (await db.execute(_open_rows(workspace_id, cond))).all():
        left = _left(r)
        currencies.add(r.currency)
        acc[f"{r.direction}_open"] += left
        if r.due_date is not None and r.due_date < on:
            acc[f"{r.direction}_overdue"] += left
        elif r.due_date is not None and r.due_date <= soon:
            acc["due_7d_in" if r.direction == "receivable" else "due_7d_out"] += left
    waiting = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(MoneyDoc.total), 0)).where(
                MoneyDoc.workspace_id == workspace_id,
                MoneyDoc.status == "awaiting_approval",
                cond,
            )
        )
    ).one()
    return {
        "as_of": on.isoformat(),
        **{k: fl(v) for k, v in acc.items()},
        "awaiting_approval": int(waiting[0] or 0),
        "awaiting_approval_total": fl(waiting[1]),
        "currencies": sorted(currencies) or ["MYR"],
    }
