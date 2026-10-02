"""Database and Valkey helpers shared by the gateway, the tester and the API."""

import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.db import SessionLocal
from ..core.valkey import valkey
from ..models import AIModel, AIProvider, LLMCall, ModelGroup
from .client import Usage

log = logging.getLogger("agentic.engine")

DEFAULT_GROUPS: tuple[tuple[str, str, str], ...] = (
    ("smart", "Smart", "Best quality for reasoning, writing and decisions."),
    ("fast", "Fast", "Quick, cheap answers: routing, classification, short replies."),
    (
        "bulk",
        "Bulk",
        "Background work at volume: summaries, extraction, nightly jobs. Free tiers first.",
    ),
    ("reasoning", "Reasoning", "Thinking models for hard multi-step problems."),
    ("vision", "Vision", "Models that read images and scanned documents."),
    ("embed", "Embeddings", "Turns text into vectors for search and memory."),
)


def provider_key(p: AIProvider) -> str:
    if not p.api_key_enc:
        return ""
    try:
        return crypto.decrypt(p.api_key_enc, p.aad)
    except crypto.DecryptError:
        log.warning("cannot decrypt key for provider %s; re-enter it in AI Engine", p.id)
        return ""


def set_provider_key(p: AIProvider, key: str) -> None:
    p.api_key_enc = crypto.encrypt(key, p.aad)
    p.key_hint = crypto.hint(key)
    p.key_version = 1


async def ensure_default_groups(db: AsyncSession, workspace_id: str) -> list[ModelGroup]:
    rows = list(
        (
            await db.scalars(
                select(ModelGroup)
                .where(ModelGroup.workspace_id == workspace_id)
                .order_by(ModelGroup.position)
            )
        ).all()
    )
    have = {g.name for g in rows}
    added = False
    for i, (name, label, desc) in enumerate(DEFAULT_GROUPS):
        if name not in have:
            g = ModelGroup(
                workspace_id=workspace_id,
                name=name,
                label=label,
                description=desc,
                members=[],
                position=i,
            )
            db.add(g)
            rows.append(g)
            added = True
    if added:
        await db.commit()
        rows.sort(key=lambda g: g.position)
    return rows


def cost_usd(model: AIModel | None, usage: Usage, tier: str) -> Decimal | None:
    """None means unpriced (shown as such), never silently zero, except free tiers."""
    if model is None or model.price_in is None or model.price_out is None:
        return Decimal(0) if tier in ("free", "local") else None
    cached = min(usage.cached, usage.prompt)
    cached_price = model.price_cached_in if model.price_cached_in is not None else model.price_in
    total = (
        Decimal(usage.prompt - cached) * Decimal(model.price_in)
        + Decimal(cached) * Decimal(cached_price)
        + Decimal(usage.completion) * Decimal(model.price_out)
    ) / Decimal(1_000_000)
    return total.quantize(Decimal("0.000001"))


async def model_row(db: AsyncSession, provider_id: str, model_id: str) -> AIModel | None:
    return await db.scalar(
        select(AIModel).where(AIModel.provider_id == provider_id, AIModel.model_id == model_id)
    )


async def record_call(
    *,
    workspace_id: str,
    task: str,
    provider_id: str | None,
    provider_name: str,
    model: str,
    usage: Usage,
    latency_ms: int,
    ok: bool,
    error_class: str | None = None,
    group: str | None = None,
    cost: Decimal | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> None:
    """Own session, so a failed call is still logged even if the caller rolls back."""
    try:
        async with SessionLocal() as db:
            db.add(
                LLMCall(
                    workspace_id=workspace_id,
                    ts=datetime.now(UTC),
                    task=task,
                    group_name=group,
                    provider_id=provider_id,
                    provider_name=provider_name,
                    model=model,
                    agent_id=agent_id,
                    task_id=task_id,
                    prompt_tokens=usage.prompt,
                    completion_tokens=usage.completion,
                    cached_tokens=usage.cached,
                    reasoning_tokens=usage.reasoning,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    status="ok" if ok else "error",
                    error_class=error_class,
                )
            )
            await db.commit()
    except Exception:  # noqa: BLE001 - logging must never break a model call
        log.warning("could not record llm call", exc_info=True)


# ---- cooldowns and learned behaviour (Valkey, all keys expire)


async def cooling_for(provider_id: str) -> int:
    ttl = await valkey().ttl(f"ai_cooldown:{provider_id}")
    return max(int(ttl), 0)


async def cool(provider_id: str, seconds: int) -> None:
    if seconds > 0:
        await valkey().set(f"ai_cooldown:{provider_id}", "1", ex=seconds)


async def clear_cooldown(provider_id: str) -> None:
    await valkey().delete(f"ai_cooldown:{provider_id}")


async def is_reasoning(provider_id: str, model: str) -> bool:
    return bool(await valkey().exists(f"ai_reasoning:{provider_id}:{model}"))


async def quirks(provider_id: str, model: str) -> frozenset[str]:
    found = await valkey().smembers(f"ai_quirks:{provider_id}:{model}") or set()
    return frozenset(x.decode() if isinstance(x, bytes) else str(x) for x in found)


async def remember_quirks(provider_id: str, model: str, found: frozenset[str]) -> None:
    if found:
        key = f"ai_quirks:{provider_id}:{model}"
        await valkey().sadd(key, *found)
        await valkey().expire(key, 30 * 86400)


async def remember_reasoning(provider_id: str, model: str) -> None:
    await valkey().set(f"ai_reasoning:{provider_id}:{model}", "1", ex=7 * 86400)


async def upsert_models(
    db: AsyncSession, provider: AIProvider, models: list[dict[str, Any]]
) -> tuple[int, int]:
    """Merge a fresh /models listing. Returns (added, now_stale)."""
    now = datetime.now(UTC)
    existing = {
        m.model_id: m
        for m in (await db.scalars(select(AIModel).where(AIModel.provider_id == provider.id))).all()
    }
    seen, added = set(), 0
    for m in models:
        seen.add(m["id"])
        row = existing.get(m["id"])
        if row is None:
            caps: dict[str, Any] = {}
            if "embed" in m["id"].lower():
                caps["embed"] = True
            db.add(
                AIModel(
                    workspace_id=provider.workspace_id,
                    provider_id=provider.id,
                    model_id=m["id"],
                    context_window=m.get("context_window"),
                    caps=caps,
                    last_seen_at=now,
                )
            )
            added += 1
        else:
            row.stale = False
            row.last_seen_at = now
            if m.get("context_window"):
                row.context_window = m["context_window"]
    stale = 0
    for mid, row in existing.items():
        if mid not in seen and not row.stale:
            row.stale = True
            stale += 1
    return added, stale
