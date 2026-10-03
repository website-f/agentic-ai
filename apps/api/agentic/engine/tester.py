"""The "Test connection" button and the scheduled health check, streamed as they finish.

1. Key and reachability   (key endpoint / model list)
2. Chat round-trip        (tiny prompt, auto-raises the budget for thinking models)
3. JSON mode              (background jobs depend on it; a failure marks the provider degraded)
4. Capabilities, optional (tool calling, embeddings)

A saved provider is tested with a model one of its model groups really uses, so a green
check means the work it does will run, not that some other model answers.
"""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AIProvider, ModelGroup, ProviderCheck
from . import client, store
from .presets import BY_ID

TOOL_PROBE = [
    {
        "type": "function",
        "function": {
            "name": "get_local_time",
            "description": "Get the current local time in a city.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]


@dataclass
class Target:
    workspace_id: str
    base_url: str
    key: str
    preset: str | None
    name: str
    tier: str
    provider: AIProvider | None = None  # set when testing a saved provider
    model: str | None = None
    capabilities: bool = False
    source: str = "manual"  # manual | scheduled


def _event(step: str, label: str, status: str, **extra: Any) -> dict[str, Any]:
    return {"type": "step", "step": step, "label": label, "status": status, **extra}


def pick_model(requested: str | None, preset_id: str | None, available: list[str]) -> str | None:
    if requested:
        return requested
    preset = BY_ID.get(preset_id or "")
    for m in preset.suggested_models if preset else ():
        if not available or m in available:
            return m
    chatty = [
        m
        for m in available
        if not any(
            w in m.lower()
            for w in ("embed", "whisper", "tts", "dall-e", "image", "moderation", "rerank", "audio")
        )
    ]
    return (chatty or available or [None])[0]


async def group_model(db: AsyncSession | None, p: AIProvider | None) -> str | None:
    """The first model this provider serves in a chat group (Smart before Fast, ...)."""
    if db is None or p is None:
        return None
    groups = (
        await db.scalars(
            select(ModelGroup)
            .where(ModelGroup.workspace_id == p.workspace_id, ModelGroup.name != "embed")
            .order_by(ModelGroup.position)
        )
    ).all()
    for g in groups:
        for m in g.members or []:
            if m.get("provider_id") == p.id and m.get("model_id"):
                return str(m["model_id"])
    return None


def parses_as_object(text: str) -> bool:
    try:
        return isinstance(json.loads(text.strip().strip("`").removeprefix("json")), dict)
    except ValueError:
        return False


def _key_detail(path: str, data: dict[str, Any], model_count: int) -> str:
    if path == "/key":  # OpenRouter key info
        d = data.get("data") or {}
        label = d.get("label") or "key"
        limit = d.get("limit")
        usage = d.get("usage")
        spend = f", ${usage:.2f} used" if isinstance(usage, int | float) else ""
        cap = f" of ${limit:.2f}" if isinstance(limit, int | float) else ""
        return f"Key accepted ({label}{spend}{cap}). {model_count} models available."
    if "name" in data and "auth" in data:  # HuggingFace whoami
        return f"Token accepted for {data.get('name')}. {model_count} models available."
    return f"Key accepted. {model_count} models available."


async def run(target: Target, db: AsyncSession | None = None) -> AsyncIterator[dict[str, Any]]:
    preset = BY_ID.get(target.preset or "")
    key_path = preset.key_check if preset else "/models"
    fallback = preset.key_check_fallback if preset else None
    pid = target.provider.id if target.provider else None

    # ---- 1. key
    label = "Key and reachability"
    yield _event("key", label, "running")
    models: list[dict[str, Any]] = []
    if key_path == "/models":
        res, models = await client.list_models(target.base_url, target.key)
        if not res.ok and fallback:
            res = await client.check_key(target.base_url, target.key, "/models", fallback)
    else:
        res = await client.check_key(target.base_url, target.key, key_path, fallback)
        if res.ok:
            _, models = await client.list_models(target.base_url, target.key)

    if not res.ok:
        f = res.failure
        assert f is not None
        yield _event(
            "key",
            label,
            "failed",
            latency_ms=res.latency_ms,
            error_class=f.error_class,
            detail=f.message,
            rate=res.rate,
        )
        yield _event("chat", "Chat round-trip", "skipped", detail="Needs a working key first.")
        await _persist(
            db,
            target,
            ok_key=False,
            ok_chat=False,
            latency=res.latency_ms,
            error_class=f.error_class,
            models=[],
            summary=f.message,
        )
        yield {"type": "done", "ok": False, "models": []}
        return

    ids = [m["id"] for m in models]
    yield _event(
        "key",
        label,
        "ok",
        latency_ms=res.latency_ms,
        detail=_key_detail(key_path, res.data, len(ids)),
        rate=res.rate,
    )

    # ---- 2. chat
    label = "Chat round-trip"
    # Scheduled checks follow the groups (the model last tested may no longer be used);
    # a person testing by hand gets the model they typed.
    used = await group_model(db, target.provider)
    wanted = (used or target.model) if target.source == "scheduled" else (target.model or used)
    model = pick_model(wanted, target.preset, ids)
    if not model:
        yield _event(
            "chat",
            label,
            "failed",
            error_class="no_model",
            detail="The provider listed no models. Type a model ID to test.",
        )
        yield {"type": "done", "ok": False, "models": ids}
        return
    yield _event("chat", label, "running", model=model)
    reply = await client.chat(
        target.base_url,
        target.key,
        model,
        [{"role": "user", "content": "Reply with the word OK and nothing else."}],
        # A known thinking model would come back empty at 16 and need a second call.
        max_tokens=client.REASONING_FLOOR if client.thinks(model) else 16,
        temperature=0,
        reasoning_effort="low" if client.takes_effort(model) else None,
    )
    model_row = await store.model_row(db, pid, model) if db and pid else None
    cost = store.cost_usd(model_row, reply.usage, target.tier)
    await store.record_call(
        workspace_id=target.workspace_id,
        task="engine.test",
        provider_id=pid,
        provider_name=target.name,
        model=reply.served_model or model,
        usage=reply.usage,
        latency_ms=reply.call.latency_ms,
        ok=reply.call.ok and bool(reply.content.strip()),
        error_class=reply.call.failure.error_class if reply.call.failure else None,
        error_detail=client.error_detail(reply.call) if not reply.call.ok else None,
        cost=cost,
    )
    chat_ok = reply.call.ok and bool(reply.content.strip())
    if chat_ok:
        if reply.reasoning_retry and pid:
            await store.remember_reasoning(pid, model)
        u = reply.usage
        yield _event(
            "chat",
            label,
            "ok",
            latency_ms=reply.call.latency_ms,
            model=reply.served_model,
            detail=f'Replied "{reply.content.strip()[:60]}"'
            + (" after thinking (reasoning model)." if reply.reasoning_retry else "."),
            usage={
                "prompt": u.prompt,
                "completion": u.completion,
                "cached": u.cached,
                "reasoning": u.reasoning,
            },
            cost_usd=float(cost) if cost is not None else None,
            rate=reply.call.rate,
        )
    else:
        f = reply.call.failure
        msg = f.message if f else "The model returned an empty reply."
        yield _event(
            "chat",
            label,
            "failed",
            latency_ms=reply.call.latency_ms,
            model=model,
            error_class=f.error_class if f else "empty_reply",
            detail=msg,
            rate=reply.call.rate,
        )

    # ---- 3. JSON mode: what memory, skills and workflows run on
    caps: dict[str, bool] = {}
    json_msg = ""
    if chat_ok:
        yield _event("json", "JSON mode", "running", model=model)
        caps["json"], json_msg, latency = await _json_probe(target, model, reply, pid)
        yield _event(
            "json",
            "JSON mode",
            "ok" if caps["json"] else "failed",
            latency_ms=latency,
            model=model,
            detail="Returned valid JSON." if caps["json"] else json_msg,
        )
    json_ok = caps.get("json", False)

    # ---- 4. capabilities
    if target.capabilities and chat_ok:
        yield _event("tools", "Tool calling", "running")
        r = await client.chat(
            target.base_url,
            target.key,
            model,
            [{"role": "user", "content": "What time is it in Kuala Lumpur? Use the tool."}],
            max_tokens=200,
            temperature=0,
            tools=TOOL_PROBE,
            tool_choice="auto",
        )
        caps["tools"] = bool(r.tool_calls)
        yield _event(
            "tools",
            "Tool calling",
            "ok" if caps["tools"] else "failed",
            latency_ms=r.call.latency_ms,
            detail="Called the tool correctly."
            if caps["tools"]
            else (
                r.call.failure.message if r.call.failure else "Answered without calling the tool."
            ),
        )

        embed_model = next((m for m in ids if "embed" in m.lower()), None)
        if embed_model:
            yield _event("embed", "Embeddings", "running", model=embed_model)
            r2 = await client.embed(target.base_url, target.key, embed_model, ["hello"])
            vec = (r2.data.get("data") or [{}])[0].get("embedding") if r2.ok else None
            ok = bool(vec)
            yield _event(
                "embed",
                "Embeddings",
                "ok" if ok else "failed",
                latency_ms=r2.latency_ms,
                model=embed_model,
                detail=f"{embed_model} returned a {len(vec)}-dimension vector."
                if ok and vec
                else (r2.failure.message if r2.failure else "No vector returned."),
            )

    if not chat_ok:
        error_class = reply.call.failure.error_class if reply.call.failure else "empty_reply"
        summary = (
            reply.call.failure.message
            if reply.call.failure
            else "The model returned an empty reply."
        )
    elif not json_ok:
        error_class = "json_failed"
        summary = f"Chat works, but {model} failed the JSON check: {json_msg}"
    else:
        error_class, summary = None, "Connection works."
    await _persist(
        db,
        target,
        ok_key=True,
        ok_chat=chat_ok and json_ok,
        latency=reply.call.latency_ms,
        error_class=error_class,
        models=models,
        summary=summary,
        tested_model=model,
        caps=caps,
    )
    yield {"type": "done", "ok": chat_ok and json_ok, "model": model, "models": ids}


async def _json_probe(
    target: Target, model: str, chat: client.ChatResult, pid: str | None
) -> tuple[bool, str, int]:
    """A tiny JSON-mode call shaped like the background jobs: thinking models get the same
    budget and reasoning_effort the gateway would give them. Returns (ok, why not, ms)."""
    thinker = chat.reasoning_retry or client.thinks(model)
    if pid and not thinker:
        thinker = await store.is_reasoning(pid, model)
    r = await client.chat(
        target.base_url,
        target.key,
        model,
        [{"role": "user", "content": 'Return a JSON object {"ok": true} and nothing else.'}],
        max_tokens=client.JSON_REASONING_FLOOR if thinker else 60,
        temperature=0,
        json_mode=True,
        quirks=chat.quirks,
        reasoning_effort="low" if thinker and client.takes_effort(model) else None,
    )
    ok = r.call.ok and r.finish_reason != "length" and parses_as_object(r.content)
    if r.call.failure:
        why = r.call.failure.message
    elif r.call.ok and r.finish_reason == "length":
        why = "The reply was cut off by the token limit (a thinking model needs more room)."
    else:
        why = "The reply was not valid JSON."
    await store.record_call(
        workspace_id=target.workspace_id,
        task="engine.test",
        provider_id=pid,
        provider_name=target.name,
        model=r.served_model or model,
        usage=r.usage,
        latency_ms=r.call.latency_ms,
        ok=ok,
        error_class=None
        if ok
        else (r.call.failure.error_class if r.call.failure else "json_failed"),
        error_detail=None if ok else (client.error_detail(r.call) or why),
    )
    return ok, why, r.call.latency_ms


async def _persist(
    db: AsyncSession | None,
    target: Target,
    *,
    ok_key: bool,
    ok_chat: bool,
    latency: int,
    error_class: str | None,
    models: list[dict[str, Any]],
    summary: str,
    tested_model: str | None = None,
    caps: dict[str, bool] | None = None,
) -> None:
    """Only saved providers get their health, models and check history updated."""
    p = target.provider
    if db is None or p is None:
        return
    now = datetime.now(UTC)
    p.health = "ok" if ok_chat else ("degraded" if ok_key else "down")
    p.last_test_at = now
    p.last_test_result = {
        "ok": ok_chat,
        "summary": summary,
        "model": tested_model,
        "error_class": error_class,
    }
    db.add(
        ProviderCheck(
            provider_id=p.id,
            ts=now,
            ok=ok_chat,
            latency_ms=latency,
            error_class=error_class,
            source=target.source,
        )
    )
    if models:
        await store.upsert_models(db, p, models)
        await db.flush()
    if tested_model and caps:
        row = await store.model_row(db, p.id, tested_model)
        if row:
            row.caps = {**(row.caps or {}), **caps}
    if ok_chat:
        await store.clear_cooldown(p.id)
    await db.commit()
