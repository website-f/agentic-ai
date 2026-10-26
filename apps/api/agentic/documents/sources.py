"""P40: a storage target as a source of the Library. Its documents (a B2 bucket's prefix, a
folder on this server, a folder on the company's file server) are imported into a company's
Library: each becomes a file row whose bytes stay where they are (storage_id + storage_key),
read like an upload (text, OCR, the secret scan, the summary) and indexed for every agent.

A sync adds new documents and re-reads changed ones (by etag); one that disappeared from the
source is taken out of the Library but kept. It runs when a person asks and about every hour
in the liveness reconciler; each run imports at most MAX_PER_RUN, the next run goes on.
"""

import logging
import mimetypes
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..core.ids import new_id
from ..models import DocFile, StorageTarget
from . import storage

log = logging.getLogger("agentic.sources")

SUPPORTED = frozenset(
    {
        ".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv",
        ".png", ".jpg", ".jpeg", ".webp", ".html", ".htm",
    }
)  # fmt: skip
MAX_BYTES = 20 * 1024 * 1024
MAX_PER_RUN = 200
EVERY = timedelta(hours=1)


def _settings(t: StorageTarget) -> dict[str, Any]:
    return dict(t.sync or {})


def due(t: StorageTarget, now: datetime | None = None) -> bool:
    s = _settings(t)
    if not s.get("enabled") or not s.get("branch_id"):
        return False
    last = s.get("last_sync")
    if not last:
        return True
    try:
        then = datetime.fromisoformat(last)
    except ValueError:
        return True
    return (now or datetime.now(UTC)) - then >= EVERY


async def sync(db: AsyncSession, t: StorageTarget) -> dict[str, int]:
    """Import new and changed documents from `t` into its company's Library."""
    from ..api.routers.files import start_reading  # late: the router imports this package

    s = _settings(t)
    out = {"listed": 0, "new": 0, "changed": 0, "gone": 0, "skipped": 0}
    if not s.get("branch_id"):
        raise storage.StorageError("Pick the company whose Library these documents are for.")
    prefix = str(s.get("prefix") or "").strip("/")
    try:
        entries = await storage.list_files(t, prefix + "/" if prefix else "")
    except httpx.HTTPError as e:
        raise storage.StorageError(
            f"{t.name} could not be reached ({e.__class__.__name__})."
        ) from e
    out["listed"] = len(entries)
    have = {
        f.storage_key: f
        for f in (await db.scalars(select(DocFile).where(DocFile.storage_id == t.id))).all()
        if f.storage_key
    }
    to_read: list[str] = []
    label = (str(s.get("folder") or "") or t.name).strip("/")[:80]
    for e in entries:
        ext = PurePosixPath(e.key).suffix.lower()
        if ext not in SUPPORTED or not e.size or e.size > MAX_BYTES:
            out["skipped"] += 1
            continue
        f = have.get(e.key)
        if f is not None:
            if f.storage_etag == e.etag and f.library:
                continue
            f.storage_etag, f.size, f.library = e.etag, e.size, True
            f.status, f.error, f.indexed_at = "reading", None, None
            out["changed"] += 1
            to_read.append(f.id)
        else:
            if out["new"] >= MAX_PER_RUN:
                continue
            rel = e.key[len(prefix) :].strip("/") if prefix and e.key.startswith(prefix) else e.key
            parent = str(PurePosixPath(rel).parent)
            folder = label if parent in ("", ".") else f"{label}/{parent}"
            f = DocFile(
                id=new_id("fl"),
                workspace_id=t.workspace_id,
                branch_id=s["branch_id"],
                department_id=s.get("department_id") or None,
                name=PurePosixPath(e.key).name[:200],
                mime=mimetypes.guess_type(e.key)[0] or "application/octet-stream",
                size=e.size,
                sha256="",
                status="reading",
                text="",
                source="upload",
                origin="uploaded",
                created_by=f"storage:{t.id}",
                fields={},
                folder=folder[:300],
                source_path=e.key[:500],
                sensitive={},
                quarantined=False,
                library=True,
                storage_id=t.id,
                storage_key=e.key,
                storage_etag=e.etag,
            )
            db.add(f)
            out["new"] += 1
            to_read.append(f.id)
    listed = {e.key for e in entries}
    for key, f in have.items():
        if key not in listed and f.library:
            f.library, f.error = False, f"No longer in {t.name}."
            out["gone"] += 1
    s.update(
        {
            "last_sync": datetime.now(UTC).isoformat(),
            "imported": len(have) + out["new"],
            "last_result": out,
            "error": None,
        }
    )
    t.sync = s
    flag_modified(t, "sync")
    await db.commit()
    if out["gone"]:
        from ..knowledge import indexer

        for key, f in have.items():
            if key not in listed:
                await indexer.remove(db, "file", f.id)
        await db.commit()
    for fid in to_read:
        await start_reading(fid)
    return out


async def sync_due(db: AsyncSession) -> int:
    """For the liveness reconciler: sync every source that is due. Returns how many ran."""
    ran = 0
    for t in (await db.scalars(select(StorageTarget))).all():
        if not due(t):
            continue
        try:
            await sync(db, t)
        except storage.StorageError as e:
            s = _settings(t)
            s.update({"last_sync": datetime.now(UTC).isoformat(), "error": str(e)[:300]})
            t.sync = s
            flag_modified(t, "sync")
            await db.commit()
        except Exception:  # noqa: BLE001 - one broken source must not stop the others
            await db.rollback()
            log.warning("sync of %s failed", t.id, exc_info=True)
        ran += 1
    return ran
