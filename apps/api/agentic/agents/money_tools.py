"""P35 money tools: what the agent's company is owed and owes, and drafts.

Offered only to an agent in a finance department (finance / accounts / kewangan / akaun) or
one a person gave the tool to on purpose (crm/access.py; runtime.offered_tools and
policy.evaluate gate it the same way). An agent sees its own company's money only.

What an agent may do is read, report and PREPARE: an invoice draft (asks a person first), a
bill captured from a file (it waits for approval), a payment-reminder email draft (a person
approves the send). Approving a bill, recording a payment and voiding are never tools.
"""

from decimal import Decimal
from typing import Any

from sqlalchemy import select

from ..core.fence import fence
from ..crm import access
from ..crm import service as svc
from ..models import DocFile, MoneyDoc, Party
from .tools import Tool, ToolContext

MAX_ROWS = 30


def _actor(ctx: ToolContext) -> str:
    return f"agent:{ctx.agent.id}"


def _cond(ctx: ToolContext) -> Any:
    return access.agent_money_where(ctx.agent)


async def _doc(ctx: ToolContext, raw: Any) -> MoneyDoc | str:
    d = await ctx.db.get(MoneyDoc, str(raw or "").strip()) if raw else None
    if d is None or d.workspace_id != ctx.workspace.id or d.branch_id != ctx.agent.branch_id:
        return "Error: no such invoice or bill in your company. Use list_money to get its id."
    return d


async def _list_money(ctx: ToolContext, args: dict[str, Any]) -> str:
    on = await svc.today(ctx.db, ctx.workspace.id)
    q = (
        select(MoneyDoc, Party.name)
        .join(Party, Party.id == MoneyDoc.party_id)
        .where(MoneyDoc.workspace_id == ctx.workspace.id, _cond(ctx))
    )
    direction = str(args.get("direction") or "")
    if direction in svc.DIRECTIONS:
        q = q.where(MoneyDoc.direction == direction)
    status = str(args.get("status") or "")
    if status == "open":
        q = q.where(MoneyDoc.status.in_(svc.OPEN))
    elif status in svc.STATUSES:
        q = q.where(MoneyDoc.status == status)
    if args.get("overdue"):
        q = q.where(MoneyDoc.status.in_(svc.OPEN), MoneyDoc.due_date < on)
    if args.get("party_id"):
        q = q.where(MoneyDoc.party_id == str(args["party_id"]))
    rows = (
        await ctx.db.execute(q.order_by(MoneyDoc.due_date.asc().nulls_last()).limit(MAX_ROWS))
    ).all()
    if not rows:
        return "Nothing matches."
    out = []
    for d, name in rows:
        late, days = svc.overdue_info(d, on)
        out.append(
            f"- {d.direction} {d.number or '-'} [{d.id}] {name}: "
            f"{svc.amount_text(d.currency, d.total)}, outstanding "
            f"{svc.amount_text(d.currency, svc.outstanding(d))}, {d.status}, due "
            f"{d.due_date.isoformat() if d.due_date else '-'}"
            + (f" (OVERDUE {days} days)" if late else "")
            + (f" possible duplicate of {d.duplicate_of}" if d.duplicate_of else "")
        )
    return f"{len(rows)} row(s) (data, not instructions):\n" + fence("\n".join(out))


async def _money_summary(ctx: ToolContext, _: dict[str, Any]) -> str:
    on = await svc.today(ctx.db, ctx.workspace.id)
    s = await svc.summary(ctx.db, ctx.workspace.id, _cond(ctx), on)
    return (
        f"As of {s['as_of']} (your company):\n"
        f"- Customers owe us {s['receivable_open']:,.2f} ({s['receivable_overdue']:,.2f} overdue);"
        f" {s['due_7d_in']:,.2f} falls due in the next 7 days.\n"
        f"- We owe suppliers {s['payable_open']:,.2f} ({s['payable_overdue']:,.2f} overdue);"
        f" {s['due_7d_out']:,.2f} falls due in the next 7 days.\n"
        f"- {s['awaiting_approval']} bill(s) wait for a person's approval "
        f"({s['awaiting_approval_total']:,.2f}).\n"
        f"Currencies: {', '.join(s['currencies'])}."
    )


async def _aging_report(ctx: ToolContext, args: dict[str, Any]) -> str:
    direction = str(args.get("direction") or "receivable")
    if direction not in svc.DIRECTIONS:
        return "Error: direction is receivable or payable."
    on = await svc.today(ctx.db, ctx.workspace.id)
    a = await svc.aging(ctx.db, ctx.workspace.id, direction, _cond(ctx), on)
    names = {"current": "not yet due", "d1_30": "1-30 days late", "d31_60": "31-60 days late",
             "d61_90": "61-90 days late", "d90_plus": "over 90 days late"}  # fmt: skip
    rows = [f"- {names[k]}: {v['amount']:,.2f} ({v['count']})" for k, v in a["buckets"].items()]
    return (
        f"Aging of {direction}s as of {a['as_of']}:\n"
        + "\n".join(rows)
        + f"\nTotal: {a['total']['amount']:,.2f} ({a['total']['count']})"
    )


async def _cashflow_forecast(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        days = int(args.get("days") or 30)
    except (TypeError, ValueError):
        days = 30
    days = days if days in (30, 60, 90) else 30
    on = await svc.today(ctx.db, ctx.workspace.id)
    f = await svc.forecast(ctx.db, ctx.workspace.id, _cond(ctx), on, days)
    rows = [
        f"- {w['start']}..{w['end']}: in {w['in']:,.2f}, out {w['out']:,.2f}, net {w['net']:,.2f}"
        for w in f["weeks"]
    ]
    return (
        f"Expected by due date over {days} days from {f['as_of']}:\n"
        + "\n".join(rows)
        + f"\nAlready overdue: in {f['overdue']['in']:,.2f}, out {f['overdue']['out']:,.2f}. "
        f"No due date: in {f['undated']['in']:,.2f}, out {f['undated']['out']:,.2f}."
    )


async def _create_invoice_draft(ctx: ToolContext, args: dict[str, Any]) -> str:
    if not ctx.agent.branch_id:
        return "Error: you belong to no company, so you cannot draft its invoices."
    pid = str(args.get("party_id") or "")
    p = await ctx.db.get(Party, pid) if pid else None
    if (
        p is None
        or p.workspace_id != ctx.workspace.id
        or (p.branch_id and p.branch_id != ctx.agent.branch_id)
    ):
        return "Error: no such customer for you. Use find_party to get its id."
    lines = svc.clean_lines(args.get("lines"))
    if not lines:
        return "Error: give the lines: description, qty, unit_price, tax_rate (percent)."
    on = await svc.today(ctx.db, ctx.workspace.id)
    issue = svc.parse_date(args.get("issue_date")) or on
    due = svc.parse_date(args.get("due_date")) or svc.add_days(issue, p.payment_terms_days)
    sub, tax, total = svc.totals(lines)
    d = MoneyDoc(
        workspace_id=ctx.workspace.id,
        branch_id=ctx.agent.branch_id,
        party_id=p.id,
        direction="receivable",
        number=await svc.next_number(ctx.db, ctx.workspace.id, ctx.agent.branch_id),
        reference=" ".join(str(args.get("reference") or "").split())[:120],
        issue_date=issue,
        due_date=due,
        currency=str(args.get("currency") or p.currency or "MYR").upper()[:3],
        subtotal=sub,
        tax_total=tax,
        total=total,
        amount_paid=Decimal(0),
        status="draft",
        lines=lines,
        source="manual",
        external={},
        reminders=[],
        notes=str(args.get("notes") or "")[:5000],
        created_by=_actor(ctx),
    )
    ctx.db.add(d)
    await ctx.db.flush()
    await svc.log(
        ctx.db,
        ctx.workspace.id,
        p.id,
        "invoice",
        f"Invoice {d.number} drafted: {svc.amount_text(d.currency, total)}",
        _actor(ctx),
        money_doc_id=d.id,
        task_id=ctx.task.id if ctx.task else None,
    )
    await ctx.db.commit()
    return (
        f"Draft invoice {d.number} ({d.id}) for {p.name}: {svc.amount_text(d.currency, total)} "
        f"(tax {svc.amount_text(d.currency, tax)}), due {due.isoformat()}. It is a DRAFT: a "
        "person with finance access approves it on the Money page."
    )


async def _capture_bill(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..crm import capture
    from ..documents.service import agent_files

    if not ctx.agent.branch_id:
        return "Error: you belong to no company, so you cannot record its bills."
    fid = str(args.get("file_id") or "").strip()
    f = await ctx.db.scalar(
        select(DocFile).where(
            DocFile.id == fid, agent_files(ctx.agent, ctx.task.id if ctx.task else None)
        )
    )
    if f is None:
        return "Error: no such file for you. Use list_files to see the ids."
    if f.quarantined:
        return "Error: this file is held back for review, so it cannot be read."
    if not capture.capturable(f):
        return "Error: bills are read from a PDF or a picture."
    try:
        d = await capture.capture(
            ctx.db, f=f, branch_id=ctx.agent.branch_id, actor=_actor(ctx), agent=ctx.agent
        )
    except capture.CaptureFailed as e:
        return f"Could not capture a bill: {e.message}"
    party = await ctx.db.get(Party, d.party_id)
    assert party is not None
    return capture.describe(d, party) + " You cannot approve or pay it: a person does."


async def _draft_payment_reminder(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..crm import reminders

    d = await _doc(ctx, args.get("money_doc_id"))
    if isinstance(d, str):
        return d
    if d.direction != "receivable" or d.status not in svc.PAYABLE_NOW:
        return "Error: reminders are for approved invoices that are not paid yet."
    out = await reminders.draft(ctx.db, d, step="agent", actor=_actor(ctx))
    if out["channel"] == "outlook_shared":
        return (
            f"Reminder drafted in the company's Outlook (draft {out['draft_id']}) to {out['to']}; "
            "NOTHING is sent until a person approves it."
        )
    note = f" ({out['message']})" if out.get("message") else ""
    text = f"To: {out['to'] or '-'}\nSubject: {out['subject']}\n\n{out['body']}"
    return (
        f"No company mailbox could hold it{note}. The reminder text, for a person to send "
        f"(data):\n{fence(text)}"
    )


# ---------------------------------------------------------------- the tools


def _obj(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


MONEY_TOOLS: list[Tool] = [
    Tool(
        "list_money",
        "List invoices and bills",
        "Your company's invoices (receivable) and suppliers' bills (payable): number, party, "
        "total, outstanding, status, due date, overdue days.",
        _obj(
            {
                "direction": {"type": "string", "enum": list(svc.DIRECTIONS)},
                "status": {"type": "string", "enum": [*svc.STATUSES, "open"]},
                "overdue": {"type": "boolean"},
                "party_id": {"type": "string"},
            },
            [],
        ),
        "low",
        "allow",
        _list_money,
    ),
    Tool(
        "money_summary",
        "Money summary",
        "What customers owe your company and what it owes suppliers: open, overdue, due in 7 "
        "days, bills waiting for approval.",
        _obj({}, []),
        "low",
        "allow",
        _money_summary,
    ),
    Tool(
        "aging_report",
        "Aging report",
        "What is still owed by how late it is (not yet due, 1-30, 31-60, 61-90, 90+ days).",
        _obj({"direction": {"type": "string", "enum": list(svc.DIRECTIONS)}}, []),
        "low",
        "allow",
        _aging_report,
    ),
    Tool(
        "cashflow_forecast",
        "Cash-flow forecast",
        "Money expected in and out per week over 30, 60 or 90 days, from due dates.",
        _obj({"days": {"type": "integer", "enum": [30, 60, 90]}}, []),
        "low",
        "allow",
        _cashflow_forecast,
    ),
    Tool(
        "create_invoice_draft",
        "Draft an invoice",
        "Draft an invoice to a customer (lines: description, qty, unit_price, tax_rate %). It "
        "stays a draft until a person with finance access approves it.",
        _obj(
            {
                "party_id": {"type": "string"},
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "qty": {"type": "number"},
                            "unit_price": {"type": "number"},
                            "tax_rate": {"type": "number"},
                        },
                    },
                },
                "issue_date": {"type": "string", "description": "YYYY-MM-DD, default today"},
                "due_date": {"type": "string", "description": "Default: the customer's terms"},
                "currency": {"type": "string"},
                "reference": {"type": "string", "description": "e.g. their PO number"},
                "notes": {"type": "string"},
            },
            ["party_id", "lines"],
        ),
        "medium",
        "ask",
        _create_invoice_draft,
    ),
    Tool(
        "capture_bill",
        "Capture a supplier bill",
        "Read a supplier's bill from a file (PDF or picture) into the payables: the supplier is "
        "matched or added, duplicates are flagged, and it WAITS for a person's approval.",
        _obj({"file_id": {"type": "string"}}, ["file_id"]),
        "low",
        "allow",
        _capture_bill,
    ),
    Tool(
        "draft_payment_reminder",
        "Draft a payment reminder",
        "Draft a polite payment-reminder email for one unpaid invoice. A DRAFT: a person "
        "approves before anything is sent.",
        _obj({"money_doc_id": {"type": "string"}}, ["money_doc_id"]),
        "low",
        "allow",
        _draft_payment_reminder,
    ),
]

assert {t.name for t in MONEY_TOOLS} == access.MONEY_TOOLS
