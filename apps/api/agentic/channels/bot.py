"""Telegram inbound: linking accounts, approve/deny buttons, answering questions, and chatting
with the agent bound to a chat. Only linked people are served: the bot is private.

Text from Telegram is a user message, exactly like the dashboard chat, never an instruction
to the system.
"""

import json
import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import decisions, runtime
from ..core.security import can
from ..core.valkey import valkey
from ..engine import gateway
from ..models import (
    Agent,
    Approval,
    Binding,
    Channel,
    ChannelLink,
    ChatSession,
    Delivery,
    Membership,
    User,
)
from . import deliver, telegram

log = logging.getLogger("agentic.channels.bot")

LINK_TTL = 600
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L

PRIVATE = (
    "This bot belongs to a private office. To use it, open the dashboard: "
    "Channels > Telegram > Link my account, then send the code shown there."
)


async def new_link_code(channel_id: str, user_id: str) -> str:
    code = "".join(secrets.choice(CODE_CHARS) for _ in range(8))
    await valkey().set(
        f"tglink:{code}", json.dumps({"channel_id": channel_id, "user_id": user_id}), ex=LINK_TTL
    )
    return code


async def _link_for(db: AsyncSession, ch: Channel, from_id: str) -> ChannelLink | None:
    return await db.scalar(
        select(ChannelLink).where(
            ChannelLink.channel_id == ch.id, ChannelLink.external_id == from_id
        )
    )


async def _role(db: AsyncSession, ch: Channel, user_id: str) -> str | None:
    return await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == ch.workspace_id, Membership.user_id == user_id
        )
    )


def binding_keys(chat: dict[str, Any]) -> list[str]:
    """Most specific first: this exact chat, then the kind of chat."""
    kind = "dm" if chat.get("type") == "private" else "group"
    return [f"chat:{chat.get('id')}", kind]


async def _bound_agent(db: AsyncSession, ch: Channel, chat: dict[str, Any]) -> Agent | None:
    for key in binding_keys(chat):
        b = await db.scalar(
            select(Binding).where(Binding.channel_id == ch.id, Binding.match == key)
        )
        if b is not None:
            agent = await db.get(Agent, b.agent_id)
            if agent is not None and agent.status == "active":
                return agent
    return None


async def _session(db: AsyncSession, agent: Agent, user_id: str, chat_id: str) -> ChatSession:
    title = f"Telegram chat {chat_id}"
    s = await db.scalar(
        select(ChatSession).where(
            ChatSession.agent_id == agent.id,
            ChatSession.user_id == user_id,
            ChatSession.title == title,
        )
    )
    if s is None:
        s = ChatSession(
            workspace_id=agent.workspace_id, agent_id=agent.id, user_id=user_id, title=title
        )
        db.add(s)
        await db.commit()
    return s


async def _reply(
    db: AsyncSession, ch: Channel, chat_id: str, text: str, update_id: int, n: int = 0
) -> None:
    did = await deliver.queue_telegram(db, ch, chat_id, text, dedupe=f"tg:{ch.id}:{update_id}:{n}")
    if did:
        try:
            await deliver.deliver(db, did)
        except deliver.Retry:
            await deliver.start([did])  # leave it to the worker's retries


async def handle_update(db: AsyncSession, ch: Channel, update: dict[str, Any]) -> None:
    uid = int(update.get("update_id", 0))
    if cq := update.get("callback_query"):
        await _callback(db, ch, cq)
        return
    msg = update.get("message") or {}
    text = (msg.get("text") or "").strip()
    chat = msg.get("chat") or {}
    sender = msg.get("from") or {}
    if not text or not chat:
        return
    chat_id, from_id = str(chat.get("id")), str(sender.get("id"))

    if text.startswith("/start"):
        code = text.split(maxsplit=1)[1].strip().upper() if " " in text else ""
        if code:
            await _reply(db, ch, chat_id, await _link(db, ch, code, sender, chat_id), uid)
        else:
            linked = await _link_for(db, ch, from_id)
            await _reply(
                db,
                ch,
                chat_id,
                "You are linked. Send a message to talk to your office." if linked else PRIVATE,
                uid,
            )
        return

    link = await _link_for(db, ch, from_id)
    if link is None:
        await _reply(db, ch, chat_id, PRIVATE, uid)
        return
    role = await _role(db, ch, link.user_id)
    if role is None:
        await _reply(db, ch, chat_id, "Your account is no longer in this workspace.", uid)
        return

    # Replying to a question notification answers it.
    if (to := msg.get("reply_to_message")) and to.get("message_id"):
        answered = await _answer_question(db, ch, chat_id, int(to["message_id"]), text, link, role)
        if answered:
            await _reply(db, ch, chat_id, answered, uid)
            return

    if text in ("/help", "/whoami"):
        agent = await _bound_agent(db, ch, chat)
        who = (
            f"Messages here go to {agent.name} ({agent.role})."
            if agent
            else "No agent answers in this chat yet."
        )
        await _reply(
            db,
            ch,
            chat_id,
            f"{who}\nApprovals arrive here with buttons. Reply to a question to answer it.",
            uid,
        )
        return

    if not can(role, "work.write"):
        await _reply(db, ch, chat_id, "Your role can read but not instruct agents.", uid)
        return
    agent = await _bound_agent(db, ch, chat)
    if agent is None:
        await _reply(
            db,
            ch,
            chat_id,
            "No agent answers in this chat yet. Bind one in the dashboard: Channels > Telegram.",
            uid,
        )
        return
    session = await _session(db, agent, link.user_id, chat_id)
    try:
        reply = await runtime.chat_turn(db, agent, session, text)
        answer = reply.content or "(no answer)"
    except gateway.GatewayUnavailable as e:
        answer = f"{agent.name} could not answer: {e}"
    await _reply(db, ch, chat_id, f"{agent.name}: {answer}", uid)


async def _link(
    db: AsyncSession, ch: Channel, code: str, sender: dict[str, Any], chat_id: str
) -> str:
    raw = await valkey().getdel(f"tglink:{code}")
    if not raw:
        return "That code is wrong or expired. Make a new one in the dashboard."
    data = json.loads(raw)
    if data.get("channel_id") != ch.id:
        return "That code is for a different bot."
    user = await db.get(User, data["user_id"])
    if user is None:
        return "That account no longer exists."
    from_id = str(sender.get("id"))
    display = (
        " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x)
        or sender.get("username")
        or from_id
    )
    link = await _link_for(db, ch, from_id)
    if link is None:
        link = ChannelLink(
            channel_id=ch.id,
            user_id=user.id,
            external_id=from_id,
            chat_id=chat_id,
            display=str(display)[:120],
            created_at=datetime.now(UTC),
        )
        db.add(link)
    else:
        link.user_id, link.chat_id = user.id, chat_id
    await db.commit()
    return f"Linked to {user.name}. Approvals will arrive here with buttons."


async def _answer_question(
    db: AsyncSession,
    ch: Channel,
    chat_id: str,
    message_id: int,
    text: str,
    link: ChannelLink,
    role: str,
) -> str | None:
    rows = (
        await db.scalars(
            select(Delivery)
            .where(
                Delivery.channel == "telegram",
                Delivery.kind == "approval",
                Delivery.target == f"{ch.id}:{chat_id}",
            )
            .order_by(Delivery.created_at.desc())
            .limit(50)
        )
    ).all()
    d = next((r for r in rows if (r.result or {}).get("message_id") == message_id), None)
    if d is None:
        return None
    a = await db.get(Approval, d.payload.get("approval_id", ""))
    if a is None or a.kind != "question":
        return None
    if not can(role, "approvals.decide"):
        return "Your role cannot answer agents' questions."
    try:
        await decisions.decide(db, a, f"user:{link.user_id}", "answer", answer=text, via="telegram")
    except decisions.DecisionError as e:
        return e.message
    return "Thanks, your answer is on its way."


async def _callback(db: AsyncSession, ch: Channel, cq: dict[str, Any]) -> None:
    token = deliver.channel_token(ch)
    data = str(cq.get("data") or "")
    from_id = str((cq.get("from") or {}).get("id"))
    msg = cq.get("message") or {}

    async def answer(text: str) -> None:
        try:
            await telegram.answer_callback(token, str(cq.get("id")), text)
        except telegram.TelegramError:
            pass

    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "apv" or parts[2] not in ("approve", "deny"):
        await answer("Unknown button.")
        return
    link = await _link_for(db, ch, from_id)
    if link is None:
        await answer("Link your account first.")
        return
    role = await _role(db, ch, link.user_id)
    if role is None or not can(role, "approvals.decide"):
        await answer("Your role cannot decide approvals.")
        return
    a = await db.get(Approval, parts[1])
    if a is None or a.workspace_id != ch.workspace_id:
        await answer("That approval is gone.")
        return
    try:
        await decisions.decide(db, a, f"user:{link.user_id}", parts[2], "once", via="telegram")
    except decisions.DecisionError as e:
        await answer(e.message)
        return
    user = await db.get(User, link.user_id)
    verdict = "✅ Approved" if a.status == "approved" else "✖️ Denied"
    await answer(verdict.split(" ", 1)[1])
    if msg.get("message_id") and msg.get("chat"):
        try:
            await telegram.edit_message(
                token,
                msg["chat"]["id"],
                int(msg["message_id"]),
                f"{msg.get('text', '')}\n\n{verdict} by {user.name if user else 'someone'}",
            )
        except telegram.TelegramError:
            pass
