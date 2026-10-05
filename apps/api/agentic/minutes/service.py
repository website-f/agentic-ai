"""The meeting-minutes pipeline and what happens around it.

The worker runs these steps (workflows/minutes_workflows.py), each safe to run again:
1. prepare: ffprobe + ffmpeg keep a small mono audio copy, the original is deleted,
   the chunk plan is made.
1b. diarize_window (once per 10 minutes, when "Separate speakers" is on): who spoke when,
   on the CPU (diarize.py). Any failure here only costs the speaker labels.
2. transcribe_chunk (once per chunk): the "transcribe" group hears up to 9.5 minutes.
   When every speech model is resting (Groq's audio-seconds-per-hour limit, a 429), the step
   says how long to wait and the workflow sleeps; nothing is lost.
3. write: the transcript is stitched; the "smart" group writes the minutes (map-reduce for
   long meetings); the minutes become a Document (edit, versions, PDF/Word) and a library
   file scoped to the meeting's company/department, so agents can search past decisions.

Afterwards people edit the minutes, turn action items into tasks, and republish to the
library. The compressed audio is kept for the workspace's retention days (default 30) so
the transcript can play each moment, then the nightly purge deletes it.
"""

import hashlib
import logging
import math
import re
import secrets
import shutil
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..core.config import settings
from ..documents import service as doc_service
from ..engine import gateway, media, store
from ..models import (
    Agent,
    Branch,
    Department,
    DocFile,
    Document,
    MeetingRecording,
    Membership,
    ModelGroup,
    Task,
    User,
    Workspace,
)
from ..services import events
from . import audio, diarize, transcript, writer

log = logging.getLogger("agentic.minutes")

ACTIVE = ("uploading", "queued", "extracting", "transcribing", "writing")
DEFAULT_AUDIO_DAYS = 30
MAX_AUDIO_DAYS = 365
SINGLE_PASS_CHARS = 48_000  # about 1 hour of talk: one call writes the minutes
PART_CHARS = 32_000  # longer: notes per part of this size, then one merge
MIN_WAIT_SECONDS = 30
FAILED_ORIGINAL_DAYS = 3
ORPHAN_HOURS = 24

NO_WORKER = (
    "The background worker is not reachable, so the recording could not start processing. "
    "Press Retry when the worker is back."
)


class Failed(Exception):
    """A problem waiting will not fix (bad file, no speech model). Shown to the person."""


def audio_days(ws: Workspace | None) -> int:
    raw = ((ws.settings if ws else None) or {}).get("minutes_audio_days", DEFAULT_AUDIO_DAYS)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = DEFAULT_AUDIO_DAYS
    return max(0, min(MAX_AUDIO_DAYS, n))


async def notify(rec: MeetingRecording) -> None:
    await events.publish(
        rec.workspace_id,
        "minutes.updated",
        {
            "recording_id": rec.id,
            "status": rec.status,
            "chunks_done": rec.chunks_done,
            "chunks_total": rec.chunks_total,
        },
    )


def _expire_audio(rec: MeetingRecording, days: int, now: datetime) -> None:
    if rec.audio_file and rec.audio_expires_at is None:
        rec.audio_expires_at = now + timedelta(days=days)


async def fail(db: AsyncSession, rec: MeetingRecording, message: str) -> dict[str, Any]:
    now = datetime.now(UTC)
    rec.status = "failed"
    rec.error = message[:500]
    rec.stage_detail = ""
    rec.finished_at = now
    _expire_audio(rec, audio_days(await db.get(Workspace, rec.workspace_id)), now)
    await db.commit()
    await notify(rec)
    return {"failed": True}


async def fail_by_id(db: AsyncSession, rec_id: str, message: str) -> None:
    """The workflow gave up on a step (retries spent): say why on the recording."""
    rec = await db.get(MeetingRecording, rec_id)
    if rec is not None and rec.status in ACTIVE:
        await fail(db, rec, message)


async def start(rec: MeetingRecording) -> str:
    """Hand the recording to the worker. The caller has bumped rec.runs and commits."""
    from ..core.temporal import temporal_client
    from ..workflows.minutes_workflows import MeetingMinutesWorkflow

    client = await temporal_client()
    workflow_id = f"minutes-{rec.id}-{rec.runs}"
    await client.start_workflow(
        MeetingMinutesWorkflow.run,
        rec.id,
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )
    return workflow_id


async def launch(db: AsyncSession, rec: MeetingRecording) -> None:
    """Start (or restart) processing; a worker that cannot be reached fails it visibly."""
    rec.runs += 1
    rec.status = "queued"
    rec.error = None
    rec.stage_detail = ""
    await db.commit()
    try:
        rec.workflow_id = await start(rec)
        await db.commit()
    except Exception:  # noqa: BLE001 - the recording must say what happened
        log.warning("could not start minutes workflow for %s", rec.id, exc_info=True)
        await fail(db, rec, NO_WORKER)


# ---------------------------------------------------------------- step 1: prepare


async def prepare(db: AsyncSession, rec_id: str, beat: audio.Beat | None = None) -> dict[str, Any]:
    rec = await db.get(MeetingRecording, rec_id)
    if rec is None or rec.status == "failed":
        return {"failed": True}
    if rec.transcript:  # already heard (a rewrite, or a retry after writing failed)
        return {"chunks": 0}
    where = audio.folder(rec.workspace_id, rec.id)
    have_audio = bool(rec.audio_file) and (where / str(rec.audio_file)).exists()
    if not have_audio:
        src = where / str(rec.original_file or "")
        if not rec.original_file or not src.exists():
            return await fail(
                db, rec, "The uploaded recording is no longer on the server. Upload it again."
            )
        rec.status, rec.stage_detail = "extracting", ""
        await db.commit()
        await notify(rec)
        try:
            info = await audio.probe(src, beat)
            if not info.has_audio:
                raise Failed("This recording has no sound track.")
            limit = settings.minutes_max_hours * 3600
            if info.seconds > limit + 60:
                raise Failed(
                    f"This recording is {audio.fmt_duration(info.seconds)} long; the limit is "
                    f"{audio.fmt_duration(limit)}. Split it and upload the parts."
                )
            await audio.extract(src, where / audio.AUDIO_NAME, info.seconds, beat)
            seconds = (await audio.probe(where / audio.AUDIO_NAME, beat)).seconds or info.seconds
        except audio.FFmpegError as e:
            return await fail(db, rec, f"Could not read the sound in this recording: {e}")
        except Failed as e:
            return await fail(db, rec, str(e))
        rec.audio_file = audio.AUDIO_NAME
        rec.duration_seconds = round(seconds, 2)
        audio.remove_file(src)  # the original is no longer needed: only the small copy stays
        rec.original_file = None
    if not rec.duration_seconds or rec.duration_seconds < 1:
        return await fail(db, rec, "The recording is empty or too short to hear anything.")
    chunks = audio.plan_chunks(rec.duration_seconds)
    rec.chunks_total = len(chunks)
    rec.chunks_done = sum(1 for c in chunks if str(c.index) in (rec.chunk_results or {}))
    windows = speaker_windows(rec)
    # While the voices are separated the recording stays "extracting" (an audio step); the
    # progress is in work["diar"] (see speakers_progress).
    rec.status, rec.stage_detail = ("extracting" if windows else "transcribing"), ""
    await db.commit()
    await notify(rec)
    return {"chunks": len(chunks), "windows": len(windows)}


# ---------------------------------------------------------------- step 1b: who spoke when


def speaker_options(rec: MeetingRecording) -> dict[str, Any]:
    """What the uploader chose: {"on": bool, "count": 0 (auto) or 2-10}."""
    opts = (rec.work or {}).get("diarize") or {}
    # On unless the uploader turned it off (recordings an agent starts get it too).
    return {"on": bool(opts.get("on", True)), "count": int(opts.get("count") or 0)}


def keep_options(rec: MeetingRecording) -> dict[str, Any]:
    """The work scratch emptied, the uploader's choices kept."""
    opts = (rec.work or {}).get("diarize")
    return {"diarize": opts} if opts else {}


def _diar(rec: MeetingRecording) -> dict[str, Any]:
    return dict((rec.work or {}).get("diar") or {})


def _set_diar(rec: MeetingRecording, diar: dict[str, Any]) -> None:
    rec.work = {**(rec.work or {}), "diar": diar}
    flag_modified(rec, "work")


def speaker_windows(rec: MeetingRecording) -> list[tuple[float, float]]:
    """The windows still to separate (all of them: done ones return at once). Empty when the
    uploader turned it off, it already failed, the transcript exists, or this server has no
    speaker models."""
    if rec.transcript or not speaker_options(rec)["on"] or _diar(rec).get("failed"):
        return []
    if not diarize.available():
        log.info("speaker models are not installed; minutes %s without speaker labels", rec.id)
        _set_diar(rec, {**_diar(rec), "failed": "speaker models are not installed"})
        return []
    plan = diarize.plan_windows(rec.duration_seconds or 0)
    _set_diar(rec, {**_diar(rec), "total": len(plan)})
    return plan


def speakers_progress(rec: MeetingRecording) -> tuple[int, int]:
    """(windows done, windows planned) while the voices are being separated, else (0, 0)."""
    d = (rec.work or {}).get("diar") or {}
    if rec.status != "extracting" or d.get("failed") or not d.get("total"):
        return 0, 0
    return len(d.get("w") or {}), int(d["total"])


async def _speakers_finished(db: AsyncSession, rec: MeetingRecording) -> None:
    rec.status, rec.stage_detail = "transcribing", ""
    await db.commit()
    await notify(rec)


async def diarize_window(
    db: AsyncSession, rec_id: str, index: int, beat: audio.Beat | None = None
) -> dict[str, Any]:
    """Separate the voices in one window. {"done"} | {"skip"} (separation stopped: the
    minutes carry on without labels) | {"failed"} (the recording failed elsewhere)."""
    rec = await db.get(MeetingRecording, rec_id)
    if rec is None or rec.status == "failed":
        return {"failed": True}
    diar = _diar(rec)
    plan = diarize.plan_windows(rec.duration_seconds or 0)
    done = dict(diar.get("w") or {})
    if diar.get("failed") or rec.transcript:
        if rec.status == "extracting":
            await _speakers_finished(db, rec)
        return {"skip": True}
    if index >= len(plan) or str(index) in done:
        if len(done) >= len(plan) and rec.status == "extracting":
            await _speakers_finished(db, rec)
        return {"done": True}
    where = audio.folder(rec.workspace_id, rec.id)
    start, length = plan[index]
    try:
        if not rec.audio_file or not (where / rec.audio_file).exists():
            raise diarize.SpeakerError("the audio is no longer on the server")
        count = speaker_options(rec)["count"] if len(plan) == 1 else 0
        result = await diarize.run_window(where / rec.audio_file, start, length, count, beat)
    except Exception as e:  # noqa: BLE001 - any failure only costs the speaker labels
        log.warning("speaker separation stopped for %s at window %s: %s", rec.id, index, e)
        _set_diar(rec, {**diar, "failed": str(e)[:300] or e.__class__.__name__})
        await _speakers_finished(db, rec)
        return {"skip": True}
    done[str(index)] = {"start": start, **result}
    _set_diar(rec, {**diar, "w": done, "total": len(plan)})
    if len(done) >= len(plan):
        await _speakers_finished(db, rec)
    else:
        await db.commit()
        await notify(rec)
    return {"done": True}


async def separate_speakers(
    db: AsyncSession, rec_id: str, beat: audio.Beat | None = None
) -> dict[str, Any]:
    """Every window in turn (the prepare activity runs this right after extracting, so a
    retry continues at the first window not yet done)."""
    rec = await db.get(MeetingRecording, rec_id)
    if rec is None:
        return {"failed": True}
    total = len(diarize.plan_windows(rec.duration_seconds or 0))
    for i in range(total):
        r = await diarize_window(db, rec_id, i, beat)
        if not r.get("done"):
            return r
        if beat:
            beat()
    return {"done": True}


def speaker_turns(rec: MeetingRecording) -> list[list[Any]]:
    """Who spoke when across the meeting, once every window is separated; [] otherwise."""
    d = _diar(rec)
    if d.get("failed") or not d.get("total"):
        return []
    w = d.get("w") or {}
    if len(w) < int(d["total"]):
        return []
    windows = [(float(w[k].get("start") or 0), w[k]) for k in sorted(w, key=int)]
    try:
        return diarize.link(windows, speaker_options(rec)["count"])
    except Exception:  # noqa: BLE001 - bad stored data only costs the labels
        log.warning("could not link speakers for %s", rec.id, exc_info=True)
        return []


def speakers_from(turns: list[list[Any]], paras: list[dict[str, Any]]) -> dict[str, Any]:
    """The speakers column: talk time and a clip to recognise each voice, for the voices that
    said something the transcript heard."""
    heard = {p["s"] for p in paras if p.get("s")}
    talk = diarize.talk_time(turns)
    out: dict[str, Any] = {}
    for lbl in sorted(heard, key=lambda x: int(x[1:]) if x[1:].isdigit() else 99):
        out[lbl] = {"name": "", "seconds": talk.get(lbl, 0.0)}
        if clip := diarize.clip_for(turns, lbl):
            out[lbl]["clip"] = clip
    return out


def unlabel(paras: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The transcript as it would be without speaker separation (one voice was heard)."""
    segs = [{k: v for k, v in p.items() if k != "s"} for p in paras]
    return transcript.paragraphs(segs)


def speaker_labels(rec: MeetingRecording) -> bool:
    return bool(rec.speakers) and any(p.get("s") for p in rec.transcript or [])


async def _people(db: AsyncSession, rec: MeetingRecording) -> list[str]:
    return [
        n
        for n in await db.scalars(
            select(User.name)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == rec.workspace_id)
        )
        if n
    ]


NAME_LINES_CHARS = 14_000


def _name_evidence(rec: MeetingRecording, people: list[str]) -> str:
    """The lines that can name a voice: the opening (introductions), and every line that
    says a name with the lines around it. Capped so a long meeting stays one small call."""
    paras = rec.transcript or []
    lines = [f"[{transcript.fmt_time(p['t'])}] {p.get('s') or '?'}: {p['text']}" for p in paras]
    if sum(len(x) + 1 for x in lines) <= NAME_LINES_CHARS:
        return "\n".join(lines)
    firsts = {n.split()[0].casefold() for n in people if n.split()}
    cue = re.compile(r"\b(saya|nama|terima kasih|thanks?|thank you|i'm|i am|my name)\b", re.I)
    keep: set[int] = set(range(min(12, len(lines))))
    for i, p in enumerate(paras):
        words = {w.casefold() for w in re.findall(r"[A-Za-z']+", p["text"])}
        if cue.search(p["text"]) or words & firsts:
            keep.update({i - 1, i, i + 1})
    out, size = [], 0
    for i in sorted(k for k in keep if 0 <= k < len(lines)):
        if size + len(lines[i]) > NAME_LINES_CHARS:
            break
        out.append(lines[i])
        size += len(lines[i]) + 1
    return "\n".join(out)


async def suggest_names(db: AsyncSession, rec: MeetingRecording, vocab: str) -> None:
    """Offer a name for each voice (the person confirms in the Speakers panel): voices that
    introduce themselves, then the smart model reading who addresses whom. Never fails the
    minutes."""
    if not rec.speakers:
        return
    people = await _people(db, rec)
    found = writer.introductions(rec.transcript or [], people)
    labels = set(rec.speakers) - set(found)
    if labels:
        try:
            r = await gateway.chat(
                db,
                rec.workspace_id,
                "smart",
                [
                    {"role": "system", "content": writer.names_system(vocab)},
                    {"role": "user", "content": writer.names_prompt(_name_evidence(rec, people))},
                ],
                task="minutes.speakers",
                max_tokens=800,
                temperature=0.0,
                json_mode=True,
                accept=lambda raw: writer.loads(raw) is not None,
                agent_id=rec.agent_id,
                task_id=rec.task_id,
            )
            rec.cost_usd = round((rec.cost_usd or 0) + (r.cost_usd or 0), 6)
            heard = " ".join(p["text"] for p in rec.transcript or [])
            taken = {v["name"].casefold() for v in found.values()}
            for lbl, v in writer.parse_names(r.content, labels, heard).items():
                if v["name"].casefold() not in taken:
                    found[lbl] = v
                    taken.add(v["name"].casefold())
        except Exception:  # noqa: BLE001 - suggestions are a nicety
            log.info("no speaker name suggestions for %s", rec.id, exc_info=True)
    if found:
        sp = {k: dict(v) for k, v in rec.speakers.items()}
        for lbl, v in found.items():
            if lbl in sp:
                sp[lbl]["suggested"] = v["name"]
                sp[lbl]["evidence"] = v.get("evidence", "")
        rec.speakers = sp
        flag_modified(rec, "speakers")


def current_names(rec: MeetingRecording) -> dict[str, str]:
    return {k: str((v or {}).get("name") or "") for k, v in (rec.speakers or {}).items()}


def names_stale(rec: MeetingRecording) -> bool:
    """The speakers were named (or renamed) after the minutes were written."""
    if not speaker_labels(rec) or not rec.minutes:
        return False
    return (rec.minutes.get("speaker_names") or {}) != current_names(rec)


def rename_speakers(rec: MeetingRecording, names: dict[str, str]) -> None:
    sp = {k: dict(v) for k, v in (rec.speakers or {}).items()}
    for lbl, name in names.items():
        if lbl in sp:
            sp[lbl]["name"] = " ".join(str(name or "").split())[:80]
    rec.speakers = sp
    flag_modified(rec, "speakers")


async def speaker_clip(rec: MeetingRecording, label: str) -> bytes | None:
    """About ten seconds of one voice, cut from the kept audio; None when the audio is gone
    or the voice has no clear stretch."""
    clip = ((rec.speakers or {}).get(label) or {}).get("clip")
    if not clip or not rec.audio_file or rec.audio_purged_at is not None:
        return None
    where = audio.folder(rec.workspace_id, rec.id)
    src = where / rec.audio_file
    if not src.exists():
        return None
    tmp = where / f"clip-{_safe_label(label)}-{secrets.token_hex(4)}.mp3"
    return await audio.cut(src, tmp, float(clip[0]), float(clip[1]))


def _safe_label(label: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", label)[:8] or "x"


# ---------------------------------------------------------------- step 2: hear one chunk


VOCAB_WORDS = 60  # Whisper reads ~224 prompt tokens; the last words heard need room too
_LEGAL = re.compile(r"\b(sdn\.? ?bhd\.?|berhad|bhd\.?|plt|enterprise)\b", re.I)


async def vocabulary(db: AsyncSession, rec: MeetingRecording) -> str:
    """The office's own names, so speech-to-text and the writer spell them right: the
    companies (legal suffix dropped), the meeting's company first, its departments, people and
    agents (role brackets dropped)."""
    names: list[str] = []
    branches = (
        await db.scalars(select(Branch).where(Branch.workspace_id == rec.workspace_id))
    ).all()
    branches = sorted(branches, key=lambda b: b.id != rec.branch_id)
    names += [_LEGAL.sub("", b.name).strip(" ,.-") for b in branches]
    depts = await db.scalars(
        select(Department.name).where(
            Department.workspace_id == rec.workspace_id,
            Department.branch_id == rec.branch_id if rec.branch_id else Department.id.is_not(None),
        )
    )
    names += list(depts)
    people = await db.scalars(
        select(User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == rec.workspace_id)
    )
    names += list(people)
    agents = await db.scalars(
        select(Agent.name).where(Agent.workspace_id == rec.workspace_id, Agent.status != "retired")
    )
    names += [a.split("(")[0].strip() for a in agents]
    out, words = [], 0
    for n in dict.fromkeys(x for x in names if x and len(x) > 1):
        w = len(n.split())
        if words + w > VOCAB_WORDS:
            break
        out.append(n)
        words += w
    return ", ".join(out)


async def transcribe_wait(db: AsyncSession, workspace_id: str) -> int:
    """Seconds until the first resting speech model can be asked again (0: none resting)."""
    g = await db.scalar(
        select(ModelGroup).where(
            ModelGroup.workspace_id == workspace_id, ModelGroup.name == media.TRANSCRIBE
        )
    )
    waits = []
    for pid in dict.fromkeys(m["provider_id"] for m in (g.members if g else [])):
        if w := await store.cooling_for(pid):
            waits.append(w)
    return min(waits) if waits else 0


def _resting(e: gateway.GatewayUnavailable) -> bool:
    """Every member was rate limited or resting: waiting will help."""
    for a in e.attempts:
        if a.get("error_class") == "rate_limited" or "cooling down" in str(a.get("skipped", "")):
            return True
    return False


async def transcribe_chunk(
    db: AsyncSession, rec_id: str, index: int, beat: audio.Beat | None = None
) -> dict[str, Any]:
    """Hear one chunk. {"done"} | {"wait": seconds} | {"failed"}. Raises on a passing
    problem (a timeout, a provider error) so the workflow retries it."""
    rec = await db.get(MeetingRecording, rec_id)
    if rec is None or rec.status == "failed":
        return {"failed": True}
    if rec.status == "extracting":  # hearing has begun: the speaker step is over
        rec.status = "transcribing"
    results = dict(rec.chunk_results or {})
    if str(index) in results:
        return {"done": True}
    chunks = audio.plan_chunks(rec.duration_seconds or 0)
    if index >= len(chunks):
        return {"done": True}
    c = chunks[index]
    where = audio.folder(rec.workspace_id, rec.id)
    if not rec.audio_file or not (where / rec.audio_file).exists():
        return await fail(db, rec, "The recording's audio is no longer on the server.")
    try:
        data = await audio.cut(
            where / rec.audio_file, where / f"chunk-{index:03d}.mp3", c.start, c.length, beat
        )
    except audio.FFmpegError as e:
        return await fail(db, rec, f"Could not cut the recording into parts: {e}")
    previous = str((results.get(str(index - 1)) or {}).get("text") or "")
    try:
        t = await gateway.transcribe(
            db,
            rec.workspace_id,
            data,
            mime=audio.AUDIO_MIME,
            seconds=c.length,
            task="minutes.transcribe",
            agent_id=rec.agent_id,
            task_id=rec.task_id,
            prompt=transcript.context_prompt(previous, vocabulary=await vocabulary(db, rec)),
        )
    except gateway.MediaRejected as e:
        return await fail(db, rec, f"The speech model refused part {index + 1}: {e}")
    except gateway.NotConfigured:
        return await fail(db, rec, gateway.NO_TRANSCRIBE)
    except gateway.GatewayUnavailable as e:
        if not _resting(e):
            raise
        wait = max(MIN_WAIT_SECONDS, await transcribe_wait(db, rec.workspace_id))
        rec.stage_detail = (
            f"The speech model is resting (its hourly limit). Carrying on in about "
            f"{math.ceil(wait / 60)} min."
        )[:300]
        await db.commit()
        await notify(rec)
        return {"wait": wait}
    results[str(index)] = {
        "segments": t.segments,
        "text": t.text,
        "model": t.model,
        "provider": t.provider_name,
        "seconds": t.seconds,
        "language": t.language,
    }
    rec.chunk_results = results
    flag_modified(rec, "chunk_results")
    rec.chunks_done = sum(1 for k in results if k.isdigit() and int(k) < len(chunks))
    rec.cost_usd = round((rec.cost_usd or 0) + (t.cost_usd or 0), 6)
    if t.language and not rec.heard_language:
        rec.heard_language = t.language[:32]
    rec.stage_detail = ""
    await db.commit()
    await notify(rec)
    return {"done": True}


# ---------------------------------------------------------------- step 3: write the minutes


async def _ask(
    db: AsyncSession, rec: MeetingRecording, system: str, user: str, *, task: str, notes: bool
) -> dict[str, Any]:
    r = await gateway.chat(
        db,
        rec.workspace_id,
        "smart",
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        task=task,
        max_tokens=6000,
        temperature=0.1,
        json_mode=True,
        accept=writer.usable_notes if notes else writer.usable,
        agent_id=rec.agent_id,
        task_id=rec.task_id,
    )
    rec.cost_usd = round((rec.cost_usd or 0) + (r.cost_usd or 0), 6)
    if notes:
        return writer.parse(r.content) or writer.empty_notes()
    parsed = writer.parse(r.content)
    if parsed is None:
        raise gateway.GatewayUnavailable("The model's minutes could not be read.", r.attempts)
    return parsed


def recording_label(rec: MeetingRecording) -> str:
    bits = [rec.original_name or "recording"]
    if rec.duration_seconds:
        bits.append(audio.fmt_duration(rec.duration_seconds))
    return ", ".join(bits)


async def _today(db: AsyncSession, rec: MeetingRecording) -> date:
    ws = await db.get(Workspace, rec.workspace_id)
    return doc_service.today_in(ws.timezone if ws else None)


async def compose(db: AsyncSession, rec: MeetingRecording, beat: audio.Beat | None) -> dict:
    """Transcript text -> minutes JSON, one pass or map-reduce. Map notes are kept on the
    recording, so a retry continues where it stopped."""
    who = speaker_labels(rec)
    text = transcript.as_text(rec.transcript or [], rec.speakers if who else None, rec.language)
    name, dur = rec.original_name or "recording", audio.fmt_duration(rec.duration_seconds)
    today = await _today(db, rec)
    vocab = await vocabulary(db, rec)
    if len(text) <= SINGLE_PASS_CHARS:
        return await _ask(
            db,
            rec,
            writer.system_prompt(rec.language, vocab, speakers=who),
            writer.one_pass_prompt(
                text, name=name, duration=dur, date_hint=f"{today:%d %b %Y}", speakers=who
            ),
            task="minutes.write",
            notes=False,
        )
    parts = transcript.split_text(text, PART_CHARS)
    work = dict(rec.work or {})
    notes: dict[str, Any] = dict(work.get("notes") or {})
    for i, part in enumerate(parts):
        if str(i) in notes:
            continue
        rec.stage_detail = f"Reading part {i + 1} of {len(parts)}"
        await db.commit()
        await notify(rec)
        notes[str(i)] = await _ask(
            db,
            rec,
            writer.map_system(rec.language, vocab, speakers=who),
            writer.map_prompt(part, i, len(parts)),
            task="minutes.notes",
            notes=True,
        )
        rec.work = {**work, "notes": notes, "parts": len(parts)}
        flag_modified(rec, "work")
        await db.commit()
        if beat:
            beat()
    rec.stage_detail = "Putting the parts together"
    await db.commit()
    await notify(rec)
    ordered = [notes[str(i)] for i in range(len(parts))]
    return await _ask(
        db,
        rec,
        writer.reduce_system(rec.language, vocab, speakers=who),
        writer.reduce_prompt(ordered, name=name, duration=dur),
        task="minutes.write",
        notes=False,
    )


async def write(db: AsyncSession, rec_id: str, beat: audio.Beat | None = None) -> dict[str, Any]:
    rec = await db.get(MeetingRecording, rec_id)
    if rec is None or rec.status == "failed":
        return {"failed": True}
    if rec.status == "ready":
        return {"done": True}
    fresh = not rec.transcript
    if fresh:
        chunks = audio.plan_chunks(rec.duration_seconds or 0)
        turns = speaker_turns(rec)
        rec.transcript = transcript.stitch(chunks, rec.chunk_results or {}, turns)
        rec.speakers = speakers_from(turns, rec.transcript) if turns else {}
        if len(rec.speakers) < 2:  # one voice said everything: minutes as without labels
            rec.speakers = {}
            if turns:
                rec.transcript = unlabel(rec.transcript)
        flag_modified(rec, "transcript")
        flag_modified(rec, "speakers")
    if not rec.transcript:
        return await fail(
            db,
            rec,
            "No speech was heard in this recording. Check that the right file was uploaded "
            "and that people can be heard on it.",
        )
    rec.status, rec.stage_detail = "writing", ""
    await db.commit()
    await notify(rec)
    if fresh and rec.speakers:
        await suggest_names(db, rec, await vocabulary(db, rec))
        await db.commit()
    try:
        minutes = await compose(db, rec, beat)
    except gateway.NotConfigured as e:
        return await fail(db, rec, str(e))
    if not rec.title.strip() or rec.title == default_title(rec.original_name):
        rec.title = (minutes.get("title") or rec.title or "Meeting")[:200]
    who = speaker_labels(rec)
    if who:
        minutes = with_speakers(minutes, rec)
    rec.minutes = minutes
    flag_modified(rec, "minutes")
    today = await _today(db, rec)
    md = writer.markdown(
        minutes,
        language=rec.language,
        recording=recording_label(rec),
        date_fallback=f"{today:%d %b %Y}",
        speakers=who,
    )
    await save_document(db, rec, md, rec.created_by, note="minutes written from the recording")
    now = datetime.now(UTC)
    rec.status, rec.stage_detail, rec.error = "ready", "", None
    rec.finished_at = now
    rec.chunk_results, rec.work = {}, keep_options(rec)
    days = audio_days(await db.get(Workspace, rec.workspace_id))
    if days == 0 and rec.audio_file:
        audio.remove_file(audio.folder(rec.workspace_id, rec.id) / rec.audio_file)
        rec.audio_file, rec.audio_purged_at = None, now
    elif rec.audio_file:
        rec.audio_expires_at = now + timedelta(days=days)
    await db.commit()
    await publish_library(db, rec)  # every finished minutes is searchable by agents
    await notify(rec)
    return {"done": True}


def with_speakers(minutes: dict[str, Any], rec: MeetingRecording) -> dict[str, Any]:
    """Named speakers are attendees; the names used are kept so a rename shows the minutes
    are out of date ("Rewrite with names")."""
    names = current_names(rec)
    label = re.compile(r"^(speaker|penutur)\s*\d+$", re.I)
    people = [p for p in minutes.get("attendees") or [] if not label.match(p.strip())]
    have = {p.casefold() for p in people}
    for n in names.values():
        if n and n.casefold() not in have and not any(n.casefold() in p for p in have):
            people.append(n)
            have.add(n.casefold())
    return {**minutes, "attendees": people, "speaker_names": names}


def default_title(name: str) -> str:
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name or "").replace("_", " ").strip()
    return stem[:200] or "Meeting"


# ---------------------------------------------------------------- document and library


async def save_document(
    db: AsyncSession, rec: MeetingRecording, md: str, actor: str, note: str = ""
) -> Document:
    """The minutes as a Document: the editor, versions and PDF/Word exports come with it."""
    title = f"Minutes: {rec.title or 'Meeting'}"[:200]
    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is None:
        doc = await doc_service.create_document(
            db,
            workspace_id=rec.workspace_id,
            branch_id=rec.branch_id,
            template=None,
            title=title,
            values={},
            body=md,
            created_by=rec.created_by,
            task_id=rec.task_id,
            agent_id=rec.agent_id,
        )
        doc.kind = "minutes"
        rec.document_id = doc.id
    else:
        await doc_service.snapshot(db, doc, actor, note or "minutes rewritten")
        doc.title, doc.body, doc.status = title, md, "draft"
        doc.updated_at = datetime.now(UTC)
    return doc


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()[:60] or "meeting"


async def publish_library(db: AsyncSession, rec: MeetingRecording) -> DocFile | None:
    """Copy the current minutes into the knowledge library (scoped like the recording) and
    rebuild its passages. Commits."""
    from ..knowledge import indexer

    doc = await db.get(Document, rec.document_id) if rec.document_id else None
    if doc is None:
        return None
    body = doc.body or ""
    data = body.encode()
    name = f"{_slug(rec.title)}-minutes.md"
    f = await db.get(DocFile, rec.library_file_id) if rec.library_file_id else None
    if f is None:
        f = await doc_service.create_file(
            db,
            workspace_id=rec.workspace_id,
            name=name,
            data=data,
            created_by=rec.created_by,
            mime="text/markdown",
            branch_id=rec.branch_id,
            task_id=rec.task_id,
            agent_id=rec.agent_id,
            source="generated",
            status="ready",
        )
        rec.library_file_id = f.id
    else:
        f.data, f.size, f.name = data, len(data), name
        f.sha256 = hashlib.sha256(data).hexdigest()
        f.branch_id = rec.branch_id
    f.mime = "text/markdown"
    f.text = body
    f.title = doc.title[:200]
    f.kind = "Meeting minutes"
    f.summary = str((rec.minutes or {}).get("summary") or "")[:1000]
    f.status, f.error = "ready", None
    f.library, f.department_id = True, rec.department_id
    rec.published_at = datetime.now(UTC)
    await db.commit()
    try:
        await indexer.index_file(db, f.id)
    except Exception:  # noqa: BLE001 - the minutes are saved; indexing can be redone
        await db.rollback()
        log.warning("could not index minutes %s", rec.id, exc_info=True)
    return f


def actions_section(md: str, minutes: dict[str, Any], language: str) -> str:
    """Swap the action-item table in the minutes text for the current items, leaving the
    rest of the person's edits alone. Unchanged when the section is gone."""
    labels = writer.LABELS.get(language, writer.LABELS["en"])
    head = f"## {labels['actions']}"
    start = md.find(head)
    if start < 0:
        return md
    nxt = md.find("\n## ", start + len(head))
    fresh = writer.markdown(
        {"action_items": minutes.get("action_items") or []},
        language=language,
        recording="",
        date_fallback="",
    )
    table = fresh[fresh.find(head) :].rstrip()  # only items given: it is the last section
    tail = md[nxt:] if nxt >= 0 else ""
    return md[:start] + table + ("\n" + tail if tail else "\n")


# ---------------------------------------------------------------- action items -> tasks


def _due_label(due_date: str | None) -> str | None:
    try:
        return f"due {date.fromisoformat(due_date or ''):%Y-%m-%d}"
    except ValueError:
        return None


async def action_task(
    db: AsyncSession,
    rec: MeetingRecording,
    index: int,
    *,
    actor: str,
    agent: Agent | None = None,
    owner: str | None = None,
    due_date: str | None = None,
) -> Task:
    """One action item becomes a task (idempotent: an item keeps its task). An agent owner
    gets it ready to work on; a person's item waits in triage with their name on it."""
    m = dict(rec.minutes or {})
    items = [dict(x) for x in m.get("action_items") or []]
    item = items[index]
    if item.get("task_id"):
        existing = await db.get(Task, item["task_id"])
        if existing is not None:
            return existing
    who = (owner if owner is not None else item.get("owner") or "").strip()[:120]
    due = due_date if due_date is not None else item.get("due_date") or ""
    when = due or item.get("due") or ""
    lines = [
        f'Action item from the meeting "{rec.title}".',
        "",
        f"Owner: {agent.name + ' (agent)' if agent else who or 'not named'}",
    ]
    if agent and who:
        lines.append(f"Named in the meeting: {who}")
    if when:
        lines.append(f"Due: {when}")
    decisions = (rec.minutes or {}).get("decisions") or []
    if decisions:
        lines += ["", "Decisions in that meeting:", *[f"- {d}" for d in decisions[:8]]]
    lines += ["", f"Minutes: /meetings?tab=minutes&rec={rec.id}"]
    labels = ["minutes"] + ([lbl] if (lbl := _due_label(due)) else [])
    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == rec.workspace_id)
        )
        or 0
    )
    t = Task(
        workspace_id=rec.workspace_id,
        title=item["what"][:200],
        brief="\n".join(lines),
        priority="normal",
        assignee_agent_id=agent.id if agent else None,
        branch_id=agent.branch_id if agent else rec.branch_id,
        requires_review=True,
        labels=labels,
        created_by=actor,
        source="minutes",
        status="ready" if agent else "triage",
        position=float(lowest) - 1,
    )
    db.add(t)
    await db.flush()
    item.update(
        task_id=t.id,
        owner=who,
        owner_agent_id=agent.id if agent else None,
        owner_label=agent.name if agent else who,
        due_date=due,
    )
    items[index] = item
    m["action_items"] = items
    rec.minutes = m
    flag_modified(rec, "minutes")
    return t


# ---------------------------------------------------------------- nightly purge


async def purge(db: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """Delete audio past its retention, originals of recordings that failed days ago, and
    folders no recording owns (an upload cut off mid-way)."""
    now = now or datetime.now(UTC)
    counts = {"audio": 0, "originals": 0, "orphans": 0}
    expired = (
        await db.scalars(
            select(MeetingRecording).where(
                MeetingRecording.audio_file.is_not(None),
                MeetingRecording.audio_expires_at.is_not(None),
                MeetingRecording.audio_expires_at <= now,
            )
        )
    ).all()
    for rec in expired:
        audio.remove_file(audio.folder(rec.workspace_id, rec.id) / str(rec.audio_file))
        rec.audio_file, rec.audio_purged_at = None, now
        counts["audio"] += 1
    stale = (
        await db.scalars(
            select(MeetingRecording).where(
                MeetingRecording.status == "failed",
                MeetingRecording.original_file.is_not(None),
                MeetingRecording.updated_at <= now - timedelta(days=FAILED_ORIGINAL_DAYS),
            )
        )
    ).all()
    for rec in stale:
        audio.remove_file(audio.folder(rec.workspace_id, rec.id) / str(rec.original_file))
        rec.original_file = None
        counts["originals"] += 1
    await db.commit()
    root = audio.root()
    if root.is_dir():
        known = set((await db.scalars(select(MeetingRecording.id))).all())
        cutoff = (now - timedelta(hours=ORPHAN_HOURS)).timestamp()
        for ws_dir in (p for p in root.iterdir() if p.is_dir()):
            for rec_dir in (p for p in ws_dir.iterdir() if p.is_dir()):
                if rec_dir.name not in known and rec_dir.stat().st_mtime < cutoff:
                    shutil.rmtree(rec_dir, ignore_errors=True)
                    counts["orphans"] += 1
    if any(counts.values()):
        log.info("minutes purge: %s", counts)
    return counts
