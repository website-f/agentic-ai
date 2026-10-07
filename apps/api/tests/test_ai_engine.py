"""AI Engine against a fake OpenAI-compatible provider (httpx MockTransport).

Hosts:  good.fake       well-behaved, key "good-key-123"
        ratelimit.fake  every call answers 429
        broken.fake     chat answers 500
Models: good-model (normal), think-model (empty until max_tokens >= 2048),
        gone-model (404), text-embed-1 (embeddings)
"""

import json

import httpx
import pytest
from sqlalchemy import select

from agentic.core import crypto
from agentic.core.ssrf import BlockedURL, guard_url
from agentic.engine import client as engine_client

from .conftest import csrf, setup_owner

GOOD_KEY = "good-key-123"


def fake_provider(request: httpx.Request) -> httpx.Response:
    host, path = request.url.host, request.url.path
    if request.headers.get("authorization") != f"Bearer {GOOD_KEY}":
        return httpx.Response(401, json={"error": {"message": "Invalid API key"}})
    if host == "ratelimit.fake":
        return httpx.Response(
            429, headers={"retry-after": "30"}, json={"error": {"message": "rate limited"}}
        )
    if path.endswith("/models"):
        return httpx.Response(
            200,
            headers={"x-ratelimit-remaining-requests": "99"},
            json={
                "data": [
                    {"id": "good-model", "context_length": 8192},
                    {"id": "think-model"},
                    {"id": "text-embed-1"},
                ]
            },
        )
    if path.endswith("/embeddings"):
        return httpx.Response(
            200, json={"data": [{"embedding": [0.1] * 8}], "usage": {"prompt_tokens": 1}}
        )
    if path.endswith("/chat/completions"):
        if host == "broken.fake":
            return httpx.Response(500, text="upstream exploded")
        body = json.loads(request.content)
        model = body["model"]
        if model == "gone-model":
            return httpx.Response(404, json={"error": {"code": "model_not_found"}})
        usage = {
            "prompt_tokens": 1000,
            "completion_tokens": 200,
            "prompt_tokens_details": {"cached_tokens": 400},
        }
        if model == "think-model" and body["max_tokens"] < 2048:
            return httpx.Response(
                200,
                json={
                    "model": model,
                    "usage": usage,
                    "choices": [{"finish_reason": "length", "message": {"content": ""}}],
                },
            )
        msg: dict = {"content": "OK"}
        if body.get("tools"):
            msg = {
                "content": None,
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "get_local_time",
                            "arguments": '{"city": "Kuala Lumpur"}',
                        },
                    }
                ],
            }
        elif body.get("response_format"):
            msg = {"content": '{"ok": true}'}
        return httpx.Response(
            200,
            json={
                "model": model,
                "usage": usage,
                "choices": [{"finish_reason": "stop", "message": msg}],
            },
        )
    return httpx.Response(404, json={"error": "no route"})


@pytest.fixture(autouse=True)
def fake_transport():
    engine_client.use_transport(httpx.MockTransport(fake_provider))
    yield
    engine_client.use_transport(None)


async def add_provider(
    c: httpx.AsyncClient, name: str, host: str, key: str = GOOD_KEY, tier: str = "paid"
) -> dict:
    r = await c.post(
        "/api/ai/providers",
        json={
            "name": name,
            "base_url": f"https://{host}/v1",
            "api_key": key,
            "tier": tier,
        },
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


def events(r: httpx.Response) -> list[dict]:
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


# ---------------------------------------------------------------- building blocks


def test_envelope_encryption_binds_to_row():
    token = crypto.encrypt("sk-secret-value", "ai_provider:ap_1")
    assert "sk-secret" not in token
    assert crypto.decrypt(token, "ai_provider:ap_1") == "sk-secret-value"
    with pytest.raises(crypto.DecryptError):
        crypto.decrypt(token, "ai_provider:ap_2")  # copied onto another row


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8501/v1",
        "http://169.254.169.254/latest",
        "https://10.0.0.5/v1",
        "http://localhost:6379",
        "ftp://example.com",
        "https://user:pw@example.com/v1",
    ],
)
async def test_ssrf_guard_blocks_internal_targets(url):
    with pytest.raises(BlockedURL):
        await guard_url(url)


# ---------------------------------------------------------------- providers


async def test_task_call_limit_is_a_workspace_ai_setting(client: httpx.AsyncClient):
    await setup_owner(client)

    current = await client.get("/api/ai/settings")
    assert current.status_code == 200
    assert current.json() == {"max_task_model_calls": 30, "hard_max_task_model_calls": 200}

    saved = await client.patch(
        "/api/ai/settings",
        json={"max_task_model_calls": 60},
        headers=csrf(client),
    )
    assert saved.status_code == 200
    assert saved.json()["max_task_model_calls"] == 60
    assert (await client.get("/api/ai/settings")).json()["max_task_model_calls"] == 60

    for invalid in (0, 201):
        rejected = await client.patch(
            "/api/ai/settings", json={"max_task_model_calls": invalid}, headers=csrf(client)
        )
        assert rejected.status_code == 422


async def test_key_is_encrypted_and_never_returned(client: httpx.AsyncClient):
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    assert p["key_hint"] == "…-123" and p["has_key"] is True
    assert GOOD_KEY not in json.dumps(p)

    from agentic.core.db import SessionLocal
    from agentic.models import AIProvider

    async with SessionLocal() as db:
        row = await db.scalar(select(AIProvider))
        assert row is not None and GOOD_KEY not in row.api_key_enc
        assert crypto.decrypt(row.api_key_enc, row.aad) == GOOD_KEY


async def test_new_url_requires_key_again(client: httpx.AsyncClient):
    """A saved key must never be sent to an address it was not typed for."""
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    r = await client.patch(
        f"/api/ai/providers/{p['id']}",
        json={"base_url": "https://ratelimit.fake/v1"},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "key_required_for_new_url"

    blocked = await client.post(
        "/api/ai/providers",
        json={
            "name": "Sneaky",
            "base_url": "http://169.254.169.254/v1",
            "api_key": "whatever-key",
        },
        headers=csrf(client),
    )
    assert blocked.status_code == 400 and blocked.json()["code"] == "blocked_url"


async def test_viewer_cannot_manage_providers(client: httpx.AsyncClient):
    await setup_owner(client)
    r = await client.post(
        "/api/members",
        json={"email": "v@example.com", "name": "V", "role": "viewer"},
        headers=csrf(client),
    )
    temp = r.json()["temp_password"]
    client.cookies.clear()
    await client.post("/api/auth/login", json={"email": "v@example.com", "password": temp})
    await client.post(
        "/api/auth/change-password",
        json={"current_password": temp, "new_password": "viewer-password-9"},
        headers=csrf(client),
    )
    assert (await client.get("/api/ai/providers")).status_code == 200
    r = await client.post(
        "/api/ai/providers",
        json={"name": "X", "base_url": "https://good.fake/v1", "api_key": GOOD_KEY},
        headers=csrf(client),
    )
    assert r.status_code == 403


# ---------------------------------------------------------------- connection test


async def test_connection_test_streams_three_steps(client: httpx.AsyncClient):
    await setup_owner(client)
    p = await add_provider(client, "Groq", "good.fake")
    r = await client.post(
        "/api/ai/providers/test",
        json={
            "provider_id": p["id"],
            "model": "good-model",
            "capabilities": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    ev = events(r)
    finished = {e["step"]: e for e in ev if e["type"] == "step" and e["status"] != "running"}
    assert finished["key"]["status"] == "ok" and "3 models" in finished["key"]["detail"]
    assert finished["key"]["rate"]["x-ratelimit-remaining-requests"] == "99"
    assert finished["chat"]["status"] == "ok" and finished["chat"]["usage"]["cached"] == 400
    assert finished["tools"]["status"] == "ok"
    assert finished["json"]["status"] == "ok"
    assert finished["embed"]["status"] == "ok" and "8-dimension" in finished["embed"]["detail"]
    assert ev[-1] == {
        "type": "done",
        "ok": True,
        "model": "good-model",
        "models": ["good-model", "text-embed-1", "think-model"],
    }

    after = next(x for x in (await client.get("/api/ai/providers")).json() if x["id"] == p["id"])
    assert after["health"] == "ok" and after["model_count"] == 3
    assert len(after["recent_checks"]) == 1
    models = (await client.get(f"/api/ai/models?provider_id={p['id']}")).json()
    good = next(m for m in models if m["model_id"] == "good-model")
    assert good["caps"]["tools"] is True and good["context_window"] == 8192


async def test_unsaved_bad_key_stops_after_step_one(client: httpx.AsyncClient):
    await setup_owner(client)
    r = await client.post(
        "/api/ai/providers/test",
        json={
            "base_url": "https://good.fake/v1",
            "api_key": "wrong-key-000",
            "preset": "groq",
        },
        headers=csrf(client),
    )
    ev = events(r)
    key = next(e for e in ev if e.get("step") == "key" and e["status"] != "running")
    assert key["status"] == "failed" and key["error_class"] == "auth_rejected"
    assert "rejected" in key["detail"]
    assert next(e for e in ev if e.get("step") == "chat")["status"] == "skipped"
    assert ev[-1]["ok"] is False


async def test_reasoning_model_gets_room_to_think(client: httpx.AsyncClient):
    await setup_owner(client)
    p = await add_provider(client, "Thinker", "good.fake")
    r = await client.post(
        "/api/ai/providers/test",
        json={"provider_id": p["id"], "model": "think-model"},
        headers=csrf(client),
    )
    chat = next(e for e in events(r) if e.get("step") == "chat" and e["status"] != "running")
    assert chat["status"] == "ok" and "reasoning model" in chat["detail"]


# ---------------------------------------------------------------- routing


async def _set_group(c: httpx.AsyncClient, name: str, members: list[tuple[str, str]]) -> None:
    r = await c.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": p, "model_id": m} for p, m in members]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text


async def test_groups_seeded(client: httpx.AsyncClient):
    await setup_owner(client)
    names = [g["name"] for g in (await client.get("/api/ai/groups")).json()]
    assert names == [
        "smart",
        "fast",
        "bulk",
        "reasoning",
        "vision",
        "embed",
        "local",
        "transcribe",  # P18: speech to text
        "image",  # P18: pictures
    ]


async def test_fallback_cools_failing_provider(client: httpx.AsyncClient):
    await setup_owner(client)
    limited = await add_provider(client, "Limited", "ratelimit.fake")
    good = await add_provider(client, "Good", "good.fake")
    await _set_group(client, "smart", [(limited["id"], "good-model"), (good["id"], "good-model")])

    r = await client.post(
        "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider_name"] == "Good" and body["content"] == "OK"
    assert body["attempts"][0]["error_class"] == "rate_limited"

    again = (
        await client.post(
            "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    assert "model cooling down" in again["attempts"][0]["skipped"]
    # P29: a 429 belongs to the model; the provider itself (its other models) is not cooled.
    from agentic.engine import store

    assert 0 < await store.model_cooling_for(limited["id"], "good-model") <= 30
    listed = next(
        p for p in (await client.get("/api/ai/providers")).json() if p["name"] == "Limited"
    )
    assert listed["cooling_seconds"] == 0


async def test_a_model_scoped_failure_cools_only_that_model(client: httpx.AsyncClient):
    """P29: 403 "this account cannot use that model" must not take the provider's other
    models out of the group; a 5xx still cools the whole provider."""
    from agentic.engine import store

    await setup_owner(client)
    good = await add_provider(client, "Good", "good.fake")

    def forbidden(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/completions"):
            if json.loads(request.content)["model"] == "locked-model":
                return httpx.Response(403, json={"error": {"message": "model not allowed"}})
        return fake_provider(request)

    engine_client.use_transport(httpx.MockTransport(forbidden))
    await _set_group(client, "smart", [(good["id"], "locked-model"), (good["id"], "good-model")])
    body = (
        await client.post(
            "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    assert body["attempts"][0]["error_class"] == "forbidden" and body["content"] == "OK"
    assert await store.cooling_for(good["id"]) == 0  # the provider still answers
    assert await store.model_cooling_for(good["id"], "locked-model") > 0
    again = (
        await client.post(
            "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    assert "model cooling down" in again["attempts"][0]["skipped"] and again["content"] == "OK"

    broken = await add_provider(client, "Broken", "broken.fake")
    await _set_group(client, "fast", [(broken["id"], "good-model"), (good["id"], "good-model")])
    await client.post(
        "/api/ai/playground", json={"group": "fast", "prompt": "hi"}, headers=csrf(client)
    )
    assert await store.cooling_for(broken["id"]) > 0  # 5xx: the provider is unwell


async def test_reasoning_retry_counts_both_calls(client: httpx.AsyncClient):
    """P29: the first, starved call was billed too; its tokens are in the usage."""
    r = await engine_client.chat(
        "https://good.fake/v1",
        GOOD_KEY,
        "think-model",
        [{"role": "user", "content": "hi"}],
        max_tokens=100,
    )
    assert r.reasoning_retry and r.content == "OK"
    assert (r.usage.prompt, r.usage.completion, r.usage.cached) == (2000, 400, 800)


async def test_missing_model_marked_stale_then_skipped(client: httpx.AsyncClient):
    await setup_owner(client)
    good = await add_provider(client, "Good", "good.fake")
    await _set_group(client, "fast", [(good["id"], "gone-model"), (good["id"], "good-model")])
    first = (
        await client.post(
            "/api/ai/playground", json={"group": "fast", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    assert first["attempts"][0]["error_class"] == "model_not_found"
    second = (
        await client.post(
            "/api/ai/playground", json={"group": "fast", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    assert second["attempts"][0]["skipped"] == "model no longer offered"


async def test_empty_or_dead_group_explains_itself(client: httpx.AsyncClient):
    await setup_owner(client)
    r = await client.post(
        "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
    )
    assert r.status_code == 502 and "no models yet" in r.json()["message"]

    broken = await add_provider(client, "Broken", "broken.fake")
    await _set_group(client, "smart", [(broken["id"], "good-model")])
    r = await client.post(
        "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
    )
    assert r.status_code == 502
    assert r.json()["attempts"][0]["error_class"] == "provider_error"


async def test_cost_and_usage(client: httpx.AsyncClient):
    await setup_owner(client)
    good = await add_provider(client, "Good", "good.fake")
    await client.post(
        f"/api/ai/providers/{good['id']}/models/refresh", json={}, headers=csrf(client)
    )
    model = next(
        m for m in (await client.get("/api/ai/models")).json() if m["model_id"] == "good-model"
    )
    await client.patch(
        f"/api/ai/models/{model['id']}",
        json={"price_in": 1.0, "price_out": 4.0, "price_cached_in": 0.1},
        headers=csrf(client),
    )
    await _set_group(client, "smart", [(good["id"], "good-model")])
    body = (
        await client.post(
            "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
        )
    ).json()
    # 600 uncached * $1/M + 400 cached * $0.1/M + 200 out * $4/M
    assert body["cost_usd"] == pytest.approx(0.00144)

    usage = (await client.get("/api/ai/usage?days=1")).json()
    assert usage["totals"]["calls"] == 1 and usage["totals"]["cached"] == 400
    assert usage["by_provider"][0]["provider"] == "Good"
    assert usage["by_task"][0]["task"] == "playground"


async def test_deleting_provider_cleans_groups(client: httpx.AsyncClient):
    await setup_owner(client)
    good = await add_provider(client, "Good", "good.fake")
    await _set_group(client, "bulk", [(good["id"], "good-model")])
    r = await client.delete(
        f"/api/ai/providers/{good['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    bulk = next(g for g in (await client.get("/api/ai/groups")).json() if g["name"] == "bulk")
    assert bulk["members"] == []


async def test_public_model_list_does_not_count_as_key_check(client: httpx.AsyncClient):
    """HuggingFace's router lists models without auth; the key must be proven elsewhere."""
    from agentic.engine.presets import BY_ID

    for preset_id in ("openrouter", "huggingface"):
        assert BY_ID[preset_id].key_check != "/models", preset_id


async def test_new_models_get_the_parameters_they_accept(monkeypatch):
    """GPT-5-style models reject max_tokens and custom temperature with a 400: adapt once."""
    from agentic.engine import client as engine_client

    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "max_tokens" in body:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported parameter: 'max_tokens' is not supported "
                        "with this model. Use 'max_completion_tokens' instead."
                    }
                },
            )
        if "temperature" in body:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported value: 'temperature' does not support 0.2 "
                        "with this model. Only the default (1) value is supported."
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "model": body["model"],
                "choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}],
            },
        )

    engine_client.use_transport(httpx.MockTransport(handler))
    try:
        r = await engine_client.chat(
            "https://good.fake/v1", "k", "gpt-5.4-mini", [{"role": "user", "content": "x"}]
        )
    finally:
        engine_client.use_transport(None)
    assert r.call.ok and r.content == "hi"
    assert r.quirks == frozenset({"max_completion_tokens", "no_temperature"})
    assert (
        "max_completion_tokens" in bodies[-1]
        and "temperature" not in bodies[-1]
        and len(bodies) == 3
    )


async def test_short_rate_limit_is_waited_out_not_failed(client: httpx.AsyncClient, monkeypatch):
    """A single-model group on a free tier: the per-minute limit resets, the work goes on."""
    import asyncio as _asyncio

    from agentic.engine import gateway

    await setup_owner(client)
    p = await add_provider(client, "Free", "flaky.fake")
    await _set_group(client, "smart", [(p["id"], "good-model")])
    calls = {"n": 0}
    slept: list[float] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        if request.url.host == "flaky.fake" and request.url.path.endswith("/chat/completions"):
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(
                    429, headers={"retry-after": "6"}, json={"error": {"message": "rate limited"}}
                )
        return fake_provider(
            httpx.Request(
                request.method,
                str(request.url).replace("flaky.fake", "good.fake"),
                headers=request.headers,
                content=request.content,
            )
        )

    async def no_sleep(s: float) -> None:  # time passes: the cooldown runs out
        from agentic.core.valkey import valkey

        slept.append(s)
        for k in await valkey().keys("ai_cool*"):
            await valkey().delete(k)

    monkeypatch.setattr(gateway.asyncio, "sleep", no_sleep)
    engine_client.use_transport(httpx.MockTransport(flaky))
    r = await client.post(
        "/api/ai/playground", json={"group": "smart", "prompt": "hi"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "OK" and calls["n"] == 2 and slept and slept[0] <= 31
    _ = _asyncio
