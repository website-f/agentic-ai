"""One upload of company documents, from bytes to a sorted, scanned, reported batch (P24).

The API stores the files (`add_upload`: a zip is unpacked there, one file at a time, so the
person hears at once about a broken or encrypted zip); the worker then reads each file
(`read_one`: documents.service.process_file with the sorter as its after-read step) and
finishes the batch (`finish`: report, then the builders' suggestions).

Everything is recomputed from the files table (done counts, the report), so a retried
activity, an appended upload or two runs at once never double-count.
"""

import asyncio
import io
import json
import logging
import re
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import func, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..documents import service as doc_service
from ..models import Department, DocFile, IntakeBatch
from ..services import events
from . import scan, sort, unpack

log = logging.getLogger("agentic.intake")

MAX_SUGGESTIONS = 100


def empty_report() -> dict[str, Any]:
    return {
        "by_kind": {},
        "by_department": {},
        "library": 0,
        "flagged": [],
        "skipped": [],
        "suggestions": [],
    }


async def publish(b: IntakeBatch) -> None:
    await events.publish(
        b.workspace_id,
        "intake.updated",
        {
            "batch_id": b.id,
            "branch_id": b.branch_id,
            "status": b.status,
            "done": b.done,
            "total": b.total,
        },
    )


# ---------------------------------------------------------------- storing an upload


async def add_upload(
    db: AsyncSession,
    *,
    batch: IntakeBatch,
    name: str,
    data: bytes | io.BytesIO,
    mime: str,
    created_by: str,
    folder: str = "",
    department_id: str | None = None,
) -> int:
    """Store one upload's files in the batch (the caller commits). Returns how many files
    were added; skipped zip entries go to the batch report. Raises unpack.UnpackError for a
    zip that cannot be opened at all. `data` may be the upload's buffer (a zip is read from
    it in place, P29)."""
    added = 0
    skipped: list[dict[str, str]] = []
    skipped_more = 0

    async def store(entry: unpack.Entry) -> None:
        nonlocal added
        f = await doc_service.create_file(
            db,
            workspace_id=batch.workspace_id,
            branch_id=batch.branch_id,
            name=entry.name,
            data=entry.data,
            created_by=created_by,
            mime="" if entry.path != name else mime,
            folder=entry.folder,
            source_path=entry.path,
            batch_id=batch.id,
            department_id=department_id,
        )
        db.expunge(f)  # the bytes are written; do not hold every file in memory
        added += 1

    head = data.getbuffer()[:4096].tobytes() if isinstance(data, io.BytesIO) else data[:4096]
    if unpack.is_zip(head, name):
        gen = unpack.entries(data, name, base=folder)
        first = True
        while True:
            try:
                item = await asyncio.to_thread(next, gen, None)
            except unpack.UnpackError:
                if first:
                    raise
                break
            first = False
            if item is None:
                break
            if isinstance(item, unpack.Report):
                skipped, skipped_more = item.skipped, item.skipped_more
                break
            await store(item)
    else:
        # A file from a folder upload arrives named by its relative path ("A/B/c.pdf"):
        # its folders are kept under `folder`.
        path = name.replace("\\", "/")
        parent, _, base_name = path.rpartition("/")
        clean = unpack.clean_part(base_name) or "file"
        raw = data.getvalue() if isinstance(data, io.BytesIO) else data
        await store(unpack.Entry(unpack.join_folder(folder, parent), clean[:200], name[:500], raw))
    report = {**empty_report(), **(batch.report or {})}
    # P29: a batch keeps at most unpack.MAX_SKIPPED skip lines, plus how many more there were.
    every = list(report.get("skipped") or []) + skipped
    report["skipped"] = every[: unpack.MAX_SKIPPED]
    more = int(report.get("skipped_more") or 0) + skipped_more + len(every[unpack.MAX_SKIPPED :])
    if more:
        report["skipped_more"] = more
    batch.report = report
    batch.total = await _count(db, batch.id)
    batch.status = "reading"
    return added


async def _count(db: AsyncSession, batch_id: str, *, done: bool = False) -> int:
    q = select(func.count()).select_from(DocFile).where(DocFile.batch_id == batch_id)
    if done:
        q = q.where(DocFile.status != "reading")
    return int(await db.scalar(q) or 0)


# ---------------------------------------------------------------- sorting each file


class Sorter:
    """The after-read step: kind, department and library for one file."""

    def __init__(self, depts: list[sort.Dept]) -> None:
        self.depts = depts

    @classmethod
    async def load(cls, db: AsyncSession, branch_id: str | None) -> "Sorter":
        if not branch_id:
            return cls([])
        rows = await db.execute(
            select(Department.id, Department.name)
            .where(Department.branch_id == branch_id)
            .order_by(Department.position, Department.name)
        )
        return cls([sort.Dept(i, n) for i, n in rows.all()])

    def hint(self) -> str:
        return sort.hint(self.depts)

    async def apply(self, db: AsyncSession, f: DocFile, info: dict[str, Any]) -> None:
        text = "" if "text" in inspect(f).unloaded else (f.text or "")
        s = sort.kind_of(
            f.name,
            f.folder,
            text,
            str(info.get("category") or ""),
            str(info.get("kind") or ""),
        )
        f.kind = s.kind
        if f.department_id is None:
            f.department_id = sort.department_of(
                self.depts, f.name, f.folder, text, str(info.get("department") or "")
            )
        if not f.title:
            f.title = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", f.name)[:200]
        # How-to material joins the library (indexed once the file is ready); certificates,
        # contracts and accounts stay company files. Held-back files never join it.
        if s.kind in sort.HOW_TO and not f.quarantined and f.status != "failed":
            f.library = True


# ---------------------------------------------------------------- the worker's steps


async def pending(batch_id: str) -> list[str]:
    """Files of the batch still to read, oldest first."""
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(DocFile.id)
                    .where(DocFile.batch_id == batch_id, DocFile.status == "reading")
                    .order_by(DocFile.created_at, DocFile.id)
                )
            ).all()
        )


async def read_one(batch_id: str, file_id: str) -> str:
    """Read, scan and sort one file of the batch, then update the batch's progress."""
    async with SessionLocal() as db:
        b = await db.get(IntakeBatch, batch_id)
        f = await db.get(DocFile, file_id)
        if b is None or f is None or f.batch_id != batch_id:
            return "missing"
        status = f.status
        if status == "reading":
            sorter = await Sorter.load(db, b.branch_id)
            try:
                status = await doc_service.process_file(
                    db, file_id, hint=sorter.hint(), after=sorter.apply
                )
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the batch
                log.warning("intake could not read %s", file_id, exc_info=True)
                await db.rollback()
                f = await db.get(DocFile, file_id)
                if f is None:
                    return "missing"
                f.status = "failed"
                f.error = f"Could not read this file ({e.__class__.__name__})."
                status = "failed"
        await db.refresh(b)
        b.done = await _count(db, batch_id, done=True)
        b.total = await _count(db, batch_id)
        if b.status in ("unpacking", "ready", "failed"):
            b.status = "reading"
        await db.commit()
        await publish(b)
        return status


def _flag(f: DocFile) -> dict[str, Any] | None:
    rec = dict(f.sensitive or {})
    why = scan.reasons(rec)
    if not why:
        return None
    return {
        "file_id": f.id,
        "name": f.name,
        "folder": f.folder,
        "reasons": why,
        "detail": scan.describe(rec),
        "quarantined": f.quarantined,
    }


async def build_report(db: AsyncSession, b: IntakeBatch) -> dict[str, Any]:
    rows = (
        await db.scalars(
            select(DocFile)
            .where(DocFile.batch_id == b.id)
            .order_by(DocFile.folder, DocFile.name, DocFile.id)
        )
    ).all()
    old = b.report or {}
    flagged = [x for f in rows if (x := _flag(f))]
    return {
        **empty_report(),
        "by_kind": dict(Counter(f.kind or "other" for f in rows).most_common()),
        "by_department": dict(Counter(f.department_id or "" for f in rows).most_common()),
        "library": sum(1 for f in rows if f.library and not f.quarantined),
        "flagged": flagged,
        "held_back": sum(1 for f in rows if f.quarantined),
        "failed": [
            {"file_id": f.id, "name": f.name, "error": f.error or ""}
            for f in rows
            if f.status == "failed"
        ],
        "skipped": list(old.get("skipped") or []),
        **({"skipped_more": old["skipped_more"]} if old.get("skipped_more") else {}),
        "suggestions": list(old.get("suggestions") or []),
    }


async def _suggest(db: AsyncSession, b: IntakeBatch) -> list[dict[str, Any]] | None:
    """The builders' SOP and workflow suggestions (agentic/intake/builders.py, owned by the
    builders). None when their module or function is not there (keep what we had)."""
    try:
        from . import builders
    except ImportError:
        return None
    fn: Callable[..., Awaitable[Any]] | None = getattr(builders, "suggest_for_batch", None)
    if fn is None or not callable(fn):
        return None
    try:
        out = await fn(db, b)
    except Exception:  # noqa: BLE001 - suggestions are extra; the batch is still ready
        log.warning("suggestions failed for batch %s", b.id, exc_info=True)
        await db.rollback()
        return []
    items = [s for s in (out or []) if isinstance(s, dict)][:MAX_SUGGESTIONS]
    return json.loads(json.dumps(items, default=str))


async def finish(batch_id: str) -> str:
    """Report and suggestions once every file is read. Returns the batch status."""
    async with SessionLocal() as db:
        b = await db.get(IntakeBatch, batch_id)
        if b is None:
            return "missing"
        b.done = await _count(db, batch_id, done=True)
        b.total = await _count(db, batch_id)
        if b.done < b.total:
            await db.commit()
            return b.status  # an appended upload is still being read; its run finishes it
        b.status = "sorting"
        await db.commit()
        await publish(b)
        b.report = await build_report(db, b)
        await db.commit()
        suggestions = await _suggest(db, b)
        b = await db.get(IntakeBatch, batch_id)
        if b is None:
            return "missing"
        await db.refresh(b)
        report = dict(b.report or {})
        if suggestions is not None:
            report["suggestions"] = suggestions
        b.report = report
        b.status, b.error = "ready", None
        await db.commit()
        await publish(b)
        return b.status


async def fail(batch_id: str, error: str) -> None:
    async with SessionLocal() as db:
        b = await db.get(IntakeBatch, batch_id)
        if b is None:
            return
        b.status, b.error = "failed", error[:500]
        await db.commit()
        await publish(b)


async def run_inline(batch_id: str) -> str:
    """The whole worker side here and now (Temporal is down, or tests)."""
    try:
        for fid in await pending(batch_id):
            await read_one(batch_id, fid)
        return await finish(batch_id)
    except Exception as e:  # noqa: BLE001 - leave the batch saying what happened
        log.warning("intake batch %s failed", batch_id, exc_info=True)
        await fail(batch_id, f"Sorting stopped ({e.__class__.__name__}). Upload again.")
        return "failed"
