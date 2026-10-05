"""The words a person's documents actually use, for completing a word as it is typed and
for reading a misspelt word as the one the documents spell.

Reference codes (a tender, PO or staff number such as "TN123…", "PO-2026-0001", "EMP-1042")
are kept apart: the word index splits them into letters and a number, so they are read from
the passages' text and completed whole.

Built from the passages this person may see (unnest of the tsvectors: real words only, not
roots or number forms), cached in Valkey per person (or per workspace for workspace roles)
and keyed on the workspace's index generation, so a file indexed or removed starts a fresh
build. The build runs in the background: a suggestion request waits at most a moment for
it and otherwise answers without word completions this once.
"""

import asyncio
import bisect
import difflib
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Text, column, distinct, func, literal_column, select, true
from sqlalchemy.dialects.postgresql import ARRAY

from ..core.db import SessionLocal
from ..core.valkey import valkey
from . import index
from .engine import Filters, passage_scope, visible
from .models import SearchPassage
from .viewer import Viewer

log = logging.getLogger("agentic.search.vocab")

TTL = 15 * 60
MAX_TERMS = 40_000
MEMO = 24  # vocabularies kept in this process
MAX_CODES = 20_000
# Letters, then digits, with an optional - or / between parts: TN1234567890, PO-2026-0001.
CODE_SQL = r"(\m[A-Za-z]{1,6}[-/]?[0-9]{3,}(?:[-/][0-9A-Za-z]+)*\M)"
CODE_START = re.compile(r"^[A-Za-z]{1,6}[-/]?[0-9][0-9A-Za-z/-]*$|^[A-Za-z]{1,6}[-/]$")


@dataclass
class Vocab:
    terms: list[str]  # sorted
    docs: list[int]  # how many sources use each term
    codes: list[tuple[str, str]] | None = None  # (casefolded, as written), sorted

    def complete_code(self, w: str, n: int = 3) -> list[str]:
        """Reference codes starting with `w`, ignoring case."""
        if not self.codes or not CODE_START.match(w):
            return []
        key = w.casefold()
        i = bisect.bisect_left(self.codes, (key, ""))
        out: list[str] = []
        while i < len(self.codes) and self.codes[i][0].startswith(key) and len(out) < n:
            if self.codes[i][0] != key:
                out.append(self.codes[i][1])
            i += 1
        return out

    def has_prefix(self, w: str) -> bool:
        i = bisect.bisect_left(self.terms, w)
        return i < len(self.terms) and self.terms[i].startswith(w)

    def complete(self, w: str, n: int = 3) -> list[str]:
        """The most used words starting with `w` (longer than it)."""
        if len(w) < 2:
            return []
        i = bisect.bisect_left(self.terms, w)
        found: list[tuple[int, str]] = []
        while i < len(self.terms) and self.terms[i].startswith(w):
            if self.terms[i] != w:
                found.append((self.docs[i], self.terms[i]))
            i += 1
            if len(found) > 5000:
                break
        found.sort(key=lambda x: (-x[0], len(x[1]), x[1]))
        return [t for _, t in found[:n]]

    def close(self, w: str, n: int = 2) -> list[str]:
        """Words spelt nearly like `w` (same first letter, similar length)."""
        if len(w) < 4:
            return []
        lo = bisect.bisect_left(self.terms, w[0])
        hi = bisect.bisect_left(self.terms, chr(ord(w[0]) + 1))
        pool = [t for t in self.terms[lo:hi] if abs(len(t) - len(w)) <= 2]
        best = difflib.get_close_matches(w, pool, n=n * 3, cutoff=0.78)
        rank = {t: self.docs[bisect.bisect_left(self.terms, t)] for t in best}
        best.sort(key=lambda t: (-difflib.SequenceMatcher(None, w, t).ratio(), -rank[t]))
        return [t for t in best if t != w][:n]


_memo: "OrderedDict[str, Vocab]" = OrderedDict()
_building: dict[str, "asyncio.Task[Vocab | None]"] = {}


def _remember(key: str, v: Vocab) -> None:
    _memo[key] = v
    _memo.move_to_end(key)
    while len(_memo) > MEMO:
        _memo.popitem(last=False)


def statement(viewer: Viewer) -> Any:
    """Real words (weights D and B) of every passage the viewer may see, with how many
    sources use each."""
    scope = passage_scope(viewer, visible(viewer, Filters()))
    u = func.unnest(SearchPassage.tsv).table_valued("lexeme", "positions", "weights").lateral("u")
    real = u.c.weights.op("&&")(literal_column("ARRAY['D', 'B']::text[]"))
    n = func.count(distinct(SearchPassage.source_id))
    return (
        select(u.c.lexeme, n)
        .select_from(SearchPassage)
        .join(u, true())
        .where(
            scope,
            real,
            func.length(u.c.lexeme).between(3, 40),
            u.c.lexeme.op("~")("[[:alpha:]]"),
        )
        .group_by(u.c.lexeme)
        .order_by(n.desc())
        .limit(MAX_TERMS)
    )


def codes_statement(viewer: Viewer) -> Any:
    """Reference codes written in the passages the viewer may see."""
    scope = passage_scope(viewer, visible(viewer, Filters()))
    # A function in FROM sees the row before it (implicitly lateral): c(m) per match.
    c = (
        func.regexp_matches(SearchPassage.text, CODE_SQL, "g")
        .table_valued(column("m", ARRAY(Text)))
        .render_derived(name="c")
    )
    return (
        select(func.upper(c.c.m[1]))
        .distinct()
        .select_from(SearchPassage)
        .join(c, true())
        .where(scope)
        .limit(MAX_CODES)
    )


async def _build(key: str, stmt: Any, codes_stmt: Any = None) -> Vocab | None:
    try:
        async with SessionLocal() as db:
            rows: list[Any] = list((await db.execute(stmt)).all())
            found: list[Any] = []
            if codes_stmt is not None:
                try:
                    found = list((await db.execute(codes_stmt)).all())
                except Exception:  # noqa: BLE001 - words still complete without codes
                    log.warning("could not read reference codes", exc_info=True)
                    await db.rollback()
        pairs = sorted((str(r[0]), int(r[1])) for r in rows)
        codes = sorted({(str(r[0]).casefold(), str(r[0])) for r in found if r[0]})
        v = Vocab([t for t, _ in pairs], [c for _, c in pairs], codes)
        _remember(key, v)
        try:
            raw = [v.terms, v.docs, [c for _, c in codes]]
            await valkey().set(key, json.dumps(raw, separators=(",", ":")), ex=TTL)
        except Exception:  # noqa: BLE001 - the memo still serves this process
            log.debug("could not cache a vocabulary", exc_info=True)
        return v
    except Exception:  # noqa: BLE001 - suggestions go on without word completions
        log.warning("could not build a search vocabulary", exc_info=True)
        return None
    finally:
        _building.pop(key, None)


async def cache_key(viewer: Viewer) -> str:
    return f"search:vocab:{viewer.key}:{await index.generation(viewer.workspace_id)}"


async def get(viewer: Viewer, *, wait: float = 0.1) -> Vocab | None:
    """This viewer's vocabulary: from memory, Valkey, or a build (waiting up to `wait`
    seconds for it; None if it is not ready yet)."""
    key = await cache_key(viewer)
    if key in _memo:
        _memo.move_to_end(key)
        return _memo[key]
    try:
        raw = await valkey().get(key)
    except Exception:  # noqa: BLE001
        raw = None
    if raw:
        terms, docs, *rest = json.loads(raw)
        codes = sorted((c.casefold(), c) for c in (rest[0] if rest else []))
        v = Vocab(terms, docs, codes)
        _remember(key, v)
        return v
    task = _building.get(key)
    if task is None:
        task = asyncio.create_task(_build(key, statement(viewer), codes_statement(viewer)))
        _building[key] = task
    try:
        return await asyncio.wait_for(asyncio.shield(task), wait)
    except TimeoutError:
        return None


async def ready(viewer: Viewer) -> Vocab | None:
    """Wait for the vocabulary however long it takes (tests, the reindex command)."""
    return await get(viewer, wait=60)


async def drain() -> None:
    """Let builds in flight finish (tests: before the event loop goes away)."""
    if _building:
        await asyncio.gather(*list(_building.values()), return_exceptions=True)


def clear() -> None:
    _memo.clear()


# ---------------------------------------------------------------- recent searches

RECENT = 20
RECENT_TTL = 90 * 24 * 3600


def _recent_key(workspace_id: str, user_id: str) -> str:
    return f"search:recent:{workspace_id}:{user_id}"


async def remember_search(workspace_id: str, user_id: str, q: str) -> None:
    q = " ".join(q.split())[:200]
    if len(q) < 2:
        return
    key = _recent_key(workspace_id, user_id)
    try:
        pipe = valkey().pipeline()
        pipe.lrem(key, 0, q)
        pipe.lpush(key, q)
        pipe.ltrim(key, 0, RECENT - 1)
        pipe.expire(key, RECENT_TTL)
        await pipe.execute()
    except Exception:  # noqa: BLE001 - recent searches are a nicety
        log.debug("could not save a recent search", exc_info=True)


async def recent_searches(workspace_id: str, user_id: str) -> list[str]:
    try:
        raw = await valkey().lrange(_recent_key(workspace_id, user_id), 0, RECENT - 1)
        return [str(x) for x in raw]
    except Exception:  # noqa: BLE001
        return []


async def forget_searches(workspace_id: str, user_id: str) -> None:
    try:
        await valkey().delete(_recent_key(workspace_id, user_id))
    except Exception:  # noqa: BLE001
        log.debug("could not clear recent searches", exc_info=True)
