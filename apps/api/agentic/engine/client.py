"""OpenAI-compatible HTTP calls. Every function guards the URL first (core/ssrf.py) and
never logs the key. Tests swap the transport with `use_transport`."""

import base64
import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from ..core.ssrf import pinned
from .errors import Failure, classify_exception, classify_response, rate_limits

REASONING_FLOOR = 2048  # thinking models spend max_tokens on hidden reasoning first
# A JSON reply must think AND close every bracket. Measured: DeepSeek replies cut at
# exactly 2048 were 80 wasted calls, and Groq gpt-oss fails at 600 but works at 2048.
JSON_REASONING_FLOOR = 4096

# Model families that think before answering (name only, provider prefix and :tag dropped).
# A model missing here is still learned the first time it comes back empty (see chat()).
_THINKS = re.compile(
    r"gpt-oss|^o[134](?:$|-)|^gpt-5(?!.*chat)|deepseek-(?:reasoner|r1)|(?:^|-)r1(?:$|-)"
    r"|qwq|qwen3|thinking|reasoner|reasoning|magistral|^glm-(?:4\.[5-9]|z1)|gemini-2\.5"
    r"|grok-3-mini|^grok-4"
)
# Families whose API takes reasoning_effort "low" (Groq gpt-oss, OpenAI o-series and gpt-5,
# Gemini 2.5, xAI grok-3-mini). DeepSeek has no such knob; others may reject it, which is
# learned as the no_reasoning_effort quirk.
_TAKES_EFFORT = re.compile(
    r"gpt-oss|^o[34](?:$|-)|^o1(?:$|-\d)|^gpt-5(?!.*chat)|gemini-2\.5|grok-3-mini"
)


def _bare(model: str) -> str:
    return model.lower().rsplit("/", 1)[-1].split(":", 1)[0]


def thinks(model: str) -> bool:
    """Known reasoning model, before it has had a chance to run out of tokens."""
    return bool(_THINKS.search(_bare(model)))


def takes_effort(model: str) -> bool:
    return bool(_TAKES_EFFORT.search(_bare(model)))


def reasoning_floor(json_mode: bool) -> int:
    return JSON_REASONING_FLOOR if json_mode else REASONING_FLOOR


_KEYLIKE = re.compile(
    r"(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{8,}"
    r"|(?:bearer|key|token)[\"']?\s*[:=\s]\s*[\"']?[A-Za-z0-9._-]{16,}"
    r"|\b[A-Za-z0-9_-]{32,}\b)",
    re.I,
)


def error_detail(call: "CallResult") -> str | None:
    """What the provider actually said about a failed call, keys redacted, for llm_calls."""
    text = str(call.data.get("error_text") or "") or (call.failure.message if call.failure else "")
    return redact(text)[:500] or None


def redact(text: str) -> str:
    """One line, with anything that looks like a key or token replaced."""
    return _KEYLIKE.sub("[redacted]", " ".join(text.split()))


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
    method: str,
    url: str,
    key: str,
    json: dict | None = None,
    timeout: float = 30,
    *,
    files: dict[str, Any] | None = None,
    form: dict[str, str] | None = None,
) -> CallResult:
    """`files` + `form` send multipart/form-data (audio uploads) instead of JSON."""
    t0 = time.perf_counter()
    host = host_of(url)
    try:
        target, pin, ext = await pinned(url)
        async with _client(timeout) as http:
            r = await http.request(
                method,
                target,
                headers={**_headers(key), **pin},
                json=json,
                files=files,
                data=form,
                extensions=ext,
            )
    except Exception as e:  # noqa: BLE001 - every failure becomes a classified result
        return CallResult(ok=False, latency_ms=_ms(t0), failure=classify_exception(e, host))
    rate = rate_limits(r.headers)
    if r.status_code >= 400:
        return CallResult(
            ok=False,
            latency_ms=_ms(t0),
            status=r.status_code,
            data={"error_text": r.text[:2000]},  # read by chat() to adapt parameters
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
    quirks: frozenset[str] = frozenset()  # parameter fixes this model needed (remembered)
    reasoning_content: str = ""  # thinking-mode models (DeepSeek) that want it sent back


def shape_messages(
    messages: list[dict[str, Any]], quirks: set[str] | frozenset[str]
) -> list[dict[str, Any]]:
    """One conversation, many providers. DeepSeek's thinking mode requires every assistant
    step to carry its reasoning_content back (empty when another model wrote it); others
    reject the field. So it is added for the models that asked for it and removed for all
    the rest."""
    echo = "echo_reasoning" in quirks
    out: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") == "assistant" and (echo or "reasoning_content" in m):
            m = dict(m)
            if echo:
                m["reasoning_content"] = m.get("reasoning_content") or ""
            else:
                m.pop("reasoning_content", None)
        out.append(m)
    return out


CACHE_MARK = {"type": "ephemeral"}


def wants_cache_control(base_url: str, model: str) -> bool:
    """Anthropic models cache a prompt prefix only up to explicit breakpoints (OpenAI-style
    providers cache automatically). True for Anthropic's own OpenAI-compatible endpoint and for
    Claude models through OpenRouter, which passes the breakpoints on."""
    host = host_of(base_url).lower()
    m = model.lower()
    if host == "api.anthropic.com" or host.endswith(".anthropic.com"):
        return True
    return host.endswith("openrouter.ai") and ("claude" in m or m.startswith("anthropic/"))


def cache_breakpoints(
    messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
    """Mark the end of the system message and of the tool list as cacheable (P21). The prompt
    reads tools -> system -> conversation, so the system mark also covers the tools; the tool
    mark keeps the tools cached when an agent's instructions change between calls."""
    out = list(messages)
    last_system = max((i for i, m in enumerate(out) if m.get("role") == "system"), default=-1)
    if last_system >= 0 and isinstance(out[last_system].get("content"), str):
        m = dict(out[last_system])
        m["content"] = [{"type": "text", "text": m["content"], "cache_control": CACHE_MARK}]
        out[last_system] = m
    marked = None
    if tools:
        marked = [*tools[:-1], {**tools[-1], "cache_control": CACHE_MARK}]
    return out, marked


def _quirk_for(error_text: str) -> str | None:
    """Newer models reject some classic parameters with a 400. Name the fix, if known."""
    t = error_text.lower()
    if "cache_control" in t:
        return "no_cache_control"
    if "max_completion_tokens" in t and "max_tokens" in t:
        return "max_completion_tokens"
    if "reasoning_content" in t and ("passed back" in t or "must be" in t):
        return "echo_reasoning"
    if "reasoning_effort" in t:
        return "no_reasoning_effort"
    if "temperature" in t and any(
        w in t for w in ("unsupported", "not support", "only the default", "does not support")
    ):
        return "no_temperature"
    return None


def _out_of_tokens(error_text: str) -> bool:
    """Groq checks JSON mode itself and answers 400 json_validate_failed, "max completion
    tokens reached before generating a valid document", when thinking ate the budget."""
    t = error_text.lower()
    return "tokens reached" in t or ("json_validate_failed" in t and "token" in t)


TRUNCATED = Failure("truncated", "The model ran out of tokens before finishing its reply.")


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
    quirks: frozenset[str] = frozenset(),
    reasoning_effort: str | None = None,
) -> ChatResult:
    q = set(quirks)
    cacheable = wants_cache_control(base_url, model)

    def shaped() -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
        msgs = shape_messages(messages, q)
        if cacheable and "no_cache_control" not in q:
            return cache_breakpoints(msgs, tools)
        return msgs, tools

    sent_messages, sent_tools = shaped()
    tokens_key = "max_completion_tokens" if "max_completion_tokens" in q else "max_tokens"
    body: dict[str, Any] = {
        "model": model,
        "messages": sent_messages,
        tokens_key: max_tokens,
    }
    if temperature is not None and "no_temperature" not in q:
        body["temperature"] = temperature
    if "no_think" in q:
        # Small local thinking models (qwen3) otherwise spend ~100 tokens thinking per answer.
        body["reasoning_effort"] = "none"
    elif reasoning_effort and "no_reasoning_effort" not in q:
        body["reasoning_effort"] = reasoning_effort
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if tools:
        body["tools"] = sent_tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

    url = _url(base_url, "/chat/completions")
    call = await _request("POST", url, key, body, timeout)
    for _ in range(3):  # at most three parameter fixes, each tried once
        fix = _quirk_for(str(call.data.get("error_text", ""))) if call.status == 400 else None
        if fix is None or fix in q:
            break
        q.add(fix)
        if fix == "max_completion_tokens":
            body["max_completion_tokens"] = body.pop("max_tokens", max_tokens)
        elif fix in ("echo_reasoning", "no_cache_control"):
            body["messages"], marked = shaped()
            if tools:
                body["tools"] = marked
        elif fix == "no_reasoning_effort":
            body.pop("reasoning_effort", None)
        else:
            body.pop("temperature", None)
        call = await _request("POST", url, key, body, timeout)
    tokens_key = "max_completion_tokens" if "max_completion_tokens" in q else "max_tokens"
    result = _parse(call, model)
    result.quirks = frozenset(q)
    floor = reasoning_floor(json_mode)
    # Hidden reasoning ate the budget: an empty reply cut off by length, or the provider's
    # own JSON check refusing an unfinished document. One retry with room to think.
    starved = (
        result.call.ok
        and not result.content.strip()
        and not result.tool_calls
        and result.finish_reason == "length"
    ) or (call.status == 400 and _out_of_tokens(str(call.data.get("error_text", ""))))
    if starved and max_tokens < floor:
        body[tokens_key] = floor
        retry = _parse(await _request("POST", url, key, body, timeout), model)
        retry.reasoning_retry = True
        retry.quirks = frozenset(q)
        retry.call.latency_ms += result.call.latency_ms
        result = retry
    if result.call.status == 400 and _out_of_tokens(str(result.call.data.get("error_text", ""))):
        result.call.failure = TRUNCATED
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
        reasoning_content=str(msg.get("reasoning_content") or ""),
    )


async def embed(base_url: str, key: str, model: str, texts: list[str]) -> CallResult:
    return await _request(
        "POST", _url(base_url, "/embeddings"), key, {"model": model, "input": texts}, timeout=60
    )


# ---------------------------------------------------------------- audio and pictures (P18)

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # OpenAI and Groq both refuse larger uploads
MAX_IMAGE_BYTES = 20 * 1024 * 1024


def _dict(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


@dataclass
class TranscribeResult:
    call: CallResult
    text: str = ""
    seconds: float | None = None  # audio length, when the provider says
    language: str | None = None
    usage: Usage = field(default_factory=Usage)
    # verbose_json only: [{"start": s, "end": s, "text": ...}] (meeting minutes timestamps).
    segments: list[dict[str, Any]] = field(default_factory=list)


def _segments(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict):
            continue
        try:
            start, end = float(s.get("start") or 0), float(s.get("end") or 0)
        except (TypeError, ValueError):
            continue
        text = str(s.get("text") or "").strip()
        if text:
            out.append({"start": start, "end": max(end, start), "text": text})
    return out


async def transcribe(
    base_url: str,
    key: str,
    model: str,
    audio: bytes,
    filename: str,
    mime: str,
    language: str | None = None,
    *,
    prompt: str | None = None,
    timeout: float = 120,
) -> TranscribeResult:
    """OpenAI-compatible POST /audio/transcriptions (multipart). Whisper models are asked for
    verbose_json, which carries the audio length (for cost); the gpt-4o transcribe models
    only speak json and report usage instead. `prompt` gives context (earlier words, names)."""
    url = _url(base_url, "/audio/transcriptions")

    async def send(fmt: str) -> CallResult:
        form = {"model": model, "response_format": fmt}
        if language:
            form["language"] = language
        if prompt:
            form["prompt"] = prompt
        return await _request(
            "POST",
            url,
            key,
            timeout=timeout,
            files={"file": (filename, audio, mime or "application/octet-stream")},
            form=form,
        )

    fmt = "verbose_json" if "whisper" in _bare(model) else "json"
    call = await send(fmt)
    err = str(call.data.get("error_text", "")).lower()
    if call.status == 400 and fmt != "json" and "response_format" in err:
        call = await send("json")
    if not call.ok:
        return TranscribeResult(call=call)
    d = call.data if isinstance(call.data, dict) else {}
    u = _dict(d.get("usage"))
    seconds = d.get("duration")
    if seconds is None and u.get("type") == "duration":
        seconds = u.get("seconds")
    try:
        secs = float(seconds) if seconds is not None else None
    except (TypeError, ValueError):
        secs = None
    return TranscribeResult(
        call=call,
        text=str(d.get("text") or "").strip(),
        seconds=secs,
        language=str(d["language"]) if d.get("language") else None,
        usage=Usage(
            prompt=int(u.get("input_tokens") or 0), completion=int(u.get("output_tokens") or 0)
        ),
        segments=_segments(d.get("segments")),
    )


@dataclass
class ImageResult:
    call: CallResult
    image: bytes = b""
    revised_prompt: str = ""
    usage: Usage = field(default_factory=Usage)


async def generate_image(
    base_url: str,
    key: str,
    model: str,
    prompt: str,
    *,
    size: str,
    quality: str | None = None,
    style: str | None = None,
    timeout: float = 180,
) -> ImageResult:
    """OpenAI-compatible POST /images/generations, one picture. gpt-image models always
    answer base64; dall-e is asked for it; a provider that answers with a URL is fetched
    (public addresses only, and never with the key)."""
    body: dict[str, Any] = {"model": model, "prompt": prompt, "n": 1, "size": size}
    bare = _bare(model)
    if bare.startswith("dall-e"):
        body["response_format"] = "b64_json"
        if bare == "dall-e-3" and style in ("vivid", "natural"):
            body["style"] = style
    if quality:
        body["quality"] = quality
    call = await _request("POST", _url(base_url, "/images/generations"), key, body, timeout)
    if not call.ok:
        return ImageResult(call=call)
    items = call.data.get("data") if isinstance(call.data, dict) else None
    first = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
    blob = b""
    if first.get("b64_json"):
        try:
            blob = base64.b64decode(first["b64_json"])
        except ValueError:
            blob = b""
    elif first.get("url"):
        blob = await download(str(first["url"]), MAX_IMAGE_BYTES)
    if not blob:
        call.ok = False
        call.failure = Failure("bad_response", f"{host_of(base_url)} sent back no picture.")
        return ImageResult(call=call)
    u = _dict(call.data.get("usage"))
    return ImageResult(
        call=call,
        image=blob,
        revised_prompt=str(first.get("revised_prompt") or ""),
        usage=Usage(
            prompt=int(u.get("input_tokens") or 0), completion=int(u.get("output_tokens") or 0)
        ),
    )


async def download(url: str, max_bytes: int, timeout: float = 60) -> bytes:
    """GET a public URL (SSRF-guarded, no credentials). Empty on any failure or overflow."""
    try:
        target, pin, ext = await pinned(url)
        async with _client(timeout) as http:
            async with http.stream(
                "GET", target, headers={"User-Agent": "agentic-ai/0.1", **pin}, extensions=ext
            ) as r:
                if r.status_code >= 400:
                    return b""
                data = bytearray()
                async for chunk in r.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        return b""
                return bytes(data)
    except Exception:  # noqa: BLE001 - a missing picture is reported by the caller
        return b""
