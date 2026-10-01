"""Pure markdown helpers: path rules, frontmatter, [[wikilinks]], chunking. No I/O."""

import hashlib
import re
from typing import Any

MAX_PAGE_CHARS = 200_000
CHUNK_CHARS = 900

_FRONT = re.compile(r"\A---\n(.*?)\n---\n?", re.S)
# [[target]], [[target|alias]], [[target#heading]], [[folder/target]]
_LINK = re.compile(r"\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]")
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$", re.M)
_SEGMENT = re.compile(r"^[\w][\w .,()&'+-]{0,119}$", re.UNICODE)

# Ranking boost per kind of page (decisions are the most trusted source).
TIER = {"decision": 1.3, "wiki": 1.15, "skill": 1.0, "root": 1.0, "raw": 0.9, "log": 0.7}
# Never searched: agent core memory is already in the prompt, dream diaries are meta.
UNSEARCHED = ("agent", "dream")
# People can edit anything; agents only write knowledge pages.
AGENT_WRITABLE = ("wiki/", "raw/")
GENERATED = ("index.md",)


class PathError(ValueError):
    pass


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def normalize_path(raw: str) -> str:
    p = raw.strip().replace("\\", "/").strip("/")
    p = re.sub(r"/+", "/", p)
    if not p:
        raise PathError("Give the page a path, like wiki/topics/payroll.md.")
    if not p.lower().endswith(".md"):
        p += ".md"
    parts = p.split("/")
    for seg in parts:
        if seg in (".", "..") or seg.startswith(".") or not _SEGMENT.match(seg):
            raise PathError(
                f"'{seg}' is not allowed in a page path. Use letters, numbers, spaces and - _ ."
            )
    if len(p) > 400:
        raise PathError("That path is too long.")
    return p


def split_branch(path: str) -> tuple[str | None, str]:
    """branches/<slug>/wiki/x.md -> ("<slug>", "wiki/x.md")."""
    parts = path.split("/")
    if len(parts) >= 3 and parts[0] == "branches":
        return parts[1], "/".join(parts[2:])
    return None, path


def kind_of(path: str) -> str:
    _, rel = split_branch(path)
    if rel.startswith("wiki/decisions/"):
        return "decision"
    for prefix, kind in (
        ("wiki/", "wiki"),
        ("raw/", "raw"),
        ("agents/", "agent"),
        ("DREAMS/", "dream"),
        ("skills/", "skill"),
    ):
        if rel.startswith(prefix):
            return kind
    return "log" if rel == "log.md" else "root"


def name_of(path: str) -> str:
    """What a [[wikilink]] uses to find the page: the file name, lower case, no .md."""
    return path.rsplit("/", 1)[-1][:-3].strip().lower()


def parse_frontmatter(body: str) -> tuple[dict[str, Any], str]:
    m = _FRONT.match(body)
    if not m:
        return {}, body
    meta: dict[str, Any] = {}
    for line in m.group(1).splitlines():
        if ":" not in line or line.startswith((" ", "\t", "#")):
            continue
        key, _, val = line.partition(":")
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            meta[key.strip()] = [v.strip().strip("'\"") for v in val[1:-1].split(",") if v.strip()]
        else:
            meta[key.strip()] = val.strip("'\"")
    return meta, body[m.end() :]


def title_of(path: str, meta: dict[str, Any], content: str) -> str:
    if isinstance(meta.get("title"), str) and meta["title"].strip():
        return meta["title"].strip()[:300]
    h = re.search(r"^#\s+(.+)$", content, re.M)
    if h:
        return h.group(1).strip()[:300]
    return path.rsplit("/", 1)[-1][:-3][:300]


def links_of(content: str) -> set[str]:
    return {
        m.group(1).strip().rsplit("/", 1)[-1].removesuffix(".md").lower()
        for m in _LINK.finditer(content)
    }


def _split_long(text: str) -> list[str]:
    if len(text) <= CHUNK_CHARS:
        return [text]
    out, cur = [], ""
    for para in re.split(r"\n\s*\n", text):
        if cur and len(cur) + len(para) + 2 > CHUNK_CHARS:
            out.append(cur)
            cur = ""
        while len(para) > CHUNK_CHARS:  # one huge paragraph: hard wrap on a space
            cut = para.rfind(" ", 0, CHUNK_CHARS)
            cut = cut if cut > CHUNK_CHARS // 2 else CHUNK_CHARS
            if cur:
                out.append(cur)
                cur = ""
            out.append(para[:cut])
            para = para[cut:].lstrip()
        cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        out.append(cur)
    return out


def chunks_of(title: str, content: str) -> list[tuple[str, str]]:
    """(heading, text) sections of about CHUNK_CHARS, split at headings then paragraphs."""
    sections: list[tuple[str, str]] = []
    heads = list(_HEADING.finditer(content))
    if not heads or heads[0].start() > 0:
        sections.append((title, content[: heads[0].start()] if heads else content))
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(content)
        sections.append((h.group(2).strip()[:300], content[h.end() : end]))
    out = []
    for heading, text in sections:
        text = text.strip()
        if not text:
            continue
        out.extend((heading, piece.strip()) for piece in _split_long(text) if piece.strip())
    return out or [(title, title)]


def snippet(text: str, limit: int = 320) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[: limit - 1].rsplit(" ", 1)[0] + "…"
