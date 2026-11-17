"""P109b: a Teams meeting from the Microsoft 365 workspace, and its Prima record.

Fitri (17 Nov 2026): "ask AI to create a Teams meeting with meeting link and send to who ...
it will auto send invitations, and also update the Prima meetings record there."

- The AI only fills the form (`draft_prompt`, `parse_draft`): title, the people named, the date
  and time in the office's time zone, how long, an agenda and the kind of meeting. Nothing is
  sent or booked until the person presses "Create and send invitations".
- The people named are matched (`resolve`) against the office members this person may see
  (the same rule as giving a task: never wider) and the people in their own Outlook (mail they
  sent or got; Microsoft's People list too once People.Read is granted), and the people of the
  email or chat the meeting is about. One sure match fills the address; several are offered to
  pick from; none leaves it for the person to type.
- Prima: the meeting is recorded in Prima's Meetings as that person, through the office's
  signed call (prima/client.call), so Prima's own sign-in, module and permission rules decide.
  When Prima refuses or is not there, the reason is kept and "Add to Prima" tries again. A
  change or cancel made here goes to Prima's own change and cancel routes.
"""

import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.fence import fence
from ..i18n import Msg, render
from ..models import Branch, Department, Membership, User
from .meeting_models import PRIMA_KINDS, TeamsMeeting

DEFAULT_KIND = "management"
DEFAULT_MINUTES = 30
EMAIL = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")
PEOPLE_SCOPE = "People.Read"  # optional: Microsoft's ranked people list (not asked for today)
# Prima's limits (apps/prima controllers.ts scheduleMeeting / changeMeeting).
PRIMA_TITLE = 120
PRIMA_AGENDA = 2000
PRIMA_PEOPLE = 40
PRIMA_NAME = 80
PRIMA_ID = re.compile(r"^[A-Za-z0-9_\-.~]{1,120}$")
PRIMA_LOCATION = "Microsoft Teams"


def is_email(v: str) -> bool:
    return bool(EMAIL.match(v.strip()))


# ---------------------------------------------------------------- the AI fills the form


def draft_prompt(
    instructions: str, *, now: datetime, tz: str, context: str = "", context_kind: str = ""
) -> str:
    local = now.astimezone(ZoneInfo(tz))
    about = (
        f"\nThe {context_kind} this meeting is about (data):\n{fence(context)}\n" if context else ""
    )
    kinds = " | ".join(PRIMA_KINDS)
    return (
        f"Now it is {local.strftime('%A %Y-%m-%d %H:%M')} in my time zone ({tz}).\n"
        f"Turn my request into a Microsoft Teams meeting. My request: {instructions.strip()}\n"
        f"{about}"
        'Answer as JSON only: {"title": "...", "date": "YYYY-MM-DD", "time": "HH:MM" (24-hour, '
        'my local time), "minutes": 30, "attendees": [{"name": "the name as I wrote it", '
        '"email": "only when written"}], "agenda": "short items, one per line", "kind": '
        f'"{kinds}"}}.\n'
        "Rules: attendees are only the people I named (for a meeting about the email or chat, "
        "its people only when I ask for them); never make up an email address. No date given: "
        "the next working day (Monday to Friday). No time given: 10:00. No length given: 30 "
        "minutes. The agenda comes from my request (and the email or chat), in my language; "
        "write an agenda when I ask for one, else a short one. kind: department for a team or "
        "department meeting, client for a client, operations for site or operations work, "
        "board for the board, else management."
    )


def _next_working_day(local_now: datetime) -> datetime:
    d = local_now + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def parse_draft(d: Any, tz: str, now: datetime) -> dict[str, Any]:
    """The model's idea, checked: a start in UTC from the office's time zone (next working day
    10:00 when it gave none), a length of 5 minutes to 8 hours, only well-formed addresses, a
    kind Prima knows."""
    d = d if isinstance(d, dict) else {}
    zone = ZoneInfo(tz)
    local_now = now.astimezone(zone)
    day = str(d.get("date") or "").strip()[:10]
    hm = str(d.get("time") or "").strip()[:5]
    try:
        start = datetime.strptime(f"{day}T{hm}", "%Y-%m-%dT%H:%M").replace(tzinfo=zone)  # noqa: DTZ007
    except ValueError:
        try:
            base = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=zone)  # noqa: DTZ007
        except ValueError:
            base = _next_working_day(local_now)
        start = base.replace(hour=10, minute=0, second=0, microsecond=0)
    try:
        minutes = int(d.get("minutes") or DEFAULT_MINUTES)
    except (TypeError, ValueError):
        minutes = DEFAULT_MINUTES
    minutes = max(5, min(minutes, 480))
    people: list[dict[str, str]] = []
    for a in d.get("attendees") or []:
        if isinstance(a, str):
            a = {"email": a} if is_email(a) else {"name": a}
        if not isinstance(a, dict):
            continue
        name = " ".join(str(a.get("name") or "").split())[:120]
        email = str(a.get("email") or "").strip().lower()
        email = email if is_email(email) else ""
        if name or email:
            people.append({"name": name, "email": email})
    kind = str(d.get("kind") or "").strip().lower()
    return {
        "title": " ".join(str(d.get("title") or "").split())[:255],
        "start": start.astimezone(UTC),
        "minutes": minutes,
        "attendees": people[:50],
        "agenda": str(d.get("agenda") or "").strip()[:4000],
        "kind": kind if kind in PRIMA_KINDS else DEFAULT_KIND,
    }


# ---------------------------------------------------------------- who is who


def _words(s: str) -> list[str]:
    return [w for w in re.split(r"[^\w@]+", s.lower()) if w]


def matches(name: str, cand: dict[str, str]) -> bool:
    """Every word of what was written is in the candidate's name or address ("Faiz" matches
    "Mohd Faiz bin Ali")."""
    words = _words(name)
    hay = f"{cand.get('name') or ''} {cand.get('email') or ''}".lower()
    hay_words = set(_words(hay))
    return bool(words) and all(w in hay_words or (len(w) > 3 and w in hay) for w in words)


async def office_people(
    db: AsyncSession, principal: Any, q: str = "", limit: int = 20
) -> list[dict[str, str]]:
    """Office members this person may see, by the rule for giving a task (teams/people.py:
    themselves, their direct reports, a branch manager's branch, everyone for members.manage).
    Never wider than that."""
    from ..api.routers.tasks import team_ids  # late: the api builds on this module
    from ..teams import people

    team = await team_ids(db, principal)
    where = people.assignable_where(
        people.actor_of(principal), sorted(set(team) - {principal.user.id})
    )
    stmt = (
        select(User.name, User.email, Branch.name, Department.name)
        .join(Membership, Membership.user_id == User.id)
        .outerjoin(Branch, Branch.id == Membership.branch_id)
        .outerjoin(Department, Department.id == Membership.department_id)
        .where(Membership.workspace_id == principal.workspace_id, User.is_active.is_(True), where)
    )
    for w in _words(q)[:4]:
        like = f"%{w.replace('%', '').replace('_', '').replace(chr(92), '')}%"
        stmt = stmt.where(or_(func.lower(User.name).like(like), func.lower(User.email).like(like)))
    rows = (await db.execute(stmt.order_by(func.lower(User.name)).limit(limit))).all()
    # P111: their company and department too, so a picker can tell two Faizes apart.
    return [
        {
            "name": n or e,
            "email": (e or "").lower(),
            "source": "office",
            "company": b or "",
            "department": d or "",
        }
        for n, e, b, d in rows
        if e
    ]


def _people_of_mail(m: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for part in [m.get("from"), *(m.get("toRecipients") or []), *(m.get("ccRecipients") or [])]:
        e = (part or {}).get("emailAddress") or {}
        addr = str(e.get("address") or "").lower()
        if is_email(addr):
            out.append({"name": str(e.get("name") or addr), "email": addr, "source": "outlook"})
    return out


async def outlook_people(g: Any, q: str, scopes: str = "", limit: int = 8) -> list[dict[str, str]]:
    """People in the person's own Outlook whose name or address matches: Microsoft's People list
    when People.Read was granted, else the senders and recipients of their mail that matches."""
    from .auth import has_scope
    from .errors import MicrosoftError

    q = " ".join(q.split())[:80]
    if len(q) < 2:
        return []
    found: list[dict[str, str]] = []
    try:
        if has_scope(scopes, PEOPLE_SCOPE):
            body = await g.request(
                "GET",
                "/me/people",
                params={
                    "$search": f'"{q}"',
                    "$top": limit,
                    "$select": "displayName,scoredEmailAddresses",
                },
            )
            for p in body.get("value") or []:
                for e in p.get("scoredEmailAddresses") or []:
                    addr = str(e.get("address") or "").lower()
                    if is_email(addr):
                        found.append(
                            {
                                "name": str(p.get("displayName") or addr),
                                "email": addr,
                                "source": "outlook",
                            }
                        )
                        break
        else:
            for m in await g.search_messages(q, 15):
                found.extend(c for c in _people_of_mail(m) if matches(q, c))
    except MicrosoftError:
        return []
    return dedupe(found)[:limit]


def dedupe(people: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    out = []
    for p in people:
        key = (p.get("email") or "").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


async def resolve(
    db: AsyncSession,
    principal: Any,
    g: Any,
    wanted: list[dict[str, str]],
    *,
    context_people: list[dict[str, str]] | None = None,
    scopes: str = "",
    me: str = "",
) -> list[dict[str, Any]]:
    """Each person the AI named, with the address to invite: "ok" (written, or one sure match),
    "choose" (several: `options`), or "unknown" (none: the person types it)."""
    out: list[dict[str, Any]] = []
    taken: set[str] = set()
    for w in wanted:
        name, email = w.get("name") or "", w.get("email") or ""
        if email:
            if email in taken or email == me:
                continue
            taken.add(email)
            out.append({"name": name or email, "email": email, "status": "ok", "options": []})
            continue
        ctx = [c for c in context_people or [] if matches(name, c) and c["email"] != me]
        if len(ctx) == 1 and ctx[0]["email"] not in taken:
            # One of the people in the email or chat the meeting is about: that one.
            one = ctx[0]
            taken.add(one["email"])
            out.append({"name": one["name"], "email": one["email"], "status": "ok", "options": []})
            continue
        office = await office_people(db, principal, name, limit=6)
        outlook = await outlook_people(g, name, scopes, limit=6)
        options = [
            c
            for c in dedupe([*ctx, *[o for o in office if matches(name, o)], *outlook])
            if c["email"] != me
        ][:6]
        exact = [c for c in options if c["name"].strip().lower() == name.strip().lower()]
        pick = exact[0] if len(exact) == 1 else options[0] if len(options) == 1 else None
        if pick is not None and pick["email"] not in taken:
            taken.add(pick["email"])
            out.append(
                {"name": pick["name"], "email": pick["email"], "status": "ok", "options": []}
            )
        else:
            out.append(
                {
                    "name": name,
                    "email": "",
                    "status": "choose" if options else "unknown",
                    "options": options,
                }
            )
    return out


# ---------------------------------------------------------------- Outlook


def agenda_html(agenda: str) -> str:
    from .hub import text_html

    return text_html(agenda.strip()) if agenda.strip() else ""


def graph_attendees(people: list[dict[str, str]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "required",
            "emailAddress": {
                "address": p["email"],
                **({"name": p["name"]} if p.get("name") else {}),
            },
        }
        for p in people
    ]


def join_url_of(ev: dict[str, Any]) -> str | None:
    from .hub import _safe_href

    url = str((ev.get("onlineMeeting") or {}).get("joinUrl") or "")
    return url if url and _safe_href(url) else None


def row_out(row: TeamsMeeting) -> dict[str, Any]:
    return {
        "id": row.id,
        "event_id": row.event_id,
        "title": row.title,
        "start": row.start_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "end": row.end_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "attendees": row.attendees,
        "agenda": row.agenda,
        "join_url": row.join_url,
        "web_link": row.web_link,
        "kind": row.kind,
        "cancelled": row.cancelled_at is not None,
        "prima": {
            "status": row.prima_status,
            "meeting_id": row.prima_meeting_id,
            "reason": row.prima_error,
        },
    }


# ---------------------------------------------------------------- Prima


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def prima_agenda(agenda: str, title: str, join_url: str | None) -> str:
    """Prima wants at least one agenda item, one per line, at most 2000 characters; the Teams
    link goes on the last line (Prima has no field for it; its place holds 120 characters)."""
    lines = [ln.strip() for ln in agenda.splitlines() if ln.strip()] or [title.strip()[:200]]
    tail = f"\nMicrosoft Teams: {join_url}" if join_url else ""
    text = "\n".join(lines)[: PRIMA_AGENDA - len(tail)].rstrip()
    return (text + tail)[:PRIMA_AGENDA]


def _prima_said(ans: Any) -> str:
    try:
        data = ans.json()
    except ValueError:
        data = None
    said = data.get("message") if isinstance(data, dict) else None
    if isinstance(said, list):
        said = "; ".join(str(s) for s in said)
    return str(said or render(Msg("Prima answered {status}.", status=ans.status)))[:500]


async def _company(db: AsyncSession, ws: str, uid: str, ip: str) -> str | None:
    """A company manager's meeting is for their company (Prima lets them run only those);
    everyone else's is the group's (their department's). Prima checks it either way."""
    from ..prima import client

    ans = await client.call(
        db, workspace_id=ws, user_id=uid, method="GET", path="api/me", client_ip=ip
    )
    if ans.status != 200:
        return None
    data = ans.json()
    user = data.get("user") if isinstance(data, dict) else None
    if not isinstance(user, dict) or user.get("role") not in ("company_manager", "admin_exec"):
        return None
    ids = [str(c) for c in user.get("companyIds") or [] if c]
    return ids[0] if ids else None


async def prima_add(db: AsyncSession, principal: Any, row: TeamsMeeting, ip: str = "") -> None:
    """Record the meeting in Prima's Meetings as this person. Sets row.prima_* (the caller
    commits): added with Prima's id, or failed / skipped with the reason."""
    from ..prima import client
    from ..prima.client import PrimaError

    ws, uid = principal.workspace_id, principal.user.id
    if not client.enabled(ws):
        row.prima_status = "skipped"
        row.prima_error = render(Msg("Prima is not set up on this server."))
        return
    names = [
        (p.get("name") or p.get("email") or "")[:PRIMA_NAME]
        for p in row.attendees
        if p.get("name") or p.get("email")
    ][:PRIMA_PEOPLE]
    try:
        company = await _company(db, ws, uid, ip)
        body = {
            "companyId": company,
            "kind": row.kind if row.kind in PRIMA_KINDS else DEFAULT_KIND,
            "title": row.title[:PRIMA_TITLE],
            "start": _iso(row.start_at),
            "end": _iso(row.end_at),
            "location": PRIMA_LOCATION,
            "attendees": names,
            "agenda": prima_agenda(row.agenda, row.title, row.join_url),
            "repeat": None,
        }
        ans = await client.call(
            db,
            workspace_id=ws,
            user_id=uid,
            method="POST",
            path="api/meetings",
            body=json.dumps(body, ensure_ascii=False).encode(),
            client_ip=ip,
        )
    except PrimaError as e:
        row.prima_status, row.prima_error = "failed", render(e.message)[:500]
        return
    data = ans.json() if ans.status in (200, 201) else None
    mid = str(data.get("id") or "") if isinstance(data, dict) else ""
    if ans.status in (200, 201) and PRIMA_ID.match(mid):
        row.prima_status, row.prima_meeting_id, row.prima_error = "added", mid, None
    else:
        row.prima_status, row.prima_error = "failed", _prima_said(ans)


async def prima_change(
    db: AsyncSession,
    principal: Any,
    row: TeamsMeeting,
    fields: dict[str, Any],
    reason: str,
    ip: str = "",
) -> str | None:
    """Send a change made here to the Prima meeting (Prima's own change route, with the
    reason). None when done or nothing to do; else why Prima did not take it."""
    from ..prima import client
    from ..prima.client import PrimaError

    if row.prima_status != "added" or not row.prima_meeting_id or not fields:
        return None
    body = {**fields, "reason": reason[:300]}
    try:
        ans = await client.call(
            db,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            method="POST",
            path=f"api/meetings/{row.prima_meeting_id}/change",
            body=json.dumps(body, ensure_ascii=False).encode(),
            client_ip=ip,
        )
    except PrimaError as e:
        return render(e.message)[:500]
    return None if ans.status in (200, 201) else _prima_said(ans)


async def prima_cancel(
    db: AsyncSession, principal: Any, row: TeamsMeeting, reason: str, ip: str = ""
) -> str | None:
    """Cancel the Prima meeting too (Prima's own cancel route, the record stays there)."""
    from ..prima import client
    from ..prima.client import PrimaError

    if row.prima_status != "added" or not row.prima_meeting_id:
        return None
    try:
        ans = await client.call(
            db,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            method="POST",
            path=f"api/meetings/{row.prima_meeting_id}/cancel",
            body=json.dumps({"reason": reason[:300]}, ensure_ascii=False).encode(),
            client_ip=ip,
        )
    except PrimaError as e:
        return render(e.message)[:500]
    if ans.status in (200, 201):
        row.prima_status = "cancelled"
        return None
    return _prima_said(ans)
