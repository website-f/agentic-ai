"""Who spoke when: speaker separation (diarization) on the CPU, no paid API, no token.

sherpa-onnx runs two small ONNX models baked into the image (deploy/api.Dockerfile):
pyannote segmentation-3.0 (MIT) finds speech and speaker changes in 10-second windows, and
3D-Speaker CAM++ zh-en common (Apache-2.0, trained on ~200k Chinese and English speakers, so
it copes with Manglish) turns a voice into a 192-number embedding that clusters into speakers.
Nothing is downloaded at runtime and no audio leaves the server.

Memory: the recording is heard in windows of WINDOW_SECONDS, each in its own short-lived
process (`python -m agentic.minutes.diarize`), so the peak stays the same however long the
meeting is, the memory is handed back when the window is done, and a native crash cannot
take the worker down. Each window reports its own speakers with one voice embedding each;
link() clusters those across windows (two speakers the same window told apart never merge)
into S1, S2, ... for the whole meeting, numbered in the order they first speak.

Anything that goes wrong here only costs the speaker labels: the minutes are written as
before, without them.
"""

import argparse
import json
import math
import os
import subprocess  # noqa: S404 - ffmpeg with a fixed argument list
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SAMPLE_RATE = 16000
WINDOW_SECONDS = 600.0  # one process per 10 minutes of audio (~19 MB of 16-bit samples)
MIN_LAST_WINDOW = 120.0  # a shorter tail joins the window before it
SEGMENTATION_MODEL = "pyannote-segmentation-3.0.onnx"
EMBEDDING_MODEL = "3dspeaker_campplus_sv_zh_en_16k-common_advanced.onnx"
DEFAULT_MODEL_DIR = "/opt/models/speakers"

# Within a window sherpa clusters per-chunk embeddings; across windows we cluster each
# window speaker's averaged embedding (up to EMBED_SECONDS of their clearest speech).
# Cosine distances: smaller = more alike. With this model one voice's turns sit under 0.3
# of each other and different voices above 0.7 on our test meetings; 0.5 is the middle.
WINDOW_THRESHOLD = 0.5
LINK_THRESHOLD = 0.5
EMBED_SECONDS = 20.0
MIN_PIECE = 0.5  # seconds of one voice alone worth embedding
MERGE_GAP = 0.6  # a pause shorter than this between the same voice is one turn
MIN_SPEAKER_SECONDS = 3.0  # a "speaker" heard for less than this is noise, not a person
MAX_SPEAKERS = 10
CLIP_GAP = 2.0  # a clip may run over pauses this long between the same voice's turns
# The segmentation model hears 10-second windows; each step moves this share of a window.
# 0.1 (upstream default) hears every second ten times; 0.25 is ~2.3x faster for about the
# same error on our test meetings; 0.5 starts mixing up speakers.
SHIFT_RATIO = 0.25


def model_dir() -> Path:
    return Path(os.environ.get("AGENTIC_SPEAKER_MODELS") or DEFAULT_MODEL_DIR)


def _import() -> Any:
    import sherpa_onnx  # sherpa-onnx-core carries its own onnxruntime library

    return sherpa_onnx


def available() -> bool:
    """The models are on disk and sherpa-onnx imports (it is in the image, not on a dev
    laptop without the models)."""
    d = model_dir()
    if not ((d / SEGMENTATION_MODEL).is_file() and (d / EMBEDDING_MODEL).is_file()):
        return False
    try:
        _import()
    except ImportError:
        return False
    return True


# ---------------------------------------------------------------- windows


def plan_windows(duration: float, size: float = WINDOW_SECONDS) -> list[tuple[float, float]]:
    """(start, length) windows covering the recording; a short tail joins the last one."""
    if not duration or duration <= 0:
        return []
    n = max(1, math.floor(duration / size))
    if duration - n * size >= MIN_LAST_WINDOW:
        n += 1
    out = []
    for i in range(n):
        start = i * size
        end = duration if i == n - 1 else (i + 1) * size
        out.append((round(start, 3), round(end - start, 3)))
    return out


# ---------------------------------------------------------------- one window (subprocess)


def _intervals_minus(a: float, b: float, others: list[tuple[float, float]]) -> list[tuple]:
    """[a, b) with the parts that overlap `others` cut out."""
    pieces = [(a, b)]
    for oa, ob in others:
        nxt = []
        for pa, pb in pieces:
            if ob <= pa or oa >= pb:
                nxt.append((pa, pb))
                continue
            if oa > pa:
                nxt.append((pa, oa))
            if ob < pb:
                nxt.append((ob, pb))
        pieces = nxt
    return pieces


def separate(samples: Any, num_speakers: int = 0) -> dict[str, Any]:
    """Speakers in one window of 16 kHz mono float32 samples.

    {"segments": [[start, end, local], ...], "speakers": {local: {"embedding": [...],
    "seconds": s}}}. Times are seconds from the window's start."""
    import numpy as np

    sherpa_onnx = _import()
    d = model_dir()
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    if len(samples) < SAMPLE_RATE:  # under a second: nobody to tell apart
        return {"segments": [], "speakers": {}}
    embedding = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(d / EMBEDDING_MODEL), num_threads=1
    )
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(d / SEGMENTATION_MODEL), window_shift_ratio=SHIFT_RATIO
            ),
            num_threads=1,
        ),
        embedding=embedding,
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=num_speakers if num_speakers > 0 else -1, threshold=WINDOW_THRESHOLD
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError("speaker models are not usable")
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    result = sd.process(samples).sort_by_start_time()
    segs = [(round(r.start, 3), round(r.end, 3), int(r.speaker)) for r in result]
    del sd

    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(embedding)
    speakers: dict[str, dict[str, Any]] = {}
    for spk in sorted({s[2] for s in segs}):
        mine = [(a, b) for a, b, k in segs if k == spk]
        others = [(a, b) for a, b, k in segs if k != spk]
        clean = [p for a, b in mine for p in _intervals_minus(a, b, others)]
        clean = [p for p in clean if p[1] - p[0] >= MIN_PIECE] or mine
        clean.sort(key=lambda p: p[0] - p[1])  # longest first
        took, parts = 0.0, []
        for a, b in clean:
            if took >= EMBED_SECONDS:
                break
            b = min(b, a + EMBED_SECONDS - took)
            parts.append(samples[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)])
            took += b - a
        audio = np.concatenate(parts) if parts else np.zeros(0, np.float32)
        if len(audio) < SAMPLE_RATE // 2:
            continue  # too little to recognise this voice elsewhere
        stream = extractor.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        stream.input_finished()
        if not extractor.is_ready(stream):
            continue
        vec = np.asarray(extractor.compute(stream), dtype=np.float32)
        vec /= float(np.linalg.norm(vec)) or 1.0
        speakers[str(spk)] = {
            "embedding": [round(float(x), 5) for x in vec],
            "seconds": round(sum(b - a for a, b in mine), 2),
        }
    return {
        "segments": [[a, b, str(k)] for a, b, k in segs if str(k) in speakers],
        "speakers": speakers,
    }


def decode(path: str, start: float, length: float) -> Any:
    """One window of the recording as float32 samples (ffmpeg decodes it to raw PCM)."""
    import numpy as np

    out = subprocess.run(  # noqa: S603 - fixed argv
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error"]
        + ["-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path]
        + ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
        capture_output=True,
        check=False,
        timeout=600,
    )
    if out.returncode != 0:
        lines = [x for x in out.stderr.decode(errors="replace").splitlines() if x.strip()]
        raise RuntimeError((lines[-1] if lines else "ffmpeg failed")[:240])
    pcm = np.frombuffer(out.stdout, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Separate the speakers in one audio window.")
    p.add_argument("audio")
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--length", type=float, required=True)
    p.add_argument("--speakers", type=int, default=0)
    a = p.parse_args(argv)
    samples = decode(a.audio, a.start, a.length)
    out = separate(samples, a.speakers)
    if os.environ.get("AGENTIC_DIARIZE_RSS") and sys.platform != "win32":
        import resource  # measuring: the window's peak memory (Linux reports KiB)

        out["peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    sys.stdout.write(json.dumps(out, separators=(",", ":")))
    return 0


# ---------------------------------------------------------------- from the worker


class SpeakerError(Exception):
    """Separation could not run on this window; the minutes go on without speaker labels."""


WINDOW_TIMEOUT = 900.0  # a 10-minute window takes 1-3 minutes on one CPU core


async def run_window(
    path: Path, start: float, length: float, speakers: int = 0, beat: Any = None
) -> dict[str, Any]:
    """One window in its own process (memory comes back when it exits; a native crash
    stays there). Heartbeats every 10 s through audio.run."""
    from . import audio

    out = await audio.run(
        [sys.executable, "-m", "agentic.minutes.diarize", str(path)]
        + ["--start", f"{start:.3f}", "--length", f"{length:.3f}", "--speakers", str(speakers)],
        timeout=WINDOW_TIMEOUT,
        beat=beat,
    )
    try:
        data = json.loads(out)
    except ValueError as e:
        raise SpeakerError("speaker separation gave no result") from e
    if not isinstance(data, dict) or not isinstance(data.get("speakers"), dict):
        raise SpeakerError("speaker separation gave no result")
    return {"segments": data.get("segments") or [], "speakers": data["speakers"]}


# ---------------------------------------------------------------- the whole meeting


@dataclass
class _Item:
    window: int
    local: str
    vec: Any
    seconds: float


def _cosine_link(items: list[_Item], num_speakers: int, threshold: float) -> list[int]:
    """Average-linkage clustering on cosine distance, never merging two speakers that one
    window already told apart. Merges below `threshold`; with `num_speakers`, merges until
    that many remain (or nothing more may merge). Returns a cluster index per item."""
    import numpy as np

    n = len(items)
    if n == 0:
        return []
    m = np.stack([it.vec for it in items])
    dist = 1.0 - m @ m.T
    clusters: list[list[int]] = [[i] for i in range(n)]
    while len(clusters) > 1:
        best, pair = math.inf, None
        for x in range(len(clusters)):
            for y in range(x + 1, len(clusters)):
                cx, cy = clusters[x], clusters[y]
                wx = {items[i].window for i in cx}
                if any(items[j].window in wx for j in cy):
                    continue  # the same window heard them as two voices
                dd = float(dist[np.ix_(cx, cy)].mean())
                if dd < best:
                    best, pair = dd, (x, y)
        if pair is None:
            break
        if num_speakers > 0:
            if len(clusters) <= num_speakers:
                break
        elif best > threshold:
            break
        x, y = pair
        clusters[x] = clusters[x] + clusters[y]
        del clusters[y]
    out = [0] * n
    for ci, members in enumerate(clusters):
        for i in members:
            out[i] = ci
    return out


def link(
    windows: list[tuple[float, dict[str, Any]]],
    num_speakers: int = 0,
    threshold: float = LINK_THRESHOLD,
) -> list[list[Any]]:
    """Window results [(window start, separate() output)] -> meeting turns
    [[start, end, "S1"], ...] on the recording's clock. Empty when fewer than two voices
    were heard (one person talking, or nothing usable): the minutes then have no labels."""
    import numpy as np

    items: list[_Item] = []
    for w, (_, res) in enumerate(windows):
        for local, sp in (res.get("speakers") or {}).items():
            vec = np.asarray(sp.get("embedding") or [], dtype=np.float32)
            if vec.size == 0:
                continue
            vec /= float(np.linalg.norm(vec)) or 1.0
            items.append(_Item(w, str(local), vec, float(sp.get("seconds") or 0)))
    if not items:
        return []
    dims = {it.vec.size for it in items}
    if len(dims) != 1:
        return []
    cluster = _cosine_link(items, min(num_speakers, MAX_SPEAKERS), threshold)
    which = {(it.window, it.local): c for it, c in zip(items, cluster, strict=True)}
    raw: list[tuple[float, float, int]] = []
    for w, (offset, res) in enumerate(windows):
        for a, b, local in res.get("segments") or []:
            c = which.get((w, str(local)))
            if c is not None and b > a:
                raw.append((round(offset + float(a), 3), round(offset + float(b), 3), c))
    raw.sort()
    # Noise clusters (a cough, a door) are not people.
    talk: dict[int, float] = {}
    for a, b, c in raw:
        talk[c] = talk.get(c, 0.0) + (b - a)
    keep = {c for c, s in talk.items() if s >= MIN_SPEAKER_SECONDS}
    raw = [r for r in raw if r[2] in keep]
    if len(keep) < 2:
        return []
    merged: list[list[Any]] = []
    for a, b, c in raw:
        if merged and merged[-1][2] == c and a - merged[-1][1] <= MERGE_GAP:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b, c])
    names: dict[int, str] = {}
    for _, _, c in merged:
        if c not in names:
            names[c] = f"S{len(names) + 1}"
    return [[round(a, 2), round(b, 2), names[c]] for a, b, c in merged]


def talk_time(turns: list[list[Any]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for a, b, s in turns:
        out[s] = round(out.get(s, 0.0) + (b - a), 1)
    return out


def clip_for(turns: list[list[Any]], label: str, length: float = 10.0) -> list[float] | None:
    """[start, seconds] of the longest stretch where only this speaker talks (short pauses
    between their own turns included), so a person can recognise the voice."""
    best = None
    for i, (a, b, s) in enumerate(turns):
        if s != label or (i and turns[i - 1][2] == label and a - turns[i - 1][1] <= CLIP_GAP):
            continue  # starts a stretch only where the previous turn is not theirs
        end = b
        for ta, tb, ts in turns[i + 1 :]:
            if ta >= end + CLIP_GAP:
                break
            if ts != label:  # another voice: the stretch ends where it starts
                end = min(end, ta) if ta < end else end
                break
            end = max(end, tb)
        span = max(0.0, end - a)
        if best is None or span > best[1]:
            best = (a, span)
    if best is None or best[1] < 1.0:
        return None
    start = best[0] + (0.2 if best[1] > 3 else 0.0)
    return [round(start, 2), round(min(length, best[0] + best[1] - start), 2)]


if __name__ == "__main__":
    raise SystemExit(main())
