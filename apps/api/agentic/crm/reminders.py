"""P35 payment reminders (accounts receivable).

Each company (branch) has a reminder policy (branches.reminder_policy, defaults below): on
which days relative to an invoice's due date a polite reminder is drafted (negative = before
it is due). Nothing is ever sent by itself:

- The company's shared Outlook mailbox, when it has one: an Outlook draft recorded as an
  EmailDraft, approved and sent by the mailbox's managers (the P34 approvals).
- A person asking from the Money page (POST /api/money/{id}/remind) without a company
  mailbox: a draft in their own Outlook, else their Gmail; else the text is handed back.
- The hourly job without a company mailbox: a task in the company holding the drafted text.

The job (`run`) looks at open receivables of every company with reminders on: the latest
step whose day has come (today - due date >= step) and has no reminder yet gets ONE draft; a
missed step is never sent late on top of a newer one. Paid and void invoices get none. Each
draft is recorded on the money doc (`reminders`) and on the party's timeline.
"""

import logging
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..i18n import Msg, tr
from ..models import (
    Agent,
    Branch,
    CompanyKit,
    EmailDraft,
    GoogleAccount,
    MicrosoftAccount,
    MoneyDoc,
    Party,
    PartyContact,
    SharedMailbox,
    Task,
)
from . import service as svc

log = logging.getLogger("agentic.crm.reminders")

DEFAULT_DAYS = [-3, 1, 7, 14, 30]
LOCK_TTL = 3600


class ReminderPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    days: list[int] = Field(default_factory=lambda: list(DEFAULT_DAYS), max_length=12)
    # email: a draft in the company's Outlook (else a task with the text); whatsapp: a task
    # with the text for a person to send.
    channel: Literal["email", "whatsapp"] = "email"

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        for d in v:
            if not -60 <= d <= 365:
                raise ValueError(Msg("Each day must be between -60 and 365."))
        return sorted(set(v))


def policy_of(branch: Branch | None) -> dict[str, Any]:
    stored = (branch.reminder_policy if branch is not None else None) or {}
    out = ReminderPolicy().model_dump()
    for k in out:
        if k in stored:
            out[k] = stored[k]
    return out


def step_due(days: list[int], delta: int, done: set[str]) -> int | None:
    """The newest step whose day has come, if it has no reminder yet."""
    reached = [d for d in days if d <= delta]
    if not reached:
        return None
    step = max(reached)
    return None if str(step) in done else step


def steps_done(doc: MoneyDoc) -> set[str]:
    return {str(r.get("step")) for r in doc.reminders or [] if isinstance(r, dict)}


# ---------------------------------------------------------------- the text


async def recipient(db: AsyncSession, party: Party) -> tuple[str, str]:
    """(email, name to greet) for a reminder: the primary contact, else the party."""
    contacts = (
        await db.scalars(
            select(PartyContact)
            .where(PartyContact.party_id == party.id, PartyContact.email != "")
            .order_by(PartyContact.is_primary.desc(), PartyContact.created_at)
        )
    ).all()
    if contacts:
        return contacts[0].email.strip().lower(), contacts[0].name
    return (party.email or "").strip().lower(), party.name


async def company_name(db: AsyncSession, branch_id: str) -> str:
    kit = await db.get(CompanyKit, branch_id)
    name = str((kit.data or {}).get("legal_name") or "") if kit is not None else ""
    if name.strip():
        return name.strip()
    b = await db.get(Branch, branch_id)
    return b.name if b else ""


def compose(doc: MoneyDoc, greet: str, company: str, lang: str, on: date) -> tuple[str, str]:
    """(subject, body) of a polite reminder, in the company's language."""
    values = {
        "number": doc.number or doc.id,
        "date": doc.due_date.isoformat() if doc.due_date else "-",
        "amount": svc.amount_text(doc.currency, svc.outstanding(doc)),
        "name": greet or tr("Sir/Madam", lang),
        "company": company,
    }
    if doc.due_date is not None and doc.due_date >= on:
        subject = tr("Payment reminder: invoice {number} is due on {date}", lang, **values)
        body = tr(
            "Dear {name},\n\nThis is a friendly reminder that invoice {number}, for {amount}, "
            "is due on {date}.\n\nIf you have already arranged payment, thank you, and please "
            "ignore this message.\n\nKind regards,\n{company}",
            lang,
            **values,
        )
    else:
        subject = tr("Payment reminder: invoice {number} was due on {date}", lang, **values)
        body = tr(
            "Dear {name},\n\nOur records show that invoice {number}, due on {date}, still has "
            "{amount} outstanding. We would be grateful if you could arrange payment at your "
            "earliest convenience.\n\nIf you have already paid, thank you, and please send us "
            "the payment details so we can update our records.\n\nKind regards,\n{company}",
            lang,
            **values,
        )
    return subject, body


# ---------------------------------------------------------------- the draft


async def company_mailbox(db: AsyncSession, branch_id: str) -> SharedMailbox | None:
    return await db.scalar(
        select(SharedMailbox)
        .where(SharedMailbox.branch_id == branch_id, SharedMailbox.status == "active")
        .order_by(SharedMailbox.created_at)
        .limit(1)
    )


async def _outlook(
    db: AsyncSession,
    box: SharedMailbox | MicrosoftAccount,
    to: str,
    subject: str,
    body: str,
    by: str,
) -> EmailDraft:
    from ..microsoft import approvals, graph

    g = await graph.for_box(db, box)
    draft = await g.create_draft([to], subject, approvals.text_to_html(body))
    agent = (
        await db.get(Agent, box.agent_id)
        if isinstance(box, SharedMailbox) and box.agent_id
        else None
    )
    return await approvals.record_draft(
        db, box=box, agent=agent, draft=draft, to=to, cc="", subject=subject, body=body, by=by
    )


async def _gmail(
    db: AsyncSession, acct: GoogleAccount, to: str, subject: str, body: str
) -> EmailDraft:
    from ..assistants import gmail

    d = await gmail.create_draft(db, acct, to, "", subject, body, None)
    row = EmailDraft(
        workspace_id=acct.workspace_id,
        user_id=acct.user_id,
        agent_id=None,
        account_id=acct.id,
        gmail_draft_id=str(d.get("id", "")),
        thread_id=str((d.get("message") or {}).get("threadId", "")),
        to=to,
        cc="",
        subject=subject[:400],
        body=body,
    )
    db.add(row)
    await db.flush()
    return row


async def draft(
    db: AsyncSession,
    doc: MoneyDoc,
    *,
    step: str,
    actor: str,
    person_id: str | None = None,
    make_task: bool = False,
    email: bool = True,
) -> dict[str, Any]:
    """One reminder for one invoice: an Outlook / Gmail draft when a mailbox is there (and
    `email`; the policy's WhatsApp channel never drafts mail), else a task (make_task) or the
    text. Records it on the doc and the timeline. Commits.
    {"channel": outlook_shared | outlook | gmail | task | text, "draft_id", "task_id",
    "to", "subject", "body", "message"}"""
    doc_id, party_id = doc.id, doc.party_id
    party = await db.get(Party, party_id)
    if party is None:
        raise svc.CrmError(404, "party_not_found", Msg("That customer is not here."))
    on = await svc.today(db, doc.workspace_id)
    lang = await svc.company_lang(db, doc.workspace_id, doc.branch_id)
    to, greet = await recipient(db, party)
    subject, body = compose(doc, greet, await company_name(db, doc.branch_id), lang, on)
    out: dict[str, Any] = {
        "channel": "text",
        "draft_id": None,
        "task_id": None,
        "to": to,
        "subject": subject,
        "body": body,
        "message": None,
    }
    by = tr("The Money page", lang)
    if to and email:
        box = await company_mailbox(db, doc.branch_id)
        try:
            if box is not None:
                row = await _outlook(db, box, to, subject, body, by)
                out.update(channel="outlook_shared", draft_id=row.id)
            elif person_id:
                acct = await db.scalar(
                    select(MicrosoftAccount).where(
                        MicrosoftAccount.workspace_id == doc.workspace_id,
                        MicrosoftAccount.user_id == person_id,
                        MicrosoftAccount.status == "connected",
                    )
                )
                gacct = await db.scalar(
                    select(GoogleAccount).where(
                        GoogleAccount.workspace_id == doc.workspace_id,
                        GoogleAccount.user_id == person_id,
                        GoogleAccount.status == "connected",
                    )
                )
                if acct is not None:
                    row = await _outlook(db, acct, to, subject, body, by)
                    out.update(channel="outlook", draft_id=row.id)
                elif gacct is not None:
                    row = await _gmail(db, gacct, to, subject, body)
                    out.update(channel="gmail", draft_id=row.id)
        except Exception as e:  # noqa: BLE001 - Graph or Gmail refused: the text / a task
            log.info("reminder draft for %s not made: %s", doc_id, e)
            await db.rollback()
            party = await db.get(Party, party_id) or party
            out["message"] = tr(
                "The mailbox could not make the draft: {error}", lang, error=str(e)[:200]
            )
    elif not to:
        out["message"] = tr(
            "{name} has no email address. Add one to the customer or a contact.",
            lang,
            name=party.name,
        )
    doc = await db.get(MoneyDoc, doc_id) or doc  # after a commit (or rollback) above
    if out["channel"] == "text" and make_task:
        out["task_id"] = (await _task(db, doc, party, out, lang)).id
        out["channel"] = "task"
    doc.reminders = [
        *(doc.reminders or []),
        {
            "step": step,
            "at": svc.now().isoformat(),
            "channel": out["channel"],
            "draft_id": out["draft_id"],
            "task_id": out["task_id"],
            "by": actor,
        },
    ]
    what = {
        "outlook_shared": tr("Payment reminder for invoice {number} drafted for approval", lang,
                             number=doc.number or doc.id),
        "outlook": tr("Payment reminder for invoice {number} drafted for approval", lang,
                      number=doc.number or doc.id),
        "gmail": tr("Payment reminder for invoice {number} drafted for approval", lang,
                    number=doc.number or doc.id),
        "task": tr("Payment reminder for invoice {number} written up as a task", lang,
                   number=doc.number or doc.id),
        "text": tr("Payment reminder for invoice {number} written", lang,
                   number=doc.number or doc.id),
    }[out["channel"]]  # fmt: skip
    await svc.log(
        db,
        doc.workspace_id,
        doc.party_id,
        "invoice",
        what,
        actor,
        money_doc_id=doc.id,
        task_id=out["task_id"],
        data={"reminder": step, "channel": out["channel"], "draft_id": out["draft_id"]},
    )
    await db.commit()
    return out


async def _task(
    db: AsyncSession, doc: MoneyDoc, party: Party, out: dict[str, Any], lang: str
) -> Task:
    from .capture import _lowest

    head = tr(
        "No company mailbox could hold this reminder. Send it from the company's email, then "
        "mark this task done.",
        lang,
    )
    if out.get("message"):
        head += f"\n{out['message']}"
    t = Task(
        workspace_id=doc.workspace_id,
        branch_id=doc.branch_id,
        title=tr(
            "Send a payment reminder to {name} for invoice {number}",
            lang,
            name=svc.clean(party.name, 80),
            number=doc.number or doc.id,
        )[:200],
        brief=(f"{head}\n\nTo: {out['to'] or '-'}\nSubject: {out['subject']}\n\n{out['body']}"),
        status="triage",
        priority="normal",
        labels=["reminder", "finance"],
        created_by="system:money",
        source="manual",
        requires_review=False,
        position=await _lowest(db, doc.workspace_id),
    )
    db.add(t)
    await db.flush()
    return t


# ---------------------------------------------------------------- the hourly job


async def run(on: date | None = None) -> int:
    """Draft the reminders that are due, everywhere. Returns how many were made."""
    made = 0
    async with SessionLocal() as db:
        branches = (await db.scalars(select(Branch))).all()
        due: list[tuple[str, str]] = []
        for b in branches:
            policy = policy_of(b)
            if not policy["enabled"] or not policy["days"]:
                continue
            today = on or await svc.today(db, b.workspace_id)
            docs = (
                await db.scalars(
                    select(MoneyDoc).where(
                        MoneyDoc.branch_id == b.id,
                        MoneyDoc.direction == "receivable",
                        MoneyDoc.status.in_(("approved", "sent", "partially_paid")),
                        MoneyDoc.due_date.is_not(None),
                    )
                )
            ).all()
            for d in docs:
                assert d.due_date is not None
                step = step_due(policy["days"], (today - d.due_date).days, steps_done(d))
                if step is not None:
                    due.append((d.id, str(step)))
    for doc_id, step in due:
        if not await valkey().set(f"crm:remind:{doc_id}:{step}", "1", nx=True, ex=LOCK_TTL):
            continue
        try:
            async with SessionLocal() as db:
                doc = await db.get(MoneyDoc, doc_id)
                if doc is None or doc.status not in ("approved", "sent", "partially_paid"):
                    continue
                if step in steps_done(doc):
                    continue
                b = await db.get(Branch, doc.branch_id)
                await draft(
                    db,
                    doc,
                    step=step,
                    actor="system:money",
                    make_task=True,
                    email=policy_of(b)["channel"] == "email",
                )
                made += 1
        except Exception:  # noqa: BLE001 - one invoice must not stop the others
            log.warning("reminder failed for %s", doc_id, exc_info=True)
            await valkey().delete(f"crm:remind:{doc_id}:{step}")
    return made


__all__ = ["ReminderPolicy", "draft", "policy_of", "run", "step_due"]
