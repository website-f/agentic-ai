"""P25: search inside every document, with suggestions as you type.

GET /api/search          ranked hits across company files (page by page), SOPs, Document
                         Studio documents, templates and wiki pages, with marked snippets
GET /api/search/suggest  up to 8 suggestions: recent searches, words from the person's own
                         documents, titles, headings
DELETE /api/search/recent  forget this person's recent searches
POST /api/search/reindex   rebuild the workspace's search index (brain.manage)

Who finds what is search.viewer (the same rules as the pages that open each result).
Held-back files are never found.
"""

import asyncio
import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import SessionLocal, get_db
from ...search import engine, index, vocab
from ...search import suggest as suggesting
from ...search.viewer import for_person
from ...services import audit
from ..deps import Principal, api_error, require
from .files import check_branch

router = APIRouter(prefix="/api/search", tags=["search"])
log = logging.getLogger("agentic.api.search")

SourceType = Literal["file", "sop", "document", "template", "page"]


class HitOut(BaseModel):
    type: SourceType
    id: str
    title: str
    subtitle: str
    page: int | None
    snippet: str  # HTML-escaped, <mark> around matches; no other tags
    score: float
    url: str
    heading: str
    branch_id: str | None
    company: str
    folder: str
    kind: str
    department: str
    draft: bool
    pages_matched: int
    via: list[str]  # and | or | text | title | meaning: how it matched


class SearchOut(BaseModel):
    q: str
    hits: list[HitOut]
    total: int
    next_cursor: str | None
    corrected: list[str]
    groups: dict[str, int]
    took_ms: int


class SuggestionOut(BaseModel):
    text: str
    kind: Literal["term", "title", "heading", "recent"]
    type: SourceType | None = None
    id: str | None = None
    url: str | None = None
    page: int | None = None
    branch_id: str | None = None


class SuggestOut(BaseModel):
    q: str
    suggestions: list[SuggestionOut]
    took_ms: int


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    head, _, n = cursor.partition(":")
    if head != "o" or not n.isdigit() or int(n) > 10_000:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_cursor", "That page cursor is not valid.")
    return int(n)


async def _check_department(
    db: AsyncSession, principal: Principal, department_id: str | None
) -> None:
    if not department_id or department_id == "none":
        return
    from ...models import Department

    d = await db.get(Department, department_id)
    if d is None or d.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department.")


@router.get("")
async def search(
    q: str = Query(min_length=1, max_length=300),
    branch_id: str | None = Query(default=None, max_length=40),
    type: SourceType | None = None,  # noqa: A002 - the API's word for it
    kind: str | None = Query(default=None, max_length=40),
    department_id: str | None = Query(default=None, max_length=40),
    source: Literal["upload", "agent", "person", "generated"] | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SearchOut:
    t0 = time.perf_counter()
    await check_branch(db, principal, branch_id)
    await _check_department(db, principal, department_id)
    offset = _offset(cursor)
    viewer = for_person(principal)
    try:
        await index.sync(db, principal.workspace_id, budget=1.0)
    except Exception:  # noqa: BLE001 - search what is indexed
        await db.rollback()
        log.warning("search sync failed", exc_info=True)
    v = await vocab.get(viewer, wait=0.25)
    filters = engine.Filters(branch_id, type, kind, department_id, source)
    res = await engine.search(db, viewer, q, filters, limit=limit, offset=offset, vocab=v)
    if offset == 0:
        await vocab.remember_search(principal.workspace_id, principal.user.id, q)
    return SearchOut(
        q=q,
        hits=[
            HitOut(
                type=h.type,  # type: ignore[arg-type]
                id=h.id,
                title=h.title,
                subtitle=h.subtitle,
                page=h.page,
                snippet=h.snippet,
                score=h.score,
                url=h.url,
                heading=h.heading,
                branch_id=h.branch_id,
                company=h.company,
                folder=h.folder,
                kind=h.kind,
                department=h.department,
                draft=h.draft,
                pages_matched=h.pages_matched,
                via=h.via,
            )
            for h in res.hits
        ],
        total=res.total,
        next_cursor=f"o:{res.next_offset}" if res.next_offset is not None else None,
        corrected=res.corrected,
        groups=res.groups,
        took_ms=int((time.perf_counter() - t0) * 1000),
    )


_syncing: set[asyncio.Task[None]] = set()


async def _sync_later(workspace_id: str) -> None:
    try:
        async with SessionLocal() as db:
            await index.sync(db, workspace_id, budget=3.0)
    except Exception:  # noqa: BLE001 - the next search tries again
        log.warning("background search sync failed", exc_info=True)


@router.get("/suggest")
async def suggest(
    q: str = Query(default="", max_length=120),
    branch_id: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SuggestOut:
    t0 = time.perf_counter()
    await check_branch(db, principal, branch_id)
    task = asyncio.create_task(_sync_later(principal.workspace_id))
    _syncing.add(task)
    task.add_done_callback(_syncing.discard)
    items = await suggesting.suggest(db, for_person(principal), q, branch_id)
    return SuggestOut(
        q=q,
        suggestions=[
            SuggestionOut(
                text=s.text,
                kind=s.kind,  # type: ignore[arg-type]
                type=s.type,  # type: ignore[arg-type]
                id=s.id,
                url=s.url,
                page=s.page,
                branch_id=s.branch_id,
            )
            for s in items
        ],
        took_ms=int((time.perf_counter() - t0) * 1000),
    )


@router.delete("/recent", status_code=status.HTTP_204_NO_CONTENT)
async def clear_recent(principal: Principal = Depends(require("read"))) -> Response:
    await vocab.forget_searches(principal.workspace_id, principal.user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class ReindexOut(BaseModel):
    indexed: int
    removed: int
    sources: dict[str, int]


@router.post("/reindex")
async def reindex(
    principal: Principal = Depends(require("brain.manage")), db: AsyncSession = Depends(get_db)
) -> ReindexOut:
    out = await index.reindex_workspace(db, principal.workspace_id)
    await audit.record(db, principal.workspace_id, principal.actor, "search.reindex", after=out)
    await db.commit()
    return ReindexOut(
        indexed=out.get("indexed", 0),
        removed=out.get("removed", 0),
        sources=await index.counts(db, principal.workspace_id),
    )


async def drain() -> None:
    """Background syncs in flight (tests)."""
    if _syncing:
        await asyncio.gather(*list(_syncing), return_exceptions=True)
