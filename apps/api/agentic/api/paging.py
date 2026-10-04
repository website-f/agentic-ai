"""Keyset (cursor) pagination shared by the list endpoints.

A list is read in one fixed total order: its sort columns plus the row id as the tie-break.
A page is the first `limit` rows of that order strictly after the cursor, so consecutive pages
never overlap or skip a row, even while new rows arrive at the top. The cursor is an opaque,
URL-safe token holding the last row's sort values (it survives any filter: filters narrow the
set, the cursor only says where in the order to resume).

Responses keep their plain JSON body so existing callers are unaffected. Headers carry paging:
  X-Next-Cursor  the token for the next page; absent on the last page
  X-Total-Count  rows matching the filters, sent with the first page (no cursor) only
"""

import base64
import binascii
import json
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import Response, status
from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import api_error

NEXT = "X-Next-Cursor"
TOTAL = "X-Total-Count"
MAX_LIMIT = 200

# (column, descending). The last entry must be unique (the primary key).
Order = Sequence[tuple[Any, bool]]


def _bad() -> Exception:
    return api_error(status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid.")


def _pack(v: Any) -> Any:
    if isinstance(v, datetime):
        return {"t": v.isoformat()}
    if isinstance(v, Decimal):
        return {"n": str(v)}
    return v


def _unpack(v: Any) -> Any:
    if isinstance(v, dict):
        if "t" in v:
            return datetime.fromisoformat(v["t"])
        if "n" in v:
            return Decimal(v["n"])
        raise ValueError("unknown cursor value")
    return v


def encode(values: Sequence[Any]) -> str:
    raw = json.dumps([_pack(v) for v in values], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode(cursor: str, n: int) -> list[Any]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values = json.loads(raw)
        if not isinstance(values, list) or len(values) != n:
            raise ValueError("cursor shape")
        out = [_unpack(v) for v in values]
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError) as e:
        raise _bad() from e
    if any(v is None for v in out):
        raise _bad()
    return out


def key_of(entity: Any, order: Order) -> list[Any]:
    return [getattr(entity, col.key) for col, _ in order]


def cursor_for(entity: Any, order: Order) -> str:
    return encode(key_of(entity, order))


def after(order: Order, values: Sequence[Any]) -> ColumnElement[bool]:
    """Rows strictly after `values` in `order` (mixed directions allowed):
    (a > x) OR (a = x AND b > y) OR (a = x AND b = y AND c > z) ..."""
    branches = []
    for i, (col, desc) in enumerate(order):
        eq = [c == v for (c, _), v in zip(order[:i], values[:i], strict=True)]
        step = col < values[i] if desc else col > values[i]
        branches.append(and_(*eq, step))
    return or_(*branches)


def sort(order: Order) -> list[Any]:
    return [col.desc() if desc else col.asc() for col, desc in order]


async def count(db: AsyncSession, q: Select) -> int:
    sub = q.order_by(None).limit(None).offset(None).subquery()
    return int(await db.scalar(select(func.count()).select_from(sub)) or 0)


async def paginate(
    db: AsyncSession,
    q: Select,
    order: Order,
    *,
    limit: int,
    cursor: str | None,
    response: Response,
    total: bool = True,
    rows: bool = False,
) -> list[Any]:
    """One page of `q` (already filtered and scoped) in `order`, setting the paging headers.
    `rows=True` for multi-entity selects: returns Row objects whose first item is the entity
    the order columns belong to."""
    if total and not cursor:
        response.headers[TOTAL] = str(await count(db, q))
    if cursor:
        q = q.where(after(order, decode(cursor, len(order))))
    q = q.order_by(*sort(order)).limit(limit + 1)
    found: list[Any] = (
        list((await db.execute(q)).all()) if rows else list((await db.scalars(q)).all())
    )
    if len(found) > limit:
        found = found[:limit]
        last = found[-1][0] if rows else found[-1]
        response.headers[NEXT] = cursor_for(last, order)
    return found
