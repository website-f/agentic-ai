"""P65: the Prima Secure knowledge pack: PWVSB Security Group's written procedures, imported
into every workspace's Library so agents find and follow them.

What it holds (paths inside the pack folder, which mirrors apps/prima):
- docs/system/*.md: overview, roles and access, business rules, status; 04-workflows.md is
  split into one SOP per workflow (W1-W34), so a search hits the exact procedure
- docs/system/screens/*.md: one SOP per screen file
- docs/system/reference/: the rule register, record forms and task guide cards split per
  section; the hand-over map whole
- apps/web/src/it-guide/catalog.ts: one SOP per IT workflow guide (steps, inputs, checker,
  approver, oversight)
- the IT, HR/IT intake, staff data security and website pilot docs; CLAUDE.md's workflow
  boundaries

Each section becomes a Library SOP (scope "library": every agent finds it with find_sop and
search_library, and strong passages are recalled into its work unasked, but none is pushed
whole into every prompt) titled "Prima · ...". `sops.pack_key` names the section, so a re-run
never duplicates; `sops.pack_hash` is the sha256 of what the import last wrote, so unchanged
sections are skipped, changed ones updated (and re-indexed through knowledge.indexer), and a
section a person edited in the app is kept as they left it (an owner's forced run overwrites
it). A section gone from its source file is removed; a source file that is missing is left
alone. A person can unpublish (draft) a section: re-runs keep its status.

Where the folder is: AGENTIC_PRIMA_PACK_DIR, else /app/prima-pack in the image, else the
repo's apps/prima. Runs at API start and on the worker's 10-minute liveness round
(sync_all), and on demand from POST /api/library/packs/prima.
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models import SOP, Agent, KnowledgeChunk, Workspace
from ..services import audit
from . import indexer

log = logging.getLogger("agentic.knowledge.prima")

PACK = "prima"
LABEL = "Prima Secure"
PREFIX = "Prima · "
UPDATED_BY = "pack:prima"
CONTAINER_DIR = Path("/app/prima-pack")
TITLE_MAX = 160  # sops.title
BODY_MAX = 38_000  # under the 40k a person may save through the SOP form

# What agents are told when the pack is in their workspace (agents/prompt.py).
PROMPT_NOTE = """This company's written procedures are the Prima Secure pack in the library: \
SOPs titled "Prima · ..." with workflows W1-W34 (e.g. "Prima · W12 Monthly staff payroll"), \
business rules and approval chains, the rule register, record forms and IT guides. Before \
related work (rosters, attendance, cases, HR, payroll, claims, finance, purchases, IT jobs, \
contracts, tenders), look the procedure up with find_sop or search_library, follow its steps \
and approvers, and cite it.
Prima's limits apply to you too:
- You prepare drafts, checks and summaries only. Never decide or approve pay, deductions, \
discipline, contracts or payments, and never mark work as checked, accepted or confirmed: \
name the person the procedure says decides.
- Never invent rates, amounts, dates, evidence, ownership or payments; unknown stays unknown. \
A rule labelled Unverified or Proposed is not fact or law.
- Staff send and reply to email in Outlook themselves: draft the text, do not send it."""

RULE_LABELS = (
    "Labels: Law (from an Act or regulation), Secondary (from a published summary; check the "
    "primary source), Policy (the owner's decision; 'Proposed' means not approved yet), "
    "Unverified (a working assumption: never present it as fact or law)."
)


@dataclass(frozen=True)
class Source:
    pattern: str  # a path or glob inside the pack folder
    split: str = "whole"  # whole | h2 | workflows | it_guides | boundaries
    name: str = ""  # the title stem; default: the file's first heading
    note: str = ""  # a line under the header of each of its sections


SOURCES: tuple[Source, ...] = (
    Source("docs/system/README.md", name="About the system documentation"),
    Source("docs/system/01-overview.md"),
    Source("docs/system/02-roles-and-access.md", "h2"),
    Source("docs/system/03-business-rules.md", "h2"),
    Source("docs/system/04-workflows.md", "workflows", name="Workflows"),
    Source("docs/system/05-status-and-gaps.md"),
    Source("docs/system/screens/*.md"),
    Source("docs/system/reference/rule-register.md", "h2", "Rule register", RULE_LABELS),
    Source("docs/system/reference/record-forms.md", "h2", "Record form"),
    Source("docs/system/reference/guide-cards.md", "h2", "Task guide cards"),
    Source("docs/system/reference/handover-map.md"),
    Source("apps/web/src/it-guide/catalog.ts", "it_guides", "IT guide"),
    Source("docs/IT_*.md"),
    Source("docs/HR_IT_INTAKE_*.md"),
    Source("docs/STAFF_DATA_SECURITY.md"),
    Source("docs/WEBSITE_*.md"),
    Source("CLAUDE.md", "boundaries", "Workflow boundaries"),
)


@dataclass(frozen=True)
class PackDoc:
    key: str  # "prima:<source path>[#section]"
    title: str
    body: str
    source: str

    @property
    def digest(self) -> str:
        return digest(self.title, self.body)


@dataclass
class Pack:
    root: Path
    docs: list[PackDoc] = field(default_factory=list)
    sources: set[str] = field(default_factory=set)  # source files read without error


def digest(title: str, body: str) -> str:
    return hashlib.sha256(f"{title}\0{body}".encode()).hexdigest()


def pack_dir() -> Path | None:
    if settings.prima_pack_dir:
        root = Path(settings.prima_pack_dir)
    elif CONTAINER_DIR.is_dir():
        root = CONTAINER_DIR
    else:
        # agentic/knowledge/prima_pack.py -> apps/api/agentic/knowledge -> apps/prima
        root = Path(__file__).resolve().parents[3] / "prima"
    return root if root.is_dir() else None


# ---------------------------------------------------------------- reading the sources

_HEAD = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


def clean_title(raw: str) -> str:
    t = re.sub(r"\*\([^)]*\)\*", "", raw)  # "*(candidate, PR #49)*": status stays in the body
    t = t.replace("`", "").replace("*", "")
    t = re.sub(r"\s*\(generated\)\s*$", "", t, flags=re.I)
    t = re.sub(r"^\d+\.\s+", "", t)  # "4. Workflows" -> "Workflows"
    t = re.sub(r"^(W\d+)\.\s*", r"\1 ", t)  # "W12. Monthly staff payroll" -> "W12 Monthly ..."
    return " ".join(t.split()).strip(" .:")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "section"


def _title(*parts: str) -> str:
    t = PREFIX + " · ".join(p for p in parts if p)
    return t if len(t) <= TITLE_MAX else t[: TITLE_MAX - 1].rstrip() + "…"


@dataclass
class _Section:
    heading: str
    parent: str
    lines: list[str]


def split_markdown(text: str, level: int) -> tuple[str, str, list[_Section]]:
    """(first heading, text before the first section, sections at `level`). A heading of a
    higher level between sections (a department above its workflows) becomes their parent.
    Headings inside code fences do not count."""
    h1 = ""
    intro: list[str] = []
    sections: list[_Section] = []
    parent = ""
    cur: _Section | None = None
    fenced = False
    for line in text.splitlines():
        if _FENCE.match(line):
            fenced = not fenced
        m = None if fenced else _HEAD.match(line)
        if m:
            n, head = len(m.group(1)), m.group(2).strip()
            if n == 1 and not h1:
                h1 = head
                continue
            if n < level:
                cur, parent = None, head
                continue
            if n == level:
                cur = _Section(head, parent, [line])
                sections.append(cur)
                continue
        if cur is not None:
            cur.lines.append(line)
        elif not sections and not parent:
            intro.append(line)
    return h1, "\n".join(intro).strip(), sections


def _body(context: str, source: str, text: str, note: str = "") -> str:
    head = f"{LABEL} · {context}\nSource: {source} (the {LABEL} knowledge pack)"
    if note:
        head += f"\n{note}"
    return f"{head}\n\n{text.strip()}\n"


def _parts(text: str) -> list[str]:
    """A body too long for one SOP, cut at paragraphs."""
    if len(text) <= BODY_MAX:
        return [text]
    out: list[str] = []
    cur = ""
    for para in text.split("\n\n"):
        while len(para) > BODY_MAX:  # one enormous paragraph: cut it at a line
            cut = para.rfind("\n", 0, BODY_MAX)
            cut = cut if cut > 0 else BODY_MAX
            if cur:
                out.append(cur)
                cur = ""
            out.append(para[:cut])
            para = para[cut:].lstrip("\n")
        if cur and len(cur) + len(para) + 2 > BODY_MAX:
            out.append(cur)
            cur = ""
        cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        out.append(cur)
    return out


def _docs(key: str, title: str, context: str, src: str, text: str, note: str = "") -> list[PackDoc]:
    """One section as one or more PackDocs (" · part 2" when it is too long for one SOP)."""
    pieces = _parts(text)
    out = []
    for i, piece in enumerate(pieces, 1):
        k, t, c = key, title, context
        if len(pieces) > 1:
            k, t, c = (
                f"{key}~{i}",
                _title(title[len(PREFIX) :], f"part {i}"),
                f"{context}, part {i}",
            )
        out.append(PackDoc(k[:160], t, _body(c, src, piece, note), src))
    return out


def _key(src: str, section: str = "") -> str:
    return f"{PACK}:{src}" + (f"#{section}" if section else "")


def _whole(src: str, text: str, s: Source) -> list[PackDoc]:
    h1, _, _ = split_markdown(text, 2)
    stem = s.name or clean_title(h1) or Path(src).stem
    return _docs(_key(src), _title(stem), stem, src, text, s.note)


def _by_h2(src: str, text: str, s: Source) -> list[PackDoc]:
    h1, intro, sections = split_markdown(text, 2)
    stem = s.name or clean_title(h1) or Path(src).stem
    if not sections:
        return _whole(src, text, s)
    out: list[PackDoc] = []
    if len(intro) >= 80:
        out += _docs(_key(src, "introduction"), _title(stem, "Introduction"), stem, src, intro)
    seen: set[str] = set()
    for sec in sections:
        name = clean_title(sec.heading)
        slug = _slug(name)
        while slug in seen:
            slug += "-2"
        seen.add(slug)
        body = "\n".join(sec.lines)
        out += _docs(_key(src, slug), _title(stem, name), f"{stem}: {name}", src, body, s.note)
    return out


def _workflows(src: str, text: str, s: Source) -> list[PackDoc]:
    _, intro, sections = split_markdown(text, 3)
    out: list[PackDoc] = []
    if len(intro) >= 80:
        out += _docs(
            _key(src, "introduction"),
            _title("Workflows", "How to read them"),
            "Workflows",
            src,
            intro,
        )
    for sec in sections:
        name = clean_title(sec.heading)
        m = re.match(r"(W\d+)\b", name)
        slug = m.group(1).lower() if m else _slug(name)
        dept = clean_title(sec.parent)
        context = f"Workflow {name}" + (f" ({dept})" if dept else "")
        body = "\n".join(sec.lines)
        out += _docs(_key(src, slug), _title(name), context, src, body)
    return out


def _boundaries(src: str, text: str, s: Source) -> list[PackDoc]:
    _, _, sections = split_markdown(text, 2)
    for sec in sections:
        if clean_title(sec.heading).lower() == "workflow boundaries":
            body = "\n".join(sec.lines)
            return _docs(_key(src, "workflow-boundaries"), _title(s.name), s.name, src, body)
    return []


# The IT guide catalog is TypeScript: one array of object literals with quoted strings. A
# small reader for that subset of JavaScript (strings, arrays, objects, null/true/false).

_IDENT = re.compile(r"[A-Za-z_$][\w$]*")
_ATOM = re.compile(r"null|true|false|-?\d+(?:\.\d+)?")


def _skip(s: str, i: int) -> int:
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    return i


def _string(s: str, i: int) -> tuple[str, int]:
    q, i, out = s[i], i + 1, []
    while s[i] != q:
        if s[i] == "\\":
            out.append({"n": "\n", "t": "\t"}.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out), i + 1


def _value(s: str, i: int) -> tuple[Any, int]:
    i = _skip(s, i)
    c = s[i]
    if c in "'\"":
        return _string(s, i)
    if c in "[{":
        close, items, obj = ("]" if c == "[" else "}"), [], {}
        i += 1
        while True:
            i = _skip(s, i)
            if s[i] == close:
                return (items if c == "[" else obj), i + 1
            if c == "[":
                v, i = _value(s, i)
                items.append(v)
            else:
                if s[i] in "'\"":
                    key, i = _string(s, i)
                else:
                    m = _IDENT.match(s, i)
                    if not m:
                        raise ValueError(f"expected a key at {i}")
                    key, i = m.group(0), m.end()
                i = _skip(s, i)
                if s[i] != ":":
                    raise ValueError(f"expected ':' at {i}")
                obj[key], i = _value(s, i + 1)
            i = _skip(s, i)
            if s[i] == ",":
                i += 1
    m = _ATOM.match(s, i)
    if not m:
        raise ValueError(f"unexpected {c!r} at {i}")
    return {"null": None, "true": True, "false": False}.get(m.group(0), m.group(0)), m.end()


def parse_it_guides(src: str) -> list[dict[str, Any]]:
    """The `workflows` array of it-guide/catalog.ts."""
    at = src.find("workflows:GuideFlow[]")
    if at < 0:
        at = src.find("const workflows")
    if at < 0:
        return []
    value, _ = _value(src, src.index("[", src.index("=", at)))
    return [w for w in value if isinstance(w, dict) and w.get("id") and w.get("title")]


def render_it_guide(g: dict[str, Any]) -> str:
    lines = [
        f"# IT guide: {g['title']}",
        "",
        "Prima's in-app IT guide is deterministic help: it does not approve, check or carry out "
        "work. Follow the steps through the actions each screen offers.",
    ]
    if g.get("tab"):
        lines.append(f"Prima IT tab: {g['tab']}")
    steps = [str(x) for x in g.get("steps") or []]
    if steps:
        lines += ["", "## Steps", *(f"{n}. {x}" for n, x in enumerate(steps, 1))]
    for label, k in (
        ("What you need", "inputs"),
        ("Who checks", "checker"),
        ("Who approves", "approver"),
        ("Oversight", "overseer"),
        ("Setup and limits", "setup"),
    ):
        if g.get(k):
            lines += ["", f"## {label}", str(g[k])]
    return "\n".join(lines)


def _it_guides(src: str, text: str, s: Source) -> list[PackDoc]:
    out: list[PackDoc] = []
    for g in parse_it_guides(text):
        name = clean_title(str(g["title"]))
        out += _docs(
            _key(src, _slug(str(g["id"]))),
            _title(s.name, name),
            f"{s.name}: {name}",
            src,
            render_it_guide(g),
        )
    return out


_SPLITTERS = {
    "whole": _whole,
    "h2": _by_h2,
    "workflows": _workflows,
    "it_guides": _it_guides,
    "boundaries": _boundaries,
}


def load_pack(root: Path | None = None) -> Pack | None:
    """Every section of the pack, or None when the folder is not here."""
    root = root or pack_dir()
    if root is None or not root.is_dir():
        return None
    pack = Pack(root)
    keys: set[str] = set()
    for s in SOURCES:
        for path in sorted(root.glob(s.pattern)):
            if not path.is_file():
                continue
            src = path.relative_to(root).as_posix()
            try:
                docs = _SPLITTERS[s.split](src, path.read_text(encoding="utf-8"), s)
            except Exception:  # noqa: BLE001 - one unreadable file must not stop the pack
                log.warning("prima pack: could not read %s", src, exc_info=True)
                continue
            pack.sources.add(src)
            for d in docs:
                if d.key not in keys:
                    keys.add(d.key)
                    pack.docs.append(d)
    return pack


def source_of(key: str) -> str:
    return key[len(PACK) + 1 :].split("#", 1)[0]


# ---------------------------------------------------------------- the Library side


@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    kept: int = 0  # edited by a person in the app: left as they are
    removed: int = 0
    indexed: int = 0
    to_index: list[str] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": self.created,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "kept": self.kept,
            "removed": self.removed,
            "indexed": self.indexed,
        }


def _pack_keys() -> Any:
    return SOP.pack_key.like(f"{PACK}:%")


async def apply(
    db: AsyncSession,
    workspace_id: str,
    pack: Pack,
    *,
    force: bool = False,
    actor: str = "system",
    audit_always: bool = False,
) -> SyncResult:
    """Create, update or remove the workspace's pack SOPs to match `pack`, and commit.
    Returns what changed and the SOPs whose passages need (re)building."""
    out = SyncResult()
    # One import per workspace at a time (API start, the worker's round, an owner's run).
    with db.no_autoflush:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"knowledge:pack:{PACK}:{workspace_id}"},
        )
    rows = {
        s.pack_key: s
        for s in (
            await db.scalars(select(SOP).where(SOP.workspace_id == workspace_id, _pack_keys()))
        ).all()
    }
    changed: list[str] = []
    wanted = {d.key for d in pack.docs}
    for d in pack.docs:
        s = rows.get(d.key)
        if s is None:
            s = SOP(
                workspace_id=workspace_id,
                scope="library",
                title=d.title,
                body=d.body,
                status="active",
                updated_by=UPDATED_BY,
                pack_key=d.key,
                pack_hash=d.digest,
            )
            db.add(s)
            await db.flush()
            changed.append(s.id)
            out.created += 1
        elif s.pack_hash == d.digest:
            out.unchanged += 1
        elif not force and digest(s.title, s.body) != s.pack_hash:
            out.kept += 1
        else:
            if s.body != d.body:
                s.version += 1
            s.title, s.body = d.title, d.body
            s.pack_hash, s.updated_by = d.digest, UPDATED_BY
            changed.append(s.id)
            out.updated += 1
    gone: list[SOP] = []
    for key, s in rows.items():
        if key in wanted or source_of(key) not in pack.sources:
            continue  # still in the pack, or its source file is not here this time
        if not force and digest(s.title, s.body) != s.pack_hash:
            out.kept += 1
            continue
        gone.append(s)
    if gone:
        ids = {s.id for s in gone}
        for a in (await db.scalars(select(Agent).where(Agent.workspace_id == workspace_id))).all():
            if ids & set(a.sop_ids or []):
                a.sop_ids = [x for x in a.sop_ids if x not in ids]
        for s in gone:
            await db.delete(s)
        await db.execute(
            delete(KnowledgeChunk).where(
                KnowledgeChunk.source_kind == "sop", KnowledgeChunk.source_id.in_(ids)
            )
        )
        out.removed = len(gone)
    if audit_always or changed or gone:
        await audit.record(
            db,
            workspace_id,
            actor,
            "knowledge_pack.synced",
            target=PACK,
            after={**out.counts(), "sections": len(pack.docs), "forced": force},
            note=f"{LABEL} knowledge pack",
        )
    await db.commit()
    # Active pack SOPs without passages (new, changed, or an earlier indexing that failed).
    active = {
        sid
        for sid in (
            await db.scalars(
                select(SOP.id).where(
                    SOP.workspace_id == workspace_id, _pack_keys(), SOP.status == "active"
                )
            )
        ).all()
    }
    built = set(
        (
            await db.scalars(
                select(KnowledgeChunk.source_id)
                .where(
                    KnowledgeChunk.workspace_id == workspace_id,
                    KnowledgeChunk.source_kind == "sop",
                    KnowledgeChunk.source_id.in_(active),
                )
                .distinct()
            )
        ).all()
    )
    out.to_index = list(dict.fromkeys([*changed, *sorted(active - built)]))
    return out


async def index(db: AsyncSession, sop_ids: list[str]) -> int:
    """Build the passages of these SOPs (knowledge.indexer). Returns how many were indexed."""
    done = 0
    for sid in sop_ids:
        try:
            await indexer.index_sop(db, sid)
            done += 1
        except Exception:  # noqa: BLE001 - the next run retries SOPs left without passages
            await db.rollback()
            log.warning("prima pack: could not index SOP %s", sid, exc_info=True)
    return done


async def index_later(sop_ids: list[str]) -> None:
    """index() on its own session (after an owner's run has answered)."""
    from ..core.db import SessionLocal

    async with SessionLocal() as db:
        await index(db, sop_ids)


async def sync_workspace(
    db: AsyncSession, workspace_id: str, pack: Pack, *, force: bool = False
) -> SyncResult:
    out = await apply(db, workspace_id, pack, force=force)
    out.indexed = await index(db, out.to_index)
    return out


async def sync_all(pack: Pack | None = None) -> dict[str, int]:
    """Bring every workspace's pack up to date (API start, the worker's liveness round).
    Quick when nothing changed: one read of the pack and one query per workspace."""
    from ..core.db import SessionLocal

    if not settings.prima_pack:
        return {}
    pack = pack or load_pack()
    if pack is None or not pack.docs:
        return {}
    total = {"workspaces": 0, "created": 0, "updated": 0, "removed": 0, "indexed": 0}
    async with SessionLocal() as db:
        ws_ids = list((await db.scalars(select(Workspace.id))).all())
    for ws in ws_ids:
        async with SessionLocal() as db:
            try:
                r = await sync_workspace(db, ws, pack)
            except Exception:  # noqa: BLE001 - one workspace must not stop the rest
                await db.rollback()
                log.warning("prima pack: workspace %s failed", ws, exc_info=True)
                continue
        total["workspaces"] += 1
        for k in ("created", "updated", "removed", "indexed"):
            total[k] += getattr(r, k)
    if total["created"] or total["updated"] or total["removed"]:
        log.info("prima pack synced: %s", total)
    return total


async def run_at_startup() -> None:
    """The API's start: never fails the start-up."""
    try:
        await sync_all()
    except Exception:  # noqa: BLE001
        log.warning("prima pack: start-up import failed", exc_info=True)


async def installed(db: AsyncSession, workspace_id: str) -> bool:
    """The workspace has the pack (at least one active section)."""
    found = await db.scalar(
        select(SOP.id)
        .where(SOP.workspace_id == workspace_id, _pack_keys(), SOP.status == "active")
        .limit(1)
    )
    return found is not None
