"""Google Calendar for personal assistants: the person's primary calendar.

Same Google sign-in as Gmail (gmail.py), with the calendar.events scope added. Assistants
read the agenda and find free time on their own. They never write to the calendar by
themselves: a new, changed or cancelled event is a *proposal* the person confirms on the My
assistants page (next to the email drafts), and only then does the Calendar API run, so
invitations go out only after the person said yes.

Proposals live in Postgres (calendar_proposals), so a restart or cache eviction never
loses one; they lapse after PENDING_DAYS and are pruned after KEEP_DAYS. Only the short
double-tap lock is in Valkey.
Times are shown in the workspace's time zone.
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.ids import new_id
from ..core.valkey import valkey
from ..models import CalendarProposal, GoogleAccount
from . import gmail

API = "https://www.googleapis.com/calendar/v3/calendars/primary"
SCOPES = (gmail.CALENDAR_SCOPE, "https://www.googleapis.com/auth/calendar")
PENDING_DAYS = 7
KEEP_DAYS = 30
transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake Google


class CalendarError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(UTC)


def has_calendar(acct: GoogleAccount | None) -> bool:
    """Whether this Google connection was granted calendar access (older ones were not)."""
    return acct is not None and any(s in (acct.scopes or "").split() for s in SCOPES)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=25, transport=transport or gmail.transport)


async def _api(
    db: AsyncSession, acct: GoogleAccount, method: str, path: str, **kw: Any
) -> dict[str, Any]:
    try:
        token = await gmail.access_token(db, acct)
    except gmail.GmailError as e:
        raise CalendarError(str(e).replace("Gmail", "Google"), e.status) from e
    async with _client() as c:
        r = await c.request(method, API + path, headers={"Authorization": f"Bearer {token}"}, **kw)
    if r.status_code == 403 and "insufficient" in r.text.lower():
        raise CalendarError(
            "Google did not allow calendar access. Reconnect Google and tick the calendar box.",
            403,
        )
    if r.status_code >= 400:
        raise CalendarError(
            f"Google Calendar answered {r.status_code}: {r.text[:200]}", r.status_code
        )
    return r.json() if r.content else {}


# ---------------------------------------------------------------- reading


@dataclass
class Event:
    id: str
    title: str
    start: datetime
    end: datetime
    all_day: bool
    location: str = ""
    attendees: list[str] = field(default_factory=list)
    organizer_self: bool = True
    my_response: str = ""  # accepted | declined | tentative | needsAction | "" (organizer)
    busy: bool = True
    meet: str = ""
    link: str = ""
    description: str = ""


def _when(part: dict[str, Any], zone: ZoneInfo) -> tuple[datetime, bool]:
    if part.get("dateTime"):
        return datetime.fromisoformat(part["dateTime"].replace("Z", "+00:00")).astimezone(
            zone
        ), False
    d = date.fromisoformat(part.get("date", "1970-01-01"))
    return datetime.combine(d, time(0), zone), True


def parse_event(item: dict[str, Any], zone: ZoneInfo) -> Event | None:
    if item.get("status") == "cancelled" or "start" not in item:
        return None
    start, all_day = _when(item["start"], zone)
    end, _ = _when(item.get("end") or item["start"], zone)
    me = next((a for a in item.get("attendees") or [] if a.get("self")), None)
    response = (me or {}).get("responseStatus", "")
    meet = next(
        (
            e.get("uri", "")
            for e in (item.get("conferenceData") or {}).get("entryPoints") or []
            if e.get("entryPointType") == "video"
        ),
        item.get("hangoutLink", ""),
    )
    return Event(
        id=item.get("id", ""),
        title=item.get("summary") or "(no title)",
        start=start,
        end=end,
        all_day=all_day,
        location=item.get("location", ""),
        attendees=[a.get("email", "") for a in item.get("attendees") or [] if not a.get("self")],
        organizer_self=bool((item.get("organizer") or {}).get("self", True)),
        my_response=response,
        busy=item.get("transparency") != "transparent" and response != "declined",
        meet=meet,
        link=item.get("htmlLink", ""),
        description=item.get("description", ""),
    )


async def events(
    db: AsyncSession, acct: GoogleAccount, start: datetime, end: datetime, tz: str
) -> list[Event]:
    zone = ZoneInfo(tz)
    out: list[Event] = []
    page: str | None = None
    for _ in range(4):  # up to 1000 events: plenty for a month
        params: dict[str, Any] = {
            "timeMin": start.astimezone(UTC).isoformat(),
            "timeMax": end.astimezone(UTC).isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 250,
            "timeZone": tz,
        }
        if page:
            params["pageToken"] = page
        data = await _api(db, acct, "GET", "/events", params=params)
        out += [e for e in (parse_event(i, zone) for i in data.get("items") or []) if e]
        page = data.get("nextPageToken")
        if not page:
            break
    return sorted(out, key=lambda e: (e.start, e.end))


async def get_event(db: AsyncSession, acct: GoogleAccount, event_id: str, tz: str) -> Event:
    item = await _api(db, acct, "GET", f"/events/{event_id}")
    ev = parse_event(item, ZoneInfo(tz))
    if ev is None:
        raise CalendarError("That event was cancelled already.", 410)
    return ev


def free_slots(
    busy: list[tuple[datetime, datetime]],
    start: datetime,
    end: datetime,
    minutes: int,
    days: list[int],
    day_start: time,
    day_end: time,
    zone: ZoneInfo,
    now: datetime,
) -> list[tuple[datetime, datetime]]:
    """Free stretches of at least `minutes` inside working hours (days: Mon=0), between
    start and end and not in the past. Times are in `zone`."""
    merged: list[list[datetime]] = []
    for b0, b1 in sorted((a.astimezone(zone), b.astimezone(zone)) for a, b in busy):
        if merged and b0 <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b1)
        else:
            merged.append([b0, b1])
    need = timedelta(minutes=minutes)
    out: list[tuple[datetime, datetime]] = []
    day = start.astimezone(zone).date()
    last = (end.astimezone(zone) - timedelta(microseconds=1)).date()
    while day <= last:
        if day.weekday() in days:
            lo = max(datetime.combine(day, day_start, zone), start, now).astimezone(zone)
            hi = min(datetime.combine(day, day_end, zone), end).astimezone(zone)
            # Not "free from 10:07": start on the next quarter hour.
            quarter = lo.replace(minute=lo.minute // 15 * 15, second=0, microsecond=0)
            cursor = quarter if quarter >= lo else quarter + timedelta(minutes=15)
            for b0, b1 in merged:
                if b1 <= cursor:
                    continue
                if b0 >= hi:
                    break
                if b0 - cursor >= need:
                    out.append((cursor, b0))
                cursor = max(cursor, b1)
            if hi - cursor >= need:
                out.append((cursor, hi))
        day += timedelta(days=1)
    return out


# ---------------------------------------------------------------- writing (after a yes)


def event_body(
    title: str,
    start: datetime,
    end: datetime,
    tz: str,
    attendees: list[str],
    description: str,
    location: str,
    meet: bool,
    request_id: str,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start.isoformat(), "timeZone": tz},
        "end": {"dateTime": end.isoformat(), "timeZone": tz},
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]
    if meet:
        body["conferenceData"] = {
            "createRequest": {
                "requestId": request_id,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }
    return body


async def apply(db: AsyncSession, acct: GoogleAccount, p: dict[str, Any]) -> dict[str, Any]:
    """Run a confirmed proposal against the Calendar API. Returns the event (or {})."""
    body = p.get("body") or {}
    notify = "all" if p.get("notify") else "none"
    if p["action"] == "create":
        params: dict[str, Any] = {"sendUpdates": notify}
        if "conferenceData" in body:
            params["conferenceDataVersion"] = 1
        return await _api(db, acct, "POST", "/events", params=params, json=body)
    if p["action"] == "update":
        params = {"sendUpdates": notify}
        if "conferenceData" in body:
            params["conferenceDataVersion"] = 1
        return await _api(db, acct, "PATCH", f"/events/{p['event_id']}", params=params, json=body)
    try:
        await _api(db, acct, "DELETE", f"/events/{p['event_id']}", params={"sendUpdates": notify})
    except CalendarError as e:
        if e.status not in (404, 410):  # gone already: what the person wanted
            raise
    return {}


# ---------------------------------------------------------------- proposals (Postgres)


async def propose(
    *,
    workspace_id: str,
    user_id: str,
    agent_id: str,
    agent_name: str,
    action: str,  # create | update | cancel
    title: str,
    summary: str,
    body: dict[str, Any],
    notify: bool,
    event_id: str = "",
    before: str = "",
    pid: str | None = None,
) -> dict[str, Any]:
    now = _now()
    p = {
        "id": pid or new_id("cp"),
        "workspace_id": workspace_id,
        "user_id": user_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "action": action,
        "event_id": event_id,
        "title": title[:300],
        "summary": summary[:2000],
        "before": before[:2000],
        "body": body,
        "notify": notify,
        "status": "pending",
        "error": None,
        "link": "",
        "created_at": now.isoformat(),
        "decided_at": None,
    }
    await save(p)
    return p


async def save(p: dict[str, Any]) -> None:
    async with SessionLocal() as db:
        row = await db.get(CalendarProposal, p["id"])
        if row is None:
            row = CalendarProposal(
                id=p["id"],
                workspace_id=p["workspace_id"],
                user_id=p["user_id"],
                created_at=datetime.fromisoformat(p["created_at"]),
            )
            db.add(row)
        row.status = p["status"]
        row.data = json.loads(json.dumps(p))  # a fresh object, so the JSONB change is saved
        await db.commit()


def _lapsed(p: dict[str, Any], now: datetime) -> bool:
    made = datetime.fromisoformat(p["created_at"])
    return p["status"] == "pending" and now - made > timedelta(days=PENDING_DAYS)


def _out(row: CalendarProposal, now: datetime) -> dict[str, Any]:
    p = dict(row.data)
    if _lapsed(p, now):
        p["status"] = "expired"
    return p


async def get(workspace_id: str, user_id: str, pid: str) -> dict[str, Any] | None:
    async with SessionLocal() as db:
        row = await db.get(CalendarProposal, pid)
    if row is None or row.workspace_id != workspace_id or row.user_id != user_id:
        return None  # someone else's: as if it did not exist
    return _out(row, _now())


async def listing(workspace_id: str, user_id: str, pending_only: bool) -> list[dict[str, Any]]:
    now = _now()
    async with SessionLocal() as db:
        await db.execute(
            delete(CalendarProposal).where(
                CalendarProposal.created_at < now - timedelta(days=KEEP_DAYS)
            )
        )
        await db.commit()
        q = select(CalendarProposal).where(
            CalendarProposal.workspace_id == workspace_id, CalendarProposal.user_id == user_id
        )
        if pending_only:
            q = q.where(
                CalendarProposal.status == "pending",
                CalendarProposal.created_at >= now - timedelta(days=PENDING_DAYS),
            )
        rows = (await db.scalars(q.order_by(CalendarProposal.created_at.desc()).limit(100))).all()
    return [_out(r, now) for r in rows]


async def pending_count(workspace_id: str, user_id: str) -> int:
    now = _now()
    async with SessionLocal() as db:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(CalendarProposal)
                .where(
                    CalendarProposal.workspace_id == workspace_id,
                    CalendarProposal.user_id == user_id,
                    CalendarProposal.status == "pending",
                    CalendarProposal.created_at >= now - timedelta(days=PENDING_DAYS),
                )
            )
            or 0
        )


async def claim(pid: str) -> bool:
    """A short lock while a confirmed proposal runs, so a double tap adds one event."""
    return bool(await valkey().set(f"calprop-lock:{pid}", "1", nx=True, ex=60))


async def release(pid: str) -> None:
    await valkey().delete(f"calprop-lock:{pid}")
