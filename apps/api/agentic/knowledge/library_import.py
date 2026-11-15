"""P106: put company documents (PDF, Word, Excel, text files) into one office's Library from a
manifest, so its agents search, recall and cite them.

Run by the operator inside the api container, with the documents and the manifest copied in
(read-only) first:

    python -m agentic.knowledge.library_import --workspace <id or slug> \\
        --manifest /tmp/x/manifest.json --dry-run
    python -m agentic.knowledge.library_import --workspace <id or slug> \\
        --manifest /tmp/x/manifest.json

The manifest is a JSON list (or {"files": [...]}) of
    {"path": "polisi-cuti.pdf", "title": "Polisi Cuti", "summary": "...",
     "scope": "workspace", "kind": "policy", "restricted": false}
- path: the file, relative to the manifest's folder. PDF, Word (.docx), Excel (.xlsx),
  PowerPoint (.pptx), CSV or text; at most the upload limit (documents.service.MAX_FILE_BYTES).
- title (required) and summary: what the Library shows. The summary may carry a warning
  ("DRAF v3 - belum berkuat kuasa sehingga diluluskan HR/Legal"); agents see the title on
  every passage they find, so a draft's title should say DRAF too (the report reminds).
- scope: "workspace" (default: every agent of the office), a company (branch) name, a
  department name, or "Company / Department" when two companies have the department.
- kind: one of intake.sort.KINDS (sop, guide, policy, form, checklist, ...); "reference" is
  read as guide. Default "guide".
- restricted (optional): only the department's own agents and managers read it (P36).
  Unset: decided from the kind, name and title as when a person switches a file into the
  Library (intake.sort.sensitive_words).

Each file becomes an ordinary Library file, as if an owner had uploaded it and switched it
into the Library: the same `files` row (bytes in the workspace's storage, sha256, mime),
"file.uploaded" and "file.library" audit entries by the actor "operator", and then the same
read as an upload (documents.service.process_file: text, OCR for scans, the scan for
secrets and personal data, the cheap model's fields) on the worker, or here when Temporal is
down (or with --here); a library file is cut into passages when its read finishes. Its
source_path starts "library import: ", which keeps the manifest's title, summary, kind and
restriction through every later read or re-read.

Re-runs: a file whose bytes (sha256) are already in this office's Library is unchanged
(its title, summary, kind, scope and restriction follow the manifest, re-indexed when the
title or audience changed). A file with the same title as one this import made, or from the
same file name, but new bytes is a new version: the old file's bytes and text are replaced
and its passages dropped and rebuilt from the new text (one file, no orphan passages). A
Library file of that title that a person uploaded is not replaced without --force.

Before anything is written every file is read here and checked: text that tries to give an
AI instructions (core.threats) refuses the file; passwords or several IC numbers (which
would hold it back for review, intake.scan) refuse it; other personal numbers are reported
as counts. If any entry is refused, nothing is written. The report names files, sizes,
counts and findings, never a document's text.
"""

import argparse
import asyncio
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("agentic.knowledge.library_import")

ACTOR = "operator"
TYPES = ("pdf", "docx", "xlsx", "pptx", "csv", "text")
ALIASES = {"reference": "guide", "manual": "guide", "procedure": "sop"}
DEFAULT_KIND = "guide"
TITLE_MAX = 200  # files.title
SUMMARY_MAX = 1000  # files.summary
MIN_TEXT = 20  # characters of real text below which a file is "nothing read"
# Scan findings that a policy or SOP trips by describing its subject ("leave without
# approval", "you are now a permanent employee"): reported for the operator, not a stop.
WARN_ONLY = frozenset({"skip_approval", "html_comment_injection", "role_hijack"})
DRAFT = re.compile(r"\b(draf|draft)\b|belum berkuat kuasa|not (yet )?in force", re.I)


class LibraryImportError(ValueError):
    pass


@dataclass
class Entry:
    n: int
    path: str  # as the manifest gives it
    name: str  # the file name stored on the office's file
    title: str
    summary: str
    kind: str
    scope: str
    restricted: bool | None
    data: bytes = b""
    sha256: str = ""
    filetype: str = ""
    pages: int = 0
    chars: int = 0
    passages: int = 0
    note: str = ""  # what the reader said (pages cut, no OCR...)
    blocked: list[str] = field(default_factory=list)  # injection findings: refused
    warnings: list[str] = field(default_factory=list)
    personal: dict[str, int] = field(default_factory=dict)  # kind -> count, never a value
    problem: str | None = None  # why it may not come in
    # filled in against the office
    branch_id: str | None = None
    department_id: str | None = None
    scope_label: str = ""
    action: str = ""  # create | unchanged | update | replace
    target: str | None = None  # the existing file's id
    changes: list[str] = field(default_factory=list)  # details that change on it
    read: str = ""  # queued | done (after a real run)
    file_id: str | None = None


# ---------------------------------------------------------------- reading the manifest


def _text_field(raw: dict[str, Any], key: str, limit: int) -> str:
    value = raw.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise LibraryImportError(f"{key} must be text")
    value = " ".join(value.split())
    if len(value) > limit:
        raise LibraryImportError(f"{key} is {len(value)} characters (at most {limit})")
    return value


def _kind(raw: Any) -> str:
    from ..intake.sort import KINDS

    kind = str(raw or DEFAULT_KIND).strip().lower()
    kind = ALIASES.get(kind, kind)
    if kind not in KINDS:
        raise LibraryImportError(f"kind {raw!r} is not one of {', '.join(KINDS)} (or reference)")
    return kind


def load_manifest(path: Path) -> list[Entry]:
    """The manifest's entries, each checked on its own (a broken one carries its problem).
    Raises LibraryImportError when the manifest itself cannot be read."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise LibraryImportError(f"Cannot read the manifest {path}: {e}") from e
    items = raw.get("files") if isinstance(raw, dict) else raw
    if not isinstance(items, list) or not items:
        raise LibraryImportError('The manifest must be a list of files (or {"files": [...]}).')
    base = path.parent
    out: list[Entry] = []
    for n, item in enumerate(items, 1):
        if not isinstance(item, dict):
            out.append(Entry(n, "?", "?", "?", "", "", "", None, problem="not an object"))
            continue
        rel = str(item.get("path") or "").strip()
        e = Entry(n, rel, Path(rel).name, str(item.get("title") or ""), "", "", "", None)
        try:
            if not rel:
                raise LibraryImportError("path is missing")
            e.title = _text_field(item, "title", TITLE_MAX)
            if not e.title:
                raise LibraryImportError("title is missing")
            e.summary = _text_field(item, "summary", SUMMARY_MAX)
            e.kind = _kind(item.get("kind"))
            e.scope = _text_field(item, "scope", 300) or "workspace"
            restricted = item.get("restricted")
            if restricted is not None and not isinstance(restricted, bool):
                raise LibraryImportError("restricted must be true or false")
            e.restricted = restricted
            _read(e, base / rel)
        except LibraryImportError as err:
            e.problem = str(err)
        out.append(e)
    _duplicates(out)
    return out


def _read(e: Entry, path: Path) -> None:
    """Read and check one file here (as the office will): size, type, text, passages, scan."""
    import hashlib

    from ..documents.extract import extract, sniff
    from ..documents.service import MAX_FILE_BYTES
    from .chunker import chunk_text

    if not path.is_file():
        raise LibraryImportError(f"no file at {e.path}")
    size = path.stat().st_size
    if size == 0:
        raise LibraryImportError("the file is empty")
    if size > MAX_FILE_BYTES:
        raise LibraryImportError(
            f"{size:,} bytes: files can be up to {MAX_FILE_BYTES // (1024 * 1024)} MB"
        )
    e.data = path.read_bytes()
    e.sha256 = hashlib.sha256(e.data).hexdigest()
    e.filetype = sniff(e.data[:4096], e.name)
    if e.filetype not in TYPES:
        raise LibraryImportError(f"a {e.filetype} file: only PDF, Word, Excel, CSV or text")
    out = extract(e.data, e.name)
    e.pages, e.chars, e.note = out.pages, len(out.text), out.note
    real = re.sub(r"\[page \d+\]|\s", "", out.text)
    if len(real) < MIN_TEXT:
        raise LibraryImportError(
            "no text could be read from it" + (f" ({out.note})" if out.note else "")
        )
    e.passages = len(chunk_text(out.text))
    _scan(e, out.text)


def threat_findings(text: str) -> list[str]:
    """core.threats over the whole text (it reads MAX_SCAN characters at a time)."""
    from ..core import threats

    found: list[str] = []
    step = threats.MAX_SCAN - 2_000  # windows overlap, so a phrase on a seam is seen
    for start in range(0, max(len(text), 1), step):
        for t in threats.scan(text[start : start + threats.MAX_SCAN], "context"):
            if t not in found:
                found.append(t)
    return found


def _scan(e: Entry, text: str) -> None:
    from ..intake import scan

    found = threat_findings(text) + threat_findings(f"{e.title}\n{e.summary}")
    hidden = sorted({t for t in found if t.startswith("invisible_")})
    e.blocked = sorted({t for t in found if t not in WARN_ONLY and t not in hidden})
    e.warnings = [
        f"mentions {t.replace('_', ' ')} (read it: a subject, not an order?)"
        for t in sorted({t for t in found if t in WARN_ONLY})
    ]
    if hidden:
        e.warnings.append(f"has {len(hidden)} kind(s) of hidden character")
    personal = scan.scan(text)
    if e.filetype in ("docx", "xlsx", "pptx"):  # headers, comments, rows past what was read
        raw = scan.office_text(e.data)
        if raw:
            personal.merge(scan.scan(raw))
    e.personal = {k: len(v) for k, v in sorted(personal.personal.items()) if v}
    if e.blocked:
        raise LibraryImportError(
            "the safety scan found text that tries to instruct an AI ("
            + ", ".join(t.replace("_", " ") for t in e.blocked)
            + ")"
        )
    if personal.quarantine:
        what = []
        if personal.credentials:
            what.append("a password or key")
        if personal.ic_count:
            what.append(f"{personal.ic_count} IC numbers")
        raise LibraryImportError(
            f"it holds {' and '.join(what)}: the office would hold it back for review, so "
            "agents would never read it. Take them out of the document first"
        )
    if DRAFT.search(e.summary) and not DRAFT.search(e.title):
        e.warnings.append(
            "the summary says it is a draft but the title does not: agents see the title "
            "on every passage, not the summary (put DRAF in the title)"
        )


def _duplicates(entries: list[Entry]) -> None:
    seen_sha: dict[str, int] = {}
    seen_title: dict[str, int] = {}
    for e in entries:
        if e.problem:
            continue
        if e.sha256 in seen_sha:
            e.problem = f"the same file as entry {seen_sha[e.sha256]}"
        elif _key(e.title) in seen_title:
            e.problem = f"the same title as entry {seen_title[_key(e.title)]}"
        seen_sha.setdefault(e.sha256, e.n)
        seen_title.setdefault(_key(e.title), e.n)


def _key(title: str) -> str:
    return " ".join(title.split()).casefold()


# ---------------------------------------------------------------- against the office


async def find_workspace(db: Any, key: str) -> Any:
    from sqlalchemy import or_, select

    from ..models import Workspace

    ws = await db.scalar(select(Workspace).where(or_(Workspace.id == key, Workspace.slug == key)))
    if ws is None:
        rows = (await db.execute(select(Workspace.id, Workspace.slug, Workspace.name))).all()
        have = "; ".join(f"{i} ({s}, {n})" for i, s, n in rows) or "none"
        raise LibraryImportError(f"No workspace {key!r}. Workspaces: {have}.")
    return ws


class Places:
    """The office's companies and departments, found by name (any case) or id."""

    def __init__(self, branches: list[tuple[str, str]], depts: list[tuple[str, str, str]]):
        self.branches = branches  # (id, name)
        self.depts = depts  # (id, name, branch id)

    @classmethod
    async def load(cls, db: Any, ws_id: str) -> "Places":
        from sqlalchemy import select

        from ..models import Branch, Department

        b = (
            await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws_id))
        ).all()
        d = (
            await db.execute(
                select(Department.id, Department.name, Department.branch_id).where(
                    Department.workspace_id == ws_id
                )
            )
        ).all()
        return cls([(i, n) for i, n in b], [(i, n, bid) for i, n, bid in d])

    def _branch_name(self, bid: str) -> str:
        return next((n for i, n in self.branches if i == bid), "?")

    def resolve(self, scope: str) -> tuple[str | None, str | None, str]:
        """(branch id, department id, label). Raises LibraryImportError."""
        want = _key(scope)
        if want in ("workspace", "whole company", "all", ""):
            return None, None, "whole office"
        if "/" in scope:
            b_name, d_name = (_key(x) for x in scope.split("/", 1))
            for did, dn, bid in self.depts:
                if _key(dn) == d_name and _key(self._branch_name(bid)) == b_name:
                    return bid, did, f"{self._branch_name(bid)} / {dn}"
            raise LibraryImportError(f"no department {scope!r} (Company / Department)")
        for bid, bn in self.branches:
            if bid == scope or _key(bn) == want:
                return bid, None, bn
        hits = [(did, dn, bid) for did, dn, bid in self.depts if did == scope or _key(dn) == want]
        if len(hits) == 1:
            did, dn, bid = hits[0]
            return bid, did, f"{self._branch_name(bid)} / {dn}"
        if hits:
            where = ", ".join(sorted(self._branch_name(bid) for _, _, bid in hits))
            raise LibraryImportError(
                f"{len(hits)} departments are called {scope!r} (in {where}): write "
                "'Company / Department'"
            )
        names = ", ".join(sorted(n for _, n in self.branches)) or "none"
        raise LibraryImportError(f"no company or department {scope!r} (companies: {names})")


async def plan(db: Any, ws: Any, entries: list[Entry], *, force: bool) -> None:
    """Decide each entry's action against the office's Library now (writes nothing)."""
    from sqlalchemy import select

    from ..documents.service import IMPORT_SOURCE, from_import
    from ..intake.sort import sensitive_words
    from ..models import DocFile

    places = await Places.load(db, ws.id)
    lib = list(
        (
            await db.scalars(
                select(DocFile).where(DocFile.workspace_id == ws.id, DocFile.library.is_(True))
            )
        ).all()
    )
    by_sha = {f.sha256: f for f in sorted(lib, key=lambda f: f.created_at, reverse=True)}
    for e in entries:
        if e.problem:
            continue
        try:
            e.branch_id, e.department_id, e.scope_label = places.resolve(e.scope)
        except LibraryImportError as err:
            e.problem = str(err)
            continue
        if e.restricted is None:
            e.restricted = sensitive_words(e.kind, e.name, e.title)
        same = by_sha.get(e.sha256)
        if same is not None:
            e.target = same.id
            e.changes = _changes(same, e)
            e.action = "update" if e.changes else "unchanged"
            continue
        titled = [f for f in lib if _key(f.title or "") == _key(e.title)]
        named = [f for f in lib if (f.source_path or "") == IMPORT_SOURCE + e.name]
        ours = [f for f in titled + named if from_import(f)]
        if ours:
            e.action, e.target = "replace", ours[0].id
        elif titled and force:
            e.action, e.target = "replace", titled[0].id
        elif titled:
            e.problem = (
                f"a Library file a person uploaded ({titled[0].id}, {titled[0].name}) has "
                "this title: give this one another title, or use --force to replace it"
            )
        else:
            e.action = "create"
        if e.target:
            e.changes = ["file"] + _changes(next(f for f in lib if f.id == e.target), e)
    claimed: dict[str, int] = {}
    for e in entries:  # two entries never change one file
        if e.target and not e.problem:
            if e.target in claimed:
                e.problem = f"entry {claimed[e.target]} already changes {e.target}"
            claimed.setdefault(e.target, e.n)


def _changes(f: Any, e: Entry) -> list[str]:
    from ..documents.service import from_import

    out = []
    if f.title != e.title:
        out.append("title")
    if f.summary != e.summary:
        out.append("summary")
    if f.kind != e.kind:
        out.append("kind")
    if (f.branch_id, f.department_id) != (e.branch_id, e.department_id):
        out.append("scope")
    if bool(f.restricted) != bool(e.restricted):
        out.append("restricted")
    if not from_import(f):
        out.append("kept as the manifest says")  # its title and summary now stay put
    return out


# ---------------------------------------------------------------- writing it


async def _start_read(file_id: str, here: bool) -> str:
    """Read the file on the worker (then it is indexed there); here when Temporal is down or
    with --here. queued | done."""
    from ..agents import dispatch
    from ..core.db import SessionLocal
    from ..documents import service

    if not here:
        try:
            await dispatch.start_file_extract(file_id)
            return "queued"
        except Exception:  # noqa: BLE001 - reading must not depend on the queue being up
            log.warning("worker unavailable; reading %s here", file_id, exc_info=True)
    async with SessionLocal() as db:
        await service.process_file(db, file_id)
    return "done"


async def _start_index(file_id: str, here: bool) -> str:
    """As api.routers.library.start_index: the worker, or here."""
    from ..agents import dispatch
    from ..workflows.knowledge_activities import run_index

    if not here:
        try:
            await dispatch.start_library_index("file", file_id)
            return "queued"
        except Exception:  # noqa: BLE001 - the library must not depend on the queue being up
            log.warning("worker unavailable; indexing %s here", file_id, exc_info=True)
    await run_index("file", file_id)
    return "done"


def _details(f: Any, e: Entry) -> None:
    from ..documents.service import IMPORT_SOURCE

    f.title, f.summary, f.kind = e.title, e.summary, e.kind
    f.branch_id, f.department_id = e.branch_id, e.department_id
    f.restricted = bool(e.restricted)
    f.source_path = (IMPORT_SOURCE + e.name)[:500]


def _place(f: Any) -> dict[str, Any]:
    return {
        "library": f.library,
        "branch_id": f.branch_id,
        "department_id": f.department_id,
        "restricted": f.restricted,
    }


async def apply(
    db: Any, ws: Any, entries: list[Entry], *, dry_run: bool, here: bool = False
) -> list[Entry]:
    """Write the planned entries into the office (nothing in dry_run, nor when any entry is
    refused: raises LibraryImportError then). Returns the entries."""
    from ..documents import service, storage
    from ..documents.extract import MIME
    from ..models import DocFile
    from ..services import audit
    from . import indexer

    refused = [e for e in entries if e.problem]
    if dry_run:
        return entries
    if refused:
        raise LibraryImportError(
            f"{len(refused)} of {len(entries)} files cannot come in (see above); nothing was "
            "written. Fix or remove them and run again."
        )
    note = "library import (P106)"
    to_read: list[Entry] = []
    to_index: list[Entry] = []
    for e in entries:
        if e.action == "unchanged":
            e.file_id = e.target
            continue
        if e.action == "create":
            f = await service.create_file(
                db,
                workspace_id=ws.id,
                name=e.name,
                data=e.data,
                created_by=ACTOR,
                branch_id=e.branch_id,
                department_id=e.department_id,
                source="upload",
                status="reading",
            )
            before = _place(f)
            _details(f, e)
            f.library = True
            after = {"name": f.name, "size": f.size}
            await audit.record(db, ws.id, ACTOR, "file.uploaded", f.id, after=after, note=note)
            await audit.record(
                db, ws.id, ACTOR, "file.library", f.id, before=before, after=_place(f), note=note
            )
            to_read.append(e)
        else:
            f = await db.get(DocFile, e.target)
            if f is None:
                raise LibraryImportError(f"{e.target} was removed meanwhile; run again.")
            before = {**_place(f), "title": f.title, "sha256": f.sha256, "size": f.size}
            _details(f, e)
            if e.action == "replace":
                await storage.replace(db, f, e.data)
                f.name, f.size, f.sha256 = e.name, len(e.data), e.sha256
                f.mime = MIME.get(e.filetype, f.mime)
                f.status, f.text, f.pages, f.ocr, f.error = "reading", "", 0, False, None
                f.indexed_at = None
                # The old text's passages go now: nothing answers from the old version while
                # the new one is read (its read rebuilds them).
                await indexer.remove(db, "file", f.id)
                to_read.append(e)
            elif {"title", "scope", "restricted"} & set(e.changes) and f.status == "ready":
                to_index.append(e)  # passages carry the title and the audience
            await audit.record(
                db,
                ws.id,
                ACTOR,
                "file.replaced" if e.action == "replace" else "file.library",
                f.id,
                before=before,
                after={**_place(f), "title": f.title, "sha256": f.sha256, "size": f.size},
                note=note,
            )
        e.file_id = f.id
    await db.commit()
    for e in to_read:
        if e.file_id:
            e.read = await _start_read(e.file_id, here)
    for e in to_index:
        if e.file_id:
            e.read = await _start_index(e.file_id, here)
    return entries


async def passages_now(db: Any, entries: list[Entry]) -> None:
    """After a run read here: the passages each file has now (for the report)."""
    from sqlalchemy import func, select

    from ..models import DocFile, KnowledgeChunk

    for e in entries:
        if not e.file_id or e.read != "done":
            continue
        e.passages = (
            await db.scalar(
                select(func.count())
                .select_from(KnowledgeChunk)
                .where(KnowledgeChunk.source_kind == "file", KnowledgeChunk.source_id == e.file_id)
            )
        ) or 0
        held = await db.scalar(select(DocFile.quarantined).where(DocFile.id == e.file_id))
        if held:
            e.warnings.append("held back for review by the office's scan (not searchable)")


# ---------------------------------------------------------------- the command


def _personal(e: Entry) -> str:
    if not e.personal:
        return ""
    total = sum(e.personal.values())
    kinds = ", ".join(f"{k.replace('_', ' ')} {n}" for k, n in e.personal.items())
    return f"possible personal numbers: {total} ({kinds})"


def report(entries: list[Entry], *, dry_run: bool) -> str:
    """Names, sizes, counts and findings only: never a document's text."""
    lines = []
    for e in entries:
        lines.append(f"[{e.n}] {e.title or '?'}")
        lines.append(
            f"    file: {e.path}"
            + (f"  {e.filetype}  {len(e.data):,} bytes" if e.data else "")
            + (f"  pages {e.pages}" if e.pages else "")
        )
        if e.problem is None or e.chars:
            lines.append(
                f"    kind: {e.kind}  scope: {e.scope_label or e.scope}"
                + ("  restricted" if e.restricted else "")
            )
            lines.append(
                f"    text: {e.chars:,} characters -> {e.passages} passages"
                + (f"  ({e.note})" if e.note else "")
            )
        blocked = ", ".join(t.replace("_", " ") for t in e.blocked)
        scan = [f"BLOCKED ({blocked})" if blocked else "", _personal(e), *e.warnings]
        scan = [s for s in scan if s]
        lines.append("    scan: " + ("; ".join(scan) if scan else "ok"))
        if e.problem:
            lines.append(f"    REFUSED: {e.problem}")
            continue
        if not e.action:  # not compared with an office
            continue
        what = {
            "create": "add to the Library",
            "unchanged": "unchanged",
            "update": "update its details",
            "replace": "replace the file's content (new version)",
        }.get(e.action, e.action)
        target = f" {e.target}" if e.target else ""
        changes = f" ({', '.join(e.changes)})" if e.changes else ""
        head = "would" if dry_run else "done:"
        read = f"; read {'on the worker' if e.read == 'queued' else 'here'}" if e.read else ""
        lines.append(f"    {head} {what}{target}{changes}{read}")
    counts: dict[str, int] = {}
    for e in entries:
        key = "refused" if e.problem else e.action or "readable"
        counts[key] = counts.get(key, 0) + 1
    order = ("create", "replace", "update", "unchanged", "readable", "refused")
    lines.append(
        ("Would: " if dry_run else "Done: ")
        + ", ".join(f"{k} {counts[k]}" for k in order if k in counts)
        + f" (of {len(entries)})."
    )
    return "\n".join(lines)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m agentic.knowledge.library_import",
        description="Put company documents into one office's Library from a manifest.",
    )
    p.add_argument("--workspace", required=True, help="the office: its id or slug")
    p.add_argument("--manifest", required=True, help="the JSON manifest (paths relative to it)")
    p.add_argument("--dry-run", action="store_true", help="say what would happen, write nothing")
    p.add_argument("--force", action="store_true", help="replace a person's file of that title")
    p.add_argument(
        "--here", action="store_true", help="read and index here instead of on the worker"
    )
    return p


async def _run(args: argparse.Namespace, entries: list[Entry]) -> list[Entry]:
    from ..core.db import SessionLocal, engine

    try:
        async with SessionLocal() as db:
            ws = await find_workspace(db, args.workspace)
            await plan(db, ws, entries, force=args.force)
            out = await apply(db, ws, entries, dry_run=args.dry_run, here=args.here)
        if not args.dry_run:
            async with SessionLocal() as db:
                await passages_now(db, out)
        return out
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        entries = load_manifest(Path(args.manifest))
    except LibraryImportError as e:
        print(f"Not imported: {e}", file=sys.stderr)
        return 1
    try:
        entries = asyncio.run(_run(args, entries))
    except LibraryImportError as e:
        print(report(entries, dry_run=True))
        print(f"Not imported: {e}", file=sys.stderr)
        return 1
    print(report(entries, dry_run=args.dry_run))
    return 1 if any(e.problem for e in entries) else 0


if __name__ == "__main__":
    raise SystemExit(main())
