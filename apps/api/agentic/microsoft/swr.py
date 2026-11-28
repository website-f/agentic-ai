"""P148a: the Microsoft 365 page's answers kept per person, served at once, refreshed behind.

Fitri, 28 Nov 2026: "Microsoft 365 - all loads, calendar, Teams, inbox and all - must be super
fast." Microsoft answers in 0.5-5 s; Valkey in under a millisecond. So every read of the page
(the tab counts, the inbox, the calendar week, the Teams chats, a chat, my mailboxes, Copilot)
is kept here per person and per Microsoft account:

- fresh (younger than `fresh` seconds): returned as is;
- stale (older, kept up to `keep` seconds): returned at once AND refreshed behind (one refresh
  per key: an in-process task, and a Valkey lock across API workers);
- missing (or `force`): built now; requests asking for the same key at once share one build.

Builds that read Microsoft run on their OWN database session (`account_graph`), never the
request's: they outlive the request when refreshing behind, and the request's connection goes
back to the pool while Microsoft answers (`release`).

Who sees what: a key is the person's workspace + user id + the Microsoft account id that
`m365._mine` / `access` already checked is theirs, so one person's answer is never served to
another; the route checks access BEFORE reading the cache.

Invalidation: a generation number per person (connect, disconnect, remove an account) and per
account and area ("mail", "cal") is part of every key; a write bumps it, so old answers are
simply never read again (they expire). `touch` marks one answer stale instead (the tab counts:
shown at once, refreshed behind). Tests call `settle()` to wait for refreshes behind.
"""

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import MicrosoftAccount
from . import access, auth, graph
from .errors import ReconnectNeeded

log = logging.getLogger("agentic.microsoft.swr")

PREFIX = "m365:c"
GEN_FOR = 30 * 24 * 3600  # a generation number outlives every answer kept under it
LOCK_FOR = 60  # seconds one refresh behind may take before another may start
# Tests may turn refreshing behind off (a stale answer is then rebuilt at once).
BACKGROUND = True

Build = Callable[[], Awaitable[Any]]

_inflight: dict[str, asyncio.Task[Any]] = {}
_tasks: set[asyncio.Task[Any]] = set()


@dataclass
class Hit:
    value: Any
    age: float
    stale: bool


# ---------------------------------------------------------------- keys and generations


def _gen_key(kind: str, *parts: str) -> str:
    return f"m365:gen:{kind}:" + ":".join(parts)


async def key(
    workspace_id: str,
    user_id: str,
    kind: str,
    account_id: str = "",
    *,
    area: str = "",
    extra: str = "",
) -> str:
    """The person's key for one answer: workspace, user, account, the generations it depends on
    (the person's, and the account's `area` when given), then `extra` (folder, range...)."""
    names = [_gen_key("p", workspace_id, user_id)]
    if area and account_id:
        names.append(_gen_key(area, account_id))
    try:
        got = await valkey().mget(names)
    except Exception:  # noqa: BLE001 - no Valkey: every read builds (nothing is kept either)
        got = [None] * len(names)
    gens = ".".join(str(int(g or 0)) for g in got)
    tail = f":{extra}" if extra else ""
    return f"{PREFIX}:{kind}:{workspace_id}:{user_id}:{account_id or '-'}:{gens}{tail}"


async def bump(
    workspace_id: str = "", user_id: str = "", *, account_id: str = "", areas: tuple[str, ...] = ()
) -> None:
    """Forget answers: every one of the person's (workspace + user), and/or the account's
    answers in `areas` ("mail", "cal")."""
    names = []
    if workspace_id and user_id:
        names.append(_gen_key("p", workspace_id, user_id))
    if account_id:
        names += [_gen_key(a, account_id) for a in areas]
    with contextlib.suppress(Exception):
        for n in names:
            await valkey().incr(n)
            await valkey().expire(n, GEN_FOR)


# ---------------------------------------------------------------- reading and writing


async def peek(k: str, fresh: float) -> Hit | None:
    try:
        raw = await valkey().get(k)
    except Exception:  # noqa: BLE001 - no cache: build
        return None
    if not raw:
        return None
    try:
        got = json.loads(raw)
        age = max(0.0, time.time() - float(got["at"]))
        return Hit(got["v"], age, age >= fresh)
    except (ValueError, KeyError, TypeError):
        return None


def _plain(v: Any) -> str:
    """Times as the API answers them (ISO 8601, as FastAPI writes them), anything else as text."""
    return v.isoformat() if isinstance(v, datetime | date) else str(v)


async def put(k: str, value: Any, keep: int) -> None:
    with contextlib.suppress(Exception):
        await valkey().set(k, json.dumps({"at": time.time(), "v": value}, default=_plain), ex=keep)


async def touch(*keys: str) -> None:
    """Mark answers stale: the next read shows them at once and refreshes them behind."""
    for k in keys:
        with contextlib.suppress(Exception):
            raw = await valkey().get(k)
            if raw:
                got = json.loads(raw)
                got["at"] = 0
                await valkey().set(k, json.dumps(got, default=_plain), keepttl=True)


async def forget(*keys: str) -> None:
    with contextlib.suppress(Exception):
        if keys:
            await valkey().delete(*keys)


# ---------------------------------------------------------------- building


def _track(t: asyncio.Task[Any]) -> None:
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    # A failure nobody awaited (a refresh behind) is logged, not warned about at exit.
    t.add_done_callback(lambda d: None if d.cancelled() else d.exception())


def start(k: str, build: Build, keep: int, *, lock: str = "") -> asyncio.Task[Any]:
    """Build `k` (and keep it): one build per key in this process at a time; a second caller
    gets the same task."""
    running = _inflight.get(k)
    if running is not None and not running.done():
        return running

    async def run() -> Any:
        try:
            value = await build()
            await put(k, value, keep)
            return value
        finally:
            if _inflight.get(k) is task:
                _inflight.pop(k, None)
            if lock:
                with contextlib.suppress(Exception):
                    await valkey().delete(lock)

    task = asyncio.create_task(run())
    _inflight[k] = task
    _track(task)
    return task


async def behind(k: str, build: Build, keep: int) -> None:
    """Refresh `k` behind the answer: once at a time, across API workers too."""
    if not BACKGROUND:
        return
    running = _inflight.get(k)
    if running is not None and not running.done():
        return
    lock = f"{k}:lock"
    try:
        if not await valkey().set(lock, "1", ex=LOCK_FOR, nx=True):
            return
    except Exception:  # noqa: BLE001 - no Valkey, no lock: refresh in this process only
        lock = ""
    start(k, build, keep, lock=lock)


async def serve(
    k: str, build: Build, *, fresh: float, keep: int, force: bool = False
) -> tuple[Any, bool]:
    """(the answer, whether it is stale and being refreshed behind)."""
    if not force:
        hit = await peek(k, fresh)
        if hit is not None:
            if hit.stale and not BACKGROUND:
                return await asyncio.shield(start(k, build, keep)), False
            if hit.stale:
                await behind(k, build, keep)
            return hit.value, hit.stale
    # shield: a person who leaves the page does not cancel a build others wait for too.
    return await asyncio.shield(start(k, build, keep)), False


async def settle() -> None:
    """Wait for every build and refresh behind (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


# ---------------------------------------------------------------- Microsoft, on its own session


@asynccontextmanager
async def account_graph(
    account_id: str, workspace_id: str, user_id: str
) -> AsyncIterator[tuple[AsyncSession, MicrosoftAccount, graph.Graph]]:
    """Graph for the person's own account, on a database session of its own (a build outlives
    the request when it refreshes behind). Only that person's usable account."""
    async with SessionLocal() as db:
        acct = await db.get(MicrosoftAccount, account_id)
        if (
            acct is None
            or acct.workspace_id != workspace_id
            or acct.user_id != user_id
            or acct.status not in access.USABLE_ACCOUNT
        ):
            raise ReconnectNeeded(Msg("Outlook needs reconnecting. Connect Microsoft 365 again."))
        # The access token first, once: calls a build makes at once then share it, instead of
        # each refreshing it on this one session (P123). A refusal shows in those calls.
        with contextlib.suppress(Exception):
            await auth.access_token(db, acct)
        await db.commit()  # the connection goes back to the pool while Microsoft answers
        yield db, acct, await graph.for_account(db, acct)


async def release(db: AsyncSession) -> None:
    """Hand the request's database connection back before waiting on Microsoft (loaded rows
    stay usable: expire_on_commit is off). Only a session with nothing unsaved."""
    with contextlib.suppress(Exception):
        if db.in_transaction() and not (db.new or db.dirty or db.deleted):
            await db.commit()
