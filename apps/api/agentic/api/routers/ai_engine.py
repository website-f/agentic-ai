"""AI Engine: provider keys, connection tests, models, groups, playground, usage."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import SessionLocal, get_db
from ...core.ssrf import BlockedURL, guard_url
from ...core.workspace_settings import HARD_MAX_TASK_MODEL_CALLS, max_task_model_calls
from ...engine import cache_health, client, gateway, media, store, tester
from ...engine.presets import BY_ID, PRESETS, PRIMARY
from ...models import Agent, AIModel, AIProvider, LLMCall, ModelGroup, ProviderCheck, Workspace
from ...services import audit
from ..ai_schemas import (
    AISettingsOut,
    AISettingsUpdateIn,
    CheckOut,
    DiscoverIn,
    GroupMember,
    GroupOut,
    GroupUpdateIn,
    ModelOut,
    ModelUpdateIn,
    OrderIn,
    PlaygroundIn,
    PlaygroundOut,
    PresetOut,
    ProviderCreateIn,
    ProviderOut,
    ProviderUpdateIn,
    TestIn,
)
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/ai", tags=["ai-engine"])


# ------------------------------------------------------------------ helpers


async def _workspace(db: AsyncSession, workspace_id: str) -> Workspace:
    ws = await db.get(Workspace, workspace_id)
    if ws is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "workspace_not_found", "That workspace is not here."
        )
    return ws


async def _provider(db: AsyncSession, workspace_id: str, provider_id: str) -> AIProvider:
    p = await db.get(AIProvider, provider_id)
    if p is None or p.workspace_id != workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "provider_not_found", "That provider is not here."
        )
    return p


async def _provider_out(db: AsyncSession, p: AIProvider) -> ProviderOut:
    model_count = (
        await db.scalar(
            select(func.count())
            .select_from(AIModel)
            .where(AIModel.provider_id == p.id, AIModel.stale.is_(False))
        )
        or 0
    )
    checks = (
        await db.scalars(
            select(ProviderCheck)
            .where(ProviderCheck.provider_id == p.id)
            .order_by(ProviderCheck.ts.desc())
            .limit(24)
        )
    ).all()
    return ProviderOut(
        id=p.id,
        name=p.name,
        preset=p.preset,
        base_url=p.base_url,
        key_hint=p.key_hint,
        has_key=bool(p.api_key_enc),
        tier=p.tier,  # type: ignore[arg-type]
        priority=p.priority,
        enabled=p.enabled,
        health=p.health,
        cooling_seconds=await store.cooling_for(p.id),
        last_test_at=p.last_test_at,
        last_test_result=p.last_test_result,
        model_count=model_count,
        recent_checks=[
            CheckOut(ts=c.ts, ok=c.ok, latency_ms=c.latency_ms) for c in reversed(checks)
        ],
    )


async def _guard(url: str) -> None:
    try:
        await guard_url(url)
    except BlockedURL as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "blocked_url", str(e)) from e


def _f(v) -> float | None:
    return float(v) if v is not None else None


def _model_out(m: AIModel) -> ModelOut:
    return ModelOut(
        id=m.id,
        provider_id=m.provider_id,
        model_id=m.model_id,
        context_window=m.context_window,
        caps=m.caps or {},
        price_in=_f(m.price_in),
        price_out=_f(m.price_out),
        price_cached_in=_f(m.price_cached_in),
        stale=m.stale,
    )


# ------------------------------------------------------------------ presets + providers


@router.get("/settings")
async def get_ai_settings(
    principal: Principal = Depends(require("org.read")), db: AsyncSession = Depends(get_db)
) -> AISettingsOut:
    ws = await _workspace(db, principal.workspace_id)
    return AISettingsOut(
        max_task_model_calls=max_task_model_calls(ws.settings),
        hard_max_task_model_calls=HARD_MAX_TASK_MODEL_CALLS,
    )


@router.patch("/settings")
async def update_ai_settings(
    body: AISettingsUpdateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> AISettingsOut:
    ws = await _workspace(db, principal.workspace_id)
    before = max_task_model_calls(ws.settings)
    ws.settings = {**(ws.settings or {}), "max_task_model_calls": body.max_task_model_calls}
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "ai.settings_updated",
        target=ws.id,
        before={"max_task_model_calls": before},
        after={"max_task_model_calls": body.max_task_model_calls},
    )
    await db.commit()
    return AISettingsOut(
        max_task_model_calls=body.max_task_model_calls,
        hard_max_task_model_calls=HARD_MAX_TASK_MODEL_CALLS,
    )


@router.get("/presets")
async def presets(_: Principal = Depends(require("org.read"))) -> list[PresetOut]:
    return [PresetOut(**p.public(), primary=p.id in PRIMARY) for p in PRESETS]


@router.get("/providers")
async def list_providers(
    principal: Principal = Depends(require("org.read")), db: AsyncSession = Depends(get_db)
) -> list[ProviderOut]:
    rows = (
        await db.scalars(
            select(AIProvider)
            .where(AIProvider.workspace_id == principal.workspace_id)
            .order_by(AIProvider.priority, AIProvider.created_at)
        )
    ).all()
    return [await _provider_out(db, p) for p in rows]


@router.post("/providers", status_code=status.HTTP_201_CREATED)
async def create_provider(
    body: ProviderCreateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> ProviderOut:
    await _guard(body.base_url)
    preset = BY_ID.get(body.preset or "")
    next_priority = (
        await db.scalar(
            select(func.max(AIProvider.priority)).where(
                AIProvider.workspace_id == principal.workspace_id
            )
        )
        or 0
    ) + 10
    p = AIProvider(
        workspace_id=principal.workspace_id,
        name=body.name.strip(),
        preset=preset.id if preset else None,
        base_url=body.base_url,
        tier=body.tier,
        enabled=body.enabled,
        priority=next_priority,
    )
    db.add(p)
    await db.flush()  # assigns the id the key is bound to
    store.set_provider_key(p, body.api_key.strip())
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "ai.provider_added",
        target=p.id,
        after={"name": p.name, "base_url": p.base_url, "key": p.key_hint},
    )
    try:
        await db.commit()
    except IntegrityError as e:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "provider_exists",
            f"A provider called {body.name} already exists.",
        ) from e
    await db.refresh(p)
    # Groq / OpenAI bring speech and picture models: fill those groups while still empty.
    await media.fill_after_new_provider(db, p)
    return await _provider_out(db, p)


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    body: ProviderUpdateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> ProviderOut:
    p = await _provider(db, principal.workspace_id, provider_id)
    before = {
        "name": p.name,
        "base_url": p.base_url,
        "tier": p.tier,
        "enabled": p.enabled,
        "key": p.key_hint,
    }
    new_key = (body.api_key or "").strip()
    if body.base_url and body.base_url != p.base_url:
        # A saved key must never follow a new URL it was not typed for (key exfiltration).
        if not new_key:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "key_required_for_new_url",
                "Changing the address needs the key typed again.",
            )
        await _guard(body.base_url)
        p.base_url = body.base_url
    if new_key:
        if len(new_key) < 8:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "key_too_short", "That key looks too short."
            )
        store.set_provider_key(p, new_key)
        p.health = "unknown"
        await store.clear_cooldown(p.id)
    if body.name is not None:
        p.name = body.name.strip()
    if body.tier is not None:
        p.tier = body.tier
    if body.enabled is not None:
        p.enabled = body.enabled
    after = {
        "name": p.name,
        "base_url": p.base_url,
        "tier": p.tier,
        "enabled": p.enabled,
        "key": p.key_hint,
    }
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "ai.provider_updated",
        target=p.id,
        before=before,
        after=after,
    )
    await db.commit()
    await db.refresh(p)
    return await _provider_out(db, p)


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: str,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    p = await _provider(db, principal.workspace_id, provider_id)
    name = p.name
    # Drop it from every group so routing never points at a missing provider.
    for g in (
        await db.scalars(
            select(ModelGroup).where(ModelGroup.workspace_id == principal.workspace_id)
        )
    ).all():
        kept = [m for m in g.members if m["provider_id"] != provider_id]
        if len(kept) != len(g.members):
            g.members = kept
    await db.delete(p)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "ai.provider_removed",
        target=provider_id,
        before={"name": name},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/providers/order")
async def reorder_providers(
    body: OrderIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> list[ProviderOut]:
    rows = {
        p.id: p
        for p in (
            await db.scalars(
                select(AIProvider).where(AIProvider.workspace_id == principal.workspace_id)
            )
        ).all()
    }
    for i, pid in enumerate(body.ids):
        if pid in rows:
            rows[pid].priority = (i + 1) * 10
    await db.commit()
    return await list_providers(principal, db)


# ------------------------------------------------------------------ test + discover


class _Spec(NamedTuple):
    base_url: str
    key: str
    preset: str | None
    name: str
    tier: str


@router.post("/providers/test")
async def test_provider(body: TestIn, principal: Principal = Depends(require("engine.manage"))):
    """Streams one JSON object per line (NDJSON) as each step finishes."""
    if body.provider_id:
        async with SessionLocal() as db:
            p = await _provider(db, principal.workspace_id, body.provider_id)
            key = store.provider_key(p)
            if not key:
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "no_key",
                    "No usable key is saved. Enter the key again.",
                )
            # Stored key: always the stored URL, never one from the request.
            spec = _Spec(p.base_url, key, p.preset, p.name, p.tier)
    else:
        if not body.base_url or not body.api_key:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "missing_fields",
                "Enter the address and the key to test.",
            )
        await _guard(body.base_url)
        preset = BY_ID.get(body.preset or "")
        spec = _Spec(
            body.base_url,
            body.api_key.strip(),
            body.preset,
            body.name or (preset.name if preset else "Custom"),
            body.tier,
        )

    async def events() -> AsyncIterator[str]:
        async with SessionLocal() as db:
            provider = (await db.get(AIProvider, body.provider_id)) if body.provider_id else None
            target = tester.Target(
                workspace_id=principal.workspace_id,
                provider=provider,
                model=body.model,
                capabilities=body.capabilities,
                base_url=spec.base_url,
                key=spec.key,
                preset=spec.preset,
                name=spec.name,
                tier=spec.tier,
            )
            async for event in tester.run(target, db if provider else None):
                yield json.dumps(event, default=str) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
    )


@router.post("/providers/discover")
async def discover_models(
    body: DiscoverIn, _: Principal = Depends(require("engine.manage"))
) -> dict:
    """Model list for a key that is not saved yet, so the dialog can offer a test model."""
    await _guard(body.base_url)
    res, models = await client.list_models(body.base_url, body.api_key.strip())
    if not res.ok and res.failure:
        return {
            "ok": False,
            "error_class": res.failure.error_class,
            "message": res.failure.message,
            "models": [],
        }
    return {"ok": True, "models": [m["id"] for m in models]}


@router.post("/providers/{provider_id}/models/refresh")
async def refresh_models(
    provider_id: str,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    p = await _provider(db, principal.workspace_id, provider_id)
    key = store.provider_key(p)
    if not key:
        raise api_error(status.HTTP_400_BAD_REQUEST, "no_key", "Save a key first.")
    res, models = await client.list_models(p.base_url, key)
    if not res.ok and res.failure:
        raise api_error(status.HTTP_502_BAD_GATEWAY, res.failure.error_class, res.failure.message)
    added, stale = await store.upsert_models(db, p, models)
    await db.commit()
    return {"total": len(models), "added": added, "stale": stale}


# ------------------------------------------------------------------ models


@router.get("/models")
async def list_models(
    provider_id: str | None = None,
    capability: str | None = None,
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> list[ModelOut]:
    q = select(AIModel).where(AIModel.workspace_id == principal.workspace_id)
    if provider_id:
        q = q.where(AIModel.provider_id == provider_id)
    rows = (await db.scalars(q.order_by(AIModel.stale, AIModel.model_id))).all()
    out = [_model_out(m) for m in rows]
    if capability:
        out = [m for m in out if m.caps.get(capability)]
    return out


@router.patch("/models/{model_id}")
async def update_model(
    model_id: str,
    body: ModelUpdateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> ModelOut:
    m = await db.get(AIModel, model_id)
    if m is None or m.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "model_not_found", "That model is not here.")
    fields = body.model_fields_set
    if "price_in" in fields:
        m.price_in = body.price_in
    if "price_out" in fields:
        m.price_out = body.price_out
    if "price_cached_in" in fields:
        m.price_cached_in = body.price_cached_in
    if body.caps is not None:
        m.caps = {**(m.caps or {}), **body.caps}
    await db.commit()
    await db.refresh(m)
    return _model_out(m)


# ------------------------------------------------------------------ groups


def _group_kind(name: str) -> str:
    return name if name in media.NOT_CHAT else "chat"


@router.get("/groups")
async def list_groups(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[GroupOut]:
    rows = await store.ensure_default_groups(db, principal.workspace_id)
    return [
        GroupOut(
            name=g.name,
            label=g.label,
            description=g.description,
            members=[GroupMember(**m) for m in g.members],
            kind=_group_kind(g.name),
        )
        for g in rows
    ]  # type: ignore[arg-type]


@router.put("/groups/{name}")
async def update_group(
    name: str,
    body: GroupUpdateIn,
    principal: Principal = Depends(require("engine.manage")),
    db: AsyncSession = Depends(get_db),
) -> GroupOut:
    await store.ensure_default_groups(db, principal.workspace_id)
    g = await db.scalar(
        select(ModelGroup).where(
            ModelGroup.workspace_id == principal.workspace_id, ModelGroup.name == name
        )
    )
    if g is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "group_not_found", "That group is not here.")
    owned = set(
        (
            await db.scalars(
                select(AIProvider.id).where(AIProvider.workspace_id == principal.workspace_id)
            )
        ).all()
    )
    members, seen = [], set()
    for m in body.members:
        if m.provider_id not in owned:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "unknown_provider",
                "One of the models belongs to a provider that is not here.",
            )
        k = (m.provider_id, m.model_id)
        if k not in seen:
            seen.add(k)
            members.append(m.model_dump())
    before = {"members": len(g.members)}
    g.members = members
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "ai.group_updated",
        target=g.name,
        before=before,
        after={"members": len(members)},
    )
    await db.commit()
    return GroupOut(
        name=g.name,
        label=g.label,
        description=g.description,
        members=[GroupMember(**m) for m in g.members],
        kind=_group_kind(g.name),
    )


# ------------------------------------------------------------------ playground


@router.post("/playground")
async def playground(
    body: PlaygroundIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> PlaygroundOut:
    messages = ([{"role": "system", "content": body.system}] if body.system else []) + [
        {"role": "user", "content": body.prompt}
    ]
    try:
        r = await gateway.chat(
            db,
            principal.workspace_id,
            body.group,
            messages,
            task="playground",
            max_tokens=body.max_tokens,
        )
    except gateway.GatewayUnavailable as e:
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,  # type: ignore[return-value]
            content={"code": "no_model_available", "message": str(e), "attempts": e.attempts},
        )
    return PlaygroundOut(
        content=r.content,
        provider_name=r.provider_name,
        model=r.model,
        latency_ms=r.latency_ms,
        prompt_tokens=r.usage.prompt,
        completion_tokens=r.usage.completion,
        cached_tokens=r.usage.cached,
        cost_usd=r.cost_usd,
        attempts=r.attempts,
    )


# ------------------------------------------------------------------ usage


@router.get("/usage")
async def usage(
    days: int = Query(default=7, ge=1, le=90),
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    base = (LLMCall.workspace_id == principal.workspace_id, LLMCall.ts >= since)
    tokens = LLMCall.prompt_tokens + LLMCall.completion_tokens
    errors = func.sum(case((LLMCall.status == "error", 1), else_=0))

    def agg(*cols):
        return select(
            *cols,
            func.count().label("calls"),
            func.coalesce(func.sum(LLMCall.prompt_tokens), 0).label("prompt"),
            func.coalesce(func.sum(LLMCall.completion_tokens), 0).label("completion"),
            func.coalesce(func.sum(LLMCall.cached_tokens), 0).label("cached"),
            func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
            func.coalesce(errors, 0).label("errors"),
            func.coalesce(func.avg(LLMCall.latency_ms), 0).label("avg_latency"),
            func.sum(
                case((LLMCall.cost_usd.is_(None) & (LLMCall.status == "ok"), 1), else_=0)
            ).label("unpriced"),
        ).where(*base)

    def rows(q):
        return [
            {
                **{k: v for k, v in r._mapping.items() if k not in ("cost", "avg_latency")},
                "cost": float(r.cost or 0),
                "avg_latency": int(r.avg_latency or 0),
            }
            for r in q
        ]

    totals = rows(await db.execute(agg()))[0]
    by_provider = rows(
        await db.execute(
            agg(LLMCall.provider_name.label("provider"))
            .group_by(LLMCall.provider_name)
            .order_by(func.count().desc())
        )
    )
    by_model = rows(
        await db.execute(
            agg(LLMCall.provider_name.label("provider"), LLMCall.model.label("model"))
            .group_by(LLMCall.provider_name, LLMCall.model)
            .order_by(func.count().desc())
            .limit(20)
        )
    )
    by_task = rows(
        await db.execute(
            agg(LLMCall.task.label("task")).group_by(LLMCall.task).order_by(func.count().desc())
        )
    )
    day = func.date_trunc("day", LLMCall.ts).label("day")
    daily = [
        {
            "day": r.day.date().isoformat(),
            "provider": r.provider,
            "tokens": int(r.tokens or 0),
            "cost": float(r.cost or 0),
            "calls": int(r.calls),
        }
        for r in await db.execute(
            select(
                day,
                LLMCall.provider_name.label("provider"),
                func.sum(tokens).label("tokens"),
                func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
                func.count().label("calls"),
            )
            .where(*base)
            .group_by(day, LLMCall.provider_name)
            .order_by(day)
        )
    ]
    return {
        "days": days,
        "totals": totals,
        "by_provider": by_provider,
        "by_model": by_model,
        "by_task": by_task,
        "daily": daily,
    }


@router.get("/cache-health")
async def cache_health_report(
    days: int = Query(default=7, ge=1, le=90),
    principal: Principal = Depends(require("org.read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Prompt-cache drift per agent and job kind (P21): how often the system message + tool
    list changed between calls of the same run, and how much of the prompt the provider served
    from its cache. See engine/cache_health.py."""
    since = datetime.now(UTC) - timedelta(days=days)
    q = (
        select(
            LLMCall.ts,
            LLMCall.agent_id,
            LLMCall.task,
            LLMCall.task_id,
            LLMCall.prefix_hash,
            LLMCall.prompt_tokens,
            LLMCall.cached_tokens,
        )
        .where(
            LLMCall.workspace_id == principal.workspace_id,
            LLMCall.ts >= since,
            LLMCall.status == "ok",
            LLMCall.prefix_hash.is_not(None),
        )
        .order_by(LLMCall.ts, LLMCall.id)
        .limit(100_000)
    )
    calls = [
        cache_health.Call(
            ts=r.ts,
            agent_id=r.agent_id,
            task=r.task,
            task_id=r.task_id,
            prefix_hash=r.prefix_hash,
            prompt_tokens=int(r.prompt_tokens or 0),
            cached_tokens=int(r.cached_tokens or 0),
        )
        for r in await db.execute(q)
    ]
    ids = {c.agent_id for c in calls if c.agent_id}
    names = (
        {
            a.id: a.name
            for a in (
                await db.execute(
                    select(Agent.id, Agent.name).where(
                        Agent.id.in_(ids), Agent.workspace_id == principal.workspace_id
                    )
                )
            )
        }
        if ids
        else {}
    )
    groups = cache_health.report(calls, names)
    prompt = sum(c.prompt_tokens for c in calls)
    cached = sum(c.cached_tokens for c in calls)
    return {
        "days": days,
        "calls": len(calls),
        "cached_share": round(cached / prompt, 3) if prompt else None,
        "flagged": sum(1 for g in groups if g["flags"]),
        "groups": groups,
    }
