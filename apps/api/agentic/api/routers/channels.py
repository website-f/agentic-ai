"""Channels: phone push, Telegram, bindings, the delivery ledger, and API tokens."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import decisions
from ...channels import bot, deliver, telegram, webpush
from ...core import crypto
from ...core.db import get_db
from ...core.ids import new_id
from ...core.security import can
from ...models import (
    ActionToken,
    Agent,
    ApiToken,
    Approval,
    Binding,
    Channel,
    ChannelLink,
    Delivery,
    Membership,
    PushSubscription,
    User,
)
from ..deps import Principal, api_error, require
from .tasks import approval_out

router = APIRouter(prefix="/api", tags=["channels"])
SCOPES = ("chat",)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- web push


class SubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: dict[str, str]
    label: str = Field(default="This device", max_length=120)


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)


class ActIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    decision: Literal["approve", "deny"]


def _device(s: PushSubscription) -> dict[str, Any]:
    return {
        "id": s.id,
        "label": s.label,
        "created_at": s.created_at,
        "last_ok_at": s.last_ok_at,
        "failures": s.failures,
        "service": urlsplit(s.endpoint).hostname,
    }


@router.get("/push/key")
async def push_key(
    _: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    return {"public_key": (await webpush.vapid(db)).public_b64}


@router.post("/push/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe(
    body: SubscribeIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        webpush.check_endpoint(body.endpoint)
    except webpush.BadSubscription as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_subscription", str(e)) from e
    p256dh, auth = body.keys.get("p256dh", ""), body.keys.get("auth", "")
    if not p256dh or not auth:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_subscription",
            "The subscription has no keys.",
        )
    s = await db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if s is None:
        s = PushSubscription(
            endpoint=body.endpoint,
            created_at=_now(),
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            p256dh=p256dh,
            auth=auth,
            label=body.label,
        )
        db.add(s)
    else:  # the same browser, maybe signed in as someone else now
        s.workspace_id, s.user_id, s.p256dh, s.auth, s.label, s.failures = (
            principal.workspace_id,
            principal.user.id,
            p256dh,
            auth,
            body.label,
            0,
        )
    await db.commit()
    return _device(s)


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    body: EndpointIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    s = await db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if s is not None and s.user_id == principal.user.id:
        await db.delete(s)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/push/devices")
async def my_devices(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(PushSubscription)
            .where(
                PushSubscription.user_id == principal.user.id,
                PushSubscription.workspace_id == principal.workspace_id,
            )
            .order_by(PushSubscription.created_at)
        )
    ).all()
    return [_device(s) for s in rows]


@router.delete("/push/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_device(
    device_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    s = await db.get(PushSubscription, device_id)
    if s is None or s.user_id != principal.user.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "device_not_found", "That device is not yours.")
    await db.delete(s)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/push/test")
async def test_push(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    subs = (
        await db.scalars(
            select(PushSubscription).where(
                PushSubscription.user_id == principal.user.id,
                PushSubscription.workspace_id == principal.workspace_id,
            )
        )
    ).all()
    if not subs:
        raise api_error(
            status.HTTP_409_CONFLICT, "no_devices", "Turn on notifications on this device first."
        )
    results = []
    for s in subs:
        d = Delivery(
            workspace_id=principal.workspace_id,
            channel="webpush",
            target=s.id,
            kind="test",
            payload={
                "title": "Agentic Office",
                "body": "Notifications work on this device.",
                "url": "/office",
                "tag": "test",
            },
            created_at=_now(),
        )
        db.add(d)
        await db.commit()
        try:
            state = await deliver.deliver(db, d.id)
        except deliver.Retry:
            state = "failed"
        await db.refresh(d)
        results.append({"device": s.label, "state": state, "error": d.last_error})
    return {"results": results}


@router.post("/push/act")
async def act(body: ActIn, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """The Approve / Deny buttons on a notification. No session: the single-use token
    (bound to one approval and one person, 10 minutes) is the proof."""
    t = await db.scalar(
        select(ActionToken).where(ActionToken.token_hash == deliver.token_hash(body.token))
    )
    if t is None or t.used_at is not None or t.expires_at < _now():
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "token_invalid",
            "This button expired. Open the app to decide.",
        )
    t.used_at = _now()  # single use, whatever happens next
    await db.commit()
    a = await db.get(Approval, t.approval_id)
    if a is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "approval_not_found", "That approval is gone.")
    role = await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == a.workspace_id, Membership.user_id == t.user_id
        )
    )
    user = await db.get(User, t.user_id)
    if role is None or not can(role, "approvals.decide") or user is None or not user.is_active:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "You can no longer decide approvals."
        )
    try:
        await decisions.decide(db, a, f"user:{t.user_id}", body.decision, "once", via="push")
    except decisions.DecisionError as e:
        raise api_error(e.status, e.code, e.message) from e
    return {"status": a.status, "message": "Approved." if a.status == "approved" else "Denied."}


@router.get("/approve/{approval_id}")
async def approval_page(
    approval_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The one-screen approve page that iPhone notifications open."""
    a = await db.get(Approval, approval_id)
    if a is None or a.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "approval_not_found", "That approval is not here."
        )
    return (await approval_out(db, a)).model_dump()


# ---------------------------------------------------------------- telegram


class TelegramIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    name: str | None = Field(default=None, max_length=120)


class ChannelUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    enabled: bool | None = None
    token: str | None = Field(default=None, min_length=20, max_length=200)


class BindingIn(BaseModel):
    match: str = Field(min_length=2, max_length=120, pattern=r"^(dm|group|chat:-?\d{1,20})$")
    agent_id: str


async def _channel(db: AsyncSession, principal: Principal, channel_id: str) -> Channel:
    ch = await db.get(Channel, channel_id)
    if ch is None or ch.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "channel_not_found", "That channel is not here.")
    return ch


async def _channel_out(db: AsyncSession, ch: Channel, principal: Principal) -> dict[str, Any]:
    links = (
        await db.execute(
            select(ChannelLink, User.name)
            .join(User, User.id == ChannelLink.user_id)
            .where(ChannelLink.channel_id == ch.id)
        )
    ).all()
    binds = (
        await db.execute(
            select(Binding, Agent.name)
            .join(Agent, Agent.id == Binding.agent_id)
            .where(Binding.channel_id == ch.id)
        )
    ).all()
    manage = can(principal.role, "channels.manage")
    st = ch.state or {}
    return {
        "id": ch.id,
        "kind": ch.kind,
        "name": ch.name,
        "enabled": ch.enabled,
        "bot_username": st.get("username"),
        "last_error": st.get("last_error"),
        "links": [
            {
                "id": link.id,
                "user_id": link.user_id,
                "user_name": uname,
                "display": link.display,
                "created_at": link.created_at,
            }
            for link, uname in links
            if manage or link.user_id == principal.user.id
        ],
        "linked": any(link.user_id == principal.user.id for link, _ in links),
        "bindings": [
            {"id": b.id, "match": b.match, "agent_id": b.agent_id, "agent_name": an}
            for b, an in binds
        ],
        "created_at": ch.created_at,
    }


@router.get("/channels")
async def list_channels(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(Channel)
            .where(Channel.workspace_id == principal.workspace_id)
            .order_by(Channel.created_at)
        )
    ).all()
    return [await _channel_out(db, ch, principal) for ch in rows]


async def _check_bot(token: str) -> dict[str, Any]:
    try:
        me = await telegram.get_me(token.strip())
    except telegram.TelegramError as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_token",
            f"Telegram did not accept that token: {e}",
        ) from e
    except Exception as e:  # noqa: BLE001 - offline, DNS and the like
        raise api_error(
            status.HTTP_502_BAD_GATEWAY,
            "telegram_unreachable",
            "Could not reach Telegram from the server.",
        ) from e
    if not me.get("is_bot"):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_token", "That token is not a bot token."
        )
    return me


@router.post("/channels/telegram", status_code=status.HTTP_201_CREATED)
async def add_telegram(
    body: TelegramIn,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    me = await _check_bot(body.token)
    cid = new_id("ch")
    ch = Channel(
        id=cid,
        workspace_id=principal.workspace_id,
        kind="telegram",
        name=body.name or f"@{me.get('username')}",
        config_enc=crypto.encrypt(body.token.strip(), f"channel:{cid}"),
        state={"username": me.get("username"), "bot_id": me.get("id")},
        enabled=True,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return await _channel_out(db, ch, principal)


@router.patch("/channels/{channel_id}")
async def update_channel(
    channel_id: str,
    body: ChannelUpdateIn,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _channel(db, principal, channel_id)
    if body.token:
        me = await _check_bot(body.token)
        ch.config_enc = crypto.encrypt(body.token.strip(), f"channel:{ch.id}")
        ch.state = {"username": me.get("username"), "bot_id": me.get("id")}
    if body.name is not None:
        ch.name = body.name.strip() or ch.name
    if body.enabled is not None:
        ch.enabled = body.enabled
        if body.enabled:
            ch.state = {**(ch.state or {}), "last_error": None}
    await db.commit()
    await db.refresh(ch)
    return await _channel_out(db, ch, principal)


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    channel_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.delete(await _channel(db, principal, channel_id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/channels/{channel_id}/link-code")
async def link_code(
    channel_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _channel(db, principal, channel_id)
    code = await bot.new_link_code(ch.id, principal.user.id)
    username = (ch.state or {}).get("username")
    return {
        "code": code,
        "url": f"https://t.me/{username}?start={code}" if username else None,
        "expires_in": bot.LINK_TTL,
    }


@router.delete("/channels/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink(
    link_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    link = await db.get(ChannelLink, link_id)
    ch = await db.get(Channel, link.channel_id) if link else None
    if (
        link is None
        or ch is None
        or ch.workspace_id != principal.workspace_id
        or (link.user_id != principal.user.id and not can(principal.role, "channels.manage"))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "link_not_found", "That link is not here.")
    await db.delete(link)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/channels/{channel_id}/bindings")
async def put_binding(
    channel_id: str,
    body: BindingIn,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _channel(db, principal, channel_id)
    agent = await db.get(Agent, body.agent_id)
    if agent is None or agent.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    b = await db.scalar(
        select(Binding).where(Binding.channel_id == ch.id, Binding.match == body.match)
    )
    if b is None:
        db.add(Binding(channel_id=ch.id, match=body.match, agent_id=agent.id, created_at=_now()))
    else:
        b.agent_id = agent.id
    await db.commit()
    return await _channel_out(db, ch, principal)


@router.delete("/channels/{channel_id}/bindings/{binding_id}")
async def delete_binding(
    channel_id: str,
    binding_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _channel(db, principal, channel_id)
    b = await db.get(Binding, binding_id)
    if b is not None and b.channel_id == ch.id:
        await db.delete(b)
        await db.commit()
    return await _channel_out(db, ch, principal)


# ---------------------------------------------------------------- the ledger


@router.get("/deliveries")
async def list_deliveries(
    state: Literal["all", "pending", "sent", "failed", "skipped"] = "all",
    limit: int = 100,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    conds = [Delivery.workspace_id == principal.workspace_id]
    if state != "all":
        conds.append(Delivery.state == state)
    rows = (
        await db.scalars(
            select(Delivery)
            .where(*conds)
            .order_by(Delivery.created_at.desc())
            .limit(min(limit, 300))
        )
    ).all()
    counts = dict(
        (
            await db.execute(
                select(Delivery.state, func.count())
                .where(Delivery.workspace_id == principal.workspace_id)
                .group_by(Delivery.state)
            )
        ).all()
    )
    return {
        "counts": counts,
        "items": [
            {
                "id": d.id,
                "channel": d.channel,
                "kind": d.kind,
                "state": d.state,
                "attempts": d.attempts,
                "last_error": d.last_error,
                "created_at": d.created_at,
                "sent_at": d.sent_at,
                "summary": str(d.payload.get("title") or d.payload.get("text") or "")[:140],
            }
            for d in rows
        ],
    }


@router.post("/deliveries/{delivery_id}/retry")
async def retry_delivery(
    delivery_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    d = await db.get(Delivery, delivery_id)
    if d is None or d.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "delivery_not_found", "That delivery is not here."
        )
    if d.state != "failed":
        raise api_error(
            status.HTTP_409_CONFLICT, "not_failed", "Only failed deliveries can be retried."
        )
    if d.channel == "webpush" and d.kind == "approval":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "expired",
            "Approval notifications are not resent; the app shows it.",
        )
    d.state, d.attempts, d.last_error = "pending", 0, None
    await db.commit()
    await deliver.start([d.id])
    return {"state": "pending"}


# ---------------------------------------------------------------- API tokens


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[Literal["chat"]] = Field(default_factory=lambda: ["chat"], min_length=1)
    expires_days: int | None = Field(default=90, ge=1, le=3650)


def _token_out(t: ApiToken, creator: str | None = None) -> dict[str, Any]:
    return {
        "id": t.id,
        "name": t.name,
        "prefix": t.prefix,
        "scopes": t.scopes,
        "created_at": t.created_at,
        "created_by_name": creator,
        "expires_at": t.expires_at,
        "last_used_at": t.last_used_at,
        "revoked": t.revoked_at is not None,
    }


@router.get("/tokens")
async def list_tokens(
    principal: Principal = Depends(require("channels.manage")), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(ApiToken, User.name)
            .join(User, User.id == ApiToken.created_by)
            .where(ApiToken.workspace_id == principal.workspace_id)
            .order_by(ApiToken.created_at.desc())
        )
    ).all()
    return [_token_out(t, n) for t, n in rows]


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
async def create_token(
    body: TokenIn,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    raw = "agt_" + secrets.token_urlsafe(30)
    t = ApiToken(
        workspace_id=principal.workspace_id,
        name=body.name.strip(),
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        prefix=raw[:10],
        scopes=list(dict.fromkeys(body.scopes)),
        created_by=principal.user.id,
        expires_at=_now() + timedelta(days=body.expires_days) if body.expires_days else None,
        created_at=_now(),
    )
    db.add(t)
    await db.commit()
    return {**_token_out(t, principal.user.name), "token": raw}  # shown once, never again


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(
    token_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    t = await db.get(ApiToken, token_id)
    if t is None or t.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "token_not_found", "That token is not here.")
    t.revoked_at = t.revoked_at or _now()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
