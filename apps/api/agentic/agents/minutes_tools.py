"""meeting_minutes: an agent turns a meeting recording already in the office files into
minutes, through the same pipeline as Meetings > People meetings (minutes/service.py).

Processing takes minutes, so the first call starts it and returns; calling again with the
same file reports progress, and once ready returns the minutes text."""

from typing import Any

from sqlalchemy import select

from ..minutes import audio, service
from ..models import DocFile, Document, MeetingRecording
from .tools import Tool, ToolContext

MAX_RETURN_CHARS = 8000


def _link(rec: MeetingRecording) -> str:
    return f"/meetings?tab=minutes&rec={rec.id}"


async def _report(ctx: ToolContext, rec: MeetingRecording) -> str:
    if rec.status == "ready":
        doc = await ctx.db.get(Document, rec.document_id) if rec.document_id else None
        body = (doc.body if doc else "") or ""
        cut = (
            "\n[... cut; the full minutes are in the link above]"
            if len(body) > MAX_RETURN_CHARS
            else ""
        )
        return (
            f"Minutes ready for [{rec.id}] {rec.title} (document {rec.document_id}, saved to the "
            f"library). People review them at {_link(rec)}. Speaker names are as heard.\n\n"
            f"{body[:MAX_RETURN_CHARS]}{cut}"
        )
    if rec.status == "failed":
        return f"Error: making minutes of [{rec.id}] failed: {rec.error}. Tell the person."
    step = rec.status
    if rec.status == "transcribing" and rec.chunks_total:
        step = f"transcribing part {rec.chunks_done + 1} of {rec.chunks_total}"
    extra = f" ({rec.stage_detail})" if rec.stage_detail else ""
    return (
        f"Still working on [{rec.id}] {rec.title}: {step}{extra}. An hour of audio takes a "
        f"few minutes. Call meeting_minutes again with the same file_id later, or point the "
        f"person to {_link(rec)}."
    )


async def _meeting_minutes(ctx: ToolContext, args: dict[str, Any]) -> str:
    from .doc_tools import _file

    file_id = str(args.get("file_id") or "").strip()
    language = "ms" if str(args.get("language") or "").lower() in ("ms", "malay", "bm") else "en"
    f = await _file(ctx, file_id)
    if f is None:
        return "Error: no such file. Use list_files to find the recording's file id."
    if not audio.accepted(f.name, f.mime):
        return f"Error: [{f.id}] {f.name} is not an audio or video recording."
    rec = await ctx.db.scalar(
        select(MeetingRecording)
        .where(
            MeetingRecording.workspace_id == ctx.workspace.id,
            MeetingRecording.source_file_id == f.id,
        )
        .order_by(MeetingRecording.created_at.desc())
        .limit(1)
    )
    if rec is not None:
        return await _report(ctx, rec)
    data = await ctx.db.scalar(select(DocFile.data).where(DocFile.id == f.id))
    if not data:
        return f"Error: [{f.id}] {f.name} is empty."
    rec = MeetingRecording(
        workspace_id=ctx.workspace.id,
        branch_id=ctx.agent.branch_id,
        department_id=ctx.agent.department_id,
        title=service.default_title(f.title or f.name),
        language=language,
        status="queued",
        source="file",
        source_file_id=f.id,
        original_name=f.name,
        mime=f.mime,
        size=len(data),
        created_by=f"agent:{ctx.agent.id}",
        agent_id=ctx.agent.id,
        task_id=ctx.task.id if ctx.task else None,
        chunk_results={},
        transcript=[],
        work={},
    )
    ctx.db.add(rec)
    await ctx.db.flush()
    original = f"original.{audio.extension(f.name) or 'bin'}"
    where = audio.folder(rec.workspace_id, rec.id)
    where.mkdir(parents=True, exist_ok=True)
    (where / original).write_bytes(bytes(data))
    rec.original_file = original
    await ctx.db.commit()
    await service.launch(ctx.db, rec)
    if rec.status == "failed":
        return f"Error: {rec.error}"
    return (
        f"Started making minutes of [{f.id}] {f.name} as recording [{rec.id}]. An hour of audio "
        f"takes a few minutes. Call meeting_minutes again with the same file_id to read the "
        f"minutes when they are ready; people can follow it at {_link(rec)}."
    )


MINUTES_TOOLS: list[Tool] = [
    Tool(
        "meeting_minutes",
        "Meeting minutes",
        "Turn a meeting recording (audio or video) in the office files into minutes: summary, "
        "topics, decisions, action items with owners and due dates. The first call starts it "
        "(a few minutes per hour of audio); call again with the same file_id for progress and, "
        "once ready, the minutes. Speaker names are as heard, not identified by voice.",
        {
            "type": "object",
            "properties": {
                "file_id": {"type": "string", "description": "The recording's file id"},
                "language": {
                    "type": "string",
                    "enum": ["en", "ms"],
                    "description": "Language of the minutes: en (default) or ms (Bahasa Melayu)",
                },
            },
            "required": ["file_id"],
        },
        "medium",
        "allow",
        _meeting_minutes,
    ),
]
