"""Model-group routing with fallback (ported from CrawlOps services/gateway.py, extended).

Agents name a group ("smart", "fast", ...), never a provider. The gateway walks the
group's members in order and skips providers that are disabled, keyless or cooling
down. On 401/403/429/5xx it cools the provider and moves on; a model the provider
no longer has is marked stale and skipped. Every attempt is logged to llm_calls.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AIModel, AIProvider, ModelGroup
from . import client, store
from .client import REASONING_FLOOR, Usage


class GatewayUnavailable(Exception):
    """No member of the group could answer. `attempts` says why, member by member."""

    def __init__(self, message: str, attempts: list[dict[str, Any]]):
        super().__init__(message)
        self.attempts = attempts


@dataclass
class GatewayReply:
    content: str
    provider_id: str
    provider_name: str
    model: str
    usage: Usage
    latency_ms: int
    cost_usd: float | None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    attempts: list[dict[str, Any]] = field(default_factory=list)


async def chat(
    db: AsyncSession,
    workspace_id: str,
    group: str,
    messages: list[dict[str, Any]],
    *,
    task: str,
    max_tokens: int = 800,
    temperature: float | None = 0.2,
    json_mode: bool = False,
    tools: list[dict[str, Any]] | None = None,
    accept: Callable[[str], bool] | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> GatewayReply:
    # Default groups are created lazily; a fresh workspace may not have them yet.
    await store.ensure_default_groups(db, workspace_id)
    g = await db.scalar(
        select(ModelGroup).where(ModelGroup.workspace_id == workspace_id, ModelGroup.name == group)
    )
    if g is None:
        raise GatewayUnavailable(f"There is no model group called '{group}'.", [])
    if not g.members:
        raise GatewayUnavailable(
            f"The {g.label} group has no models yet. Add some in AI Engine > Model groups.", []
        )

    provider_ids = {m["provider_id"] for m in g.members}
    providers = {
        p.id: p
        for p in (
            await db.scalars(
                select(AIProvider).where(
                    AIProvider.id.in_(provider_ids), AIProvider.workspace_id == workspace_id
                )
            )
        ).all()
    }

    attempts: list[dict[str, Any]] = []
    for member in g.members:
        p = providers.get(member["provider_id"])
        model_id = member["model_id"]
        label = f"{p.name if p else 'removed provider'} / {model_id}"
        if p is None:
            attempts.append({"member": label, "skipped": "provider was removed"})
            continue
        if not p.enabled:
            attempts.append({"member": label, "skipped": "provider is turned off"})
            continue
        key = store.provider_key(p)
        if not key:
            attempts.append({"member": label, "skipped": "no key saved"})
            continue
        if wait := await store.cooling_for(p.id):
            attempts.append({"member": label, "skipped": f"cooling down for {wait} s"})
            continue
        model_row = await store.model_row(db, p.id, model_id)
        if model_row is not None and model_row.stale:
            attempts.append({"member": label, "skipped": "model no longer offered"})
            continue

        budget = (
            max(max_tokens, REASONING_FLOOR)
            if await store.is_reasoning(p.id, model_id)
            else max_tokens
        )
        r = await client.chat(
            p.base_url,
            key,
            model_id,
            messages,
            max_tokens=budget,
            temperature=temperature,
            json_mode=json_mode,
            tools=tools,
        )
        if r.reasoning_retry:
            await store.remember_reasoning(p.id, model_id)
        usable = r.call.ok and (
            bool(r.tool_calls)
            or (bool(r.content.strip()) and (accept is None or accept(r.content)))
        )
        f = r.call.failure
        cost = store.cost_usd(model_row, r.usage, p.tier) if r.call.ok else None
        await store.record_call(
            workspace_id=workspace_id,
            task=task,
            group=group,
            provider_id=p.id,
            provider_name=p.name,
            model=r.served_model or model_id,
            usage=r.usage,
            latency_ms=r.call.latency_ms,
            ok=usable,
            error_class=f.error_class if f else (None if usable else "unusable_reply"),
            cost=cost,
            agent_id=agent_id,
            task_id=task_id,
        )
        if usable:
            attempts.append({"member": label, "ok": True, "latency_ms": r.call.latency_ms})
            return GatewayReply(
                content=r.content,
                provider_id=p.id,
                provider_name=p.name,
                model=r.served_model or model_id,
                usage=r.usage,
                latency_ms=r.call.latency_ms,
                cost_usd=float(cost) if cost is not None else None,
                tool_calls=r.tool_calls,
                attempts=attempts,
            )
        if f is not None:
            if f.error_class == "model_not_found":
                await _mark_stale(db, p, model_id)
            await store.cool(p.id, f.cool_seconds)
            attempts.append({"member": label, "failed": f.message, "error_class": f.error_class})
        else:
            attempts.append(
                {"member": label, "failed": "reply was empty or did not pass the check"}
            )

    raise GatewayUnavailable(f"No model in the {g.label} group could answer.", attempts)


async def _mark_stale(db: AsyncSession, p: AIProvider, model_id: str) -> None:
    row = await store.model_row(db, p.id, model_id)
    if row is None:
        row = AIModel(workspace_id=p.workspace_id, provider_id=p.id, model_id=model_id, caps={})
        db.add(row)
    row.stale = True
    await db.commit()
