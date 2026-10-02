"""The delivery ledger: every outbound notification is a row first, then a send.

A row has a dedupe key (approval x device), so a retry or a restart never sends twice, and a
send that fails stays visible in the dashboard with its error.
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
from ..services import events
from . import telegram, webpush

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


def describe(a: Approval, agent_name: str) -> tuple[str, str]:
    if a.kind == "question":
        return f"{agent_name} has a question", a.reason or "Open it to answer."
    if a.kind == "budget":
        return f"{agent_name} is over budget", a.reason or "Approve more budget to continue."
    from ..agents.tools import TOOLS  # late: tools import the brain and skills

    tool = TOOLS[a.tool_name].label if a.tool_name in TOOLS else a.tool_name.replace("_", " ")
    why = f": {a.reason}" if a.reason else ""
    return f"{agent_name} needs a decision", f"Wants to: {tool.lower()}{why}"


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
    name = agent.name if agent else "An agent"
    title, body = describe(a, name)
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
            task_line = f"\nTask: {task.title}" if task else ""
            if a.kind == "question":
                text = f"❓ {title}{task_line}\n\n{body}\n\nReply to this message with your answer."
                buttons = None
            else:
                text = f"🔔 {title}{task_line}\n\n{body}"
                buttons = [
                    [
                        {"text": "✅ Approve", "callback_data": f"apv:{a.id}:approve"},
                        {"text": "✖️ Deny", "callback_data": f"apv:{a.id}:deny"},
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
    """A plain notice (no buttons) to everyone with `perm`: every device and linked Telegram."""
    now = datetime.now(UTC)
    ids: list[str] = []
    rows = (
        await db.execute(
            select(User, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == workspace_id, User.is_active.is_(True))
        )
    ).all()
    for user, role in rows:
        if not can(role, perm):
            continue
        for sub in (
            await db.scalars(
                select(PushSubscription).where(
                    PushSubscription.user_id == user.id,
                    PushSubscription.workspace_id == workspace_id,
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
        for link, ch in (
            await db.execute(
                select(ChannelLink, Channel)
                .join(Channel, Channel.id == ChannelLink.channel_id)
                .where(
                    ChannelLink.user_id == user.id,
                    Channel.workspace_id == workspace_id,
                    Channel.enabled.is_(True),
                )
            )
        ).all():
            did = await _add(
                db,
                Delivery(
                    workspace_id=workspace_id,
                    channel="telegram",
                    target=f"{ch.id}:{link.chat_id}",
                    kind="notice",
                    payload={"text": f"{title}\n\n{body}"},
                    dedupe_key=f"{dedupe}:tg:{link.id}",
                    created_at=now,
                ),
            )
            if did:
                ids.append(did)
    await db.commit()
    return ids


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
        else:
            d.state, d.last_error = "skipped", f"unknown channel {d.channel}"
    except (Retry, telegram.TelegramError) as e:
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


def describe_payload(d: Delivery) -> dict[str, Any]:
    """What the ledger shows: never the action token."""
    return {k: v for k, v in d.payload.items() if k not in ("token", "token_enc")}
