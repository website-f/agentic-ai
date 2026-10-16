"""P34: Outlook drafts and calendar changes waiting for a person, next to Gmail's.

The AI never sends mail or changes a calendar by itself:
- a reply or a new email is created in the mailbox's Outlook Drafts (Graph) and recorded as
  an EmailDraft(provider="microsoft"); it is sent (graph.send_draft) only when a person
  approves it, and discarding it deletes the Outlook draft;
- a new, changed or cancelled event is a CalendarProposal(provider="microsoft"); only the
  person's "confirm" creates, updates or cancels it in Outlook.

Who approves: a personal mailbox's are its owner's; a shared mailbox's are approved by its
viewers who manage it (owner/admin, the branch managers of its company). Every send,
discard and confirm is audited.
"""

import html
import json
from datetime import UTC, datetime
from typing import Any, TypeGuard

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.ids import new_id
from ..i18n import Msg
from ..models import Agent, CalendarProposal, EmailDraft, MailItem, MicrosoftAccount, SharedMailbox
from ..services import audit
from . import access, graph

Box = MicrosoftAccount | SharedMailbox


def now() -> datetime:
    return datetime.now(UTC)


def text_to_html(text: str) -> str:
    """What the AI wrote (plain text) as the HTML Outlook expects."""
    return "<div>" + html.escape(text or "").replace("\n", "<br>") + "</div>"


def is_personal(box: Box) -> TypeGuard[MicrosoftAccount]:
    return isinstance(box, MicrosoftAccount)


def box_fields(box: Box) -> dict[str, Any]:
    return {
        "provider": "microsoft",
        "ms_account_id": box.id if is_personal(box) else None,
        "shared_mailbox_id": None if is_personal(box) else box.id,
    }


async def box_of(db: AsyncSession, row: EmailDraft | CalendarProposal) -> Box | None:
    if row.ms_account_id:
        return await db.get(MicrosoftAccount, row.ms_account_id)
    if row.shared_mailbox_id:
        return await db.get(SharedMailbox, row.shared_mailbox_id)
    return None


async def may_approve(
    db: AsyncSession,
    box: Box | None,
    *,
    workspace_id: str,
    user_id: str,
    role: str,
    branch_id: str | None,
) -> bool:
    if box is None or box.workspace_id != workspace_id:
        return False
    if isinstance(box, MicrosoftAccount):
        return box.user_id == user_id
    return await access.may_approve_shared(
        db, box, workspace_id=workspace_id, user_id=user_id, role=role, branch_id=branch_id
    )


async def _ask(
    db: AsyncSession, box: Box, title: str, body: str, dedupe: str, *, can_assist: dict[str, bool]
) -> None:
    """Notify whoever approves: a person's own drafts open on My assistants when they have
    assistants, else on the Mail page."""
    from ..assistants.access import may_assist
    from ..channels import deliver
    from ..models import Membership

    ids: list[str] = []
    for uid in await access.approver_ids(db, box):
        if uid not in can_assist:
            m = await db.get(Membership, (box.workspace_id, uid))
            can_assist[uid] = bool(m and may_assist(m.role))
        own = can_assist[uid] and is_personal(box)
        url = "/assistants?tab=drafts" if own else "/mail#mail-drafts"
        ids += await deliver.notify_user(
            db, box.workspace_id, uid, title, body, url, dedupe=f"{dedupe}:{uid}"
        )
    await deliver.start(ids)


# ---------------------------------------------------------------- drafts


async def record_draft(
    db: AsyncSession,
    *,
    box: Box,
    agent: Agent | None,
    draft: dict[str, Any],
    to: str,
    cc: str,
    subject: str,
    body: str,
    original: dict[str, Any] | None = None,
    item: MailItem | None = None,
    by: str | None = None,
) -> EmailDraft:
    """An Outlook draft the AI made (or the office made, P35: a payment reminder; `by` names
    who then), recorded for approval; the approvers are notified."""
    sender = ((original or {}).get("from") or {}).get("emailAddress") or {}
    row = EmailDraft(
        workspace_id=box.workspace_id,
        user_id=box.user_id if is_personal(box) else None,
        agent_id=agent.id if agent is not None else None,
        account_id=None,
        gmail_draft_id=str(draft.get("id") or "")[:400],
        thread_id=str(draft.get("conversationId") or (original or {}).get("conversationId") or "")[
            :400
        ],
        in_reply_to=str((original or {}).get("id") or "")[:400],
        to=to,
        cc=cc,
        subject=subject[:400],
        body=body,
        original_from=(
            f"{sender.get('name') or ''} <{sender.get('address') or ''}>".strip() if sender else ""
        )[:300],
        original_snippet=str((original or {}).get("bodyPreview") or "")[:1000],
        **box_fields(box),
    )
    db.add(row)
    if item is not None:
        item.actions = [
            *(item.actions or []),
            {"kind": "draft", "label": subject[:200], "draft_id": row.id, "at": now().isoformat()},
        ]
    await db.commit()
    await _ask(
        db,
        box,
        Msg("{name} drafted an email", name=agent.name if agent is not None else (by or "")),
        Msg(
            "To {to}: {subject}\n\n{preview}\n\nApprove to send it.",
            to=to,
            subject=subject,
            preview=body[:300] + ("…" if len(body) > 300 else ""),
        ),
        f"draft:{row.id}",
        can_assist={},
    )
    return row


async def update_draft(db: AsyncSession, d: EmailDraft, box: Box) -> None:
    g = await graph.for_box(db, box)
    await g.update_draft(
        d.gmail_draft_id, subject=d.subject, body_html=text_to_html(d.body), to=d.to, cc=d.cc
    )


async def send_draft(db: AsyncSession, d: EmailDraft, box: Box, actor: str) -> None:
    """The person approved: Outlook sends the draft. Raises GraphError (the caller says
    what went wrong); a refusal (4xx) marks the draft failed."""
    g = await graph.for_box(db, box)
    try:
        await g.send_draft(d.gmail_draft_id)
    except graph.GraphError as e:
        if e.status not in (0, 429) and e.status < 500:
            d.status, d.error = "failed", str(e)[:500]
        else:
            d.error = str(e)[:500]
        await db.commit()
        raise
    d.status, d.decided_at, d.error = "sent", now(), None
    await audit.record(
        db,
        d.workspace_id,
        actor,
        "email_draft.sent",
        target=d.id,
        after={"provider": "microsoft", "mailbox": access.address_of(box), "to": d.to,
               "subject": d.subject[:200], "agent_id": d.agent_id},
    )  # fmt: skip
    await db.commit()


async def discard_draft(db: AsyncSession, d: EmailDraft, box: Box | None, actor: str) -> None:
    if d.status != "pending":
        return
    if box is not None:
        try:
            g = await graph.for_box(db, box)
            await g.delete_message(d.gmail_draft_id)
        except graph.MicrosoftError:
            pass  # gone already, or Microsoft is down: it stays in Drafts, harmless
    d.status, d.decided_at = "discarded", now()
    await audit.record(
        db,
        d.workspace_id,
        actor,
        "email_draft.discarded",
        target=d.id,
        after={"provider": "microsoft", "subject": d.subject[:200]},
    )
    await db.commit()


# ---------------------------------------------------------------- calendar proposals


async def propose(
    db: AsyncSession,
    *,
    box: Box,
    agent: Agent,
    action: str,  # create | update | cancel
    title: str,
    summary: str,
    body: dict[str, Any],
    notify: bool,
    event_id: str = "",
    before: str = "",
) -> dict[str, Any]:
    """A calendar change for a person to confirm. `body`: what apply() needs (create: the
    event fields; update: Graph event properties; cancel: a comment)."""
    t = now()
    p = {
        "id": new_id("cp"),
        "workspace_id": box.workspace_id,
        "user_id": box.user_id if is_personal(box) else None,
        "agent_id": agent.id,
        "agent_name": agent.name,
        "action": action,
        "event_id": event_id,
        "title": title[:300],
        "summary": summary[:2000],
        "before": before[:2000],
        "body": body,
        "notify": notify,
        "status": "pending",
        "error": None,
        "link": "",
        "created_at": t.isoformat(),
        "decided_at": None,
        "mailbox_label": access.label_of(box),
        "mailbox_address": access.address_of(box),
        **box_fields(box),
    }
    db.add(
        CalendarProposal(
            id=p["id"],
            workspace_id=box.workspace_id,
            user_id=p["user_id"],
            status="pending",
            data=json.loads(json.dumps(p, default=str)),
            created_at=t,
            **box_fields(box),
        )
    )
    await db.commit()
    title_msg = {
        "create": Msg("{name} wants to add a calendar event", name=agent.name),
        "update": Msg("{name} wants to change a calendar event", name=agent.name),
        "cancel": Msg("{name} wants to cancel a calendar event", name=agent.name),
    }[action]
    confirm = {
        "create": Msg("Confirm it to add it."),
        "update": Msg("Confirm it to change it."),
        "cancel": Msg("Confirm it to cancel it."),
    }[action]
    await _ask(
        db,
        box,
        title_msg,
        Msg("{summary}\n\n{confirm}", summary=summary, confirm=confirm),
        f"calprop:{p['id']}",
        can_assist={},
    )
    return p


async def save(db: AsyncSession, row: CalendarProposal, p: dict[str, Any]) -> None:
    row.status = p["status"]
    row.data = json.loads(json.dumps(p, default=str))  # a fresh object: the change is saved
    await db.commit()


async def apply(db: AsyncSession, box: Box, p: dict[str, Any]) -> dict[str, Any]:
    """Run a confirmed proposal in Outlook. Returns the event (or {})."""
    g = await graph.for_box(db, box)
    body = p.get("body") or {}
    if p["action"] == "create":
        start = graph.parse_time(body.get("start"))
        end = graph.parse_time(body.get("end"))
        if start is None or end is None:
            raise graph.GraphError(Msg("The proposed event has no time."), 400)
        return await g.create_event(
            str(body.get("subject") or p.get("title") or ""),
            start,
            end,
            attendees=list(body.get("attendees") or []),
            body_html=text_to_html(body["description"]) if body.get("description") else "",
            location=str(body.get("location") or ""),
            online_meeting=bool(body.get("online_meeting")),
        )
    if p["action"] == "update":
        return await g.update_event(p["event_id"], dict(body.get("changes") or {}))
    await g.cancel_event(p["event_id"], str(body.get("comment") or ""))
    return {}


async def confirm(db: AsyncSession, row: CalendarProposal, box: Box, actor: str) -> dict[str, Any]:
    """The person said yes. Raises GraphError when Outlook refused (saved on the proposal)."""
    p = dict(row.data)
    try:
        ev = await apply(db, box, p)
    except graph.GraphError as e:
        if e.status not in (0, 429) and e.status < 500:
            p["status"], p["error"] = "failed", str(e)[:500]
            p["decided_at"] = now().isoformat()
        else:
            p["error"] = str(e)[:500]
        await save(db, row, p)
        raise
    p["status"], p["error"], p["link"] = "done", None, str(ev.get("webLink") or "")
    p["decided_at"] = now().isoformat()
    if ev.get("id"):
        p["event_id"] = ev["id"]
    await audit.record(
        db,
        row.workspace_id,
        actor,
        "calendar_proposal.confirmed",
        target=row.id,
        after={"provider": "microsoft", "mailbox": access.address_of(box),
               "action": p["action"], "title": p["title"][:200], "agent_id": p.get("agent_id")},
    )  # fmt: skip
    await save(db, row, p)
    return p


async def discard_proposal(db: AsyncSession, row: CalendarProposal, actor: str) -> dict[str, Any]:
    p = dict(row.data)
    if p["status"] in ("pending", "expired"):
        p["status"], p["decided_at"] = "discarded", now().isoformat()
        await audit.record(
            db,
            row.workspace_id,
            actor,
            "calendar_proposal.discarded",
            target=row.id,
            after={"provider": "microsoft", "title": p["title"][:200]},
        )
        await save(db, row, p)
    return p


async def shared_proposals(
    db: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    role: str,
    branch_id: str | None,
    pending_only: bool,
) -> list[dict[str, Any]]:
    """Proposals on shared mailboxes this person approves (personal ones carry user_id and
    come with the person's own list)."""
    from datetime import timedelta

    from ..assistants.calendar import PENDING_DAYS

    cond = access.approvable_where(workspace_id, user_id, role, branch_id)
    if cond is None:
        return []
    q = select(CalendarProposal).where(
        CalendarProposal.workspace_id == workspace_id,
        CalendarProposal.shared_mailbox_id.in_(select(SharedMailbox.id).where(cond)),
    )
    if pending_only:
        q = q.where(
            CalendarProposal.status == "pending",
            CalendarProposal.created_at >= now() - timedelta(days=PENDING_DAYS),
        )
    rows = (await db.scalars(q.order_by(CalendarProposal.created_at.desc()).limit(100))).all()
    return [dict(r.data) for r in rows]
