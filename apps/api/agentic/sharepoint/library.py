"""P80: read a linked SharePoint / OneDrive folder into the Library, and keep it in step.

A sync walks the folder (links.walk, bounded) with the connecting person's own Microsoft 365
sign-in, and compares each file's cTag (it changes only when the content changes) with the
one its text was indexed from:
- new or changed: the file is downloaded into memory, its text extracted with the same
  readers as an upload (documents/extract.py), scanned for passwords and IC numbers (P24: a
  file that holds them is "held" and never searchable; other personal values are masked), and
  its passages rebuilt (knowledge_chunks, source_kind "sharepoint", the folder's scope). The
  bytes are dropped: only the searchable text is kept.
- renamed or moved, same content: its name, path and link are updated, nothing re-read.
- gone from the folder: its passages and row are removed (only after a complete walk).

Graph's delta query is not used: for SharePoint and OneDrive for Business it works only on a
drive's root (not a folder inside it) and never says where an item sits, so a bounded walk
with cTags is the one way that works for every linked folder.

When the person's Microsoft sign-in stops working (refused refresh, a connection made before
SharePoint reading was allowed, disconnected), the source is marked needs_reconnect and is not
tried again until their connection works and allows files (no spinning against Microsoft).
"""

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.valkey import valkey
from ..i18n import Msg, render
from ..knowledge import indexer
from ..microsoft import access, app, auth, graph
from ..microsoft.errors import (
    Forbidden,
    MicrosoftError,
    NotFound,
    ReconnectNeeded,
    Unauthorized,
)
from ..models import KnowledgeChunk, MicrosoftAccount
from . import links
from .models import LinkedFile, LinkedSource

log = logging.getLogger("agentic.sharepoint")

KIND = "sharepoint"  # knowledge_chunks.source_kind
LOCK_TTL = 3600
STALE_SYNC = timedelta(hours=2)  # a "syncing" source older than this was cut off (restart)
PER_TICK = 20


class NeedsReconnect(Exception):
    def __init__(self, message: Msg) -> None:
        super().__init__(message)
        self.message = message


def files_ok(acct: MicrosoftAccount | None) -> bool:
    return bool(
        acct is not None
        and acct.status in access.USABLE_ACCOUNT
        and auth.has_scope(acct.scopes, app.FILES_SCOPES[0])
    )


async def account_of(db: AsyncSession, src: LinkedSource) -> MicrosoftAccount | None:
    if not src.connected_by:
        return None
    return await access.personal_account_of(db, src.workspace_id, src.connected_by)


async def graph_for(db: AsyncSession, src: LinkedSource) -> graph.Graph:
    acct = await account_of(db, src)
    if acct is None or acct.status == "disconnected":
        raise NeedsReconnect(
            Msg("The Microsoft 365 connection that linked this folder is gone. Connect it again.")
        )
    if not files_ok(acct):
        raise NeedsReconnect(
            Msg(
                "{name} needs to reconnect Microsoft 365 to allow SharePoint, then sync again.",
                name=src.connected_by_name or "The person who connected it",
            )
        )
    return await graph.for_account(db, acct)


def title_of(name: str) -> str:
    return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name).strip() or name


def _say(e: Exception) -> str:
    m = getattr(e, "message", None) or (e.args[0] if e.args else "")
    return render(m)[:500] if isinstance(m, Msg) else str(m)[:500]


# ---------------------------------------------------------------- one file


async def _read_one(
    db: AsyncSession, g: graph.Graph, src: LinkedSource, lf: LinkedFile, item: links.Item
) -> None:
    """Download, read, scan and index one file (never keeping its bytes). Sets lf.status."""
    from ..documents.extract import extract, sniff
    from ..intake import scan

    lf.name, lf.path, lf.web_url = item.name, item.path, item.web_url
    lf.etag, lf.ctag, lf.size = item.etag, item.ctag, item.size
    lf.error, lf.passages = None, 0
    limit = settings.sharepoint_max_file_mb * 1024 * 1024
    if item.size > limit:
        await indexer.remove(db, KIND, lf.id)
        lf.status, lf.indexed_at = "too_large", datetime.now(UTC)
        return
    try:
        data = await links.download(g, src.drive_id, item.item_id, limit)
    except links.TooLarge:
        await indexer.remove(db, KIND, lf.id)
        lf.status, lf.indexed_at = "too_large", datetime.now(UTC)
        return
    try:
        out = await asyncio.to_thread(extract, data, item.name)
        found = scan.scan(out.text)
        if sniff(data[:4096], item.name) in ("docx", "xlsx", "pptx"):
            raw = await asyncio.to_thread(scan.office_text, data)
            if raw:
                found.merge(await asyncio.to_thread(scan.scan, raw))
    except Exception as e:  # noqa: BLE001 - a broken file is reported, never stops the sync
        log.warning("could not read SharePoint file %s: %s", lf.id, e)
        await indexer.remove(db, KIND, lf.id)
        lf.status = "failed"
        lf.error = f"Could not read this file ({e.__class__.__name__})."[:300]
        return
    finally:
        del data  # P80: the file itself is never kept
    if found.quarantine:  # P24: passwords or many IC numbers: never searchable
        await indexer.remove(db, KIND, lf.id)
        lf.status, lf.indexed_at = "held", datetime.now(UTC)
        return
    text = scan.mask(out.text, found)
    lf.passages = await indexer.index_text(
        db,
        workspace_id=src.workspace_id,
        kind=KIND,
        source_id=lf.id,
        branch_id=src.branch_id,
        title=title_of(item.name),
        body=text,
    )
    lf.status = "indexed" if lf.passages else "empty"
    lf.error = (out.note or None) if not lf.passages else None
    lf.indexed_at = datetime.now(UTC)


# ---------------------------------------------------------------- a folder


async def _mark(db: AsyncSession, src: LinkedSource, status: str, error: Any = None) -> None:
    src.status = status
    src.last_error = (_say(error) if isinstance(error, Exception) else error) or None
    await db.commit()


async def _gone(db: AsyncSession, source_id: str) -> bool:
    """Was the folder disconnected while this sync ran?"""
    row = await db.execute(
        select(LinkedSource.id)
        .where(LinkedSource.id == source_id)
        .execution_options(populate_existing=True)
    )
    return row.first() is None


@dataclass
class SyncResult:
    status: str
    read: int = 0
    unchanged: int = 0
    removed: int = 0
    error: str | None = None


async def sync_source(db: AsyncSession, source_id: str) -> SyncResult:
    """Bring a linked folder's passages in step with SharePoint. One sync at a time per folder
    (a second one answers "busy"). Commits as it goes, so the page shows progress."""
    key = f"linked:sync:{source_id}"
    if not await valkey().set(key, "1", nx=True, ex=LOCK_TTL):
        return SyncResult("busy")
    try:
        return await _sync(db, source_id)
    finally:
        await valkey().delete(key)


async def _sync(db: AsyncSession, source_id: str) -> SyncResult:
    src = await db.get(LinkedSource, source_id)
    if src is None:
        return SyncResult("missing")
    src.status, src.sync_started_at = "syncing", datetime.now(UTC)
    await db.commit()
    try:
        g = await graph_for(db, src)
        root = await links.get_item(g, src.drive_id, src.item_id)
        found = await links.walk(g, root)
    except (NeedsReconnect, ReconnectNeeded, Unauthorized) as e:
        # auth.access_token committed the account as reconnect_needed (and the source's
        # "syncing" with it): nothing is rolled back here.
        await _mark(db, src, "needs_reconnect", e)
        return SyncResult("needs_reconnect", error=src.last_error)
    except (NotFound, Forbidden) as e:
        msg = Msg(
            "SharePoint says this folder is gone, or {name} can no longer open it. Check the "
            "folder, or disconnect it.",
            name=src.connected_by_name or "the person who connected it",
        )
        log.info("linked source %s: %s", src.id, e)
        await _mark(db, src, "error", render(msg))
        return SyncResult("error", error=src.last_error)
    except MicrosoftError as e:
        await _mark(db, src, "error", e)
        return SyncResult("error", error=src.last_error)
    if root.name and root.name != src.name:
        src.name = root.name[:300]
    old = {
        f.item_id: f
        for f in (await db.scalars(select(LinkedFile).where(LinkedFile.source_id == src.id))).all()
    }
    res = SyncResult("ready")
    for item in found.files:
        lf = old.pop(item.item_id, None)
        if lf is not None and item.ctag and lf.ctag == item.ctag and lf.status != "failed":
            if (lf.name, lf.path, lf.web_url) != (item.name, item.path, item.web_url):
                lf.name, lf.path, lf.web_url = item.name, item.path, item.web_url
                lf.etag = item.etag
                await db.execute(
                    update(KnowledgeChunk)
                    .where(KnowledgeChunk.source_kind == KIND, KnowledgeChunk.source_id == lf.id)
                    .values(title=title_of(item.name)[:200])
                )
                await db.commit()
            res.unchanged += 1
            continue
        if lf is None:
            lf = LinkedFile(workspace_id=src.workspace_id, source_id=src.id, item_id=item.item_id)
            db.add(lf)
            await db.flush()
        try:
            await _read_one(db, g, src, lf, item)
        except (NotFound, Forbidden) as e:  # deleted or locked since the walk: tried again
            lf.status, lf.error = "failed", _say(e)[:300]  # by the next sync
        except (ReconnectNeeded, Unauthorized, MicrosoftError) as e:
            # The sign-in stopped working, or Microsoft is busy or down: keep what was read
            # so far (this file's half-done change is undone) and stop here.
            why = _say(e)
            state = "error" if not isinstance(e, ReconnectNeeded | Unauthorized) else ""
            await db.rollback()
            await _mark(db, src, state or "needs_reconnect", why)
            return SyncResult(state or "needs_reconnect", res.read, res.unchanged, error=why)
        if await _gone(db, src.id):
            await db.rollback()
            return SyncResult("missing", res.read)
        await db.commit()
        res.read += 1
    for lf in old.values():  # not in the folder any more (the walk was complete)
        await indexer.remove(db, KIND, lf.id)
        await db.delete(lf)
        res.removed += 1
    src.files_seen, src.capped = len(found.files), found.capped
    src.status, src.last_error = "ready", None
    src.last_sync_at = datetime.now(UTC)
    await db.commit()
    log.info(
        "synced linked source %s: %d read, %d unchanged, %d removed",
        src.id,
        res.read,
        res.unchanged,
        res.removed,
    )
    return res


async def remove_source(db: AsyncSession, src: LinkedSource) -> int:
    """Drop a linked folder: its passages, its files' rows and itself. The caller commits."""
    ids = list(
        (await db.scalars(select(LinkedFile.id).where(LinkedFile.source_id == src.id))).all()
    )
    if ids:
        await db.execute(
            delete(KnowledgeChunk).where(
                KnowledgeChunk.source_kind == KIND, KnowledgeChunk.source_id.in_(ids)
            )
        )
    await db.delete(src)
    return len(ids)


# ---------------------------------------------------------------- the schedule


async def due(db: AsyncSession, now: datetime | None = None) -> list[str]:
    """Sources to sync now: not synced for settings.sharepoint_sync_hours; a sync cut off by a
    restart; one waiting for a reconnect only once its person's connection allows files."""
    now = now or datetime.now(UTC)
    every = timedelta(hours=settings.sharepoint_sync_hours)
    rows = (
        await db.scalars(
            select(LinkedSource).order_by(LinkedSource.last_sync_at.asc().nulls_first())
        )
    ).all()
    waiting = {s.connected_by for s in rows if s.status == "needs_reconnect" and s.connected_by}
    accounts = {
        (a.workspace_id, a.user_id): a
        for a in (
            await db.scalars(select(MicrosoftAccount).where(MicrosoftAccount.user_id.in_(waiting)))
        ).all()
    }
    out: list[str] = []
    for s in rows:
        started = s.sync_started_at
        if s.status == "syncing":
            if started is None or now - started > STALE_SYNC:
                out.append(s.id)
        elif s.status == "needs_reconnect":
            acct = accounts.get((s.workspace_id, s.connected_by or ""))
            if (started is None or now - started > every) and files_ok(acct):
                out.append(s.id)
        elif s.last_sync_at is None or now - s.last_sync_at >= every:
            if started is None or now - started >= every or s.status != "error":
                out.append(s.id)
        if len(out) >= PER_TICK:
            break
    return out


async def tick() -> dict[str, int]:
    """The `linked-sync` schedule: sync every linked folder that is due, one at a time."""
    from ..core.db import SessionLocal

    out = {"synced": 0, "failed": 0}
    async with SessionLocal() as db:
        ids = await due(db)
    for sid in ids:
        async with SessionLocal() as db:
            try:
                res = await sync_source(db, sid)
                out["synced" if res.status in ("ready", "busy") else "failed"] += 1
            except Exception:  # noqa: BLE001 - one folder must not stop the others
                await db.rollback()
                out["failed"] += 1
                log.warning("could not sync linked source %s", sid, exc_info=True)
    return out


# ---------------------------------------------------------------- reading it back


@dataclass
class LinkedDoc:
    """A linked file as the SOP builder reads documents (intake/builders.py), its text put
    back together from its passages (the file itself is not kept)."""

    id: str
    workspace_id: str
    name: str
    title: str
    text: str
    web_url: str
    folder: str = ""
    summary: str = ""
    kind: str = ""
    quarantined: bool = False
    status: str = "ready"
    branch_id: str | None = None


async def text_of(db: AsyncSession, file_id: str) -> str:
    """A linked file's text from its passages, with [page N] marks where they change."""
    rows = (
        await db.execute(
            select(KnowledgeChunk.page, KnowledgeChunk.heading, KnowledgeChunk.text)
            .where(KnowledgeChunk.source_kind == KIND, KnowledgeChunk.source_id == file_id)
            .order_by(KnowledgeChunk.idx)
        )
    ).all()
    parts: list[str] = []
    page: int | None = None
    for p, heading, body in rows:
        if p and p != page:
            parts.append(f"[page {p}]")
            page = p
        if heading and not body.lstrip().startswith(heading[:40]):
            parts.append(f"## {heading}")
        parts.append(body)
    return "\n\n".join(parts)


async def as_documents(db: AsyncSession, workspace_id: str, file_ids: list[str]) -> list[LinkedDoc]:
    """The linked files an SOP draft is written from, in the order given (indexed ones only)."""
    from ..intake.builders import MAX_FILES, BuildError

    ids = list(dict.fromkeys(i for i in file_ids if i))[:MAX_FILES]
    rows = {
        f.id: (f, s)
        for f, s in (
            await db.execute(
                select(LinkedFile, LinkedSource)
                .join(LinkedSource, LinkedSource.id == LinkedFile.source_id)
                .where(
                    LinkedFile.workspace_id == workspace_id,
                    LinkedFile.id.in_(ids),
                    LinkedFile.status == "indexed",
                )
            )
        ).all()
    }
    docs: list[LinkedDoc] = []
    for i in ids:
        if i not in rows:
            continue
        f, s = rows[i]
        folder = f.path.rsplit("/", 1)[0] if "/" in f.path else ""
        docs.append(
            LinkedDoc(
                id=f.id,
                workspace_id=f.workspace_id,
                name=f.name,
                title=title_of(f.name),
                text=await text_of(db, f.id),
                web_url=f.web_url,
                folder=folder,
                branch_id=s.branch_id,
            )
        )
    if not docs:
        raise BuildError(
            Msg("None of these SharePoint files has readable text yet. Sync the folder first."),
            "no_usable_files",
        )
    return docs


def cite_links(body: str, docs: list[LinkedDoc]) -> str:
    """An SOP drafted from SharePoint files links to them (they stay in SharePoint)."""
    lines = [f"- [{d.name}]({d.web_url})" for d in docs if d.web_url.startswith("https://")]
    if not lines:
        return body
    return f"{body.rstrip()}\n\nSharePoint:\n" + "\n".join(lines) + "\n"
