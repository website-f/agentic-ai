"""P96: numbered pages for the office's data tables (web components/ui/data-table.tsx).

A list endpoint that takes `page` answers one page of rows in its usual body and the number of
matching rows in the X-Total-Count header. Its params:

  q     words to find (each word must match; how is up to the endpoint)
  page  1-based page number; past the end gives an empty page
  size  rows per page (1..200)
  sort  a column id the endpoint allows; "-col" sorts it descending

Without `page` an endpoint keeps answering as before, so older callers are unaffected.
"""

from collections.abc import Callable, Collection, Sequence
from typing import Any

from fastapi import Query, Response, status
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import api_error
from .paging import TOTAL, Order, count
from .paging import sort as order_by

MAX_SIZE = 200


class TableParams:
    """FastAPI dependency: `params: TableParams = Depends()`."""

    def __init__(
        self,
        q: str | None = Query(default=None, max_length=200),
        page: int | None = Query(default=None, ge=1, le=100_000),
        size: int = Query(default=25, ge=1, le=MAX_SIZE),
        sort: str | None = Query(default=None, max_length=40),
    ) -> None:
        self.q = (q or "").strip()
        self.page = page
        self.size = size
        self.sort = (sort or "").strip()

    @property
    def paged(self) -> bool:
        return self.page is not None

    @property
    def words(self) -> list[str]:
        return [w for w in self.q.lower().split() if w][:8]

    @property
    def offset(self) -> int:
        return ((self.page or 1) - 1) * self.size

    def sort_by(self, allowed: Collection[str], default: str = "") -> tuple[str, bool]:
        """(column id, descending). An unknown column is refused, so a typo is not silently
        ignored."""
        raw = self.sort or default
        if not raw:
            return "", False
        desc = raw.startswith("-")
        key = raw[1:] if desc else raw
        if key not in allowed:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_sort",
                "This list cannot be sorted by {column}.",
                column=key,
            )
        return key, desc


def like(word: str) -> str:
    """A word as an ILIKE pattern that finds it anywhere (use with escape="\\")."""
    return "%" + word.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"


def matches(words: Sequence[str], *texts: str | None) -> bool:
    """Every word is in one of the texts (case-insensitive)."""
    hay = " ".join(t or "" for t in texts).lower()
    return all(w in hay for w in words)


def page_of[T](
    items: list[T],
    params: TableParams,
    response: Response,
    key: Callable[[T], Any] | None = None,
    desc: bool = False,
) -> list[T]:
    """In memory: sort (when `key` is given; blanks last either way), count, then one page."""
    if key is not None:
        blank = [i for i in items if key(i) in (None, "")]
        full = [i for i in items if key(i) not in (None, "")]
        full.sort(key=key, reverse=desc)  # stable: equal keys keep the caller's order
        items = full + blank
    response.headers[TOTAL] = str(len(items))
    if not params.paged:
        return items
    return items[params.offset : params.offset + params.size]


async def sql_page(
    db: AsyncSession,
    q: Select,
    order: Order,
    params: TableParams,
    response: Response,
    *,
    rows: bool = False,
) -> list[Any]:
    """In SQL: count the filtered rows, then one page in `order` (end it with the primary key
    so pages never overlap)."""
    response.headers[TOTAL] = str(await count(db, q))
    q = q.order_by(*order_by(order)).offset(params.offset).limit(params.size)
    return list((await db.execute(q)).all()) if rows else list((await db.scalars(q)).all())
