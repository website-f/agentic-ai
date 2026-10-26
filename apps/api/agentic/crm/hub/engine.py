"""P50 the CRM's records: read, filter, sort, sum up and save, the same way for every object
(custom, built-in from the office's own data, synced from another system).

Rows are read whole (at most ROW_CAP per object) and filtered in Python: a small business's
CRM fits easily, and every field type filters the same way whatever stores it.

Who sees what: the CRM is the workspace owner's. A CrmAccess grant lets one person see (view)
or also change (edit) one object, minus the fields it hides; a grant with no object lets them
see the dashboard (only tiles over objects they may see).
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...i18n import lookup
from ...models import CrmAccess, CrmField, CrmObject, CrmRecord
from . import builtins
from .fields import NUMERIC, FieldError, as_text, coerce

ROW_CAP = 5000
OPS = (
    "is", "is_not", "contains", "not_contains", "gt", "gte", "lt", "lte", "empty", "not_empty",
    "any_of", "this_week", "this_month", "last_30_days", "past", "future",
)  # fmt: skip


class CrmError(Exception):
    def __init__(self, status: int, code: str, message: str, **vars: Any) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.vars = status, code, message, vars


# ---------------------------------------------------------------- who sees what


@dataclass
class Access:
    owner: bool
    grants: dict[str, tuple[str, list[str]]] = field(
        default_factory=dict
    )  # object id -> (level, hidden)
    dashboard: bool = False

    @property
    def any(self) -> bool:
        return self.owner or bool(self.grants) or self.dashboard

    def sees(self, obj: CrmObject) -> bool:
        return self.owner or obj.id in self.grants

    def edits(self, obj: CrmObject) -> bool:
        return self.owner or self.grants.get(obj.id, ("", []))[0] == "edit"

    def hidden(self, obj: CrmObject) -> set[str]:
        return set() if self.owner else set(self.grants.get(obj.id, ("", []))[1])


async def access_of(db: AsyncSession, workspace_id: str, user_id: str, role: str) -> Access:
    if role == "owner":
        return Access(owner=True, dashboard=True)
    a = Access(owner=False)
    for g in (
        await db.scalars(
            select(CrmAccess).where(
                CrmAccess.workspace_id == workspace_id, CrmAccess.user_id == user_id
            )
        )
    ).all():
        if g.object_id is None:
            a.dashboard = True
        else:
            a.grants[g.object_id] = (g.level, list(g.hidden_fields or []))
    return a


# ---------------------------------------------------------------- objects and fields


async def fields_of(db: AsyncSession, obj: CrmObject) -> list[CrmField]:
    return list(
        (
            await db.scalars(
                select(CrmField)
                .where(CrmField.object_id == obj.id)
                .order_by(CrmField.position, CrmField.created_at)
            )
        ).all()
    )


async def ensure_builtin(db: AsyncSession, workspace_id: str, key: str, actor: str) -> CrmObject:
    """The CRM object for a built-in source, made (with its fields) the first time."""
    src = builtins.SOURCES.get(key)
    if src is None:
        raise CrmError(404, "source_not_found", "That is not something the office keeps.")
    obj = await db.scalar(
        select(CrmObject).where(CrmObject.workspace_id == workspace_id, CrmObject.source == key)
    )
    if obj is not None:
        if obj.archived:
            obj.archived = False
        return obj
    last = await db.scalar(
        select(func.max(CrmObject.position)).where(CrmObject.workspace_id == workspace_id)
    )
    obj = CrmObject(
        workspace_id=workspace_id,
        key=key,
        name=src.name,
        singular=src.singular,
        description=src.description,
        icon=src.icon,
        color=src.color,
        kind="builtin",
        source=key,
        title_field=src.title_field,
        position=(last or 0) + 1,
        meta={},
        created_by=actor,
    )
    db.add(obj)
    await db.flush()
    for i, (fkey, label, ftype, options) in enumerate(src.fields):
        db.add(
            CrmField(
                workspace_id=workspace_id,
                object_id=obj.id,
                key=fkey,
                label=label,
                type=ftype,
                options=options,
                builtin=True,
                position=i,
                created_by=actor,
            )
        )
    await db.flush()
    return obj


# ---------------------------------------------------------------- reading


def _title(obj: CrmObject, fields: dict[str, CrmField], data: dict[str, Any]) -> str:
    f = fields.get(obj.title_field)
    v = data.get(obj.title_field)
    return (as_text(f.type, f.options or {}, v) if f else str(v or ""))[:300]


def _row(
    obj: CrmObject, fields: dict[str, CrmField], rid: str, data: dict[str, Any], **extra: Any
) -> dict[str, Any]:
    return {"id": rid, "title": _title(obj, fields, data) or rid, "data": data, **extra}


async def all_rows(
    db: AsyncSession, obj: CrmObject, fields: list[CrmField]
) -> list[dict[str, Any]]:
    by_key = {f.key: f for f in fields}
    if obj.kind == "builtin" and obj.source in builtins.SOURCES:
        src = builtins.SOURCES[obj.source]
        base = await src.rows(db, obj.workspace_id)
        extra = {
            r.external_id: r
            for r in (
                await db.scalars(
                    select(CrmRecord).where(CrmRecord.object_id == obj.id).limit(ROW_CAP)
                )
            ).all()
        }
        out = []
        for b in base:
            rid = str(b.pop("id"))
            mine = extra.get(rid)
            data = {**b, **((mine.data or {}) if mine else {})}
            out.append(_row(obj, by_key, rid, data, link=src.link.format(id=rid), builtin=True))
        return out
    rows = (
        await db.scalars(
            select(CrmRecord)
            .where(CrmRecord.object_id == obj.id)
            .order_by(CrmRecord.updated_at.desc())
            .limit(ROW_CAP)
        )
    ).all()
    return [
        _row(
            obj,
            by_key,
            r.id,
            dict(r.data or {}),
            created_at=r.created_at.isoformat() if r.created_at else None,
            updated_at=r.updated_at.isoformat() if r.updated_at else None,
            external_id=r.external_id,
        )
        for r in rows
    ]


def _as_date(v: Any) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _match(f: CrmField | None, v: Any, op: str, want: Any, today: date) -> bool:
    ftype = f.type if f else "text"
    opts = f.options or {} if f else {}
    empty = v is None or v == "" or v == []
    if op == "empty":
        return empty
    if op == "not_empty":
        return not empty
    if ftype in ("date", "datetime") and op in (
        "this_week",
        "this_month",
        "last_30_days",
        "past",
        "future",
    ):
        d = _as_date(v)
        if d is None:
            return False
        if op == "this_week":
            start = today - timedelta(days=today.weekday())
            return start <= d < start + timedelta(days=7)
        if op == "this_month":
            return (d.year, d.month) == (today.year, today.month)
        if op == "last_30_days":
            return today - timedelta(days=30) <= d <= today
        return d < today if op == "past" else d >= today
    if op in ("gt", "gte", "lt", "lte"):
        if empty:
            return False
        if ftype in ("date", "datetime"):
            a, b = _as_date(v), _as_date(want)
        else:
            try:
                a, b = float(v), float(want)  # type: ignore[assignment]
            except (TypeError, ValueError):
                return False
        if a is None or b is None:
            return False
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]  # type: ignore[operator]
    if op == "any_of":
        wants = {str(x).lower() for x in (want if isinstance(want, list) else [want])}
        vals = {str(x).lower() for x in (v if isinstance(v, list) else [v])}
        return bool(wants & vals)
    text = as_text(ftype, opts, v).lower() if not empty else ""
    raw = (v if isinstance(v, list) else [v]) if not empty else []
    w = str(want if want is not None else "").strip().lower()
    hit_exact = w in {str(x).lower() for x in raw} or text == w
    if ftype == "checkbox":
        hit_exact = bool(v) == (w in ("1", "true", "yes", "ya"))
    if op == "is":
        return hit_exact
    if op == "is_not":
        return not hit_exact
    if op == "contains":
        return w in text
    if op == "not_contains":
        return w not in text
    return True


def apply(
    rows: list[dict[str, Any]],
    fields: list[CrmField],
    q: str = "",
    filters: list[dict[str, Any]] | None = None,
    sort: list[dict[str, Any]] | None = None,
    today: date | None = None,
) -> list[dict[str, Any]]:
    by_key = {f.key: f for f in fields}
    today = today or date.today()
    out = rows
    if q.strip():
        needle = q.strip().lower()

        def hay(r: dict[str, Any]) -> str:
            parts = [r["title"]]
            for k, v in r["data"].items():
                f = by_key.get(k)
                parts.append(as_text(f.type, f.options or {}, v) if f else str(v))
            return " ".join(parts).lower()

        out = [r for r in out if needle in hay(r)]
    for flt in filters or []:
        key, op = str(flt.get("field") or ""), str(flt.get("op") or "is")
        if op not in OPS:
            continue
        f = by_key.get(key)
        out = [r for r in out if _match(f, r["data"].get(key), op, flt.get("value"), today)]
    for s in reversed(sort or []):
        key, desc = str(s.get("field") or ""), s.get("dir") == "desc"
        f = by_key.get(key)
        numeric = f is not None and f.type in NUMERIC

        def sort_key(
            r: dict[str, Any], key: str = key, numeric: bool = numeric, f: CrmField | None = f
        ) -> tuple[int, Any]:
            v = r["data"].get(key) if key != "_title" else r["title"]
            if v is None or v == "":
                return (1, 0 if numeric else "")
            if numeric:
                try:
                    return (0, float(v))
                except (TypeError, ValueError):
                    return (1, 0)
            return (0, str(as_text(f.type, f.options or {}, v) if f else v).lower())

        empties = [r for r in out if sort_key(r)[0] == 1]
        full = sorted((r for r in out if sort_key(r)[0] == 0), key=sort_key, reverse=desc)
        out = full + empties  # empty values last, either way
    return out


def strip_hidden(rows: list[dict[str, Any]], hidden: set[str]) -> list[dict[str, Any]]:
    if not hidden:
        return rows
    return [{**r, "data": {k: v for k, v in r["data"].items() if k not in hidden}} for r in rows]


# ---------------------------------------------------------------- summing up (widgets)


def _period_key(v: Any, period: str) -> str | None:
    d = _as_date(v)
    if d is None:
        return None
    if period == "day":
        return d.isoformat()
    if period == "week":
        return (d - timedelta(days=d.weekday())).isoformat()
    if period == "year":
        return str(d.year)
    return f"{d.year}-{d.month:02d}"


def aggregate(
    rows: list[dict[str, Any]], fields: list[CrmField], config: dict[str, Any]
) -> dict[str, Any]:
    """A tile's numbers: one value, or groups [{key, label, value}]."""
    by_key = {f.key: f for f in fields}
    metric = config.get("metric") or "count"
    vkey = config.get("field") or ""

    def value(group: list[dict[str, Any]]) -> float:
        if metric == "count":
            return float(len(group))
        nums = []
        for r in group:
            try:
                nums.append(float(r["data"].get(vkey)))
            except (TypeError, ValueError):
                continue
        if not nums:
            return 0.0
        return round(sum(nums) if metric == "sum" else sum(nums) / len(nums), 2)

    rows = apply(rows, fields, filters=config.get("filters") or [])
    gkey = config.get("group_by") or ""
    date_field = config.get("date_field") or ""
    if date_field:
        period = config.get("period") or "month"
        groups: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            k = _period_key(r["data"].get(date_field), period)
            if k:
                groups.setdefault(k, []).append(r)
        keys = sorted(groups)[-int(config.get("last") or 12) :]
        return {
            "total": value(rows),
            "groups": [{"key": k, "label": k, "value": value(groups[k])} for k in keys],
        }
    if gkey:
        f = by_key.get(gkey)
        groups = {}
        for r in rows:
            v = r["data"].get(gkey)
            for item in v if isinstance(v, list) else [v]:
                groups.setdefault("" if item is None else str(item), []).append(r)
        labels = (
            {c["value"]: c["label"] for c in ((f.options or {}).get("choices") or [])} if f else {}
        )
        out = [
            {"key": k, "label": labels.get(k, k) or "(empty)", "value": value(g)}
            for k, g in groups.items()
        ]
        out.sort(key=lambda g: -g["value"])
        return {"total": value(rows), "groups": out[: int(config.get("top") or 12)]}
    return {"total": value(rows), "groups": []}


# ---------------------------------------------------------------- saving


async def save(
    db: AsyncSession,
    obj: CrmObject,
    fields: list[CrmField],
    values: dict[str, Any],
    actor: str,
    record: CrmRecord | None = None,
    *,
    external_id: str | None = None,
    partial: bool = False,
) -> CrmRecord:
    """Check every value against its field and store it. Built-in fields are never written
    here (the office's own pages change those). Raises CrmError(422) with the field's name."""
    by_key = {f.key: f for f in fields if not f.builtin}
    data = dict(record.data or {}) if record is not None else {}
    problems: dict[str, str] = {}
    for key, raw in values.items():
        f = by_key.get(key)
        if f is None or f.type == "auto":
            continue
        try:
            v = coerce(f.type, f.options or {}, raw)
        except FieldError as e:
            problems[key] = str(e)
            continue
        if v is None:
            data.pop(key, None)
        else:
            data[key] = v
    if not partial:
        for f in by_key.values():
            if f.required and f.type != "auto" and data.get(f.key) in (None, "", []):
                problems.setdefault(f.key, "This is needed.")
    if problems:
        key, why = next(iter(problems.items()))
        label = by_key[key].label if key in by_key else key
        raise CrmError(
            422, "bad_value", "{field}: {why}", field=label, why=lookup(why), fields=problems
        )
    if record is None:
        meta = dict(obj.meta or {})
        for f in by_key.values():
            if f.type == "auto":
                n = int(meta.get(f"auto:{f.key}") or 0) + 1
                meta[f"auto:{f.key}"] = n
                data[f.key] = n
        obj.meta = meta
        record = CrmRecord(
            workspace_id=obj.workspace_id,
            object_id=obj.id,
            external_id=external_id,
            created_by=actor,
            updated_by=actor,
        )
        db.add(record)
    record.data = data
    record.updated_by = actor
    record.updated_at = datetime.now(UTC)
    all_fields = {f.key: f for f in fields}
    record.title = _title(obj, all_fields, data)
    await db.flush()
    return record


__all__ = [
    "Access",
    "CrmError",
    "access_of",
    "aggregate",
    "all_rows",
    "apply",
    "ensure_builtin",
    "fields_of",
    "save",
]
