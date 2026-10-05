"""Smaller tool results for the model, full results for people (P21, idea from
headroomlabs-ai/headroom's content-routed compressors).

Every model call resends the history, so a 300-row JSON answer or a long log read at step 3 is
paid for again at every later step. Big results are now routed by content to a deterministic
compressor (no model call, same input -> same output, so the prompt cache keeps hitting):

- JSON with an array of objects: a lossless CSV-like table when that saves 30% or more,
  otherwise about 15 rows: the first and last rows, EVERY row that looks like an error, numeric
  outliers (beyond 2 sigma), change points, and the rows that best match the job (BM25).
- Markdown tables (finance schedules): the same row choice.
- Logs: errors, warnings, failures and tracebacks with context; repeated lines become "(xN)";
  routine INFO/PASS/OK lines are dropped; the first and last lines stay.
- Search and grep lists: at most 30 matches and 5 per file or site.
- Browser pages: the newest page is always sent whole (the agent clicks by element number);
  an EARLIER page is sent without its element list (those numbers only work on the page that
  is open now) and with its page text shortened.
- Prose, code and documents (read_file) are never rewritten.

Storage design: agent_messages.content keeps the ORIGINAL result, so transcripts, the UI,
learning and expand_result all see everything. The text the model is sent is kept next to it
in meta["compressed"] (only when it differs), and context.render sends that. A result read while
the agent is debugging (the job mentions fix/debug/error, or run_python failed) also carries
meta["full_while_latest"]: the model sees it whole while it is the newest result and the
compressed text after that (the switch happens at the tail of the prompt, so the cached prefix
stays). Every compressed text ends with a marker naming expand_result(message_id=...), which
returns the original, sliced or filtered.
"""

import csv
import io
import json
import math
import re
import statistics
from collections import Counter
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

MIN_CHARS = 2_000  # results shorter than this are sent as they are
MIN_ARRAY_ITEMS = 5
MIN_ARRAY_CHARS = 800  # ~200 tokens
KEEP_ROWS = 15
HEAD_SHARE, TAIL_SHARE = 0.30, 0.15
MAX_ERROR_ROWS = 30
ROW_CHARS = 600  # one shown row never takes more than this
TABLE_SAVING = 0.30  # the lossless table must save at least this much
LOSSLESS_BUDGET = 6_000  # a lossless table longer than this still gets rows chosen
MIN_SAVING = 0.15  # a compression that saves less than this is not worth the marker
MAX_SENT = 12_000  # the most any one result sends to the model (it used to be MCP's hard cut)
CAP_HEAD, CAP_TAIL = 8_000, 3_000
SEARCH_MAX, SEARCH_PER_SOURCE = 30, 5
LOG_MIN_LINES = 15
UNIT_CHARS = 2_000  # expand_result splits lines longer than this

# Never rewritten: documents, skills, colleagues' answers (the work itself, already bounded per
# helper), and expand_result itself (it already returns a bounded slice of an original).
NEVER = frozenset(
    {
        "read_file",
        "use_skill",
        "expand_result",
        "split_work",
        "delegate",
        "consult",
        "ask_colleague",
    }
)
BROWSER = "browser_"
PAGE_TEXT_CHARS = 1_500  # an earlier page keeps this much of each fenced text block

_ERR = re.compile(
    r"error|fail|exception|denied|invalid|refused|forbidden|unauthori[sz]ed|traceback"
    r"|timed?[ _-]?out",
    re.I,
)
_STATUS_KEYS = frozenset({"status", "status_code", "statuscode", "code", "http_status", "http"})
_DEBUG = re.compile(
    r"\b(fix|fixing|debug|debugging|error|errors|bug|bugs|traceback|exception|failing|broken"
    r"|crash|crashes|stack ?trace)\b",
    re.I,
)
_PY_FAILED = re.compile(r"Traceback \(most recent call last\)|Exit code: -?[1-9]")
_WORD = re.compile(r"[a-z0-9][a-z0-9_]*")
_STOP = frozenset(
    "the a an and or of to in on for with by at from is are was were be been this that these "
    "those it its as into all any each find get show list give me my our your we you please "
    "can could would should will task do does did not no yes if then than so up out about "
    "what which who when where how why there here have has had just also more most some "
    "only over under per via use using call".split()
)


@dataclass(frozen=True)
class Compressed:
    text: str
    kind: str  # compact | table | json | rows | log | search | cap
    before: int
    after: int


# ---------------------------------------------------------------- shared helpers


def terms(text: str) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if len(w) > 1 and w not in _STOP]


def bm25(docs: list[list[str]], query: list[str], k1: float = 1.2, b: float = 0.75) -> list[float]:
    """Okapi BM25 of each document against the query terms. Terms found in more than half the
    documents say nothing about which ones matter, so they are ignored."""
    n = len(docs)
    if not n or not query:
        return [0.0] * n
    avg = (sum(len(d) for d in docs) / n) or 1.0
    df = Counter(t for d in docs for t in set(d))
    q = [t for t in dict.fromkeys(query) if 0 < df[t] <= max(1, n // 2)]
    out = []
    for d in docs:
        tf = Counter(d)
        s = 0.0
        for t in q:
            f = tf.get(t, 0)
            if f:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len(d) / avg))
        out.append(s)
    return out


def _clip(text: str, n: int = ROW_CHARS) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v) if math.isfinite(v) else None
    if isinstance(v, str):
        s = re.sub(r"^(?:RM|USD|SGD|MYR|\$)\s*|[,%\s]", "", v.strip())
        if re.fullmatch(r"-?\d+(?:\.\d+)?", s):
            return float(s)
    return None


def marker(message_id: int | None, what: str) -> str:
    where = (
        f"expand_result(message_id={message_id}, query=…)"
        if message_id is not None
        else "ask again with a narrower request"
    )
    return f"[{what}. Full result: {where}]"


def debugging(query: str, tool: str, text: str) -> bool:
    """The agent is fixing something: keep the newest result whole."""
    return bool(_DEBUG.search(query or "")) or (
        tool == "run_python" and bool(_PY_FAILED.search(text or ""))
    )


# ---------------------------------------------------------------- choosing rows


def _row_error(item: Any) -> bool:
    if isinstance(item, dict):
        for k, v in item.items():
            if v in (None, "", False, 0, [], {}):
                continue
            key = str(k).lower()
            if key in _STATUS_KEYS:
                n = _num(v)
                if n is not None and 400 <= n < 600:
                    return True
            if _ERR.search(key) or (isinstance(v, str) and _ERR.search(v)):
                return True
            if isinstance(v, dict | list) and _row_error(v):
                return True
        return False
    if isinstance(item, list):
        return any(_row_error(x) for x in item)
    return isinstance(item, str) and bool(_ERR.search(item))


def _columns(rows: list[dict[str, Any]]) -> dict[str, list[Any]]:
    cols: dict[str, list[Any]] = {}
    for r in rows:
        for k in r:
            cols.setdefault(str(k), [])
    for k in cols:
        cols[k] = [r.get(k) for r in rows]
    return cols


def _outliers(cols: dict[str, list[Any]]) -> list[int]:
    """Rows with a value beyond 2 sigma in a mostly-numeric column, most extreme first."""
    found: dict[int, float] = {}
    for values in cols.values():
        nums = [_num(v) for v in values]
        known = [x for x in nums if x is not None]
        if len(known) < MIN_ARRAY_ITEMS or len(known) < 0.8 * len(values):
            continue
        mean, sd = statistics.fmean(known), statistics.pstdev(known)
        if sd <= 0:
            continue
        for i, x in enumerate(nums):
            if x is not None and abs(x - mean) > 2 * sd:
                found[i] = max(found.get(i, 0.0), abs(x - mean) / sd)
    return sorted(found, key=lambda i: -found[i])


def _changes(cols: dict[str, list[Any]]) -> list[int]:
    """Rows where a low-cardinality column (a status, a phase) switches to a new value."""
    out: list[int] = []
    for values in cols.values():
        if any(_num(v) is not None for v in values if v is not None):
            continue
        keys = [json.dumps(v, sort_keys=True, default=str) for v in values]
        distinct = len(set(keys))
        if not 2 <= distinct <= max(3, len(keys) // 10):
            continue
        flips = [i for i in range(1, len(keys)) if keys[i] != keys[i - 1]]
        if len(flips) <= max(3, len(keys) // 4):
            out += [i for i in flips if i not in out]
    return out


def choose_rows(
    n: int,
    *,
    errors: list[int],
    scores: list[float],
    outliers: list[int],
    changes: list[int],
    keep: int = KEEP_ROWS,
) -> list[int]:
    """The rows to show: first 30% and last 15% of the budget, every error, then the best
    query matches, outliers and change points in turn until the budget is used."""
    if n <= keep:
        return list(range(n))
    head = math.ceil(keep * HEAD_SHARE)
    tail = math.ceil(keep * TAIL_SHARE)
    chosen = set(range(head)) | set(range(n - tail, n)) | set(errors[:MAX_ERROR_ROWS])
    matches = [i for i in sorted(range(n), key=lambda i: -scores[i]) if scores[i] > 0]
    pools = [matches, outliers, changes]
    room = keep - head - tail
    while room > 0 and any(pools):
        for pool in pools:
            while pool and pool[0] in chosen:
                pool.pop(0)
            if pool and room > 0:
                chosen.add(pool.pop(0))
                room -= 1
    if room > 0:  # nothing else stands out: an even sample of the middle shows its shape
        rest = [i for i in range(n) if i not in chosen]
        step = len(rest) / (room + 1)
        chosen.update(rest[int(step * (k + 1))] for k in range(min(room, len(rest))))
    return sorted(chosen)


def _gaps(kept: list[int], render: Any, total: int) -> list[str]:
    lines, prev = [], -1
    for i in kept:
        if i > prev + 1:
            lines.append(f"… {i - prev - 1} rows not shown …")
        lines.append(render(i))
        prev = i
    if prev < total - 1:
        lines.append(f"… {total - prev - 1} rows not shown …")
    return lines


# ---------------------------------------------------------------- JSON


def _find_json(text: str) -> tuple[str, Any, str] | None:
    """(text before, the JSON value, text after) for a result that is or contains JSON."""
    s = text.strip()
    if s[:1] in "[{":
        try:
            return "", json.loads(s), ""
        except ValueError:
            pass
    dec = json.JSONDecoder()
    for m in re.finditer(r"(?m)^[ \t]*[\[{]", text):
        start = m.end() - 1
        try:
            value, end = dec.raw_decode(text, start)
        except ValueError:
            continue
        if end - start >= MIN_ARRAY_CHARS and isinstance(value, list | dict):
            return text[:start], value, text[end:]
    return None


def _main_array(value: Any, depth: int = 0) -> tuple[list[str], list[Any]] | None:
    """The biggest list of objects in the value (top level, or under a key up to 2 deep)."""
    if isinstance(value, list):
        dicts = sum(isinstance(x, dict) for x in value)
        if value and dicts >= 0.6 * len(value):
            return [], value
        return None
    if isinstance(value, dict) and depth < 2:
        best: tuple[list[str], list[Any]] | None = None
        for k, v in value.items():
            found = _main_array(v, depth + 1)
            if found and (best is None or len(found[1]) > len(best[1])):
                best = ([str(k), *found[0]], found[1])
        return best
    return None


def _compact(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str)


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return _compact(v)


def _table(items: list[Any], idx: list[int] | None = None) -> str | None:
    """A CSV table of flat-ish objects (empty cell = missing/null). With idx, only those rows,
    each led by its row number."""
    if not all(isinstance(x, dict) for x in items):
        return None
    cols = list(dict.fromkeys(str(k) for x in items for k in x))
    if not cols or len(cols) > 30:
        return None
    nested = sum(isinstance(v, dict | list) for x in items for v in x.values())
    if nested > len(items):  # mostly nested data reads better as JSON
        return None
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if idx is None:  # lossless: every row, every cell in full
        w.writerow(cols)
        for x in items:
            w.writerow([_cell(x.get(c)) for c in cols])
    else:
        w.writerow(["#", *cols])
        for i in idx:
            w.writerow([str(i), *(_clip(_cell(items[i].get(c)), 300) for c in cols)])
    return buf.getvalue().rstrip("\n")


def _with_path(value: Any, path: list[str], note: str) -> Any:
    if not path:
        return note
    if isinstance(value, dict):
        return {k: (_with_path(v, path[1:], note) if k == path[0] else v) for k, v in value.items()}
    return value


def _source(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    for k in ("file", "path", "filename", "source", "url", "link", "href", "domain"):
        v = item.get(k)
        if isinstance(v, str) and v:
            return (urlparse(v).hostname or v) if k in ("url", "link", "href") else v
    return None


def crush_json(text: str, *, query: str = "", message_id: int | None = None) -> Compressed | None:
    found = _find_json(text)
    if found is None:
        return None
    before, value, after = found
    arr = _main_array(value)
    whole = _compact(value)
    if arr is None or len(arr[1]) < MIN_ARRAY_ITEMS or len(_compact(arr[1])) < MIN_ARRAY_CHARS:
        # Not an array worth choosing rows from: minified JSON is still lossless.
        if len(whole) <= len(text) * (1 - TABLE_SAVING):
            out = f"{before}{whole}{after}".strip()
            return Compressed(out, "compact", len(text), len(out))
        return None
    path, items = arr
    n = len(items)
    rows_json = [_compact(x) for x in items]
    table = _table(items)
    as_table = table is not None and len(table) <= (1 - TABLE_SAVING) * sum(map(len, rows_json))
    where = f" under {'.'.join(path)}" if path else ""
    head_text = before.strip()
    outer = _compact(_with_path(value, path, f"<{n} rows below>")) if path else ""
    if as_table and table is not None and len(table) <= LOSSLESS_BUDGET:
        body = table
        what = f"{n} rows{where} shown as a table, nothing left out (empty cell = null)"
        kind = "table"
    else:
        sources = [_source(x) for x in items]
        if sum(s is not None for s in sources) >= 0.8 * n:
            res = _search_pick(sources, n)
            if res is not None:
                kept, label = res
                body = "\n".join(_gaps(kept, lambda i: f"[{i}] {_clip(rows_json[i])}", n))
                what = f"{n} results{where} shown as {len(kept)} ({label})"
                out = _join(head_text, outer, body, after, marker(message_id, what))
                return _worth(text, out, "search")
        docs = [terms(r) for r in rows_json]
        kept = choose_rows(
            n,
            errors=[i for i, x in enumerate(items) if _row_error(x)],
            scores=bm25(docs, terms(query)),
            outliers=_outliers(_columns([x for x in items if isinstance(x, dict)]))
            if all(isinstance(x, dict) for x in items)
            else [],
            changes=_changes(_columns(items)) if all(isinstance(x, dict) for x in items) else [],
        )
        sub = _table(items, kept) if as_table else None
        if sub is not None:
            body = sub
        else:
            body = "\n".join(_gaps(kept, lambda i: f"[{i}] {_clip(rows_json[i])}", n))
        what = (
            f"{n} rows{where} shown as {len(kept)} (first, last, errors, outliers and the rows "
            "that match the job)"
        )
        kind = "rows"
    out = _join(head_text, outer, body, after, marker(message_id, what))
    return _worth(text, out, kind)


def _join(*parts: str) -> str:
    return "\n".join(p.strip() for p in parts if p and p.strip())


def _worth(text: str, out: str, kind: str) -> Compressed | None:
    if len(out) > len(text) * (1 - MIN_SAVING):
        return None
    return Compressed(out, kind, len(text), len(out))


# ---------------------------------------------------------------- markdown tables


_MD_ROW = re.compile(r"^\s*\|.*\|\s*$")
_MD_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")


def crush_table(text: str, *, query: str = "", message_id: int | None = None) -> Compressed | None:
    """A long markdown table (an amortisation schedule, a ledger): the same row choice."""
    lines = text.split("\n")
    start = next(
        (
            i
            for i in range(len(lines) - 1)
            if _MD_ROW.match(lines[i]) and _MD_SEP.match(lines[i + 1])
        ),
        None,
    )
    if start is None:
        return None
    end = start + 2
    while end < len(lines) and _MD_ROW.match(lines[end]):
        end += 1
    rows = lines[start + 2 : end]
    n = len(rows)
    if n <= KEEP_ROWS or sum(map(len, rows)) < MIN_ARRAY_CHARS:
        return None
    header = [c.strip() for c in lines[start].strip().strip("|").split("|")]
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    dicts = [dict(zip(header, c, strict=False)) for c in cells]
    cols = _columns(dicts)
    kept = choose_rows(
        n,
        errors=[i for i, r in enumerate(rows) if _ERR.search(r)],
        scores=bm25([terms(r) for r in rows], terms(query)),
        outliers=_outliers(cols),
        changes=_changes(cols),
    )
    body = _gaps(kept, lambda i: rows[i], n)
    shown = [*lines[:start], lines[start], lines[start + 1], *body, *lines[end:]]
    what = f"{n} table rows shown as {len(kept)} (first, last, outliers and matches)"
    out = "\n".join(shown).strip() + "\n" + marker(message_id, what)
    return _worth(text, out, "rows")


# ---------------------------------------------------------------- logs

_LEVEL = re.compile(
    r"\b(INFO|DEBUG|TRACE|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL|PASS|PASSED|FAIL|FAILED|OK)\b"
)
_STAMP = re.compile(r"^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|^\s*\[?\d{2}:\d{2}:\d{2}")
_BAD = re.compile(
    r"\b(ERROR|ERR|FATAL|CRITICAL|PANIC|FAIL|FAILED|FAILURE|WARN|WARNING|SEVERE)\b"
    r"|Traceback \(most recent call last\)|\w+(?:Error|Exception)\b|exit code:? -?[1-9]",
    re.I,
)
_NOISE = re.compile(r"\b(INFO|DEBUG|TRACE|NOTICE|PASS|PASSED|OK|SUCCESS)\b")


def _looks_like_log(lines: list[str]) -> bool:
    if len(lines) < LOG_MIN_LINES:
        return False
    if any(line.startswith("Traceback (most recent call last)") for line in lines):
        return True
    tagged = sum(1 for ln in lines if _LEVEL.search(ln) or _STAMP.match(ln))
    return tagged >= 0.3 * len(lines)


def _norm(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip())


def crush_log(text: str, *, message_id: int | None = None) -> Compressed | None:
    lines = text.split("\n")
    if not _looks_like_log(lines):
        return None
    n = len(lines)
    keep: set[int] = set(range(min(3, n))) | set(range(max(0, n - 5), n))
    bad = [i for i, ln in enumerate(lines) if _BAD.search(ln)]
    for i in bad:
        keep.update(range(max(0, i - 2), min(n, i + 3)))
        if lines[i].startswith("Traceback"):
            j = i + 1
            while j < n and j < i + 60 and (lines[j][:1] in (" ", "\t") or not lines[j].strip()):
                keep.add(j)
                j += 1
            if j < n:
                keep.add(j)  # the exception line itself
    errors = sum(1 for i in bad if not re.search(r"\bWARN", lines[i], re.I))
    warns = len(bad) - errors
    bad_set = set(bad)
    counts = Counter(_norm(ln) for ln in lines)
    out: list[str] = []
    seen: set[str] = set()
    prev = -1
    for i in sorted(keep):
        ln = lines[i]
        key = _norm(ln)
        if i not in bad_set and 3 <= i < n - 5 and _NOISE.search(ln):
            continue
        repeat = bool(key) and key in seen
        if repeat and i < n - 5:  # the last lines always show: that is where a run ends
            continue
        seen.add(key)
        if i > prev + 1:
            out.append(f"… {i - prev - 1} lines …")
        many = counts[key] > 1 and key and not repeat
        out.append(ln + (f"  (×{counts[key]})" if many else ""))
        prev = i
    dropped_noise = sum(
        1
        for i, ln in enumerate(lines)
        if i not in keep and _NOISE.search(ln) and not _BAD.search(ln)
    )
    head = (
        f"Log of {n:,} lines: {errors} error/failure lines, {warns} warnings"
        + (f", {dropped_noise:,} routine INFO/PASS/OK lines left out" if dropped_noise else "")
        + "."
    )
    what = f"{n:,} log lines shown as {len(out)}"
    result = head + "\n" + "\n".join(out) + "\n" + marker(message_id, what)
    return _worth(text, result, "log")


# ---------------------------------------------------------------- search / grep lists

# path:line: or path:line- (a path with a letter in it, so a "10:04:10" timestamp never matches)
_GREP = re.compile(r"^(?P<src>[^\s:]{0,200}[A-Za-z][^\s:]{0,200}):\d+[:-]")
_NUMBERED = re.compile(r"^\s*\d+[.)]\s")
_URL = re.compile(r"https?://[^\s)>\]]+")


def _search_pick(sources: list[str | None], n: int) -> tuple[list[int], str] | None:
    per = Counter(s for s in sources if s)
    if n <= SEARCH_MAX and all(c <= SEARCH_PER_SOURCE for c in per.values()):
        return None
    used: Counter[str] = Counter()
    kept: list[int] = []
    for i, s in enumerate(sources):
        key = s or f"#{i}"
        if used[key] < SEARCH_PER_SOURCE and len(kept) < SEARCH_MAX:
            used[key] += 1
            kept.append(i)
    label = f"max {SEARCH_PER_SOURCE} per source, {len(per)} sources"
    return kept, label


def crush_search(text: str, *, message_id: int | None = None) -> Compressed | None:
    lines = text.split("\n")
    body = [ln for ln in lines if ln.strip()]
    grep = [i for i, ln in enumerate(lines) if _GREP.match(ln)]
    if len(body) >= 10 and len(grep) >= 0.6 * len(body):
        sources: list[str | None] = []
        for i in grep:
            m = _GREP.match(lines[i])
            sources.append(m.group("src") if m else None)
        picked = _search_pick(sources, len(grep))
        if picked is None:
            return None
        kept, label = picked
        keep_lines = {grep[k] for k in kept} | {i for i in range(len(lines)) if i not in grep}
        out = [lines[i] for i in sorted(keep_lines)]
        what = f"{len(grep)} matches shown as {len(kept)} ({label})"
        return _worth(text, "\n".join(out) + "\n" + marker(message_id, what), "search")
    # Numbered results, each with a link (web_search style).
    starts = [i for i, ln in enumerate(lines) if _NUMBERED.match(ln)]
    if len(starts) <= SEARCH_MAX:
        return None
    blocks = [
        (s, starts[k + 1] if k + 1 < len(starts) else len(lines)) for k, s in enumerate(starts)
    ]
    srcs: list[str | None] = []
    for s, e in blocks:
        url = _URL.search("\n".join(lines[s:e]))
        srcs.append(urlparse(url.group(0)).hostname if url else None)
    if sum(x is not None for x in srcs) < 0.6 * len(blocks):
        return None
    picked = _search_pick(srcs, len(blocks))
    if picked is None:
        return None
    kept, label = picked
    out = lines[: starts[0]]
    for k in kept:
        s, e = blocks[k]
        out += lines[s:e]
    what = f"{len(blocks)} results shown as {len(kept)} ({label})"
    return _worth(text, "\n".join(out).rstrip() + "\n" + marker(message_id, what), "search")


# ---------------------------------------------------------------- code / prose / cap

_CODE_LINE = re.compile(
    r"^\s*(def |class |import |from \S+ import |function |const |let |var |public |private "
    r"|protected |return\b|if \(|for \(|while \(|#include|package |func |fn |SELECT |@\w+)"
    r"|[{};]\s*$"
)


def looks_like_code(text: str) -> bool:
    if "```" in text:
        return True
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if len(lines) < 5:
        return False
    return sum(1 for ln in lines if _CODE_LINE.search(ln)) >= 0.3 * len(lines)


def units(text: str) -> list[str]:
    """The pieces expand_result pages through: the rows of the main JSON array (with any text
    around it), otherwise lines (very long lines split)."""
    found = _find_json(text)
    if found is not None:
        before, value, after = found
        arr = _main_array(value)
        if arr is not None and not arr[0] and len(arr[1]) >= 2:
            return (
                [ln for ln in before.strip().split("\n") if ln.strip()]
                + [_compact(x) for x in arr[1]]
                + [ln for ln in after.strip().split("\n") if ln.strip()]
            )
    out: list[str] = []
    for ln in text.split("\n"):
        while len(ln) > UNIT_CHARS:
            out.append(ln[:UNIT_CHARS])
            ln = ln[UNIT_CHARS:]
        out.append(ln)
    return out


def cap(text: str, message_id: int | None, *, original: bool) -> str:
    """At most MAX_SENT characters: the head, error lines from the middle, and the tail (an
    error at the end of a long answer is never lost). `original` = the text is the stored
    result itself, so line numbers can be given for paging."""
    if len(text) <= MAX_SENT:
        return text
    head_end = text.rfind("\n", 0, CAP_HEAD)
    head_end = head_end if head_end > CAP_HEAD // 2 else CAP_HEAD
    tail_start = text.find("\n", len(text) - CAP_TAIL)
    tail_start = (
        tail_start + 1 if 0 <= tail_start < len(text) - CAP_TAIL // 2 else len(text) - CAP_TAIL
    )
    middle = text[head_end:tail_start]
    flagged = [ln.strip() for ln in middle.split("\n") if _BAD.search(ln) or _ERR.search(ln)]
    picked: list[str] = []
    room = 1_000
    for ln in dict.fromkeys(flagged):
        if room <= 0 or len(picked) >= 10:
            break
        picked.append(_clip(ln, 200))
        room -= len(picked[-1])
    if original and message_id is not None:
        first = text[:head_end].count("\n") + 1
        last = text[:tail_start].count("\n")
        lines_note = (
            f"lines {first}-{last} ({len(middle):,} characters) are not shown here; read them "
            f"with expand_result(message_id={message_id}, offset={first}, limit=100) or "
            "expand_result(message_id=…, query='words')"
        )
    else:
        lines_note = f"{len(middle):,} characters are not shown here"
    note = f"\n[… {lines_note}"
    if picked:
        note += "; error lines among them:\n" + "\n".join(picked)
    note += " …]\n"
    return text[:head_end] + note + text[tail_start:]


_ELEMENT = re.compile(r"^\[\d+\] ")
_FENCE_OPEN = re.compile(r"^<<<([0-9a-f]{6,16})$")


def crush_browser(text: str, *, message_id: int | None = None) -> Compressed | None:
    """An earlier browser page: no element list, page text shortened, fences kept intact (so
    untrusted page text stays marked as data)."""
    out: list[str] = []
    elements = 0
    fence: str | None = None
    block: list[str] = []
    for line in text.split("\n"):
        if fence is not None:
            if line.strip() == f"{fence}>>>":
                body = "\n".join(block)
                if len(body) > PAGE_TEXT_CHARS:
                    more = len(body) - PAGE_TEXT_CHARS
                    body = body[:PAGE_TEXT_CHARS].rstrip() + f" … [{more:,} more characters]"
                out += [body, line] if body else [line]
                fence, block = None, []
            else:
                block.append(line)
            continue
        m = _FENCE_OPEN.match(line.strip())
        if m:
            fence = m.group(1)
            out.append(line)
            continue
        if _ELEMENT.match(line):
            elements += 1
            continue
        if line.startswith("Elements (use the number)"):
            continue
        out.append(line)
    if fence is not None:  # an unclosed fence: keep what is left as it was
        out += block
    if not elements:
        return None
    what = (
        f"Earlier page: its {elements} clickable elements are left out (their numbers only work "
        "on the page that is open now) and long page text is shortened"
    )
    return _worth(text, "\n".join(out).rstrip() + "\n" + marker(message_id, what), "browser")


def compress(
    text: str, *, tool: str = "", query: str = "", message_id: int | None = None
) -> Compressed | None:
    """The model's version of one tool result, or None when the model should see it as is."""
    if not text or len(text) < MIN_CHARS or tool in NEVER:
        return None
    if tool.startswith(BROWSER):
        return crush_browser(text, message_id=message_id)
    r = crush_json(text, query=query, message_id=message_id)
    if r is not None:
        return r
    if looks_like_code(text):
        return None
    for fn in (crush_search, crush_log):
        r = fn(text, message_id=message_id)
        if r is not None:
            return r
    return crush_table(text, query=query, message_id=message_id)


def prepare(
    text: str, *, tool: str, query: str, message_id: int, extra: str = ""
) -> dict[str, Any]:
    """The meta fields to store with a tool result: {} when the model sees the original.
    {"compressed": what the model sees, "compressor": kind, "full_while_latest": bool,
    "capped": the original cut to MAX_SENT, for the newest-result-while-debugging case}.
    `query` is the job (task brief or chat question); `extra` (the tool's arguments) only
    helps rank rows, it never switches on the debugging rule."""
    if not text or tool in NEVER:
        return {}
    # The newest browser page is always sent whole: the agent acts on its element numbers.
    debug = debugging(query, tool, text) or tool.startswith(BROWSER)
    r = compress(text, tool=tool, query=f"{query}\n{extra}".strip(), message_id=message_id)
    if r is None:
        if len(text) <= MAX_SENT:
            return {}
        return {"compressed": cap(text, message_id, original=True), "compressor": "cap"}
    meta: dict[str, Any] = {
        "compressed": cap(r.text, message_id, original=False),
        "compressor": r.kind,
    }
    if debug:
        meta["full_while_latest"] = True
        if len(text) > MAX_SENT:
            meta["capped"] = cap(text, message_id, original=True)
    return meta


def model_text(m: Any, *, latest: bool = False) -> str:
    """What the model is sent for a stored message (the original unless compressed)."""
    meta = getattr(m, "meta", None) or {}
    comp = meta.get("compressed")
    if not isinstance(comp, str):
        return m.content or ""
    if latest and meta.get("full_while_latest"):
        return str(meta.get("capped") or m.content or "")
    return comp
