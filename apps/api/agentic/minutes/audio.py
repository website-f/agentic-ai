"""Recordings on disk and the ffmpeg work on them.

Big uploads (up to ~1 GB, 4 hours) never go into Postgres: they stream to
<media_dir>/<workspace>/<recording>/original.<ext> on a volume both the api and the worker
mount. ffmpeg keeps one small mono 16 kHz MP3 copy (about 14 MB an hour), the original is
deleted, and each chunk the speech model hears is cut from that copy just before it is sent.

The transcribe gateway refuses anything over 10 minutes, so the plan cuts chunks of at most
9.5 minutes with a 2-second overlap; stitching keeps each overlapped sentence once.
"""

import asyncio
import json
import math
import re
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..core.config import settings

MAX_CHUNK_SECONDS = 570.0  # under the gateway's 10-minute cap
OVERLAP_SECONDS = 2.0
# MP3 rather than Opus: every browser plays it (iPhone Safari too) and seeks it by byte range,
# and both Groq and OpenAI accept it. 32 kbit/s mono = about 14 MB an hour.
AUDIO_NAME = "audio.mp3"
AUDIO_MIME = "audio/mpeg"
ENCODE_ARGS = ["-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k"]

# What people record meetings with: phones (m4a, mp3, amr, 3gp), laptops and Zoom/Meet/Teams
# (mp4, webm, mkv, mov), voice recorders (wav, mp3, wma), WhatsApp (ogg/opus).
EXTENSIONS = frozenset(
    {
        "mp3", "m4a", "wav", "ogg", "oga", "opus", "webm", "mp4", "mov", "m4v", "aac",
        "flac", "mkv", "3gp", "amr", "wma", "mpeg", "mpga",
    }
)  # fmt: skip

Beat = Callable[[], None]


class FFmpegError(Exception):
    """ffmpeg/ffprobe missing, refused the file, or ran too long. The message is for people."""


def extension(name: str) -> str:
    m = re.search(r"\.([A-Za-z0-9]{2,5})$", name or "")
    return m.group(1).lower() if m else ""


def accepted(name: str, mime: str) -> bool:
    if extension(name) in EXTENSIONS:
        return True
    m = (mime or "").split(";", 1)[0].strip().lower()
    return m.startswith(("audio/", "video/"))


def _safe(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", part)[:60] or "_"


def root() -> Path:
    return Path(settings.media_dir)


def folder(workspace_id: str, recording_id: str) -> Path:
    return root() / _safe(workspace_id) / _safe(recording_id)


def remove_folder(workspace_id: str, recording_id: str) -> None:
    shutil.rmtree(folder(workspace_id, recording_id), ignore_errors=True)


def remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


# ---------------------------------------------------------------- the chunk plan


@dataclass(frozen=True)
class Chunk:
    index: int
    start: float  # where the cut begins (with the overlap)
    end: float
    keep_from: float  # stitching keeps the segments whose middle falls in [keep_from, keep_to)
    keep_to: float

    @property
    def length(self) -> float:
        return round(self.end - self.start, 3)


def plan_chunks(
    duration: float, max_len: float = MAX_CHUNK_SECONDS, overlap: float = OVERLAP_SECONDS
) -> list[Chunk]:
    """Equal chunks of at most `max_len` seconds; each but the first starts `overlap`
    seconds early so a word cut at a boundary is heard whole once."""
    if not duration or duration <= 0:
        return []
    n = max(1, math.ceil(duration / (max_len - overlap)))
    step = duration / n
    out: list[Chunk] = []
    for i in range(n):
        keep_to = duration if i == n - 1 else (i + 1) * step
        out.append(
            Chunk(
                index=i,
                start=round(max(0.0, i * step - overlap), 3),
                end=round(keep_to, 3),
                keep_from=round(i * step, 3),
                keep_to=round(keep_to, 3),
            )
        )
    return out


# ---------------------------------------------------------------- ffmpeg


async def run(args: list[str], *, timeout: float, beat: Beat | None = None) -> str:
    """Run ffmpeg/ffprobe; heartbeat every 10 s so Temporal knows the worker is alive."""
    if shutil.which(args[0]) is None:
        raise FFmpegError(f"{args[0]} is not installed on this server (see deploy/api.Dockerfile).")
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    job = asyncio.ensure_future(proc.communicate())
    waited = 0.0
    while True:
        done, _ = await asyncio.wait({job}, timeout=10)
        if done:
            break
        waited += 10
        if beat:
            beat()
        if waited > timeout:
            proc.kill()
            await asyncio.gather(job, return_exceptions=True)
            raise FFmpegError(f"{args[0]} took longer than {int(timeout // 60)} minutes.")
    out, err = job.result()
    if proc.returncode != 0:
        lines = [x for x in err.decode(errors="replace").splitlines() if x.strip()]
        raise FFmpegError((lines[-1] if lines else f"{args[0]} failed")[:240])
    return out.decode(errors="replace")


@dataclass
class Probe:
    seconds: float
    has_audio: bool


async def probe(path: Path, beat: Beat | None = None) -> Probe:
    out = await run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            str(path),
        ],
        timeout=120,
        beat=beat,
    )
    try:
        data = json.loads(out or "{}")
    except ValueError as e:
        raise FFmpegError("Could not read the recording's length.") from e
    try:
        seconds = float((data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        seconds = 0.0
    streams = data.get("streams") or []
    has_audio = any(isinstance(s, dict) and s.get("codec_type") == "audio" for s in streams)
    return Probe(seconds=seconds, has_audio=has_audio)


async def extract(src: Path, dst: Path, seconds: float, beat: Beat | None = None) -> None:
    """The sound track only, mono 16 kHz: all a speech model needs, at a fraction of the size."""
    tmp = dst.with_suffix(".part.mp3")
    remove_file(tmp)
    await run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src)]
        + ["-vn", "-sn", "-dn", *ENCODE_ARGS, str(tmp)],
        # Decoding an hour of audio takes well under a minute; video demuxing a bit more.
        timeout=max(900.0, seconds),
        beat=beat,
    )
    tmp.replace(dst)


async def cut(src: Path, dst: Path, start: float, length: float, beat: Beat | None = None) -> bytes:
    """One chunk, re-encoded (accurate edges), returned as bytes and deleted."""
    try:
        await run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
            + ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(src)]
            + [*ENCODE_ARGS, str(dst)],
            timeout=300,
            beat=beat,
        )
        return await asyncio.to_thread(dst.read_bytes)
    finally:
        remove_file(dst)


def fmt_duration(seconds: float | None) -> str:
    if not seconds:
        return ""
    s = round(seconds)
    h, m = divmod(s // 60, 60)
    if h:
        return f"{h} h {m} min" if m else f"{h} h"
    return f"{m} min" if m else f"{s} s"
