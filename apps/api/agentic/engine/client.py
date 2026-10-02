"""OpenAI-compatible HTTP calls. Every function guards the URL first (core/ssrf.py) and
never logs the key. Tests swap the transport with `use_transport`."""

import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from ..core.ssrf import pinned
from .errors import Failure, classify_exception, classify_response, rate_limits

REASONING_FLOOR = 2048  # thinking models spend max_tokens on hidden reasoning first

_transport: httpx.AsyncBaseTransport | None = None


def use_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    """Test hook: route every engine call through a fake transport."""
    global _transport
    _transport = transport


def _client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=_transport, timeout=timeout, follow_redirects=False)


def host_of(url: str) -> str:
    return urlparse(url).hostname or url


def _url(base_url: str, path: str) -> str:
    return path if path.startswith("http") else f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "User-Agent": "agentic-ai/0.1"}


@dataclass
class Usage:
    prompt: int = 0
    completion: int = 0
    cached: int = 0
    reasoning: int = 0

    @classmethod
    def parse(cls, data: dict[str, Any]) -> "Usage":
        u = data.get("usage") or {}
        pd = u.get("prompt_tokens_details") or {}
        cd = u.get("completion_tokens_details") or {}
        return cls(
            prompt=int(u.get("prompt_tokens") or 0),
            completion=int(u.get("completion_tokens") or 0),
            # OpenAI reports cached_tokens; DeepSeek reports prompt_cache_hit_tokens.
            cached=int(pd.get("cached_tokens") or u.get("prompt_cache_hit_tokens") or 0),
            reasoning=int(cd.get("reasoning_tokens") or 0),
        )


@dataclass
class CallResult:
    ok: bool
    latency_ms: int
    status: int | None = None
    data: dict[str, Any] = field(default_factory=dict)
    failure: Failure | None = None
    rate: dict[str, str] = field(default_factory=dict)


async def _request(
    method: str, url: str, key: str, json: dict | None = None, timeout: float = 30
) -> CallResult:
    t0 = time.perf_counter()
    host = host_of(url)
    try:
        target, pin, ext = await pinned(url)
        async with _client(timeout) as http:
            r = await http.request(
                method, target, headers={**_headers(key), **pin}, json=json, extensions=ext
            )
    except Exception as e:  # noqa: BLE001 - every failure becomes a classified result
        return CallResult(ok=False, latency_ms=_ms(t0), failure=classify_exception(e, host))
    rate = rate_limits(r.headers)
    if r.status_code >= 400:
        return CallResult(
            ok=False,
            latency_ms=_ms(t0),
            status=r.status_code,
            rate=rate,
            failure=classify_response(r.status_code, r.text, host, r.headers.get("retry-after")),
        )
    try:
        data = r.json()
    except ValueError:
        return CallResult(
            ok=False,
            latency_ms=_ms(t0),
            status=r.status_code,
            rate=rate,
            failure=Failure("bad_response", f"{host} did not return JSON."),
        )
    return CallResult(ok=True, latency_ms=_ms(t0), status=r.status_code, data=data, rate=rate)


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


async def list_models(base_url: str, key: str) -> tuple[CallResult, list[dict[str, Any]]]:
    res = await _request("GET", _url(base_url, "/models"), key)
    if not res.ok:
        return res, []
    items = res.data.get("data") if isinstance(res.data, dict) else res.data
    models = []
    for m in items or []:
        if isinstance(m, dict) and m.get("id"):
            ctx = m.get("context_length") or m.get("context_window") or m.get("max_context_length")
            models.append({"id": str(m["id"]), "context_window": int(ctx) if ctx else None})
    models.sort(key=lambda m: m["id"])
    return res, models


async def check_key(base_url: str, key: str, path: str, fallback: str | None) -> CallResult:
    res = await _request("GET", _url(base_url, path), key)
    if (
        not res.ok
        and fallback
        and res.failure
        and res.failure.error_class in ("model_not_found", "unexpected_status", "bad_request")
    ):
        return await _request("GET", _url(base_url, fallback), key)
    return res


@dataclass
class ChatResult:
    call: CallResult
    content: str = ""
    served_model: str = ""
    finish_reason: str | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    reasoning_retry: bool = False


async def chat(
    base_url: str,
    key: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    max_tokens: int = 800,
    temperature: float | None = 0.2,
    json_mode: bool = False,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: Any = None,
    timeout: float = 120,
) -> ChatResult:
    body: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if temperature is not None:
        body["temperature"] = temperature
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if tools:
        body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

    url = _url(base_url, "/chat/completions")
    result = _parse(await _request("POST", url, key, body, timeout), model)
    # Empty + cut off = hidden reasoning ate the budget. One retry with room to think.
    if (
        result.call.ok
        and not result.content.strip()
        and not result.tool_calls
        and result.finish_reason == "length"
        and max_tokens < REASONING_FLOOR
    ):
        body["max_tokens"] = REASONING_FLOOR
        retry = _parse(await _request("POST", url, key, body, timeout), model)
        retry.reasoning_retry = True
        retry.call.latency_ms += result.call.latency_ms
        return retry
    return result


def _parse(call: CallResult, model: str) -> ChatResult:
    if not call.ok:
        return ChatResult(call=call)
    choices = call.data.get("choices") or [{}]
    choice = choices[0] if choices else {}
    msg = choice.get("message") or {}
    return ChatResult(
        call=call,
        content=msg.get("content") or "",
        served_model=call.data.get("model") or model,
        finish_reason=choice.get("finish_reason"),
        tool_calls=msg.get("tool_calls") or [],
        usage=Usage.parse(call.data),
    )


async def embed(base_url: str, key: str, model: str, texts: list[str]) -> CallResult:
    return await _request(
        "POST", _url(base_url, "/embeddings"), key, {"model": model, "input": texts}, timeout=60
    )
