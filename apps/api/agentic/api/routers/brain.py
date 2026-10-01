"""The Brain: wiki pages, facts, search, the dream diary, the vault, and agent core memory."""

import asyncio
import time
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...brain import core as core_memory
from ...brain import dream as brain_dream
from ...brain import embed, store, vault
from ...brain import facts as brain_facts
from ...brain.pages import GENERATED, PathError, normalize_path
from ...brain.scope import for_agent, for_people
from ...brain.search import Hit, search_facts, search_history, search_pages
from ...core.config import settings
from ...core.db import get_db
from ...models import (
    Agent,
    BrainDream,
    BrainFact,
    BrainLink,
    BrainPage,
    Branch,
    User,
    Workspace,
)
from ...skills import store as skills_store
from ..deps import Principal, api_error, require
from .agents import get_agent

router = APIRouter(prefix="/api", tags=["brain"])

PROTECTED = {"AGENTS.md", "log.md", "index.md"}


# ---------------------------------------------------------------- schemas


class HitOut(BaseModel):
    kind: str
    id: str
    title: str
    snippet: str
    score: float
    via: list[str]
    path: str | None
    when: datetime | None
    meta: dict[str, Any]


class PageSummary(BaseModel):
    path: str
    title: str
    kind: str
    branch_id: str | None
    updated_at: datetime
    updated_by: str
    updated_by_name: str
    chars: int


class LinkOut(BaseModel):
    name: str
    path: str | None
    title: str | None


class PageOut(PageSummary):
    body: str
    frontmatter: dict[str, Any]
    links: list[LinkOut]
    backlinks: list[LinkOut]
    history: list[dict[str, Any]]


class PageIn(BaseModel):
    path: str = Field(min_length=1, max_length=400)
    body: str = Field(max_length=200_000)
    message: str | None = Field(default=None, max_length=200)


class FactOut(BaseModel):
    id: str
    text: str
    branch_id: str | None
    branch_name: str | None
    agent_id: str | None
    agent_name: str | None
    source_kind: str
    source_id: str | None
    source_label: str | None
    created_by: str
    created_by_name: str
    confidence: float
    hits: int
    last_used_at: datetime | None
    valid_from: datetime
    valid_to: datetime | None
    end_reason: str | None
    superseded_by: str | None


class FactIn(BaseModel):
    text: str = Field(min_length=3, max_length=300)
    branch_id: str | None = None
    agent_id: str | None = None


class FactUpdateIn(BaseModel):
    text: str = Field(min_length=3, max_length=300)


class DreamOut(BaseModel):
    id: str
    day: str
    status: str
    stats: dict[str, Any]
    changes: list[dict[str, Any]]
    diary_path: str | None
    diary: str | None = None
    error: str | None
    started_at: datetime
    finished_at: datetime | None


class CoreMemoryOut(BaseModel):
    memory: list[str]
    user: list[str]
    caps: dict[str, int]
    used: dict[str, int]
    snapshot: str


class CoreMemoryIn(BaseModel):
    memory: list[str] = Field(default_factory=list, max_length=200)
    user: list[str] = Field(default_factory=list, max_length=200)


# ---------------------------------------------------------------- helpers


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return ws


def _author(principal: Principal) -> store.Author:
    return store.Author(principal.actor, principal.user.name)


async def _names(db: AsyncSession, actors: set[str]) -> dict[str, str]:
    """user:<id> / agent:<id> -> display name."""
    users = {a.removeprefix("user:") for a in actors if a.startswith("user:")}
    agents = {a.removeprefix("agent:") for a in actors if a.startswith("agent:")}
    out = {a: "Agentic Office" for a in actors if a == "system"}
    if users:
        for uid, name in (
            await db.execute(select(User.id, User.name).where(User.id.in_(users)))
        ).all():
            out[f"user:{uid}"] = name
    if agents:
        for aid, name in (
            await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agents)))
        ).all():
            out[f"agent:{aid}"] = name
    return out


def _hit(h: Hit) -> HitOut:
    return HitOut(**h.__dict__)


def _summary(p: BrainPage, names: dict[str, str]) -> dict[str, Any]:
    return {
        "path": p.path,
        "title": p.title,
        "kind": p.kind,
        "branch_id": p.branch_id,
        "updated_at": p.updated_at,
        "updated_by": p.updated_by,
        "updated_by_name": names.get(
            p.updated_by, "Vault" if p.updated_by == "system" else "Unknown"
        ),
        "chars": len(p.body),
    }


async def _facts_out(db: AsyncSession, rows: list[BrainFact]) -> list[FactOut]:
    agent_ids = {f.agent_id for f in rows if f.agent_id}
    branch_ids = {f.branch_id for f in rows if f.branch_id}
    agents = (
        dict((await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids)))).all())
        if agent_ids
        else {}
    )
    branches = (
        dict(
            (
                await db.execute(select(Branch.id, Branch.name).where(Branch.id.in_(branch_ids)))
            ).all()
        )
        if branch_ids
        else {}
    )
    names = await _names(db, {f.created_by for f in rows})
    return [
        FactOut(
            id=f.id,
            text=f.text,
            branch_id=f.branch_id,
            branch_name=branches.get(f.branch_id) if f.branch_id else None,
            agent_id=f.agent_id,
            agent_name=agents.get(f.agent_id) if f.agent_id else None,
            source_kind=f.source_kind,
            source_id=f.source_id,
            source_label=f.source_label,
            created_by=f.created_by,
            created_by_name=names.get(f.created_by, "Unknown"),
            confidence=round(f.confidence, 2),
            hits=f.hits,
            last_used_at=f.last_used_at,
            valid_from=f.valid_from,
            valid_to=f.valid_to,
            end_reason=f.end_reason,
            superseded_by=f.superseded_by,
        )
        for f in rows
    ]


async def _fact(db: AsyncSession, principal: Principal, fact_id: str) -> BrainFact:
    f = await db.get(BrainFact, fact_id)
    if f is None or f.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "fact_not_found", "That fact is not here.")
    return f


async def _check_scope(
    db: AsyncSession, principal: Principal, branch_id: str | None, agent_id: str | None
) -> None:
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "branch_not_found", "That company is not here."
            )
    if agent_id:
        await get_agent(db, principal.workspace_id, agent_id)


def _dream_out(d: BrainDream, diary: str | None = None) -> DreamOut:
    return DreamOut(
        id=d.id,
        day=d.day.isoformat(),
        status=d.status,
        stats=d.stats,
        changes=d.changes,
        diary_path=d.diary_path,
        diary=diary,
        error=d.error,
        started_at=d.started_at,
        finished_at=d.finished_at,
    )


# ---------------------------------------------------------------- overview and pages


@router.get("/brain/overview")
async def overview(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    await store.ensure_vault(db, ws)
    pages = await db.scalar(
        select(func.count()).select_from(BrainPage).where(BrainPage.workspace_id == ws.id)
    )
    active = await db.scalar(
        select(func.count())
        .select_from(BrainFact)
        .where(BrainFact.workspace_id == ws.id, BrainFact.valid_to.is_(None))
    )
    links = await db.scalar(
        select(func.count()).select_from(BrainLink).where(BrainLink.workspace_id == ws.id)
    )
    last = await db.scalar(
        select(BrainDream)
        .where(BrainDream.workspace_id == ws.id)
        .order_by(BrainDream.started_at.desc())
        .limit(1)
    )
    return {
        "pages": pages,
        "facts": active,
        "links": links,
        "last_dream": _dream_out(last).model_dump() if last else None,
        "dream_hour": settings.dream_hour,
        "timezone": ws.timezone,
        "search": {
            "backend": settings.embed_backend,
            "model": settings.embed_model if settings.embed_backend == "local" else None,
            "vectors": await asyncio.to_thread(embed.available),
        },
        "vault": {"folder": ws.slug},
    }


@router.get("/brain/pages")
async def list_pages(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[PageSummary]:
    ws = await _ws(db, principal)
    await store.ensure_vault(db, ws)
    rows = list(
        (
            await db.scalars(
                select(BrainPage).where(BrainPage.workspace_id == ws.id).order_by(BrainPage.path)
            )
        ).all()
    )
    names = await _names(db, {p.updated_by for p in rows})
    return [PageSummary(**_summary(p, names)) for p in rows]


async def _page_out(db: AsyncSession, ws: Workspace, p: BrainPage) -> PageOut:
    await db.refresh(p)  # updated_at is set by the database on save
    out_names = list(
        (await db.scalars(select(BrainLink.dst_name).where(BrainLink.src_page_id == p.id))).all()
    )
    targets = (
        {
            name: (path, title)
            for name, path, title in (
                await db.execute(
                    select(BrainPage.name, BrainPage.path, BrainPage.title)
                    .where(BrainPage.workspace_id == ws.id, BrainPage.name.in_(out_names))
                    .order_by(BrainPage.path)
                )
            ).all()
        }
        if out_names
        else {}
    )
    back = (
        await db.execute(
            select(BrainPage.path, BrainPage.title, BrainPage.name)
            .join(BrainLink, BrainLink.src_page_id == BrainPage.id)
            .where(
                BrainLink.workspace_id == ws.id,
                BrainLink.dst_name == p.name,
                BrainPage.id != p.id,
                BrainPage.path.not_in(GENERATED),  # the index links to everything
            )
            .distinct()
            .order_by(BrainPage.path)
        )
    ).all()
    names = await _names(db, {p.updated_by})
    history = await asyncio.to_thread(vault.history, ws.slug, p.path, 15)
    return PageOut(
        **_summary(p, names),
        body=p.body,
        frontmatter=p.frontmatter,
        links=[
            LinkOut(
                name=n, path=targets.get(n, (None, None))[0], title=targets.get(n, (None, None))[1]
            )
            for n in sorted(set(out_names))
        ],
        backlinks=[LinkOut(name=n, path=path, title=title) for path, title, n in back],
        history=history,
    )


@router.get("/brain/page")
async def get_page(
    path: str = Query(min_length=1, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PageOut:
    ws = await _ws(db, principal)
    p = await db.scalar(
        select(BrainPage).where(BrainPage.workspace_id == ws.id, BrainPage.path == path)
    )
    if p is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "page_not_found", "There is no page at that path."
        )
    return await _page_out(db, ws, p)


@router.put("/brain/page")
async def put_page(
    body: PageIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> PageOut:
    ws = await _ws(db, principal)
    try:
        path = normalize_path(body.path)
        if path in GENERATED:
            raise PathError("index.md is rebuilt every night; edit the pages it lists instead.")
        if path.startswith("skills/"):
            raise PathError("Skills change through review: edit them on the Skills page.")
        p = await store.save_page(db, ws, path, body.body, _author(principal), body.message)
    except PathError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_path", str(e)) from e
    return await _page_out(db, ws, p)


@router.delete("/brain/page", status_code=status.HTTP_204_NO_CONTENT)
async def delete_page(
    path: str = Query(min_length=1, max_length=400),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if path in PROTECTED:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "protected_page",
            f"{path} is part of the vault and cannot be deleted.",
        )
    ws = await _ws(db, principal)
    if not await store.delete_page(db, ws, path, _author(principal)):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "page_not_found", "There is no page at that path."
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/brain/graph")
async def graph(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Pages and the [[links]] between them. The generated index and diaries are left out."""
    ws_id = principal.workspace_id
    pages = (
        await db.execute(
            select(
                BrainPage.id, BrainPage.path, BrainPage.title, BrainPage.kind, BrainPage.name
            ).where(
                BrainPage.workspace_id == ws_id,
                BrainPage.path.not_in(GENERATED),
                BrainPage.kind.not_in(("dream", "log", "agent", "index", "skill")),
            )
        )
    ).all()
    by_name: dict[str, str] = {}
    for pid, _, _, _, name in pages:
        by_name.setdefault(name, pid)
    ids = {pid for pid, *_ in pages}
    edges = set()
    for src, dst_name in (
        await db.execute(
            select(BrainLink.src_page_id, BrainLink.dst_name).where(BrainLink.workspace_id == ws_id)
        )
    ).all():
        dst = by_name.get(dst_name)
        if src in ids and dst and dst != src:
            edges.add((src, dst))
    degree: dict[str, int] = {}
    for s, t in edges:
        degree[s] = degree.get(s, 0) + 1
        degree[t] = degree.get(t, 0) + 1
    missing = sorted(
        {
            n
            for _, n in (
                await db.execute(
                    select(BrainLink.src_page_id, BrainLink.dst_name).where(
                        BrainLink.workspace_id == ws_id
                    )
                )
            ).all()
        }
        - set(by_name)
    )
    return {
        "nodes": [
            {"id": pid, "path": path, "title": title, "kind": kind, "degree": degree.get(pid, 0)}
            for pid, path, title, kind, _ in pages
            if degree.get(pid) or kind != "root"  # unlinked vault files are just noise
        ],
        "edges": [{"source": s, "target": t} for s, t in sorted(edges)],
        "unresolved": missing[:100],
    }


# ---------------------------------------------------------------- search


@router.get("/brain/search")
async def search(
    q: str = Query(min_length=1, max_length=300),
    history: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    v = for_people(principal.workspace_id)
    qvec = await embed.embed_one(q)
    facts = [h for _, h in await search_facts(db, v, q, qvec, limit=10)]
    pages = await search_pages(db, v, q, qvec, limit=8)
    past = await search_history(db, v, q, limit=6) if history else []
    return {
        "facts": [_hit(h) for h in facts],
        "pages": [_hit(h) for h in pages],
        "history": [_hit(h) for h in past],
        "vectors": qvec is not None,
        "took_ms": round((time.perf_counter() - t0) * 1000),
    }


# ---------------------------------------------------------------- facts


@router.get("/brain/facts")
async def list_facts(
    state: Literal["active", "ended", "all"] = "active",
    agent_id: str | None = None,
    branch_id: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    conds = [BrainFact.workspace_id == principal.workspace_id]
    if state == "active":
        conds.append(BrainFact.valid_to.is_(None))
    elif state == "ended":
        conds.append(BrainFact.valid_to.is_not(None))
    if agent_id:
        conds.append(BrainFact.agent_id == agent_id)
    if branch_id:
        conds.append(BrainFact.branch_id == branch_id)
    if q and q.strip():
        conds.append(
            or_(
                BrainFact.text.ilike(f"%{q.strip()}%"),
                BrainFact.source_label.ilike(f"%{q.strip()}%"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(BrainFact).where(*conds))
    rows = list(
        (
            await db.scalars(
                select(BrainFact)
                .where(*conds)
                .order_by(BrainFact.valid_from.desc())
                .offset(offset)
                .limit(limit)
            )
        ).all()
    )
    return {"total": total, "items": [f.model_dump() for f in await _facts_out(db, rows)]}


@router.post("/brain/facts", status_code=status.HTTP_201_CREATED)
async def add_fact(
    body: FactIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FactOut:
    await _check_scope(db, principal, body.branch_id, body.agent_id)
    text = brain_facts.clean(body.text)
    if not text:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_fact",
            "Write one short fact. Secrets (passwords, keys, card or IC numbers) are never stored.",
        )
    f, _ = await brain_facts.add(
        db,
        for_people(principal.workspace_id),
        text,
        branch_id=body.branch_id,
        agent_id=body.agent_id,
        source_kind="person",
        source_label=f"added by {principal.user.name}",
        created_by=principal.actor,
        confidence=0.95,
    )
    await db.commit()
    return (await _facts_out(db, [f]))[0]


@router.patch("/brain/facts/{fact_id}")
async def edit_fact(
    fact_id: str,
    body: FactUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FactOut:
    """Facts are never rewritten in place: the correction replaces the old one."""
    old = await _fact(db, principal, fact_id)
    if old.valid_to is not None:
        raise api_error(
            status.HTTP_409_CONFLICT, "fact_ended", "Restore this fact before editing it."
        )
    text = brain_facts.clean(body.text)
    if not text:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_fact",
            "Write one short fact, with no secrets.",
        )
    if text == old.text:
        return (await _facts_out(db, [old]))[0]
    brain_facts.end(old, "replaced")
    await db.flush()
    new, _ = await brain_facts.add(
        db,
        for_people(principal.workspace_id),
        text,
        branch_id=old.branch_id,
        agent_id=old.agent_id,
        source_kind="person",
        source_label=f"corrected by {principal.user.name}",
        created_by=principal.actor,
        confidence=0.95,
    )
    old.superseded_by = new.id
    await db.commit()
    return (await _facts_out(db, [new]))[0]


@router.post("/brain/facts/{fact_id}/forget")
async def forget_fact(
    fact_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FactOut:
    f = await _fact(db, principal, fact_id)
    if f.valid_to is None:
        brain_facts.end(f, "forgotten")
        await db.commit()
    return (await _facts_out(db, [f]))[0]


@router.post("/brain/facts/{fact_id}/restore")
async def restore_fact(
    fact_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> FactOut:
    f = await _fact(db, principal, fact_id)
    f.valid_to, f.end_reason, f.superseded_by = None, None, None
    await db.commit()
    return (await _facts_out(db, [f]))[0]


# ---------------------------------------------------------------- dreams and vault


@router.get("/brain/dreams")
async def list_dreams(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[DreamOut]:
    rows = (
        await db.scalars(
            select(BrainDream)
            .where(BrainDream.workspace_id == principal.workspace_id)
            .order_by(BrainDream.day.desc())
            .limit(60)
        )
    ).all()
    return [_dream_out(d) for d in rows]


async def _dream(db: AsyncSession, principal: Principal, dream_id: str) -> BrainDream:
    d = await db.get(BrainDream, dream_id)
    if d is None or d.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "dream_not_found", "That dream is not here.")
    return d


@router.get("/brain/dreams/{dream_id}")
async def get_dream(
    dream_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> DreamOut:
    d = await _dream(db, principal, dream_id)
    diary = None
    if d.diary_path:
        diary = await db.scalar(
            select(BrainPage.body).where(
                BrainPage.workspace_id == d.workspace_id, BrainPage.path == d.diary_path
            )
        )
    return _dream_out(d, diary)


@router.post("/brain/dreams/run", status_code=status.HTTP_202_ACCEPTED)
async def run_dream(principal: Principal = Depends(require("brain.manage"))) -> dict[str, str]:
    try:
        wid = await dispatch.start_dream(principal.workspace_id)
    except Exception as e:  # noqa: BLE001 - Temporal down: say so plainly
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "worker_unavailable",
            "The background worker is not reachable, so the dream cannot start.",
        ) from e
    return {"workflow_id": wid}


@router.post("/brain/dreams/{dream_id}/undo/{index}")
async def undo_change(
    dream_id: str,
    index: int,
    principal: Principal = Depends(require("brain.manage")),
    db: AsyncSession = Depends(get_db),
) -> DreamOut:
    d = await _dream(db, principal, dream_id)
    try:
        await brain_dream.undo(db, d, index)
    except IndexError as e:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "change_not_found", "That change is not in this dream."
        ) from e
    except ValueError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_undo", str(e)) from e
    return _dream_out(d)


@router.post("/brain/sync")
async def sync_vault(
    principal: Principal = Depends(require("brain.manage")), db: AsyncSession = Depends(get_db)
) -> dict[str, list[str]]:
    ws = await _ws(db, principal)
    report = await store.sync_from_vault(db, ws)
    # SKILL.md files edited in the vault become proposals for review, not live changes.
    report.skills = await skills_store.ingest_vault(db, ws, report.imported)  # type: ignore[attr-defined]
    return report.__dict__


@router.get("/brain/vault.zip")
async def download_vault(
    principal: Principal = Depends(require("brain.manage")), db: AsyncSession = Depends(get_db)
) -> Response:
    ws = await _ws(db, principal)
    await store.ensure_vault(db, ws)
    data = await asyncio.to_thread(vault.zip_bytes, ws.slug)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{ws.slug}-vault-{stamp}.zip"'},
    )


# ---------------------------------------------------------------- agent core memory


async def _core_out(db: AsyncSession, agent: Agent) -> CoreMemoryOut:
    mem = await core_memory.read(db, agent)
    return CoreMemoryOut(
        memory=mem["memory"],
        user=mem["user"],
        caps=core_memory.CAPS,
        used={k: core_memory.used(v) for k, v in mem.items()},
        snapshot=await core_memory.snapshot(db, agent),
    )


@router.get("/agents/{agent_id}/memory")
async def get_core_memory(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> CoreMemoryOut:
    return await _core_out(db, await get_agent(db, principal.workspace_id, agent_id))


@router.put("/agents/{agent_id}/memory")
async def put_core_memory(
    agent_id: str,
    body: CoreMemoryIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> CoreMemoryOut:
    agent = await get_agent(db, principal.workspace_id, agent_id)
    ws = await _ws(db, principal)
    try:
        for target in ("memory", "user"):
            items = getattr(body, target)
            if items != (await core_memory.read(db, agent))[target]:
                await core_memory.write(db, ws, agent, target, items, _author(principal))
    except core_memory.MemoryFull as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "memory_full", str(e)) from e
    return await _core_out(db, agent)


@router.get("/agents/{agent_id}/facts")
async def agent_facts(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[FactOut]:
    """What this agent would recall: its private facts plus what its company shares."""
    agent = await get_agent(db, principal.workspace_id, agent_id)
    v = await for_agent(db, agent)
    rows = list(
        (
            await db.scalars(
                select(BrainFact)
                .where(brain_facts.scope_filter(v))
                .order_by(BrainFact.valid_from.desc())
                .limit(200)
            )
        ).all()
    )
    return await _facts_out(db, rows)
