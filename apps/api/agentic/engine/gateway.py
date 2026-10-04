"""Model-group routing with fallback (ported from CrawlOps services/gateway.py, extended).

Agents name a group ("smart", "fast", ...), never a provider. The gateway walks the
group's members in order and skips providers that are disabled, keyless or cooling
down. On 401/403/429/5xx it cools the provider and moves on; a model the provider
no longer has is marked stale and skipped. Every attempt is logged to llm_calls.
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AIModel, AIProvider, ModelGroup
from ..obs import langfuse
from . import client, media, store
from .client import Usage
from .errors import Failure

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
    if g.name in media.NAMES:
        raise GatewayUnavailable(
            f"The {g.label} group does not chat. Pick a chat group such as Smart or Fast.", []
        )
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


# ---------------------------------------------------------------- voice and pictures (P18)


class NotConfigured(GatewayUnavailable):
    """The group has no models yet: a person has to add one in AI Engine."""


class MediaRejected(ValueError):
    """The audio or prompt itself cannot be used (empty, too big, too long)."""


NO_TRANSCRIBE = (
    "Voice notes need a speech-to-text model. Add one in AI Engine > Model groups > Speech "
    "to text (Groq whisper-large-v3-turbo is free; OpenAI gpt-4o-mini-transcribe works too)."
)
NO_IMAGE = (
    "No picture model is set up. Add one in AI Engine > Model groups > Image generation "
    "(OpenAI gpt-image-1 or dall-e-3)."
)


@dataclass
class _Try:
    call: client.CallResult
    usage: Usage
    cost: Any  # Decimal | None
    value: Any = None


@dataclass
class Transcript:
    text: str
    provider_name: str
    model: str
    seconds: float | None
    language: str | None
    latency_ms: int
    cost_usd: float | None
    attempts: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Picture:
    data: bytes
    mime: str
    ext: str
    size: str
    provider_name: str
    model: str
    revised_prompt: str
    latency_ms: int
    cost_usd: float | None
    attempts: list[dict[str, Any]] = field(default_factory=list)


async def _walk(
    db: AsyncSession,
    workspace_id: str,
    group: str,
    *,
    task: str,
    unconfigured: str,
    attempt: Callable[[AIProvider, str, str], Awaitable[_Try]],
    agent_id: str | None,
    task_id: str | None,
) -> tuple[_Try, AIProvider, str, list[dict[str, Any]]]:
    """The routing of chat(), for one-shot media calls: members in order, skipping providers
    that are off, keyless or cooling; a failure cools the provider and the next one is asked.
    No waiting for rate limits: a person is usually waiting on the answer."""
    await store.ensure_default_groups(db, workspace_id)
    g = await db.scalar(
        select(ModelGroup).where(ModelGroup.workspace_id == workspace_id, ModelGroup.name == group)
    )
    if g is None or not g.members:
        raise NotConfigured(unconfigured, [])
    providers = {
        p.id: p
        for p in (
            await db.scalars(
                select(AIProvider).where(
                    AIProvider.id.in_({m["provider_id"] for m in g.members}),
                    AIProvider.workspace_id == workspace_id,
                )
            )
        ).all()
    }
    attempts: list[dict[str, Any]] = []
    last = ""
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
        row = await store.model_row(db, p.id, model_id)
        if row is not None and row.stale:
            attempts.append({"member": label, "skipped": "model no longer offered"})
            continue
        t = await attempt(p, key, model_id)
        f = t.call.failure
        await store.record_call(
            workspace_id=workspace_id,
            task=task,
            group=group,
            provider_id=p.id,
            provider_name=p.name,
            model=model_id,
            usage=t.usage,
            latency_ms=t.call.latency_ms,
            ok=t.call.ok,
            error_class=f.error_class if f else None,
            error_detail=None if t.call.ok else client.error_detail(t.call),
            cost=t.cost if t.call.ok else None,
            agent_id=agent_id,
            task_id=task_id,
        )
        if t.call.ok:
            attempts.append({"member": label, "ok": True, "latency_ms": t.call.latency_ms})
            return t, p, model_id, attempts
        if f is not None:
            if f.error_class == "model_not_found":
                await _mark_stale(db, p, model_id)
            await store.cool(p.id, f.cool_seconds)
            last = f.message
        attempts.append(
            {
                "member": label,
                "failed": f.message if f else "no usable answer",
                "error_class": f.error_class if f else "unusable_reply",
            }
        )
    if not last:
        raise GatewayUnavailable(
            f"No model in the {g.label} group is usable right now (off, keyless or resting).",
            attempts,
        )
    raise GatewayUnavailable(f"No model in the {g.label} group could do it. {last}", attempts)


async def transcribe(
    db: AsyncSession,
    workspace_id: str,
    audio: bytes,
    *,
    mime: str,
    language: str | None = None,
    seconds: float | None = None,
    task: str = "audio.transcribe",
    agent_id: str | None = None,
    task_id: str | None = None,
) -> Transcript:
    """Speech to text through the "transcribe" group. `seconds` is the length when the
    caller knows it (refused over 10 minutes; also priced by it when the provider is quiet).
    Raises MediaRejected, NotConfigured or GatewayUnavailable."""
    if not audio:
        raise MediaRejected("The recording is empty.")
    if len(audio) > client.MAX_AUDIO_BYTES:
        raise MediaRejected(f"Voice recordings can be up to {media.MAX_AUDIO_MB} MB.")
    if seconds is not None and seconds > media.MAX_AUDIO_SECONDS:
        raise MediaRejected(
            f"Voice recordings can be up to {media.MAX_AUDIO_SECONDS // 60} minutes long."
        )
    filename = media.audio_filename(mime)

    async def attempt(p: AIProvider, key: str, model_id: str) -> _Try:
        r = await client.transcribe(
            p.base_url, key, model_id, audio, filename, media.bare_mime(mime), language
        )
        secs = r.seconds if r.seconds is not None else seconds
        return _Try(r.call, r.usage, media.transcribe_cost(model_id, secs, p.tier), r)

    t, p, model_id, attempts = await _walk(
        db,
        workspace_id,
        media.TRANSCRIBE,
        task=task,
        unconfigured=NO_TRANSCRIBE,
        attempt=attempt,
        agent_id=agent_id,
        task_id=task_id,
    )
    r: client.TranscribeResult = t.value
    return Transcript(
        text=r.text,
        provider_name=p.name,
        model=model_id,
        seconds=r.seconds if r.seconds is not None else seconds,
        language=r.language,
        latency_ms=r.call.latency_ms,
        cost_usd=float(t.cost) if t.cost is not None else None,
        attempts=attempts,
    )


def picture_type(data: bytes) -> tuple[str, str]:
    """(mime, extension) from the bytes themselves; empty when it is not a picture."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return "", ""


async def generate_image(
    db: AsyncSession,
    workspace_id: str,
    prompt: str,
    *,
    shape: str = "square",
    style: str | None = None,
    task: str = "image.generate",
    agent_id: str | None = None,
    task_id: str | None = None,
) -> Picture:
    """One picture through the "image" group. Raises MediaRejected, NotConfigured or
    GatewayUnavailable."""
    prompt = prompt.strip()
    if not prompt:
        raise MediaRejected("Describe the picture to make.")
    style = (style or "").strip()[:200] or None
    full = prompt if not style or style in ("vivid", "natural") else f"{prompt}\n\nStyle: {style}"
    full = full[:4000]

    async def attempt(p: AIProvider, key: str, model_id: str) -> _Try:
        size = media.image_size(model_id, shape)
        r = await client.generate_image(
            p.base_url,
            key,
            model_id,
            full,
            size=size,
            quality=media.image_quality(model_id),
            style=style,
        )
        if r.call.ok and not picture_type(r.image)[0]:
            r.call.ok = False
            r.call.failure = Failure("bad_response", "The picture came back unreadable.")
        return _Try(r.call, r.usage, media.image_cost(model_id, size, p.tier), (r, size))

    t, p, model_id, attempts = await _walk(
        db,
        workspace_id,
        media.IMAGE,
        task=task,
        unconfigured=NO_IMAGE,
        attempt=attempt,
        agent_id=agent_id,
        task_id=task_id,
    )
    r, size = t.value
    mime, ext = picture_type(r.image)
    return Picture(
        data=r.image,
        mime=mime,
        ext=ext,
        size=size,
        provider_name=p.name,
        model=model_id,
        revised_prompt=r.revised_prompt,
        latency_ms=r.call.latency_ms,
        cost_usd=float(t.cost) if t.cost is not None else None,
        attempts=attempts,
    )
