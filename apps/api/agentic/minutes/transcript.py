"""Stitch the chunks' transcripts into one timestamped transcript.

Each chunk comes back with segments timed from the chunk's own start (Whisper's
verbose_json) or, from models that give no segments, one block of text. Times are moved onto
the recording's clock, the overlap between chunks is kept once (by the segment's middle), and
Whisper's habit of repeating a line over silence ("Terima kasih.", "Thank you.") is dropped.
Segments are then joined into paragraphs of about half a minute: readable, and each one a
click target that plays that moment.

When the voices were told apart (diarize.py), each segment takes the speaker heard during
it; a segment spanning a change of speaker is cut at the word nearest the change, and every
paragraph belongs to one speaker ("s": "S1"). Without speaker turns nothing changes.
"""

import bisect
import re
from typing import Any

from .audio import Chunk

PARAGRAPH_SECONDS = 30.0
PARAGRAPH_MAX_SECONDS = 60.0
_END = re.compile(r"[.!?…]['\")\]]?$")


def fmt_time(seconds: float) -> str:
    s = max(0, int(seconds))
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _norm(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def segments(chunks: list[Chunk], results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Every heard segment on the recording's clock, overlap kept once, in order."""
    out: list[dict[str, Any]] = []
    last = len(chunks) - 1
    for c in chunks:
        r = results.get(str(c.index)) or {}
        parts = list(r.get("segments") or [])
        if not parts and str(r.get("text") or "").strip():
            parts = [{"start": 0.0, "end": c.length, "text": str(r["text"])}]
        for s in parts:
            try:
                a = c.start + float(s.get("start") or 0)
                b = c.start + float(s.get("end") or 0)
            except (TypeError, ValueError):
                continue
            b = max(a, min(b, c.end))
            text = " ".join(str(s.get("text") or "").split())
            if not text:
                continue
            mid = (a + b) / 2
            if c.index > 0 and mid < c.keep_from:
                continue
            if c.index < last and mid >= c.keep_to:
                continue
            if out and _norm(out[-1]["text"]) == _norm(text):
                out[-1]["e"] = round(b, 2)  # a repeat over silence: one line, longer
                continue
            out.append({"t": round(a, 2), "e": round(b, 2), "text": text})
    return out


def paragraphs(segs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Segments joined into paragraphs; a new speaker always starts a new paragraph."""
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for s in segs:
        if cur is None:
            cur = dict(s)
            continue
        span = cur["e"] - cur["t"]
        if (
            cur.get("s") != s.get("s")
            or span >= PARAGRAPH_MAX_SECONDS
            or (span >= PARAGRAPH_SECONDS and _END.search(cur["text"]))
        ):
            out.append(cur)
            cur = dict(s)
            continue
        cur["text"] = f"{cur['text']} {s['text']}"
        cur["e"] = s["e"]
    if cur is not None:
        out.append(cur)
    return out


def stitch(
    chunks: list[Chunk],
    results: dict[str, dict[str, Any]],
    turns: list[list[Any]] | None = None,
) -> list[dict[str, Any]]:
    """The transcript; with speaker turns (diarize.link) every paragraph gets its "s"."""
    segs = segments(chunks, results)
    if turns:
        segs = label(segs, turns)
    return paragraphs(segs)


# ---------------------------------------------------------------- speakers

SPLIT_MIN_SECONDS = 1.0  # a voice must talk this long inside a segment to get its own piece
LONG_SEGMENT = 30.0  # longer: a model gave no segment times; sentences are spread over speech
NEAREST_SECONDS = 3.0  # a segment no turn covers takes the nearest voice this close
_SENTENCE = re.compile(r"(?<=[.!?…])\s+")


class _Turns:
    """Speaker turns [[start, end, label], ...] with a lookup by time."""

    def __init__(self, turns: list[list[Any]]) -> None:
        self.turns = sorted(
            ((float(a), float(b), str(s)) for a, b, s in turns if float(b) > float(a)),
            key=lambda x: x[0],
        )
        self.starts = [t[0] for t in self.turns]
        self.longest = max((b - a for a, b, _ in self.turns), default=0.0)

    def within(self, a: float, b: float) -> list[tuple[float, float, str]]:
        """Turns overlapping [a, b), clipped to it, in time order."""
        lo = bisect.bisect_left(self.starts, a - self.longest)
        hi = bisect.bisect_left(self.starts, b)
        return [(max(a, ta), min(b, tb), s) for ta, tb, s in self.turns[lo:hi] if tb > a]

    def nearest(self, a: float, b: float) -> str | None:
        best, label_ = NEAREST_SECONDS, None
        i = bisect.bisect_left(self.starts, a)
        for ta, tb, s in self.turns[max(0, i - 3) : i + 3]:
            gap = max(ta - b, a - tb, 0.0)
            if gap <= best:
                best, label_ = gap, s
        return label_


def _runs(a: float, b: float, turns: _Turns) -> list[list[Any]]:
    """Who talks inside [a, b): consecutive same-voice stretches merged, blips dropped."""
    runs: list[list[Any]] = []
    for ta, tb, s in turns.within(a, b):
        if runs and runs[-1][2] == s:
            runs[-1][1] = max(runs[-1][1], tb)
        else:
            runs.append([ta, tb, s])
    if len(runs) > 1:
        runs = [r for r in runs if r[1] - r[0] >= SPLIT_MIN_SECONDS] or [
            max(runs, key=lambda r: r[1] - r[0])
        ]
        merged: list[list[Any]] = []
        for r in runs:
            if merged and merged[-1][2] == r[2]:
                merged[-1][1] = max(merged[-1][1], r[1])
            else:
                merged.append(list(r))
        runs = merged
    return runs


def _cut_points(text: str, shares: list[float]) -> list[int]:
    """Character positions that cut `text` into pieces of about these shares, on word
    boundaries, preferring the end of a sentence near the target."""
    bounds = [m.end() for m in re.finditer(r"\S+(?=\s|$)", text)][:-1]
    sentence_ends = [p for p in bounds if _END.search(text[:p])]
    cuts: list[int] = []
    total, acc = len(text), 0.0
    for share in shares[:-1]:
        acc += share
        target = acc * total
        near = [p for p in sentence_ends if abs(p - target) <= 0.2 * total]
        pool = [p for p in (near or bounds) if not cuts or p > cuts[-1]]
        if not pool:
            break
        cuts.append(min(pool, key=lambda p: abs(p - target)))
    return cuts


def _split(
    seg: dict[str, Any], turns: _Turns, previous: str | None, cut: bool = True
) -> list[dict[str, Any]]:
    a, b, text = float(seg["t"]), float(seg["e"]), str(seg["text"])
    runs = _runs(a, b, turns)
    if not runs:
        who = turns.nearest(a, b) or previous
        return [{**seg, "s": who} if who else dict(seg)]
    if not cut or len(runs) == 1 or len(text.split()) < 4:
        talk: dict[str, float] = {}
        for ra, rb, s in runs:
            talk[s] = talk.get(s, 0.0) + rb - ra
        return [{**seg, "s": max(talk, key=lambda k: talk[k])}]
    spoken = sum(r[1] - r[0] for r in runs) or 1.0
    cuts = _cut_points(text, [(r[1] - r[0]) / spoken for r in runs])
    edges = [0, *cuts, len(text)]
    out: list[dict[str, Any]] = []
    for k in range(len(edges) - 1):
        piece = text[edges[k] : edges[k + 1]].strip()
        if not piece:
            continue
        r = runs[min(k, len(runs) - 1)]
        start = a if k == 0 else r[0]
        end = b if k == len(edges) - 2 else runs[min(k + 1, len(runs) - 1)][0]
        if out and out[-1]["s"] == r[2]:
            out[-1]["text"] += f" {piece}"
            out[-1]["e"] = round(max(end, start), 2)
            continue
        out.append({"t": round(start, 2), "e": round(max(end, start), 2), "text": piece, "s": r[2]})
    return out or [{**seg, "s": runs[0][2]}]


def _spread(seg: dict[str, Any], turns: _Turns) -> list[dict[str, Any]]:
    """A long block with no inner times (a model that gives no segments): its sentences laid
    over the stretches where someone is talking, in proportion to their length."""
    a, b = float(seg["t"]), float(seg["e"])
    speech: list[list[float]] = []
    for ta, tb, _ in turns.within(a, b):
        if speech and ta <= speech[-1][1]:
            speech[-1][1] = max(speech[-1][1], tb)
        else:
            speech.append([ta, tb])
    sentences = [x for x in _SENTENCE.split(str(seg["text"])) if x.strip()]
    total = sum(e - s for s, e in speech)
    if len(sentences) < 2 or total <= 0:
        return [seg]

    def clock(pos: float) -> float:
        for s, e in speech:
            if pos <= e - s:
                return s + pos
            pos -= e - s
        return speech[-1][1]

    chars = sum(len(x) for x in sentences) or 1
    out, done = [], 0
    for x in sentences:
        t0 = clock(done / chars * total)
        done += len(x)
        out.append({"t": round(t0, 2), "e": round(clock(done / chars * total), 2), "text": x})
    return out


def label(segs: list[dict[str, Any]], turns: list[list[Any]]) -> list[dict[str, Any]]:
    """Each segment gets the speaker heard during it ("s"); one that clearly spans a change
    of speaker is cut at the word (or sentence end) nearest the change."""
    tt = _Turns(turns)
    if not tt.turns:
        return segs
    out: list[dict[str, Any]] = []
    for seg in segs:
        spread = seg["e"] - seg["t"] > LONG_SEGMENT
        pieces = _spread(seg, tt) if spread else [seg]
        for p in pieces:
            # Spread sentences have estimated times: each goes whole to its main voice.
            out.extend(_split(p, tt, out[-1].get("s") if out else None, cut=not spread))
    return out


def speaker_name(label_: str, speakers: dict[str, Any], language: str = "en") -> str:
    """A speaker as the minutes call them: the person's name, or "Speaker 2" until named."""
    name = str((speakers.get(label_) or {}).get("name") or "").strip()
    if name:
        return name
    n = label_[1:] if label_[:1] == "S" else label_
    return f"Penutur {n}" if language == "ms" else f"Speaker {n}"


def as_text(
    paras: list[dict[str, Any]], speakers: dict[str, Any] | None = None, language: str = "en"
) -> str:
    """What the minutes writer reads: one paragraph per line with its [m:ss] and, when the
    voices were told apart, who is speaking."""
    lines = []
    for p in paras:
        who = f"{speaker_name(p['s'], speakers or {}, language)}: " if p.get("s") else ""
        lines.append(f"[{fmt_time(p['t'])}] {who}{p['text']}")
    return "\n".join(lines)


def split_text(text: str, limit: int) -> list[str]:
    """Cut on line ends into parts of at most `limit` characters (a longer line is cut)."""
    parts: list[str] = []
    cur: list[str] = []
    size = 0
    for line in text.splitlines():
        while len(line) > limit:
            if cur:
                parts.append("\n".join(cur))
                cur, size = [], 0
            parts.append(line[:limit])
            line = line[limit:]
        if size + len(line) + 1 > limit and cur:
            parts.append("\n".join(cur))
            cur, size = [], 0
        cur.append(line)
        size += len(line) + 1
    if cur:
        parts.append("\n".join(cur))
    return [p for p in parts if p.strip()]


def context_prompt(previous: str, words: int = 40, vocabulary: str = "") -> str:
    """Whisper's `prompt`: the setting, the office's own names (so "Klang Valley" is not heard
    as "Kelang Zeli"), and the last words heard, so names and the language mix carry over a
    chunk boundary. Whisper reads about 224 tokens of prompt; the vocabulary is kept short."""
    base = "A Malaysian workplace meeting in English and Bahasa Melayu."
    names = f" Names: {vocabulary}." if vocabulary else ""
    tail = " ".join(previous.split()[-words:])
    return f"{base}{names} {tail}".strip()
