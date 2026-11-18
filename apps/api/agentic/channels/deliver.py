"""The delivery ledger: every outbound notification is a row first, then a send.

A row has a dedupe key (approval x device), so a retry or a restart never sends twice, and a
send that fails stays visible in the dashboard with its error.

Languages (P22): a notice is written in each RECIPIENT's language (users.prefs locale), not
the language of whoever caused it. Callers pass English as an i18n.Msg (or plain English
whose template is in i18n/ms.py); the row stores the rendered text. Text a person or an
agent wrote goes in as i18n.Plain and is never translated.
"""

import hashlib
import html
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.security import can
from ..engine import compliance
from ..i18n import Msg, Plain, current_lang, normalize, render, tr
from ..models import (
    ActionToken,
    Agent,
    Approval,
    Channel,
    ChannelLink,
    Delivery,
    Membership,
    PushSubscription,
    Task,
    User,
)
from ..services import events, notify_prefs, prefs
from . import telegram, webpush, whatsapp

log = logging.getLogger("agentic.channels.deliver")

TOKEN_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 3


class Retry(Exception):
    """A temporary failure: let Temporal try again."""


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def channel_token(ch: Channel) -> str:
    return crypto.decrypt(ch.config_enc, f"channel:{ch.id}")


async def deciders(
    db: AsyncSession, workspace_id: str, agent: Agent | None = None, *, budget: bool = False
) -> list[User]:
    """People who may decide; given the asking agent, only those whose scope covers it (a
    staff member hears about their own agents, a HOD about the department's). P36: more
    budget or allowance only managers (agents.decisions.GRANTERS)."""
    from ..agents.decisions import GRANTERS  # late: decisions imports this package
    from ..api.scope import Scope

    rows = (
        await db.execute(
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.workspace_id == workspace_id,
                User.is_active.is_(True),
                Membership.access != "prima_only",  # P99: not in the office
            )
        )
    ).all()
    return [
        u
        for u, m in rows
        if can(m.role, "approvals.decide")
        and (not budget or any(can(m.role, p) for p in GRANTERS))
        and (agent is None or Scope.of_member(m).sees_agent(agent))
    ]


def describe(a: Approval, agent_name: str) -> tuple[Msg, Msg]:
    """Title and body of an approval notice: English Msgs, rendered per recipient."""
    reason = Plain(a.reason) if a.reason else None  # the agent wrote it: never translated
    if a.kind == "question":
        title = Msg("{name} has a question", name=agent_name)
        return title, Msg("{text}", text=reason) if reason else Msg("Open it to answer.")
    if a.kind == "budget":
        title = Msg("{name} is over budget", name=agent_name)
        if reason:
            return title, Msg("{text}", text=reason)
        return title, Msg("Approve more budget to continue.")
    from ..agents.tools import TOOLS  # late: tools import the brain and skills

    if a.tool_name in TOOLS:
        tool: str = ToolLabel(TOOLS[a.tool_name].label)
    else:
        tool = a.tool_name.replace("_", " ")
    title = Msg("{name} needs a decision", name=agent_name)
    if reason:
        return title, Msg("Wants to: {tool}: {why}", tool=tool, why=reason)
    return title, Msg("Wants to: {tool}", tool=tool)


class ToolLabel(Msg):
    """A tool's label inside "Wants to: ...": lower case in English ("send an email"), the
    translated label in other languages."""

    def __new__(cls, label: str) -> "ToolLabel":
        obj = str.__new__(cls, label.lower())
        obj.template, obj.vars = label, {}
        return obj

    def render(self, lang: str | None = None) -> str:
        lang = normalize(lang) or current_lang()
        if lang == "en":
            return self.template.lower()
        label = tr(self.template, lang)
        return label[:1].lower() + label[1:]  # "Mahu baca halaman web"


async def _add(db: AsyncSession, d: Delivery) -> str | None:
    """Insert unless the same delivery exists (dedupe key)."""
    try:
        async with db.begin_nested():
            db.add(d)
            await db.flush()
    except IntegrityError:
        return None
    return d.id


async def approval_requested(db: AsyncSession, a: Approval) -> list[str]:
    agent = await db.get(Agent, a.agent_id)
    task = await db.get(Task, a.task_id)
    name = agent.name if agent else Msg("An agent")
    title_msg, body_msg = describe(a, name)
    pending = (
        await db.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.workspace_id == a.workspace_id, Approval.status == "pending")
        )
        or 1
    )
    now = datetime.now(UTC)
    ids: list[str] = []
    # P114: whose AI is asking (its owner, and the person whose request the task is).
    mine = await _askers_people(db, a, agent, task)
    limit = (a.tool_call_id or "").startswith("allowance:")
    who = await deciders(db, a.workspace_id, agent, budget=a.kind == "budget")
    for user in who:
        lang = prefs.lang_of(user)  # the recipient's language, not the agent's or the asker's
        title, body = render(title_msg, lang), render(body_msg, lang)
        event = "my_ai" if user.id in mine else "approvals"
        if notify_prefs.wants(user, event, "email"):
            did = await _queue_email(
                db,
                a.workspace_id,
                user,
                title,
                body + ("\n" + tr("Task: {title}", lang, title=task.title) if task else ""),
                f"/approve/{a.id}",
                f"approval:{a.id}:{user.id}",
                lang,
                now,
            )
            if did:
                ids.append(did)
        subs = (
            (
                await db.scalars(
                    select(PushSubscription).where(
                        PushSubscription.user_id == user.id,
                        PushSubscription.workspace_id == a.workspace_id,
                    )
                )
            ).all()
            if notify_prefs.wants(user, event, "app")
            else []
        )
        for sub in subs:
            raw = secrets.token_urlsafe(32)
            db.add(
                ActionToken(
                    token_hash=token_hash(raw),
                    approval_id=a.id,
                    user_id=user.id,
                    expires_at=now + TOKEN_TTL,
                )
            )
            did = await _add(
                db,
                Delivery(
                    workspace_id=a.workspace_id,
                    channel="webpush",
                    target=sub.id,
                    kind="approval",
                    payload={
                        "title": title,
                        "body": body,
                        "approval_id": a.id,
                        "url": f"/approve/{a.id}",
                        "badge": pending,
                        "tag": f"approval-{a.id}",
                        "question": a.kind == "question",
                        # Encrypted until the moment of sending, then dropped from the row.
                        "token_enc": crypto.encrypt(raw, f"action_token:{a.id}"),
                    },
                    dedupe_key=f"approval:{a.id}:push:{sub.id}",
                    created_at=now,
                ),
            )
            if did:
                ids.append(did)
        links = (
            await db.execute(
                select(ChannelLink, Channel)
                .join(Channel, Channel.id == ChannelLink.channel_id)
                .where(
                    ChannelLink.user_id == user.id,
                    Channel.workspace_id == a.workspace_id,
                    Channel.enabled.is_(True),
                )
            )
        ).all()
        for link, ch in links:
            if not notify_prefs.wants(user, event, ch.kind):
                continue
            task_line = "\n" + tr("Task: {title}", lang, title=task.title) if task else ""
            if ch.kind == "whatsapp":
                from ..core.config import settings

                link_url = f"{settings.public_url}/approve/{a.id}"
                if a.kind == "question":
                    open_line = tr("Open to answer: {url}", lang, url=link_url)
                else:
                    open_line = tr("Open to approve or deny: {url}", lang, url=link_url)
                did = await _add(
                    db,
                    Delivery(
                        workspace_id=a.workspace_id,
                        channel="whatsapp",
                        target=f"{ch.id}:{link.chat_id}",
                        kind="approval",
                        payload={
                            "text": f"*{title}*{task_line}\n\n{body}\n\n{open_line}",
                            "approval_id": a.id,
                        },
                        dedupe_key=f"approval:{a.id}:wa:{link.id}",
                        created_at=now,
                    ),
                )
                if did:
                    ids.append(did)
                continue
            if a.kind == "question":
                reply_line = tr("Reply to this message with your answer.", lang)
                text = f"❓ {title}{task_line}\n\n{body}\n\n{reply_line}"
                buttons = None
            else:
                text = f"🔔 {title}{task_line}\n\n{body}"
                buttons = [
                    [
                        {
                            "text": "✅ " + tr("Approve", lang),
                            "callback_data": f"apv:{a.id}:approve",
                        },
                        {"text": "✖️ " + tr("Deny", lang), "callback_data": f"apv:{a.id}:deny"},
                    ]
                ]
            did = await _add(
                db,
                Delivery(
                    workspace_id=a.workspace_id,
                    channel="telegram",
                    target=f"{ch.id}:{link.chat_id}",
                    kind="approval",
                    payload={"text": text, "buttons": buttons, "approval_id": a.id},
                    dedupe_key=f"approval:{a.id}:tg:{link.id}",
                    created_at=now,
                ),
            )
            if did:
                ids.append(did)
    # P114: the person whose AI asks hears of it too when only a manager may decide (more
    # allowance, more budget): what waits and that a manager was asked.
    told = {u.id for u in who}
    for uid in mine - told:
        if limit:
            t_msg = Msg("Your AI allowance for today is used up")
            b_msg = Msg(
                '{name} paused "{title}". A manager was asked to give you more; it carries on '
                "as soon as they do, or tomorrow.",
                name=name,
                title=(task.title[:100] if task else ""),
            )
        else:
            t_msg = Msg("{name} is waiting for a manager", name=name)
            b_msg = Msg(
                '{name} asked a manager about "{title}". It carries on once they decide.',
                name=name,
                title=(task.title[:100] if task else ""),
            )
        ids += await _queue_for_user(
            db,
            a.workspace_id,
            uid,
            t_msg,
            b_msg,
            f"/tasks?task={a.task_id}",
            f"approval:{a.id}:mine",
            event="limit" if limit else "my_ai",
        )
    await db.commit()
    return ids


async def _askers_people(
    db: AsyncSession, a: Approval, agent: Agent | None, task: Task | None
) -> set[str]:
    """P114: the people an agent's ask is about: the agent's owner (their own AI) and the
    person whose request the task is (their allowance pays)."""
    from ..teams import allowance  # late: teams import the agents that import this

    out: set[str] = set()
    if agent is not None and agent.owner_user_id:
        out.add(agent.owner_user_id)
    person = str((a.args or {}).get("user_id") or "") if a.kind == "budget" else ""
    if person:
        out.add(person)
    elif task is not None:
        try:
            p = await allowance.person_of_task(db, task)
        except Exception:  # noqa: BLE001 - only who hears of it
            p = None
        if p:
            out.add(p)
    return out


async def _queue_for_user(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    title: str,
    body: str,
    url: str,
    dedupe: str,
    lang: str | None = None,
    *,
    event: str = "other",
    email: bool = True,
) -> list[str]:
    """One person, every way they can be reached: each device, linked Telegram and WhatsApp,
    and (P114) email from the office's system mailbox. Title and body are said in the person's
    language. P114: only the channels and kinds of notice (`event`, notify_prefs.EVENTS) the
    person left on. `email=False` for callers that send their own email."""
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return []
    lang = lang or prefs.lang_of(user)
    title, body = render(title, lang), render(body, lang)
    now = datetime.now(UTC)
    ids: list[str] = []
    if email and notify_prefs.wants(user, event, "email"):
        did = await _queue_email(db, workspace_id, user, title, body, url, dedupe, lang, now)
        if did:
            ids.append(did)
    devices = (
        (
            await db.scalars(
                select(PushSubscription).where(
                    PushSubscription.user_id == user_id,
                    PushSubscription.workspace_id == workspace_id,
                )
            )
        ).all()
        if notify_prefs.wants(user, event, "app")
        else []
    )
    for sub in devices:
        did = await _add(
            db,
            Delivery(
                workspace_id=workspace_id,
                channel="webpush",
                target=sub.id,
                kind="notice",
                payload={"title": title, "body": body, "url": url, "tag": dedupe},
                dedupe_key=f"{dedupe}:push:{sub.id}",
                created_at=now,
            ),
        )
        if did:
            ids.append(did)
    from ..core.config import settings

    for link, ch in (
        await db.execute(
            select(ChannelLink, Channel)
            .join(Channel, Channel.id == ChannelLink.channel_id)
            .where(
                ChannelLink.user_id == user_id,
                Channel.workspace_id == workspace_id,
                Channel.enabled.is_(True),
            )
        )
    ).all():
        wa = ch.kind == "whatsapp"
        if not notify_prefs.wants(user, event, "whatsapp" if wa else "telegram"):
            continue
        text = f"*{title}*\n\n{body}" if wa else f"{title}\n\n{body}"
        if url and url.startswith("/"):
            text += f"\n\n{settings.public_url}{url}"
        did = await _add(
            db,
            Delivery(
                workspace_id=workspace_id,
                channel="whatsapp" if wa else "telegram",
                target=f"{ch.id}:{link.chat_id}",
                kind="notice",
                payload={"text": text},
                dedupe_key=f"{dedupe}:{'wa' if wa else 'tg'}:{link.id}",
                created_at=now,
            ),
        )
        if did:
            ids.append(did)
    return ids


def email_html(name: str, title: str, body: str, link: str, lang: str) -> str:
    """P114: one notice by email, in the person's language: hello, what happened, the button."""
    from ..services.signin_mail import _page

    ms = lang == "ms"
    n, ti, u = html.escape(name), html.escape(title), html.escape(link, quote=True)
    lines = "".join(
        f'<p style="margin:0 0 10px">{html.escape(x)}</p>' for x in body.split("\n") if x.strip()
    )
    btn = (
        f'<p style="margin:16px 0"><a href="{u}" style="display:inline-block;padding:10px 18px;'
        "border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;"
        f'font-weight:600">{"Buka" if ms else "Open it"}</a></p>'
    )
    off = (
        "Tukar notifikasi anda di Tetapan &gt; Notifikasi saya."
        if ms
        else "Change your notifications in Settings &gt; My notifications."
    )
    hello = "Salam" if ms else "Hello"
    return _page(
        f'<p style="margin:0 0 10px">{hello} {n},</p>'
        f'<p style="margin:0 0 10px;font-size:16px;font-weight:600">{ti}</p>{lines}{btn}'
        f'<p style="margin:0;font-size:12.5px;color:#6b7280">{off}</p>'
    )


async def _queue_email(
    db: AsyncSession,
    workspace_id: str,
    user: User,
    title: str,
    body: str,
    url: str,
    dedupe: str,
    lang: str,
    now: datetime,
) -> str | None:
    """P114: a notice by email, when the office's system mailbox is on and the person has a
    real address. Sent by the worker like every other delivery (deliver: "email")."""
    from ..core.config import settings
    from ..core.workspace_settings import system_mail, valid_address
    from ..models import Workspace

    ws = await db.get(Workspace, workspace_id)
    if not system_mail(ws.settings if ws else None).ready or not valid_address(user.email or ""):
        return None
    base = settings.public_url.rstrip("/")
    link = f"{base}{url}" if url.startswith("/") else (url or base)
    return await _add(
        db,
        Delivery(
            workspace_id=workspace_id,
            channel="email",
            target=user.id,
            kind="notice",
            payload={
                "subject": title[:200],
                "html": email_html(user.name, title, body, link, lang),
            },
            dedupe_key=f"{dedupe}:email",
            created_at=now,
        ),
    )


async def notify_people(
    db: AsyncSession,
    workspace_id: str,
    title: str,
    body: str,
    url: str,
    *,
    dedupe: str,
    perm: str = "approvals.decide",
    event: str = "other",
) -> list[str]:
    """A plain notice (no buttons) to everyone with `perm`: every device, Telegram, WhatsApp.
    `title` / `body`: English (a Msg, or text with a template in i18n/ms.py); each person
    gets it in their own language."""
    ids: list[str] = []
    rows = (
        await db.execute(
            select(User, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.workspace_id == workspace_id,
                User.is_active.is_(True),
                Membership.access != "prima_only",  # P99: not in the office
            )
        )
    ).all()
    for user, role in rows:
        if can(role, perm):
            ids += await _queue_for_user(
                db,
                workspace_id,
                user.id,
                title,
                body,
                url,
                dedupe,
                prefs.lang_of(user),
                event=event,
            )
    await db.commit()
    return ids


async def notify_user(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    title: str,
    body: str,
    url: str,
    *,
    dedupe: str,
    event: str = "other",
    email: bool = True,
) -> list[str]:
    """A notice to one person on every channel they set up, in their language (see
    notify_people). Returns the delivery ids. P114: `event` is the kind of notice the person
    can switch off (notify_prefs.EVENTS); `email=False` when the caller emails them itself."""
    ids = await _queue_for_user(
        db, workspace_id, user_id, title, body, url, dedupe, event=event, email=email
    )
    await db.commit()
    return ids


async def reach(db: AsyncSession, workspace_id: str, user_id: str) -> list[str]:
    """How a person can be reached: "app" (a device), "telegram", "whatsapp"."""
    out = []
    if await db.scalar(
        select(PushSubscription.id).where(
            PushSubscription.user_id == user_id, PushSubscription.workspace_id == workspace_id
        )
    ):
        out.append("app")
    kinds = (
        await db.scalars(
            select(Channel.kind)
            .join(ChannelLink, ChannelLink.channel_id == Channel.id)
            .where(
                ChannelLink.user_id == user_id,
                Channel.workspace_id == workspace_id,
                Channel.enabled.is_(True),
            )
        )
    ).all()
    return out + sorted(set(kinds))


async def queue_whatsapp(
    db: AsyncSession,
    ch: Channel,
    chat_id: str,
    text: str,
    kind: str = "reply",
    dedupe: str | None = None,
) -> str | None:
    did = await _add(
        db,
        Delivery(
            workspace_id=ch.workspace_id,
            channel="whatsapp",
            target=f"{ch.id}:{chat_id}",
            kind=kind,
            payload={"text": text},
            dedupe_key=dedupe,
            created_at=datetime.now(UTC),
        ),
    )
    await db.commit()
    return did


async def queue_telegram(
    db: AsyncSession,
    ch: Channel,
    chat_id: str,
    text: str,
    kind: str = "reply",
    dedupe: str | None = None,
    buttons: list[list[dict[str, str]]] | None = None,
) -> str | None:
    did = await _add(
        db,
        Delivery(
            workspace_id=ch.workspace_id,
            channel="telegram",
            target=f"{ch.id}:{chat_id}",
            kind=kind,
            payload={"text": text, "buttons": buttons},
            dedupe_key=dedupe,
            created_at=datetime.now(UTC),
        ),
    )
    await db.commit()
    return did


def _redact(text: str) -> str:
    return text.replace("\n", " ")[:500]


async def deliver(db: AsyncSession, delivery_id: str) -> str:
    """Send one delivery. Raises Retry for temporary failures (Temporal retries)."""
    d = await db.get(Delivery, delivery_id)
    if d is None or d.state != "pending":
        return d.state if d else "missing"
    d.attempts += 1
    service = {"webpush": "push", "email": "m365"}.get(d.channel, d.channel)
    if not await compliance.allowed(
        db, d.workspace_id, service, compliance.KINDS.get(service, service), d.channel
    ):
        # P57: the approved-services lock is on and this channel is not approved: nothing of
        # the company's leaves through it.
        d.state, d.last_error = "skipped", "Not an approved service for this company."
        await db.commit()
        return d.state
    try:
        if d.channel == "webpush":
            sub = await db.get(PushSubscription, d.target)
            if sub is None:
                d.state, d.last_error = "skipped", "The device unsubscribed."
            else:
                payload = {k: v for k, v in d.payload.items() if k != "token_enc"}
                if d.payload.get("token_enc"):
                    payload["token"] = crypto.decrypt(
                        d.payload["token_enc"], f"action_token:{d.payload.get('approval_id')}"
                    )
                res = await webpush.send(db, sub, payload)
                if res.ok:
                    d.state, d.sent_at = "sent", datetime.now(UTC)
                    sub.last_ok_at, sub.failures = d.sent_at, 0
                elif res.gone:
                    d.state, d.last_error = (
                        "skipped",
                        "The device is no longer subscribed; removed it.",
                    )
                    await db.delete(sub)
                else:
                    sub.failures += 1
                    raise Retry(f"push service answered {res.status}: {res.detail}")
        elif d.channel == "telegram":
            ch_id, _, chat_id = d.target.partition(":")
            ch = await db.get(Channel, ch_id)
            if ch is None or not ch.enabled:
                d.state, d.last_error = "skipped", "The Telegram bot is switched off."
            else:
                msg = await telegram.send_message(
                    channel_token(ch), chat_id, d.payload.get("text", ""), d.payload.get("buttons")
                )
                d.state, d.sent_at = "sent", datetime.now(UTC)
                d.result = {"message_id": msg.get("message_id")}
        elif d.channel == "email":
            await _send_email(db, d)
        elif d.channel == "whatsapp":
            ch_id, _, chat_id = d.target.partition(":")
            ch = await db.get(Channel, ch_id)
            if ch is None or not ch.enabled:
                d.state, d.last_error = "skipped", "WhatsApp is switched off."
            else:
                cfg = whatsapp.Config.load(channel_token(ch))
                mid = await whatsapp.send_text(cfg, chat_id, d.payload.get("text", ""))
                d.state, d.sent_at = "sent", datetime.now(UTC)
                d.result = {"message_id": mid}
        else:
            d.state, d.last_error = "skipped", f"unknown channel {d.channel}"
    except (Retry, telegram.TelegramError, whatsapp.WhatsAppError) as e:
        retryable = (
            isinstance(e, Retry)
            or getattr(e, "status", 0) in (0, 429)
            or getattr(e, "status", 0) >= 500
        )
        d.last_error = _redact(str(e))
        if retryable and d.attempts < MAX_ATTEMPTS:
            await db.commit()
            raise Retry(d.last_error) from e
        d.state = "failed"
    except webpush.BadSubscription as e:
        d.state, d.last_error = "failed", str(e)
    except Exception as e:  # noqa: BLE001 - network errors and the like: retry, then give up
        d.last_error = _redact(f"{e.__class__.__name__}: {e}")
        if d.attempts < MAX_ATTEMPTS:
            await db.commit()
            raise Retry(d.last_error) from e
        d.state = "failed"
    if d.state != "pending" and "token_enc" in d.payload:
        d.payload = {k: v for k, v in d.payload.items() if k != "token_enc"}
    await db.commit()
    await events.publish(
        d.workspace_id,
        "delivery.updated",
        {"delivery_id": d.id, "state": d.state, "channel": d.channel},
    )
    return d.state


async def _send_email(db: AsyncSession, d: Delivery) -> None:
    """P114: send one notice email from the office's system mailbox (Microsoft Graph)."""
    from ..core.workspace_settings import system_mail, valid_address
    from ..microsoft import sendmail
    from ..models import Workspace

    ws = await db.get(Workspace, d.workspace_id)
    sm = system_mail(ws.settings if ws else None)
    user = await db.get(User, d.target)
    if not sm.ready:
        d.state, d.last_error = "skipped", "The office's email is switched off."
        return
    if user is None or not user.is_active or not valid_address(user.email or ""):
        d.state, d.last_error = "skipped", "The person has no email address."
        return
    try:
        await send_mail(
            db,
            d.workspace_id,
            sender=sm.address,
            from_name=sm.from_name,
            to=user.email,
            to_name=user.name,
            subject=str(d.payload.get("subject") or ""),
            html=str(d.payload.get("html") or ""),
        )
    except sendmail.SendError as e:
        if e.kind == "not_configured":
            d.state, d.last_error = "skipped", "Microsoft 365 is not connected for email."
            return
        if e.kind in ("throttled", "unavailable", "failed"):
            raise Retry(f"email: {e.kind}") from e
        d.state, d.last_error = "failed", f"email: {e.kind}"
        return
    d.state, d.sent_at = "sent", datetime.now(UTC)
    # Sent: keep only the subject on the row, not the whole page.
    d.payload = {"subject": d.payload.get("subject")}


async def send_mail(db: AsyncSession, workspace_id: str, **kw: str) -> None:
    """The Graph send (tests swap this)."""
    from ..microsoft import sendmail

    await sendmail.send(db, workspace_id, **kw)


async def start(delivery_ids: list[str]) -> None:
    """Hand the sends to the worker (Temporal retries with backoff)."""
    if not delivery_ids:
        return
    from ..agents import dispatch  # late: dispatch imports the workflows

    try:
        await dispatch.start_deliveries(delivery_ids)
    except Exception:  # noqa: BLE001 - the rows stay pending and visible; never break the caller
        log.warning("could not start deliveries", exc_info=True)


async def learn_from_chat(message_id: int) -> None:
    """Chats on Telegram and WhatsApp teach the agent like dashboard chat does (P17)."""
    from ..agents import dispatch  # late: dispatch imports the workflows

    try:
        await dispatch.start_chat_learning(message_id)
    except Exception:  # noqa: BLE001 - learning is best effort; the answer went out already
        log.warning("could not start chat learning", exc_info=True)


def describe_payload(d: Delivery) -> dict[str, Any]:
    """What the ledger shows: never the action token."""
    return {k: v for k, v in d.payload.items() if k not in ("token", "token_enc")}
