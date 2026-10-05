"""Suggestions as people type: their recent searches, the word being typed completed from
their documents' own words, matching titles and matching headings. About 8, fast: every
part is one small indexed query or a lookup in memory."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BrainPage, DocFile
from . import text as tx
from . import vocab
from .engine import Filters, _title_cols, has_trgm, like, visible
from .models import SearchHeading
from .viewer import Viewer

MAX = 8
QUOTA = {"recent": 2, "term": 2, "title": 3, "heading": 2}
URLS = {
    "file": "/files?f={id}",
    "sop": "/sops?sop={id}",
    "document": "/documents?d={id}",
    "template": "/templates",
    "page": "/brain?tab=pages&path={path}",
}


@dataclass
class Suggestion:
    text: str
    kind: str  # term | title | heading | recent
    type: str | None = None  # file | sop | document | template | page
    id: str | None = None
    url: str | None = None
    page: int | None = None
    branch_id: str | None = None  # a file's company (the Files page opens one company)


def _url(kind: str, sid: str, page: int | None = None, path: str = "") -> str:
    u = URLS[kind].format(id=quote(sid), path=quote(path))
    return u + (f"&page={page}" if page and kind == "file" else "")


async def _titles(
    db: AsyncSession, vis: dict[str, Any], q: str, trgm: bool, n: int
) -> list[Suggestion]:
    cols = _title_cols()
    found: list[tuple[int, int, str, str, str, str]] = []
    for kind, sub in vis.items():
        id_col, title, _ = cols[kind]
        shown = title
        if kind == "file":
            shown = func.coalesce(func.nullif(DocFile.title, ""), DocFile.name)
        hit = title.ilike(like(q))
        if trgm and len(q) >= 4:
            hit = or_(hit, literal(q).op("<%")(title))
        path = BrainPage.path if kind == "page" else literal("")
        rows = (
            await db.execute(select(id_col, shown, path).where(id_col.in_(sub), hit).limit(n * 2))
        ).all()
        low = q.casefold()
        for sid, label, p in rows:
            name = str(label or "")
            at = name.casefold().find(low)
            found.append(
                (0 if at == 0 else 1 if at > 0 else 2, len(name), name, kind, sid, p or "")
            )
    found.sort(key=lambda x: (x[0], x[1], x[2]))
    return [
        Suggestion(name, "title", kind, sid, _url(kind, sid, path=p))
        for _, _, name, kind, sid, p in found[:n]
    ]


async def _headings(db: AsyncSession, vis: dict[str, Any], q: str, n: int) -> list[Suggestion]:
    if len(q) < 3:
        return []
    allowed = [
        and_(SearchHeading.source_kind == k, SearchHeading.source_id.in_(sub))
        for k, sub in vis.items()
        if k in ("file", "sop", "document", "template")
    ]
    if not allowed:
        return []
    rows = (
        await db.execute(
            select(
                SearchHeading.text,
                SearchHeading.source_kind,
                SearchHeading.source_id,
                SearchHeading.page,
            )
            .where(or_(*allowed), SearchHeading.text.ilike(like(q)))
            .order_by(func.length(SearchHeading.text))
            .limit(n * 3)
        )
    ).all()
    out: list[Suggestion] = []
    for line, kind, sid, page in rows:
        out.append(Suggestion(line, "heading", kind, sid, _url(kind, sid, page), page))
    return out


def _complete(q: str, v: vocab.Vocab | None, n: int) -> list[Suggestion]:
    if v is None:
        return []
    head, _, last = q.rpartition(" ")
    lead = head + " " if head else ""
    if any(ch.isdigit() for ch in last) or last.endswith(("-", "/")):
        return [Suggestion(lead + c, "term") for c in v.complete_code(last, n)]
    toks = tx.tokens(last)
    if len(toks) != 1 or toks[0].end != len(last) or toks[0].number:
        return []
    w = toks[0].text
    lead += last[: toks[0].start]
    words = v.complete(w, n)
    if not words and len(w) >= 4 and not v.has_prefix(w):
        words = v.close(w, min(n, 2))
    return [Suggestion(lead + t, "term") for t in words]


async def suggest(
    db: AsyncSession, viewer: Viewer, q: str, branch_id: str | None = None
) -> list[Suggestion]:
    typing_word = not (q or "").endswith((" ", '"'))
    q = " ".join((q or "").split())[:120]
    recent: list[Suggestion] = []
    if viewer.user_id:
        low = q.strip().casefold()
        for r in await vocab.recent_searches(viewer.workspace_id, viewer.user_id):
            if not low or (low in r.casefold() and r.casefold() != low):
                recent.append(Suggestion(r, "recent"))
    if not q.strip():
        await vocab.get(viewer, wait=0)  # start the vocabulary while they think
        return recent[:6]
    v = await vocab.get(viewer)
    vis = visible(viewer, Filters(branch_id=branch_id))
    trgm = await has_trgm(db)
    groups = {
        "recent": recent,
        "term": _complete(q, v, 4) if typing_word else [],
        "title": await _titles(db, vis, q.strip(), trgm, 6),
        "heading": await _headings(db, vis, q.strip(), 5),
    }
    out: list[Suggestion] = []
    seen: set[str] = {q.strip().casefold()}
    rest: list[Suggestion] = []
    for kind, items in groups.items():
        taken = 0
        for s in items:
            key = s.text.casefold()
            if key in seen:
                continue
            if taken < QUOTA[kind]:
                seen.add(key)
                out.append(s)
                taken += 1
            else:
                rest.append(s)
    for s in rest:
        if len(out) >= MAX:
            break
        if s.text.casefold() not in seen:
            seen.add(s.text.casefold())
            out.append(s)
    order = {"recent": 0, "term": 1, "title": 2, "heading": 3}
    out.sort(key=lambda s: order[s.kind])
    out = out[:MAX]
    files = {s.id for s in out if s.type == "file" and s.id}
    if files:
        where = dict(
            (
                await db.execute(select(DocFile.id, DocFile.branch_id).where(DocFile.id.in_(files)))
            ).all()
        )
        for s in out:
            if s.type == "file" and s.id:
                s.branch_id = where.get(s.id)
    return out
