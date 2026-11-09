"""P80: the office's AI for Prima's assistant, Arisha (apps/prima/apps/api/src/arisha-office.ts).

Arisha's loop, her rules and every tool she may use stay in Prima: Prima decides per person what
she may read or prepare. Only the model turn comes here, so she runs on the office's own AI
(the workspace's providers and model groups, its data levels and approved services), counts
toward the person's daily AI allowance and shows in the office's AI usage like any other call.

Prima's API is the only caller. It signs each call with the secret the office signs its calls
to Prima with (settings.prima_secret = Prima's OFFICE_SIGNING_SECRET), in the same scheme
(client.sign: time, method, path, who, through what, body), under its own headers (x-prima-*)
and its own "via" (prima:arisha). So a call the office signed for a person (x-office-*,
via "person") can never be passed off as this one, and this one never as a person's call to
Prima. Each signature is used once and only within five minutes of its time. The path is
/internal/..., which the web server never serves to the outside.

Prompts and answers are never logged here, nor sent to traces (obs/langfuse.py skips
"prima." jobs).
"""

import hmac
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models import Membership, PrimaLink, User, Workspace
from . import client

PATH = "/internal/prima/model"
VIA = "prima:arisha"
SKEW_SECONDS = 300
USER_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")
SIG = re.compile(r"^[0-9a-f]{64}$")

TASK = "prima.arisha"  # llm_calls.task: Arisha's turns in the AI usage pages
GROUPS = ("smart", "fast")  # the workspace's chat models: smart first, fast when it has none
# P90 (Fitri, 9 Nov 2026: Arisha answers too slowly): a quick turn is a question about using a Prima
# screen, sent with no tools and the screen guide already in the brief, so the fast models answer it
# first.
QUICK_GROUPS = ("fast", "smart")
# P90: thinking models that take the setting think briefly: Arisha explains from a written guide.
REASONING_EFFORT = "low"
MAX_TOKENS = 2000  # Prima asks for 2000 at most (max_completion_tokens)
TURN_SECONDS = 25.0  # under Prima's 30 s per call, so the person gets our plain answer
PER_MINUTE = 30  # model turns per person a minute (one question is up to 6 turns)
MAX_BODY = 400_000  # bytes: the rules, 8 recent turns, a brief and up to 12 tool results
MAX_MESSAGES = 60
MAX_TOOLS = 12
TOOL_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
ROLES = ("system", "user", "assistant", "tool")


class Refused(Exception):
    """The call is not answered: `status` and a plain message for Prima to show."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def secret() -> str:
    s = settings.prima_secret
    return s if len(s) >= 32 else ""


def _parse_ts(ts: str) -> datetime | None:
    if not TS.match(ts):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def verify(
    headers: dict[str, str], method: str, url: str, body: bytes, now: datetime | None = None
) -> str | None:
    """The Prima staff record Arisha works for, when Prima signed this call; else None.
    Replay inside the window is refused separately (once())."""
    key = secret()
    if not key:
        return None
    ts = headers.get("x-prima-ts", "")
    user = headers.get("x-prima-user", "")
    via = headers.get("x-prima-via", "")
    sig = headers.get("x-prima-signature", "").lower()
    if via != VIA or not USER_ID.match(user) or not SIG.match(sig):
        return None
    at = _parse_ts(ts)
    if at is None or abs(((now or datetime.now(UTC)) - at).total_seconds()) > SKEW_SECONDS:
        return None
    want = client.sign(ts, method, url, user, via, body)
    return user if hmac.compare_digest(sig, want) else None


async def once(signature: str) -> bool:
    """True the first time a signature is seen (kept a little past the time window)."""
    from ..core.valkey import valkey

    try:
        return bool(
            await valkey().set(
                f"prima:model:sig:{signature.lower()}", "1", nx=True, ex=SKEW_SECONDS * 2 + 60
            )
        )
    except Exception:  # noqa: BLE001 - cannot tell a replay apart: refuse
        return False


@dataclass(frozen=True)
class Person:
    workspace: Workspace
    membership: Membership


async def person_of(db: AsyncSession, prima_user: str) -> Person:
    """The office person linked to this Prima record (models.PrimaLink), still a member and
    active. Their workspace pays, within their own allowance."""
    q = select(PrimaLink).where(PrimaLink.prima_user_id == prima_user)
    if settings.prima_workspace:
        q = q.where(PrimaLink.workspace_id == settings.prima_workspace)
    links = list((await db.scalars(q.limit(2))).all())
    if len(links) != 1:
        raise Refused(403, "Open Prima from the office to ask Arisha.")
    link = links[0]
    m = await db.get(Membership, (link.workspace_id, link.user_id))
    user = await db.get(User, link.user_id)
    ws = await db.get(Workspace, link.workspace_id)
    if m is None or user is None or not user.is_active or ws is None:
        raise Refused(403, "Open Prima from the office to ask Arisha.")
    if not client.enabled(ws.id):
        raise Refused(403, "Prima is not linked to this office.")
    return Person(ws, m)


def _text(v: Any, limit: int) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise Refused(400, "Arisha sent a message the office cannot read.")
    return v[:limit]


def clean_messages(raw: Any) -> list[dict[str, Any]]:
    """Plain OpenAI chat messages only: role, text, and the assistant's tool calls and their
    results. Anything else is refused, never passed on."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_MESSAGES:
        raise Refused(400, "Arisha sent no question.")
    out: list[dict[str, Any]] = []
    for m in raw:
        if not isinstance(m, dict) or m.get("role") not in ROLES:
            raise Refused(400, "Arisha sent a message the office cannot read.")
        role = m["role"]
        msg: dict[str, Any] = {"role": role, "content": _text(m.get("content"), 40_000)}
        if role == "assistant" and m.get("tool_calls"):
            calls = m["tool_calls"]
            if not isinstance(calls, list) or len(calls) > 4:
                raise Refused(400, "Arisha sent a message the office cannot read.")
            msg["tool_calls"] = [_call(c) for c in calls]
        if role == "tool":
            msg["tool_call_id"] = _text(m.get("tool_call_id"), 100) or ""
            msg["content"] = msg["content"] or ""
        elif msg["content"] is None and role != "assistant":
            raise Refused(400, "Arisha sent a message the office cannot read.")
        out.append(msg)
    return out


def _call(c: Any) -> dict[str, Any]:
    fn = c.get("function") if isinstance(c, dict) else None
    if not isinstance(fn, dict) or not TOOL_NAME.match(str(fn.get("name") or "")):
        raise Refused(400, "Arisha sent a message the office cannot read.")
    return {
        "id": str(c.get("id") or "")[:100],
        "type": "function",
        "function": {"name": fn["name"], "arguments": _text(fn.get("arguments"), 20_000) or "{}"},
    }


def clean_tools(raw: Any) -> list[dict[str, Any]] | None:
    """OpenAI function tools (Arisha's narrow tools, chosen by Prima for this person)."""
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) > MAX_TOOLS:
        raise Refused(400, "Arisha offered tools the office cannot read.")
    out = []
    for t in raw:
        fn = t.get("function") if isinstance(t, dict) else None
        if (
            not isinstance(t, dict)
            or t.get("type") != "function"
            or not isinstance(fn, dict)
            or not TOOL_NAME.match(str(fn.get("name") or ""))
            or not isinstance(fn.get("parameters", {}), dict)
        ):
            raise Refused(400, "Arisha offered tools the office cannot read.")
        out.append(
            {
                "type": "function",
                "function": {
                    "name": fn["name"],
                    "description": str(fn.get("description") or "")[:2000],
                    "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                },
            }
        )
    return out or None


def parse_body(body: bytes) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None, int]:
    messages, tools, tokens, _quick = parse_turn(body)
    return messages, tools, tokens


def parse_turn(
    body: bytes,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None, int, bool]:
    """The messages, tools, token cap and whether Prima marked it a quick turn (speed "quick",
    only honoured with no tools: a turn that may call tools keeps the smart models first)."""
    if len(body) > MAX_BODY:
        raise Refused(413, "Arisha's question is too long. Start a new chat and ask again.")
    try:
        data = json.loads(body or b"null")
    except ValueError as e:
        raise Refused(400, "Arisha sent a message the office cannot read.") from e
    if not isinstance(data, dict):
        raise Refused(400, "Arisha sent a message the office cannot read.")
    try:
        tokens = int(data.get("max_tokens") or MAX_TOKENS)
    except (TypeError, ValueError):
        tokens = MAX_TOKENS
    messages = clean_messages(data.get("messages"))
    tools = clean_tools(data.get("tools"))
    return (
        messages,
        tools,
        max(64, min(MAX_TOKENS, tokens)),
        data.get("speed") == "quick" and tools is None,
    )


def reply_json(content: str, tool_calls: list[dict[str, Any]], usage: Any, model: str) -> dict:
    """One chat completion, in the shape Prima's Arisha loop reads (choices[0].message)."""
    calls = []
    for c in tool_calls:
        fn = c.get("function") or {}
        args = fn.get("arguments")
        calls.append(
            {
                "id": str(c.get("id") or f"call_{len(calls) + 1}"),
                "type": "function",
                "function": {
                    "name": str(fn.get("name") or ""),
                    "arguments": args if isinstance(args, str) else json.dumps(args or {}),
                },
            }
        )
    message: dict[str, Any] = {"role": "assistant", "content": content or None}
    if calls:
        message["tool_calls"] = calls
    return {
        "object": "chat.completion",
        "model": model,
        "choices": [
            {"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop"}
        ],
        "usage": {
            "prompt_tokens": usage.prompt,
            "completion_tokens": usage.completion,
            "total_tokens": usage.prompt + usage.completion,
        },
    }
