"""Hybrid retrieval on Postgres (the GBrain recipe): keyword (tsvector) + vector (pgvector)
+ one hop of [[wikilinks]], fused with Reciprocal Rank Fusion and boosted by page kind.

Filtering by workspace, branch and agent happens in SQL, never in the model.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models import AgentMessage, BrainChunk, BrainFact, BrainLink, BrainPage, ChatSession, Task
from .facts import scope_filter
from .pages import TIER, UNSEARCHED, snippet
from .scope import Viewer

RRF_K = 60
POOL = 30
RELATIVE_MARGIN = 0.15

# Words that match everything in an untuned ('simple') text index. English and Malay.
STOP = frozenset(
    "a an and are as at be by can do does for from has have how i in is it its me my of on or "
    "our so that the their them they this to us was we were what when where which who why will "
    "with you your yang dan di ke dari untuk ini itu ada apa dengan kami saya kita pada adalah "
    "berapa bila siapa mana macam boleh akan sudah telah juga atau tidak tak nak ni tu".split()
)


@dataclass
class Hit:
    kind: str  # page | fact | message
    id: str
    title: str
    snippet: str
    score: float
    via: list[str] = field(default_factory=list)  # keyword | meaning | link
    path: str | None = None
    when: datetime | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def terms(query: str) -> list[str]:
    words = re.findall(r"\w+", query.lower())
    return [w for w in dict.fromkeys(words) if len(w) > 1 and w not in STOP][:16]


def _tsquery(query: str) -> Any:
    t = terms(query)
    # Words are \w only, so they cannot carry tsquery operators.
    return func.to_tsquery("simple", " | ".join(t)) if t else None


def _close_enough[K](sims: dict[K, float]) -> list[K]:
    """Which vector hits count as relevant, best first.

    Similarity has no absolute meaning: related English/Malay pairs score 0.4-0.6 with this
    model, and loosely related text can reach 0.4 too. So a hit needs both a floor and to be
    near the best hit for this query (RELATIVE_MARGIN), which drops the long tail of noise."""
    if not sims:
        return []
    best = max(sims.values())
    cut = max(settings.recall_min_similarity, best - RELATIVE_MARGIN)
    return [k for k, s in sorted(sims.items(), key=lambda kv: kv[1], reverse=True) if s >= cut]


def _rrf(ranked: list[list[Any]]) -> dict[Any, float]:
    score: dict[Any, float] = {}
    for lst in ranked:
        for rank, key in enumerate(lst):
            score[key] = score.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
    return score


def _chunk_scope(v: Viewer) -> Any:
    conds = [BrainChunk.workspace_id == v.workspace_id, BrainChunk.kind.not_in(UNSEARCHED)]
    if v.branch_ids is not None:
        conds.append(or_(BrainChunk.branch_id.is_(None), BrainChunk.branch_id.in_(v.branch_ids)))
    return and_(*conds)


async def search_pages(
    db: AsyncSession, v: Viewer, query: str, qvec: list[float] | None, limit: int = 6
) -> list[Hit]:
    scope = _chunk_scope(v)
    tsq = _tsquery(query)
    kw: list[int] = []
    if tsq is not None:
        rank = func.ts_rank_cd(BrainChunk.tsv, tsq)
        kw = list(
            (
                await db.scalars(
                    select(BrainChunk.id)
                    .where(scope, BrainChunk.tsv.op("@@")(tsq))
                    .order_by(rank.desc())
                    .limit(POOL)
                )
            ).all()
        )
    vec: list[int] = []
    sims: dict[int, float] = {}
    if qvec is not None:
        dist = BrainChunk.embedding.cosine_distance(qvec)
        for cid, sim in (
            await db.execute(
                select(BrainChunk.id, (1 - dist).label("sim"))
                .where(scope, BrainChunk.embedding.is_not(None))
                .order_by(dist)
                .limit(POOL)
            )
        ).all():
            sims[cid] = float(sim)
        vec = _close_enough(sims)
    fused = _rrf([kw, vec])
    if not fused:
        return []
    kw_set, vec_set = set(kw), set(vec)
    chunks = {
        c.id: c
        for c in (await db.scalars(select(BrainChunk).where(BrainChunk.id.in_(fused)))).all()
    }
    # Best chunk per page, boosted by the page's kind.
    best: dict[str, tuple[float, BrainChunk, list[str]]] = {}
    for cid, s in fused.items():
        c = chunks.get(cid)
        if c is None:
            continue
        s *= TIER.get(c.kind, 1.0)
        via = (["keyword"] if cid in kw_set else []) + (["meaning"] if cid in vec_set else [])
        if c.page_id not in best or s > best[c.page_id][0]:
            best[c.page_id] = (s, c, via)

    # One hop along links from the strongest pages, both directions.
    top = sorted(best, key=lambda p: best[p][0], reverse=True)[:5]
    if top:
        names = dict(
            (
                await db.execute(select(BrainPage.id, BrainPage.name).where(BrainPage.id.in_(top)))
            ).all()
        )
        out_links = (
            select(BrainPage.id, BrainLink.src_page_id)
            .join(
                BrainLink,
                and_(
                    BrainLink.workspace_id == BrainPage.workspace_id,
                    BrainLink.dst_name == BrainPage.name,
                ),
            )
            .where(BrainLink.src_page_id.in_(top), BrainPage.workspace_id == v.workspace_id)
        )
        in_links = (
            select(BrainLink.src_page_id, BrainPage.id)
            .join(BrainPage, BrainPage.id.in_(top))
            .where(
                BrainLink.workspace_id == v.workspace_id,
                BrainLink.dst_name == BrainPage.name,
            )
        )
        pairs = list((await db.execute(out_links)).all()) + list((await db.execute(in_links)).all())
        hop: dict[str, float] = {}
        for neighbour, parent in pairs:
            if neighbour in best or parent not in names:
                continue
            parent_rank = top.index(parent)
            hop[neighbour] = max(hop.get(neighbour, 0.0), 0.5 / (RRF_K + parent_rank + 1))
        if hop:
            for c in (
                await db.scalars(
                    select(BrainChunk).where(
                        _chunk_scope(v), BrainChunk.page_id.in_(hop), BrainChunk.idx == 0
                    )
                )
            ).all():
                best[c.page_id] = (hop[c.page_id] * TIER.get(c.kind, 1.0), c, ["link"])

    ranked = sorted(best.items(), key=lambda kv: kv[1][0], reverse=True)[:limit]
    pages = {
        p.id: p
        for p in (
            await db.scalars(select(BrainPage).where(BrainPage.id.in_([pid for pid, _ in ranked])))
        ).all()
    }
    hits = []
    for pid, (s, c, via) in ranked:
        p = pages.get(pid)
        if p is None:
            continue
        hits.append(
            Hit(
                "page",
                p.id,
                p.title,
                snippet(c.text),
                round(s, 5),
                via,
                path=p.path,
                when=p.updated_at,
                meta={"heading": c.heading, "similarity": round(sims.get(c.id, 0.0), 3)},
            )
        )
    return hits


async def search_facts(
    db: AsyncSession,
    v: Viewer,
    query: str,
    qvec: list[float] | None,
    limit: int = 8,
    include_ended: bool = False,
) -> list[tuple[BrainFact, Hit]]:
    scope = scope_filter(v, include_ended)
    tsq = _tsquery(query)
    kw: list[str] = []
    if tsq is not None:
        kw = list(
            (
                await db.scalars(
                    select(BrainFact.id)
                    .where(scope, BrainFact.tsv.op("@@")(tsq))
                    .order_by(func.ts_rank_cd(BrainFact.tsv, tsq).desc())
                    .limit(POOL)
                )
            ).all()
        )
    vec: list[str] = []
    sims: dict[str, float] = {}
    if qvec is not None:
        dist = BrainFact.embedding.cosine_distance(qvec)
        for fid, sim in (
            await db.execute(
                select(BrainFact.id, (1 - dist).label("sim"))
                .where(scope, BrainFact.embedding.is_not(None))
                .order_by(dist)
                .limit(POOL)
            )
        ).all():
            sims[fid] = float(sim)
        vec = _close_enough(sims)
    fused = _rrf([kw, vec])
    if not fused:
        return []
    facts = {
        f.id: f for f in (await db.scalars(select(BrainFact).where(BrainFact.id.in_(fused)))).all()
    }
    kw_set, vec_set = set(kw), set(vec)
    scored = []
    for fid, s in fused.items():
        f = facts.get(fid)
        if f is None:
            continue
        s *= 0.7 + 0.3 * f.confidence
        if f.valid_to is not None:
            s *= 0.5
        via = (["keyword"] if fid in kw_set else []) + (["meaning"] if fid in vec_set else [])
        scored.append((s, f, via))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [
        (
            f,
            Hit(
                "fact",
                f.id,
                f.text,
                f.text,
                round(s, 5),
                via,
                when=f.valid_from,
                meta={
                    "source": f.source_label,
                    "similarity": round(sims.get(f.id, 0.0), 3),
                    "private": f.agent_id is not None,
                    "ended": f.end_reason,
                },
            ),
        )
        for s, f, via in scored[:limit]
    ]


_MSG_TSV = func.to_tsvector("simple", func.coalesce(AgentMessage.content, literal("")))


async def search_history(
    db: AsyncSession,
    v: Viewer,
    query: str,
    limit: int = 5,
    exclude_task_id: str | None = None,
    exclude_session_id: str | None = None,
) -> list[Hit]:
    """Session recall: past conversations, as short snippets (never whole transcripts)."""
    tsq = _tsquery(query)
    if tsq is None:
        return []
    q = select(AgentMessage).where(
        AgentMessage.workspace_id == v.workspace_id,
        AgentMessage.role.in_(("user", "assistant")),
        _MSG_TSV.op("@@")(tsq),
    )
    if v.agent_id is not None:
        q = q.where(AgentMessage.agent_id == v.agent_id)
    if exclude_task_id:
        q = q.where(or_(AgentMessage.task_id.is_(None), AgentMessage.task_id != exclude_task_id))
    if exclude_session_id:
        q = q.where(
            or_(AgentMessage.session_id.is_(None), AgentMessage.session_id != exclude_session_id)
        )
    rows = list(
        (await db.scalars(q.order_by(func.ts_rank_cd(_MSG_TSV, tsq).desc()).limit(limit * 3))).all()
    )
    task_ids = {m.task_id for m in rows if m.task_id}
    session_ids = {m.session_id for m in rows if m.session_id}
    titles: dict[str, str] = {}
    if task_ids:
        titles |= dict(
            (await db.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids)))).all()
        )
    if session_ids:
        titles |= dict(
            (
                await db.execute(
                    select(ChatSession.id, ChatSession.title).where(ChatSession.id.in_(session_ids))
                )
            ).all()
        )
    words = terms(query)
    hits, seen = [], set()
    for m in rows:
        where = m.task_id or m.session_id or ""
        if where in seen:  # one snippet per conversation
            continue
        seen.add(where)
        content = m.content or ""
        low = content.lower()
        pos = min((low.find(w) for w in words if w in low), default=0)
        start = max(0, pos - 80)
        hits.append(
            Hit(
                "message",
                str(m.id),
                (
                    f"Task: {titles[m.task_id]}"
                    if m.task_id and m.task_id in titles
                    else f"Chat: {titles.get(m.session_id or '', 'conversation')}"
                ),
                ("…" if start else "") + snippet(content[start:], 280),
                0.0,
                ["keyword"],
                when=m.created_at,
                meta={"role": m.role, "task_id": m.task_id, "session_id": m.session_id},
            )
        )
        if len(hits) >= limit:
            break
    return hits
