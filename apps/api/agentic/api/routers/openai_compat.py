"""OpenAI-compatible endpoint, so any OpenAI client (Open WebUI, scripts, IDE plugins) can
talk to an agent: `model: "agent/<slug>"`, `Authorization: Bearer agt_...` (scope "chat").

Agents answer with the same rules as dashboard chat. Errors use OpenAI's error shape so
clients show them properly.

P29: a token acts for the person who made it, as they are now. It stops working when they
leave the workspace or lose channels.manage, reaches only the agents they see, and never
reaches someone else's private assistant or AI twin.
"""

import hashlib
import json
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import runtime
from ...core.db import get_db
from ...core.ids import new_id
from ...core.security import can
from ...engine import acting, gateway
from ...models import Agent, ApiToken, Membership, User, Workspace
from ..scope import Scope

router = APIRouter(prefix="/api/v1", tags=["openai-compatible"])


class OpenAIError(Exception):
    def __init__(
        self,
        status: int,
        message: str,
        kind: str = "invalid_request_error",
        code: str | None = None,
    ):
        super().__init__(message)
        self.status, self.message, self.kind, self.code = status, message, kind, code

    def response(self) -> JSONResponse:
        return JSONResponse(
            {"error": {"message": self.message, "type": self.kind, "code": self.code}},
            status_code=self.status,
        )


async def token_from(authorization: str | None, db: AsyncSession, scope: str) -> ApiToken:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise OpenAIError(
            401,
            "Send an API token: Authorization: Bearer agt_...",
            "authentication_error",
            "missing_token",
        )
    raw = authorization.split(" ", 1)[1].strip()
    t = await db.scalar(
        select(ApiToken).where(ApiToken.token_hash == hashlib.sha256(raw.encode()).hexdigest())
    )
    now = datetime.now(UTC)
    if t is None or t.revoked_at is not None or (t.expires_at and t.expires_at < now):
        raise OpenAIError(
            401, "This token is wrong, revoked or expired.", "authentication_error", "invalid_token"
        )
    if scope not in (t.scopes or []):
        raise OpenAIError(
            403,
            f"This token does not have the '{scope}' scope.",
            "permission_error",
            "missing_scope",
        )
    await creator_scope(db, t)
    t.last_used_at = now
    await db.commit()
    return t


async def creator_scope(db: AsyncSession, t: ApiToken) -> Scope:
    """P29: the token's maker, as they are now: still a member, still allowed tokens."""
    m = await db.get(Membership, (t.workspace_id, t.created_by))
    user = await db.get(User, t.created_by)
    if m is None or user is None or not user.is_active or not can(m.role, "channels.manage"):
        raise OpenAIError(
            401,
            "The person who made this token no longer has access to it. Make a new one.",
            "authentication_error",
            "invalid_token",
        )
    return Scope.of(m.role, user.id, m.branch_id, m.department_id)


def _reachable(sc: Scope) -> ColumnElement[bool]:
    """The agents a token reaches: those its maker sees, and no one else's AI twin."""
    return and_(sc.agent_where(), or_(Agent.is_twin.is_(False), Agent.owner_user_id == sc.user_id))


async def _agents(db: AsyncSession, t: ApiToken) -> list[Agent]:
    sc = await creator_scope(db, t)
    return list(
        (
            await db.scalars(
                select(Agent)
                .where(
                    Agent.workspace_id == t.workspace_id, Agent.status == "active", _reachable(sc)
                )
                .order_by(Agent.name)
            )
        ).all()
    )


PER_MINUTE = 30  # requests per token per minute


async def _within_limits(db: AsyncSession, t: ApiToken) -> None:
    """P51: a token cannot be used to spend without limit: at most PER_MINUTE requests a
    minute, and never past its maker's daily AI allowance."""
    from ...core.valkey import valkey
    from ...teams import allowance

    key = f"oai:{t.id}:{int(time.time() // 60)}"
    n = await valkey().incr(key)
    if n == 1:
        await valkey().expire(key, 120)
    if n > PER_MINUTE:
        raise OpenAIError(
            429,
            "Too many requests. Wait a minute and try again.",
            "rate_limit_error",
            "rate_limited",
        )
    ws = await db.get(Workspace, t.workspace_id)
    if ws is not None and (left := await allowance.check(db, ws, t.created_by)) is not None:
        raise OpenAIError(429, left.note("en"), "insufficient_quota", "allowance_used")


@router.get("/models")
async def models(
    authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)
) -> Any:
    try:
        t = await token_from(authorization, db, "chat")
    except OpenAIError as e:
        return e.response()
    ws = await db.get(Workspace, t.workspace_id)
    created = int(time.time())
    return {
        "object": "list",
        "data": [
            {
                "id": f"agent/{a.slug}",
                "object": "model",
                "created": created,
                "owned_by": ws.slug if ws else "agentic",
                "description": f"{a.name}, {a.role}",
            }
            for a in await _agents(db, t)
        ],
    }


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Any:
    try:
        t = await token_from(authorization, db, "chat")
        try:
            body = await request.json()
        except ValueError as e:
            raise OpenAIError(400, "The body must be JSON.") from e
        if not isinstance(body, dict):  # P52: [] or "x" used to raise a 500
            raise OpenAIError(400, "The body must be a JSON object.")
        model = str(body.get("model") or "")
        slug = model.removeprefix("agent/")
        agent = await db.scalar(
            select(Agent).where(
                Agent.workspace_id == t.workspace_id,
                Agent.slug == slug,
                Agent.status == "active",
                _reachable(await creator_scope(db, t)),
            )
        )
        if agent is None:
            raise OpenAIError(
                404,
                f"There is no agent '{model}'. GET /api/v1/models lists them.",
                code="model_not_found",
            )
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            raise OpenAIError(400, "Send at least one message.")
        await _within_limits(db, t)
        try:
            # P51: billed to the person who made the token, within their daily AI allowance.
            with acting.person(t.created_by):
                reply = await runtime.chat_once(db, agent, messages)
        except ValueError as e:
            raise OpenAIError(400, str(e)) from e
        except gateway.GatewayUnavailable as e:
            raise OpenAIError(503, str(e), "server_error", "no_model_available") from e
    except OpenAIError as e:
        return e.response()

    cid, created, name = new_id("chatcmpl"), int(time.time()), f"agent/{agent.slug}"
    usage = {
        "prompt_tokens": reply.prompt_tokens,
        "completion_tokens": reply.completion_tokens,
        "total_tokens": reply.prompt_tokens + reply.completion_tokens,
    }
    if not body.get("stream"):
        return {
            "id": cid,
            "object": "chat.completion",
            "created": created,
            "model": name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": reply.content},
                    "finish_reason": "stop",
                }
            ],
            "usage": usage,
        }

    def chunk(delta: dict[str, Any], finish: str | None = None) -> str:
        return (
            "data: "
            + json.dumps(
                {
                    "id": cid,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": name,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
            )
            + "\n\n"
        )

    async def stream():
        # The agent loop runs tools before it answers, so the answer arrives in one piece.
        yield chunk({"role": "assistant", "content": reply.content})
        yield chunk({}, "stop")
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )
