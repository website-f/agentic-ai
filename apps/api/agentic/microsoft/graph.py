"""Microsoft Graph client (v1.0) for one mailbox. Graph ONLY, never EWS.

Get one with `await for_account(db, acct)` (a person's own mailbox, delegated token, paths
under /me) or `await for_mailbox(db, mailbox)` (a shared mailbox, app-only token, paths
under /users/{address}); `await for_box(db, box)` takes either. Every helper works on that
mailbox, so the features code never builds /me vs /users paths itself:

    g = await graph.for_box(db, box)
    msg = await g.get_message(item.graph_message_id)            # body + attachment list
    draft = await g.create_reply_draft(item.graph_message_id, "<p>Thanks, noted.</p>")
    await g.send_draft(draft["id"])                             # only after a person says yes

Behaviour:
- Message and event ids are immutable (Prefer: IdType="ImmutableId"), so an id stays valid
  when the message is moved to another folder.
- 429 / 503 / 504 and network errors are retried up to MAX_RETRIES times, waiting
  Retry-After (capped at MAX_WAIT seconds) or 1, 2, 4 s; then `Throttled` is raised.
- 401 once: the token is refreshed and the call retried; twice: `Unauthorized`.
- Other errors raise `GraphError` subclasses (errors.py) carrying Graph's error code.
- Only https://graph.microsoft.com URLs are ever called (nextLink / deltaLink included).
- Times: pass aware datetimes; they are sent as UTC ISO-8601. Calendar answers come in the
  `tz` asked for (Prefer: outlook.timezone), default UTC.
"""

import urllib.parse
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import MicrosoftAccount, SharedMailbox
from . import app, auth, http
from .errors import GraphError, MicrosoftError, NotConfigured, Throttled, Unauthorized, for_status

GRAPH = "https://graph.microsoft.com/v1.0"
MAX_RETRIES = 3
MAX_WAIT = 30.0
RETRY_STATUSES = frozenset({429, 503, 504})
IMMUTABLE = 'IdType="ImmutableId"'
MAX_ATTACHMENT = 25 * 1024 * 1024
# What a mail list row needs (no body): the sync and listings use it.
MESSAGE_META = (
    "id,conversationId,internetMessageId,receivedDateTime,from,sender,toRecipients,"
    "ccRecipients,subject,hasAttachments,isRead,isDraft,importance,bodyPreview,webLink"
)
TokenFn = Callable[[bool], Awaitable[str]]


def iso(dt: datetime) -> str:
    """Aware datetime -> Graph's UTC form (naive ones are taken as UTC)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str | None) -> datetime | None:
    """Graph timestamps ("2026-10-16T01:02:03Z", sometimes with 7 decimals) -> aware UTC."""
    if not value:
        return None
    v = value.strip().replace("Z", "+00:00")
    if "." in v:  # trim fractions Python cannot read (more than 6 digits)
        head, rest = v.split(".", 1)
        digits = "".join(ch for ch in rest if ch.isdigit())
        tz = rest[len(digits) :]
        v = f"{head}.{digits[:6]}{tz}"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def recipients(addresses: list[str] | str | None) -> list[dict[str, Any]]:
    """ "a@x.com, b@y.com" or a list -> Graph recipients."""
    if not addresses:
        return []
    items = addresses.split(",") if isinstance(addresses, str) else addresses
    return [{"emailAddress": {"address": a.strip()}} for a in items if a and a.strip()]


@dataclass
class MessagePage:
    """One page of a delta round. Follow `next_link` until `delta_link` is set; keep the
    delta link for the next round. Entries with "@removed" were deleted or moved away."""

    items: list[dict[str, Any]] = field(default_factory=list)
    next_link: str | None = None
    delta_link: str | None = None


class Graph:
    """Graph for one mailbox. `root` is "/me" or "/users/{address}"; `token(force)` gives
    an access token (force=True refreshes)."""

    def __init__(self, token: TokenFn, root: str = "/me", *, tz: str = "UTC") -> None:
        self._token = token
        self.root = root
        self.tz = tz

    # ------------------------------------------------------------ plumbing

    def _url(self, path: str) -> str:
        if path.startswith("https://"):
            if not path.startswith(GRAPH + "/"):
                raise GraphError(Msg("Refused a link that is not Microsoft Graph."), 0)
            return path
        return GRAPH + (path if path.startswith("/") else "/" + path)

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        prefer: list[str] | None = None,
        headers: dict[str, str] | None = None,
        raw: bool = False,
    ) -> Any:
        """One Graph call with retries. Returns parsed JSON ({} when empty), or the bytes
        when `raw`. `path` is relative to v1.0 ("/me/messages") or a full Graph link."""
        url = self._url(path)
        hdrs = {"Prefer": ", ".join([IMMUTABLE, *(prefer or [])]), **(headers or {})}
        refreshed = False
        attempt = 0
        while True:
            token = await self._token(refreshed)
            hdrs["Authorization"] = f"Bearer {token}"
            try:
                async with http.client() as c:
                    r = await c.request(method, url, params=params, json=json, headers=hdrs)
            except httpx.TransportError as e:
                if attempt < MAX_RETRIES:
                    attempt += 1
                    await http.sleep(min(MAX_WAIT, 2 ** (attempt - 1)))
                    continue
                raise GraphError(
                    Msg("Could not reach Microsoft Graph ({why}).", why=type(e).__name__), 0
                ) from e
            if r.status_code == 401 and not refreshed:
                refreshed = True
                continue
            if r.status_code in RETRY_STATUSES and attempt < MAX_RETRIES:
                attempt += 1
                await http.sleep(_retry_after(r, attempt))
                continue
            if r.status_code >= 400:
                raise _error(r)
            if raw:
                return r.content
            if not r.content:
                return {}
            try:
                return r.json()
            except ValueError:
                return {}

    async def _get(self, path: str, **params: Any) -> Any:
        return await self.request("GET", path, params={k: v for k, v in params.items() if v})

    def _tz(self, tz: str | None) -> list[str]:
        return [f'outlook.timezone="{tz or self.tz}"']

    # ------------------------------------------------------------ profile and probes

    async def me(self) -> dict[str, Any]:
        """The signed-in person (delegated only): id, displayName, mail, userPrincipalName."""
        return await self._get("/me", **{"$select": "id,displayName,mail,userPrincipalName"})

    async def inbox_probe(self) -> dict[str, Any]:
        """GET {root}/mailFolders/inbox?$select=id: proves the mailbox can be read."""
        return await self._get(f"{self.root}/mailFolders/inbox", **{"$select": "id"})

    # ------------------------------------------------------------ mail

    async def list_messages(
        self,
        *,
        delta_link: str | None = None,
        since: datetime | None = None,
        folder: str = "inbox",
        page_size: int = 50,
        select: str = MESSAGE_META,
    ) -> MessagePage:
        """One page of a delta round over a folder. Start a round with `delta_link=None`
        (optionally `since`: only mail received from then on); continue with the page's
        `next_link` passed as `delta_link`; the last page carries the new `delta_link`.
        A stale delta link raises `Gone` (start a new round)."""
        prefer = [f"odata.maxpagesize={max(1, min(page_size, 100))}"]
        if delta_link:
            body = await self.request("GET", delta_link, prefer=prefer)
        else:
            params: dict[str, Any] = {"$select": select}
            if since is not None:
                params["$filter"] = f"receivedDateTime ge {iso(since)}"
            body = await self.request(
                "GET",
                f"{self.root}/mailFolders/{urllib.parse.quote(folder)}/messages/delta",
                params=params,
                prefer=prefer,
            )
        return MessagePage(
            items=list(body.get("value") or []),
            next_link=body.get("@odata.nextLink"),
            delta_link=body.get("@odata.deltaLink"),
        )

    async def search_messages(self, query: str, top: int = 10) -> list[dict[str, Any]]:
        """Full-text search over the whole mailbox ($search, Graph's KQL), newest matches,
        metadata only."""
        body = await self._get(
            f"{self.root}/messages",
            **{"$search": f'"{query.replace(chr(34), " ")}"', "$top": max(1, min(top, 50)),
               "$select": MESSAGE_META},
        )  # fmt: skip
        return list(body.get("value") or [])

    async def get_message(
        self,
        message_id: str,
        *,
        body: bool = True,
        body_type: str = "text",
        headers: bool = False,
    ) -> dict[str, Any]:
        """One message. With `body`: the body (as "text" or "html") and the attachment list
        (metadata only: id, name, contentType, size, isInline). With `headers`: the
        internet message headers too (List-Unsubscribe, Precedence...)."""
        prefer = [f'outlook.body-content-type="{body_type}"'] if body else []
        params: dict[str, Any] = {
            "$select": MESSAGE_META
            + (",body,uniqueBody,replyTo" if body else "")
            + (",internetMessageHeaders" if headers else "")
        }
        if body:
            params["$expand"] = "attachments($select=id,name,contentType,size,isInline)"
        return await self.request(
            "GET", f"{self.root}/messages/{_q(message_id)}", params=params, prefer=prefer
        )

    async def sent_in_conversation(
        self, conversation_id: str, top: int = 10
    ) -> list[dict[str, Any]]:
        """Messages this mailbox sent in one conversation (Sent Items, newest first): id and
        sentDateTime. Used to tell whether a thread was answered."""
        safe = conversation_id.replace("'", "''")
        body = await self._get(
            f"{self.root}/mailFolders/sentitems/messages",
            **{"$filter": f"conversationId eq '{safe}'", "$top": max(1, min(top, 50)),
               "$select": "id,sentDateTime,conversationId"},
        )  # fmt: skip
        return list(body.get("value") or [])

    async def list_attachments(self, message_id: str) -> list[dict[str, Any]]:
        """Attachment metadata (id, name, contentType, size, isInline), no bytes."""
        body = await self._get(
            f"{self.root}/messages/{_q(message_id)}/attachments",
            **{"$select": "id,name,contentType,size,isInline"},
        )
        return list(body.get("value") or [])

    async def get_attachment_bytes(
        self, message_id: str, attachment_id: str, max_bytes: int = MAX_ATTACHMENT
    ) -> tuple[str, str, bytes]:
        """(name, content type, bytes) of a file attachment. Refuses ones over `max_bytes`
        (checked from the metadata first, so nothing big is downloaded)."""
        base = f"{self.root}/messages/{_q(message_id)}/attachments/{_q(attachment_id)}"
        meta = await self._get(base, **{"$select": "id,name,contentType,size"})
        if int(meta.get("size") or 0) > max_bytes:
            raise GraphError(
                Msg("That attachment is too big (over {mb} MB).", mb=max_bytes // (1024 * 1024)),
                413,
            )
        data = await self.request("GET", base + "/$value", raw=True)
        if len(data) > max_bytes:
            raise GraphError(
                Msg("That attachment is too big (over {mb} MB).", mb=max_bytes // (1024 * 1024)),
                413,
            )
        return str(meta.get("name") or "attachment"), str(meta.get("contentType") or ""), data

    async def create_reply_draft(
        self, message_id: str, body_html: str, *, reply_all: bool = False
    ) -> dict[str, Any]:
        """A reply draft in the mailbox's Drafts, with `body_html` above the quoted original
        (Graph's createReply "comment"). Nothing is sent. Returns the draft message."""
        action = "createReplyAll" if reply_all else "createReply"
        return await self.request(
            "POST", f"{self.root}/messages/{_q(message_id)}/{action}", json={"comment": body_html}
        )

    async def create_draft(
        self, to: list[str] | str, subject: str, body_html: str, *, cc: list[str] | str = ""
    ) -> dict[str, Any]:
        """A new draft (not a reply). Nothing is sent. Returns the draft message."""
        return await self.request(
            "POST",
            f"{self.root}/messages",
            json={
                "subject": subject,
                "body": {"contentType": "HTML", "content": body_html},
                "toRecipients": recipients(to),
                "ccRecipients": recipients(cc),
            },
        )

    async def update_draft(self, draft_id: str, **changes: Any) -> dict[str, Any]:
        """PATCH a draft. Friendly keys: subject, body_html, to, cc; anything else is sent
        as is (Graph message properties)."""
        body: dict[str, Any] = {}
        for k, v in changes.items():
            if k == "body_html":
                body["body"] = {"contentType": "HTML", "content": v}
            elif k == "to":
                body["toRecipients"] = recipients(v)
            elif k == "cc":
                body["ccRecipients"] = recipients(v)
            else:
                body[k] = v
        return await self.request("PATCH", f"{self.root}/messages/{_q(draft_id)}", json=body)

    async def send_draft(self, draft_id: str) -> None:
        """Send a draft (Graph answers 202). Call only after a person approved it."""
        await self.request("POST", f"{self.root}/messages/{_q(draft_id)}/send")

    async def delete_message(self, message_id: str) -> None:
        """Delete a message or draft (to Deleted Items). A missing one is not an error."""
        try:
            await self.request("DELETE", f"{self.root}/messages/{_q(message_id)}")
        except GraphError as e:
            if e.status != 404:
                raise

    async def mark_read(self, message_id: str, read: bool = True) -> None:
        await self.request("PATCH", f"{self.root}/messages/{_q(message_id)}", json={"isRead": read})

    # ------------------------------------------------------------ calendar

    async def calendar_view(
        self, start: datetime, end: datetime, *, top: int = 50, tz: str | None = None
    ) -> list[dict[str, Any]]:
        """Events (recurrences expanded) between start and end, in time order."""
        body = await self.request(
            "GET",
            f"{self.root}/calendarView",
            params={
                "startDateTime": iso(start),
                "endDateTime": iso(end),
                "$orderby": "start/dateTime",
                "$top": max(1, min(top, 250)),
                "$select": "id,subject,start,end,location,attendees,organizer,isAllDay,"
                "isCancelled,showAs,onlineMeeting,webLink,bodyPreview",
            },
            prefer=self._tz(tz),
        )
        return list(body.get("value") or [])

    async def get_event(self, event_id: str, *, tz: str | None = None) -> dict[str, Any]:
        """One event (times in `tz`)."""
        return await self.request(
            "GET",
            f"{self.root}/events/{_q(event_id)}",
            params={
                "$select": "id,subject,start,end,location,attendees,organizer,isAllDay,"
                "isCancelled,isOrganizer,onlineMeeting,webLink"
            },
            prefer=self._tz(tz),
        )

    async def get_schedule(
        self,
        emails: list[str],
        start: datetime,
        end: datetime,
        *,
        interval_minutes: int = 30,
        tz: str | None = None,
    ) -> list[dict[str, Any]]:
        """Free/busy of people or rooms (calendar/getSchedule): one entry per address with
        `availabilityView` ("0" free, "1" tentative, "2" busy, "3" away, "4" elsewhere)
        and `scheduleItems`."""
        zone = tz or self.tz
        body = await self.request(
            "POST",
            f"{self.root}/calendar/getSchedule",
            json={
                "schedules": emails,
                "startTime": {"dateTime": iso(start).rstrip("Z"), "timeZone": "UTC"},
                "endTime": {"dateTime": iso(end).rstrip("Z"), "timeZone": "UTC"},
                "availabilityViewInterval": max(5, min(interval_minutes, 1440)),
            },
            prefer=self._tz(zone),
        )
        return list(body.get("value") or [])

    async def find_meeting_times(
        self,
        attendees: list[str],
        duration_minutes: int,
        start: datetime,
        end: datetime,
        *,
        max_candidates: int = 5,
        tz: str | None = None,
    ) -> list[dict[str, Any]]:
        """Times that suit everyone (findMeetingTimes): `meetingTimeSuggestions`, each with
        `meetingTimeSlot` start/end and a confidence."""
        body = await self.request(
            "POST",
            f"{self.root}/findMeetingTimes",
            json={
                "attendees": [
                    {"type": "required", "emailAddress": {"address": a}} for a in attendees
                ],
                "timeConstraint": {
                    "activityDomain": "work",
                    "timeSlots": [
                        {
                            "start": {"dateTime": iso(start).rstrip("Z"), "timeZone": "UTC"},
                            "end": {"dateTime": iso(end).rstrip("Z"), "timeZone": "UTC"},
                        }
                    ],
                },
                "meetingDuration": f"PT{max(5, int(duration_minutes))}M",
                "maxCandidates": max(1, min(max_candidates, 20)),
                "returnSuggestionReasons": True,
            },
            prefer=self._tz(tz),
        )
        return list(body.get("meetingTimeSuggestions") or [])

    async def create_event(
        self,
        subject: str,
        start: datetime,
        end: datetime,
        *,
        attendees: list[str] | None = None,
        body_html: str = "",
        location: str = "",
        online_meeting: bool = False,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add an event (invites go to attendees when it is created). `extra` passes any
        other Graph event properties. Returns the event (id, webLink...)."""
        ev: dict[str, Any] = {
            "subject": subject,
            "start": {"dateTime": iso(start).rstrip("Z"), "timeZone": "UTC"},
            "end": {"dateTime": iso(end).rstrip("Z"), "timeZone": "UTC"},
            "attendees": [
                {"type": "required", "emailAddress": {"address": a}} for a in attendees or []
            ],
        }
        if body_html:
            ev["body"] = {"contentType": "HTML", "content": body_html}
        if location:
            ev["location"] = {"displayName": location}
        if online_meeting:
            ev["isOnlineMeeting"] = True
            ev["onlineMeetingProvider"] = "teamsForBusiness"
        ev.update(extra or {})
        return await self.request("POST", f"{self.root}/events", json=ev)

    async def update_event(self, event_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        """PATCH an event with Graph event properties. Datetime values for "start"/"end"
        may be given as aware datetimes."""
        body = dict(changes)
        for k in ("start", "end"):
            if isinstance(body.get(k), datetime):
                body[k] = {"dateTime": iso(body[k]).rstrip("Z"), "timeZone": "UTC"}
        return await self.request("PATCH", f"{self.root}/events/{_q(event_id)}", json=body)

    async def cancel_event(self, event_id: str, comment: str = "") -> None:
        """Cancel a meeting this mailbox organizes (attendees get the cancellation). When
        it is not the organizer, Graph refuses cancel; the event is then deleted from this
        calendar instead."""
        try:
            await self.request(
                "POST", f"{self.root}/events/{_q(event_id)}/cancel", json={"comment": comment}
            )
        except GraphError as e:
            if e.status != 400:
                raise
            await self.request("DELETE", f"{self.root}/events/{_q(event_id)}")

    # ------------------------------------------------------------ change notifications

    # ------------------------------------------------------------ Teams (P52, delegated only)

    async def list_chats(self, top: int = 20) -> list[dict[str, Any]]:
        """The person's chats (one-to-one, group, meeting), most recent first, with who is in
        them and the last message's preview."""
        body = await self._get(
            "/me/chats",
            **{
                "$expand": "members,lastMessagePreview",
                "$orderby": "lastMessagePreview/createdDateTime desc",
                "$top": max(1, min(top, 50)),
            },
        )
        return list(body.get("value") or [])

    async def chat_messages(self, chat_id: str, top: int = 20) -> list[dict[str, Any]]:
        """A chat's latest messages, newest first."""
        body = await self._get(
            f"/me/chats/{_q(chat_id)}/messages",
            **{"$top": max(1, min(top, 50)), "$orderby": "createdDateTime desc"},
        )
        return list(body.get("value") or [])

    async def send_chat_message(self, chat_id: str, text: str) -> dict[str, Any]:
        return await self.request(
            "POST",
            f"/chats/{_q(chat_id)}/messages",
            json={"body": {"contentType": "text", "content": text}},
        )

    async def joined_teams(self) -> list[dict[str, Any]]:
        body = await self._get("/me/joinedTeams", **{"$select": "id,displayName,description"})
        return list(body.get("value") or [])

    async def create_subscription(
        self,
        resource: str,
        notify_url: str,
        client_state: str,
        expires: datetime,
        *,
        change_type: str = "created",
    ) -> dict[str, Any]:
        """A webhook subscription. Graph validates `notify_url` (it must answer the
        validationToken handshake) before this returns. Lifecycle notifications go to the
        same URL."""
        return await self.request(
            "POST",
            "/subscriptions",
            json={
                "changeType": change_type,
                "notificationUrl": notify_url,
                "lifecycleNotificationUrl": notify_url,
                "resource": resource,
                "expirationDateTime": iso(expires),
                "clientState": client_state,
                "latestSupportedTlsVersion": "v1_2",
            },
        )

    async def renew_subscription(self, subscription_id: str, expires: datetime) -> dict[str, Any]:
        """Extend a subscription (also reauthorizes it, per Graph's lifecycle guidance)."""
        return await self.request(
            "PATCH",
            f"/subscriptions/{_q(subscription_id)}",
            json={"expirationDateTime": iso(expires)},
        )

    async def delete_subscription(self, subscription_id: str) -> None:
        try:
            await self.request("DELETE", f"/subscriptions/{_q(subscription_id)}")
        except GraphError as e:
            if e.status != 404:
                raise


def _q(graph_id: str) -> str:
    return urllib.parse.quote(graph_id, safe="")


def _retry_after(r: httpx.Response, attempt: int) -> float:
    raw = r.headers.get("retry-after", "")
    try:
        wait = float(raw)
    except ValueError:
        wait = float(2 ** (attempt - 1))
    return max(0.0, min(MAX_WAIT, wait))


def _error(r: httpx.Response) -> GraphError:
    code, message = "", ""
    try:
        err = (r.json() or {}).get("error") or {}
        if isinstance(err, dict):
            code, message = str(err.get("code") or ""), str(err.get("message") or "")
    except ValueError:
        message = r.text[:200]
    cls = for_status(r.status_code)
    if cls is Throttled:
        text = Msg("Microsoft is busy (too many requests). Try again in a minute.")
    elif cls is Unauthorized:
        text = Msg("Microsoft did not accept the sign-in for this mailbox.")
    else:
        text = Msg(
            "Microsoft Graph answered {status}: {why}",
            status=r.status_code,
            why=(f"{code}: {message}" if code else message)[:200] or "-",
        )
    return cls(text, r.status_code, code)


# ---------------------------------------------------------------- per mailbox


async def for_account(db: AsyncSession, acct: MicrosoftAccount) -> Graph:
    """Graph for a person's own mailbox (delegated token, /me)."""

    async def token(force: bool = False) -> str:
        return await auth.access_token(db, acct, force=force)

    return Graph(token, "/me")


async def for_mailbox(db: AsyncSession, mailbox: SharedMailbox) -> Graph:
    """Graph for a shared mailbox (app-only token in its tenant, /users/{address})."""
    tenant = mailbox.tenant_id
    if not tenant:
        cfg = await app.load(db, mailbox.workspace_id)
        tenant = cfg.app_tenant() or ""
    if not tenant:
        raise NotConfigured(
            Msg(
                "Grant admin consent first (Channels > Microsoft 365) so the app knows your tenant."
            )
        )
    workspace_id = mailbox.workspace_id

    async def token(force: bool = False) -> str:
        return await auth.app_token(db, workspace_id, tenant, force=force)

    return Graph(token, f"/users/{_q(mailbox.address)}")


async def for_box(db: AsyncSession, box: MicrosoftAccount | SharedMailbox) -> Graph:
    if isinstance(box, MicrosoftAccount):
        return await for_account(db, box)
    return await for_mailbox(db, box)


__all__ = [
    "GRAPH",
    "Graph",
    "GraphError",
    "MessagePage",
    "MicrosoftError",
    "for_account",
    "for_box",
    "for_mailbox",
    "iso",
    "parse_time",
    "recipients",
]
