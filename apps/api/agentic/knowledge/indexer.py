"""Keep the library's passages in step with their sources.

Every function rebuilds a source's passages from scratch (delete, chunk, embed, insert)
under a per-source advisory lock, so running one twice, or two at once, leaves exactly one
copy. Files are indexed only while `files.library` is on and the file has been read;
SOPs are always indexed (find_sop and auto-recall search them).

The embedding model reads about 128 word pieces (~600 characters), far less than a passage,
so a passage's vector is its title, heading and opening. Averaging vectors over the whole
passage was tried: it dilutes a focused rule among its neighbours and pushes paraphrased
questions under the similarity floor. Words deeper in a passage are found by the keyword
half of the search.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ..brain import embed
from ..core.config import settings
from ..models import EMBED_DIMS, SOP, Department, DocFile, KnowledgeChunk
from .chunker import Passage, chunk_text

log = logging.getLogger("agentic.knowledge")

WINDOW = 600  # characters the embedding model reads (~128 word pieces)


def embed_input(title: str, heading: str, body: str) -> str:
    prefix = ". ".join(x for x in (title, heading) if x)
    head = body[:WINDOW]
    if len(body) > WINDOW and " " in head[WINDOW // 2 :]:
        head = head[: head.rfind(" ")]
    return f"{prefix}\n{head}" if prefix else head


_dims_logged = False


def dims_ok(vec: list[float] | None) -> bool:
    """P29: a vector fits the embedding columns (EMBED_DIMS). The model is configurable
    (AGENTIC_EMBED_MODEL) but the columns are not: a model of another size would fail every
    insert, so its vectors are dropped (keyword search keeps working) and it is logged once."""
    global _dims_logged
    if vec is None:
        return True
    if len(vec) == EMBED_DIMS:
        return True
    if not _dims_logged:
        _dims_logged = True
        log.error(
            "embedding model %s gives %d-dimension vectors but the index holds %d: vectors "
            "are not stored or searched (keywords only). Use a %d-dimension model.",
            settings.embed_model,
            len(vec),
            EMBED_DIMS,
            EMBED_DIMS,
        )
    return False


async def _vectors(title: str, passages: list[Passage]) -> list[list[float] | None]:
    vecs = await embed.embed([embed_input(title, p.heading, p.text) for p in passages])
    if not vecs or not dims_ok(vecs[0]):
        return [None] * len(passages)
    return list(vecs)


async def _lock(db: AsyncSession, kind: str, source_id: str) -> None:
    # Taken before anything pending is flushed: a flushed row (the file's library flag)
    # would hold its row lock while waiting here, and deadlock with index_file.
    with db.no_autoflush:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"knowledge:{kind}:{source_id}"},
        )


async def remove(db: AsyncSession, kind: str, source_id: str) -> None:
    """Drop a source's passages (the caller commits). P29: under the source's lock, so an
    index_file running at the same time cannot put them back after the caller commits."""
    await _lock(db, kind, source_id)
    await db.execute(
        delete(KnowledgeChunk).where(
            KnowledgeChunk.source_kind == kind, KnowledgeChunk.source_id == source_id
        )
    )


async def _write(
    db: AsyncSession,
    *,
    workspace_id: str,
    kind: str,
    source_id: str,
    branch_id: str | None,
    department_id: str | None,
    title: str,
    body: str,
) -> int:
    await remove(db, kind, source_id)
    passages = chunk_text(body)
    if not passages:
        return 0
    vectors = await _vectors(title, passages)
    now = datetime.now(UTC)
    for i, (p, vec) in enumerate(zip(passages, vectors, strict=True)):
        db.add(
            KnowledgeChunk(
                workspace_id=workspace_id,
                source_kind=kind,
                source_id=source_id,
                branch_id=branch_id,
                department_id=department_id,
                title=title[:200],
                idx=i,
                heading=p.heading[:300],
                page=p.page,
                text=p.text,
                embedding=vec,
                created_at=now,
            )
        )
    return len(passages)


def file_title(f: DocFile) -> str:
    return (f.title or f.name or "Untitled file").strip()


async def index_file(db: AsyncSession, file_id: str) -> int:
    """(Re)build a file's passages; removes them when it is not (or not yet) a library file.
    Commits. Returns the number of passages."""
    await _lock(db, "file", file_id)
    f = await db.scalar(select(DocFile).where(DocFile.id == file_id).options(undefer(DocFile.text)))
    if f is None:
        await remove(db, "file", file_id)
        await db.commit()
        return 0
    if not f.library or f.status != "ready" or f.quarantined:
        # P24: a quarantined file (passwords, staff IC numbers) is never searchable.
        await remove(db, "file", file_id)
        if not f.library or f.quarantined:
            f.indexed_at = None
        await db.commit()
        return 0
    scope = (f.branch_id, f.department_id, file_title(f))
    for _ in range(3):
        n = await _write(
            db,
            workspace_id=f.workspace_id,
            kind="file",
            source_id=f.id,
            branch_id=scope[0],
            department_id=scope[1],
            title=scope[2],
            body=f.text or "",
        )
        # P29: embedding takes a while; look again before committing, so a file taken out
        # of the library, held back, deleted or moved meanwhile never keeps stale passages.
        now = (
            await db.execute(
                select(
                    DocFile.library,
                    DocFile.quarantined,
                    DocFile.status,
                    DocFile.branch_id,
                    DocFile.department_id,
                    DocFile.title,
                    DocFile.name,
                )
                .where(DocFile.id == file_id)
                .execution_options(populate_existing=True)
            )
        ).first()
        if now is None or not now.library or now.quarantined or now.status != "ready":
            await remove(db, "file", file_id)
            await db.commit()
            return 0
        fresh = (
            now.branch_id,
            now.department_id,
            (now.title or now.name or "Untitled file").strip(),
        )
        if fresh == scope:
            break
        scope = fresh
    f.indexed_at = datetime.now(UTC)
    await db.commit()
    log.info("indexed file %s: %d passages", f.id, n)
    return n


async def sop_scope(db: AsyncSession, s: SOP) -> tuple[str | None, str | None]:
    """(branch_id, department_id) readers need: workspace and library SOPs are for everyone,
    a branch SOP for that branch, a department SOP for that department (in its branch)."""
    if s.scope == "branch":
        return s.scope_id, None
    if s.scope == "department" and s.scope_id:
        d = await db.get(Department, s.scope_id)
        return (d.branch_id if d else None), s.scope_id
    return None, None


async def index_sop(db: AsyncSession, sop_id: str) -> int:
    """(Re)build an SOP's passages, or drop them when it is gone or a draft (P24: agents
    never find a draft SOP). Commits."""
    n = await _index_sop(db, sop_id)
    # P25: document search keeps drafts too (only people who manage SOPs find them).
    from ..search import index as search_index

    await search_index.try_index(db, "sop", sop_id)
    return n


async def _index_sop(db: AsyncSession, sop_id: str) -> int:
    await _lock(db, "sop", sop_id)
    s = await db.get(SOP, sop_id)
    if s is None or s.status != "active":
        await remove(db, "sop", sop_id)
        await db.commit()
        return 0
    branch_id, department_id = await sop_scope(db, s)
    n = await _write(
        db,
        workspace_id=s.workspace_id,
        kind="sop",
        source_id=s.id,
        branch_id=branch_id,
        department_id=department_id,
        title=s.title,
        body=s.body or s.title,
    )
    await db.commit()
    return n


async def reindex_workspace(db: AsyncSession, workspace_id: str) -> dict[str, int]:
    """Rebuild every library file and SOP of a workspace, and drop passages whose source
    is gone or no longer in the library."""
    file_ids = list(
        (
            await db.scalars(
                select(DocFile.id).where(
                    DocFile.workspace_id == workspace_id, DocFile.library.is_(True)
                )
            )
        ).all()
    )
    sop_ids = list(
        (
            await db.scalars(
                select(SOP.id).where(SOP.workspace_id == workspace_id, SOP.status == "active")
            )
        ).all()
    )
    stale = select(KnowledgeChunk.source_kind, KnowledgeChunk.source_id).where(
        KnowledgeChunk.workspace_id == workspace_id
    )
    known = {("file", i) for i in file_ids} | {("sop", i) for i in sop_ids}
    for kind, sid in set((await db.execute(stale.distinct())).all()) - known:
        await remove(db, kind, sid)
    await db.commit()
    passages = 0
    for fid in file_ids:
        try:
            passages += await index_file(db, fid)
        except Exception:  # noqa: BLE001 - one broken file must not stop the rest
            await db.rollback()
            log.warning("could not index file %s", fid, exc_info=True)
    for sid in sop_ids:
        passages += await index_sop(db, sid)
    return {"files": len(file_ids), "sops": len(sop_ids), "passages": passages}


async def passage_counts(
    db: AsyncSession, workspace_id: str
) -> dict[tuple[str, str], tuple[int, datetime]]:
    """{(kind, source id): (passages, when they were built)}."""
    rows = await db.execute(
        select(
            KnowledgeChunk.source_kind,
            KnowledgeChunk.source_id,
            func.count(),
            func.max(KnowledgeChunk.created_at),
        )
        .where(KnowledgeChunk.workspace_id == workspace_id)
        .group_by(KnowledgeChunk.source_kind, KnowledgeChunk.source_id)
    )
    return {(k, s): (n, last) for k, s, n, last in rows.all()}
