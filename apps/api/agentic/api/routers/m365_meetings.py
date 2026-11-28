"""P109b: the Microsoft 365 workspace's tile on My workspace, the people picker, and Teams
meetings made with AI (recorded in Prima's Meetings too).

Everything is the signed-in person's OWN Microsoft 365 connection (m365._mine) and their own
meetings (TeamsMeeting rows of that person only); Prima is asked as that person (prima/client).

GET  /api/m365/summary            the tile: unread mail, the next meeting, unread chats, approvals
                                  waiting (when allowed), or "connect Microsoft"
GET  /api/m365/people?q=          people to invite: office members they may see, their Outlook
POST /api/m365/meetings/draft     the AI fills the form from their words (nothing is sent)
POST /api/m365/meetings           create the Teams meeting (Outlook sends the invitations) and
                                  record it in Prima
GET  /api/m365/meetings/link      a meeting made here: its join link and its Prima record
POST /api/m365/meetings/prima     "Add to Prima" again
POST /api/m365/meetings/change    change it (attendees get the update; Prima's record too)
POST /api/m365/meetings/cancel    cancel it (attendees are told; Prima's record too)
"""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...microsoft import access, app, assist, auth, hub, meetings, org_approvals, swr
from ...microsoft.errors import MicrosoftError
from ...microsoft.graph import parse_time
from ...microsoft.meeting_models import PRIMA_KINDS, TeamsMeeting
from ...models import Workspace
from ...services import audit
from ..deps import Principal, api_error, client_ip, ensure_allowance, require
from .m365 import CHATS_KEEP, _event, _fail, _mine, chat_rows, chats_key, summary_key

router = APIRouter(prefix="/api/m365", tags=["m365"])
log = logging.getLogger("agentic.api.m365_meetings")

# P148a: the tile's numbers are fresh a minute, then still shown at once (and refreshed behind)
# for SUMMARY_KEEP. With none kept yet, the answer waits at most COLD_WAIT for Microsoft: the
# numbers not in by then are null with `refreshing` (the page asks again in a moment).
SUMMARY_FOR = 60
SUMMARY_KEEP = 6 * 3600
COLD_WAIT = 1.2
NUMBERS = ("unread_mail", "next_meeting", "unread_chats", "approvals_pending")
DEFAULT_TZ = "Asia/Kuala_Lumpur"
Kind = Literal["board", "management", "operations", "department", "client", "toolbox", "other"]
_progress: dict[str, dict[str, Any]] = {}  # summary key -> the numbers in so far


async def _forget_summary(principal: Principal, acct: Any) -> None:
    """A meeting made, changed or cancelled here: the calendar is read again and the tile's
    numbers refreshed behind."""
    await swr.bump(account_id=acct.id, areas=("cal",))
    await swr.touch(await summary_key(principal.workspace_id, principal.user.id, acct.id))


async def _tz(db: AsyncSession, workspace_id: str) -> str:
    ws = await db.get(Workspace, workspace_id)
    return (ws.timezone if ws is not None and ws.timezone else "") or DEFAULT_TZ


# ---------------------------------------------------------------- the tile


@router.get("/summary")
async def summary(
    fresh: bool = Query(default=False),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The Microsoft 365 tile of the person's own desk. Not set up or not connected: says so
    (the tile offers Connect). Each number is null when Microsoft did not answer it."""
    from ...prima import client as prima

    cfg = await app.load(db, principal.workspace_id)
    out: dict[str, Any] = {
        "configured": cfg.configured,
        "connected": False,
        "status": "none",
        "address": None,
        "unread_mail": None,
        "unread_chats": None,
        "next_meeting": None,
        "approvals_pending": None,
        "prima": prima.enabled(principal.workspace_id),
    }
    if not cfg.configured:
        return out
    acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
    if acct is None:
        return out
    out["status"], out["address"] = acct.status, acct.email
    if acct.status not in access.USABLE_ACCOUNT:
        return out
    out["connected"] = True
    ws, uid = principal.workspace_id, principal.user.id
    key = await summary_key(ws, uid, acct.id)
    build = _numbers(ws, uid, acct.id, key, await chats_key(ws, uid, acct.id))
    if not fresh:
        hit = await swr.peek(key, SUMMARY_FOR)
        if hit is not None and (not hit.stale or swr.BACKGROUND):
            if hit.stale:
                await swr.behind(key, build, SUMMARY_KEEP)
            return {**out, **hit.value, "refreshing": hit.stale}
    await swr.release(db)
    task = swr.start(key, build, SUMMARY_KEEP)
    try:
        numbers = await asyncio.wait_for(asyncio.shield(task), COLD_WAIT)
    except TimeoutError:  # what is in so far; the rest is kept when it arrives
        part = _progress.get(key) or {}
        return {**out, **{n: part.get(n) for n in NUMBERS}, "refreshing": True}
    except Exception as e:  # noqa: BLE001 - Microsoft did not answer: no numbers this time
        log.info("m365 summary not read: %s", type(e).__name__)
        return {**out, "refreshing": False}
    return {**out, **numbers, "refreshing": False}


def _numbers(ws: str, uid: str, account_id: str, key: str, chats: str) -> swr.Build:
    """The tile's four numbers, asked of Microsoft at once on a session of their own. The chat
    list read for them is kept for the Teams tab too; the approvals come from the list the
    Approvals tab keeps (org_approvals)."""

    async def build() -> dict[str, Any]:
        part = _progress.setdefault(key, {})
        try:
            async with swr.account_graph(account_id, ws, uid) as (db, acct, g):
                # P123: the access token first, once. With none kept (it lasts an hour) the four
                # calls below each refreshed it at once: four sign-ins to Microsoft, each storing
                # its own rotated refresh token. A refusal shows as null numbers, as before.
                with contextlib.suppress(Exception):
                    await auth.access_token(db, acct)
                now = datetime.now(UTC)

                async def unread_mail() -> int:
                    body = await g.request(
                        "GET", "/me/mailFolders/inbox", params={"$select": "unreadItemCount"}
                    )
                    return int(body.get("unreadItemCount") or 0)

                async def next_meeting() -> dict[str, Any] | None:
                    rows = await g.calendar_view(now, now + timedelta(days=7), top=25, tz="UTC")
                    for e in rows:
                        ev = _event(e)
                        end = parse_time(ev.get("end"))
                        if ev["cancelled"] or ev["all_day"] or end is None or end <= now:
                            continue
                        return ev
                    return None

                async def unread_chats() -> int:
                    rows = await chat_rows(acct, g)
                    await swr.put(chats, rows, CHATS_KEEP)  # the Teams tab opens at once
                    return sum(1 for c in rows if c.get("unread"))

                async def approvals() -> int | None:
                    if not auth.has_scope(acct.scopes, app.APPROVALS_SCOPE):
                        return None
                    got, failed = await org_approvals.account_items(acct.id)
                    if failed:
                        return None
                    items = [hub.approval_row(a) for a in got]
                    return sum(1 for a in items if a["i_approve"] and a["state"] == "pending")

                async def one(name: str, fn: Any) -> Any:
                    try:
                        v = await fn()
                    except Exception as e:  # noqa: BLE001 - that number is null this time
                        if not isinstance(e, MicrosoftError):
                            log.warning("m365 summary %s failed: %s", name, type(e).__name__)
                        v = None
                    part[name] = v
                    return v

                fns = (unread_mail, next_meeting, unread_chats, approvals)
                got = await asyncio.gather(*(one(n, f) for n, f in zip(NUMBERS, fns, strict=True)))
                return dict(zip(NUMBERS, got, strict=True))
        finally:
            _progress.pop(key, None)

    return build


# ---------------------------------------------------------------- people


@router.get("/people")
async def people_search(
    q: str = Query(min_length=2, max_length=80),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, str]]:
    """People to invite whose name or address matches: the office members this person may see
    (the rule for giving a task), then people in their own Outlook."""
    acct, g = await _mine(db, principal)
    office = await meetings.office_people(db, principal, q, limit=10)
    outlook = await meetings.outlook_people(g, q, acct.scopes, limit=10)
    me = (acct.email or "").lower()
    return [p for p in meetings.dedupe([*office, *outlook]) if p["email"] != me][:15]


# ---------------------------------------------------------------- the AI fills the form


class DraftIn(BaseModel):
    instructions: str = Field(min_length=3, max_length=4000)
    message_id: str = Field(default="", max_length=400)
    chat_id: str = Field(default="", max_length=400)


async def _context(g: Any, body: DraftIn, me_id: str) -> tuple[str, str, list[dict[str, str]]]:
    """The email or chat the meeting is about: its text (data for the model) and its people."""
    if body.message_id.strip():
        m = await g.get_message(body.message_id.strip(), body=True, body_type="text")
        return "email", assist.mail_text(m, 6000), meetings._people_of_mail(m)
    if body.chat_id.strip():
        msgs, _ = await g.chat_page(body.chat_id.strip(), 30)
        text = assist.chat_text([hub.chat_message(m, me_id) for m in reversed(msgs)], 6000)
        info = await g.chat(body.chat_id.strip())
        people = [
            {
                "name": str(p.get("displayName") or p.get("email")),
                "email": str(p.get("email") or "").lower(),
                "source": "teams",
            }
            for p in info.get("members") or []
            if meetings.is_email(str(p.get("email") or ""))
            and (not me_id or p.get("userId") != me_id)
        ]
        return "Teams chat", text, people
    return "", "", []


@router.post("/meetings/draft")
async def meeting_draft(
    body: DraftIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The AI turns the person's words (and the email or chat it is about) into the meeting
    form: title, people (matched to addresses, or offered to pick), when, how long, agenda,
    kind. Nothing is created or sent."""
    from ...engine import gateway

    acct, g = await _mine(db, principal)
    await ensure_allowance(db, principal)
    tz = await _tz(db, principal.workspace_id)
    now = datetime.now(UTC)
    try:
        kind, context, ctx_people = await _context(g, body, acct.ms_user_id or "")
        prompt = meetings.draft_prompt(
            body.instructions, now=now, tz=tz, context=context, context_kind=kind
        )
        raw = await assist.ask(
            db, principal.workspace_id, prompt, task="m365.meeting_draft", temperature=0.1
        )
        d = meetings.parse_draft(assist.parse_json(raw), tz, now)
        people = await meetings.resolve(
            db,
            principal,
            g,
            d["attendees"],
            context_people=ctx_people,
            scopes=acct.scopes,
            me=(acct.email or "").lower(),
        )
    except MicrosoftError as e:
        raise _fail(e) from e
    except gateway.GatewayUnavailable as e:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "ai_unavailable",
            "No AI model could answer right now. Try again in a minute.",
        ) from e
    await audit.record(
        db, principal.workspace_id, principal.actor, "m365.ai_asked", target="meeting_draft"
    )
    await db.commit()
    start: datetime = d["start"]
    return {
        "title": d["title"],
        "start": start.isoformat().replace("+00:00", "Z"),
        "end": (start + timedelta(minutes=d["minutes"])).isoformat().replace("+00:00", "Z"),
        "minutes": d["minutes"],
        "attendees": people,
        "agenda": d["agenda"],
        "kind": d["kind"],
        "time_zone": tz,
    }


# ---------------------------------------------------------------- create and send


class PersonIn(BaseModel):
    name: str = Field(default="", max_length=120)
    email: EmailStr


class MeetingIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    start: datetime
    end: datetime
    attendees: list[PersonIn] = Field(default_factory=list, max_length=100)
    agenda: str = Field(default="", max_length=4000)
    location: str = Field(default="", max_length=255)
    kind: Kind = "management"
    prima: bool = True  # also record it in Prima's Meetings


def _aware(t: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _people(items: list[PersonIn]) -> list[dict[str, str]]:
    seen: set[str] = set()
    out = []
    for p in items:
        e = str(p.email).lower()
        if e not in seen:
            seen.add(e)
            out.append({"name": " ".join(p.name.split())[:120], "email": e})
    return out


@router.post("/meetings", status_code=status.HTTP_201_CREATED)
async def meeting_create(
    body: MeetingIn,
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The person pressed "Create and send invitations": a Teams meeting in their own Outlook
    calendar (Outlook sends each person the invitation with the join link), then the same
    meeting in Prima's Meetings as them when asked and allowed."""
    start, end = _aware(body.start), _aware(body.end)
    if end <= start:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_range", "The end must be after the start."
        )
    if end - start > timedelta(hours=12):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_range", "A meeting can be up to 12 hours long."
        )
    acct, g = await _mine(db, principal)
    people = [p for p in _people(body.attendees) if p["email"] != (acct.email or "").lower()]
    try:
        ev = await g.create_event(
            body.title.strip(),
            start,
            end,
            body_html=meetings.agenda_html(body.agenda),
            location=body.location.strip(),
            online_meeting=True,
            extra={"attendees": meetings.graph_attendees(people), "allowNewTimeProposals": True},
        )
        event_id = str(ev.get("id") or "")
        join = meetings.join_url_of(ev)
        if event_id and not join:  # Microsoft adds the Teams link a moment after
            join = meetings.join_url_of(await g.event_detail(event_id, tz="UTC"))
    except MicrosoftError as e:
        raise _fail(e) from e
    if not event_id:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, "microsoft_error", "Microsoft did not make the meeting."
        )
    row = TeamsMeeting(
        workspace_id=principal.workspace_id,
        user_id=principal.user.id,
        event_id=event_id[:512],
        title=body.title.strip()[:255],
        start_at=start,
        end_at=end,
        attendees=people,
        agenda=body.agenda.strip(),
        join_url=join,
        web_link=ev.get("webLink"),
        kind=body.kind,
        prima_status="none",
    )
    db.add(row)
    await db.flush()
    if body.prima:
        await meetings.prima_add(db, principal, row, client_ip(request))
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "m365.meeting_created",
        target=event_id[:200],
        after={"guests": len(people), "prima": row.prima_status},
    )
    await db.commit()
    await _forget_summary(principal, acct)
    return meetings.row_out(row)


# ---------------------------------------------------------------- a meeting made here


async def _row(db: AsyncSession, principal: Principal, event_id: str) -> TeamsMeeting | None:
    return await db.scalar(
        select(TeamsMeeting).where(
            TeamsMeeting.workspace_id == principal.workspace_id,
            TeamsMeeting.user_id == principal.user.id,
            TeamsMeeting.event_id == event_id,
        )
    )


@router.get("/meetings/link")
async def meeting_link(
    event_id: str = Query(min_length=1, max_length=512),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Whether this event of the person's calendar was made here, with its Prima record."""
    row = await _row(db, principal, event_id)
    return {"linked": False} if row is None else {"linked": True, **meetings.row_out(row)}


class EventRefIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=512)
    kind: Kind | None = None


async def _own_row(db: AsyncSession, principal: Principal, event_id: str) -> TeamsMeeting:
    row = await _row(db, principal, event_id)
    if row is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "not_found",
            "This meeting was not made from the office.",
        )
    return row


@router.post("/meetings/prima")
async def meeting_prima(
    body: EventRefIn,
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """ "Add to Prima" again (after Prima refused or did not answer, or it was not asked)."""
    row = await _own_row(db, principal, body.event_id)
    if row.cancelled_at is not None:
        raise api_error(status.HTTP_409_CONFLICT, "cancelled", "This meeting was cancelled.")
    if row.prima_status != "added":
        if body.kind and body.kind in PRIMA_KINDS:
            row.kind = body.kind
        await meetings.prima_add(db, principal, row, client_ip(request))
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "m365.meeting_prima",
            target=row.event_id[:200],
            after={"prima": row.prima_status},
        )
        await db.commit()
    return meetings.row_out(row)


class ChangeIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=512)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    start: datetime | None = None
    end: datetime | None = None
    attendees: list[PersonIn] | None = Field(default=None, max_length=100)
    agenda: str | None = Field(default=None, max_length=4000)
    reason: str = Field(default="", max_length=300)


@router.post("/meetings/change")
async def meeting_change(
    body: ChangeIn,
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Change a meeting the person organises: Outlook sends the update to the people invited;
    the Prima record made with it changes too (Prima's own change route, with the reason)."""
    from ...i18n import tr

    row = await _own_row(db, principal, body.event_id)
    if row.cancelled_at is not None:
        raise api_error(status.HTTP_409_CONFLICT, "cancelled", "This meeting was cancelled.")
    start = _aware(body.start) if body.start else row.start_at
    end = _aware(body.end) if body.end else row.end_at
    if end <= start:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_range", "The end must be after the start."
        )
    acct, g = await _mine(db, principal)
    graph_changes: dict[str, Any] = {}
    prima_fields: dict[str, Any] = {}
    if body.title is not None and body.title.strip() != row.title:
        graph_changes["subject"] = row.title = body.title.strip()[:255]
        prima_fields["title"] = row.title[: meetings.PRIMA_TITLE]
    if start != row.start_at or end != row.end_at:
        graph_changes["start"], graph_changes["end"] = start, end
        row.start_at, row.end_at = start, end
        prima_fields["start"], prima_fields["end"] = meetings._iso(start), meetings._iso(end)
    if body.agenda is not None and body.agenda.strip() != row.agenda:
        row.agenda = body.agenda.strip()
        graph_changes["body"] = {"contentType": "HTML", "content": meetings.agenda_html(row.agenda)}
        prima_fields["agenda"] = meetings.prima_agenda(row.agenda, row.title, row.join_url)
    if body.attendees is not None:
        me = (acct.email or "").lower()
        people = [p for p in _people(body.attendees) if p["email"] != me]
        if people != row.attendees:
            row.attendees = people
            graph_changes["attendees"] = meetings.graph_attendees(people)
            prima_fields["attendees"] = [
                (p["name"] or p["email"])[: meetings.PRIMA_NAME] for p in people
            ][: meetings.PRIMA_PEOPLE]
    if not graph_changes:
        raise api_error(status.HTTP_400_BAD_REQUEST, "no_change", "Nothing has changed.")
    try:
        await g.update_event(row.event_id, graph_changes)
    except MicrosoftError as e:
        raise _fail(e) from e
    reason = body.reason.strip()
    if len(reason) < 5:
        reason = tr("Changed in Microsoft 365 from the office")
    warn = await meetings.prima_change(db, principal, row, prima_fields, reason, client_ip(request))
    if warn:
        row.prima_error = warn
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "m365.meeting_changed",
        target=row.event_id[:200],
        after={"what": sorted(graph_changes), "prima": "not_changed" if warn else row.prima_status},
    )
    await db.commit()
    await _forget_summary(principal, acct)
    return {**meetings.row_out(row), "prima_warning": warn}


class CancelIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=512)
    reason: str = Field(default="", max_length=300)


@router.post("/meetings/cancel")
async def meeting_cancel(
    body: CancelIn,
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Cancel a meeting the person made here: the people invited get Outlook's cancellation;
    the Prima record is cancelled with the reason (Prima keeps it, marked cancelled)."""
    from ...i18n import tr

    row = await _own_row(db, principal, body.event_id)
    acct, g = await _mine(db, principal)
    reason = body.reason.strip()
    if len(reason) < 5:
        reason = tr("Cancelled in Microsoft 365 from the office")
    if row.cancelled_at is None:
        try:
            await g.cancel_event(row.event_id, body.reason.strip())
        except MicrosoftError as e:
            if getattr(e, "status", 0) != 404:  # already gone from the calendar
                raise _fail(e) from e
        row.cancelled_at = datetime.now(UTC)
    warn = await meetings.prima_cancel(db, principal, row, reason, client_ip(request))
    if warn:
        row.prima_error = warn
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "m365.meeting_cancelled",
        target=row.event_id[:200],
        after={"prima": "not_cancelled" if warn else row.prima_status},
    )
    await db.commit()
    await _forget_summary(principal, acct)
    return {**meetings.row_out(row), "prima_warning": warn}
