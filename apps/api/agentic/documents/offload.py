"""P149a: background storage jobs: file bytes moved off the VPS, older files made smaller.

The owner (28 Nov 2026): "Compress all Library files to the smallest size. Store all Library
uploads (super-compressed but quality and content original) on our S3 file server so they
don't consume the VPS storage ... don't touch their work and tasks."

Two jobs per workspace, each switched on by the owner (storage settings page or the CLI below)
and run by the `storage-jobs` schedule (workflows/storage_workflows.py) a few minutes at a time:

- move      every file whose bytes are in Postgres (files.data) or on this server's disk is
            uploaded to the workspace's primary storage (made smaller first in quiet hours, as
            P143c does for new uploads), checked there (size, then the ETag's MD5 or the bytes'
            SHA-256 read back), and only then is its pointer switched and files.data cleared.
- compress  files saved before P143c (or moved in office hours) made smaller where they are;
            each new version is written under its own key and the pointer switched, so a file
            is never half-replaced. Quiet hours only (it is CPU work).

Not disturbing work: one file at a time, committed on its own; small pauses and a byte rate
between files (gentler in office hours); a file being read (status "reading", recently
touched) is left for later; the switch is one UPDATE guarded by the row's updated_at (any
change meanwhile = try again later) under a 3 s lock_timeout, and it keeps updated_at as it was
(lists ordered by "last changed" do not move). Reads never stop: storage.read() finds the bytes
wherever they are at that moment. A restart continues from the cursor; a storage that keeps
failing pauses the job (with the reason) instead of retrying forever.

CLI (the lead's commands; prints no secret):
    python -m agentic.documents.offload status
    python -m agentic.documents.offload start move|compress [<workspace id>|all]
    python -m agentic.documents.offload pause|resume move|compress [<workspace id>|all]
    python -m agentic.documents.offload backup-status   < status.json   (deploy/backup)
"""

import asyncio
import hashlib
import json
import logging
import re
import sys
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import BigInteger, and_, cast, func, or_, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..models import DocFile, StorageJob, StorageTarget, Workspace
from . import compress, filecache, storage

log = logging.getLogger("agentic.offload")

MOVE, COMPRESS = "move", "compress"
KINDS = (MOVE, COMPRESS)
BACKUP_ID = "backup"
ACTOR = "system:storage"
BATCH = 10  # file ids fetched at a time
TICK_SECONDS = 240.0  # one schedule run works at most this long
BUSY = timedelta(hours=2)  # a file "reading" more recently than this is being processed
LOCK_TIMEOUT = "3s"
ERRORS_IN_ROW = 5  # storage failures in a row before the job pauses itself
KEEP_ERRORS = 200  # files that failed, left out until the job is started again
# (seconds between files, bytes per second) in office hours / quiet hours.
PACE = {"office": (1.0, 2 * 1024 * 1024), "quiet": (0.1, 8 * 1024 * 1024)}
MYT = timedelta(hours=8)  # Malaysia: UTC+8, no daylight saving
VACUUM_HINT = (
    "docker exec agentic-postgres-1 psql -U agentic -d agentic "
    "-c \"SET lock_timeout = '5s'; VACUUM (FULL, ANALYZE) files;\""
)


def job_id(kind: str, workspace_id: str) -> str:
    return f"{kind}:{workspace_id}"


def quiet_hours(now: datetime | None = None) -> bool:
    """20:00-07:00 Malaysia time and weekends: nobody waits on the server then."""
    local = (now or datetime.now(UTC)) + MYT
    return local.weekday() >= 5 or local.hour >= 20 or local.hour < 7


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- the switches


async def get_job(db: AsyncSession, kind: str, workspace_id: str) -> StorageJob | None:
    return await db.get(StorageJob, job_id(kind, workspace_id), populate_existing=True)


async def set_job(
    db: AsyncSession, kind: str, workspace_id: str, action: str, actor: str
) -> StorageJob:
    """start | pause | resume | stop. Start (and resume) also forgets the files that failed
    before, so they are tried again. The caller commits."""
    from ..services import audit

    if kind not in KINDS or action not in ("start", "pause", "resume", "stop"):
        raise ValueError(f"unknown job or action: {kind} {action}")
    j = await get_job(db, kind, workspace_id)
    if j is None:
        j = StorageJob(id=job_id(kind, workspace_id), workspace_id=workspace_id, state={})
        db.add(j)
    state = dict(j.state or {})
    if action == "start":
        j.enabled, j.paused = True, False
        state.update({"started_at": _now(), "started_by": actor, "finished_at": None, "cursor": ""})
    elif action == "resume":
        j.paused = False
    elif action == "pause":
        j.paused = True
    else:
        j.enabled = False
    if action in ("start", "resume"):
        state.update({"error_files": [], "errors_in_row": 0, "auto_paused": None})
    j.state = state
    await audit.record(db, workspace_id, actor, f"storage.job.{action}", j.id, after={"job": kind})
    await db.flush()
    return j


async def _save(job: str, **changes: Any) -> dict[str, Any]:
    """Merge `changes` into a job's state (its own short transaction; numbers given as
    ("+", n) are added). Returns the state, with `enabled` / `paused` as stored now."""
    async with SessionLocal() as db:
        j = await db.get(StorageJob, job, with_for_update=True)
        if j is None:
            return {"enabled": False, "paused": True}
        state = dict(j.state or {})
        for k, v in changes.items():
            if isinstance(v, tuple) and v[0] == "+":
                state[k] = int(state.get(k) or 0) + int(v[1])
            else:
                state[k] = v
        state["last_run"] = _now()
        await db.execute(update(StorageJob).where(StorageJob.id == job).values(state=state))
        out = {**state, "enabled": j.enabled, "paused": j.paused}
        await db.commit()
        return out


async def _auto_pause(job: str, reason: str) -> None:
    async with SessionLocal() as db:
        await db.execute(update(StorageJob).where(StorageJob.id == job).values(paused=True))
        await db.commit()
    await _save(job, auto_paused=reason[:300], paused_at=_now())
    log.warning("storage job %s paused itself: %s", job, reason)


# ---------------------------------------------------------------- shared steps


async def _verify(t: StorageTarget, key: str, data: bytes, sha: str) -> str | None:
    """The stored copy is the bytes sent: same size, and the MD5 ETag (a single upload to
    S3) or else the SHA-256 of the bytes read back. Returns the ETag, None when it is not."""
    h = await storage.head(t, key)
    if h is None or h[0] != len(data):
        return None
    etag = h[1]
    if t.kind == "s3" and re.fullmatch(r"[0-9a-f]{32}", etag or ""):
        return etag if etag == hashlib.md5(data, usedforsecurity=False).hexdigest() else None
    back = await storage.get(t, key)
    return (etag or sha[:32]) if _sha(back) == sha else None


async def _drop_object(t: StorageTarget, key: str) -> None:
    try:
        await storage.delete(t, key)
    except (storage.StorageError, httpx.HTTPError) as e:
        log.warning("could not remove %s from %s: %s", key, t.id, e)


def _compressed(data: bytes, name: str, now: str) -> tuple[bytes, dict[str, Any], str | None]:
    """(bytes to keep, files.compression, method when smaller) as P143c records it."""
    try:
        res = compress.compress_bytes(data, name)
    except compress.Skip as s:
        res, why = None, s.reason
    except Exception as e:  # noqa: BLE001 - a file that cannot be compressed keeps its bytes
        res, why = None, f"failed: {e.__class__.__name__}"
    else:
        why = "" if res else "not smaller"
    if res is None:
        return data, {"result": "kept", "reason": why, "original_size": len(data), "at": now}, None
    return (
        res.data,
        {
            "result": "smaller",
            "original_size": len(data),
            "original_sha256": _sha(data),
            "method": res.method,
            "at": now,
        },
        res.method,
    )


async def _audit_smaller(
    db: AsyncSession, ws: str, file_id: str, old: bytes, new: bytes, method: str
) -> None:
    from ..i18n import tr
    from ..services import audit

    await audit.record(
        db,
        ws,
        compress.ACTOR,
        "file.compressed",
        file_id,
        before={"size": len(old), "sha256": _sha(old)},
        after={"size": len(new), "sha256": _sha(new), "method": method},
        note=tr(
            "Compressed from {before} to {after}; same file type.",
            "en",
            before=compress.human(len(old)),
            after=compress.human(len(new)),
        ),
    )


def _busy(f: DocFile) -> bool:
    return f.status == "reading" and (
        f.updated_at is None or f.updated_at > datetime.now(UTC) - BUSY
    )


async def _switch(
    db: AsyncSession,
    file_id: str,
    updated_at: datetime,
    old_sid: str | None,
    old_key: str | None,
    values: dict[str, Any],
) -> str:
    """One guarded UPDATE: only when the row is as it was read. "ok" | "changed" | "busy"."""
    place = (
        DocFile.storage_id.is_(None)
        if old_sid is None
        else and_(DocFile.storage_id == old_sid, DocFile.storage_key == old_key)
    )
    try:
        await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
        r = await db.execute(
            update(DocFile)
            .where(DocFile.id == file_id, DocFile.updated_at == updated_at, place)
            .values(**values, updated_at=DocFile.updated_at)  # "last changed" stays as it was
            .execution_options(synchronize_session=False)
        )
    except DBAPIError:  # lock_timeout: someone is working on the file right now
        await db.rollback()
        return "busy"
    if r.rowcount != 1:  # type: ignore[attr-defined]
        await db.rollback()
        return "changed"
    return "ok"


async def _fresh(db: AsyncSession, file_id: str) -> DocFile | None:
    return await db.get(DocFile, file_id, populate_existing=True)


# ---------------------------------------------------------------- move


def _move_filter(ws: str, local_ids: list[str]) -> Any:
    in_db = and_(DocFile.storage_id.is_(None), DocFile.data.is_not(None))
    if not local_ids:
        return and_(DocFile.workspace_id == ws, in_db)
    on_disk = and_(DocFile.storage_id.in_(local_ids), DocFile.storage_key.like("agentic/%"))
    return and_(DocFile.workspace_id == ws, or_(in_db, on_disk))


async def _local_ids(db: AsyncSession, ws: str, target_id: str) -> list[str]:
    return list(
        (
            await db.scalars(
                select(StorageTarget.id).where(
                    StorageTarget.workspace_id == ws,
                    StorageTarget.kind == "local",
                    StorageTarget.id != target_id,
                )
            )
        ).all()
    )


async def move_one(
    db: AsyncSession, target: StorageTarget, file_id: str, *, squeeze: bool
) -> tuple[str, int, int]:
    """Move one file's bytes to `target`. Returns (result, bytes before, bytes after);
    result is moved | changed | busy | gone | skipped | error:<reason>. Raises StorageError /
    httpx.HTTPError when the target itself fails (the job counts those)."""
    f = await _fresh(db, file_id)
    if f is None:
        return "gone", 0, 0
    if _busy(f):
        await db.rollback()
        return "busy", 0, 0
    ws, name, updated_at = f.workspace_id, f.name, f.updated_at
    old_sid, old_key = f.storage_id, f.storage_key
    src: StorageTarget | None = None
    if old_sid is None:
        data = await storage.db_bytes(db, file_id)
        if data is None:
            await db.rollback()
            return "gone", 0, 0
    else:
        src = await db.get(StorageTarget, old_sid)
        if src is None or src.kind != "local" or not (old_key or "").startswith("agentic/"):
            await db.rollback()
            return "skipped", 0, 0
        try:
            data = await storage.get(src, old_key or "")
        except storage.StorageError as e:
            await db.rollback()
            return f"error:{e}", 0, 0
    try_squeeze = squeeze and compress.skip_reason(f) is None
    known_sha = f.sha256 or ""
    await db.commit()  # nothing stays open while the bytes travel
    now = _now()
    comp: dict[str, Any] | None = None
    method: str | None = None
    new = data
    if try_squeeze:
        new, comp, method = await asyncio.to_thread(_compressed, data, name, now)
    new_sha = _sha(new)
    key = storage.file_key(f, new_sha)
    await storage.put(target, key, new)
    etag = await _verify(target, key, new, new_sha)
    if etag is None:
        await _drop_object(target, key)
        return "error:the stored copy did not match", 0, 0
    values: dict[str, Any] = {
        "storage_id": target.id,
        "storage_key": key,
        "storage_etag": etag[:200],
        "data": None,
    }
    if comp is not None:
        values["compression"] = comp
    if method:
        values.update(size=len(new), sha256=new_sha)
    elif not known_sha:
        values["sha256"] = new_sha
    result = await _switch(db, file_id, updated_at, old_sid, old_key, values)
    if result != "ok":
        await _drop_object(target, key)
        return result, 0, 0
    if method:
        await _audit_smaller(db, ws, file_id, data, new, method)
    await db.commit()
    if src is not None and old_key:
        await _drop_object(src, old_key)  # the copy on this server's disk
    return "moved", len(data), len(new)


async def _pace(nbytes: int, started: float) -> None:
    gap, rate = PACE["quiet" if quiet_hours() else "office"]
    wait = max(gap, nbytes / rate - (time.monotonic() - started))
    await asyncio.sleep(wait)


async def run_move(workspace_id: str, deadline: float) -> dict[str, Any]:
    """Work on the move job until the deadline, the end, or a pause."""
    jid = job_id(MOVE, workspace_id)
    async with SessionLocal() as db:
        target = await storage.primary(db, workspace_id)
        if target is None:
            return await _save(jid, last_error="No storage is set to keep new files.")
        local_ids = await _local_ids(db, workspace_id, target.id)
        state = dict((await db.get(StorageJob, jid)).state or {})  # type: ignore[union-attr]
    cursor = str(state.get("cursor") or "")
    failed = list(state.get("error_files") or [])
    moved_in_pass = 0
    while time.monotonic() < deadline:
        async with SessionLocal() as db:
            q = (
                select(DocFile.id)
                .where(_move_filter(workspace_id, local_ids), DocFile.id > cursor)
                .order_by(DocFile.id)
                .limit(BATCH)
            )
            if failed:
                q = q.where(DocFile.id.not_in(failed))
            ids = list((await db.scalars(q)).all())
        if not ids:
            if cursor and moved_in_pass:  # files skipped as busy get another pass
                cursor, moved_in_pass = "", 0
                await _save(jid, cursor="", passes=("+", 1))
                continue
            if cursor:
                cursor = ""
                await _save(jid, cursor="")
            return await _save(jid, finished_at=_now())
        for fid in ids:
            if time.monotonic() >= deadline:
                return await _save(jid, cursor=cursor)
            started = time.monotonic()
            try:
                async with SessionLocal() as db:
                    result, before, after = await move_one(db, target, fid, squeeze=quiet_hours())
            except (storage.StorageError, httpx.HTTPError) as e:
                msg = str(e) or e.__class__.__name__
                st = await _save(jid, errors=("+", 1), errors_in_row=("+", 1), last_error=msg[:300])
                if int(st.get("errors_in_row") or 0) >= ERRORS_IN_ROW:
                    await _auto_pause(jid, msg)
                    return st
                await asyncio.sleep(5)
                continue
            cursor = fid
            if result == "moved":
                moved_in_pass += 1
                st = await _save(
                    jid,
                    cursor=cursor,
                    moved=("+", 1),
                    bytes_before=("+", before),
                    bytes_after=("+", after),
                    errors_in_row=0,
                )
            elif result.startswith("error:"):
                failed = (failed + [fid])[-KEEP_ERRORS:]
                st = await _save(
                    jid,
                    cursor=cursor,
                    errors=("+", 1),
                    error_files=failed,
                    last_error=f"{fid}: {result[6:]}"[:300],
                )
            else:
                st = await _save(jid, cursor=cursor, **{result: ("+", 1)})
            if not st.get("enabled") or st.get("paused"):
                return st
            await _pace(after or before, started)
    return await _save(jid, cursor=cursor)


# ---------------------------------------------------------------- compress


def _compress_filter(ws: str, move_on: bool) -> Any:
    cond = [
        DocFile.workspace_id == ws,
        DocFile.compression.is_(None),
        DocFile.status == "ready",
        DocFile.quarantined.is_(False),
        DocFile.restricted.is_(False),
        DocFile.source != "generated",
        DocFile.document_id.is_(None),
        DocFile.report_id.is_(None),
        DocFile.size >= compress.MIN_BYTES,
        DocFile.size <= compress.MAX_BYTES,
    ]
    ours = and_(DocFile.storage_id.is_not(None), DocFile.storage_key.like("agentic/%"))
    # While the move runs, files still in Postgres are made smaller on their way out.
    cond.append(ours if move_on else or_(DocFile.storage_id.is_(None), ours))
    return and_(*cond)


async def compress_one(db: AsyncSession, file_id: str) -> tuple[str, int, int]:
    """Make one stored file smaller where it is. (result, bytes before, bytes after); result
    is smaller | kept | changed | busy | gone | the P143c skip reason | error:<reason>."""
    f = await _fresh(db, file_id)
    if f is None:
        return "gone", 0, 0
    reason = compress.skip_reason(f)
    if reason:
        await db.rollback()
        return reason, 0, 0
    ws, name, updated_at = f.workspace_id, f.name, f.updated_at
    sid, key = f.storage_id, f.storage_key
    t = await db.get(StorageTarget, sid) if sid else None
    if sid and t is None:
        await db.rollback()
        return "gone", 0, 0
    try:
        data = await storage.read(db, f)
    except storage.StorageError as e:
        await db.rollback()
        return f"error:{e}", 0, 0
    await db.commit()
    now = _now()
    new, comp, method = await asyncio.to_thread(_compressed, data, name, now)
    if not method:
        result = await _switch(db, file_id, updated_at, sid, key, {"compression": comp})
        if result == "ok":
            await db.commit()
            return "kept", len(data), len(data)
        return result, 0, 0
    new_sha = _sha(new)
    values: dict[str, Any] = {"compression": comp, "size": len(new), "sha256": new_sha}
    new_key = None
    if t is not None:
        new_key = storage.file_key(f, new_sha)
        await storage.put(t, new_key, new)
        etag = await _verify(t, new_key, new, new_sha)
        if etag is None:
            await _drop_object(t, new_key)
            return "error:the stored copy did not match", 0, 0
        values.update(storage_key=new_key, storage_etag=etag[:200])
    else:
        values["data"] = new
    result = await _switch(db, file_id, updated_at, sid, key, values)
    if result != "ok":
        if t is not None and new_key:
            await _drop_object(t, new_key)
        return result, 0, 0
    await _audit_smaller(db, ws, file_id, data, new, method)
    await db.commit()
    filecache.drop(file_id)
    if t is not None and key and key != new_key and key.startswith("agentic/"):
        await _drop_object(t, key)
    return "smaller", len(data), len(new)


async def run_compress(workspace_id: str, deadline: float) -> dict[str, Any]:
    jid = job_id(COMPRESS, workspace_id)
    async with SessionLocal() as db:
        state = dict((await db.get(StorageJob, jid)).state or {})  # type: ignore[union-attr]
        mv = await get_job(db, MOVE, workspace_id)
        move_on = bool(mv and mv.enabled and not (mv.state or {}).get("finished_at"))
    cursor = str(state.get("cursor") or "")
    failed = list(state.get("error_files") or [])
    while time.monotonic() < deadline:
        if not quiet_hours():
            return await _save(jid, cursor=cursor, waiting="office hours")
        async with SessionLocal() as db:
            q = (
                select(DocFile.id)
                .where(_compress_filter(workspace_id, move_on), DocFile.id > cursor)
                .order_by(DocFile.id)
                .limit(BATCH)
            )
            if failed:
                q = q.where(DocFile.id.not_in(failed))
            ids = list((await db.scalars(q)).all())
        if not ids:
            if cursor:
                cursor = ""
                await _save(jid, cursor="")
                continue
            return await _save(jid, finished_at=_now(), waiting=None)
        for fid in ids:
            if time.monotonic() >= deadline:
                return await _save(jid, cursor=cursor)
            started = time.monotonic()
            try:
                async with SessionLocal() as db:
                    result, before, after = await compress_one(db, fid)
            except (storage.StorageError, httpx.HTTPError) as e:
                msg = str(e) or e.__class__.__name__
                st = await _save(jid, errors=("+", 1), errors_in_row=("+", 1), last_error=msg[:300])
                if int(st.get("errors_in_row") or 0) >= ERRORS_IN_ROW:
                    await _auto_pause(jid, msg)
                    return st
                await asyncio.sleep(5)
                continue
            cursor = fid
            if result == "smaller":
                st = await _save(
                    jid,
                    cursor=cursor,
                    smaller=("+", 1),
                    bytes_before=("+", before),
                    bytes_after=("+", after),
                    errors_in_row=0,
                    waiting=None,
                )
            elif result.startswith("error:"):
                failed = (failed + [fid])[-KEEP_ERRORS:]
                st = await _save(
                    jid,
                    cursor=cursor,
                    errors=("+", 1),
                    error_files=failed,
                    last_error=f"{fid}: {result[6:]}"[:300],
                )
            else:
                st = await _save(jid, cursor=cursor, **{result.replace(" ", "_"): ("+", 1)})
            if not st.get("enabled") or st.get("paused"):
                return st
            await _pace(before, started)
    return await _save(jid, cursor=cursor)


# ---------------------------------------------------------------- the schedule


async def tick(budget: float = TICK_SECONDS) -> dict[str, int]:
    """One run of the `storage-jobs` schedule: each switched-on job works in turn until the
    time is used up."""
    deadline = time.monotonic() + budget
    async with SessionLocal() as db:
        jobs = (
            await db.execute(
                select(StorageJob.id, StorageJob.workspace_id)
                .where(
                    StorageJob.enabled.is_(True),
                    StorageJob.paused.is_(False),
                    StorageJob.workspace_id.is_not(None),
                )
                .order_by(StorageJob.id)
            )
        ).all()
    ran = 0
    for jid, ws in jobs:
        if time.monotonic() >= deadline:
            break
        kind = jid.split(":", 1)[0]
        try:
            if kind == MOVE:
                await run_move(ws, deadline)
            elif kind == COMPRESS:
                await run_compress(ws, deadline)
            ran += 1
        except Exception as e:  # noqa: BLE001 - one job failing never stops the others
            log.exception("storage job %s failed", jid)
            await _save(jid, last_error=f"{e.__class__.__name__}"[:300], errors=("+", 1))
    return {"jobs": len(jobs), "ran": ran}


# ---------------------------------------------------------------- what the owner sees


async def overview(db: AsyncSession, workspace_id: str) -> dict[str, Any]:
    """Progress of both jobs, where the bytes are, what Postgres can give back, the cache and
    the last backup: the storage settings page's status card."""
    target = await storage.primary(db, workspace_id)
    ws = DocFile.workspace_id == workspace_id
    in_db = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(DocFile.size), 0)).where(
                ws, DocFile.storage_id.is_(None), DocFile.data.is_not(None)
            )
        )
    ).one()
    on_target = (0, 0)
    if target is not None:
        on_target = (
            await db.execute(
                select(func.count(), func.coalesce(func.sum(DocFile.size), 0)).where(
                    ws, DocFile.storage_id == target.id
                )
            )
        ).one()
    to_compress = await db.scalar(select(func.count()).where(_compress_filter(workspace_id, False)))
    saved = await db.scalar(
        select(
            func.coalesce(
                func.sum(
                    cast(DocFile.compression["original_size"].astext, BigInteger) - DocFile.size
                ),
                0,
            )
        ).where(ws, DocFile.compression["result"].astext == "smaller")
    )
    jobs: dict[str, Any] = {}
    for kind in KINDS:
        j = await get_job(db, kind, workspace_id)
        st = dict(j.state or {}) if j else {}
        st.pop("error_files", None)
        st.pop("cursor", None)
        jobs[kind] = {
            "enabled": bool(j and j.enabled),
            "paused": bool(j and j.paused),
            "updated_at": j.updated_at.isoformat() if j and j.updated_at else None,
            **st,
        }
    b = await db.get(StorageJob, BACKUP_ID, populate_existing=True)
    files_bytes, toast_bytes, data_left = (
        await db.execute(
            text(
                "SELECT pg_total_relation_size('files'), "
                "COALESCE(pg_total_relation_size(c.reltoastrelid), 0), "
                "(SELECT COALESCE(SUM(pg_column_size(data)), 0) FROM files) "
                "FROM pg_class c WHERE c.oid = 'files'::regclass"
            )
        )
    ).one()
    text_left = await db.scalar(text("SELECT COALESCE(SUM(pg_column_size(text)), 0) FROM files"))
    cache_files, cache_bytes = await asyncio.to_thread(filecache.usage)
    return {
        "primary": {"id": target.id, "name": target.name, "kind": target.kind} if target else None,
        "in_database": {"files": int(in_db[0]), "bytes": int(in_db[1])},
        "on_primary": {"files": int(on_target[0]), "bytes": int(on_target[1])},
        "to_compress": int(to_compress or 0),
        "saved_by_compression": int(saved or 0),
        "jobs": jobs,
        "quiet_hours": quiet_hours(),
        "database": {
            "files_table_bytes": int(files_bytes),
            "file_bytes_inside": int(data_left),
            # Dead space VACUUM FULL would give back (an estimate: toast minus what is live).
            "reclaimable_bytes": max(0, int(toast_bytes) - int(data_left) - int(text_left or 0)),
            "how": VACUUM_HINT,
        },
        "cache": {
            "files": cache_files,
            "bytes": cache_bytes,
            "cap_bytes": filecache.cap_bytes(),
        },
        "backup": dict(b.state or {}) if b else None,
    }


BACKUP_KEYS = (
    "ok",
    "date",
    "started_at",
    "finished_at",
    "bytes",
    "objects",
    "bucket_prefix",
    "kept",
    "deleted",
    "error",
    "verified",
    "local_kept",
)


async def record_backup(payload: dict[str, Any]) -> None:
    """deploy/backup/s3backup.py's report of a nightly backup (only the known fields)."""
    state = {k: payload[k] for k in BACKUP_KEYS if k in payload}
    if not state.get("ok"):
        state.setdefault("error", "failed")
    async with SessionLocal() as db:
        j = await db.get(StorageJob, BACKUP_ID, with_for_update=True)
        if j is None:
            j = StorageJob(id=BACKUP_ID, workspace_id=None, enabled=True, state={})
            db.add(j)
        prev = dict(j.state or {})
        if state.get("ok"):
            state["last_ok_at"] = state.get("finished_at")
            state["last_ok_bytes"] = state.get("bytes")
        else:
            state["last_ok_at"] = prev.get("last_ok_at")
            state["last_ok_bytes"] = prev.get("last_ok_bytes")
        j.state = state
        await db.commit()


# ---------------------------------------------------------------- CLI


async def _cli(argv: list[str]) -> int:
    cmd = argv[0] if argv else "status"
    if cmd == "backup-status":
        await record_backup(json.loads(sys.stdin.read() or "{}"))
        print("backup status saved")
        return 0
    async with SessionLocal() as db:
        if cmd in ("start", "pause", "resume", "stop"):
            kind = argv[1] if len(argv) > 1 else ""
            which = argv[2] if len(argv) > 2 else "all"
            ids = (
                list((await db.scalars(select(Workspace.id))).all()) if which == "all" else [which]
            )
            for ws in ids:
                j = await set_job(db, kind, ws, cmd, "system:cli")
                print(f"{j.id}: enabled={j.enabled} paused={j.paused}")
            await db.commit()
            return 0
        if cmd == "status":
            for ws in (await db.scalars(select(Workspace.id))).all():
                print(json.dumps({"workspace": ws, **await overview(db, ws)}, default=str))
            return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(asyncio.run(_cli(sys.argv[1:])))
