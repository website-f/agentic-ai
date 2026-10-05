"""Keep the search index in step with the documents.

Every source (a file, SOP, document, template or wiki page) is rebuilt whole: delete its
passages and headings, cut its text with the library's chunker (pages and headings kept),
build each passage's tsvector (search.text), store the source's version. A per-source
advisory lock makes two rebuilds at once leave one copy.

When it runs:
- a file finishes reading (documents.service.process_file) and an SOP is saved
  (knowledge.indexer.index_sop): at once
- everything else (documents, templates, wiki pages, files from elsewhere, a deploy with
  an empty index): `sync`, which people's searches start at most every SYNC_EVERY seconds
  per workspace and which redoes only sources whose version changed, within a time budget
- `python -m agentic.search reindex` rebuilds a workspace (or all) in one go

Held-back files are never indexed; one held back after indexing drops out of results at
once (searches join the file and check) and its passages go at the next sync.
"""

import logging
import re
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Text, and_, cast, delete, func, insert, literal, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ..core.valkey import valkey
from ..knowledge.chunker import chunk_text
from ..models import SOP, BrainPage, DocFile, DocTemplate, Document
from . import text as words
from .models import SearchHeading, SearchPassage, SearchSource
from .viewer import WIKI_KINDS

log = logging.getLogger("agentic.search")

SYNC_EVERY = 15  # seconds between syncs of one workspace
MAX_HEADINGS = 400


def _gen_key(workspace_id: str) -> str:
    return f"search:gen:{workspace_id}"


async def generation(workspace_id: str) -> int:
    """Bumped whenever a workspace's index changes (suggestion caches key on it)."""
    try:
        return int(await valkey().get(_gen_key(workspace_id)) or 0)
    except Exception:  # noqa: BLE001 - no Valkey: caches simply expire on their TTL
        return 0


async def _bump(workspace_id: str) -> None:
    try:
        await valkey().incr(_gen_key(workspace_id))
    except Exception:  # noqa: BLE001
        log.debug("could not bump the search generation", exc_info=True)


def _sep(*parts: Any) -> Any:
    out: Any = None
    for p in parts:
        piece = literal(p) if isinstance(p, str) else func.coalesce(cast(p, Text), "")
        out = piece if out is None else out.op("||")(piece)
    return out


# tsvectors are built in Python (search.text) and cast here, so Postgres never re-parses them.
INSERT_PASSAGE = text(
    "INSERT INTO search_passages "
    "(workspace_id, source_kind, source_id, file_id, idx, page, heading, text, tsv) VALUES "
    "(:workspace_id, :source_kind, :source_id, :file_id, :idx, :page, :heading, :text, "
    "CAST(:tsv AS tsvector))"
)


# What a source's index was built from. Compared in SQL by `sync`.
def _file_version() -> Any:
    return func.md5(
        _sep(DocFile.sha256, ":", DocFile.pages, ":", DocFile.summary, ":", DocFile.fields)
    )


VERSIONS: dict[str, Any] = {
    "file": _file_version(),
    "sop": func.md5(cast(SOP.updated_at, Text)),
    "document": func.md5(cast(Document.updated_at, Text)),
    "template": func.md5(cast(DocTemplate.updated_at, Text)),
    "page": func.md5(cast(BrainPage.updated_at, Text)),
}
MODELS: dict[str, Any] = {
    "file": DocFile,
    "sop": SOP,
    "document": Document,
    "template": DocTemplate,
    "page": BrainPage,
}


def _eligible(kind: str, workspace_id: str) -> Any:
    m = MODELS[kind]
    cond = m.workspace_id == workspace_id
    if kind == "file":
        return and_(cond, DocFile.status == "ready", DocFile.quarantined.is_(False))
    if kind == "page":
        return and_(cond, BrainPage.kind.in_(WIKI_KINDS))
    return cond


async def _lock(db: AsyncSession, kind: str, source_id: str) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"search:{kind}:{source_id}"}
    )


async def _drop(db: AsyncSession, kind: str, source_id: str) -> None:
    for model in (SearchPassage, SearchHeading, SearchSource):
        await db.execute(
            delete(model).where(model.source_kind == kind, model.source_id == source_id)
        )


async def remove(db: AsyncSession, kind: str, source_id: str, workspace_id: str) -> None:
    """Forget a source (commits)."""
    await _drop(db, kind, source_id)
    await db.commit()
    await _bump(workspace_id)


def _headings(body: str) -> list[tuple[int | None, str]]:
    from ..intake.builders import outline  # lazy: builders imports half the app

    out: list[tuple[int | None, str]] = []
    seen: set[str] = set()
    for row in outline(body, max_lines=MAX_HEADINGS, max_chars=40_000):
        line = row.strip()
        page = None
        if m := re.match(r"p\.(\d+)\s+(.*)$", line):
            page, line = int(m.group(1)), m.group(2).strip()
        line = line.strip("#* ").strip()[:300]
        key = line.casefold()
        if len(line) >= 3 and key not in seen:
            seen.add(key)
            out.append((page, line))
    return out


_PAGE = re.compile(r"^\[page (\d+)\]\s*$", re.M)


def cut(body: str) -> list[tuple[str, int | None, str]]:
    """(heading, page, text) passages. Pages are cut apart first, so a hit names the page
    it is really on (the library's chunker lets short pages run together)."""
    if not body.strip():
        return []
    marks = list(_PAGE.finditer(body))
    if not marks:
        return [(p.heading, p.page, p.text) for p in chunk_text(body)]
    out: list[tuple[str, int | None, str]] = []
    pre = body[: marks[0].start()]
    if pre.strip():
        out.extend((p.heading, None, p.text) for p in chunk_text(pre))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(body)
        page = int(m.group(1))
        out.extend((p.heading, page, p.text) for p in chunk_text(body[m.end() : end]))
    return out


def _flat(v: Any) -> str:
    if isinstance(v, dict):
        return " ".join(f"{k}: {_flat(x)}" for k, x in v.items())
    if isinstance(v, list):
        return " ; ".join(_flat(x) for x in v)
    return "" if v is None else str(v)


async def _write(
    db: AsyncSession,
    *,
    workspace_id: str,
    kind: str,
    source_id: str,
    file_id: str | None,
    version: str,
    body: str,
    extra: str = "",
) -> int:
    """Replace a source's passages and headings with ones cut from `body` (+ `extra`, a
    short passage of facts: a file's summary and fields). The caller commits."""
    await _drop(db, kind, source_id)
    passages = cut(body)
    if extra.strip():
        passages.append(("", None, extra.strip()))
    rows = [
        {
            "workspace_id": workspace_id,
            "source_kind": kind,
            "source_id": source_id,
            "file_id": file_id,
            "idx": i,
            "page": page,
            "heading": (heading or "")[:300],
            "text": body_,
            "tsv": words.tsvector(heading or "", body_),
        }
        for i, (heading, page, body_) in enumerate(passages)
    ]
    if rows:
        await db.execute(INSERT_PASSAGE, rows)
    heads = _headings(body) if body.strip() else []
    if heads:
        await db.execute(
            insert(SearchHeading),
            [
                {
                    "workspace_id": workspace_id,
                    "source_kind": kind,
                    "source_id": source_id,
                    "file_id": file_id,
                    "page": page,
                    "text": line,
                }
                for page, line in heads
            ],
        )
    db.add(
        SearchSource(
            source_kind=kind,
            source_id=source_id,
            workspace_id=workspace_id,
            file_id=file_id,
            version=version,
            passages=len(rows),
            indexed_at=datetime.now(UTC),
        )
    )
    return len(rows)


def _file_facts(f: DocFile) -> str:
    lines = [f.summary or ""]
    for k, v in (f.fields or {}).items():
        lines.append(f"{k}: {_flat(v)}")
    return "\n".join(x for x in lines if x.strip())


async def index_source(db: AsyncSession, kind: str, source_id: str) -> int:
    """(Re)build one source; forget it when it is gone or not searchable (a file still
    reading, failed or held back). Commits. Returns the number of passages."""
    if kind not in MODELS:
        raise ValueError(f"unknown search source kind {kind!r}")
    await _lock(db, kind, source_id)
    model = MODELS[kind]
    q = select(model, VERSIONS[kind]).where(model.id == source_id)
    if kind == "file":
        q = q.options(undefer(DocFile.text))
    row = (await db.execute(q)).first()
    if row is None:
        await _drop(db, kind, source_id)
        await db.commit()
        return 0
    src, version = row[0], row[1]
    ws = src.workspace_id
    if kind == "file" and (src.status != "ready" or src.quarantined):
        await _drop(db, kind, source_id)
        await db.commit()
        await _bump(ws)
        return 0
    if kind == "page" and src.kind not in WIKI_KINDS:
        await _drop(db, kind, source_id)
        await db.commit()
        return 0
    file_id = src.id if kind == "file" else None
    if kind == "file":
        body, extra = src.text or "", _file_facts(src)
    elif kind == "sop":
        body, extra = src.body or "", ""
    elif kind == "document":
        body, extra = src.body or "", _flat(src.values or {})
    elif kind == "template":
        body, extra = src.body or "", src.description or ""
    else:
        body, extra = src.body or "", ""
    n = await _write(
        db,
        workspace_id=ws,
        kind=kind,
        source_id=source_id,
        file_id=file_id,
        version=str(version),
        body=body,
        extra=extra,
    )
    await db.commit()
    await _bump(ws)
    return n


async def index_file(db: AsyncSession, file_id: str) -> int:
    return await index_source(db, "file", file_id)


async def try_index(db: AsyncSession, kind: str, source_id: str) -> None:
    """index_source for hooks: never lets a search problem break the caller."""
    try:
        await index_source(db, kind, source_id)
    except Exception:  # noqa: BLE001 - the next sync redoes it
        await db.rollback()
        log.warning("could not index %s %s for search", kind, source_id, exc_info=True)


async def stale(db: AsyncSession, workspace_id: str, kind: str, limit: int = 500) -> list[str]:
    """Sources new or changed since they were indexed."""
    m = MODELS[kind]
    q = (
        select(m.id)
        .outerjoin(
            SearchSource,
            and_(SearchSource.source_kind == kind, SearchSource.source_id == m.id),
        )
        .where(
            _eligible(kind, workspace_id),
            (SearchSource.source_id.is_(None)) | (SearchSource.version != VERSIONS[kind]),
        )
        .limit(limit)
    )
    return list((await db.scalars(q)).all())


async def gone(db: AsyncSession, workspace_id: str, kind: str) -> list[str]:
    """Indexed sources that were deleted or stopped being searchable."""
    m = MODELS[kind]
    q = select(SearchSource.source_id).where(
        SearchSource.workspace_id == workspace_id,
        SearchSource.source_kind == kind,
        ~SearchSource.source_id.in_(select(m.id).where(_eligible(kind, workspace_id))),
    )
    return list((await db.scalars(q)).all())


async def sync(
    db: AsyncSession, workspace_id: str, *, budget: float = 1.5, force: bool = False
) -> dict[str, int]:
    """Index what changed in a workspace, for at most `budget` seconds (the rest waits for
    the next sync). At most once every SYNC_EVERY seconds unless forced."""
    if not force:
        try:
            if not await valkey().set(f"search:sync:{workspace_id}", "1", nx=True, ex=SYNC_EVERY):
                return {"skipped": 1}
        except Exception:  # noqa: BLE001 - no Valkey: sync anyway (it is cheap when idle)
            log.debug("no sync throttle (Valkey unavailable)", exc_info=True)
    t0 = time.monotonic()
    done = removed = 0
    for kind in MODELS:
        for sid in await gone(db, workspace_id, kind):
            await _drop(db, kind, sid)
            removed += 1
    if removed:
        await db.commit()
        await _bump(workspace_id)
    for kind in MODELS:
        for sid in await stale(db, workspace_id, kind):
            if time.monotonic() - t0 > budget:
                return {"indexed": done, "removed": removed, "more": 1}
            await try_index(db, kind, sid)
            done += 1
    return {"indexed": done, "removed": removed, "more": 0}


async def reindex_workspace(db: AsyncSession, workspace_id: str) -> dict[str, int]:
    """Bring a whole workspace up to date (no time budget)."""
    return await sync(db, workspace_id, budget=float("inf"), force=True)


async def counts(db: AsyncSession, workspace_id: str) -> dict[str, int]:
    rows = await db.execute(
        select(SearchSource.source_kind, func.count(), func.sum(SearchSource.passages))
        .where(SearchSource.workspace_id == workspace_id)
        .group_by(SearchSource.source_kind)
    )
    out: dict[str, int] = {}
    for kind, n, p in rows.all():
        out[f"{kind}s"] = int(n)
        out["passages"] = out.get("passages", 0) + int(p or 0)
    return out
