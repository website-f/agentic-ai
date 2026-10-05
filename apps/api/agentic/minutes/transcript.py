"""Stitch the chunks' transcripts into one timestamped transcript.

Each chunk comes back with segments timed from the chunk's own start (Whisper's
verbose_json) or, from models that give no segments, one block of text. Times are moved onto
the recording's clock, the overlap between chunks is kept once (by the segment's middle), and
Whisper's habit of repeating a line over silence ("Terima kasih.", "Thank you.") is dropped.
Segments are then joined into paragraphs of about half a minute: readable, and each one a
click target that plays that moment.
"""

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
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for s in segs:
        if cur is None:
            cur = dict(s)
            continue
        span = cur["e"] - cur["t"]
        if span >= PARAGRAPH_MAX_SECONDS or (
            span >= PARAGRAPH_SECONDS and _END.search(cur["text"])
        ):
            out.append(cur)
            cur = dict(s)
            continue
        cur["text"] = f"{cur['text']} {s['text']}"
        cur["e"] = s["e"]
    if cur is not None:
        out.append(cur)
    return out


def stitch(chunks: list[Chunk], results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return paragraphs(segments(chunks, results))


def as_text(paras: list[dict[str, Any]]) -> str:
    """What the minutes writer reads: one paragraph per line with its [m:ss]."""
    return "\n".join(f"[{fmt_time(p['t'])}] {p['text']}" for p in paras)


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
