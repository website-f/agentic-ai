"""P52: Microsoft Teams for a person's own AI (their twin or private assistant), through that
person's own Microsoft 365 connection: their chats only, never anyone else's.

- teams_chats: the latest chats (who is in them, the last message), with their ids;
- teams_read_chat: a chat's latest messages (outside text: fenced, the outside-content rule);
- teams_send (P102): DRAFT a message, as a reply in one of the person's chats or as a first
  message to anyone in their organisation (by work email). Nothing is sent here: the draft
  waits for the person on the Microsoft 365 page (microsoft/approvals.py), shows them the
  full text, and is posted only when they press Send. Only the connection's own person can
  approve it (not a manager), in chat as well as in a task. A first message to someone they
  have no chat with yet needs Chat.Create, which each person allows once ("Allow new Teams
  chats"); replying never needs it.
- teams_channels / teams_read_channel (P63): the teams and channels the person is a member
  of, and a channel's recent posts with their replies. Read only (nothing is ever posted in
  a channel); needs ChannelMessage.Read.All, which only an admin can grant
  (microsoft.app.CHANNEL_SCOPE). Without it they say so plainly.

Offered only when microsoft.access.teams_ready (runtime.offered_tools), allowed only then
(policy.evaluate), and only for the person themselves (runtime.owner_asks: a manager who
chats with someone's twin never reaches their Teams).
"""

import html
import re
from datetime import UTC, datetime
from typing import Any

from ..core.fence import fence
from ..microsoft import access, app, approvals, auth, graph
from ..microsoft.errors import MicrosoftError
from .tools import Tool, ToolContext, _threat_note

MAX_TEXT = 4000
_TAG = re.compile(r"<[^>]+>")
# P63: said wherever channel posts are asked for and the connection may not read them.
CHANNELS_OFF = (
    "Reading Teams channel posts needs your Microsoft 365 admin to turn it on (Channels > "
    "Microsoft 365), then reconnect Microsoft."
)
REPLIES_SHOWN = 5  # per post, the latest; older ones are counted
# P102: a first message to someone the person has no chat with yet.
NEW_CHATS_OFF = (
    "Error: your person has no Teams chat with {to} yet, and starting a new chat needs one "
    "more permission. Tell them to press Allow new Teams chats on the Microsoft 365 page "
    "(Teams) and sign in once; then ask again. Until then you can only reply in chats they "
    "already have (teams_chats)."
)
EMAIL = re.compile(r"^[^@\s<>'\"]+@[^@\s<>'\"]+\.[^@\s<>'\"]+$")


def _p(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


def plain(content: str | None) -> str:
    """A Teams message body (often HTML) as plain text."""
    text = _TAG.sub(" ", (content or "").replace("<br>", "\n").replace("</p>", "\n"))
    return re.sub(r"[ \t]+", " ", html.unescape(text)).strip()


async def _graph(ctx: ToolContext) -> graph.Graph | str:
    acct = await access.teams_account(ctx.db, ctx.agent)
    if acct is None:
        return (
            "Error: there is no Microsoft 365 connection you may use for Teams. Your person "
            "connects their own account on the Microsoft 365 page."
        )
    return await graph.for_account(ctx.db, acct)


def channels_ok(acct: Any) -> bool:
    """The connection may read channel posts (an admin granted ChannelMessage.Read.All and
    the person signed in again since)."""
    return auth.has_scope(getattr(acct, "scopes", "") or "", app.CHANNEL_SCOPE)


async def _channel_graph(ctx: ToolContext) -> graph.Graph | str:
    acct = await access.teams_account(ctx.db, ctx.agent)
    if acct is None:
        return await _graph(ctx)  # the same "no connection" answer
    if not channels_ok(acct):
        return CHANNELS_OFF
    return await graph.for_account(ctx.db, acct)


def sender(m: dict[str, Any]) -> str:
    """Who wrote a Teams message: a person, or an app / bot posting in a channel."""
    f = m.get("from") or {}
    return ((f.get("user") or {}).get("displayName")
            or (f.get("application") or {}).get("displayName") or "")  # fmt: skip


def is_post(m: dict[str, Any]) -> bool:
    """A real message (not a system event, not deleted)."""
    return m.get("messageType") in (None, "message") and not m.get("deletedDateTime")


def _err(e: MicrosoftError) -> str:
    text = str(e)
    if getattr(e, "status", 0) == 403:
        text += (
            " (Teams needs permission the connection does not have yet: your person reconnects "
            "Microsoft 365 once to allow Teams.)"
        )
    return f"Error: {text}"


def _who(chat: dict[str, Any], me: str) -> str:
    names = [
        m.get("displayName") or ""
        for m in chat.get("members") or []
        if (m.get("displayName") or "") and (m.get("displayName") or "") != me
    ]
    return chat.get("topic") or ", ".join(names[:6]) or "(no name)"


async def _chats(ctx: ToolContext, args: dict[str, Any]) -> str:
    g = await _graph(ctx)
    if isinstance(g, str):
        return g
    try:
        me = (await g.me()).get("displayName") or ""
        chats = await g.list_chats(int(args.get("top") or 15))
    except MicrosoftError as e:
        return _err(e)
    if not chats:
        return "No Teams chats."
    lines = []
    for c in chats:
        last = c.get("lastMessagePreview") or {}
        when = (last.get("createdDateTime") or "")[:16].replace("T", " ")
        sender = ((last.get("from") or {}).get("user") or {}).get("displayName") or ""
        preview = plain((last.get("body") or {}).get("content"))[:140]
        lines.append(
            f"- [{c.get('id')}] {_who(c, me)} ({c.get('chatType', '')}) {when} {sender}: {preview}"
        )
    out = "\n".join(lines)
    return fence(out) + _threat_note(out)


async def _read(ctx: ToolContext, args: dict[str, Any]) -> str:
    chat_id = str(args.get("chat_id") or "").strip()
    if not chat_id:
        return "Error: give the chat id (from teams_chats)."
    g = await _graph(ctx)
    if isinstance(g, str):
        return g
    try:
        msgs = await g.chat_messages(chat_id, int(args.get("count") or 20))
    except MicrosoftError as e:
        return _err(e)
    lines = []
    for m in reversed(msgs):  # oldest first, to read like a conversation
        if m.get("messageType") not in (None, "message"):
            continue
        who = ((m.get("from") or {}).get("user") or {}).get("displayName") or "?"
        when = (m.get("createdDateTime") or "")[:16].replace("T", " ")
        lines.append(f"{when} {who}: {plain((m.get('body') or {}).get('content'))[:1500]}")
    if not lines:
        return "No messages in that chat."
    out = "\n".join(lines)
    return fence(out) + _threat_note(out)


def _email(m: dict[str, Any]) -> str:
    return str(m.get("email") or "").strip().lower()


def _last_post(msgs: list[dict[str, Any]], me: str) -> dict[str, Any] | None:
    """The newest real message someone else wrote (what a reply answers)."""
    for m in msgs:  # newest first
        if is_post(m) and sender(m) and sender(m) != me:
            return m
    return None


async def _send(ctx: ToolContext, args: dict[str, Any]) -> str:
    """P102: a Teams message for the person to approve (never sent here)."""
    chat_id = str(args.get("chat_id") or "").strip()
    to = str(args.get("to") or "").strip().strip("<>").lower()
    text = str(args.get("text") or "").strip()
    if not text or not (chat_id or to):
        return (
            "Error: give the message text, and either chat_id (from teams_chats) to reply in a "
            "chat, or to (a work email address in your person's organisation) for a new message."
        )
    if to and not chat_id and not EMAIL.match(to):
        return f"Error: {to!r} is not an email address. Ask your person for the work email."
    acct = await access.teams_account(ctx.db, ctx.agent)
    if acct is None:
        return await _graph(ctx)  # the same "no connection" answer
    g = await graph.for_account(ctx.db, acct)
    me = acct.display_name or ""
    title, last = "", None
    try:
        chats = await g.list_chats(50)
        if chat_id:
            # Reading it first also proves the chat is the person's own (Graph refuses others).
            msgs = await g.chat_messages(chat_id, 10)
            chat = next((c for c in chats if c.get("id") == chat_id), None)
            title = _who(chat, me) if chat else ""
            last = _last_post(msgs, me)
            title = (
                title if title and title != "(no name)" else (sender(last or {}) or "Teams chat")
            )
        else:
            for c in chats:
                if c.get("chatType") == "oneOnOne" and any(
                    _email(m) == to for m in c.get("members") or []
                ):
                    chat_id, title = str(c.get("id") or ""), _who(c, me)
                    break
            if not chat_id and not auth.has_scope(acct.scopes or "", app.CHAT_CREATE):
                return NEW_CHATS_OFF.format(to=to)
    except MicrosoftError as e:
        return _err(e)
    row = await approvals.record_teams_draft(
        ctx.db,
        acct=acct,
        agent=ctx.agent,
        chat_id=chat_id,
        to=to or title,
        title=title or to,
        text=text[:MAX_TEXT],
        last_from=sender(last) if last else "",
        last_text=plain((last.get("body") or {}).get("content"))[:1000] if last else "",
    )
    where = f"the chat with {title}" if chat_id else f"a new chat with {to}"
    return (
        f"Teams message to {where} drafted (draft {row.id}), waiting for your person to approve "
        "it on the Microsoft 365 page. They were notified; NOTHING is sent until they press Send."
    )


def _since(raw: Any) -> datetime | None:
    v = str(raw or "").strip()
    if not v:
        return None
    t = graph.parse_time(v if "T" in v else v + "T00:00:00Z")
    return t.astimezone(UTC) if t else None


async def _channels(ctx: ToolContext, args: dict[str, Any]) -> str:
    g = await _channel_graph(ctx)
    if isinstance(g, str):
        return g
    try:
        teams = await g.joined_teams()
        lines = []
        for team in teams:
            lines.append(f"- team [{team.get('id')}] {team.get('displayName') or '(no name)'}")
            for c in await g.team_channels(str(team.get("id") or "")):
                kind = c.get("membershipType") or ""
                extra = f" ({kind})" if kind and kind != "standard" else ""
                lines.append(f"  - channel [{c.get('id')}] {c.get('displayName') or ''}{extra}")
    except MicrosoftError as e:
        return _channel_err(e)
    if not lines:
        return "You are not a member of any Teams team."
    out = "\n".join(lines)
    return fence(out) + _threat_note(out)


def _line(m: dict[str, Any], limit: int) -> str:
    when = (m.get("createdDateTime") or "")[:16].replace("T", " ")
    return f"{when} {sender(m) or '?'}: {plain((m.get('body') or {}).get('content'))[:limit]}"


async def _read_channel(ctx: ToolContext, args: dict[str, Any]) -> str:
    team_id = str(args.get("team_id") or "").strip()
    channel_id = str(args.get("channel_id") or "").strip()
    if not team_id or not channel_id:
        return "Error: give the team id and the channel id (from teams_channels)."
    g = await _channel_graph(ctx)
    if isinstance(g, str):
        return g
    since = _since(args.get("since"))
    try:
        posts = await g.channel_messages(
            team_id, channel_id, int(args.get("limit") or 20), since=since
        )
        for p in posts:
            if "replies" not in p and is_post(p):
                p["replies"] = await g.message_replies(team_id, channel_id, str(p.get("id")))
    except MicrosoftError as e:
        return _channel_err(e)
    blocks = []
    for p in reversed(posts):  # oldest first, newest last
        if not is_post(p):
            continue
        subject = plain(p.get("subject"))
        head = _line(p, 1500)
        blocks.append(f"[post {p.get('id')}]" + (f" {subject}:" if subject else "") + f" {head}")
        replies = sorted(
            (r for r in p.get("replies") or [] if is_post(r)),
            key=lambda r: r.get("createdDateTime") or "",
        )
        if len(replies) > REPLIES_SHOWN:
            blocks.append(f"  ({len(replies) - REPLIES_SHOWN} earlier replies not shown)")
        blocks += [f"  > {_line(r, 400)}" for r in replies[-REPLIES_SHOWN:]]
    if not blocks:
        return "No posts in that channel" + (" since then." if since else ".")
    out = "\n".join(blocks)
    return fence(out) + _threat_note(out)


def _channel_err(e: MicrosoftError) -> str:
    if getattr(e, "status", 0) == 403:
        return CHANNELS_OFF
    if getattr(e, "status", 0) == 404:
        return "Error: that team or channel was not found (use the ids from teams_channels)."
    return f"Error: {e}"


TEAMS_TOOLS: list[Tool] = [
    Tool(
        "teams_chats",
        "List Teams chats",
        "Your person's latest Microsoft Teams chats: who is in each, the last message, and the "
        "chat id (for teams_read_chat).",
        _p({"top": {"type": "integer", "description": "1-50, default 15"}}, []),
        "low",
        "allow",
        _chats,
    ),
    Tool(
        "teams_read_chat",
        "Read a Teams chat",
        "Read the latest messages of one Teams chat by its id (from teams_chats), oldest first.",
        _p(
            {"chat_id": {"type": "string"}, "count": {"type": "integer", "description": "1-50"}},
            ["chat_id"],
        ),
        "low",
        "allow",
        _read,
    ),
    Tool(
        "teams_send",
        "Draft a Teams message",
        "Write a Microsoft Teams message as your person: a reply in one of their chats "
        "(chat_id from teams_chats), or a first message to anyone in their organisation (to = "
        "that person's work email). It is NOT sent: your person sees the full text and approves "
        "it first, and is notified. Write the whole message.",
        _p(
            {
                "chat_id": {"type": "string", "description": "Reply in this chat (teams_chats)"},
                "to": {
                    "type": "string",
                    "description": "Or: the work email of someone in the organisation",
                },
                "text": {"type": "string"},
            },
            ["text"],
        ),
        "medium",
        "allow",
        _send,
    ),
    Tool(
        "teams_channels",
        "List Teams channels",
        "The Microsoft Teams teams your person is a member of and their channels, with the "
        "team id and channel id (for teams_read_channel). Read only.",
        _p({}, []),
        "low",
        "allow",
        _channels,
    ),
    Tool(
        "teams_read_channel",
        "Read a Teams channel",
        "Read the recent posts of one Teams channel (team id + channel id from teams_channels), "
        "oldest first and newest last, each with its latest replies. Read only: you cannot post "
        "in a channel; draft a reply as text for your person to post themselves.",
        _p(
            {
                "team_id": {"type": "string"},
                "channel_id": {"type": "string"},
                "since": {
                    "type": "string",
                    "description": "only posts started or answered from then on, e.g. 2026-11-01",
                },
                "limit": {"type": "integer", "description": "posts, 1-50, default 20"},
            },
            ["team_id", "channel_id"],
        ),
        "low",
        "allow",
        _read_channel,
    ),
]

assert {t.name for t in TEAMS_TOOLS} == access.TEAMS_TOOLS
