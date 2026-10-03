"""Model-group routing with fallback (ported from CrawlOps services/gateway.py, extended).

Agents name a group ("smart", "fast", ...), never a provider. The gateway walks the
group's members in order and skips providers that are disabled, keyless or cooling
down. On 401/403/429/5xx it cools the provider and moves on; a model the provider
no longer has is marked stale and skipped. Every attempt is logged to llm_calls.
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AIModel, AIProvider, ModelGroup
from ..obs import langfuse
from . import client, store
from .client import Usage

MAX_WAIT = 60.0  # seconds a call may wait for rate limits to reset

# Background jobs that want a small JSON object, not an essay: thinking models are asked to
# think briefly (reasoning_effort "low"), which keeps the JSON inside the token budget.
BACKGROUND_TASKS = ("brain.", "skill.", "workflow.", "goal.", "overview.", "colleague.")


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
    reasoning_content: str = ""


# The only jobs the tiny local backup model may do when reached through another group.
TINY_TASKS = frozenset({"colleague.memory", "file.understand", "browser.digest"})


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
    reasoning_effort: str | None = None,
    _waited: float = 0.0,
    _skip: frozenset[tuple[str, str]] = frozenset(),
) -> GatewayReply:
    """`reasoning_effort` asks thinking models that support it to think less (or more);
    background JSON jobs (BACKGROUND_TASKS) get "low" without asking."""
    if reasoning_effort is None and json_mode and task.startswith(BACKGROUND_TASKS):
        reasoning_effort = "low"
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
    waits: list[int] = []  # seconds until a cooling or rate-limited member is usable again
    failed: set[tuple[str, str]] = set()  # failed for good: waiting will not change them
    for member in g.members:
        p = providers.get(member["provider_id"])
        model_id = member["model_id"]
        label = f"{p.name if p else 'removed provider'} / {model_id}"
        if (member["provider_id"], model_id) in _skip:
            attempts.append({"member": label, "skipped": "failed earlier in this call"})
            continue
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
            waits.append(wait)
            continue
        if p.name == store.LOCAL_PROVIDER and group != "local" and task not in TINY_TASKS:
            # The tiny backup model never writes skills, facts or judgements (P17).
            attempts.append({"member": label, "skipped": "too small for this job"})
            continue
        model_row = await store.model_row(db, p.id, model_id)
        if model_row is not None and model_row.stale:
            attempts.append({"member": label, "skipped": "model no longer offered"})
            continue

        known = await store.quirks(p.id, model_id)
        if p.tier == "local" and model_id.lower().startswith("qwen3"):
            known = known | {"no_think"}  # thinking off: measured 120 -> 3 tokens for "OK"
        thinker = "no_think" not in known and (
            client.thinks(model_id) or await store.is_reasoning(p.id, model_id)
        )
        budget = max(max_tokens, client.reasoning_floor(json_mode)) if thinker else max_tokens
        r = await client.chat(
            p.base_url,
            key,
            model_id,
            messages,
            max_tokens=budget,
            temperature=temperature,
            json_mode=json_mode,
            tools=tools,
            quirks=known,
            reasoning_effort=reasoning_effort
            if thinker and client.takes_effort(model_id)
            else None,
        )
        if r.quirks - known:
            await store.remember_quirks(p.id, model_id, r.quirks - known)
        if r.reasoning_retry:
            await store.remember_reasoning(p.id, model_id)
        # JSON cut off by the token limit cannot be parsed; another member may finish it.
        truncated = r.call.ok and json_mode and r.finish_reason == "length" and not r.tool_calls
        usable = (
            r.call.ok
            and not truncated
            and (
                bool(r.tool_calls)
                or (bool(r.content.strip()) and (accept is None or accept(r.content)))
            )
        )
        f = r.call.failure
        cost = store.cost_usd(model_row, r.usage, p.tier) if r.call.ok else None
        error_class = (
            f.error_class
            if f
            else ("truncated" if truncated else (None if usable else "unusable_reply"))
        )
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
            error_class=error_class,
            error_detail=None if usable else (client.error_detail(r.call) or _bad_reply(r)),
            cost=cost,
            agent_id=agent_id,
            task_id=task_id,
        )
        langfuse.generation(
            workspace_id=workspace_id,
            kind=task,
            group=group,
            provider=p.name,
            model=r.served_model or model_id,
            messages=messages,
            output=r.content,
            tool_calls=r.tool_calls,
            prompt_tokens=r.usage.prompt,
            completion_tokens=r.usage.completion,
            cost_usd=float(cost) if cost is not None else None,
            latency_ms=r.call.latency_ms,
            ok=usable,
            error_class=error_class,
            agent_id=agent_id,
            task_id=task_id,
            max_tokens=budget,
            temperature=temperature,
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
                reasoning_content=r.reasoning_content,
            )
        if f is not None:
            if f.error_class == "model_not_found":
                await _mark_stale(db, p, model_id)
            await store.cool(p.id, f.cool_seconds)
            if f.error_class == "rate_limited" and f.cool_seconds:
                waits.append(f.cool_seconds)
            else:
                failed.add((p.id, model_id))
            attempts.append({"member": label, "failed": f.message, "error_class": f.error_class})
        else:
            failed.add((p.id, model_id))
            attempts.append(
                {
                    "member": label,
                    "failed": "reply was cut off by the token limit"
                    if truncated
                    else "reply was empty or did not pass the check",
                    "error_class": error_class,
                }
            )

    # Some members only need a short wait (a per-minute rate limit, a brief cooldown): wait
    # for them instead of failing the work, up to MAX_WAIT in total. Members that failed for
    # good (a 400, a bad reply) used to stop this wait; now they are just not asked again.
    if waits and _waited + min(waits) <= MAX_WAIT:
        pause = min(waits) + 0.5
        await asyncio.sleep(pause)
        return await chat(
            db,
            workspace_id,
            group,
            messages,
            task=task,
            max_tokens=max_tokens,
            temperature=temperature,
            json_mode=json_mode,
            tools=tools,
            accept=accept,
            agent_id=agent_id,
            task_id=task_id,
            reasoning_effort=reasoning_effort,
            _waited=_waited + pause,
            _skip=_skip | failed,
        )
    raise GatewayUnavailable(f"No model in the {g.label} group could answer.", attempts)


def _bad_reply(r: client.ChatResult) -> str:
    """A 200 that was still no use: say how it ended and how it began."""
    head = client.redact(r.content)[:300]
    return f"finish_reason={r.finish_reason}, {r.usage.completion} tokens: {head}"[:500]


async def _mark_stale(db: AsyncSession, p: AIProvider, model_id: str) -> None:
    row = await store.model_row(db, p.id, model_id)
    if row is None:
        row = AIModel(workspace_id=p.workspace_id, provider_id=p.id, model_id=model_id, caps={})
        db.add(row)
    row.stale = True
    await db.commit()


# The local model reads 4096 tokens; a longer prompt would be cut, instructions first.
LOCAL_MAX_CHARS = 8000


def cheap_groups(*texts: str) -> tuple[str, ...]:
    """Side jobs: the free local model first when the prompt fits it, else straight to fast."""
    return ("local", "fast") if sum(map(len, texts)) <= LOCAL_MAX_CHARS else ("fast",)


async def chat_first(
    db: AsyncSession,
    workspace_id: str,
    groups: tuple[str, ...],
    messages: list[dict[str, Any]],
    **kw: Any,
) -> GatewayReply:
    """Try groups in order (e.g. ("local", "fast")): the free local model takes simple side
    jobs, and the next group answers when it cannot (none set up, down, or a bad reply)."""
    last: GatewayUnavailable | None = None
    for group in dict.fromkeys(groups):
        try:
            return await chat(db, workspace_id, group, messages, **kw)
        except GatewayUnavailable as e:
            last = e
    raise last or GatewayUnavailable("No group could answer.", [])
