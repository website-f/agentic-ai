"""Long polling for every enabled Telegram bot, inside the worker. No webhook, so it runs on
a laptop with no public address.

One poller per bot across all workers (a Valkey lock), the offset is saved after every
update, and a bad token switches the bot off with the reason shown in the dashboard.
P29: the lock is renewed for every message and while a slow one is being answered (an agent
reply can take longer than the lock), and a poller that lost its lock stops at once.
"""

import asyncio
import contextlib
import logging
import os

from sqlalchemy import select

from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..models import Channel
from . import bot, deliver, telegram

log = logging.getLogger("agentic.channels.poller")

LOCK_TTL = 75
RESCAN = 15
ME = f"{os.getpid()}-{id(object())}"


async def _lock(channel_id: str) -> bool:
    key = f"tgpoll:{channel_id}"
    if await valkey().set(key, ME, nx=True, ex=LOCK_TTL):
        return True
    if (await valkey().get(key)) == ME:
        await valkey().expire(key, LOCK_TTL)
        return True
    return False


@contextlib.asynccontextmanager
async def _held(channel_id: str):
    """Keep renewing the lock while one message is handled."""

    async def renew() -> None:
        while True:
            await asyncio.sleep(LOCK_TTL / 3)
            try:
                await _lock(channel_id)
            except Exception:  # noqa: BLE001 - the next renewal tries again
                log.info("could not renew the telegram lock for %s", channel_id)

    beat = asyncio.create_task(renew())
    try:
        yield
    finally:
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat


async def poll_once(channel_id: str, timeout: int = 20) -> int:
    """One getUpdates round for one bot. Returns how many updates were handled."""
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        if ch is None or not ch.enabled:
            return -1
        token = deliver.channel_token(ch)
        state = dict(ch.state or {})
        if not state.get("webhook_cleared"):
            await telegram.delete_webhook(token)
            state["webhook_cleared"] = True
            ch.state = state
            await db.commit()
        offset = int(state.get("offset", 0))
    updates = await telegram.get_updates(token, offset, timeout=timeout)
    handled = 0
    for u in updates:
        if not await _lock(channel_id):  # P29: renewed per message; lost it: stop here
            return handled
        async with SessionLocal() as db, _held(channel_id):
            ch = await db.get(Channel, channel_id)
            if ch is None:
                return handled
            try:
                await bot.handle_update(db, ch, u)
            except Exception:  # noqa: BLE001 - one bad update must not stall the bot
                log.warning("telegram update %s failed", u.get("update_id"), exc_info=True)
                await db.rollback()
                ch = await db.get(Channel, channel_id)
                if ch is None:
                    return handled
            ch.state = {**(ch.state or {}), "offset": int(u["update_id"]) + 1, "last_error": None}
            await db.commit()
            handled += 1
    return handled


async def _run_channel(channel_id: str, stop: asyncio.Event) -> None:
    backoff = 2.0
    while not stop.is_set():
        if not await _lock(channel_id):
            await asyncio.sleep(RESCAN)
            continue
        try:
            if await poll_once(channel_id) < 0:
                return
            backoff = 2.0
        except telegram.TelegramError as e:
            async with SessionLocal() as db:
                ch = await db.get(Channel, channel_id)
                if ch is not None:
                    ch.state = {**(ch.state or {}), "last_error": str(e)}
                    if e.status in (401, 404):  # the token was revoked
                        ch.enabled = False
                    await db.commit()
            if e.status in (401, 404):
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
        except Exception:  # noqa: BLE001 - network trouble: wait and try again
            log.warning("telegram polling failed for %s", channel_id, exc_info=True)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def run(stop: asyncio.Event) -> None:
    tasks: dict[str, asyncio.Task[None]] = {}
    while not stop.is_set():
        try:
            async with SessionLocal() as db:
                ids = list(
                    (
                        await db.scalars(
                            select(Channel.id).where(
                                Channel.kind == "telegram", Channel.enabled.is_(True)
                            )
                        )
                    ).all()
                )
            for cid in ids:
                if cid not in tasks or tasks[cid].done():
                    tasks[cid] = asyncio.create_task(_run_channel(cid, stop))
        except Exception:  # noqa: BLE001
            log.warning("telegram scan failed", exc_info=True)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=RESCAN)
    for t in tasks.values():
        t.cancel()
