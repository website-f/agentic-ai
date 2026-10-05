"""Company documents (P24): the folder tree, previews, ZIP downloads, moving files between
folders, and holding back / releasing files the scan flagged.

Included before the files router, so /api/files/tree and /api/files/archive are not read
as a file id. Visibility is the files router's (documents.service.scoped); held-back
(quarantined) files are opened, previewed and downloaded only by people who manage files
(files.may_manage), and every release or hold is in the audit log.
"""

import io
import re
import zipfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ...core.db import SessionLocal, get_db
from ...documents import render_pdf, service
from ...documents.extract import sniff
from ...intake import scan, sort
from ...knowledge import indexer
from ...models import Branch, DocFile, IntakeBatch
from ...services import audit
from ..deps import Principal, api_error, require
from .files import (
    INLINE_SAFE,
    FileOut,
    check_branch,
    check_held_back,
    clean_folder,
    file_out,
    get_file,
    may_manage,
)

router = APIRouter(prefix="/api/files", tags=["company files"])

MAX_ARCHIVE = 1024 * 1024 * 1024  # 1 GB
CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
BANNER = (
    "HELD BACK FOR REVIEW: this file contains passwords or personal data. Agents cannot "
    "read it. Do not share it."
)
TEXT_KINDS = ("text", "csv")
STORED = (".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".docx", ".xlsx", ".pptx")


def _visible(principal: Principal, branch_id: str | None) -> Any:
    q = select(DocFile).where(DocFile.workspace_id == principal.workspace_id)
    if branch_id:
        q = q.where(DocFile.branch_id == branch_id)
    return service.scoped(q, DocFile, principal)


def _under(folder: str) -> Any:
    like = folder.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return or_(DocFile.folder == folder, DocFile.folder.like(f"{like}/%", escape="\\"))


# ---------------------------------------------------------------- tree


class FolderOut(BaseModel):
    path: str
    files: int  # everything under it, sub-folders included
    direct: int  # files sitting in this folder itself
    size: int
    kinds: dict[str, int]
    flagged: int  # files the scan flagged (held back or not)


class TreeOut(BaseModel):
    folders: list[FolderOut]
    total_files: int
    total_size: int
    root_files: int  # files at the top, in no folder


@router.get("/tree")
async def tree(
    branch_id: str | None = None,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> TreeOut:
    """Every folder path (parents included), sorted, with counts of what is under it."""
    q = _visible(principal, branch_id).with_only_columns(
        DocFile.folder, DocFile.kind, DocFile.size, DocFile.sensitive, DocFile.quarantined
    )
    folders: dict[str, dict[str, Any]] = {}
    total = size = root = 0
    for row in (await db.execute(q)).all():
        folder, kind, n = row.folder, row.kind, row.size
        sensitive, held = row.sensitive, row.quarantined
        total += 1
        size += n or 0
        flagged = bool(held or scan.reasons(sensitive or {}))
        parts = [p for p in (folder or "").split("/") if p]
        if not parts:
            root += 1
        for i in range(1, len(parts) + 1):
            path = "/".join(parts[:i])
            e = folders.setdefault(
                path, {"files": 0, "direct": 0, "size": 0, "kinds": {}, "flagged": 0}
            )
            e["files"] += 1
            e["size"] += n or 0
            e["kinds"][kind or "other"] = e["kinds"].get(kind or "other", 0) + 1
            e["flagged"] += int(flagged)
            if i == len(parts):
                e["direct"] += 1
    return TreeOut(
        folders=[FolderOut(path=p, **folders[p]) for p in sorted(folders, key=str.lower)],
        total_files=total,
        total_size=size,
        root_files=root,
    )


# ---------------------------------------------------------------- moving


class MoveIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    folder: str = Field(default="", max_length=300)


class MoveOut(BaseModel):
    moved: int
    folder: str


@router.post("/move")
async def move(
    body: MoveIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> MoveOut:
    folder = clean_folder(body.folder)
    ids = list(dict.fromkeys(body.ids))
    for fid in ids:
        f = await get_file(db, principal, fid)  # 404 for anything this person cannot see
        f.folder = folder
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.moved",
        after={"ids": ids[:50], "count": len(ids), "folder": folder},
    )
    await db.commit()
    return MoveOut(moved=len(ids), folder=folder)


# ---------------------------------------------------------------- preview


def _text_pdf(f: DocFile, text: str) -> bytes:
    body = text.strip() or (
        "This file is still being read."
        if f.status == "reading"
        else "No text could be read from this file. Download it to open it in its own program."
    )
    title = f"Text preview of {f.name}"
    body = f"*{title}*\n\n{body}"
    if f.quarantined:
        body = f"**{BANNER}**\n\n{body}"
    # Page marks from the reader become small headings, so the preview keeps its pages.
    body = re.sub(r"^\[page (\d+)\]$", r"### Page \1", body, flags=re.M)
    return render_pdf.render(body[:400_000], title, None, True)


def _image_png(data: bytes) -> bytes | None:
    """TIFF, BMP and other pictures browsers cannot show, as PNG."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        img.seek(0)
        out = io.BytesIO()
        img.convert("RGB").save(out, format="PNG")
        return out.getvalue()
    except Exception:  # noqa: BLE001 - not a picture after all: fall back to text
        return None


@router.get("/{file_id}/preview")
async def preview(
    file_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Something the browser can show for every file: PDFs and pictures as they are, text
    as plain text, and Word, Excel, PowerPoint (and anything else) as a PDF of its text."""
    f = await get_file(db, principal, file_id, library_ok=True)
    check_held_back(principal, f)
    row = await db.scalar(
        select(DocFile)
        .where(DocFile.id == f.id)
        .options(undefer(DocFile.data), undefer(DocFile.text))
    )
    data = bytes(row.data or b"") if row else b""
    text = (row.text if row else "") or ""
    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(f.name)}",
        "Content-Security-Policy": CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    kind = sniff(data, f.name, f.mime)
    if f.mime in INLINE_SAFE and (kind in ("pdf", "image")):
        return Response(content=data, media_type=f.mime, headers=headers)
    if kind == "image" and (png := _image_png(data)):
        return Response(content=png, media_type="image/png", headers=headers)
    if kind in TEXT_KINDS or f.mime.startswith("text/") or f.name.lower().endswith(".md"):
        body = data.decode("utf-8-sig", errors="replace")
        if f.quarantined:
            body = f"{BANNER}\n\n{body}"
        return Response(content=body, media_type="text/plain; charset=utf-8", headers=headers)
    pdf = _text_pdf(f, text)
    headers["Content-Disposition"] = (
        f"inline; filename*=UTF-8''{quote(re.sub(r'[.][^.]+$', '', f.name) + '.pdf')}"
    )
    return Response(content=pdf, media_type="application/pdf", headers=headers)


# ---------------------------------------------------------------- archive


def _safe_part(p: str) -> str:
    p = re.sub(r'[\x00-\x1f<>:"|?*]', "_", p).strip().strip(".")
    return p or "_"


def _arcname(folder: str, name: str, base: str, used: set[str]) -> str:
    parts = [p for p in folder.split("/") if p]
    if base:
        drop = len([p for p in base.split("/") if p]) - 1  # keep the chosen folder on top
        parts = parts[max(drop, 0) :]
    path = "/".join([*(_safe_part(p) for p in parts), _safe_part(name)])
    stem, dot, ext = path.rpartition(".")
    if not dot or "/" in ext:
        stem, ext = path, ""
    candidate, n = path, 2
    while candidate.lower() in used:
        candidate = f"{stem} ({n}).{ext}" if ext else f"{stem} ({n})"
        n += 1
    used.add(candidate.lower())
    return candidate


class _Sink:
    """A write-only stream zipfile can write to; chunks are handed out as they come."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def write(self, b: bytes) -> int:
        self.buf.extend(b)
        return len(b)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        out = bytes(self.buf)
        self.buf.clear()
        return out


def _ids(raw: list[str]) -> list[str]:
    return [i.strip() for chunk in raw for i in chunk.split(",") if i.strip()][:2000]


@router.get("/archive")
async def archive(
    branch_id: str | None = None,
    folder: str | None = Query(default=None, max_length=300),
    batch_id: str | None = Query(default=None, max_length=40),
    ids: list[str] = Query(default_factory=list),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """A ZIP of the files this person may see (a company, one folder and everything under
    it, one upload, or chosen ids), folders kept. Held-back files only for people who manage
    files (X-Held-Back says how many were left out). At most 1 GB."""
    await check_branch(db, principal, branch_id)
    base = clean_folder(folder) if folder else ""
    q = _visible(principal, branch_id).with_only_columns(
        DocFile.id, DocFile.folder, DocFile.name, DocFile.size, DocFile.quarantined
    )
    if base:
        q = q.where(_under(base))
    if batch_id:
        q = q.where(DocFile.batch_id == batch_id)
    chosen = _ids(ids)
    if chosen:
        q = q.where(DocFile.id.in_(chosen))
    rows = (await db.execute(q.order_by(DocFile.folder, DocFile.name, DocFile.id))).all()
    manager = may_manage(principal)
    held = sum(1 for r in rows if r.quarantined and not manager)
    rows = [r for r in rows if manager or not r.quarantined]
    if not rows:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "nothing_to_zip", "There are no files here to download."
        )
    total = sum(r.size or 0 for r in rows)
    if total > MAX_ARCHIVE:
        raise api_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "archive_too_large",
            "That is {size} MB of files; one download can hold up to 1 GB. Download one "
            "folder at a time.",
            size=total // (1024 * 1024),
        )
    title = await _zip_title(db, branch_id, base, batch_id, bool(chosen))
    used: set[str] = set()
    plan = [(r.id, _arcname(r.folder or "", r.name, base, used)) for r in rows]
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.archive",
        after={"files": len(plan), "size": total, "folder": base, "batch_id": batch_id},
    )
    await db.commit()

    async def chunks() -> AsyncIterator[bytes]:
        sink = _Sink()
        with zipfile.ZipFile(sink, "w", allowZip64=True) as zf:  # type: ignore[arg-type]
            for fid, arc in plan:
                async with SessionLocal() as s:
                    data = await s.scalar(select(DocFile.data).where(DocFile.id == fid))
                info = zipfile.ZipInfo(arc, date_time=datetime.now(UTC).timetuple()[:6])
                info.compress_type = (
                    zipfile.ZIP_STORED if arc.lower().endswith(STORED) else zipfile.ZIP_DEFLATED
                )
                zf.writestr(info, bytes(data or b""))
                yield sink.take()
        yield sink.take()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(title)}.zip",
            "X-Held-Back": str(held),
            "Cache-Control": "private, no-store",
        },
    )


async def _zip_title(
    db: AsyncSession, branch_id: str | None, base: str, batch_id: str | None, chosen: bool
) -> str:
    company = ""
    if branch_id:
        b = await db.get(Branch, branch_id)
        company = b.name if b else ""
    if batch_id:
        batch = await db.get(IntakeBatch, batch_id)
        what = batch.name if batch and batch.name else "Upload"
    elif base:
        what = base.rsplit("/", 1)[-1]
    else:
        what = "Selected files" if chosen else "All files"
    name = f"{company} - {what}" if company else what
    return re.sub(r'[\x00-\x1f\\/<>:"|?*]', "_", name).strip()[:120] or "files"


# ---------------------------------------------------------------- hold back / release


class ReviewIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@router.post("/{file_id}/release")
async def release(
    file_id: str,
    body: ReviewIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    """A manager checked a held-back file and lets agents read it. The scan's record stays
    (with who released it and why); how-to material from an upload then joins the library."""
    from .library import start_index

    if not may_manage(principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only people who manage files can release a held-back file.",
        )
    f = await get_file(db, principal, file_id)
    if not f.quarantined:
        raise api_error(status.HTTP_400_BAD_REQUEST, "not_held_back", "This file is not held back.")
    before = {"quarantined": True, "sensitive": scan.reasons(f.sensitive or {})}
    f.quarantined = False
    f.sensitive = {
        **(f.sensitive or {}),
        "released": True,
        "reviewed_by": principal.actor,
        "reviewed_at": _now(),
        "review_reason": body.reason.strip(),
    }
    if f.batch_id and f.kind in sort.HOW_TO and f.status == "ready":
        f.library = True
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.released",
        target=f.id,
        before=before,
        after={"quarantined": False, "library": f.library},
        note=body.reason.strip(),
    )
    await db.commit()
    if f.library and f.status == "ready":
        await start_index("file", f.id)
    await db.refresh(f)
    return await file_out(db, f)


@router.post("/{file_id}/quarantine")
async def quarantine(
    file_id: str,
    body: ReviewIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FileOut:
    """Hold a file back (again): agents stop seeing it and its library passages go at once.
    Anyone who may change the file can do this; only managers release it."""
    f = await get_file(db, principal, file_id)
    if f.quarantined:
        return await file_out(db, f)
    f.quarantined = True
    f.sensitive = {
        **(f.sensitive or {}),
        "released": False,
        "held_by": principal.actor,
        "held_at": _now(),
        "review_reason": body.reason.strip(),
    }
    f.indexed_at = None
    await indexer.remove(db, "file", f.id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "file.held_back",
        target=f.id,
        after={"quarantined": True},
        note=body.reason.strip(),
    )
    await db.commit()
    await db.refresh(f)
    return await file_out(db, f)
