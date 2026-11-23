"""P109: the Microsoft 365 page: a person's own Outlook mail, Teams chats and channels,
calendar and Teams Approvals, with "Ask AI".

Everything here is the signed-in person's OWN Microsoft 365 connection (MicrosoftAccount of
that person; never anyone else's, never a shared mailbox): every route starts from
`_mine`, so an owner or admin cannot open someone else's mail, chats or calendar through it.
Microsoft itself refuses what the person may not see (a chat they are not in).

A person sends their own words: Reply / Reply all / Forward / New email, a Teams message, a
channel reply, a new event, an answer to an invitation or approval. "Ask AI" only answers or
drafts (microsoft/assist.py): the draft fills the composer and the person edits and presses
Send. Every send is audited (who, where; never the text).

Mail:     GET /api/m365/mail, GET/POST /api/m365/mail/{id}[/read|/reply|/forward],
          GET /api/m365/mail/{id}/attachments/{aid}, POST .../save, POST /api/m365/mail/send
Teams:    GET /api/m365/teams/chats, GET/POST /api/m365/teams/chats/{id}/messages,
          GET/POST /api/m365/teams/teams/{team}/channels/{channel}/posts,
          GET /api/m365/teams/hosted?path=  (an inline picture of a message)
Calendar: GET/POST /api/m365/calendar, GET /api/m365/calendar/{id},
          POST /api/m365/calendar/{id}/respond
Approvals: GET /api/m365/approvals, POST /api/m365/approvals/{id}/respond
AI:       POST /api/m365/ai
"""

import asyncio
import logging
import urllib.parse
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...microsoft import access, app, assist, auth, graph, hub
from ...microsoft.errors import MicrosoftError
from ...models import MicrosoftAccount, Workspace
from ...services import audit
from ..deps import Principal, api_error, ensure_allowance, require
from .microsoft import _channels_fail, _kept, _say, _teams_fail

# P118: which of the person's own Microsoft accounts this request is for: the X-M365-Account
# header (or ?account= on a plain link, e.g. an attachment); none means their main account.
_PICKED: ContextVar[str] = ContextVar("m365_account", default="")


async def _pick_account(request: Request) -> None:
    raw = request.headers.get("x-m365-account") or request.query_params.get("account") or ""
    _PICKED.set(raw.strip()[:40])


router = APIRouter(prefix="/api/m365", tags=["m365"], dependencies=[Depends(_pick_account)])
log = logging.getLogger("agentic.api.m365")

FOLDERS = ("inbox", "sentitems", "drafts", "archive", "deleteditems", "junkemail")
MAX_RANGE_DAYS = 42
CHATS_FOR = 30  # seconds the chat list is kept (Microsoft is slow to list chats)


# ---------------------------------------------------------------- the person's own connection


async def _mine(db: AsyncSession, principal: Principal) -> tuple[MicrosoftAccount, graph.Graph]:
    picked = _PICKED.get()
    if picked:  # P118: one of their own extra accounts (never anyone else's: 404)
        acct = await access.own_account(db, principal.workspace_id, principal.user.id, picked)
        if acct is None:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "account_not_found", "That account is not yours here."
            )
    else:
        acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is not None and acct.status == "pending":  # P124: waits for approval: unused
        raise api_error(
            status.HTTP_409_CONFLICT,
            "waiting_approval",
            "This email account is waiting for approval. You can use it once it is approved.",
        )
    if acct is None or acct.status not in access.USABLE_ACCOUNT:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "microsoft_not_connected",
            "Connect your Microsoft 365 account first.",
        )
    return acct, await graph.for_account(db, acct)


def _fail(e: MicrosoftError) -> Exception:
    st = getattr(e, "status", 0)
    if st == 404:
        return api_error(
            status.HTTP_404_NOT_FOUND, "not_found", "That was not found in Microsoft 365."
        )
    if st == 403:
        return api_error(
            status.HTTP_409_CONFLICT,
            "microsoft_not_allowed",
            "Your Microsoft 365 connection may not do this yet. Reconnect Microsoft 365 once.",
        )
    return api_error(status.HTTP_502_BAD_GATEWAY, "microsoft_error", _say(e))


async def _sent(
    db: AsyncSession, principal: Principal, action: str, target: str, **after: Any
) -> None:
    await audit.record(
        db, principal.workspace_id, principal.actor, action, target=target[:200], after=after
    )
    await db.commit()


# ---------------------------------------------------------------- mail


@router.get("/mail")
async def mail_list(
    folder: str = Query(default="inbox"),
    skip: int = Query(default=0, ge=0, le=5000),
    top: int = Query(default=25, ge=1, le=50),
    q: str = Query(default="", max_length=200),
    unread: bool = Query(default=False),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A folder of the person's own Outlook, newest first (or a search in it)."""
    if folder not in FOLDERS:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_folder", "That mail folder is not known.")
    _, g = await _mine(db, principal)
    try:
        rows = await g.folder_messages(
            folder, top=top, skip=skip, unread_only=unread, query=q.strip()
        )
    except MicrosoftError as e:
        raise _fail(e) from e
    more = len(rows) >= top and not q.strip()
    return {
        "items": [hub.mail_row(m) for m in rows],
        "next_skip": skip + len(rows) if more else None,
    }


@router.get("/mail/{message_id}")
async def mail_read(
    message_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _, g = await _mine(db, principal)
    try:
        m = await g.get_message(message_id, body=True, body_type="html")
    except MicrosoftError as e:
        raise _fail(e) from e
    return hub.mail_full(m)


class ReadIn(BaseModel):
    read: bool = True


@router.post("/mail/{message_id}/read")
async def mail_mark_read(
    message_id: str,
    body: ReadIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    _, g = await _mine(db, principal)
    try:
        await g.mark_read(message_id, body.read)
    except MicrosoftError as e:
        raise _fail(e) from e
    return {"read": body.read}


@router.get("/mail/{message_id}/attachments/{attachment_id}")
async def mail_attachment(
    message_id: str,
    attachment_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Download one attachment of the person's own mail (always as a download, never shown
    inline by the browser)."""
    _, g = await _mine(db, principal)
    try:
        name, _ctype, data = await g.get_attachment_bytes(message_id, attachment_id)
    except MicrosoftError as e:
        raise _fail(e) from e
    quoted = urllib.parse.quote(name)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/mail/{message_id}/attachments/{attachment_id}/save")
async def mail_attachment_save(
    message_id: str,
    attachment_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Save one attachment into the person's own Files (My workspace/Email attachments),
    through the files service: checked and read like an upload."""
    from ...microsoft.features import save_attachment

    acct, g = await _mine(db, principal)
    try:
        meta = next(
            (a for a in await g.list_attachments(message_id) if a.get("id") == attachment_id), None
        )
    except MicrosoftError as e:
        raise _fail(e) from e
    if meta is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "not_found", "That was not found in Microsoft 365."
        )
    got = await save_attachment(db, acct, message_id, meta, g=g)
    if isinstance(got, str):
        raise api_error(status.HTTP_409_CONFLICT, "not_saved", "{why}", why=got)
    return {"file_id": got.id, "name": got.name, "folder": got.folder}


class ReplyIn(BaseModel):
    body: str = Field(default="", max_length=50_000)
    reply_all: bool = False
    send: bool = True  # False: keep it in Outlook's Drafts


class ForwardIn(BaseModel):
    to: list[EmailStr] = Field(min_length=1, max_length=50)
    body: str = Field(default="", max_length=50_000)
    send: bool = True


class NewMailIn(BaseModel):
    to: list[EmailStr] = Field(min_length=1, max_length=100)
    cc: list[EmailStr] = Field(default_factory=list, max_length=100)
    subject: str = Field(min_length=1, max_length=400)
    body: str = Field(default="", max_length=50_000)
    send: bool = True


def _draft_out(d: dict[str, Any], sent: bool) -> dict[str, Any]:
    return {"sent": sent, "draft_id": None if sent else d.get("id"), "web_link": d.get("webLink")}


@router.post("/mail/{message_id}/reply")
async def mail_reply(
    message_id: str,
    body: ReplyIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The person's own reply: sent at once (they pressed Send), or kept as a draft."""
    if body.send and not body.body.strip():
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty", "Write the message first.")
    _, g = await _mine(db, principal)
    try:
        d = await g.create_reply_draft(
            message_id, hub.text_html(body.body), reply_all=body.reply_all
        )
        if body.send:
            await g.send_draft(str(d.get("id") or ""))
    except MicrosoftError as e:
        raise _fail(e) from e
    if body.send:
        await _sent(db, principal, "m365.mail_replied", message_id, reply_all=body.reply_all)
    return _draft_out(d, body.send)


@router.post("/mail/{message_id}/forward")
async def mail_forward(
    message_id: str,
    body: ForwardIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _, g = await _mine(db, principal)
    to = [str(a) for a in body.to]
    try:
        d = await g.create_forward_draft(message_id, to, hub.text_html(body.body))
        if body.send:
            await g.send_draft(str(d.get("id") or ""))
    except MicrosoftError as e:
        raise _fail(e) from e
    if body.send:
        await _sent(db, principal, "m365.mail_forwarded", message_id, to=len(to))
    return _draft_out(d, body.send)


@router.post("/mail/send")
async def mail_send(
    body: NewMailIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new email the person wrote: sent at once, or kept in Outlook's Drafts."""
    _, g = await _mine(db, principal)
    to, cc = [str(a) for a in body.to], [str(a) for a in body.cc]
    try:
        d = await g.create_draft(to, body.subject.strip(), hub.text_html(body.body), cc=cc)
        if body.send:
            await g.send_draft(str(d.get("id") or ""))
    except MicrosoftError as e:
        raise _fail(e) from e
    if body.send:
        await _sent(db, principal, "m365.mail_sent", "new", to=len(to), cc=len(cc))
    return _draft_out(d, body.send)


# ---------------------------------------------------------------- Teams chats


@router.get("/teams/chats")
async def chats(
    fresh: bool = Query(default=False),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The person's own Teams chats, most recent first, with the people in them."""
    acct, g = await _mine(db, principal)
    me_name, me_id = acct.display_name or "", acct.ms_user_id or ""

    async def make() -> list[dict[str, Any]]:
        try:
            return [hub.chat_row(c, me_name, me_id) for c in await g.list_chats(50)]
        except MicrosoftError as e:
            raise _teams_fail(e) from e

    key = f"m365:chats:{principal.workspace_id}:{principal.user.id}"
    return await _kept(key, CHATS_FOR, fresh, make)


def _older_link(chat_id: str, before: str) -> str | None:
    """Only a link to older messages of this same chat is followed."""
    want = (
        f"{graph.GRAPH}/me/chats/{urllib.parse.quote(chat_id, safe='')}/messages",
        f"{graph.GRAPH}/chats/{urllib.parse.quote(chat_id, safe='')}/messages",
    )
    return before if before.startswith(want) and ".." not in before else None


@router.get("/teams/chats/{chat_id}/messages")
async def chat_messages(
    chat_id: str,
    before: str = Query(default="", max_length=4000),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A chat's messages, oldest first, as Teams shows them; `more` gets older ones."""
    acct, g = await _mine(db, principal)
    link = _older_link(chat_id, before) if before else None
    if before and link is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page link is not valid.")
    try:
        msgs, nxt = await g.chat_page(chat_id, 40, link)
        info = await g.chat(chat_id) if not before else {}
    except MicrosoftError as e:
        raise _teams_fail(e) from e
    me = acct.ms_user_id or ""
    out: dict[str, Any] = {
        "messages": [hub.chat_message(m, me) for m in reversed(msgs)],
        "more": nxt,
    }
    if info:
        out["chat"] = hub.chat_row(info, acct.display_name or "", me)
    return out


class ChatSendIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


@router.post("/teams/chats/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def chat_send(
    chat_id: str,
    body: ChatSendIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A message the person wrote, posted in their own chat now."""
    if not body.text.strip():
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty", "Write the message first.")
    acct, g = await _mine(db, principal)
    try:
        m = await g.send_chat_html(chat_id, hub.text_html(body.text.strip()))
    except MicrosoftError as e:
        raise _teams_fail(e) from e
    await _sent(db, principal, "m365.teams_sent", chat_id)
    from ...core.valkey import valkey

    try:
        await valkey().delete(f"m365:chats:{principal.workspace_id}:{principal.user.id}")
    except Exception:  # noqa: BLE001,S110 - a stale list refreshes itself soon
        pass
    shaped = hub.chat_message(m, acct.ms_user_id or "") if m.get("id") else None
    return shaped or {"id": "", "mine": True, "text": body.text.strip()}


# ---------------------------------------------------------------- Teams channels


async def _channels(db: AsyncSession, principal: Principal) -> tuple[MicrosoftAccount, graph.Graph]:
    acct, g = await _mine(db, principal)
    if not auth.has_scope(acct.scopes, app.CHANNEL_SCOPE):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "teams_channels_off",
            "Reading Teams channel posts needs your Microsoft 365 admin to turn it on "
            "(Channels > Microsoft 365), then reconnect Microsoft.",
        )
    return acct, g


@router.get("/teams/teams/{team_id}/channels/{channel_id}/posts")
async def channel_posts(
    team_id: str,
    channel_id: str,
    limit: int = Query(default=25, ge=1, le=50),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """A channel's recent posts, each with its thread, oldest post first (as Teams shows)."""
    acct, g = await _channels(db, principal)
    me = acct.ms_user_id or ""
    try:
        posts = await g.channel_messages(team_id, channel_id, limit)
        gate = asyncio.Semaphore(4)

        async def replies(p: dict[str, Any]) -> list[dict[str, Any]]:
            if "replies" in p:
                return list(p.get("replies") or [])
            async with gate:
                return await g.message_replies(team_id, channel_id, str(p.get("id")), 50)

        threads = await asyncio.gather(*(replies(p) for p in posts))
    except MicrosoftError as e:
        raise _channels_fail(e) from e
    out = [
        hub.channel_post(p, r, me)
        for p, r in zip(posts, threads, strict=True)
        if p.get("messageType") in (None, "message") or p.get("eventDetail")
    ]
    out.sort(key=lambda p: str(p.get("at") or ""))
    return out


class PostIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    reply_to: str = Field(default="", max_length=200)
    subject: str = Field(default="", max_length=250)


@router.post(
    "/teams/teams/{team_id}/channels/{channel_id}/posts", status_code=status.HTTP_201_CREATED
)
async def channel_send(
    team_id: str,
    channel_id: str,
    body: PostIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The person's own reply in a thread (or a new post), posted now."""
    acct, g = await _mine(db, principal)
    if not auth.has_scope(acct.scopes, app.CHANNEL_SEND_SCOPE):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "teams_channel_send_off",
            "Posting in Teams channels needs your Microsoft 365 admin to turn it on "
            "(Channels > Microsoft 365), then reconnect Microsoft.",
        )
    if not body.text.strip():
        raise api_error(status.HTTP_400_BAD_REQUEST, "empty", "Write the message first.")
    try:
        m = await g.channel_post(
            team_id,
            channel_id,
            hub.text_html(body.text.strip()),
            reply_to=body.reply_to.strip(),
            subject=body.subject.strip(),
        )
    except MicrosoftError as e:
        raise _channels_fail(e) from e
    await _sent(
        db,
        principal,
        "m365.channel_posted",
        f"{team_id}/{channel_id}",
        reply=bool(body.reply_to.strip()),
    )
    return hub.chat_message(m, acct.ms_user_id or "") if m.get("id") else {"id": ""}


@router.get("/teams/hosted")
async def hosted(
    path: str = Query(min_length=10, max_length=2000),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """An inline picture of a Teams message, fetched with the person's own connection (so
    Microsoft decides whether they may see it). Only pictures are answered."""
    clean = hub.hosted_path(path)
    if clean is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_path", "That picture link is not valid.")
    _, g = await _mine(db, principal)
    try:
        target = graph.GRAPH_BETA + clean[5:] if clean.startswith("/beta/") else clean[5:]
        data = await g.hosted_content(target)
    except MicrosoftError as e:
        raise _teams_fail(e) from e
    mime = _image_type(data)
    if not mime.startswith("image/"):
        raise api_error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "not_image", "That is not a picture."
        )
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


def _image_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


# ---------------------------------------------------------------- calendar


def _utc(v: str | None) -> str | None:
    """Graph's calendar times (asked in UTC) as ISO with the zone, for the browser."""
    if not v:
        return None
    t = graph.parse_time(v if v.endswith("Z") or "+" in v[10:] else v + "Z")
    return t.astimezone(UTC).isoformat().replace("+00:00", "Z") if t else None


def _event(e: dict[str, Any], full: bool = False) -> dict[str, Any]:
    out = hub.event_full(e) if full else hub.event_row(e)
    out["start"], out["end"] = _utc(out["start"]), _utc(out["end"])
    return out


def _parse(v: str, name: str) -> datetime:
    t = graph.parse_time(v)
    if t is None:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_time", "That time is not valid ({name}).", name=name
        )
    return t


@router.get("/calendar")
async def calendar(
    start: str = Query(min_length=10, max_length=40),
    end: str = Query(min_length=10, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The person's own Outlook calendar between two times (at most six weeks)."""
    a, b = _parse(start, "start"), _parse(end, "end")
    if b <= a or b - a > timedelta(days=MAX_RANGE_DAYS):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "bad_range",
            "Pick a range of up to {days} days.",
            days=MAX_RANGE_DAYS,
        )
    _, g = await _mine(db, principal)
    try:
        events = await g.calendar_view(a, b, top=250, tz="UTC")
    except MicrosoftError as e:
        raise _fail(e) from e
    return [_event(e) for e in events]


@router.get("/calendar/{event_id}")
async def calendar_event(
    event_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _, g = await _mine(db, principal)
    try:
        e = await g.event_detail(event_id, tz="UTC")
    except MicrosoftError as e2:
        raise _fail(e2) from e2
    return _event(e, full=True)


class EventIn(BaseModel):
    subject: str = Field(min_length=1, max_length=255)
    start: datetime
    end: datetime
    attendees: list[EmailStr] = Field(default_factory=list, max_length=100)
    location: str = Field(default="", max_length=255)
    body: str = Field(default="", max_length=20_000)
    online: bool = False


@router.post("/calendar", status_code=status.HTTP_201_CREATED)
async def calendar_create(
    body: EventIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """An event the person made (invitations go to the guests now)."""
    start = body.start if body.start.tzinfo else body.start.replace(tzinfo=UTC)
    end = body.end if body.end.tzinfo else body.end.replace(tzinfo=UTC)
    if end <= start:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_range", "The end must be after the start."
        )
    _, g = await _mine(db, principal)
    try:
        e = await g.create_event(
            body.subject.strip(),
            start,
            end,
            attendees=[str(a) for a in body.attendees],
            body_html=hub.text_html(body.body) if body.body.strip() else "",
            location=body.location.strip(),
            online_meeting=body.online,
        )
    except MicrosoftError as e2:
        raise _fail(e2) from e2
    await _sent(
        db, principal, "m365.event_created", str(e.get("id") or ""), guests=len(body.attendees)
    )
    return {"id": e.get("id"), "web_link": e.get("webLink")}


class RespondIn(BaseModel):
    answer: Literal["accept", "tentative", "decline"]
    comment: str = Field(default="", max_length=2000)


@router.post("/calendar/{event_id}/respond")
async def calendar_respond(
    event_id: str,
    body: RespondIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _, g = await _mine(db, principal)
    try:
        await g.respond_event(event_id, body.answer, body.comment.strip())
    except MicrosoftError as e:
        raise _fail(e) from e
    await _sent(db, principal, "m365.event_answered", event_id, answer=body.answer)
    return {"answer": body.answer}


# ---------------------------------------------------------------- Teams Approvals


def _approvals_off() -> Exception:
    return api_error(
        status.HTTP_409_CONFLICT,
        "approvals_off",
        "Teams Approvals need the Microsoft Graph permission {scope} with admin consent. Your "
        "Microsoft 365 admin adds it in Microsoft Entra and turns it on (Channels > Microsoft "
        "365); then reconnect Microsoft.",
        scope=app.APPROVALS_SCOPE,
    )


@router.get("/approvals")
async def approvals(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Teams Approvals the person is asked for or started (newest first)."""
    acct, g = await _mine(db, principal)
    if not auth.has_scope(acct.scopes, app.APPROVALS_SCOPE):
        raise _approvals_off()
    try:
        items = await g.approvals()
    except MicrosoftError as e:
        if getattr(e, "status", 0) in (401, 403):
            raise _approvals_off() from e
        if getattr(e, "status", 0) == 404:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "approvals_unavailable",
                "Teams Approvals are not set up in your Microsoft 365 yet (open the Approvals "
                "app in Teams once), or Microsoft does not offer them to your account.",
            ) from e
        raise _fail(e) from e
    return [hub.approval_row(a) for a in items]


class ApprovalIn(BaseModel):
    response: str = Field(min_length=1, max_length=60)
    comment: str = Field(default="", max_length=2000)


@router.post("/approvals/{approval_id}/respond")
async def approval_respond(
    approval_id: str,
    body: ApprovalIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """The person's own answer (Approve / Reject, or the item's own options)."""
    acct, g = await _mine(db, principal)
    if not auth.has_scope(acct.scopes, app.APPROVALS_SCOPE):
        raise _approvals_off()
    try:
        # P122: the one approval, read directly (the list is now every page, newest first).
        try:
            item = await g.approval(approval_id)
        except MicrosoftError as e:
            if getattr(e, "status", 0) != 404:
                raise
            item = None
        if not item or str(item.get("id") or "") != approval_id:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "not_found", "That was not found in Microsoft 365."
            )
        row = hub.approval_row(item)
        if not row["i_approve"] or row["state"] != "pending":
            raise api_error(
                status.HTTP_409_CONFLICT,
                "not_yours",
                "This approval is not waiting for your answer.",
            )
        if body.response not in row["options"]:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_response", "Pick one of the approval's answers."
            )
        await g.respond_approval(approval_id, body.response, body.comment.strip())
    except MicrosoftError as e:
        raise _fail(e) from e
    await _sent(db, principal, "m365.approval_answered", approval_id, response=body.response)
    return {"response": body.response}


# P122 (Fitri, 21 Nov 2026: "approvals from the Teams side need to be in there"): ask colleagues
# for an approval in the Approvals app in Teams. The approvers are office members whose Microsoft
# account (signed in with Microsoft, same organisation) is known here, so no directory permission
# is needed; Microsoft notifies them in Teams and by email.


async def _approvers(
    db: AsyncSession, principal: Principal, tenant: str
) -> dict[str, tuple[str, str]]:
    """{user_id: (name, Microsoft object ID)} of the active members of this office in the same
    Microsoft organisation, not the person themself."""
    from sqlalchemy import select

    from ...models import Membership, User

    rows = await db.execute(
        select(User.id, User.name, Membership.ms_oid)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.workspace_id == principal.workspace_id,
            User.is_active.is_(True),
            Membership.ms_oid.is_not(None),
            Membership.ms_tenant_id == tenant,
            User.id != principal.user.id,
        )
        .order_by(User.name)
    )
    return {uid: (name, oid) for uid, name, oid in rows.all() if oid}


@router.get("/approvals/people")
async def approval_people(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, str]]:
    """Who this person may ask for an approval."""
    acct, _ = await _mine(db, principal)
    people = await _approvers(db, principal, acct.tenant_id)
    return [{"user_id": uid, "name": name} for uid, (name, _oid) in people.items()]


class NewApprovalIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    approvers: list[str] = Field(min_length=1, max_length=20)
    all_must_approve: bool = False


@router.post("/approvals", status_code=status.HTTP_202_ACCEPTED)
async def approval_create(
    body: NewApprovalIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A new approval in Teams, asked by this person of the colleagues they picked."""
    acct, g = await _mine(db, principal)
    if not auth.has_scope(acct.scopes, app.APPROVALS_SCOPE):
        raise _approvals_off()
    people = await _approvers(db, principal, acct.tenant_id)
    unknown = [u for u in body.approvers if u not in people]
    if unknown:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "approver_unknown",
            "Pick approvers from the list: people of your organisation who signed in with "
            "Microsoft here.",
        )
    ids = list(dict.fromkeys(people[u][1] for u in body.approvers))
    try:
        await g.create_approval(
            body.title.strip(),
            body.description.strip(),
            ids,
            all_must_approve=body.all_must_approve,
        )
    except MicrosoftError as e:
        if getattr(e, "status", 0) in (401, 403):
            raise _approvals_off() from e
        raise _fail(e) from e
    await _sent(
        db,
        principal,
        "m365.approval_created",
        body.title,
        approvers=body.approvers,
        all_must_approve=body.all_must_approve,
    )
    return {"approvers": [people[u][0] for u in body.approvers]}


# ---------------------------------------------------------------- Ask AI


Action = Literal[
    "mail_summary",
    "mail_reply",
    "mail_tasks",
    "mail_new",
    "chat_about",
    "chat_reply",
    "channel_about",
    "channel_reply",
    "meeting_prep",
    "event_draft",
]


class AiIn(BaseModel):
    action: Action
    message_id: str = Field(default="", max_length=400)
    chat_id: str = Field(default="", max_length=400)
    team_id: str = Field(default="", max_length=200)
    channel_id: str = Field(default="", max_length=200)
    post_id: str = Field(default="", max_length=200)
    event_id: str = Field(default="", max_length=400)
    tone: str = Field(default="", max_length=20)
    instructions: str = Field(default="", max_length=4000)
    to: str = Field(default="", max_length=1000)
    lang: str = Field(default="", max_length=5)


def _need(v: str, what: str) -> str:
    if not v.strip():
        raise api_error(status.HTTP_400_BAD_REQUEST, "missing", "Say which {what}.", what=what)
    return v.strip()


@router.post("/ai")
async def ai(
    body: AiIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Ask AI about the person's own mail, chat, channel thread or meeting: a summary, a draft
    (that fills the composer: nothing is sent), tasks, or an event to check and create."""
    from ...engine import gateway

    acct, g = await _mine(db, principal)
    await ensure_allowance(db, principal)
    me = acct.ms_user_id or ""
    a = body.action
    lang = body.lang if body.lang in ("en", "ms") else ""
    out: dict[str, Any] = {"action": a}
    ws_id = principal.workspace_id
    try:
        if a.startswith("mail_") and a != "mail_new":
            m = await g.get_message(_need(body.message_id, "email"), body=True, body_type="text")
            data = assist.mail_text(m)
            if a == "mail_summary":
                prompt = assist.summary_prompt("email", data, body.instructions)
                out["text"] = await assist.ask(db, ws_id, prompt, task="m365.mail_summary")
            elif a == "mail_reply":
                prompt = assist.reply_prompt(
                    "email", data, tone=body.tone, instructions=body.instructions, lang=lang
                )
                draft = await assist.ask(db, ws_id, prompt, task="m365.mail_reply")
                out["body"] = assist.clean_draft(draft)
            else:
                prompt = assist.tasks_prompt(data)
                raw = await assist.ask(db, ws_id, prompt, task="m365.mail_tasks", temperature=0.1)
                got = assist.parse_json(raw)
                out["tasks"] = [
                    {"title": str(t.get("title") or "")[:200], "due": _day(t.get("due"))}
                    for t in (got if isinstance(got, list) else [])
                    if isinstance(t, dict) and str(t.get("title") or "").strip()
                ][:8]
        elif a == "mail_new":
            prompt = assist.new_mail_prompt(
                _need(body.instructions, "message"), to=body.to, tone=body.tone, lang=lang
            )
            got = assist.parse_json(await assist.ask(db, ws_id, prompt, task="m365.mail_new"))
            got = got if isinstance(got, dict) else {}
            out["subject"] = str(got.get("subject") or "")[:400]
            out["body"] = str(got.get("body") or "")
        elif a in ("chat_about", "chat_reply"):
            msgs, _ = await g.chat_page(_need(body.chat_id, "chat"), 40)
            data = assist.chat_text([hub.chat_message(m, me) for m in reversed(msgs)])
            out.update(await _talk(db, ws_id, a == "chat_reply", "Teams chat", data, body, lang))
        elif a in ("channel_about", "channel_reply"):
            if not auth.has_scope(acct.scopes, app.CHANNEL_SCOPE):
                raise _no_channels()
            team, channel = _need(body.team_id, "team"), _need(body.channel_id, "channel")
            post = body.post_id.strip()
            posts = await g.channel_messages(team, channel, 50 if post else 15)
            if post:
                posts = [p for p in posts if str(p.get("id")) == post]
            shaped = []
            for p in posts:
                reps = p.get("replies")
                if reps is None:
                    reps = await g.message_replies(team, channel, str(p.get("id")), 50)
                shaped.append(hub.channel_post(p, reps, me))
            shaped.sort(key=lambda p: str(p.get("at") or ""))
            what = "Teams channel thread" if post else "Teams channel"
            data = assist.chat_text(shaped)
            out.update(await _talk(db, ws_id, a == "channel_reply", what, data, body, lang))
        elif a == "meeting_prep":
            e = await g.event_detail(_need(body.event_id, "meeting"), tz="UTC")
            prompt = assist.meeting_prompt(_event_text(e), await _related(g, e))
            out["text"] = await assist.ask(
                db, ws_id, prompt, task="m365.meeting_prep", max_tokens=1200
            )
        else:  # event_draft
            ws = await db.get(Workspace, ws_id)
            tz = ws.timezone if ws is not None else "Asia/Kuala_Lumpur"
            when = datetime.now(UTC)
            prompt = assist.event_prompt(_need(body.instructions, "meeting"), now=when, tz=tz)
            raw = await assist.ask(db, ws_id, prompt, task="m365.event_draft", temperature=0.1)
            got = assist.parse_json(raw)
            out["event"] = _event_draft(got if isinstance(got, dict) else {}, tz)
    except MicrosoftError as e:
        raise _fail(e) from e
    except gateway.GatewayUnavailable as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "No AI model could answer right now. Try again in a minute.",
        ) from e
    await audit.record(db, ws_id, principal.actor, "m365.ai_asked", target=a)
    await db.commit()
    return out


def _no_channels() -> Exception:
    return api_error(
        status.HTTP_409_CONFLICT,
        "teams_channels_off",
        "Reading Teams channel posts needs your Microsoft 365 admin to turn it on "
        "(Channels > Microsoft 365), then reconnect Microsoft.",
    )


async def _talk(
    db: AsyncSession, ws_id: str, reply: bool, what: str, data: str, body: AiIn, lang: str
) -> dict[str, Any]:
    if reply:
        prompt = assist.reply_prompt(
            what, data, tone=body.tone, instructions=body.instructions, lang=lang
        )
        text = await assist.ask(db, ws_id, prompt, task="m365.teams_reply")
        return {"body": assist.clean_draft(text)}
    prompt = assist.summary_prompt(what, data, body.instructions)
    return {"text": await assist.ask(db, ws_id, prompt, task="m365.teams_about")}


def _day(v: Any) -> str | None:
    s = str(v or "").strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date().isoformat()  # noqa: DTZ007
    except ValueError:
        return None


def _event_text(e: dict[str, Any]) -> str:
    row = hub.event_full(e)
    guests = ", ".join(f"{x['name']} <{x['address']}>" for x in row["attendees"])
    return (
        f"Title: {row['subject']}\nStarts (UTC): {row['start']}\nEnds (UTC): {row['end']}\n"
        f"Where: {row['location']}\nOrganiser: {row['organizer']['name']} "
        f"<{row['organizer']['address']}>\nGuests: {guests}\n\n"
        f"{hub.plain(row['body_html'])[:4000]}"
    )


async def _related(g: graph.Graph, e: dict[str, Any]) -> str:
    """Recent mail about the meeting: its subject words, and from its organiser."""
    subject = str(e.get("subject") or "").strip()
    words = " ".join(w for w in subject.replace('"', " ").split() if len(w) > 2)[:80]
    queries = [
        q
        for q in (words, ((e.get("organizer") or {}).get("emailAddress") or {}).get("address"))
        if q
    ]
    seen: set[str] = set()
    lines: list[str] = []
    for q in queries[:2]:
        try:
            found = await g.search_messages(str(q), 6)
        except MicrosoftError:
            continue
        for m in found:
            mid = str(m.get("id") or "")
            if mid in seen:
                continue
            seen.add(mid)
            sender = (m.get("from") or {}).get("emailAddress") or {}
            who = sender.get("name") or sender.get("address") or "?"
            lines.append(
                f"- {m.get('receivedDateTime') or ''} from {who}: "
                f"{m.get('subject') or ''} — {(m.get('bodyPreview') or '')[:400]}"
            )
    return "\n".join(lines[:10])


def _event_draft(d: dict[str, Any], tz: str) -> dict[str, Any]:
    """A model's event idea checked: times in UTC (from the office's time zone), guests only
    well-formed addresses."""
    import re

    zone = ZoneInfo(tz)

    def at(v: Any) -> str | None:
        s = str(v or "").strip()[:16]
        try:
            t = datetime.strptime(s, "%Y-%m-%dT%H:%M").replace(tzinfo=zone)  # noqa: DTZ007
        except ValueError:
            return None
        return t.astimezone(UTC).isoformat().replace("+00:00", "Z")

    start = at(d.get("start"))
    end = at(d.get("end"))
    if start and not end:
        end = (graph.parse_time(start) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")  # type: ignore[operator]
    email = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")
    guests = [
        str(x).strip().lower() for x in d.get("attendees") or [] if email.match(str(x).strip())
    ]
    return {
        "subject": str(d.get("subject") or "")[:255],
        "start": start,
        "end": end,
        "attendees": guests[:50],
        "location": str(d.get("location") or "")[:255],
        "online": d.get("online") is True,
        "body": str(d.get("body") or "")[:4000],
    }
