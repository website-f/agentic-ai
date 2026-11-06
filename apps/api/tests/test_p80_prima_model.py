"""P80: Prima's assistant (Arisha) runs on the office's AI. Prima's API signs one model turn at a
time (agentic/prima/model.py, the scheme of prima/client.py under its own x-prima-* headers and
via "prima:arisha"); the office answers through its gateway as the linked person, within their
daily AI allowance, and records the call like any other."""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import LLMCall, Membership, PrimaLink, User
from agentic.prima import model

from .conftest import csrf
from .test_agents import llm, office  # noqa: F401

SECRET = "p" * 40
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "task_guide",
            "description": "Read only. The guide cards.",
            "parameters": {"type": "object", "properties": {"cardId": {"type": "string"}}},
        },
    }
]
MESSAGES = [
    {"role": "system", "content": "You are Arisha, the AI assistant in Prima Secure."},
    {"role": "user", "content": "How do I apply for leave?"},
]


@pytest.fixture
def prima_on(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")


def _ts(at: datetime | None = None) -> str:
    at = at or datetime.now(UTC)
    return at.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def signed(
    body: bytes,
    user: str = "u-owner",
    via: str = model.VIA,
    ts: str | None = None,
    key: str = SECRET,
    path: str = model.PATH,
) -> dict[str, str]:
    """What Prima's API sends (apps/prima/apps/api/src/arisha-office.ts)."""
    ts = ts or _ts()
    head = f"{ts}\nPOST\n{path}\n{user}\n{via}\n".encode()
    sig = hmac.new(key.encode(), head + body, hashlib.sha256).hexdigest()
    return {
        "content-type": "application/json",
        "x-prima-ts": ts,
        "x-prima-user": user,
        "x-prima-via": via,
        "x-prima-signature": sig,
    }


def _body(**extra) -> bytes:
    return json.dumps({"messages": MESSAGES, "tools": TOOLS, "max_tokens": 2000, **extra}).encode()


def test_only_prima_s_own_signature_is_accepted(prima_on):
    body = _body()
    h = signed(body)
    assert model.verify(h, "POST", model.PATH, body) == "u-owner"
    # Tampered body, person, path or signature.
    assert model.verify(h, "POST", model.PATH, body + b" ") is None
    assert model.verify({**h, "x-prima-user": "u-ceo"}, "POST", model.PATH, body) is None
    assert model.verify(h, "POST", "/internal/prima/other", body) is None
    assert model.verify({**h, "x-prima-signature": "0" * 64}, "POST", model.PATH, body) is None
    # Another secret.
    assert model.verify(signed(body, key="q" * 40), "POST", model.PATH, body) is None
    # Outside the five-minute window, either way.
    old = signed(body, ts=_ts(datetime.now(UTC) - timedelta(minutes=6)))
    assert model.verify(old, "POST", model.PATH, body) is None
    ahead = signed(body, ts=_ts(datetime.now(UTC) + timedelta(minutes=6)))
    assert model.verify(ahead, "POST", model.PATH, body) is None
    # A call signed for a person (via "person", as the office signs its calls to Prima) is
    # never this one, even correctly signed with the same secret...
    assert model.verify(signed(body, via="person"), "POST", model.PATH, body) is None
    assert model.verify(signed(body, via="agent:Aina"), "POST", model.PATH, body) is None
    # ...nor is the office's own x-office-* signature, moved or not.
    office = {
        "x-office-ts": h["x-prima-ts"],
        "x-office-user": "u-owner",
        "x-office-via": "person",
        "x-office-signature": h["x-prima-signature"],
    }
    assert model.verify(office, "POST", model.PATH, body) is None
    # No secret (or a short one): nothing is accepted.
    settings.prima_secret = "short"
    assert model.verify(h, "POST", model.PATH, body) is None


async def _link(email: str, prima_user: str) -> str:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        db.add(
            PrimaLink(
                workspace_id=m.workspace_id,
                user_id=user.id,
                prima_user_id=prima_user,
                prima_name="Owner One",
                how="owner",
                linked_by="test",
            )
        )
        await db.commit()
        return user.id


async def _ask(app_client: httpx.AsyncClient, body: bytes, headers: dict[str, str]):
    # Prima has no office session: a fresh client, no cookies.
    async with httpx.AsyncClient(transport=app_client._transport, base_url="http://api") as c:
        return await c.post(model.PATH, content=body, headers=headers)


async def test_a_turn_runs_on_the_office_ai_as_the_linked_person(client, llm, prima_on):
    await office(client)
    owner = await _link("owner@example.com", "u-owner")
    llm.call("task_guide", cardId="leave")
    body = _body()
    h = signed(body)
    r = await _ask(client, body, h)
    assert r.status_code == 200, r.text
    msg = r.json()["choices"][0]["message"]
    assert msg["role"] == "assistant"
    call = msg["tool_calls"][0]
    assert call["type"] == "function" and call["function"]["name"] == "task_guide"
    assert json.loads(call["function"]["arguments"]) == {"cardId": "leave"}
    assert r.json()["usage"]["total_tokens"] == 120
    # The provider got Arisha's rules, the question and her tools, within the token cap.
    sent = llm.requests[-1]
    assert sent["messages"][0]["content"].startswith("You are Arisha")
    assert sent["tools"][0]["function"]["name"] == "task_guide"
    assert sent.get("max_tokens", sent.get("max_completion_tokens")) <= model.MAX_TOKENS
    # Recorded like any office AI call, against the person.
    async with SessionLocal() as db:
        rows = (await db.scalars(select(LLMCall).where(LLMCall.task == model.TASK))).all()
    assert len(rows) == 1 and rows[0].user_id == owner and rows[0].status == "ok"

    # The same signed call again is a replay: refused, and no model is asked.
    n = len(llm.requests)
    again = await _ask(client, body, h)
    assert again.status_code == 401 and len(llm.requests) == n

    # A tool result comes back and she answers in words.
    llm.say("Open **Leave**, then press Apply.")
    follow = json.dumps(
        {
            "messages": [
                *MESSAGES,
                {"role": "assistant", "content": None, "tool_calls": [call]},
                {"role": "tool", "tool_call_id": call["id"], "content": '{"cards": []}'},
            ],
            "tools": TOOLS,
        }
    ).encode()
    r = await _ask(client, follow, signed(follow))
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"].startswith("Open **Leave**")
    assert "tool_calls" not in r.json()["choices"][0]["message"]
    assert llm.requests[-1]["messages"][-1]["role"] == "tool"


async def test_refusals_are_plain_and_fail_closed(client, llm, prima_on):
    await office(client)
    body = _body()
    # Not linked to anyone in the office.
    r = await _ask(client, body, signed(body, user="u-nobody"))
    assert r.status_code == 403 and "from the office" in r.json()["message"]
    owner = await _link("owner@example.com", "u-owner")
    # A person-signed call (the office's own headers) is not Prima's.
    h = signed(body, via="person")
    office_headers = {
        "content-type": "application/json",
        "x-office-ts": h["x-prima-ts"],
        "x-office-user": "u-owner",
        "x-office-via": "person",
        "x-office-signature": h["x-prima-signature"],
    }
    for headers in (h, office_headers):
        r = await _ask(client, body, headers)
        assert r.status_code == 401 and r.json() == {"message": "Not allowed."}
    # Malformed: refused before any model.
    bad = json.dumps({"messages": [{"role": "boss", "content": "x"}]}).encode()
    r = await _ask(client, bad, signed(bad))
    assert r.status_code == 400 and not llm.requests

    # The person's daily AI allowance (P36) counts Arisha too: once it is used, she stops.
    async with SessionLocal() as db:
        m = await db.scalar(select(Membership).where(Membership.user_id == owner))
        m.ai_daily_tokens = 100
        await db.commit()
    llm.say("First answer.")
    r = await _ask(client, body, signed(body))
    assert r.status_code == 200
    n = len(llm.requests)
    r = await _ask(client, body, signed(body))
    assert r.status_code == 429 and "allowance" in r.json()["message"]
    assert len(llm.requests) == n
    async with SessionLocal() as db:
        m = await db.scalar(select(Membership).where(Membership.user_id == owner))
        m.ai_daily_tokens = None
        await db.commit()


async def test_no_model_answers_with_a_plain_message(client, llm, prima_on):
    await office(client)
    await _link("owner@example.com", "u-owner")
    r = await client.put("/api/ai/groups/smart", json={"members": []}, headers=csrf(client))
    assert r.status_code == 200, r.text
    body = _body()
    r = await _ask(client, body, signed(body))
    assert r.status_code == 503 and "AI Engine" in r.json()["message"]
    assert not llm.requests


async def test_too_many_turns_a_minute_are_refused(client, llm, prima_on, monkeypatch):
    await office(client)
    await _link("owner@example.com", "u-owner")
    monkeypatch.setattr(model, "PER_MINUTE", 1)
    llm.say("One.").say("Two.")
    body = _body()
    assert (await _ask(client, body, signed(body))).status_code == 200
    r = await _ask(client, body, signed(body))
    assert r.status_code == 429 and "Wait a minute" in r.json()["message"]
