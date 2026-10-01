"""Turn provider failures into a stable class plus a sentence a person can act on."""

from dataclasses import dataclass

import httpx

from ..core.ssrf import BlockedURL


@dataclass(frozen=True)
class Failure:
    error_class: str
    message: str
    # Should routing cool this provider down (it is unwell), or just skip this model?
    cool_seconds: int = 0


def _mentions(body: str, *words: str) -> bool:
    b = body.lower()
    return any(w in b for w in words)


def classify_response(status: int, body: str, host: str, retry_after: str | None = None) -> Failure:
    if status == 401:
        return Failure(
            "auth_rejected",
            "The key was rejected. Check it was copied in full and is still active.",
            300,
        )
    if status == 402 or _mentions(
        body,
        "insufficient_quota",
        "insufficient credit",
        "insufficient balance",
        "credit balance",
        "exceeded your current quota",
    ):
        return Failure("no_credit", "No credit left on this account.", 300)
    if status == 403:
        return Failure(
            "forbidden", "The key works, but this account cannot use that model or endpoint.", 300
        )
    if status == 404 or (
        status == 400
        and _mentions(
            body,
            "model_not_found",
            "does not exist",
            "invalid model",
            "unknown model",
            "model not found",
            "not a valid model",
        )
    ):
        return Failure(
            "model_not_found",
            "This model ID does not exist for this provider. Pick one from the list.",
        )
    if status == 429:
        wait = f" Resets in {retry_after} s." if retry_after else ""
        return Failure(
            "rate_limited",
            f"Rate limit hit.{wait} Free tiers reset per minute or per day.",
            _int(retry_after, 60),
        )
    if status >= 500:
        return Failure(
            "provider_error", f"{host} is having problems ({status}). Try again shortly.", 120
        )
    if status == 400:
        return Failure("bad_request", f"{host} refused the request: {_snippet(body)}")
    return Failure("unexpected_status", f"{host} answered {status}: {_snippet(body)}")


def classify_exception(exc: Exception, host: str) -> Failure:
    if isinstance(exc, BlockedURL):
        return Failure("blocked_url", str(exc))
    if isinstance(exc, httpx.TimeoutException):
        return Failure("timeout", f"{host} did not answer in time.", 60)
    if isinstance(exc, httpx.HTTPError):
        return Failure("unreachable", f"Could not reach {host}.", 60)
    return Failure("unexpected", f"Unexpected error talking to {host}: {exc}")


def _int(v: str | None, default: int) -> int:
    try:
        return max(1, min(int(float(v or "")), 3600))
    except ValueError:
        return default


def _snippet(body: str, n: int = 160) -> str:
    text = " ".join(body.split())
    return text[:n] + ("…" if len(text) > n else "")


RATE_HEADERS = (
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "retry-after",
)


def rate_limits(headers: httpx.Headers) -> dict[str, str]:
    return {h: headers[h] for h in RATE_HEADERS if h in headers}
