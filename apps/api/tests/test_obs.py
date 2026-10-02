"""Langfuse export: batches, one trace per task, secrets masked, off unless configured."""

import base64
import json

import httpx

from agentic.core.config import settings
from agentic.obs import langfuse


def call(**over):
    base = {
        "workspace_id": "ws_1",
        "kind": "agent.task",
        "group": "smart",
        "provider": "Groq",
        "model": "m1",
        "messages": [{"role": "user", "content": "Log in with password=Hunter2024! please"}],
        "output": "Done.",
        "tool_calls": None,
        "prompt_tokens": 120,
        "completion_tokens": 30,
        "cost_usd": 0.0012,
        "latency_ms": 800,
        "ok": True,
        "error_class": None,
        "agent_id": "ag_1",
        "task_id": "tk_1",
        "max_tokens": 1500,
        "temperature": 0.2,
    }
    return {**base, **over}


async def test_generations_reach_langfuse(monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    monkeypatch.setattr(langfuse, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(settings, "langfuse_host", "http://langfuse.fake")
    monkeypatch.setattr(settings, "langfuse_public_key", "pk-lf-test")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk-lf-test")
    monkeypatch.setattr(langfuse, "_queue", None)
    monkeypatch.setattr(langfuse, "_task", None)

    langfuse.generation(**call())
    langfuse.generation(**call(ok=False, error_class="rate_limited"))
    if langfuse._task:  # noqa: SLF001 - flush deterministically instead of waiting 3 s
        langfuse._task.cancel()  # noqa: SLF001
    await langfuse.flush()

    req = seen[0]
    assert req.url.path == "/api/public/otel/v1/traces"
    assert (
        req.headers["authorization"]
        == "Basic " + base64.b64encode(b"pk-lf-test:sk-lf-test").decode()
    )
    spans = json.loads(req.content)["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert len(spans) == 2
    assert {s["traceId"] for s in spans} == {langfuse.trace_id_for("tk_1")}  # one per task
    attrs = {a["key"]: a["value"] for a in spans[0]["attributes"]}
    assert attrs["langfuse.observation.type"] == {"stringValue": "generation"}
    assert attrs["gen_ai.usage.input_tokens"] == {"intValue": "120"}
    assert attrs["langfuse.session.id"] == {"stringValue": "tk_1"}
    assert "Hunter2024" not in req.content.decode() and "[redacted]" in req.content.decode()
    assert spans[1]["status"]["code"] == 2  # the failed call shows as an error


async def test_refused_spans_are_not_counted_as_sent(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"partialSuccess": {"rejectedSpans": 1}})

    monkeypatch.setattr(langfuse, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(settings, "langfuse_host", "http://langfuse.fake")
    monkeypatch.setattr(settings, "langfuse_public_key", "pk")
    monkeypatch.setattr(settings, "langfuse_secret_key", "sk")
    monkeypatch.setattr(langfuse, "_queue", None)
    monkeypatch.setattr(langfuse, "_task", None)
    langfuse.generation(**call())
    if langfuse._task:  # noqa: SLF001
        langfuse._task.cancel()  # noqa: SLF001
    import pytest

    with pytest.raises(RuntimeError, match="rejected 1"):
        await langfuse.flush()


async def test_off_without_settings(monkeypatch):
    monkeypatch.setattr(settings, "langfuse_host", "")
    monkeypatch.setattr(langfuse, "_queue", None)
    langfuse.generation(**call())
    assert langfuse._queue is None  # noqa: SLF001 - nothing queued, no task started


def test_redact_masks_values_not_words():
    from agentic.core.redact import redact

    out = redact(
        "password=Hunter2024! token: abc123def456 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x "
        "key sk-proj-ABCDEFGHIJKLMNOP card 4111 1111 1111 1111 IC 900101-14-5678 "
        "bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0"
    )
    for leaked in (
        "Hunter2024",
        "abc123def456",
        "eyJhbGci",
        "ABCDEFGHIJ",
        "4111",
        "900101",
        "AAHdq",
    ):
        assert leaked not in out, leaked
    assert (
        redact("Our password policy needs 12 characters.")
        == "Our password policy needs 12 characters."
    )
