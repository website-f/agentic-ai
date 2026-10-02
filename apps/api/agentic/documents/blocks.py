"""A small markdown subset for business documents, parsed once and rendered to PDF and Word.

Supported: # / ## / ### headings, paragraphs (every line break is kept: addresses and
signature blocks need them), - and 1. lists, pipe tables, > notes, --- rules, and a page
break line (\\pagebreak). Inline: **bold** and *italic* / _italic_.
"""

import re
from dataclasses import dataclass, field

PAGEBREAK = ("\\pagebreak", "<!-- pagebreak -->")

_TABLE_SEP = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_NUMBERED = re.compile(r"^\d{1,3}[.)]\s+")
_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w]))")


@dataclass
class Run:
    text: str
    bold: bool = False
    italic: bool = False


@dataclass
class Block:
    kind: str  # heading | para | bullets | numbers | table | note | rule | pagebreak
    level: int = 0
    lines: list[str] = field(default_factory=list)  # para / note lines, list items
    header: list[str] = field(default_factory=list)  # table
    rows: list[list[str]] = field(default_factory=list)


def runs(text: str) -> list[Run]:
    """Split a line into bold / italic runs."""
    out: list[Run] = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            out.append(Run(part[2:-2], bold=True))
        elif (part[0] == part[-1] == "*" or part[0] == part[-1] == "_") and len(part) > 2:
            out.append(Run(part[1:-1], italic=True))
        else:
            out.append(Run(part))
    return out


def plain(text: str) -> str:
    return "".join(r.text for r in runs(text))


def _cells(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def parse(md: str) -> list[Block]:
    blocks: list[Block] = []
    lines = md.replace("\r\n", "\n").split("\n")
    i = 0
    para: list[str] = []

    def flush() -> None:
        if para:
            blocks.append(Block("para", lines=list(para)))
            para.clear()

    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        if not line:
            flush()
            i += 1
            continue
        if line in PAGEBREAK:
            flush()
            blocks.append(Block("pagebreak"))
            i += 1
            continue
        if re.fullmatch(r"-{3,}|\*{3,}", line):
            flush()
            blocks.append(Block("rule"))
            i += 1
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush()
            blocks.append(Block("heading", level=min(3, len(m.group(1))), lines=[m.group(2)]))
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1].strip()):
            flush()
            header = _cells(line)
            rows: list[list[str]] = []
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = _cells(lines[i])
                rows.append((cells + [""] * len(header))[: len(header)])
                i += 1
            blocks.append(Block("table", header=header, rows=rows))
            continue
        if re.match(r"^[-*•]\s+", line) or _NUMBERED.match(line):
            flush()
            kind = "numbers" if _NUMBERED.match(line) else "bullets"
            items: list[str] = []
            while i < len(lines):
                s = lines[i].strip()
                if kind == "bullets" and re.match(r"^[-*•]\s+", s):
                    items.append(re.sub(r"^[-*•]\s+", "", s))
                elif kind == "numbers" and _NUMBERED.match(s):
                    items.append(_NUMBERED.sub("", s))
                elif s and items and lines[i].startswith(("  ", "\t")):
                    items[-1] += " " + s  # a wrapped continuation line
                else:
                    break
                i += 1
            blocks.append(Block(kind, lines=items))
            continue
        if line.startswith(">"):
            flush()
            note: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                note.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(Block("note", lines=note))
            continue
        para.append(line)
        i += 1
    flush()
    return blocks


def to_preview_markdown(md: str) -> str:
    """The same text as GFM, with paragraph line breaks made hard (two trailing spaces) so a
    browser preview matches the PDF and Word layout."""
    out: list[str] = []
    for b in parse(md):
        if b.kind == "heading":
            out.append("#" * b.level + " " + b.lines[0])
        elif b.kind == "para":
            # A sign line is text, not a divider (GFM would turn ____ into a rule).
            lines = ["\\_" * len(x) if SIGN_LINE.match(x) else x for x in b.lines]
            out.append("  \n".join(lines))
        elif b.kind == "note":
            out.append("> " + "  \n> ".join(b.lines))
        elif b.kind == "bullets":
            out.append("\n".join(f"- {x}" for x in b.lines))
        elif b.kind == "numbers":
            out.append("\n".join(f"{n}. {x}" for n, x in enumerate(b.lines, 1)))
        elif b.kind == "table":
            out.append(
                "\n".join(
                    ["| " + " | ".join(b.header) + " |", "|" + "---|" * len(b.header)]
                    + ["| " + " | ".join(r) + " |" for r in b.rows]
                )
            )
        elif b.kind == "rule":
            out.append("---")
        elif b.kind == "pagebreak":
            out.append("---")
    return "\n\n".join(out)


_NUM_CELL = re.compile(r"^-?(RM|USD|SGD|\$)?\s?-?[\d,]+(\.\d+)?%?(\s+[A-Za-z]{1,10})?$")
SIGN_LINE = re.compile(r"^_{5,}$")


def is_numeric(cell: str) -> bool:
    return bool(_NUM_CELL.match(plain(cell).strip())) if cell.strip() else False
