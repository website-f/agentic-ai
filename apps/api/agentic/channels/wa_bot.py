"""WhatsApp inbound (P16): linking people, and chatting with their agent.

Only linked people are served. A stranger messaging the office number gets no answer at all
(an office number that replies to anyone invites spam and, on WAHA, bans). A linked person's
message goes to the agent bound to WhatsApp, else their own personal assistant, else the
first agent they own; the answer comes back on WhatsApp. Text from WhatsApp is a user
message, never an instruction to the system.
"""

import json
import logging
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import runtime
from ..core.security import can
from ..core.valkey import valkey
from ..engine import gateway, media
from ..models import Agent, Binding, Channel, ChannelLink, ChatSession, Membership, User
from . import deliver, voice, whatsapp
from .whatsapp import Inbound

log = logging.getLogger("agentic.channels.whatsapp")

CODE = re.compile(r"^(?:/?(?:link|start)\s+)?([A-HJ-NP-Z2-9]{8})$", re.I)


async def _reply(db: AsyncSession, ch: Channel, chat_id: str, text: str, key: str) -> None:
    did = await deliver.queue_whatsapp(db, ch, chat_id, text, dedupe=f"wa:{ch.id}:{key}")
    if did:
        try:
            await deliver.deliver(db, did)
        except deliver.Retry:
            await deliver.start([did])


async def _link(db: AsyncSession, ch: Channel, code: str, msg: Inbound) -> str:
    raw = await valkey().getdel(f"tglink:{code}")  # the same one-time codes as Telegram
    if not raw:
        return "That code is wrong or expired. Make a new one in the dashboard (Channels)."
    data = json.loads(raw)
    if data.get("channel_id") != ch.id:
        return "That code is for a different channel."
    user = await db.get(User, data["user_id"])
    if user is None:
        return "That account no longer exists."
    link = await db.scalar(
        select(ChannelLink).where(
            ChannelLink.channel_id == ch.id, ChannelLink.external_id == msg.sender
        )
    )
    if link is None:
        db.add(
            ChannelLink(
                channel_id=ch.id,
                user_id=user.id,
                external_id=msg.sender,
                chat_id=msg.sender,
                display=(msg.name or msg.sender.split("@")[0])[:120],
                created_at=datetime.now(UTC),
            )
        )
    else:
        link.user_id = user.id
    await db.commit()
    return (
        f"Linked to {user.name}. Your agents' notices and approvals will arrive here, "
        "and you can message your assistant on this chat."
    )


async def _agent_for(db: AsyncSession, ch: Channel, sender: str, user_id: str) -> Agent | None:
    from ..api.scope import member_sees_agent

    for key in (f"chat:{sender}", "dm"):
        b = await db.scalar(
            select(Binding).where(Binding.channel_id == ch.id, Binding.match == key)
        )
        if b is not None:
            a = await db.get(Agent, b.agent_id)
            # A binding never lets someone talk to an agent outside their own area.
            if (
                a is not None
                and a.status == "active"
                and await member_sees_agent(db, ch.workspace_id, user_id, a.id)
            ):
                return a
    # Nothing bound: the person's own assistant, else an agent they own.
    return await db.scalar(
        select(Agent)
        .where(
            Agent.workspace_id == ch.workspace_id,
            Agent.owner_user_id == user_id,
            Agent.status == "active",
            Agent.clone_of.is_(None),
        )
        .order_by(Agent.private.desc(), Agent.created_at)
        .limit(1)
    )


async def _hear(
    db: AsyncSession, ch: Channel, msg: Inbound, agent: Agent
) -> tuple[str, str | None]:
    """Download the voice note and turn it into text: (transcript, problem)."""
    assert msg.audio is not None
    if msg.audio.seconds and msg.audio.seconds > media.MAX_AUDIO_SECONDS:
        return "", voice.TOO_LONG
    cfg = whatsapp.Config.load(deliver.channel_token(ch))
    try:
        data = await whatsapp.download_audio(cfg, msg.audio, voice.MAX_BYTES)
    except whatsapp.WhatsAppError as e:
        if e.status == 413:
            return "", f"That voice note is too large (over {media.MAX_AUDIO_MB} MB)."
        log.info("voice note download failed on %s: %s", ch.id, e)
        return "", voice.NO_DOWNLOAD
    except Exception:  # noqa: BLE001 - WAHA or Meta unreachable
        log.info("voice note download failed on %s", ch.id, exc_info=True)
        return "", voice.NO_DOWNLOAD
    return await voice.hear(
        db,
        ch.workspace_id,
        data,
        msg.audio.mime,
        seconds=msg.audio.seconds,
        agent_id=agent.id,
    )


async def handle(db: AsyncSession, ch: Channel, msg: Inbound) -> None:
    # WhatsApp gateways retry webhooks: answer each message once.
    if msg.message_id and not await valkey().set(
        f"wamsg:{ch.id}:{msg.message_id}", "1", nx=True, ex=86400
    ):
        return
    key = msg.message_id or f"{msg.sender}:{datetime.now(UTC).timestamp():.0f}"
    if m := CODE.match(msg.text.strip().upper()):
        await _reply(db, ch, msg.sender, await _link(db, ch, m.group(1), msg), key)
        return
    link = await db.scalar(
        select(ChannelLink).where(
            ChannelLink.channel_id == ch.id, ChannelLink.external_id == msg.sender
        )
    )
    if link is None:
        return  # strangers get silence
    role = await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == ch.workspace_id, Membership.user_id == link.user_id
        )
    )
    if role is None:
        await _reply(db, ch, msg.sender, "Your account is no longer in this workspace.", key)
        return
    agent = await _agent_for(db, ch, msg.sender, link.user_id)
    if msg.text.strip().lower() in ("help", "/help", "?"):
        who = f"Messages here go to {agent.name}." if agent else "No agent answers here yet."
        await _reply(db, ch, msg.sender, f"{who} Notices and approvals arrive here too.", key)
        return
    if not can(role, "work.write"):
        await _reply(db, ch, msg.sender, "Your role can read but not instruct agents.", key)
        return
    if agent is None:
        await _reply(
            db,
            ch,
            msg.sender,
            "No agent answers here yet. Create your assistant in the dashboard (My assistants).",
            key,
        )
        return
    text, heard = msg.text, ""
    if msg.audio is not None and not text:
        heard, problem = await _hear(db, ch, msg, agent)
        if problem:
            await _reply(db, ch, msg.sender, problem, key)
            return
        text = heard
    title = f"WhatsApp chat {msg.sender}"
    session = await db.scalar(
        select(ChatSession).where(
            ChatSession.agent_id == agent.id,
            ChatSession.user_id == link.user_id,
            ChatSession.title == title,
        )
    )
    if session is None:
        session = ChatSession(
            workspace_id=agent.workspace_id, agent_id=agent.id, user_id=link.user_id, title=title
        )
        db.add(session)
        await db.commit()
    try:
        reply = await runtime.chat_turn(db, agent, session, text)
        answer = reply.content or "(no answer)"
    except gateway.GatewayUnavailable as e:
        reply, answer = None, f"{agent.name} could not answer right now: {e}"
    # A voice note's answer quotes what was heard (WhatsApp shows "> " as a quote).
    said = f"> {voice.quote(heard)}\n\n" if heard else ""
    await _reply(db, ch, msg.sender, f"{said}*{agent.name}*: {answer}", key)
    if reply is not None and reply.message_id is not None:
        await deliver.learn_from_chat(reply.message_id)
