"""Natural-language "when" for schedules made from chat ("every Monday at 9am", "tomorrow 9am").

A small deterministic parser, no model involved: the same words always give the same cron
line, read in the workspace's time zone. It covers the common phrases and refuses everything
else with a question to put to the person (`Unclear`), instead of guessing. A raw five-field
cron line is accepted as is.

Recurring:  every day/weekday/weekend at 9am; every Monday and Thursday at 14:00; Mondays 9am;
            every month on the 1st at 9am; every year on 1 Jan at 9am; every 30 minutes;
            every 2 hours (on weekdays) (between 9am and 5pm); hourly.
One-off:    today/tonight/tomorrow at 5pm; Friday 4pm; next Monday 9:30am; on 10 Oct at 4pm;
            2026-10-10 16:00; in 2 hours.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .schedules import ScheduleError, next_runs

MIN_GAP_MINUTES = 15

_DAYS = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tues": 1,
    "tue": 1,
    "wednesday": 2,
    "weds": 2,
    "wed": 2,
    "thursday": 3,
    "thurs": 3,
    "thur": 3,
    "thu": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}
_DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_MONTHS = {
    m: i
    for i, names in enumerate(
        (
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ),
        1,
    )
    for m in names
}
_DAY_RE = r"(?:" + "|".join(sorted(_DAYS, key=len, reverse=True)) + r")"
_MONTH_RE = r"(?:" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")"
_EXAMPLES = (
    "e.g. 'every Monday at 9am', 'every weekday at 8:30am', 'every 2 hours', "
    "'tomorrow 9am', 'on 10 Oct at 4pm', or a cron line like '0 9 * * 1'"
)


class Unclear(ValueError):
    """The words do not pin down one time. The message is a question for the person."""


@dataclass(frozen=True)
class When:
    cron: str
    once: bool
    summary: str  # "every Monday at 09:00", "once on Fri 10 Oct 2026 at 16:00"
    first: datetime  # the next run, in the workspace's time zone


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ScheduleError(f"Unknown time zone {tz!r}.") from e


def _clean(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"(\d{4}-\d{2}-\d{2})t(\d)", r"\1 \2", t)  # ISO 2026-10-10T16:00
    t = t.replace("a.m.", "am").replace("p.m.", "pm").replace("o'clock", "")
    t = re.sub(r"[,;]+", " ", t)
    return " ".join(t.split())


# ---------------------------------------------------------------- times of day


def _times(t: str) -> list[tuple[int, int]]:
    """Every time of day in the text, as (hour, minute)."""
    found: list[tuple[int, tuple[int, int]]] = []
    taken: list[tuple[int, int]] = []

    def free(span: tuple[int, int]) -> bool:
        return all(span[1] <= a or span[0] >= b for a, b in taken)

    for m in re.finditer(r"\b(noon|midday|midnight)\b", t):
        found.append((m.start(), (0, 0) if m.group(1) == "midnight" else (12, 0)))
        taken.append(m.span())
    for m in re.finditer(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b", t):
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if not 1 <= h <= 12 or mi > 59:
            raise Unclear(f"{m.group(0)!r} is not a time of day. Say e.g. 9am or 4:30pm.")
        h = h % 12 + (12 if m.group(3) == "pm" else 0)
        found.append((m.start(), (h, mi)))
        taken.append(m.span())
    # 24-hour clock: 9:00, 16:30, 9.30 (not part of a date such as 10.10.2026)
    for m in re.finditer(r"(?<![\d.])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d.])", t):
        if free(m.span()):
            found.append((m.start(), (int(m.group(1)), int(m.group(2)))))
            taken.append(m.span())
    for m in re.finditer(r"\bat (\d{1,2})\b(?![:.]\d)", t):
        if not free(m.span(1)):
            continue
        h = int(m.group(1))
        if 13 <= h <= 23 or h == 0:
            found.append((m.start(1), (h, 0)))
            taken.append(m.span(1))
        else:
            raise Unclear(
                f"Is that {h} in the morning or in the evening? Say {h}am or {h}pm "
                f"(or {h:02d}:00 / {(h % 12) + 12:02d}:00)."
            )
    return [hm for _, hm in sorted(found)]


def _hhmm(hm: tuple[int, int]) -> str:
    return f"{hm[0]:02d}:{hm[1]:02d}"


def _one_time(t: str, what: str) -> tuple[int, int]:
    times = _times(t)
    if not times:
        raise Unclear(f"At what time {what}? Say e.g. 9am or 16:30.")
    if len(set(times)) > 1:
        raise Unclear(
            "That has more than one time ("
            + ", ".join(_hhmm(x) for x in times)
            + "). Which one? (For several, set up one schedule each.)"
        )
    return times[0]


# ---------------------------------------------------------------- dates


def _date(t: str, today: date) -> date | None:
    """An explicit calendar date (10 Oct, Oct 10, 10 October 2026, 2026-10-10, 25/10)."""
    m = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", t)
    if m:
        return _mkdate(int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(0))
    m = re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?(?: of)? ({_MONTH_RE})\b(?: (\d{{4}}))?", t)
    if m:
        return _year_for(today, int(m.group(1)), _MONTHS[m.group(2)], m.group(3), m.group(0))
    m = re.search(rf"\b({_MONTH_RE}) (\d{{1,2}})(?:st|nd|rd|th)?\b(?: (\d{{4}}))?", t)
    if m:
        return _year_for(today, int(m.group(2)), _MONTHS[m.group(1)], m.group(3), m.group(0))
    m = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a <= 12 and b <= 12 and a != b:
            raise Unclear(
                f"Is {m.group(0)} the {a} {_month_name(b)} or the {b} {_month_name(a)}? "
                "Write the month as a word, e.g. '10 Oct'."
            )
        day, month = (a, b) if a > 12 or a == b else (b, a)
        year = m.group(3)
        if year and len(year) == 2:
            year = f"20{year}"
        return _year_for(today, day, month, year, m.group(0))
    return None


def _month_name(n: int) -> str:
    return date(2000, n, 1).strftime("%B") if 1 <= n <= 12 else str(n)


def _mkdate(y: int, mo: int, d: int, raw: str) -> date:
    try:
        return date(y, mo, d)
    except ValueError as e:
        raise Unclear(f"{raw!r} is not a real date. Which day do you mean?") from e


def _year_for(today: date, d: int, mo: int, year: str | None, raw: str) -> date:
    if year:
        return _mkdate(int(year), mo, d, raw)
    day = _mkdate(today.year, mo, d, raw) if not (mo == 2 and d == 29) else None
    if day is None or day < today:
        return _mkdate(today.year + 1, mo, d, raw)
    return day


def _ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _weekday_list(t: str) -> list[int]:
    out: list[int] = []
    for m in re.finditer(rf"\b({_DAY_RE})s?\b", t):
        d = _DAYS[m.group(1)]
        if d not in out:
            out.append(d)
    return sorted(out)


def _on_days(days: list[int]) -> str:
    if days == [0, 1, 2, 3, 4]:
        return "weekdays"
    if days == [5, 6]:
        return "weekends"
    names = [_DAY_NAMES[d] + "s" for d in days]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _stamp(at: datetime) -> str:
    """Fri 10 Oct 2026 at 16:00 (no %-d: Windows strftime has no such flag)."""
    return f"{at:%a} {at.day} {at:%b %Y} at {at:%H:%M}"


def _cron_dow(days: list[int]) -> str:
    """Python weekdays (Mon=0) to cron (Sun=0), with ranges where they run on."""
    cron = sorted((d + 1) % 7 for d in days)
    if cron == [1, 2, 3, 4, 5]:
        return "1-5"
    return ",".join(str(d) for d in cron)


def _days_label(days: list[int]) -> str:
    if days == [0, 1, 2, 3, 4]:
        return "weekday"
    if days == [5, 6]:
        return "Saturday and Sunday"
    names = [_DAY_NAMES[d] for d in days]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


# ---------------------------------------------------------------- the parser


_CRON_FIELD = re.compile(r"^[\d*/,\-]+$")
_RECURRING = re.compile(
    r"\b(every|each|daily|weekly|monthly|yearly|annually|hourly|weekdays|weekends|"
    r"mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b"
)


def parse(text: str, tz: str, now: datetime | None = None) -> When:
    """Words (or a cron line) -> When. Raises Unclear with a question, or ScheduleError."""
    zone = _zone(tz)
    local_now = (now or datetime.now(zone)).astimezone(zone)
    raw = " ".join((text or "").split())
    if not raw:
        raise Unclear(f"When should it run? {_EXAMPLES}.")
    fields = raw.split(" ")
    if len(fields) == 5 and all(_CRON_FIELD.match(f) for f in fields):
        first = next_runs(raw, tz, 1, after=local_now)[0]
        _check_gap(raw, tz, local_now)
        return When(raw, False, f"on the cron line {raw}", first)

    t = _clean(raw)
    if re.search(r"\b(every other|every second|fortnightly|biweekly|bi-weekly)\b", t) or re.search(
        r"\bevery \d+ (weeks|months|days)\b", t
    ):
        raise Unclear(
            "A schedule can't skip weeks or days. Shall it run every week on that day, or on "
            "fixed dates such as the 1st and 15th of the month?"
        )
    if re.search(r"\blast (day|working day|weekday)\b", t):
        raise Unclear("'The last day of the month' isn't possible. The 28th, or the 1st?")

    rel = re.search(r"\bin (\d+|an?|one|half an?) (minutes?|mins?|hours?|hrs?|days?)\b", t)
    if rel and not _RECURRING.search(t):
        n_raw = rel.group(1)
        n = 1 if n_raw in ("a", "an", "one") else 0.5 if n_raw.startswith("half") else int(n_raw)
        unit = rel.group(2)
        delta = (
            timedelta(minutes=n)
            if unit.startswith("min")
            else timedelta(hours=n)
            if unit.startswith(("hour", "hr"))
            else timedelta(days=n)
        )
        if delta < timedelta(minutes=1) or delta > timedelta(days=365):
            raise Unclear("How long from now? Between a minute and a year.")
        at = (local_now + delta).replace(second=0, microsecond=0)
        if at <= local_now:
            at += timedelta(minutes=1)
        return _once(at, local_now, tz)

    if _RECURRING.search(t):
        return _recurring(t, tz, local_now)
    return _one_off(t, tz, local_now)


def _recurring(t: str, tz: str, now: datetime) -> When:
    every_n = re.search(r"\bevery (\d+|half an?) ?(minutes?|mins?|hours?|hrs?)\b", t)
    if every_n or re.search(r"\b(hourly|every hour)\b", t):
        if every_n:
            n_raw = every_n.group(1)
            unit_min = every_n.group(2).startswith("min")
            minutes = 30 if n_raw.startswith("half") else int(n_raw) * (1 if unit_min else 60)
        else:
            minutes = 60
        if minutes < MIN_GAP_MINUTES:
            raise ScheduleError(f"Run at most every {MIN_GAP_MINUTES} minutes.")
        days = _weekday_list(t)
        if re.search(r"\b(weekdays?|working days?|workdays?)\b", t):
            days = [0, 1, 2, 3, 4]
        dow = _cron_dow(days) if days else "*"
        hours = "*"
        window = re.search(r"\b(?:between|from) (.+?) (?:and|to|until|till) (.+)$", t)
        label_window = ""
        if window:
            start, end = _times(window.group(1)), _times(window.group(2))
            if not start or not end:
                raise Unclear("Between which times? Say e.g. 'between 9am and 5pm'.")
            if start[0][1] or end[0][1] or end[0][0] <= start[0][0]:
                raise Unclear("Use whole hours for the window, start before end, e.g. 9am to 5pm.")
            hours = f"{start[0][0]}-{end[0][0]}"
            label_window = f" from {_hhmm(start[0])} to {_hhmm(end[0])}"
        if minutes < 60:
            if 60 % minutes:
                raise Unclear(
                    f"Every {minutes} minutes doesn't fit evenly into an hour. "
                    "15, 20 or 30 minutes, or every hour?"
                )
            cron = f"*/{minutes} {hours} * * {dow}"
            label = f"every {minutes} minutes"
        else:
            if minutes % 60 or 24 % (minutes // 60):
                raise Unclear(
                    "That interval doesn't fit evenly into a day. Every 1, 2, 3, 4, 6, 8 or 12 "
                    "hours?"
                )
            step = minutes // 60
            if hours == "*":
                hours = "*" if step == 1 else f"*/{step}"
            elif step > 1:
                hours = f"{hours}/{step}"
            cron = f"0 {hours} * * {dow}"
            label = "every hour" if step == 1 else f"every {step} hours"
        if days:
            label += " on " + _on_days(days)
        return _done(cron, False, label + label_window, tz, now)

    times = sorted(set(_times(t)))
    if not times:
        raise Unclear("At what time should it run? Say e.g. 9am or 16:30.")
    when = times[0]
    minute, hour = when[1], str(when[0])
    at_label = _hhmm(when)
    if len(times) > 1 and re.search(r"\b(monthly|month|yearly|annually|year)\b", t):
        when = _one_time(t, "should it run")  # asks which one

    if re.search(r"\b(monthly|every month|each month|of (every|each|the) month)\b", t):
        dom = sorted(
            {
                int(m.group(1))
                for m in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)\b", t)
                if 1 <= int(m.group(1)) <= 31
            }
        )
        if not dom:
            raise Unclear("Which day of the month? e.g. 'every month on the 1st at 9am'.")
        if any(d > 28 for d in dom):
            raise Unclear(
                "Some months have no 29th, 30th or 31st, so it would skip them. The 28th or "
                "the 1st instead?"
            )
        cron = f"{minute} {hour} {','.join(map(str, dom))} * *"
        label = f"every month on the {' and '.join(_ordinal(d) for d in dom)} at {at_label}"
        return _done(cron, False, label, tz, now)

    if re.search(r"\b(yearly|annually|every year|each year)\b", t):
        day = _date(t, now.date())
        if day is None:
            raise Unclear("Which date each year? e.g. 'every year on 1 Jan at 9am'.")
        cron = f"{minute} {hour} {day.day} {day.month} *"
        return _done(cron, False, f"every year on {day.day} {day:%b} at {at_label}", tz, now)

    if re.search(r"\b(weekdays?|working days?|workdays?|business days?)\b", t):
        days = [0, 1, 2, 3, 4]
    elif re.search(r"\b(weekends?)\b", t):
        days = [5, 6]
    else:
        days = _weekday_list(t)
    if not days:
        if re.search(r"\b(weekly|every week|each week)\b", t):
            raise Unclear("Which day of the week? e.g. 'every Monday at 9am'.")
        if not re.search(r"\b(daily|(every|each) (day|morning|evening|night))\b", t):
            raise Unclear(f"How often? {_EXAMPLES}.")
    if len(times) > 1:
        if len({m for _, m in times}) > 1:
            raise Unclear("Those times have different minutes. Set up one schedule for each time.")
        hour = ",".join(str(h) for h, _ in times)
        at_label = " and ".join(_hhmm(x) for x in times)
    dow = _cron_dow(days) if days else "*"
    label = (
        f"every day at {at_label}"
        if not days
        else f"every {_days_label(days)} at {at_label}"
        if days != [5, 6]
        else f"every Saturday and Sunday at {at_label}"
    )
    return _done(f"{minute} {hour} * * {dow}", False, label, tz, now)


def _one_off(t: str, tz: str, now: datetime) -> When:
    today = now.date()
    day: date | None = None
    if re.search(r"\b(today|tonight|this (morning|afternoon|evening))\b", t):
        day = today
    elif re.search(r"\b(tomorrow|tmrw|tmr)\b", t):
        day = today + timedelta(days=1)
    elif re.search(r"\bday after tomorrow\b", t):
        day = today + timedelta(days=2)
    else:
        day = _date(t, today)
        if day is None:
            names = _weekday_list(t)
            if len(names) > 1:
                raise Unclear(
                    "That names several days. For a repeat, say 'every Monday and Friday'; "
                    "for once, pick one day."
                )
            if names:
                ahead = (names[0] - today.weekday()) % 7
                day = today + timedelta(days=ahead)
                if re.search(rf"\bnext {_DAY_RE}\b", t) and ahead == 0:
                    day += timedelta(days=7)
            elif re.search(r"\bnext (week|month)\b", t):
                raise Unclear("Which day next week, and at what time?")
    if day is None:
        if _times(t):
            raise Unclear(
                "Once (today or tomorrow?) or every day at that time? Say e.g. 'tomorrow at "
                "9am' or 'every day at 9am'."
            )
        raise Unclear(f"I could not tell when. {_EXAMPLES}.")
    hm = _one_time(t, "on that day")
    at = datetime(day.year, day.month, day.day, hm[0], hm[1], tzinfo=now.tzinfo)
    if at <= now:
        if day == today and not re.search(r"\b(today|tonight|this)\b", t):
            at += timedelta(days=7)  # "Friday 4pm" said on Friday at 5pm: next week's Friday
        else:
            raise Unclear(f"{_stamp(at)} has already passed. Did you mean another day?")
    return _once(at, now, tz)


def _once(at: datetime, now: datetime, tz: str) -> When:
    if at - now > timedelta(days=365):
        raise Unclear("That is more than a year away. Which date do you mean?")
    cron = f"{at.minute} {at.hour} {at.day} {at.month} *"
    first = next_runs(cron, tz, 1, after=now)[0]
    return When(cron, True, f"once on {_stamp(at)}", first)


def _done(cron: str, once: bool, label: str, tz: str, now: datetime) -> When:
    first = next_runs(cron, tz, 1, after=now)[0]
    _check_gap(cron, tz, now)
    return When(cron, once, label, first)


def _check_gap(cron: str, tz: str, now: datetime) -> None:
    """At least MIN_GAP_MINUTES between any two runs (over the next few dozen)."""
    runs = next_runs(cron, tz, 48, after=now)
    for a, b in zip(runs, runs[1:], strict=False):
        if (b - a) < timedelta(minutes=MIN_GAP_MINUTES):
            raise ScheduleError(f"Run at most every {MIN_GAP_MINUTES} minutes.")
