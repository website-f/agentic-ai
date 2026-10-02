"""Checks a document must pass before people see it as ready: no gaps, no leftover drafting
marks, totals that add up, the company's own details right, dates in order. Deterministic,
instant and free; the optional AI review (documents router) adds judgement on top."""

import re
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any

from .blocks import parse, plain
from .fill import CORE_KIT, KIT_LABELS, Filled, number

_LEFTOVER = re.compile(r"\b(TODO|TBD|TBC|XXX+|lorem ipsum)\b|\[insert[^\]]*\]|<insert[^>]*>", re.I)
# SSM: the 12-digit format (201901012345) and the old one (1234567-X).
_REG_NEW = re.compile(r"\b(?:19|20)\d{10}\b")
_REG_OLD = re.compile(r"\b\d{5,7}-[A-Z]\b")
_TOTAL = re.compile(r"^(sub ?total|total|grand total|jumlah( besar)?)$", re.I)


@dataclass
class Issue:
    level: str  # error | warn
    text: str

    def dict(self) -> dict[str, str]:
        return asdict(self)


def _table_totals(md: str) -> list[Issue]:
    issues: list[Issue] = []
    for b in parse(md):
        if b.kind != "table" or not b.rows:
            continue
        head = [plain(h).lower() for h in b.header]
        amount_col = next(
            (i for i in range(len(head) - 1, -1, -1) if re.search(r"amount|jumlah|total", head[i])),
            None,
        )
        if amount_col is None:
            continue
        # Item rows have a first cell (No. / description); summary rows (subtotal, tax,
        # total) leave it blank and carry a label just before the amount.
        items = [r for r in b.rows if r and plain(r[0]).strip()]
        values = [number(plain(r[amount_col])) for r in items if amount_col < len(r)]
        if not values or any(v is None for v in values):
            continue
        expected = round(sum(v for v in values if v is not None), 2)
        summary: list[tuple[str, float]] = []
        for r in b.rows:
            if (r and plain(r[0]).strip()) or amount_col >= len(r):
                continue
            label = next(
                (plain(c).strip() for c in reversed(r[:amount_col]) if plain(c).strip()), ""
            )
            got = number(plain(r[amount_col]))
            if label and got is not None:
                summary.append((label, got))
        sub = next(((lab, v) for lab, v in summary if lab.lower().startswith("sub")), None)
        tot = next(
            (
                (lab, v)
                for lab, v in summary
                if _TOTAL.match(lab) and not lab.lower().startswith("sub")
            ),
            None,
        )
        extras = round(sum(v for lab, v in summary if (lab, v) not in (sub, tot)), 2)
        if sub and abs(sub[1] - expected) > 0.01:
            issues.append(
                Issue(
                    "error",
                    f"{sub[0]} shows {sub[1]:,.2f} but the amounts above add up to "
                    f"{expected:,.2f}.",
                )
            )
        if tot:
            want = round((sub[1] if sub else expected) + extras, 2)
            if abs(tot[1] - want) > 0.01:
                issues.append(
                    Issue("error", f"{tot[0]} shows {tot[1]:,.2f} but should be {want:,.2f}.")
                )
    return issues


def run(
    filled: Filled,
    *,
    body: str,
    fields: list[dict[str, Any]],
    values: dict[str, Any],
    kit: dict[str, Any],
    today: date,
) -> list[dict[str, str]]:
    issues: list[Issue] = []
    text = filled.markdown
    if not plain(text).strip():
        return [Issue("error", "The document is empty.").dict()]

    for lab in filled.missing[:12]:
        issues.append(Issue("error", f"No value for {lab}."))
    for f in fields:
        v = values.get(f.get("key", ""))
        empty = v in (None, "", []) or (isinstance(v, str) and not v.strip())
        lab = str(f.get("label") or f.get("key"))
        if f.get("required") and empty and lab not in filled.missing:
            issues.append(Issue("error", f"{lab} is required."))

    for m in list(_LEFTOVER.finditer(text))[:5]:
        issues.append(Issue("warn", f'Drafting mark left in the text: "{m.group(0)}".'))

    issues.extend(_table_totals(text))

    for k in CORE_KIT:
        if not str(kit.get(k) or "").strip():
            issues.append(Issue("warn", f"The company kit has no {KIT_LABELS[k].lower()} yet."))
    reg = re.sub(r"\s", "", str(kit.get("reg_no") or ""))
    if reg:
        for pat in (_REG_NEW, _REG_OLD):
            for m in pat.finditer(text):
                if m.group(0) not in reg:
                    issues.append(
                        Issue(
                            "warn",
                            f"Registration number {m.group(0)} does not match the company "
                            f"kit ({kit.get('reg_no')}).",
                        )
                    )
                    break

    doc_day = _date(values.get("date")) or today
    for f in fields:
        if f.get("type") != "date":
            continue
        d = _date(values.get(f.get("key", "")))
        key = str(f.get("key", "")).lower()
        if d and any(w in key for w in ("due", "valid", "expir", "deadline")) and d < doc_day:
            issues.append(
                Issue(
                    "warn", f"{f.get('label') or key} ({d:%d %b %Y}) is before the document date."
                )
            )

    seen: set[str] = set()
    out = []
    for i in issues:
        if i.text not in seen:
            seen.add(i.text)
            out.append(i.dict())
    return out


def _date(v: Any) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v or "").strip()[:10])
    except ValueError:
        return None
