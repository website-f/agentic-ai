"""The delivery ledger: every outbound notification is a row first, then a send.

A row has a dedupe key (approval x device), so a retry or a restart never sends twice, and a
send that fails stays visible in the dashboard with its error.

Languages (P22): a notice is written in each RECIPIENT's language (users.prefs locale), not
the language of whoever caused it. Callers pass English as an i18n.Msg (or plain English
whose template is in i18n/ms.py); the row stores the rendered text. Text a person or an
agent wrote goes in as i18n.Plain and is never translated.
"""

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.security import can
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
from ..services import events, prefs
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


async def deciders(db: AsyncSession, workspace_id: str, agent: Agent | None = None) -> list[User]:
    """People who may decide; given the asking agent, only those whose scope covers it (a
    staff member hears about their own agents, a HOD about the department's)."""
    from ..api.scope import Scope

    rows = (
        await db.execute(
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == workspace_id, User.is_active.is_(True))
        )
    ).all()
    return [
        u
        for u, m in rows
        if can(m.role, "approvals.decide")
        and (
            agent is None or Scope.of(m.role, u.id, m.branch_id, m.department_id).sees_agent(agent)
        )
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
    for user in await deciders(db, a.workspace_id, agent):
        lang = prefs.lang_of(user)  # the recipient's language, not the agent's or the asker's
        title, body = render(title_msg, lang), render(body_msg, lang)
        subs = (
            await db.scalars(
                select(PushSubscription).where(
                    PushSubscription.user_id == user.id,
                    PushSubscription.workspace_id == a.workspace_id,
                )
            )
        ).all()
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
    await db.commit()
    return ids


async def _queue_for_user(
    db: AsyncSession,
    workspace_id: str,
    user_id: str,
    title: str,
    body: str,
    url: str,
    dedupe: str,
    lang: str | None = None,
) -> list[str]:
    """One person, every way they can be reached: each device, linked Telegram and WhatsApp.
    Title and body are said in the person's language."""
    lang = lang or await prefs.language(db, user_id)
    title, body = render(title, lang), render(body, lang)
    now = datetime.now(UTC)
    ids: list[str] = []
    for sub in (
        await db.scalars(
            select(PushSubscription).where(
                PushSubscription.user_id == user_id, PushSubscription.workspace_id == workspace_id
            )
        )
    ).all():
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


async def notify_people(
    db: AsyncSession,
    workspace_id: str,
    title: str,
    body: str,
    url: str,
    *,
    dedupe: str,
    perm: str = "approvals.decide",
) -> list[str]:
    """A plain notice (no buttons) to everyone with `perm`: every device, Telegram, WhatsApp.
    `title` / `body`: English (a Msg, or text with a template in i18n/ms.py); each person
    gets it in their own language."""
    ids: list[str] = []
    rows = (
        await db.execute(
            select(User, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == workspace_id, User.is_active.is_(True))
        )
    ).all()
    for user, role in rows:
        if can(role, perm):
            ids += await _queue_for_user(
                db, workspace_id, user.id, title, body, url, dedupe, prefs.lang_of(user)
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
) -> list[str]:
    """A notice to one person on every channel they set up, in their language (see
    notify_people). Returns the delivery ids."""
    ids = await _queue_for_user(db, workspace_id, user_id, title, body, url, dedupe)
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
