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

Malay (and a mix of both) reads the same way: "setiap Isnin 9 pagi", "setiap hari bekerja jam
8.30 pagi", "1hb setiap bulan 9 pagi", "setiap 3 jam", "esok 3 petang", "Isnin depan 9 pagi",
"5/10 jam 3 petang" (day first), "dalam 2 jam", "every Isnin 9 pagi". See `_malay`.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..i18n import tr
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


def _examples(malay: bool) -> str:
    """Examples for a question back, in the words the person used."""
    if malay:
        return tr(
            "e.g. 'setiap Isnin 9 pagi', 'setiap hari bekerja jam 8.30 pagi', 'setiap 2 jam', "
            "'esok 3 petang', '1hb setiap bulan 9 pagi', or a cron line like '0 9 * * 1'"
        )
    return tr(
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
        raise ScheduleError(tr("Unknown time zone '{tz}'.", tz=tz)) from e


def _clean(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"(\d{4}-\d{2}-\d{2})t(\d)", r"\1 \2", t)  # ISO 2026-10-10T16:00
    t = t.replace("a.m.", "am").replace("p.m.", "pm").replace("o'clock", "")
    t = t.replace("’", "'").replace("–", "-").replace("—", "-")
    t = re.sub(r"[,;!?]+", " ", t)
    t = re.sub(r"\.(?=\s|$)", " ", t)  # a full stop, not the dot in 9.30 or 5.10.2026
    t = " ".join(t.split())
    return _military(t)


_CLOCK_CUE = re.compile(
    r"\b(?:jam|pukul|pkl|at|between|from|and|to|until|till|antara|dari|dan|hingga|sehingga|"
    r"sampai)\s*$|@\s*$"
)


def _military(t: str) -> str:
    """'0900', 'at 1400', '1730 hrs' -> 09:00, 14:00, 17:30. A bare 2026 stays a year."""

    def rep(m: re.Match[str]) -> str:
        hh, mm, suffix = m.group(1), m.group(2), m.group(3)
        if hh.startswith("0") or suffix or _CLOCK_CUE.search(t[: m.start()]):
            return f"{hh}:{mm}"
        return m.group(0)

    return re.sub(
        r"(?<![\d/:.\-])\b([01]\d|2[0-3])([0-5]\d)\b(?![/:.\-]\d)(\s*(?:hrs?|hours|h)\b)?", rep, t
    )


# ---------------------------------------------------------------- Malay (and mixed) words
#
# Office staff write "setiap Isnin 9 pagi", "esok jam 3 petang", "1hb setiap bulan" or mix
# both ("every Isnin 9 pagi"). `_malay` rewrites those words into the English this parser
# already reads, so both languages give the same cron lines and the same questions. Times
# with pagi / petang / malam become 24-hour clock times; a Malay date like 5/10 is the 5th
# of October (Malaysians write the day first).

_MS_DAYS = {
    "isnin": "monday",
    "isn": "monday",
    "selasa": "tuesday",
    "sel": "tuesday",
    "rabu": "wednesday",
    "rab": "wednesday",
    "khamis": "thursday",
    "kamis": "thursday",
    "khm": "thursday",
    "kha": "thursday",
    "jumaat": "friday",
    "jumaah": "friday",
    "jumat": "friday",
    "juma'at": "friday",
    "jum'at": "friday",
    "jum": "friday",
    "sabtu": "saturday",
    "sab": "saturday",
    "ahad": "sunday",
    "ahd": "sunday",
}
_MS_MONTHS = {
    "januari": "jan",
    "februari": "feb",
    "mac": "mar",
    "mei": "may",
    "julai": "jul",
    "ogos": "aug",
    "ogs": "aug",
    "oktober": "oct",
    "okt": "oct",
    "disember": "dec",
    "dis": "dec",
}
_MS_NUMBERS = {
    "dua belas": 12,
    "sebelas": 11,
    "sepuluh": 10,
    "sembilan": 9,
    "lapan": 8,
    "tujuh": 7,
    "enam": 6,
    "lima": 5,
    "empat": 4,
    "tiga": 3,
    "dua": 2,
    "satu": 1,
}
_MS_ORDINALS = {
    "pertama": 1,
    "kedua": 2,
    "ketiga": 3,
    "keempat": 4,
    "kelima": 5,
    "keenam": 6,
    "ketujuh": 7,
    "kelapan": 8,
    "kesembilan": 9,
    "kesepuluh": 10,
}
# Parts of the day, longest spelling first; the value is how the hour reads.
_MS_PERIODS = {
    "tengah malam": "midnight",
    "tgh malam": "midnight",
    "tengah hari": "midday",
    "tengahari": "midday",
    "tengah ari": "midday",
    "tgh hari": "midday",
    "tghari": "midday",
    "petang": "pm",
    "ptg": "pm",
    "malam": "night",
    "mlm": "night",
    "pagi": "am",
    "pg": "am",
    "subuh": "dawn",
}


def _alt(words: Any) -> str:
    return "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))


_MS_DAY_RE = _alt(_MS_DAYS)
_MS_PERIOD_RE = _alt(_MS_PERIODS)
_MS_NUM_RE = _alt(_MS_NUMBERS)
_MS_HINT = re.compile(
    r"\b(setiap|tiap|saban|pagi|petang|ptg|malam|mlm|tengah|tengahari|esok|besok|lusa|hari|"
    r"harian|jam|pukul|pkl|minit|minggu|mingguan|bulan|bulanan|tahun|tahunan|dalam|lagi|"
    r"depan|hadapan|hb|haribulan|pada|dan|sekali|bila|masa|nanti|ingatkan|tolong|"
    r"\d{1,2}(?:hb|pg|ptg|mlm|pagi|petang|malam)|" + _MS_DAY_RE + "|" + _alt(_MS_MONTHS) + r")\b"
)


def _ms_clock(h: int, mi: int, period: str, raw: str) -> str:
    """'9 pagi' -> 09:00, '3.30 petang' -> 15:30, '12 tengah malam' -> 00:00."""
    kind = _MS_PERIODS[period]
    if not 1 <= h <= 12 or mi > 59:
        raise Unclear(tr("'{raw}' is not a time of day. Say e.g. 9 pagi or 3.30 petang.", raw=raw))
    if kind == "am":
        if h == 12:
            raise Unclear(tr("Is 12 pagi midnight or noon? Say 12 tengah malam or 12 tengah hari."))
        hour = h
    elif kind == "dawn":
        if h > 7:
            raise Unclear(tr("'{raw}' is not a time of day. Say e.g. 6 pagi.", raw=raw))
        hour = h
    elif kind == "midday":
        if h not in (11, 12, 1, 2, 3):
            raise Unclear(tr("'{raw}': is that {h} pagi or {h} petang?", raw=raw, h=h))
        hour = h if h >= 11 else h + 12
    elif kind == "pm":
        hour = 12 if h == 12 else h + 12
    elif kind == "night":
        if h == 12:
            hour = 0
        elif h >= 6:
            hour = h + 12
        else:
            raise Unclear(
                tr(
                    "Do you mean {hhmm} after midnight? Say {h} pagi (or {hhmm}) so the day is "
                    "clear.",
                    hhmm=f"{h:02d}:{mi:02d}",
                    h=h,
                )
            )
    else:  # midnight
        if h != 12:
            raise Unclear(
                tr("'{raw}': midnight is 12 tengah malam. Which time do you mean?", raw=raw)
            )
        hour = 0
    return f"{hour:02d}:{mi:02d}"


def _ms_numbers(t: str) -> str:
    """Number words next to a time or a unit ('pukul lapan malam', 'dua minggu sekali')."""
    unit = (
        r"(?=\s?(?:jam|minit|hari|minggu|bulan|tahun|setengah|suku|sekali|hb|"
        + _MS_PERIOD_RE
        + r")\b)"
    )
    t = re.sub(rf"\b({_MS_NUM_RE})\b{unit}", lambda m: str(_MS_NUMBERS[m.group(1)]), t)
    return re.sub(
        rf"\b(jam|pukul|pkl|setiap|tiap|dalam|lagi) ({_MS_NUM_RE})\b",
        lambda m: f"{m.group(1)} {_MS_NUMBERS[m.group(2)]}",
        t,
    )


def _ms_dates(t: str) -> str:
    """Malaysian day-first dates: 5/10, 5/10/2026, 5.10.2026, 5-10-2026 -> 5 oct (2026)."""

    def rep(m: re.Match[str]) -> str:
        d, mo, year = int(m.group(1)), int(m.group(2)), m.group(3)
        if not (1 <= d <= 31 and 1 <= mo <= 12):
            raise Unclear(
                tr(
                    "'{raw}' is not a real date (day/month). Which day do you mean?",
                    raw=m.group(0),
                )
            )
        if year and len(year) == 2:
            year = f"20{year}"
        return f"{d} {_month_name(mo)[:3].lower()}" + (f" {year}" if year else "")

    t = re.sub(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?\b", rep, t)
    return re.sub(r"\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})\b", rep, t)


def _ms_times(t: str) -> str:
    """Clock times written the Malay way, to 24-hour HH:MM."""
    # "9 setengah" is 9:30, "3 suku" 3:15 (but "2 setengah jam" is a length of time).
    t = re.sub(r"\b(\d{1,2}) ?(?:setengah|stgh)\b(?! ?(?:jam|minit))", r"\1:30", t)
    t = re.sub(r"\b(\d{1,2}) ?suku\b(?! ?(?:jam|minit))", r"\1:15", t)
    # "jam 9 pagi", "pukul 3.30 petang", "8mlm", "12 tengah hari"
    t = re.sub(
        rf"\b(?:(?:jam|pukul|pkl)\s*)?(\d{{1,2}})(?:[:.](\d{{2}}))?\s*({_MS_PERIOD_RE})\b",
        lambda m: _ms_clock(int(m.group(1)), int(m.group(2) or 0), m.group(3), m.group(0)),
        t,
    )
    # "pagi jam 8", "malam ni pukul 9"
    t = re.sub(
        rf"\b({_MS_PERIOD_RE})((?: (?:ini|ni|nanti|esok))?) (?:jam|pukul|pkl)\s*(\d{{1,2}})"
        r"(?:[:.](\d{2}))?\b(?![:.]\d|\s*(?:am|pm)\b)",
        lambda m: (
            f"{m.group(1)}{m.group(2)} "
            + _ms_clock(int(m.group(3)), int(m.group(4) or 0), m.group(1), m.group(0))
        ),
        t,
    )
    t = re.sub(r"\btengah ?hari\b|\btgh ?hari\b|\btengah ari\b", "noon", t)
    return re.sub(r"\b(?:tengah|tgh) malam\b", "midnight", t)


def _ms_clock_only(t: str) -> str:
    """'jam 9.30' / 'pukul 14:00' (no pagi or petang) -> a time; 'jam 9' -> 'at 9', which
    asks morning or evening like the English 'at 9'."""

    def rep(m: re.Match[str]) -> str:
        raw_h, mi = m.group(1), m.group(2)
        h = int(raw_h)
        if 1 <= h <= 6 and not raw_h.startswith("0"):
            raise Unclear(
                tr(
                    "Is '{raw}' in the morning or in the afternoon? Say {hm} pagi or {hm} petang "
                    "(or {am} / {pm}).",
                    raw=m.group(0),
                    hm=f"{h}.{mi}",
                    am=f"{h:02d}:{mi}",
                    pm=f"{h + 12}:{mi}",
                )
            )
        return f"at {h:02d}:{mi}"

    def bare(m: re.Match[str]) -> str:
        h = int(m.group(1))
        if h == 12:
            raise Unclear(tr("Is that 12 noon or midnight? Say 12 tengah hari or 12 tengah malam."))
        if 1 <= h <= 11:
            raise Unclear(
                tr(
                    "Is that {h} in the morning or in the evening? Say {h} pagi, {h} petang or "
                    "{h} malam (or {am} / {pm}).",
                    h=h,
                    am=f"{h:02d}:00",
                    pm=f"{h + 12:02d}:00",
                )
            )
        return f"at {m.group(1)}"

    t = re.sub(r"\b(?:jam|pukul|pkl)\s*(\d{1,2})[:.]([0-5]\d)\b", rep, t)
    t = re.sub(r"\b(?:jam|pukul|pkl)\s*(\d{1,2})\b(?![:.]\d)", bare, t)
    return re.sub(r"\b(?:pukul|pkl)\b", "", t)


def _malay(t: str) -> tuple[str, bool]:
    """Malay schedule words -> the English this parser reads. Returns (text, was it Malay)."""
    if not _MS_HINT.search(t):
        return t, False
    s = t
    s = re.sub(r"\btiap-tiap\b|\btiap2\b", "setiap", s)
    s = re.sub(r"\bhari-hari\b|\bhari2\b", "setiap hari", s)
    s = re.sub(r"\bke-(\d{1,2})\b", r"ke \1", s)
    s = re.sub(r"\bsetiap setiap\b", "setiap", s)
    s = _ms_numbers(s)
    s = _ms_dates(s)
    # lengths of time before clock times: "setiap 3 jam", "dalam 2 jam", "2 jam lagi"
    s = re.sub(
        r"\b(setiap|tiap|saban|every|each|dalam|in|lagi|selama) (\d{1,3}) jam\b", r"\1 \2 hours", s
    )
    s = re.sub(r"\b(\d{1,3}) jam (lagi|sekali)\b", r"\1 hours \2", s)
    s = re.sub(
        r"\b(setiap|tiap|saban|dalam|lagi) (?:setengah|stgh|separuh) jam\b", r"\1 half an hour", s
    )
    s = re.sub(r"\b(setiap|tiap|saban|dalam|lagi) suku jam\b", r"\1 15 minutes", s)
    s = re.sub(r"\bsetengah jam (lagi|sekali)\b", r"half an hour \1", s)
    s = _ms_times(s)
    # the day of the month: 1hb, 15 haribulan, hari pertama, hari ke-15
    s = re.sub(r"\b(\d{1,2}) ?(?:hb|haribulan|hari bulan)\b", r"\1th", s)
    s = re.sub(
        r"\bhari (" + _alt(_MS_ORDINALS) + r")\b", lambda m: f"{_MS_ORDINALS[m.group(1)]}th", s
    )
    s = re.sub(r"\bhari ke ?(\d{1,2})\b", r"\1th", s)
    # which days
    s = re.sub(r"\bhari (?:bekerja|kerja) (?:yang )?terakhir\b", "last working day", s)
    s = re.sub(r"\bhari (?:yang )?terakhir\b", "last day", s)
    s = re.sub(r"\b(?:hari (?:bekerja|kerja|minggu bekerja)|hari waktu bekerja)\b", "weekdays", s)
    s = re.sub(r"\bhujung minggu\b", "weekends", s)
    s = re.sub(r"\bhari minggu\b", "sunday", s)  # Malaysians call Sunday "hari Minggu" too
    s = re.sub(r"\bhari (?=(?:" + _MS_DAY_RE + "|" + _DAY_RE + r")\b)", "", s)
    s = re.sub(r"\b(" + _MS_DAY_RE + r")(?![\w'])", lambda m: _MS_DAYS[m.group(1)], s)
    s = re.sub(r"\b(?:hari ini|hari ni|harini)\b", "today", s)
    # next ...: "Isnin depan", "Isnin minggu depan", "minggu depan hari Isnin"
    s = re.sub(rf"\b({_DAY_RE}) (?:minggu )?(?:depan|hadapan|akan datang)\b", r"next \1", s)
    s = re.sub(rf"\bminggu (?:depan|hadapan) ({_DAY_RE})\b", r"next \1", s)
    s = re.sub(r"\bminggu (?:depan|hadapan)\b", "next week", s)
    s = re.sub(r"\bbulan (?:depan|hadapan)\b", "next month", s)
    s = re.sub(rf"\b({_DAY_RE}) (?:ini|ni)\b", r"\1", s)
    # one-offs
    s = re.sub(r"\blusa\b", "day after tomorrow", s)
    s = re.sub(r"\b(?:esok|besok|esk)\b", "tomorrow", s)
    s = re.sub(r"\bmalam (?:ini|ni|nanti)\b", "tonight", s)
    s = re.sub(r"\bpagi (?:ini|ni)\b", "this morning", s)
    s = re.sub(r"\bpetang (?:ini|ni|nanti)\b", "this evening", s)
    s = re.sub(r"\b(noon|midnight) (?:ini|ni)\b", r"\1 today", s)
    # how often
    s = re.sub(r"\bsejam sekali\b", "hourly", s)
    s = re.sub(r"\bsehari sekali\b", "daily", s)
    s = re.sub(r"\b(?:seminggu|1 minggu) sekali\b", "weekly", s)
    s = re.sub(r"\b(?:sebulan|1 bulan) sekali\b", "monthly", s)
    s = re.sub(r"\b(?:setahun|1 tahun) sekali\b", "yearly", s)
    s = re.sub(r"\bselang (?:se|1 )?(hari|minggu|bulan)\b", r"every other \1", s)
    s = re.sub(r"\bminit\b", "minutes", s)
    s = re.sub(r"\b(\d{1,3}) hari\b", r"\1 days", s)
    s = re.sub(r"\b(\d{1,3}) minggu\b", r"\1 weeks", s)
    s = re.sub(r"\b(\d{1,3}) bulan\b", r"\1 months", s)
    s = re.sub(r"\b(\d{1,3}) (hours|minutes|days|weeks|months) sekali\b", r"every \1 \2", s)
    s = re.sub(r"\b(?:setengah|stgh|separuh) jam sekali\b", "every half an hour", s)
    s = re.sub(r"\b(\d{1,3} (?:hours|minutes|days)|half an hour) lagi\b", r"in \1", s)
    s = re.sub(r"\blagi (\d{1,3} (?:hours|minutes|days)|half an hour)\b", r"in \1", s)
    s = re.sub(r"\bdalam(?: masa)? (?=\d|half\b)", "in ", s)
    s = re.sub(r"\b(?:dalam|in) sejam\b", "in an hour", s)
    s = re.sub(r"\b(setiap|tiap|saban) sejam\b", "every hour", s)
    s = re.sub(r"\b(?:setiap|tiap|saban) jam\b(?!\s*\d)", "every hour", s)
    s = re.sub(r"\bharian\b", "daily", s)
    s = re.sub(r"\bmingguan\b", "weekly", s)
    s = re.sub(r"\bbulanan\b", "monthly", s)
    s = re.sub(r"\btahunan\b", "yearly", s)
    s = re.sub(r"\b(?:setiap|tiap|saban)\b", "every", s)
    s = re.sub(r"\bhari\b", "day", s)
    s = re.sub(r"\bminggu\b", "week", s)
    s = re.sub(r"\bbulan\b", "month", s)
    s = re.sub(r"\btahun\b", "year", s)
    s = re.sub(r"\bpagi\b", "morning", s)
    s = re.sub(r"\b(?:petang|ptg)\b", "evening", s)
    s = re.sub(r"\b(?:malam|mlm)\b", "night", s)
    # dates and joining words
    s = re.sub(
        rf"\b(\d{{1,2}}(?:st|nd|rd|th)?(?: of)?) ({_alt(_MS_MONTHS)})\b",
        lambda m: f"{m.group(1)} {_MS_MONTHS[m.group(2)]}",
        s,
    )
    s = re.sub(
        rf"\b({_alt(_MS_MONTHS)}) (\d)", lambda m: f"{_MS_MONTHS[m.group(1)]} {m.group(2)}", s
    )
    s = re.sub(r"\bdan\b", "and", s)
    s = re.sub(r"\bantara\b", "between", s)
    s = re.sub(r"\b(?:dari|daripada|mulai)\b", "from", s)
    s = re.sub(r"\b(?:hingga|sehingga|sampai)\b", "until", s)
    s = re.sub(r"\bpada\b", "on", s)
    s = _ms_clock_only(s)
    # "setiap 1hb jam 9 pagi": a day of the month that repeats is monthly
    if (
        re.search(r"\b\d{1,2}(?:hb|haribulan| haribulan| hb)\b", t)
        and re.search(r"\bevery\b", s)
        and not re.search(rf"\b(month|monthly|year|yearly|annually|{_MONTH_RE})\b", s)
    ):
        s += " every month"
    return " ".join(s.split()), True


def _english_extras(t: str) -> str:
    """Both languages: 'every 9am' means every day; 'Monday to Friday' is every day between."""
    t = re.sub(
        r"\bevery (?=(?:at |on )?(?:\d{1,2}[:.]\d{2}|\d{1,2} ?(?:am|pm)\b|noon\b|midnight\b"
        r"|at \d))",
        "every day ",
        t,
    )

    def days(m: re.Match[str]) -> str:
        a, b = _DAYS[m.group(1)], _DAYS[m.group(2)]
        span = [(a + i) % 7 for i in range((b - a) % 7 + 1)]
        return " ".join(_DAY_NAMES[d].lower() for d in span)

    return re.sub(rf"\b({_DAY_RE})s?\s*(?:-|to|through|thru|until|till)\s*({_DAY_RE})s?\b", days, t)


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
            raise Unclear(
                tr("'{raw}' is not a time of day. Say e.g. 9am or 4:30pm.", raw=m.group(0))
            )
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
                tr(
                    "Is that {h} in the morning or in the evening? Say {h}am or {h}pm "
                    "(or {am} / {pm}).",
                    h=h,
                    am=f"{h:02d}:00",
                    pm=f"{(h % 12) + 12:02d}:00",
                )
            )
    return [hm for _, hm in sorted(found)]


def _hhmm(hm: tuple[int, int]) -> str:
    return f"{hm[0]:02d}:{hm[1]:02d}"


def _one_time(t: str, once: bool) -> tuple[int, int]:
    times = _times(t)
    if not times:
        if once:
            raise Unclear(tr("At what time on that day? Say e.g. 9am or 16:30."))
        raise Unclear(tr("At what time should it run? Say e.g. 9am or 16:30."))
    if len(set(times)) > 1:
        raise Unclear(
            tr(
                "That has more than one time ({times}). Which one? (For several, set up one "
                "schedule each.)",
                times=", ".join(_hhmm(x) for x in times),
            )
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
                tr(
                    "Is {raw} the {a} {month_b} or the {b} {month_a}? Write the month as a word, "
                    "e.g. '10 Oct'.",
                    raw=m.group(0),
                    a=a,
                    b=b,
                    month_a=_month_name(a),
                    month_b=_month_name(b),
                )
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
        raise Unclear(tr("'{raw}' is not a real date. Which day do you mean?", raw=raw)) from e


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
    parts: list[str] = []
    i = 0
    while i < len(cron):
        j = i
        while j + 1 < len(cron) and cron[j + 1] == cron[j] + 1:
            j += 1
        if j - i >= 2:  # three or more in a row: Mon-Thu is 1-4
            parts.append(f"{cron[i]}-{cron[j]}")
        else:
            parts.extend(str(d) for d in cron[i : j + 1])
        i = j + 1
    return ",".join(parts)


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
        raise Unclear(tr("When should it run? {examples}.", examples=_examples(False)))
    fields = raw.split(" ")
    if len(fields) == 5 and all(_CRON_FIELD.match(f) for f in fields):
        first = next_runs(raw, tz, 1, after=local_now)[0]
        _check_gap(raw, tz, local_now)
        return When(raw, False, f"on the cron line {raw}", first)

    t, malay = _malay(_clean(raw))
    t = _english_extras(t)
    if re.search(r"\b(except|excluding|apart from|other than|kecuali|selain)\b", t):
        raise Unclear(
            tr(
                "Name the days it should run instead, e.g. 'every Monday to Thursday at 9am' "
                "(or 'setiap Isnin hingga Khamis 9 pagi')."
            )
        )
    if re.search(r"\b(every other|every second|fortnightly|biweekly|bi-weekly)\b", t) or re.search(
        r"\bevery \d+ (weeks|months|days)\b", t
    ):
        raise Unclear(
            tr(
                "A schedule can't skip weeks or days. Shall it run every week on that day, or "
                "on fixed dates such as the 1st and 15th of the month?"
            )
        )
    if re.search(r"\blast (day|working day|weekday)\b", t):
        raise Unclear(tr("'The last day of the month' isn't possible. The 28th, or the 1st?"))

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
            raise Unclear(tr("How long from now? Between a minute and a year."))
        at = (local_now + delta).replace(second=0, microsecond=0)
        if at <= local_now:
            at += timedelta(minutes=1)
        return _once(at, local_now, tz)

    if _RECURRING.search(t):
        return _recurring(t, tz, local_now, malay)
    return _one_off(t, tz, local_now, malay)


def _recurring(t: str, tz: str, now: datetime, malay: bool = False) -> When:
    every_n = re.search(r"\bevery (\d+|half an?) ?(minutes?|mins?|hours?|hrs?)\b", t)
    if every_n or re.search(r"\b(hourly|every hour)\b", t):
        if every_n:
            n_raw = every_n.group(1)
            unit_min = every_n.group(2).startswith("min")
            minutes = 30 if n_raw.startswith("half") else int(n_raw) * (1 if unit_min else 60)
        else:
            minutes = 60
        if minutes < MIN_GAP_MINUTES:
            raise ScheduleError(tr("Run at most every {n} minutes.", n=MIN_GAP_MINUTES))
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
                raise Unclear(tr("Between which times? Say e.g. 'between 9am and 5pm'."))
            if start[0][1] or end[0][1] or end[0][0] <= start[0][0]:
                raise Unclear(
                    tr("Use whole hours for the window, start before end, e.g. 9am to 5pm.")
                )
            hours = f"{start[0][0]}-{end[0][0]}"
            label_window = f" from {_hhmm(start[0])} to {_hhmm(end[0])}"
        if minutes < 60:
            if 60 % minutes:
                raise Unclear(
                    tr(
                        "Every {n} minutes doesn't fit evenly into an hour. 15, 20 or 30 "
                        "minutes, or every hour?",
                        n=minutes,
                    )
                )
            cron = f"*/{minutes} {hours} * * {dow}"
            label = f"every {minutes} minutes"
        else:
            if minutes % 60 or 24 % (minutes // 60):
                raise Unclear(
                    tr(
                        "That interval doesn't fit evenly into a day. Every 1, 2, 3, 4, 6, 8 or "
                        "12 hours?"
                    )
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
        if malay:
            raise Unclear(tr("At what time should it run? Say e.g. 9 pagi or 4.30 petang."))
        raise Unclear(tr("At what time should it run? Say e.g. 9am or 16:30."))
    when = times[0]
    minute, hour = when[1], str(when[0])
    at_label = _hhmm(when)
    if len(times) > 1 and re.search(r"\b(monthly|month|yearly|annually|year)\b", t):
        when = _one_time(t, False)  # asks which one

    if re.search(r"\b(monthly|every month|each month|of (every|each|the) month)\b", t):
        dom = sorted(
            {
                int(m.group(1))
                for m in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)\b", t)
                if 1 <= int(m.group(1)) <= 31
            }
        )
        if not dom:
            raise Unclear(tr("Which day of the month? e.g. 'every month on the 1st at 9am'."))
        if any(d > 28 for d in dom):
            raise Unclear(
                tr(
                    "Some months have no 29th, 30th or 31st, so it would skip them. The 28th or "
                    "the 1st instead?"
                )
            )
        cron = f"{minute} {hour} {','.join(map(str, dom))} * *"
        label = f"every month on the {' and '.join(_ordinal(d) for d in dom)} at {at_label}"
        return _done(cron, False, label, tz, now)

    if re.search(r"\b(yearly|annually|every year|each year)\b", t):
        day = _date(t, now.date())
        if day is None:
            raise Unclear(tr("Which date each year? e.g. 'every year on 1 Jan at 9am'."))
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
            raise Unclear(tr("Which day of the week? e.g. 'every Monday at 9am'."))
        if not re.search(r"\b(daily|(every|each) (day|morning|evening|night))\b", t):
            raise Unclear(tr("How often? {examples}.", examples=_examples(malay)))
    if len(times) > 1:
        if len({m for _, m in times}) > 1:
            raise Unclear(
                tr("Those times have different minutes. Set up one schedule for each time.")
            )
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


def _one_off(t: str, tz: str, now: datetime, malay: bool = False) -> When:
    today = now.date()
    day: date | None = None
    by_name = False  # "Friday 4pm": a weekday name, so a time already gone means next week's
    if re.search(r"\b(today|tonight|this (morning|afternoon|evening))\b", t):
        day = today
    elif re.search(r"\bday after (tomorrow|tmrw|tmr)\b", t):
        day = today + timedelta(days=2)
    elif re.search(r"\b(tomorrow|tmrw|tmr)\b", t):
        day = today + timedelta(days=1)
    else:
        day = _date(t, today)
        if day is None:
            names = _weekday_list(t)
            if len(names) > 1:
                raise Unclear(
                    tr(
                        "That names several days. For a repeat, say 'every Monday and Friday'; "
                        "for once, pick one day."
                    )
                )
            if names:
                ahead = (names[0] - today.weekday()) % 7
                day = today + timedelta(days=ahead)
                by_name = True
                if re.search(rf"\bnext {_DAY_RE}\b", t) and ahead == 0:
                    day += timedelta(days=7)
            elif nxt := re.search(r"\bnext (week|month)\b", t):
                if nxt.group(1) == "month":
                    raise Unclear(tr("Which day next month, and at what time?"))
                raise Unclear(tr("Which day next week, and at what time?"))
    if day is None:
        if _times(t):
            raise Unclear(
                tr(
                    "Once (today or tomorrow?) or every day at that time? Say e.g. 'tomorrow "
                    "at 9am' or 'every day at 9am'."
                )
            )
        raise Unclear(tr("I could not tell when. {examples}.", examples=_examples(malay)))
    hm = _one_time(t, True)
    at = datetime(day.year, day.month, day.day, hm[0], hm[1], tzinfo=now.tzinfo)
    if at <= now:
        if day == today and by_name and not re.search(r"\b(today|tonight|this)\b", t):
            at += timedelta(days=7)  # "Friday 4pm" said on Friday at 5pm: next week's Friday
        else:
            raise Unclear(
                tr("{when} has already passed. Did you mean another day?", when=_stamp(at))
            )
    return _once(at, now, tz)


def _once(at: datetime, now: datetime, tz: str) -> When:
    if at - now > timedelta(days=365):
        raise Unclear(tr("That is more than a year away. Which date do you mean?"))
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
            raise ScheduleError(tr("Run at most every {n} minutes.", n=MIN_GAP_MINUTES))


# ---------------------------------------------------------------- the summary in Malay

_SUM_DAYS = dict(
    zip(_DAY_NAMES, ("Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu", "Ahad"), strict=True)
)
_SUM_DAYS_SHORT = {
    "Mon": "Isn",
    "Tue": "Sel",
    "Wed": "Rab",
    "Thu": "Kha",
    "Fri": "Jum",
    "Sat": "Sab",
    "Sun": "Ahd",
}
_SUM_MONTHS = {
    "Jan": "Jan",
    "Feb": "Feb",
    "Mar": "Mac",
    "Apr": "Apr",
    "May": "Mei",
    "Jun": "Jun",
    "Jul": "Jul",
    "Aug": "Ogo",
    "Sep": "Sep",
    "Oct": "Okt",
    "Nov": "Nov",
    "Dec": "Dis",
}


def summary_in(summary: str, lang: str | None) -> str:
    """The summary a When carries ("every Monday at 09:00") in the person's language. The
    English stays the stored and logged form; this only changes what a person reads."""
    if lang != "ms":
        return summary
    s = summary
    s = re.sub(
        r"\bonce on (\w{3}) (\d{1,2}) (\w{3}) (\d{4}) at ",
        lambda m: (
            f"sekali pada {_SUM_DAYS_SHORT.get(m[1], m[1])} {m[2]} "
            f"{_SUM_MONTHS.get(m[3], m[3])} {m[4]} jam "
        ),
        s,
    )
    s = re.sub(
        r"\bevery year on (\d{1,2}) (\w{3}) at ",
        lambda m: f"setiap tahun pada {m[1]} {_SUM_MONTHS.get(m[2], m[2])} jam ",
        s,
    )
    s = re.sub(
        r"\bevery month on the ([\w ]+?) at ",
        lambda m: (
            "setiap bulan pada "
            + re.sub(r"(\d+)(?:st|nd|rd|th)", r"\1hb", m[1]).replace(" and ", " dan ")
            + " jam "
        ),
        s,
    )
    s = re.sub(r"\bevery (\d+) minutes\b", r"setiap \1 minit", s)
    s = re.sub(r"\bevery (\d+) hours\b", r"setiap \1 jam", s)
    s = s.replace("every hour", "setiap jam")
    s = s.replace(" on weekdays", " pada hari bekerja").replace(
        " on weekends", " pada hujung minggu"
    )
    s = s.replace("every weekday at ", "setiap hari bekerja jam ")
    s = s.replace("every Saturday and Sunday at ", "setiap Sabtu dan Ahad jam ")
    s = s.replace("every day at ", "setiap hari jam ")
    s = re.sub(r"\bevery ([A-Z][\w, ]*?) at ", lambda m: "setiap " + m[1] + " jam ", s)
    s = re.sub(r" on ((?:[A-Z]\w+days?(?:, | and )?)+)", lambda m: " pada " + m[1], s)
    s = re.sub(r" from (\d\d:\d\d) to (\d\d:\d\d)", r" dari \1 hingga \2", s)
    for en, ms in _SUM_DAYS.items():
        s = re.sub(rf"\b{en}s?\b", ms, s)
    return s.replace(" and ", " dan ")
