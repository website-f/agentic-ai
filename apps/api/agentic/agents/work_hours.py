"""Working hours (P19): when an agent works, like a person's contract.

`agents.work_hours` is None (works any time) or
    {"tz": "Asia/Kuala_Lumpur", "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "18:00",
     "breaks": [{"start": "13:00", "end": "14:00"}], "urgent_anytime": true}
Days are ISO weekdays (Mon=1 .. Sun=7). One shift a day: start must be before end (an
overnight shift is not supported), breaks sit inside it and do not overlap.

The helpers here are pure (no database), so the launcher, the heartbeat, schedules and the
API all read hours the same way:
- is_working(now, wh) / state(now, wh): in a shift and not on a break;
- next_start(now, wh): when it is next at work (now, if it already is);
- describe(wh): "Mon–Fri 09:00–18:00, lunch 13:00–14:00";
- duty(now, wh, tz): the little status the UI shows ("Off duty until 09:00 tomorrow");
- may_start(now, wh, urgent): whether work may start now. Outside hours only urgent work
  does, and only when the agent's hours allow urgent work any time.
"""

import re
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MAX_BREAKS = 4
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$|^24:00$")

URGENT = "urgent"


class HoursError(ValueError):
    """The hours do not make sense. The message is for the person."""


def default(tz: str) -> dict[str, Any]:
    """A normal office week: what the onboarding offers first."""
    return {
        "tz": tz,
        "days": [1, 2, 3, 4, 5],
        "start": "09:00",
        "end": "18:00",
        "breaks": [{"start": "13:00", "end": "14:00"}],
        "urgent_anytime": False,
    }


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(mins: int) -> str:
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise HoursError(f"Unknown time zone {tz!r}.") from e


def _time(v: Any, what: str) -> str:
    s = str(v or "").strip()
    if len(s) == 4 and s[1] == ":":  # "9:00"
        s = "0" + s
    if not _HHMM.match(s):
        raise HoursError(f"The {what} time must look like 09:00.")
    return s


def clean(wh: dict[str, Any] | None, default_tz: str) -> dict[str, Any] | None:
    """Validate and normalise hours from a person. None stays None (works any time)."""
    if wh is None:
        return None
    if not isinstance(wh, dict):
        raise HoursError("Working hours must be an object.")
    tz = str(wh.get("tz") or default_tz)
    _zone(tz)
    raw_days = wh.get("days")
    if not isinstance(raw_days, list) or not raw_days:
        raise HoursError("Pick at least one working day.")
    try:
        days = sorted({int(d) for d in raw_days})
    except (TypeError, ValueError) as e:
        raise HoursError("Days are numbers from 1 (Monday) to 7 (Sunday).") from e
    if days[0] < 1 or days[-1] > 7:
        raise HoursError("Days are numbers from 1 (Monday) to 7 (Sunday).")
    start, end = _time(wh.get("start"), "start"), _time(wh.get("end"), "end")
    if start == "24:00":
        raise HoursError("The day cannot start at 24:00.")
    if _mins(start) >= _mins(end):
        raise HoursError("The day must end after it starts (overnight shifts are not supported).")
    raw_breaks = wh.get("breaks") or []
    if not isinstance(raw_breaks, list) or len(raw_breaks) > MAX_BREAKS:
        raise HoursError(f"At most {MAX_BREAKS} breaks a day.")
    breaks: list[dict[str, str]] = []
    for b in raw_breaks:
        if not isinstance(b, dict):
            raise HoursError("Each break needs a start and an end.")
        bs, be = _time(b.get("start"), "break start"), _time(b.get("end"), "break end")
        if _mins(bs) >= _mins(be):
            raise HoursError(f"The break {bs}–{be} must end after it starts.")
        if _mins(bs) < _mins(start) or _mins(be) > _mins(end):
            raise HoursError(f"The break {bs}–{be} must be inside the working day.")
        breaks.append({"start": bs, "end": be})
    breaks.sort(key=lambda b: _mins(b["start"]))
    for a, b in zip(breaks, breaks[1:], strict=False):
        if _mins(b["start"]) < _mins(a["end"]):
            raise HoursError("Breaks must not overlap.")
    if sum(_mins(b["end"]) - _mins(b["start"]) for b in breaks) >= _mins(end) - _mins(start):
        raise HoursError("The breaks leave no time to work.")
    return {
        "tz": tz,
        "days": days,
        "start": start,
        "end": end,
        "breaks": breaks,
        "urgent_anytime": bool(wh.get("urgent_anytime", False)),
    }


def segments(wh: dict[str, Any]) -> list[tuple[int, int]]:
    """The day's working stretches in minutes, breaks cut out: [(540, 780), (840, 1080)]."""
    out: list[tuple[int, int]] = []
    cur = _mins(wh["start"])
    for b in sorted(wh.get("breaks") or [], key=lambda b: _mins(b["start"])):
        bs, be = _mins(b["start"]), _mins(b["end"])
        if bs > cur:
            out.append((cur, bs))
        cur = max(cur, be)
    if _mins(wh["end"]) > cur:
        out.append((cur, _mins(wh["end"])))
    return out


def _local(now: datetime, wh: dict[str, Any]) -> datetime:
    return now.astimezone(_zone(wh.get("tz") or "UTC"))


def _at(day: date, mins: int, zone: ZoneInfo) -> datetime:
    if mins >= 24 * 60:
        return datetime.combine(day + timedelta(days=1), time(0), zone)
    return datetime.combine(day, time(mins // 60, mins % 60), zone)


def state(now: datetime, wh: dict[str, Any] | None) -> str:
    """working | break | off (always "working" without hours)."""
    if not wh:
        return "working"
    local = _local(now, wh)
    if local.isoweekday() not in wh["days"]:
        return "off"
    m = local.hour * 60 + local.minute
    if not _mins(wh["start"]) <= m < _mins(wh["end"]):
        return "off"
    if any(_mins(b["start"]) <= m < _mins(b["end"]) for b in wh.get("breaks") or []):
        return "break"
    return "working"


def is_working(now: datetime, wh: dict[str, Any] | None) -> bool:
    return state(now, wh) == "working"


def next_start(now: datetime, wh: dict[str, Any] | None) -> datetime | None:
    """When the agent is next at work, in its own time zone. `now` when it already is; None
    without hours (always at work) or with no working day at all."""
    if not wh:
        return None
    if is_working(now, wh):
        return now
    zone = _zone(wh.get("tz") or "UTC")
    local = now.astimezone(zone)
    for d in range(8):
        day = local.date() + timedelta(days=d)
        if day.isoweekday() not in wh["days"]:
            continue
        for s, _e in segments(wh):
            at = _at(day, s, zone)
            if at > local:
                return at
    return None


def shift_end(now: datetime, wh: dict[str, Any] | None) -> datetime | None:
    """While working: when the current stretch ends (a break or the end of the day)."""
    if not wh or not is_working(now, wh):
        return None
    zone = _zone(wh.get("tz") or "UTC")
    local = now.astimezone(zone)
    m = local.hour * 60 + local.minute
    for s, e in segments(wh):
        if s <= m < e:
            return _at(local.date(), e, zone)
    return None


def _days_label(days: list[int]) -> str:
    if days == list(range(1, 8)):
        return "Every day"
    if len(days) >= 3 and days == list(range(days[0], days[-1] + 1)):
        return f"{DAY_NAMES[days[0] - 1]}–{DAY_NAMES[days[-1] - 1]}"
    return ", ".join(DAY_NAMES[d - 1] for d in days)


def describe(wh: dict[str, Any] | None) -> str:
    """One line a person reads: "Mon–Fri 09:00–18:00, lunch 13:00–14:00"."""
    if not wh:
        return "Any time"
    out = f"{_days_label(wh['days'])} {wh['start']}–{wh['end']}"
    for i, b in enumerate(wh.get("breaks") or []):
        lunch = i == 0 and 11 * 60 <= _mins(b["start"]) <= 15 * 60
        out += f", {'lunch' if lunch else 'break'} {b['start']}–{b['end']}"
    return out


def when_label(at: datetime, now: datetime, wh: dict[str, Any]) -> str:
    """ "09:00", "09:00 tomorrow", "09:00 on Mon" (in the agent's time zone)."""
    zone = _zone(wh.get("tz") or "UTC")
    la, ln = at.astimezone(zone), now.astimezone(zone)
    days = (la.date() - ln.date()).days
    hhmm = la.strftime("%H:%M")
    if days <= 0:
        return hhmm
    if days == 1:
        return f"{hhmm} tomorrow"
    return f"{hhmm} on {DAY_NAMES[la.isoweekday() - 1]}"


def duty(now: datetime, wh: dict[str, Any] | None) -> dict[str, Any]:
    """{"state", "on", "until", "label"} for the UI. "always" when it has no hours."""
    if not wh:
        return {"state": "always", "on": True, "until": None, "label": "Works any time"}
    st = state(now, wh)
    if st == "working":
        end = shift_end(now, wh)
        return {
            "state": st,
            "on": True,
            "until": end.isoformat() if end else None,
            "label": f"On duty until {when_label(end, now, wh)}" if end else "On duty",
        }
    back = next_start(now, wh)
    word = "On a break" if st == "break" else "Off duty"
    return {
        "state": st,
        "on": False,
        "until": back.isoformat() if back else None,
        "label": f"{word} until {when_label(back, now, wh)}" if back else word,
    }


# ---------------------------------------------------------------- urgency


def task_is_urgent(priority: str | None, labels: list[str] | None) -> bool:
    """A task is urgent when its priority is urgent or it carries the "urgent" label."""
    return priority == URGENT or URGENT in [str(x).lower() for x in labels or []]


def schedule_is_urgent(name: str | None, title: str | None) -> bool:
    """A schedule is marked urgent by starting its name or title with "Urgent" (e.g.
    "Urgent: server check"); its tasks are then created as urgent."""
    return any(re.match(r"\s*\[?urgent\b", s or "", re.I) for s in (name, title))


def may_start(now: datetime, wh: dict[str, Any] | None, urgent: bool) -> bool:
    if is_working(now, wh):
        return True
    return bool(urgent and wh and wh.get("urgent_anytime"))


def deferred_until(now: datetime, wh: dict[str, Any] | None, urgent: bool) -> datetime | None:
    """None: start now. Otherwise when the work may start (the agent's next shift)."""
    if not wh or may_start(now, wh, urgent):
        return None
    return next_start(now, wh)


def waiting_note(agent_name: str, at: datetime, now: datetime, wh: dict[str, Any]) -> str:
    return f"Starts when {agent_name} is back at {when_label(at, now, wh)}"[:300]
