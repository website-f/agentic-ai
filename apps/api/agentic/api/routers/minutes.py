"""Meeting minutes from a recording (Meetings > People meetings).

POST /api/minutes/upload takes the recording as the raw request body (application/
octet-stream, like /api/files) and streams it to the media folder, so a 1 GB video never sits
in memory or in Postgres. nginx has a matching location with a large body limit and request
buffering off (deploy/nginx/web.conf). Processing runs on the worker; this router reads the
progress, the transcript and the minutes, and turns action items into tasks.

Who sees a recording: the person who uploaded it, and everyone who would see its minutes in
the library (its company / department scope). Who changes it: work.write inside that scope.
"""

import logging
import shutil
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.config import settings
from ...core.db import get_db
from ...core.ids import new_id
from ...core.security import can
from ...documents import service as doc_service
from ...knowledge import indexer
from ...knowledge import search as library
from ...minutes import audio, service
from ...models import (
    Agent,
    Branch,
    Department,
    DocFile,
    Document,
    MeetingRecording,
    User,
    Workspace,
)
from ...services import audit, events
from ..deps import Principal, api_error, require
from .library import Names

router = APIRouter(prefix="/api/minutes", tags=["minutes"])
log = logging.getLogger("agentic.api.minutes")

UPLOAD_PATH = "/api/minutes/upload"
DISK_MARGIN = 2 * 1024**3  # keep 2 GB free for ffmpeg and everything else


# ---------------------------------------------------------------- shapes


class ActionItemOut(BaseModel):
    index: int
    what: str
    owner: str
    due: str
    due_date: str
    owner_agent_id: str | None
    owner_label: str
    task_id: str | None


class RecordingOut(BaseModel):
    id: str
    title: str
    status: str
    stage_detail: str
    language: str
    original_name: str
    size: int
    duration_seconds: float | None
    chunks_total: int
    chunks_done: int
    branch_id: str | None
    department_id: str | None
    scope_label: str
    created_by: str
    created_by_name: str
    created_at: datetime
    finished_at: datetime | None
    error: str | None
    summary: str
    action_count: int
    open_actions: int
    decision_count: int
    document_id: str | None
    library_file_id: str | None
    published_at: datetime | None
    audio_available: bool
    audio_expires_at: datetime | None
    cost_usd: float
    can_edit: bool


class RecordingDetail(RecordingOut):
    heard_language: str | None
    transcript: list[dict[str, Any]]
    minutes: dict[str, Any] | None
    action_items: list[ActionItemOut]
    markdown: str
    document_status: str | None
    document_version: int | None
    published_stale: bool  # the minutes changed after the last publish


# ---------------------------------------------------------------- scope


def _read_where(principal: Principal) -> Any:
    """SQL: recordings this person sees (their own, and what the library shows them)."""
    r = library.for_person(principal)
    if r.everything:
        return true()
    b, d = MeetingRecording.branch_id, MeetingRecording.department_id
    conds = [or_(b.is_(None), b == r.branch_id) if r.branch_id else b.is_(None)]
    if not r.all_departments:
        conds.append(or_(d.is_(None), d == r.department_id) if r.department_id else d.is_(None))
    return or_(MeetingRecording.created_by == principal.actor, and_(*conds))


def can_edit(principal: Principal, rec: MeetingRecording) -> bool:
    if not can(principal.role, "work.write"):
        return False
    sc = principal.scope
    if sc.everything or rec.created_by == principal.actor:
        return True
    if sc.kind == "branch":
        return rec.branch_id is not None and rec.branch_id == sc.branch_id
    if sc.kind == "department":
        return rec.department_id is not None and rec.department_id == sc.department_id
    return False


async def _get(db: AsyncSession, principal: Principal, rec_id: str) -> MeetingRecording:
    rec = await db.scalar(
        select(MeetingRecording).where(
            MeetingRecording.id == rec_id,
            MeetingRecording.workspace_id == principal.workspace_id,
            _read_where(principal),
        )
    )
    if rec is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "recording_not_found", "That meeting is not here."
        )
    return rec


async def _editable(db: AsyncSession, principal: Principal, rec_id: str) -> MeetingRecording:
    rec = await _get(db, principal, rec_id)
    if not can_edit(principal, rec):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "You can read these minutes, not change them."
        )
    return rec


async def check_scope(
    db: AsyncSession, principal: Principal, branch_id: str | None, department_id: str | None
) -> tuple[str | None, str | None]:
    """Where the minutes may be filed: workspace roles anywhere; office roles inside their
    own company (branch managers) or department (HODs, supervisors); staff their company."""
    sc = principal.scope
    if not sc.everything and branch_id is None and department_id is None:
        branch_id = sc.branch_id
        department_id = sc.department_id if sc.kind == "department" else None
    if department_id:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department.")
        if branch_id and branch_id != d.branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_department",
                "That department is in another company.",
            )
        branch_id = d.branch_id
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company.")
    if sc.everything:
        return branch_id, department_id
    if sc.kind == "department" and sc.department_id:
        ok = department_id == sc.department_id
        where = "your department"
    else:
        ok = branch_id is not None and branch_id == sc.branch_id
        ok = ok and (sc.kind == "branch" or department_id is None)
        where = "your company"
    if not ok:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "out_of_scope",
            f"You can file meeting minutes for {where} only.",
        )
    return branch_id, department_id


# ---------------------------------------------------------------- output


async def _creator(db: AsyncSession, actor: str) -> str:
    kind, _, ident = actor.partition(":")
    if kind == "user":
        u = await db.get(User, ident)
        return u.name if u else "Removed person"
    if kind == "agent":
        a = await db.get(Agent, ident)
        return a.name if a else "Removed agent"
    return actor


def _items(rec: MeetingRecording) -> list[ActionItemOut]:
    out = []
    for i, a in enumerate((rec.minutes or {}).get("action_items") or []):
        out.append(
            ActionItemOut(
                index=i,
                what=str(a.get("what") or ""),
                owner=str(a.get("owner") or ""),
                due=str(a.get("due") or ""),
                due_date=str(a.get("due_date") or ""),
                owner_agent_id=a.get("owner_agent_id"),
                owner_label=str(a.get("owner_label") or a.get("owner") or ""),
                task_id=a.get("task_id"),
            )
        )
    return out


def _audio_ok(rec: MeetingRecording) -> bool:
    return (
        bool(rec.audio_file)
        and (audio.folder(rec.workspace_id, rec.id) / str(rec.audio_file)).exists()
    )


async def recording_out(
    db: AsyncSession, principal: Principal, rec: MeetingRecording, names: Names | None = None
) -> dict[str, Any]:
    names = names or await Names.load(db, principal.workspace_id)
    m = rec.minutes or {}
    items = m.get("action_items") or []
    return {
        "id": rec.id,
        "title": rec.title or service.default_title(rec.original_name),
        "status": rec.status,
        "stage_detail": rec.stage_detail,
        "language": rec.language,
        "original_name": rec.original_name,
        "size": rec.size,
        "duration_seconds": rec.duration_seconds,
        "chunks_total": rec.chunks_total,
        "chunks_done": rec.chunks_done,
        "branch_id": rec.branch_id,
        "department_id": rec.department_id,
        "scope_label": names.scope(rec.branch_id, rec.department_id)[1],
        "created_by": rec.created_by,
        "created_by_name": await _creator(db, rec.created_by),
        "created_at": rec.created_at,
        "finished_at": rec.finished_at,
        "error": rec.error,
        "summary": str(m.get("summary") or ""),
        "action_count": len(items),
        "open_actions": sum(1 for a in items if not a.get("task_id")),
        "decision_count": len(m.get("decisions") or []),
        "document_id": rec.document_id,
        "library_file_id": rec.library_file_id,
        "published_at": rec.published_at,
        "audio_available": _audio_ok(rec),
        "audio_expires_at": rec.audio_expires_at if rec.audio_file else None,
        "cost_usd": round(rec.cost_usd or 0, 4),
        "can_edit": can_edit(principal, rec),
    }


async def detail(db: AsyncSession, principal: Principal, rec: MeetingRecording) -> RecordingDetail:
    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is not None:
        await db.refresh(doc)  # updated_at is set by the database on change
    stale = bool(doc and rec.published_at and doc.updated_at > rec.published_at)
    return RecordingDetail(
        **await recording_out(db, principal, rec),
        heard_language=rec.heard_language,
        transcript=list(rec.transcript or []),
        minutes=rec.minutes,
        action_items=_items(rec),
        markdown=doc.body if doc else "",
        document_status=doc.status if doc else None,
        document_version=doc.version if doc else None,
        published_stale=stale or bool(doc and not rec.published_at),
    )


# ---------------------------------------------------------------- settings


class MinutesSettings(BaseModel):
    audio_days: int = Field(ge=0, le=service.MAX_AUDIO_DAYS)
    max_upload_mb: int = 0
    max_hours: float = 0


@router.get("/settings")
async def get_settings(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> MinutesSettings:
    ws = await db.get(Workspace, principal.workspace_id)
    return MinutesSettings(
        audio_days=service.audio_days(ws),
        max_upload_mb=settings.minutes_max_mb,
        max_hours=settings.minutes_max_hours,
    )


class SettingsIn(BaseModel):
    audio_days: int = Field(ge=0, le=service.MAX_AUDIO_DAYS)


@router.put("/settings")
async def put_settings(
    body: SettingsIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> MinutesSettings:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    before = service.audio_days(ws)
    ws.settings = {**(ws.settings or {}), "minutes_audio_days": body.audio_days}
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "minutes.settings",
        before={"audio_days": before},
        after={"audio_days": body.audio_days},
    )
    await db.commit()
    return MinutesSettings(
        audio_days=body.audio_days,
        max_upload_mb=settings.minutes_max_mb,
        max_hours=settings.minutes_max_hours,
    )


# ---------------------------------------------------------------- upload


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    name: str = Query(min_length=1, max_length=200),
    title: str = Query(default="", max_length=200),
    language: Literal["en", "ms"] = "en",
    branch_id: str | None = None,
    department_id: str | None = None,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingOut:
    mime = request.headers.get("x-file-type", "")[:120]
    if not audio.accepted(name, mime):
        raise api_error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "not_a_recording",
            "Upload an audio or video recording (mp3, m4a, wav, ogg, webm, mp4, mov).",
        )
    limit = settings.minutes_max_mb * 1024 * 1024
    declared = int(request.headers.get("content-length") or 0)
    if declared > limit:
        raise _too_big()
    branch_id, department_id = await check_scope(db, principal, branch_id, department_id)
    rec_id = new_id("mr")
    where = audio.folder(principal.workspace_id, rec_id)
    where.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(where).free < max(declared, 50 * 1024 * 1024) + DISK_MARGIN:
        audio.remove_folder(principal.workspace_id, rec_id)
        raise api_error(
            status.HTTP_507_INSUFFICIENT_STORAGE,
            "disk_full",
            "The server is short of disk space for this recording. Tell an admin.",
        )
    # Do not hold a database connection while a long upload trickles in.
    await db.commit()
    ext = audio.extension(name) or "bin"
    original = f"original.{ext}"
    part = where / f"{original}.part"
    size = 0
    try:
        with part.open("wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise _too_big()
                out.write(chunk)
        if size == 0:
            raise api_error(status.HTTP_400_BAD_REQUEST, "empty_file", "That file is empty.")
        part.replace(where / original)
    except BaseException:
        audio.remove_folder(principal.workspace_id, rec_id)
        raise
    rec = MeetingRecording(
        id=rec_id,
        workspace_id=principal.workspace_id,
        branch_id=branch_id,
        department_id=department_id,
        title=(title.strip() or service.default_title(name))[:200],
        language=language,
        status="queued",
        source="upload",
        original_name=name.strip()[:200],
        mime=mime,
        size=size,
        original_file=original,
        created_by=principal.actor,
        chunk_results={},
        transcript=[],
        work={},
    )
    db.add(rec)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "minutes.uploaded",
        target=rec.id,
        after={"name": rec.original_name, "size": size, "language": language},
    )
    await db.commit()
    await service.launch(db, rec)
    await db.refresh(rec)
    return RecordingOut(**await recording_out(db, principal, rec))


def _too_big() -> Exception:
    return api_error(
        status.HTTP_413_CONTENT_TOO_LARGE,
        "file_too_large",
        f"Recordings can be up to {settings.minutes_max_mb // 1024 or settings.minutes_max_mb} "
        f"{'GB' if settings.minutes_max_mb >= 1024 else 'MB'}.",
    )


# ---------------------------------------------------------------- list and read


@router.get("")
async def list_recordings(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[RecordingOut]:
    rows = (
        await db.scalars(
            select(MeetingRecording)
            .where(MeetingRecording.workspace_id == principal.workspace_id, _read_where(principal))
            .order_by(MeetingRecording.created_at.desc())
            .limit(200)
        )
    ).all()
    names = await Names.load(db, principal.workspace_id)
    return [RecordingOut(**await recording_out(db, principal, r, names)) for r in rows]


@router.get("/{rec_id}")
async def read_recording(
    rec_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    return await detail(db, principal, await _get(db, principal, rec_id))


class RecordingPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    branch_id: str | None = None
    department_id: str | None = None


@router.patch("/{rec_id}")
async def update_recording(
    rec_id: str,
    body: RecordingPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    before = {"title": rec.title, "branch_id": rec.branch_id, "department_id": rec.department_id}
    if body.title is not None:
        rec.title = body.title.strip()
    moved = {"branch_id", "department_id"} & body.model_fields_set
    if moved:
        b = body.branch_id if "branch_id" in moved else rec.branch_id
        d = body.department_id if "department_id" in moved else rec.department_id
        if principal.scope.everything and b is None and d is None:
            rec.branch_id, rec.department_id = None, None
        else:
            rec.branch_id, rec.department_id = await check_scope(db, principal, b, d)
        doc = await db.get(Document, rec.document_id) if rec.document_id else None
        if doc is not None:
            doc.branch_id = rec.branch_id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "minutes.updated",
        target=rec.id,
        before=before,
        after={"title": rec.title, "branch_id": rec.branch_id, "department_id": rec.department_id},
    )
    await db.commit()
    if moved and rec.library_file_id:
        await service.publish_library(db, rec)  # the library copy follows the new scope
    return await detail(db, principal, rec)


class MarkdownIn(BaseModel):
    body: str = Field(max_length=100_000)
    note: str = Field(default="", max_length=300)


@router.put("/{rec_id}/markdown")
async def save_markdown(
    rec_id: str,
    body: MarkdownIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is None:
        raise api_error(status.HTTP_409_CONFLICT, "not_ready", "The minutes are not written yet.")
    if doc.status == "approved":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "document_locked",
            "These minutes are approved in Documents. Reopen them there to change them.",
        )
    if body.body != doc.body:
        await doc_service.snapshot(db, doc, principal.actor, body.note or "edited minutes")
        doc.body = body.body
        doc.updated_at = datetime.now(UTC)
        await db.commit()
        await events.publish(
            principal.workspace_id, "document.updated", {"document_id": doc.id, "agent_id": None}
        )
    return await detail(db, principal, rec)


@router.post("/{rec_id}/publish")
async def publish(
    rec_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    if not rec.document_id:
        raise api_error(status.HTTP_409_CONFLICT, "not_ready", "The minutes are not written yet.")
    await service.publish_library(db, rec)
    await audit.record(
        db, principal.workspace_id, principal.actor, "minutes.published", target=rec.id
    )
    await db.commit()
    return await detail(db, principal, rec)


@router.post("/{rec_id}/retry")
async def retry(
    rec_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    if rec.status != "failed":
        raise api_error(
            status.HTTP_409_CONFLICT, "not_failed", "Only a failed recording can be retried."
        )
    if not (rec.transcript or _audio_ok(rec) or rec.original_file):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "recording_gone",
            "The recording is no longer on the server. Upload it again.",
        )
    await service.launch(db, rec)
    return await detail(db, principal, rec)


class RewriteIn(BaseModel):
    language: Literal["en", "ms"]


@router.post("/{rec_id}/rewrite")
async def rewrite(
    rec_id: str,
    body: RewriteIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    """Write the minutes again from the saved transcript (e.g. in Bahasa Melayu). The current
    minutes stay as a version of the document."""
    rec = await _editable(db, principal, rec_id)
    if rec.status in service.ACTIVE:
        raise api_error(
            status.HTTP_409_CONFLICT, "busy", "This recording is still being processed."
        )
    if not rec.transcript:
        raise api_error(status.HTTP_409_CONFLICT, "no_transcript", "There is no transcript yet.")
    rec.language = body.language
    rec.minutes, rec.work = None, {}
    flag_modified(rec, "work")
    await service.launch(db, rec)
    return await detail(db, principal, rec)


@router.get("/{rec_id}/audio")
async def play_audio(
    rec_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rec = await _get(db, principal, rec_id)
    if not _audio_ok(rec):
        raise api_error(status.HTTP_404_NOT_FOUND, "audio_gone", "The audio is no longer kept.")
    path = audio.folder(rec.workspace_id, rec.id) / str(rec.audio_file)
    # FileResponse answers byte ranges, so the player can jump to any moment.
    return FileResponse(
        path,
        media_type=audio.AUDIO_MIME,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.delete("/{rec_id}/audio")
async def delete_audio(
    rec_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    if rec.status in service.ACTIVE:
        raise api_error(
            status.HTTP_409_CONFLICT, "busy", "This recording is still being processed."
        )
    if rec.audio_file:
        audio.remove_file(audio.folder(rec.workspace_id, rec.id) / rec.audio_file)
        rec.audio_file, rec.audio_purged_at = None, datetime.now(UTC)
        await audit.record(
            db, principal.workspace_id, principal.actor, "minutes.audio_deleted", target=rec.id
        )
        await db.commit()
    return await detail(db, principal, rec)


@router.get("/{rec_id}/export")
async def export(
    rec_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|docx)$"),  # noqa: A002 - API name
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rec = await _get(db, principal, rec_id)
    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is None:
        raise api_error(status.HTTP_409_CONFLICT, "not_ready", "The minutes are not written yet.")
    data, name, mime = await doc_service.export(db, doc, format, numbered=False)
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )


@router.delete("/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recording(
    rec_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """The recording, its audio, transcript, minutes document and library copy all go."""
    rec = await _editable(db, principal, rec_id)
    if rec.library_file_id:
        await indexer.remove(db, "file", rec.library_file_id)
        f = await db.get(DocFile, rec.library_file_id)
        if f is not None:
            await db.delete(f)
    if rec.document_id:
        doc = await db.get(Document, rec.document_id)
        if doc is not None:
            await db.delete(doc)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "minutes.deleted",
        target=rec.id,
        before={"title": rec.title, "name": rec.original_name},
    )
    await db.delete(rec)
    await db.commit()
    audio.remove_folder(principal.workspace_id, rec_id)


# ---------------------------------------------------------------- action items


class ActionPatch(BaseModel):
    what: str | None = Field(default=None, min_length=1, max_length=400)
    owner: str | None = Field(default=None, max_length=120)
    due_date: str | None = Field(default=None, max_length=10)


def _item_index(rec: MeetingRecording, index: int) -> None:
    if not 0 <= index < len((rec.minutes or {}).get("action_items") or []):
        raise api_error(status.HTTP_404_NOT_FOUND, "no_such_item", "That action item is not here.")


async def _sync_table(db: AsyncSession, rec: MeetingRecording, actor: str) -> None:
    """Keep the minutes' action-item table in step with the items (only that section)."""
    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is None or doc.status == "approved":
        return
    body = service.actions_section(doc.body, rec.minutes or {}, rec.language)
    if body != doc.body:
        await doc_service.snapshot(db, doc, actor, "action items updated")
        doc.body = body
        doc.updated_at = datetime.now(UTC)


def _check_due(due: str | None) -> None:
    if due:
        try:
            datetime.strptime(due, "%Y-%m-%d")
        except ValueError as e:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_date", "Use a date like 2026-10-31."
            ) from e


@router.patch("/{rec_id}/actions/{index}")
async def update_action(
    rec_id: str,
    index: int,
    body: ActionPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    _item_index(rec, index)
    _check_due(body.due_date)
    m = dict(rec.minutes or {})
    items = [dict(x) for x in m.get("action_items") or []]
    item = items[index]
    if body.what is not None:
        item["what"] = body.what.strip()
    if body.owner is not None:
        item["owner"] = body.owner.strip()
        if not item.get("owner_agent_id"):
            item["owner_label"] = item["owner"]
    if body.due_date is not None:
        item["due_date"] = body.due_date
    items[index] = item
    m["action_items"] = items
    rec.minutes = m
    flag_modified(rec, "minutes")
    await _sync_table(db, rec, principal.actor)
    await db.commit()
    return await detail(db, principal, rec)


class TaskIn(BaseModel):
    agent_id: str | None = None
    owner: str | None = Field(default=None, max_length=120)
    due_date: str | None = Field(default=None, max_length=10)


async def _agent(db: AsyncSession, principal: Principal, agent_id: str | None) -> Agent | None:
    if not agent_id:
        return None
    a = await db.get(Agent, agent_id)
    if a is None or a.workspace_id != principal.workspace_id or not principal.scope.sees_agent(a):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_agent", f"Pick an agent from {principal.scope.label}."
        )
    return a


async def _announce(db: AsyncSession, principal: Principal, tasks: list[Any]) -> None:
    from ...agents import runtime

    for t in tasks:
        await runtime.task_event(db, t, "created", principal.actor, "created the task from minutes")
        await events.publish(
            principal.workspace_id,
            "task.created",
            {"task_id": t.id, "agent_id": t.assignee_agent_id},
        )


@router.post("/{rec_id}/actions/{index}/task", status_code=status.HTTP_201_CREATED)
async def action_to_task(
    rec_id: str,
    index: int,
    body: TaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    rec = await _editable(db, principal, rec_id)
    _item_index(rec, index)
    _check_due(body.due_date)
    agent = await _agent(db, principal, body.agent_id)
    already = ((rec.minutes or {}).get("action_items") or [])[index].get("task_id")
    t = await service.action_task(
        db,
        rec,
        index,
        actor=principal.actor,
        agent=agent,
        owner=body.owner,
        due_date=body.due_date,
    )
    if not already or already != t.id:
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "task.created",
            target=t.id,
            after={"title": t.title, "assignee": t.assignee_agent_id, "minutes": rec.id},
        )
        await _sync_table(db, rec, principal.actor)
        await db.commit()
        await _announce(db, principal, [t])
    return await detail(db, principal, rec)


@router.post("/{rec_id}/actions/tasks", status_code=status.HTTP_201_CREATED)
async def all_to_tasks(
    rec_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RecordingDetail:
    """Every action item without a task gets one, with its owner and due date as they stand."""
    rec = await _editable(db, principal, rec_id)
    made = []
    for i, item in enumerate((rec.minutes or {}).get("action_items") or []):
        if item.get("task_id"):
            continue
        agent = None
        if item.get("owner_agent_id"):
            a = await db.get(Agent, item["owner_agent_id"])
            agent = a if a is not None and principal.scope.sees_agent(a) else None
        made.append(await service.action_task(db, rec, i, actor=principal.actor, agent=agent))
    if made:
        for t in made:
            await audit.record(
                db,
                principal.workspace_id,
                principal.actor,
                "task.created",
                target=t.id,
                after={"title": t.title, "assignee": t.assignee_agent_id, "minutes": rec.id},
            )
        await _sync_table(db, rec, principal.actor)
        await db.commit()
        await _announce(db, principal, made)
    return await detail(db, principal, rec)
