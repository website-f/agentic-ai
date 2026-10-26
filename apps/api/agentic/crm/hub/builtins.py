# ruff: noqa: E501
"""P50 built-in CRM objects: the office's own data, shown in the CRM as it is (read only),
found by `discover()`. People can add their own fields to any of them; those values live in
CrmRecord rows keyed by the office row's id.

Each source: what it is, its fields (key, label, type, options), how to read its rows (at
most ROW_CAP, newest first) and where a row opens in the app.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    Agent,
    Branch,
    Deal,
    DocFile,
    MailItem,
    Membership,
    MoneyDoc,
    Party,
    Task,
    User,
)

ROW_CAP = 3000

Row = dict[str, Any]


def _choices(*values: str) -> dict[str, Any]:
    from .fields import clean_choices

    return {
        "choices": clean_choices(
            [{"value": v, "label": v.replace("_", " ").capitalize()} for v in values]
        )
    }


@dataclass
class Source:
    key: str
    name: str
    singular: str
    icon: str
    color: str
    description: str
    title_field: str
    fields: list[tuple[str, str, str, dict[str, Any]]]
    rows: Callable[[AsyncSession, str], Awaitable[list[Row]]]
    count: Callable[[AsyncSession, str], Awaitable[int]]
    link: str  # "/contacts/{id}"
    tags: list[str] = field(default_factory=list)


def _iso(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=UTC)).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


async def _count(db: AsyncSession, model: Any, *where: Any) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


# ---------------------------------------------------------------- contacts and companies


async def _parties(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.scalars(
            select(Party)
            .where(Party.workspace_id == ws)
            .order_by(Party.created_at.desc())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "kind": p.kind,
            "roles": list(p.roles or []),
            "email": p.email or None,
            "phone": p.phone or None,
            "industry": p.industry or None,
            "city": (p.address or {}).get("city") or None,
            "status": p.status,
            "source": p.source,
            "created": _iso(p.created_at),
        }
        for p in rows
    ]


# ---------------------------------------------------------------- deals


async def _deals(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.execute(
            select(Deal, Party.name)
            .join(Party, Party.id == Deal.party_id)
            .where(Deal.workspace_id == ws)
            .order_by(Deal.created_at.desc())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "party": party,
            "value": float(d.value or 0),
            "stage": d.stage,
            "probability": d.probability,
            "expected_close": _iso(d.expected_close),
            "next_step": d.next_step or None,
            "source": d.source or None,
            "created": _iso(d.created_at),
        }
        for d, party in rows
    ]


# ---------------------------------------------------------------- invoices and bills


def _money(direction: str) -> Callable[[AsyncSession, str], Awaitable[list[Row]]]:
    async def rows(db: AsyncSession, ws: str) -> list[Row]:
        from ..service import overdue_info

        out: list[Row] = []
        for d, party in (
            await db.execute(
                select(MoneyDoc, Party.name)
                .join(Party, Party.id == MoneyDoc.party_id)
                .where(MoneyDoc.workspace_id == ws, MoneyDoc.direction == direction)
                .order_by(MoneyDoc.issue_date.desc())
                .limit(ROW_CAP)
            )
        ).all():
            _late, days = overdue_info(d, date.today())
            out.append(
                {
                    "id": d.id,
                    "number": d.number or None,
                    "party": party,
                    "total": float(d.total or 0),
                    "balance": float((d.total or 0) - (d.amount_paid or 0)),
                    "status": d.status,
                    "issue_date": _iso(d.issue_date),
                    "due_date": _iso(d.due_date),
                    "days_overdue": days,
                }
            )
        return out

    return rows


_MONEY_FIELDS: list[tuple[str, str, str, dict[str, Any]]] = [
    ("number", "Number", "text", {}),
    ("party", "Party", "text", {}),
    ("total", "Total", "money", {"currency": "RM"}),
    ("balance", "Still owed", "money", {"currency": "RM"}),
    (
        "status",
        "Status",
        "select",
        _choices(
            "draft", "awaiting_approval", "approved", "sent", "partially_paid", "paid", "void"
        ),
    ),
    ("issue_date", "Issued", "date", {}),
    ("due_date", "Due", "date", {}),
    ("days_overdue", "Days overdue", "number", {}),
]


# ---------------------------------------------------------------- tasks, staff, agents


async def _tasks(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.execute(
            select(Task, Agent.name)
            .outerjoin(Agent, Agent.id == Task.assignee_agent_id)
            .where(Task.workspace_id == ws, Task.parent_task_id.is_(None))
            .order_by(Task.created_at.desc())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "priority": t.priority,
            "agent": agent,
            "created": _iso(t.created_at),
            "finished": _iso(t.finished_at),
        }
        for t, agent in rows
    ]


async def _staff(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.execute(
            select(Membership, User, Branch.name)
            .join(User, User.id == Membership.user_id)
            .outerjoin(Branch, Branch.id == Membership.branch_id)
            .where(Membership.workspace_id == ws)
            .order_by(User.name)
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": m.role,
            "company": company,
            "last_login": _iso(u.last_login_at),
        }
        for m, u, company in rows
    ]


async def _agents(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.execute(
            select(Agent, Branch.name)
            .outerjoin(Branch, Branch.id == Agent.branch_id)
            .where(Agent.workspace_id == ws, Agent.status != "retired", Agent.clone_of.is_(None))
            .order_by(Agent.name)
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {"id": a.id, "name": a.name, "role": a.role, "status": a.status, "company": company}
        for a, company in rows
    ]


# ---------------------------------------------------------------- mail and files


async def _mail(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.scalars(
            select(MailItem)
            .where(MailItem.workspace_id == ws)
            .order_by(MailItem.received_at.desc().nulls_last())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": m.id,
            "subject": m.subject,
            "sender": m.from_name or m.from_address,
            "category": m.category,
            "received": _iso(m.received_at),
            "needs_person": bool(m.needs_person),
            "summary": m.summary,
        }
        for m in rows
    ]


async def _files(db: AsyncSession, ws: str) -> list[Row]:
    rows = (
        await db.scalars(
            select(DocFile)
            .where(DocFile.workspace_id == ws, DocFile.library.is_(True))
            .order_by(DocFile.updated_at.desc())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        {
            "id": f.id,
            "name": f.name,
            "folder": f.folder or None,
            "kind": f.kind,
            "size": f.size,
            "updated": _iso(f.updated_at),
        }
        for f in rows
    ]


SOURCES: dict[str, Source] = {
    s.key: s
    for s in [
        Source(
            "contacts", "Contacts and companies", "Contact", "address-book", "#2f6db5",
            "Your customers, suppliers, partners and leads.", "name",
            [
                ("name", "Name", "text", {}),
                ("kind", "Kind", "select", _choices("company", "person")),
                ("roles", "Roles", "multi_select", _choices("customer", "supplier", "partner", "lead")),
                ("email", "Email", "email", {}),
                ("phone", "Phone", "phone", {}),
                ("industry", "Industry", "text", {}),
                ("city", "City", "text", {}),
                ("status", "Status", "select", _choices("active", "archived")),
                ("source", "Came from", "text", {}),
                ("created", "Added", "datetime", {}),
            ],
            _parties, lambda db, ws: _count(db, Party, Party.workspace_id == ws), "/contacts/{id}",
            ["sales", "customers"],
        ),
        Source(
            "deals", "Deals", "Deal", "handshake", "#b7791f", "Sales in progress, from lead to won.", "title",
            [
                ("title", "Deal", "text", {}),
                ("party", "Customer", "text", {}),
                ("value", "Value", "money", {"currency": "RM"}),
                ("stage", "Stage", "select", _choices("lead", "qualified", "proposal", "negotiation", "won", "lost")),
                ("probability", "Chance", "percent", {}),
                ("expected_close", "Expected to close", "date", {}),
                ("next_step", "Next step", "text", {}),
                ("source", "Came from", "text", {}),
                ("created", "Added", "datetime", {}),
            ],
            _deals, lambda db, ws: _count(db, Deal, Deal.workspace_id == ws), "/deals?deal={id}", ["sales"],
        ),
        Source(
            "invoices", "Invoices", "Invoice", "receipt", "#13895f", "What customers owe you.", "number",
            _MONEY_FIELDS, _money("receivable"),
            lambda db, ws: _count(db, MoneyDoc, MoneyDoc.workspace_id == ws, MoneyDoc.direction == "receivable"),
            "/money?doc={id}", ["money"],
        ),
        Source(
            "bills", "Bills and receipts", "Bill", "receipt-x", "#c2412d", "What you owe suppliers.", "number",
            _MONEY_FIELDS, _money("payable"),
            lambda db, ws: _count(db, MoneyDoc, MoneyDoc.workspace_id == ws, MoneyDoc.direction == "payable"),
            "/money?tab=payable&doc={id}", ["money"],
        ),
        Source(
            "tasks", "Tasks", "Task", "kanban", "#7c5cc4", "All the work your AI team and people do.", "title",
            [
                ("title", "Task", "text", {}),
                ("status", "Status", "select", _choices("triage", "ready", "running", "blocked", "review", "done", "failed", "cancelled")),
                ("priority", "Priority", "select", _choices("low", "normal", "high", "urgent")),
                ("agent", "Agent", "text", {}),
                ("created", "Given", "datetime", {}),
                ("finished", "Finished", "datetime", {}),
            ],
            _tasks, lambda db, ws: _count(db, Task, Task.workspace_id == ws, Task.parent_task_id.is_(None)),
            "/tasks?task={id}", ["work"],
        ),
        Source(
            "staff", "Staff", "Person", "users", "#0e7490", "The people in your office.", "name",
            [
                ("name", "Name", "text", {}),
                ("email", "Email", "email", {}),
                ("role", "Role", "select", _choices("owner", "admin", "branch_manager", "hod", "supervisor", "operator", "staff", "approver", "viewer")),
                ("company", "Company", "text", {}),
                ("last_login", "Last signed in", "datetime", {}),
            ],
            _staff, lambda db, ws: _count(db, Membership, Membership.workspace_id == ws),
            "/settings/members", ["people"],
        ),
        Source(
            "agents", "AI agents", "Agent", "robot", "#5a6762", "Your AI team.", "name",
            [
                ("name", "Name", "text", {}),
                ("role", "Job", "text", {}),
                ("status", "Status", "select", _choices("active", "paused")),
                ("company", "Company", "text", {}),
            ],
            _agents,
            lambda db, ws: _count(db, Agent, Agent.workspace_id == ws, Agent.status != "retired", Agent.clone_of.is_(None)),
            "/agents/{id}", ["ai"],
        ),
        Source(
            "mail", "Email", "Email", "envelope", "#2f6db5", "Mail that reached your mailboxes, sorted by the AI.", "subject",
            [
                ("subject", "Subject", "text", {}),
                ("sender", "From", "text", {}),
                ("category", "Kind", "select", _choices("invoice", "customer_request", "tender", "complaint", "internal", "newsletter", "other")),
                ("received", "Received", "datetime", {}),
                ("needs_person", "Needs a person", "checkbox", {}),
                ("summary", "Summary", "long_text", {}),
            ],
            _mail, lambda db, ws: _count(db, MailItem, MailItem.workspace_id == ws), "/mail", ["email"],
        ),
        Source(
            "files", "Library files", "File", "folder-open", "#13895f", "Documents and SOPs in your Library.", "name",
            [
                ("name", "Name", "text", {}),
                ("folder", "Folder", "text", {}),
                ("kind", "Kind", "text", {}),
                ("size", "Size (bytes)", "number", {}),
                ("updated", "Updated", "datetime", {}),
            ],
            _files, lambda db, ws: _count(db, DocFile, DocFile.workspace_id == ws, DocFile.library.is_(True)),
            "/files?f={id}", ["documents"],
        ),
    ]
}  # fmt: skip


async def discover(db: AsyncSession, workspace_id: str) -> list[dict[str, Any]]:
    """What the office already has: every built-in source with how many rows it holds."""
    out = []
    for s in SOURCES.values():
        out.append(
            {
                "key": s.key,
                "name": s.name,
                "description": s.description,
                "icon": s.icon,
                "color": s.color,
                "count": await s.count(db, workspace_id),
                "tags": s.tags,
            }
        )
    return out
