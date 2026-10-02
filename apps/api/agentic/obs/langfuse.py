"""Send every model call to a self-hosted Langfuse (compose profile `obs`) as a generation.

Langfuse v4 ingests OpenTelemetry: each model call becomes one OTLP span, posted as
OTLP/JSON to /api/public/otel/v1/traces with Langfuse's attribute names
(langfuse.observation.*, gen_ai.*). No OpenTelemetry SDK is needed for this.

Off unless AGENTIC_LANGFUSE_HOST and both keys are set. Spans are queued in memory and
posted in batches by one background task per process, so a slow or missing Langfuse
never slows or breaks agent work: when the queue is full, new spans are dropped, and
after a failed post the exporter backs off.

All calls of one task share one trace (its id is derived from the task id), so a task's
run, retries and delegations read as one timeline. Calls outside tasks get their own.
Secret values in prompts and answers are masked (core/redact.py) before they leave.
"""

import asyncio
import base64
import hashlib
import json
import logging
import secrets
import time
from typing import Any

import httpx

from ..core.config import settings
from ..core.redact import redact

log = logging.getLogger("agentic.obs")

QUEUE_MAX = 5000
BATCH = 100
FLUSH_EVERY = 3.0
MAX_FIELD = 8000  # characters per message kept in a trace

transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake Langfuse
_queue: asyncio.Queue[dict[str, Any]] | None = None
_task: asyncio.Task[None] | None = None
_dropped = 0


def enabled() -> bool:
    return bool(
        settings.langfuse_host and settings.langfuse_public_key and settings.langfuse_secret_key
    )


def trace_id_for(task_id: str) -> str:
    """OTLP trace ids are 16 bytes (32 hex); one per task, the same on every process."""
    return hashlib.sha256(f"agentic-task:{task_id}".encode()).hexdigest()[:32]


def _mask(text: str) -> str:
    return redact(text)[:MAX_FIELD]


def _clean_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        c = m.get("content")
        out.append({**m, "content": _mask(c) if isinstance(c, str) else c})
    return out


def _attr(key: str, value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        v: dict[str, Any] = {"boolValue": value}
    elif isinstance(value, int):
        v = {"intValue": str(value)}
    elif isinstance(value, float):
        v = {"doubleValue": value}
    else:
        v = {"stringValue": value if isinstance(value, str) else json.dumps(value, default=str)}
    return {"key": key, "value": v}


def generation(
    *,
    workspace_id: str,
    kind: str,
    group: str,
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
    output: str,
    tool_calls: list[dict[str, Any]] | None,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float | None,
    latency_ms: int,
    ok: bool,
    error_class: str | None,
    agent_id: str | None,
    task_id: str | None,
    max_tokens: int,
    temperature: float | None,
) -> None:
    """Queue one model call. Never raises, never waits."""
    global _dropped
    if not enabled():
        return
    try:
        end = time.time_ns()
        start = end - latency_ms * 1_000_000
        attrs: dict[str, Any] = {
            "langfuse.observation.type": "generation",
            "langfuse.trace.name": f"task {task_id}" if task_id else kind,
            "langfuse.observation.model.name": model,
            "gen_ai.request.model": model,
            "gen_ai.system": provider,
            "langfuse.observation.input": _clean_messages(messages),
            "langfuse.observation.output": {"content": _mask(output), "tool_calls": tool_calls}
            if tool_calls
            else _mask(output),
            "langfuse.observation.usage_details": {
                "input": prompt_tokens,
                "output": completion_tokens,
            },
            "gen_ai.usage.input_tokens": prompt_tokens,
            "gen_ai.usage.output_tokens": completion_tokens,
            "langfuse.observation.model.parameters": {
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            "langfuse.observation.level": "DEFAULT" if ok else "ERROR",
            "langfuse.observation.metadata.workspace_id": workspace_id,
            "langfuse.observation.metadata.group": group,
            "langfuse.observation.metadata.provider": provider,
            "langfuse.trace.tags": [kind, group],
        }
        if cost_usd is not None:
            attrs["langfuse.observation.cost_details"] = {"total": cost_usd}
        if error_class:
            attrs["langfuse.observation.status_message"] = error_class
        if task_id:
            attrs["langfuse.session.id"] = task_id
            attrs["langfuse.trace.metadata.task_id"] = task_id
        if agent_id:
            attrs["langfuse.user.id"] = agent_id
        span = {
            "traceId": trace_id_for(task_id) if task_id else secrets.token_hex(16),
            "spanId": secrets.token_hex(8),
            "name": kind,
            "kind": 3,  # CLIENT
            "startTimeUnixNano": str(start),
            "endTimeUnixNano": str(end),
            "attributes": [_attr(k, v) for k, v in attrs.items()],
            "status": {"code": 1 if ok else 2, "message": error_class or ""},
        }
        try:
            _ensure().put_nowait(span)
        except asyncio.QueueFull:
            _dropped += 1
    except Exception:  # noqa: BLE001 - tracing must never affect the call
        log.debug("could not queue a trace", exc_info=True)


def _ensure() -> asyncio.Queue[dict[str, Any]]:
    global _queue, _task
    if _queue is None:
        _queue = asyncio.Queue(maxsize=QUEUE_MAX)
    if _task is None or _task.done():
        _task = asyncio.create_task(_run(_queue))
    return _queue


def _payload(spans: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        _attr("service.name", "agentic-ai"),
                        _attr("deployment.environment", settings.env),
                    ]
                },
                "scopeSpans": [{"scope": {"name": "agentic.gateway"}, "spans": spans}],
            }
        ]
    }


async def _post(http: httpx.AsyncClient, spans: list[dict[str, Any]]) -> None:
    auth = base64.b64encode(
        f"{settings.langfuse_public_key}:{settings.langfuse_secret_key}".encode()
    ).decode()
    r = await http.post(
        f"{settings.langfuse_host.rstrip('/')}/api/public/otel/v1/traces",
        json=_payload(spans),
        headers={"Authorization": f"Basic {auth}"},
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Langfuse answered {r.status_code}: {r.text[:200]}")
    # OTLP reports refused spans in a 200: count them as failures, not as sent.
    rejected = int(
        ((r.json() if r.content else {}).get("partialSuccess") or {}).get("rejectedSpans", 0) or 0
    )
    if rejected:
        raise RuntimeError(f"Langfuse rejected {rejected} of {len(spans)} spans: {r.text[:200]}")


async def _run(q: asyncio.Queue[dict[str, Any]]) -> None:
    global _dropped
    backoff = FLUSH_EVERY
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        while True:
            first = await q.get()
            await asyncio.sleep(FLUSH_EVERY)  # gather a batch
            batch = [first]
            while len(batch) < BATCH:
                try:
                    batch.append(q.get_nowait())
                except asyncio.QueueEmpty:
                    break
            try:
                await _post(http, batch)
                backoff = FLUSH_EVERY
                if _dropped:
                    log.warning("dropped %d trace spans while Langfuse was behind", _dropped)
                    _dropped = 0
            except Exception as e:  # noqa: BLE001 - Langfuse down: drop this batch, back off
                _dropped += len(batch)
                log.warning("could not send traces to Langfuse (%s); retrying later", e)
                backoff = min(backoff * 2, 300)
                await asyncio.sleep(backoff)


async def flush(timeout: float = 10) -> None:
    """Send what is queued now (tests, shutdown). Raises if Langfuse refuses it."""
    if _queue is None:
        return
    batch = []
    while True:
        try:
            batch.append(_queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    if batch:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as http:
            await _post(http, batch)
