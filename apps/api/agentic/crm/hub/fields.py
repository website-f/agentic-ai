"""P50 CRM field types: what each holds, how a value from a person (or another system) is
checked and stored, how it reads as text, and how a type is guessed from sample values.

Stored values (CrmRecord.data[key]) are plain JSON: text as str, number/money/percent/rating
as float, date as "YYYY-MM-DD", datetime as ISO with zone, checkbox as bool, select as one
choice value, multi_select as a list of choice values, person as a user id, relation as a
list of record ids ("<object key>:<id>" for built-in ones), file as a list of file ids, auto
as an int given by the CRM.
"""

import re
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from ...i18n import Msg

TYPES = (
    "text", "long_text", "number", "money", "percent", "date", "datetime", "checkbox",
    "select", "multi_select", "email", "phone", "url", "rating", "person", "relation", "file",
    "auto",
)  # fmt: skip
NUMERIC = ("number", "money", "percent", "rating", "auto")
MAX_TEXT = 500
MAX_LONG = 20_000
MAX_CHOICES = 60
CHOICE_COLORS = ("gray", "green", "blue", "amber", "red", "violet", "pink", "teal", "orange")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL = re.compile(r"^https?://[^\s]{3,}$", re.I)
PHONE = re.compile(r"^[+()\d][\d\s()+\-./]{4,30}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_DT = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")


class FieldError(ValueError):
    """A value that does not fit its field; the message is for a person."""


def slug(text: str, fallback: str = "field") -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:50]
    if not s or not s[0].isalpha():
        s = f"{fallback}_{s}" if s else fallback
    return s[:60]


def clean_choices(raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for i, c in enumerate(raw or []):
        if isinstance(c, str):
            c = {"label": c}
        if not isinstance(c, dict):
            continue
        label = str(c.get("label") or c.get("value") or "").strip()[:60]
        if not label:
            continue
        value = str(c.get("value") or label).strip()[:60]
        if value.lower() in seen:
            continue
        seen.add(value.lower())
        color = (
            c.get("color")
            if c.get("color") in CHOICE_COLORS
            else CHOICE_COLORS[i % len(CHOICE_COLORS)]
        )
        out.append({"value": value, "label": label, "color": str(color)})
        if len(out) >= MAX_CHOICES:
            break
    return out


def _number(v: Any) -> float:
    if isinstance(v, bool):
        raise FieldError("Use a number.")
    if isinstance(v, int | float):
        return float(v)
    s = re.sub(r"[^\d.\-]", "", str(v).replace(",", ""))
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError) as e:
        raise FieldError("Use a number.") from e


def _date(v: Any) -> str:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    if ISO_DATE.match(s[:10]):
        try:
            return date.fromisoformat(s[:10]).isoformat()
        except ValueError:
            pass
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    raise FieldError("Use a date like 2026-10-27.")


def _datetime(v: Any) -> str:
    if isinstance(v, datetime):
        d = v
    else:
        s = str(v).strip().replace(" ", "T", 1)
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError as e:
            raise FieldError("Use a date and time like 2026-10-27 14:30.") from e
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.isoformat()


def coerce(ftype: str, options: dict[str, Any], v: Any) -> Any:
    """The value to store, or None for empty. Raises FieldError when it does not fit."""
    if v is None or v == "" or v == []:
        return None
    if ftype in ("text", "phone"):
        s = " ".join(str(v).split())[:MAX_TEXT]
        if ftype == "phone" and not PHONE.match(s):
            raise FieldError("Use a phone number, like +60 12-345 6789.")
        return s
    if ftype == "long_text":
        return str(v)[:MAX_LONG]
    if ftype == "email":
        s = str(v).strip().lower()[:254]
        if not EMAIL.match(s):
            raise FieldError("Use an email address.")
        return s
    if ftype == "url":
        s = str(v).strip()[:1000]
        if not URL.match(s):
            s = f"https://{s}" if "." in s and " " not in s else s
        if not URL.match(s):
            raise FieldError("Use a web address, like https://example.com.")
        return s
    if ftype in ("number", "money", "percent"):
        return round(_number(v), 4)
    if ftype == "rating":
        top = int(options.get("max") or 5)
        n = int(round(_number(v)))
        if not 0 <= n <= top:
            raise FieldError(Msg("Use 0 to {top}.", top=top))
        return n
    if ftype == "date":
        return _date(v)
    if ftype == "datetime":
        return _datetime(v)
    if ftype == "checkbox":
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in ("1", "true", "yes", "ya", "y", "on", "x", "✓")
    if ftype in ("select", "multi_select"):
        choices = {c["value"].lower(): c["value"] for c in options.get("choices") or []}
        choices.update({c["label"].lower(): c["value"] for c in options.get("choices") or []})
        items = (
            v if isinstance(v, list) else ([v] if ftype == "select" else re.split(r"[,;]", str(v)))
        )
        out = []
        for item in items:
            s = str(item).strip()
            if not s:
                continue
            if s.lower() not in choices:
                raise FieldError(Msg('"{value}" is not one of the choices.', value=s))
            out.append(choices[s.lower()])
        if ftype == "select":
            return out[0] if out else None
        return list(dict.fromkeys(out))
    if ftype in ("person",):
        return str(v)[:40]
    if ftype in ("relation", "file"):
        items = v if isinstance(v, list) else [v]
        return [str(x)[:120] for x in items if str(x).strip()][:100]
    if ftype == "auto":
        return int(_number(v))
    raise FieldError("Unknown field type.")


def as_text(ftype: str, options: dict[str, Any], v: Any) -> str:
    """How a value reads in a list, a title or a search."""
    if v is None:
        return ""
    if ftype == "checkbox":
        return "Yes" if v else "No"
    if ftype in ("select", "multi_select"):
        labels = {c["value"]: c["label"] for c in options.get("choices") or []}
        vals = v if isinstance(v, list) else [v]
        return ", ".join(labels.get(x, str(x)) for x in vals)
    if ftype == "money":
        return f"{options.get('currency') or 'RM'} {float(v):,.2f}"
    if ftype == "percent":
        return f"{float(v):g}%"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


# ---------------------------------------------------------------- guessing from samples


def mostly(test: Any, strs: list[str], share: float = 0.8) -> bool:
    return bool(strs) and sum(1 for s in strs if test(s)) >= max(1, share * len(strs))


def guess(values: list[Any], name: str = "") -> str:
    """The likely field type of a column, from up to a few hundred sample values."""
    seen = [v for v in values if v not in (None, "", [], {})][:300]
    n = name.lower()
    if not seen:
        return "text"
    if all(isinstance(v, bool) for v in seen):
        return "checkbox"
    if all(isinstance(v, list) for v in seen):
        return (
            "multi_select" if all(all(isinstance(x, str) for x in v) for v in seen) else "long_text"
        )
    strs = [str(v).strip() for v in seen]
    if all(isinstance(v, int | float) and not isinstance(v, bool) for v in seen) or all(
        re.fullmatch(r"-?\d+(\.\d+)?", s.replace(",", "")) for s in strs
    ):
        if any(
            w in n
            for w in (
                "price",
                "amount",
                "total",
                "value",
                "cost",
                "revenue",
                "rm",
                "harga",
                "jumlah",
            )
        ):
            return "money"
        if any(w in n for w in ("percent", "pct", "rate")):
            return "percent"
        return "number"
    # Real data is messy: a type wins when most values fit it (a stray bad cell is left
    # empty on import and reported, not allowed to turn the column into plain text).
    if mostly(lambda s: bool(EMAIL.match(s)), strs):
        return "email"
    if mostly(lambda s: bool(URL.match(s)), strs):
        return "url"
    if mostly(lambda s: bool(ISO_DT.match(s)), strs):
        return "datetime"
    if mostly(lambda s: bool(ISO_DATE.match(s)), strs):
        return "date"
    if all(s.lower() in ("true", "false", "yes", "no", "ya", "tidak", "0", "1") for s in strs):
        return "checkbox"
    if any(w in n for w in ("phone", "tel", "mobile", "hp", "whatsapp")) and all(
        PHONE.match(s) for s in strs
    ):
        return "phone"
    distinct = {s.lower() for s in strs}
    if (
        len(strs) >= 4
        and len(distinct) <= max(2, min(12, len(strs) // 3))
        and max(len(s) for s in strs) <= 40
    ):
        return "select"
    if max(len(s) for s in strs) > 200:
        return "long_text"
    return "text"


def flatten(
    obj: Any, prefix: str = "", depth: int = 0, out: dict[str, Any] | None = None
) -> dict[str, Any]:
    """{"a": {"b": 1}} -> {"a.b": 1}, three levels deep; lists of plain values stay lists."""
    out = {} if out is None else out
    if isinstance(obj, dict) and depth < 3:
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict):
                flatten(v, key, depth + 1, out)
            else:
                out[key] = v
    elif prefix:
        out[prefix] = obj
    return out


def at_path(obj: Any, path: str) -> Any:
    """obj["a"]["b"][0] for "a.b.0"; None when any step is missing."""
    cur = obj
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur
