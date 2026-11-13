"""P34: Outlook drafts and calendar changes waiting for a person, next to Gmail's.

The AI never sends mail or changes a calendar by itself:
- a reply or a new email is created in the mailbox's Outlook Drafts (Graph) and recorded as
  an EmailDraft(provider="microsoft"); it is sent (graph.send_draft) only when a person
  approves it, and discarding it deletes the Outlook draft;
- a new, changed or cancelled event is a CalendarProposal(provider="microsoft"); only the
  person's "confirm" creates, updates or cancels it in Outlook;
- P102: a Teams message (a reply in a chat, or a first message to anyone in the
  organisation) is an EmailDraft(provider="teams") kept in the office only (Teams has no
  drafts); it is posted (graph.send_chat_message, after graph.one_on_one_chat for a new chat)
  only when the person approves it. Only the connection's own person approves it: never a
  manager, never anyone else.

Who approves: a personal mailbox's are its owner's; a shared mailbox's are approved by its
viewers who manage it (owner/admin, the branch managers of its company). Every send,
discard and confirm is audited.
"""

import html
import json
from collections.abc import Iterable
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
    branch_id: str | Iterable[str] | None,
) -> bool:
    if box is None or box.workspace_id != workspace_id:
        return False
    if isinstance(box, MicrosoftAccount):
        return box.user_id == user_id
    return await access.may_approve_shared(
        db, box, workspace_id=workspace_id, user_id=user_id, role=role, branch_id=branch_id
    )


async def _ask(
    db: AsyncSession,
    box: Box,
    title: str,
    body: str,
    dedupe: str,
    *,
    can_assist: dict[str, bool],
    page: str = "/mail#mail-drafts",
) -> None:
    """Notify whoever approves: a person's own drafts open on My assistants when they have
    assistants, else on the Mail page (`page`)."""
    from ..assistants.access import may_assist
    from ..channels import deliver
    from ..models import Membership

    ids: list[str] = []
    for uid in await access.approver_ids(db, box):
        if uid not in can_assist:
            m = await db.get(Membership, (box.workspace_id, uid))
            can_assist[uid] = bool(m and may_assist(m.role))
        own = can_assist[uid] and is_personal(box)
        url = "/assistants?tab=drafts" if own else page
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


async def update_draft(
    db: AsyncSession, d: EmailDraft, box: Box, old_body: str | None = None
) -> None:
    """The person edited a draft: Outlook's copy changes too. P102: in a reply or forward only
    the AI's text is swapped (`old_body` was it), so the quoted or forwarded mail below it
    stays; when it cannot be found the whole body is replaced, as before."""
    if d.provider == TEAMS:
        return  # P102: a Teams message lives only here until it is sent
    g = await graph.for_box(db, box)
    body_html = text_to_html(d.body)
    if d.in_reply_to and old_body is not None:
        try:
            current = await g.get_message(d.gmail_draft_id, body_type="html")
        except graph.MicrosoftError:
            current = {}
        html_now = str((current.get("body") or {}).get("content") or "")
        mine = text_to_html(old_body)
        if old_body and mine in html_now:
            body_html = html_now.replace(mine, text_to_html(d.body), 1)
        elif not old_body and html_now:
            body_html = text_to_html(d.body) + html_now  # a forward that had no note yet
    await g.update_draft(d.gmail_draft_id, subject=d.subject, body_html=body_html, to=d.to, cc=d.cc)


async def send_draft(db: AsyncSession, d: EmailDraft, box: Box, actor: str) -> None:
    """The person approved: Outlook sends the draft (P102: or Teams posts the message).
    Raises GraphError (the caller says what went wrong); a refusal (4xx) marks the draft
    failed."""
    if d.provider == TEAMS:
        await _send_teams(db, d, box)
        await audit.record(
            db,
            d.workspace_id,
            actor,
            "teams_message.sent",
            target=d.id,
            after={"to": d.to, "chat_id": d.thread_id, "new_chat": not d.in_reply_to,
                   "agent_id": d.agent_id},
        )  # fmt: skip
        await db.commit()
        return
    g = await graph.for_box(db, box)
    try:
        await g.send_draft(d.gmail_draft_id)
    except graph.GraphError as e:
        await _failed(db, d, e)
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


async def _failed(db: AsyncSession, d: EmailDraft, e: graph.GraphError) -> None:
    """A refusal (4xx) fails the draft for good; anything else can be tried again."""
    if e.status not in (0, 429) and e.status < 500:
        d.status, d.error = "failed", str(e)[:500]
    else:
        d.error = str(e)[:500]
    await db.commit()


async def discard_draft(db: AsyncSession, d: EmailDraft, box: Box | None, actor: str) -> None:
    if d.status != "pending":
        return
    if box is not None and d.provider != TEAMS:
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
        after={"provider": d.provider or "microsoft", "subject": d.subject[:200]},
    )
    await db.commit()


# ---------------------------------------------------------------- Teams messages (P102)

TEAMS = "teams"
TEAMS_MAX = 4000  # characters in one message


async def record_teams_draft(
    db: AsyncSession,
    *,
    acct: MicrosoftAccount,
    agent: Agent | None,
    chat_id: str,
    to: str,
    title: str,
    text: str,
    last_from: str = "",
    last_text: str = "",
) -> EmailDraft:
    """A Teams message the AI wrote, waiting for its person. `chat_id` is the chat it answers
    (`title`: who is in it); empty for a first message to `to` (an address in the
    organisation), whose one-to-one chat is found or started only once it is approved."""
    row = EmailDraft(
        workspace_id=acct.workspace_id,
        user_id=acct.user_id,
        agent_id=agent.id if agent is not None else None,
        account_id=None,
        gmail_draft_id="",
        thread_id=chat_id[:400],
        in_reply_to=chat_id[:400],
        to=to,
        cc="",
        subject=title[:400],
        body=text[:TEAMS_MAX],
        original_from=last_from[:300],
        original_snippet=last_text[:1000],
        provider=TEAMS,
        ms_account_id=acct.id,
        shared_mailbox_id=None,
    )
    db.add(row)
    await db.commit()
    await _ask(
        db,
        acct,
        Msg("{name} drafted a Teams message", name=agent.name if agent is not None else ""),
        Msg(
            "To {to} in Teams:\n\n{preview}\n\nApprove to send it.",
            to=title or to,
            preview=text[:300] + ("…" if len(text) > 300 else ""),
        ),
        f"draft:{row.id}",
        can_assist={},
        page="/mail?app=teams#mail-drafts",
    )
    return row


def _teams_error(e: graph.GraphError, d: EmailDraft) -> graph.GraphError:
    """What went wrong posting a Teams message, in words the person can act on."""
    if e.status == 403:
        text = (
            Msg(
                "Starting a new Teams chat is not allowed yet. Press Allow new Teams chats on "
                "Microsoft 365 > Teams, then send it again."
            )
            if not d.in_reply_to
            else Msg("Teams did not allow this message. Reconnect Microsoft 365, then try again.")
        )
    elif not d.in_reply_to and e.status in (400, 404):
        text = Msg("No one with the address {to} was found in your organisation's Teams.", to=d.to)
    elif e.status == 404:
        text = Msg("That Teams chat was not found. It may have been deleted.")
    else:
        return e
    return type(e)(text, e.status, e.code)


async def _send_teams(db: AsyncSession, d: EmailDraft, box: Box) -> None:
    if not is_personal(box) or d.ms_account_id != box.id:
        raise graph.GraphError(Msg("A Teams message is sent only from its own person's Teams."))
    g = await graph.for_account(db, box)
    try:
        chat_id = d.thread_id
        if not chat_id:
            me = box.ms_user_id or str((await g.me()).get("id") or "")
            chat_id = str((await g.one_on_one_chat(me, d.to)).get("id") or "")
            if not chat_id:
                raise graph.GraphError(Msg("Microsoft did not start the Teams chat."), 502)
            d.thread_id = chat_id[:400]
        await g.send_chat_message(chat_id, d.body[:TEAMS_MAX])
    except graph.GraphError as e:
        err = _teams_error(e, d)
        await _failed(db, d, err)
        raise err from e
    d.status, d.decided_at, d.error = "sent", now(), None


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
    branch_id: str | Iterable[str] | None,
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
