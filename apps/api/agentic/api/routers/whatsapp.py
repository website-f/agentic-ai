"""WhatsApp channel (P16): connect the office number (WAHA or Meta Cloud API), watch its
status and login QR, send a test, and receive messages through signed webhooks."""

import json
import logging
import secrets
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...channels import deliver, wa_bot, whatsapp
from ...core import crypto
from ...core.config import settings
from ...core.db import SessionLocal, get_db
from ...core.ids import new_id
from ...core.security import can
from ...models import Channel, ChannelLink
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["whatsapp"])
log = logging.getLogger("agentic.api.whatsapp")


class WhatsAppIn(BaseModel):
    provider: str = Field(pattern="^(waha|meta)$")
    name: str | None = Field(default=None, max_length=120)
    # WAHA
    base_url: str | None = Field(default=None, max_length=300)
    api_key: str | None = Field(default=None, max_length=300)
    session: str | None = Field(default=None, max_length=60, pattern=r"^[A-Za-z0-9_-]+$")
    # Meta
    phone_number_id: str | None = Field(default=None, max_length=60)
    token: str | None = Field(default=None, max_length=1000)
    app_secret: str | None = Field(default=None, max_length=200)
    template: str | None = Field(default=None, max_length=120)
    template_lang: str | None = Field(default=None, max_length=12)


def _cfg(ch: Channel) -> whatsapp.Config:
    return whatsapp.Config.load(crypto.decrypt(ch.config_enc, f"channel:{ch.id}"))


def _save(ch: Channel, cfg: whatsapp.Config) -> None:
    ch.config_enc = crypto.encrypt(cfg.dump(), f"channel:{ch.id}")


def waha_hook(ch_id: str) -> str:
    return f"{settings.internal_api_url.rstrip('/')}/api/whatsapp/hook/waha/{ch_id}"


def meta_hook(ch_id: str) -> str:
    return f"{settings.public_url.rstrip('/')}/api/whatsapp/hook/meta/{ch_id}"


async def _wa_channel(db: AsyncSession, principal: Principal, channel_id: str) -> Channel:
    ch = await db.get(Channel, channel_id)
    if ch is None or ch.workspace_id != principal.workspace_id or ch.kind != "whatsapp":
        raise api_error(status.HTTP_404_NOT_FOUND, "channel_not_found", "That channel is not here.")
    return ch


async def _status(ch: Channel, cfg: whatsapp.Config, with_qr: bool = True) -> dict[str, Any]:
    """Live state: connected or not, the number, and the QR while waiting to be scanned."""
    out: dict[str, Any] = {
        "provider": cfg.provider,
        "status": "UNKNOWN",
        "number": None,
        "qr": None,
    }
    try:
        if cfg.provider == "waha":
            st = await whatsapp.waha_status(cfg)
            out["status"] = st["status"]
            me = st.get("me") or {}
            out["number"] = (me.get("id") or "").split("@")[0] or None
            out["display"] = me.get("pushName")
            if with_qr and st["status"] == "SCAN_QR_CODE":
                out["qr"] = await whatsapp.waha_qr(cfg)
        else:
            info = await whatsapp.meta_check(cfg)
            out["status"] = "WORKING"
            out["number"] = whatsapp.digits(info.get("display_phone_number", "")) or None
            out["display"] = info.get("verified_name")
    except whatsapp.WhatsAppError as e:
        out["status"], out["error"] = "FAILED", str(e)[:300]
    except Exception as e:  # noqa: BLE001 - the gateway is down or unreachable
        out["status"] = "UNREACHABLE"
        out["error"] = (
            f"Could not reach {'WAHA' if cfg.provider == 'waha' else 'Meta'}: "
            f"{e.__class__.__name__}"
        )
    return out


@router.post("/channels/whatsapp", status_code=status.HTTP_201_CREATED)
async def add_whatsapp(
    body: WhatsAppIn,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if await db.scalar(
        select(Channel.id).where(
            Channel.workspace_id == principal.workspace_id, Channel.kind == "whatsapp"
        )
    ):
        raise api_error(
            status.HTTP_409_CONFLICT, "exists", "WhatsApp is already connected. Remove it first."
        )
    cid = new_id("ch")
    if body.provider == "waha":
        cfg = whatsapp.Config(
            provider="waha",
            base_url=(body.base_url or settings.waha_url).strip(),
            api_key=(body.api_key or settings.waha_api_key).strip(),
            session=body.session or "default",
            webhook_secret=secrets.token_urlsafe(32),
        )
    else:
        if not (body.phone_number_id and body.token and body.app_secret):
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "missing",
                "The Meta Cloud API needs the phone number id, a permanent token and "
                "the app secret.",
            )
        cfg = whatsapp.Config(
            provider="meta",
            phone_number_id=body.phone_number_id.strip(),
            token=body.token.strip(),
            app_secret=body.app_secret.strip(),
            verify_token=secrets.token_urlsafe(18),
            template=(body.template or "").strip(),
            template_lang=(body.template_lang or "en").strip(),
        )
    ch = Channel(
        id=cid,
        workspace_id=principal.workspace_id,
        kind="whatsapp",
        name=body.name or ("WhatsApp (WAHA)" if cfg.provider == "waha" else "WhatsApp Business"),
        config_enc="",
        state={"provider": cfg.provider},
        enabled=True,
    )
    _save(ch, cfg)
    db.add(ch)
    await db.commit()
    st: dict[str, Any] = {}
    if cfg.provider == "waha":
        try:
            await whatsapp.waha_start(cfg, waha_hook(cid))
        except Exception as e:  # noqa: BLE001 - saved anyway; the page shows the error and a retry
            ch.state = {**ch.state, "last_error": f"Could not start the WAHA session: {e}"[:300]}
            await db.commit()
    st = await _status(ch, cfg)
    ch.state = {**ch.state, "number": st.get("number"), "status": st["status"]}
    await db.commit()
    return {"id": ch.id, **st}


@router.get("/channels/{channel_id}/whatsapp")
async def whatsapp_status(
    channel_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _wa_channel(db, principal, channel_id)
    cfg = _cfg(ch)
    manage = can(principal.role, "channels.manage")
    st = await _status(ch, cfg, with_qr=manage)
    if cfg.provider == "waha" and st["status"] == "WORKING":
        try:  # sessions made by an older version listen to fewer events
            await whatsapp.waha_ensure_webhook(cfg, waha_hook(ch.id))
        except Exception:  # noqa: BLE001 - next status check tries again
            log.info("could not update the WAHA webhook for %s", ch.id)
    if st.get("number") and st["number"] != (ch.state or {}).get("number"):
        ch.state = {**(ch.state or {}), "number": st["number"]}
        await db.commit()
    out = {**st, "id": ch.id, "name": ch.name, "enabled": ch.enabled}
    if manage:
        out["webhook_url"] = waha_hook(ch.id) if cfg.provider == "waha" else meta_hook(ch.id)
        if cfg.provider == "meta":
            out["verify_token"] = cfg.verify_token
            out["template"] = cfg.template
        else:
            out["base_url"], out["session"] = cfg.base_url, cfg.session
    return out


@router.post("/channels/{channel_id}/whatsapp/start")
async def whatsapp_start(
    channel_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _wa_channel(db, principal, channel_id)
    cfg = _cfg(ch)
    if cfg.provider != "waha":
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "not_waha", "Only WAHA sessions are started here."
        )
    try:
        await whatsapp.waha_start(cfg, waha_hook(ch.id))
    except Exception as e:  # noqa: BLE001
        raise api_error(status.HTTP_502_BAD_GATEWAY, "waha_failed", f"WAHA: {e}"[:300]) from e
    return await _status(ch, cfg)


@router.post("/channels/{channel_id}/whatsapp/logout")
async def whatsapp_logout(
    channel_id: str,
    principal: Principal = Depends(require("channels.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ch = await _wa_channel(db, principal, channel_id)
    cfg = _cfg(ch)
    if cfg.provider == "waha":
        try:
            await whatsapp.waha_logout(cfg)
        except Exception as e:  # noqa: BLE001
            raise api_error(status.HTTP_502_BAD_GATEWAY, "waha_failed", f"WAHA: {e}"[:300]) from e
    return await _status(ch, cfg)


@router.post("/channels/{channel_id}/whatsapp/test")
async def whatsapp_test(
    channel_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Send a test message to my own linked WhatsApp."""
    ch = await _wa_channel(db, principal, channel_id)
    link = await db.scalar(
        select(ChannelLink).where(
            ChannelLink.channel_id == ch.id, ChannelLink.user_id == principal.user.id
        )
    )
    if link is None:
        raise api_error(status.HTTP_400_BAD_REQUEST, "not_linked", "Link your WhatsApp first.")
    did = await deliver.queue_whatsapp(
        db, ch, link.chat_id, f"✅ Test from {settings.public_url}: WhatsApp works.", kind="test"
    )
    state = "pending"
    if did:
        try:
            state = await deliver.deliver(db, did)
        except deliver.Retry as e:
            return {"state": "retrying", "error": str(e)}
    return {"state": state}


# ---------------------------------------------------------------- webhooks (no login; signed)


async def _handle_later(channel_id: str, items: list[whatsapp.Inbound]) -> None:
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        if ch is None or not ch.enabled:
            return
        for msg in items:
            try:
                await wa_bot.handle(db, ch, msg)
            except Exception:  # noqa: BLE001 - one bad message must not drop the rest
                log.warning("whatsapp message failed on %s", channel_id, exc_info=True)


@router.post("/whatsapp/hook/waha/{channel_id}")
async def waha_webhook(
    channel_id: str, request: Request, background: BackgroundTasks
) -> dict[str, bool]:
    body = await request.body()
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        if ch is None or ch.kind != "whatsapp":
            raise api_error(status.HTTP_404_NOT_FOUND, "channel_not_found", "No such channel.")
        cfg = _cfg(ch)
        if cfg.provider != "waha" or not whatsapp.verify_waha(
            cfg, body, request.headers.get("x-webhook-hmac")
        ):
            raise api_error(status.HTTP_401_UNAUTHORIZED, "bad_signature", "Signature mismatch.")
        payload = json.loads(body or b"{}")
        if payload.get("event") == "session.status":
            new = ((payload.get("payload") or {}).get("status")) or "UNKNOWN"
            ch.state = {**(ch.state or {}), "status": new}
            await db.commit()
    items = whatsapp.parse_waha(payload)
    if items:
        background.add_task(_handle_later, channel_id, items)  # answer the gateway at once
    return {"ok": True}


@router.get("/whatsapp/hook/meta/{channel_id}")
async def meta_verify(
    channel_id: str,
    mode: str = Query(alias="hub.mode", default=""),
    token: str = Query(alias="hub.verify_token", default=""),
    challenge: str = Query(alias="hub.challenge", default=""),
) -> Response:
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        cfg = _cfg(ch) if ch is not None and ch.kind == "whatsapp" else None
    if cfg is None or mode != "subscribe" or not secrets.compare_digest(token, cfg.verify_token):
        return PlainTextResponse("forbidden", status_code=403)
    return PlainTextResponse(challenge)


@router.post("/whatsapp/hook/meta/{channel_id}")
async def meta_webhook(
    channel_id: str, request: Request, background: BackgroundTasks
) -> dict[str, bool]:
    body = await request.body()
    async with SessionLocal() as db:
        ch = await db.get(Channel, channel_id)
        if ch is None or ch.kind != "whatsapp":
            raise api_error(status.HTTP_404_NOT_FOUND, "channel_not_found", "No such channel.")
        cfg = _cfg(ch)
    if cfg.provider != "meta" or not whatsapp.verify_meta(
        cfg, body, request.headers.get("x-hub-signature-256")
    ):
        raise api_error(status.HTTP_401_UNAUTHORIZED, "bad_signature", "Signature mismatch.")
    items = whatsapp.parse_meta(json.loads(body or b"{}"))
    if items:
        background.add_task(_handle_later, channel_id, items)
    return {"ok": True}
