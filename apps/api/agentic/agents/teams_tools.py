"""P52: Microsoft Teams for a person's own AI (their twin or private assistant), through that
person's own Microsoft 365 connection: their chats only, never anyone else's.

- teams_chats: the latest chats (who is in them, the last message), with their ids;
- teams_read_chat: a chat's latest messages (outside text: fenced, the outside-content rule);
- teams_send: send a message in a chat. Asks the person first (default mode "ask").

Offered only when microsoft.access.teams_ready (runtime.offered_tools), allowed only then
(policy.evaluate), and only for the person themselves (runtime.owner_asks: a manager who
chats with someone's twin never reaches their Teams).
"""

import html
import re
from typing import Any

from ..core.fence import fence
from ..microsoft import access, graph
from ..microsoft.errors import MicrosoftError
from .tools import Tool, ToolContext, _threat_note

MAX_TEXT = 4000
_TAG = re.compile(r"<[^>]+>")


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


async def _send(ctx: ToolContext, args: dict[str, Any]) -> str:
    chat_id = str(args.get("chat_id") or "").strip()
    text = str(args.get("text") or "").strip()
    if not chat_id or not text:
        return "Error: give the chat id and the message text."
    g = await _graph(ctx)
    if isinstance(g, str):
        return g
    try:
        await g.send_chat_message(chat_id, text[:MAX_TEXT])
    except MicrosoftError as e:
        return _err(e)
    return "Sent in Teams."


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
        "Send a Teams message",
        "Send a message in one of your person's Teams chats, as them. Your person approves it "
        "before it is sent.",
        _p({"chat_id": {"type": "string"}, "text": {"type": "string"}}, ["chat_id", "text"]),
        "medium",
        "ask",
        _send,
    ),
]

assert {t.name for t in TEAMS_TOOLS} == access.TEAMS_TOOLS
