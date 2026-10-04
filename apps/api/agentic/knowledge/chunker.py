"""Split a document's text into passages an agent can search, read and cite.

Input is the text documents/extract.py produced: `[page N]` markers for PDFs, `## Heading`
lines for Word headings and spreadsheet sheets, markdown pipe tables, plain paragraphs.

Passages are about 800 tokens (TARGET characters at ~4 characters a token): long enough to
hold a whole procedure step with its conditions, short enough that a few fit in a prompt.
A new heading starts a new passage (unless the passage so far is tiny); a passage that grows
too long is cut at a paragraph and the next one repeats its last sentences (OVERLAP) so a
rule split across the cut is still readable in either half. Tables are never cut mid-row;
a table too big for one passage is split by rows with its header repeated.
"""

import re
from dataclasses import dataclass

TARGET = 3200  # ~800 tokens
MAX = 3800  # ~950 tokens: a single block up to this stays whole
SMALL = 500  # a section shorter than this runs on into the next heading's passage
OVERLAP = 300

_PAGE = re.compile(r"^\[page (\d+)\]$")
_MD_HEAD = re.compile(r"^(#{1,6})\s+(.+?)\s*#*$")
# "3.2 Refunds", "4.1.2 Who approves", "Section 4 Returns", "BAB 2 Pemulangan"
_NUM_HEAD = re.compile(
    r"^(?:\d+\.\d+(?:\.\d+){0,3}\.?|(?:section|chapter|part|bab|bahagian|seksyen)\s+[\dIVXLC]+[.:]?)"
    r"\s+(\S.*)$",
    re.I,
)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_TABLE_RULE = re.compile(r"^\|(\s*:?-{2,}:?\s*\|)+$")


@dataclass
class Passage:
    heading: str
    page: int | None
    text: str


@dataclass
class _Block:
    kind: str  # heading | para | table
    text: str
    page: int | None
    heading: str  # the heading in force where the block sits


def _heading(line: str) -> str | None:
    m = _MD_HEAD.match(line)
    if m:
        return m.group(2).strip()[:300] or None
    if len(line) > 100 or line.endswith((".", ",", ";", ":")) or line.startswith("|"):
        return None
    m = _NUM_HEAD.match(line)
    if m and m.group(1)[0].isupper() and len(line.split()) <= 12:
        return line  # not "3.5 kg of flour": the title after the number is capitalised
    letters = [c for c in line if c.isalpha()]
    if len(letters) >= 4 and line == line.upper() and len(line.split()) <= 10:
        return line  # an ALL CAPS title line, common in PDFs
    return None


def _blocks(text: str) -> list[_Block]:
    out: list[_Block] = []
    page: int | None = None
    heading = ""
    para: list[str] = []
    table: list[str] = []

    def flush() -> None:
        if para:
            out.append(_Block("para", "\n".join(para), page, heading))
            para.clear()
        if table:
            out.append(_Block("table", "\n".join(table), page, heading))
            table.clear()

    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if m := _PAGE.match(line):
            flush()
            page = int(m.group(1))
            continue
        if not line:
            flush()
            continue
        if line.startswith("|"):
            if para:
                out.append(_Block("para", "\n".join(para), page, heading))
                para.clear()
            table.append(line)
            continue
        if table:
            out.append(_Block("table", "\n".join(table), page, heading))
            table.clear()
        h = _heading(line)
        if h is not None:
            flush()
            heading = h
            out.append(_Block("heading", h, page, h))
            continue
        para.append(line)
    flush()
    return out


def _wrap(text: str, limit: int) -> list[str]:
    """Hard-wrap one over-long line at word boundaries."""
    out = []
    while len(text) > limit:
        cut = text.rfind(" ", 0, limit)
        cut = cut if cut > limit // 2 else limit
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        out.append(text)
    return out


def _pack(units: list[str], limit: int, sep: str) -> list[str]:
    out: list[str] = []
    cur = ""
    for u in units:
        if cur and len(cur) + len(sep) + len(u) > limit:
            out.append(cur)
            cur = ""
        cur = f"{cur}{sep}{u}" if cur else u
    if cur:
        out.append(cur)
    return out


def _split_para(text: str) -> list[str]:
    units: list[str] = []
    for line in text.split("\n"):
        if len(line) <= TARGET:
            units.append(line)
            continue
        sentences: list[str] = []
        for sentence in _SENTENCE_END.split(line):
            sentences.extend(_wrap(sentence, TARGET) if len(sentence) > TARGET else [sentence])
        units.extend(_pack(sentences, TARGET, " "))
    return _pack(units, TARGET, "\n")


def _split_table(text: str) -> list[str]:
    rows = text.split("\n")
    head = rows[:2] if len(rows) > 1 and _TABLE_RULE.match(rows[1]) else rows[:1]
    body = rows[len(head) :]
    header = "\n".join(head)
    room = max(TARGET - len(header) - 1, 400)
    pieces = _pack([r[:room] for r in body], room, "\n")
    return [f"{header}\n{p}" for p in pieces] or [header]


def _tail(text: str) -> str:
    """The last sentences of a passage, repeated at the start of the next one."""
    if len(text) <= OVERLAP:
        return text
    window = text[-OVERLAP * 2 :]
    starts = [m.end() for m in _SENTENCE_END.finditer(window)]
    keep = [s for s in starts if len(window) - s <= OVERLAP]
    if keep:
        return window[keep[0] :].strip()
    cut = text.find(" ", len(text) - OVERLAP)
    return text[cut + 1 if cut > 0 else len(text) - OVERLAP :].strip()


def chunk_text(text: str) -> list[Passage]:
    """Passages of `text` in reading order, each with its heading and first page."""
    out: list[Passage] = []
    cur: list[str] = []
    size = 0
    head = ""
    page: int | None = None
    only_carry = False  # cur holds nothing but the previous passage's tail

    def flush(carry: bool) -> None:
        nonlocal cur, size, only_carry
        body = "\n\n".join(cur).strip()
        if body and not only_carry:
            out.append(Passage(head, page, body))
        tail = ""
        if carry and cur and not cur[-1].startswith(("|", "## ")):
            tail = _tail(cur[-1])
        cur = [tail] if tail else []
        size = len(tail)
        only_carry = bool(tail)

    for b in _blocks(text):
        if b.kind == "heading":
            if size >= SMALL and not only_carry:
                flush(carry=False)
            if only_carry:  # no overlap across a section boundary
                cur, size, only_carry = [], 0, False
            if not cur:
                head, page = b.text, b.page
                continue
            cur.append("## " + b.text)
            size += len(b.text) + 5
            continue
        if len(b.text) <= MAX:
            pieces = [b.text]
        else:
            pieces = _split_table(b.text) if b.kind == "table" else _split_para(b.text)
        for piece in pieces:
            # A tiny start (a short intro under its heading) stays with what follows.
            if size >= SMALL and not only_carry and size + len(piece) + 2 > TARGET:
                dangling = cur[-1].startswith("## ")
                if dangling:  # never end a passage on a heading that belongs to the next
                    size -= len(cur.pop()) + 3
                flush(carry=b.kind == "para" and not dangling)
                head, page = b.heading, b.page
            elif not cur:
                head = head or b.heading
                page = b.page if page is None else page
            elif only_carry:
                page = b.page
            cur.append(piece)
            size += len(piece) + 2
            only_carry = False
    flush(carry=False)
    return out
