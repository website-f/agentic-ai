"""P109: the Microsoft 365 page's shapes: a person's own mail, Teams chats and channels,
calendar and Teams Approvals, as the page shows them.

- `safe_html`: a Teams message body (HTML) reduced to a short allow-list of tags (text style,
  lists, links, code, quotes, tables), with mentions marked (`<span data-mention>`), emoji as
  their character, and inline pictures pointed at the office's own proxy
  (`/api/m365/teams/hosted?path=...`, checked by `hosted_path`), so the page can show it as
  Teams does without running anything from it.
- `chat_message` / `channel_post`: one message for the page (who, mine or not, when, the
  body, reactions, files, quoted replies, mentions, edited / deleted, system events).
- `mail_row` / `mail_full`, `event_row` / `event_full`, `approval_row`.

Nothing here calls Microsoft: the router (api/routers/m365.py) does, with the person's own
connection only.
"""

import html
import json
import re
import urllib.parse
from html.parser import HTMLParser
from typing import Any

from ..i18n import tr

# ---------------------------------------------------------------- Teams HTML, made safe

ALLOWED = {
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "strike",
    "del",
    "ul",
    "ol",
    "li",
    "a",
    "code",
    "pre",
    "blockquote",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "sub",
    "sup",
    "img",
}
VOID = {"br", "hr", "img"}
DROP_WITH_CONTENT = {"script", "style", "head", "title", "iframe", "object", "embed", "svg"}
GRAPH_HOST = "https://graph.microsoft.com/"
# A Teams inline picture: /chats/{id}/messages/{id}/hostedContents/{id}/$value, or the same
# under /teams/{id}/channels/{id}/messages/{id}[/replies/{id}].
_HOSTED = re.compile(
    r"^/(v1\.0|beta)/("
    r"chats/[^/?#]+/messages/[^/?#]+"
    r"|teams/[^/?#]+/channels/[^/?#]+/messages/[^/?#]+(/replies/[^/?#]+)?"
    r")/hostedContents/[^/?#]+/\$value$"
)
HOSTED_PROXY = "/api/m365/teams/hosted?path="


def hosted_path(url_or_path: str) -> str | None:
    """The Graph path of a Teams inline picture, or None when it is anything else."""
    v = (url_or_path or "").strip()
    if v.startswith(GRAPH_HOST):
        v = "/" + v[len(GRAPH_HOST) :]
    v = urllib.parse.unquote(v) if "%24value" in v else v
    if ".." in v or not _HOSTED.match(v):
        return None
    return v


def _safe_href(v: str) -> str | None:
    v = (v or "").strip()
    low = v.lower()
    if low.startswith(("https://", "http://", "mailto:", "tel:")):
        return v
    return None


class _Clean(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open: list[str] = []
        self.skip = 0  # inside a dropped element (script, style...)
        self.mention_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag in DROP_WITH_CONTENT:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "at":  # a mention
            self.out.append('<span data-mention="1">')
            self.open.append("at")
            return
        if tag == "emoji":
            self.out.append(html.escape(a.get("alt") or ""))
            if tag not in VOID:
                self.open.append("emoji")
            return
        if tag == "attachment":  # files and quoted replies are listed separately
            self.open.append("attachment")
            return
        if tag not in ALLOWED:
            return
        if tag == "img":
            path = hosted_path(a.get("src") or "")
            if path:
                alt = html.escape(a.get("alt") or "")
                src = HOSTED_PROXY + urllib.parse.quote(path, safe="")
                self.out.append(f'<img src="{src}" alt="{alt}" loading="lazy">')
            elif a.get("alt"):  # an emoji picture or an outside image: its words only
                self.out.append(html.escape(a["alt"]))
            return
        if tag == "a":
            href = _safe_href(a.get("href") or "")
            if href is None:
                self.out.append("<span>")
                self.open.append("a-span")
                return
            self.out.append(
                f'<a href="{html.escape(href)}" target="_blank" rel="noreferrer noopener">'
            )
            self.open.append("a")
            return
        if tag in VOID:
            self.out.append(f"<{tag}>")
            return
        self.out.append(f"<{tag}>")
        self.open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("emoji", "img", "br", "hr"):
            self.handle_starttag(tag, attrs)
            if tag == "emoji" and self.open and self.open[-1] == "emoji":
                self.open.pop()

    def handle_endtag(self, tag: str) -> None:
        if tag in DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag in VOID:
            return
        want = {"at": "at", "emoji": "emoji", "attachment": "attachment"}.get(tag, tag)
        if want == "a" and self.open and self.open[-1] == "a-span":
            want = "a-span"
        if want not in self.open:
            return
        while self.open:
            top = self.open.pop()
            self.out.append(_close(top))
            if top == want:
                break

    def handle_data(self, data: str) -> None:
        if self.skip or (self.open and self.open[-1] in ("emoji", "attachment")):
            return
        self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.open:
            self.out.append(_close(self.open.pop()))
        return "".join(self.out).strip()


def _close(tag: str) -> str:
    if tag in ("emoji", "attachment"):
        return ""
    if tag in ("at", "a-span"):
        return "</span>"
    return f"</{tag}>"


def safe_html(content: str | None, content_type: str = "html") -> str:
    """A Teams body as safe HTML for the page (plain text bodies are escaped, lines kept)."""
    if not content:
        return ""
    if (content_type or "").lower() == "text":
        return html.escape(content).replace("\n", "<br>")
    p = _Clean()
    try:
        p.feed(content)
        p.close()
    except Exception:  # noqa: BLE001 - broken markup: show its text instead
        return html.escape(plain(content))
    return p.result()


_TAG = re.compile(r"<[^>]+>")


def plain(content: str | None) -> str:
    """A body (often HTML) as plain text."""
    text = (content or "").replace("<br>", "\n").replace("<br/>", "\n").replace("</p>", "\n")
    text = _TAG.sub(" ", text)
    return re.sub(r"[ \t]+", " ", html.unescape(text)).strip()


def text_html(text: str) -> str:
    """What a person typed (plain text) as the HTML Teams and Outlook expect."""
    return html.escape(text or "").replace("\n", "<br>")


# ---------------------------------------------------------------- Teams messages

REACTION_EMOJI = {
    "like": "👍",
    "heart": "❤️",
    "laugh": "😆",
    "surprised": "😮",
    "sad": "😢",
    "angry": "😡",
}


def _user(part: dict[str, Any] | None) -> dict[str, Any]:
    p = part or {}
    u = p.get("user") or p.get("application") or p.get("device") or {}
    return {"id": str(u.get("id") or ""), "name": str(u.get("displayName") or "")}


def _reactions(m: dict[str, Any], me: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for r in m.get("reactions") or []:
        kind = str(r.get("reactionType") or "")
        emoji = REACTION_EMOJI.get(kind, kind if kind and len(kind) <= 8 else "👍")
        g = groups.setdefault(emoji, {"emoji": emoji, "count": 0, "mine": False})
        g["count"] += 1
        uid = str(((r.get("user") or {}).get("user") or {}).get("id") or "")
        if me and uid == me:
            g["mine"] = True
    return list(groups.values())


def _attachments(m: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(files and cards, quoted messages) of a Teams message."""
    files: list[dict[str, Any]] = []
    quotes: list[dict[str, Any]] = []
    for a in m.get("attachments") or []:
        kind = str(a.get("contentType") or "")
        if kind == "messageReference":
            try:
                ref = json.loads(a.get("content") or "{}")
            except ValueError:
                ref = {}
            quotes.append(
                {
                    "id": str(ref.get("messageId") or a.get("id") or ""),
                    "from": _user(ref.get("messageSender")).get("name") or "",
                    "text": plain(ref.get("messagePreview"))[:300],
                }
            )
            continue
        url = str(a.get("contentUrl") or "")
        files.append(
            {
                "id": str(a.get("id") or ""),
                "name": str(a.get("name") or "")
                or (tr("Card") if "card" in kind else tr("Attachment")),
                "kind": "file" if kind == "reference" else ("card" if "card" in kind else "other"),
                "url": url if _safe_href(url) else None,
            }
        )
    return files, quotes


def _names(members: list[dict[str, Any]] | None) -> str:
    out = [str((m or {}).get("displayName") or "") for m in members or []]
    return ", ".join(n for n in out if n) or tr("someone")


def system_text(m: dict[str, Any]) -> str:
    """A Teams system event (someone added, a call ended, the chat renamed) in words."""
    d = m.get("eventDetail") or {}
    kind = str(d.get("@odata.type") or "").rsplit(".", 1)[-1]
    who = _user(d.get("initiator")).get("name") or tr("Someone")
    if kind == "membersAddedEventMessageDetail":
        return tr("{who} added {names}", who=who, names=_names(d.get("members")))
    if kind in ("membersDeletedEventMessageDetail", "membersLeftEventMessageDetail"):
        return tr("{who} removed {names}", who=who, names=_names(d.get("members")))
    if kind == "membersJoinedEventMessageDetail":
        return tr("{names} joined", names=_names(d.get("members")))
    if kind == "chatRenamedEventMessageDetail":
        return tr(
            "{who} renamed the chat to {topic}", who=who, topic=d.get("chatDisplayName") or ""
        )
    if kind == "callEndedEventMessageDetail":
        return tr("Call ended")
    if kind == "callStartedEventMessageDetail":
        return tr("Call started")
    if kind in ("callRecordingEventMessageDetail", "callTranscriptEventMessageDetail"):
        return tr("A recording or transcript was added")
    if kind == "teamsAppInstalledEventMessageDetail":
        return tr("{who} added an app", who=who)
    if kind == "channelAddedEventMessageDetail":
        return tr("{who} added a channel", who=who)
    if kind == "meetingPolicyUpdatedEventMessageDetail":
        return tr("Meeting settings changed")
    return tr("The conversation was updated")


def chat_message(m: dict[str, Any], me: str) -> dict[str, Any]:
    """One Teams chat message (or channel reply) for the page."""
    sender = _user(m.get("from"))
    body = m.get("body") or {}
    files, quotes = _attachments(m)
    system = m.get("messageType") not in (None, "message")
    deleted = bool(m.get("deletedDateTime"))
    kind = str(body.get("contentType") or "html")
    text = plain(body.get("content"))[:4000]
    mentions = [
        {
            "name": str(x.get("mentionText") or ""),
            "me": bool(me) and _user(x.get("mentioned")).get("id") == me,
        }
        for x in m.get("mentions") or []
    ]
    return {
        "id": str(m.get("id") or ""),
        "at": m.get("createdDateTime"),
        "kind": "system" if system else "message",
        "from": sender["name"],
        "from_id": sender["id"],
        "mine": bool(me) and sender["id"] == me,
        "html": "" if (deleted or system) else safe_html(body.get("content"), kind),
        "text": system_text(m) if system else ("" if deleted else text),
        "subject": plain(m.get("subject")) or None,
        "deleted": deleted,
        "edited": bool(m.get("lastEditedDateTime")) and not deleted,
        "importance": m.get("importance") if m.get("importance") in ("high", "urgent") else None,
        "reactions": _reactions(m, me),
        "files": files,
        "quotes": quotes,
        "mentions": mentions,
        "mentions_me": any(x["me"] for x in mentions),
        "url": m.get("webUrl"),
    }


def channel_post(p: dict[str, Any], replies: list[dict[str, Any]], me: str) -> dict[str, Any]:
    """A channel post with its thread (oldest reply first)."""
    out = chat_message(p, me)
    out["replies"] = [
        chat_message(r, me)
        for r in sorted(replies, key=lambda r: str(r.get("createdDateTime") or ""))
        if r.get("messageType") in (None, "message")
    ]
    return out


def chat_row(c: dict[str, Any], me_name: str, me_id: str) -> dict[str, Any]:
    """One chat in the list: its name, the people in it and its last message."""
    members = [
        {"id": str(m.get("userId") or ""), "name": str(m.get("displayName") or "")}
        for m in c.get("members") or []
    ]
    others = [m for m in members if m["name"] and m["id"] != me_id and m["name"] != me_name]
    last = c.get("lastMessagePreview") or {}
    last_from = _user(last.get("from"))
    return {
        "id": c.get("id"),
        "title": c.get("topic") or ", ".join(m["name"] for m in others[:5]) or tr("Chat"),
        "kind": c.get("chatType") or "",
        "people": len(members),
        "members": others[:12],
        "last_at": last.get("createdDateTime"),
        "last_from": last_from["name"] or None,
        "last_mine": bool(me_id) and last_from["id"] == me_id,
        "last_text": plain((last.get("body") or {}).get("content"))[:200],
        "url": c.get("webUrl"),
        "unread": chat_unread(c, me_id),
    }


def chat_unread(c: dict[str, Any], me_id: str) -> bool:
    """P109b: a chat whose last message (someone else's) came after the person last read it."""
    from .graph import parse_time

    last = c.get("lastMessagePreview") or {}
    sender = ((last.get("from") or {}).get("user") or {}).get("id")
    at = parse_time(last.get("createdDateTime"))
    view = c.get("viewpoint")
    if at is None or not isinstance(view, dict) or (me_id and sender == me_id):
        return False  # no viewpoint from Microsoft: not known, so not counted
    read = parse_time(view.get("lastMessageReadDateTime"))
    return read is None or at > read


# ---------------------------------------------------------------- mail


def _addr(part: dict[str, Any] | None) -> dict[str, str]:
    e = (part or {}).get("emailAddress") or {}
    return {"name": str(e.get("name") or ""), "address": str(e.get("address") or "").lower()}


def mail_row(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": m.get("id"),
        "conversation_id": m.get("conversationId"),
        "subject": m.get("subject") or "",
        "from": _addr(m.get("from") or m.get("sender")),
        "to": [_addr(x) for x in m.get("toRecipients") or []],
        "cc": [_addr(x) for x in m.get("ccRecipients") or []],
        "received_at": m.get("receivedDateTime") or m.get("sentDateTime"),
        "is_read": bool(m.get("isRead")),
        "is_draft": bool(m.get("isDraft")),
        "has_attachments": bool(m.get("hasAttachments")),
        "importance": m.get("importance") or "normal",
        "flagged": ((m.get("flag") or {}).get("flagStatus") or "") == "flagged",
        "preview": (m.get("bodyPreview") or "")[:300],
        "web_link": m.get("webLink"),
    }


def mail_full(m: dict[str, Any]) -> dict[str, Any]:
    body = m.get("body") or {}
    is_html = (body.get("contentType") or "").lower() == "html"
    return {
        **mail_row(m),
        "body_html": (body.get("content") or "") if is_html else "",
        "body_text": "" if is_html else (body.get("content") or ""),
        "reply_to": [_addr(x) for x in m.get("replyTo") or []],
        "attachments": [
            {
                "id": a.get("id"),
                "name": a.get("name") or tr("Attachment"),
                "size": int(a.get("size") or 0),
                "content_type": a.get("contentType") or "",
                "inline": bool(a.get("isInline")),
            }
            for a in m.get("attachments") or []
        ],
    }


# ---------------------------------------------------------------- calendar


def _when(part: dict[str, Any] | None) -> str | None:
    v = (part or {}).get("dateTime")
    return str(v) if v else None


def event_row(e: dict[str, Any]) -> dict[str, Any]:
    online = e.get("onlineMeeting") or {}
    return {
        "id": e.get("id"),
        "subject": e.get("subject") or tr("(no title)"),
        "start": _when(e.get("start")),
        "end": _when(e.get("end")),
        "all_day": bool(e.get("isAllDay")),
        "cancelled": bool(e.get("isCancelled")),
        "location": ((e.get("location") or {}).get("displayName") or ""),
        "organizer": _addr(e.get("organizer")),
        "attendees": [
            {
                **_addr(a),
                "type": a.get("type") or "required",
                "response": ((a.get("status") or {}).get("response") or "none"),
            }
            for a in e.get("attendees") or []
        ],
        "show_as": e.get("showAs") or "busy",
        "join_url": online.get("joinUrl") if _safe_href(online.get("joinUrl") or "") else None,
        "web_link": e.get("webLink"),
        "preview": (e.get("bodyPreview") or "")[:300],
    }


def event_full(e: dict[str, Any]) -> dict[str, Any]:
    body = e.get("body") or {}
    return {
        **event_row(e),
        "is_organizer": bool(e.get("isOrganizer")),
        "my_response": ((e.get("responseStatus") or {}).get("response") or "none"),
        "body_html": body.get("content") or "",
    }


# ---------------------------------------------------------------- Teams Approvals


def approval_row(a: dict[str, Any]) -> dict[str, Any]:
    roles = [str(r) for r in ((a.get("viewPoint") or {}).get("roles") or [])]
    state = str(a.get("state") or "").lower()
    return {
        "id": a.get("id"),
        "title": a.get("displayName") or tr("(no title)"),
        "description": a.get("description") or "",
        "state": state,  # pending | completed | canceled | created
        "result": a.get("result"),
        "owner": _user(a.get("owner")).get("name") or "",
        "created_at": a.get("createdDateTime"),
        "completed_at": a.get("completedDateTime"),
        "kind": a.get("approvalType") or "basic",
        "options": [str(o) for o in a.get("responseOptions") or ["Approve", "Reject"]],
        "i_approve": any(r.lower() == "approver" for r in roles),
        "i_own": any(r.lower() == "owner" for r in roles),
    }
