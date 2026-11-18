"""P114 (Fitri, 18 Nov 2026): every person's own notification settings, for every role.

- GET  /api/me/notifications       how I am told (email, this app, Telegram, WhatsApp), about what
- PUT  /api/me/notifications       change it (services/notify_prefs.py)
- POST /api/me/notifications/test  a test notice on every channel I left on

Linking Telegram or WhatsApp stays where it was (POST /api/channels/{id}/link-code); the page
shows the office's channels from GET /api/channels.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...channels import deliver
from ...core.db import get_db
from ...core.workspace_settings import system_mail, valid_address
from ...i18n import Msg
from ...models import Channel, ChannelLink, PushSubscription, User, Workspace
from ...services import notify_prefs, prefs
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/me", tags=["notifications"])


class NotifyIn(BaseModel):
    channels: dict[str, bool] | None = None
    events: dict[str, bool] | None = None
    email_other: bool | None = None


class NotifyOut(BaseModel):
    channels: dict[str, bool]
    events: dict[str, bool]
    email_other: bool
    email: str
    email_ready: bool  # the office's system mailbox is on and the address is real
    devices: int  # this person's phones and browsers with notifications on
    telegram: int  # their linked chats
    whatsapp: int


async def _out(db: AsyncSession, principal: Principal) -> NotifyOut:
    user = await db.get(User, principal.user.id)
    ws = await db.get(Workspace, principal.workspace_id)
    s = notify_prefs.settings_of(user)
    devices = await db.scalar(
        select(func.count())
        .select_from(PushSubscription)
        .where(
            PushSubscription.user_id == principal.user.id,
            PushSubscription.workspace_id == principal.workspace_id,
        )
    )
    links = dict(
        (
            await db.execute(
                select(Channel.kind, func.count())
                .join(ChannelLink, ChannelLink.channel_id == Channel.id)
                .where(
                    ChannelLink.user_id == principal.user.id,
                    Channel.workspace_id == principal.workspace_id,
                    Channel.enabled.is_(True),
                )
                .group_by(Channel.kind)
            )
        ).all()
    )
    email = (user.email if user else "") or ""
    return NotifyOut(
        channels=s["channels"],
        events=s["events"],
        email_other=s["email_other"],
        email=email,
        email_ready=system_mail(ws.settings if ws else None).ready and valid_address(email),
        devices=int(devices or 0),
        telegram=int(links.get("telegram", 0)),
        whatsapp=int(links.get("whatsapp", 0)),
    )


@router.get("/notifications")
async def my_notifications(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> NotifyOut:
    return await _out(db, principal)


@router.put("/notifications")
async def set_my_notifications(
    body: NotifyIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> NotifyOut:
    patch: dict[str, Any] = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "nothing", "Send at least one setting."
        )
    try:
        await prefs.update(db, principal.user.id, {"notify": patch})
    except prefs.PrefsError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_setting", str(e)) from e
    await db.commit()
    return await _out(db, principal)


class TestOut(BaseModel):
    queued: int


@router.post("/notifications/test")
async def test_my_notifications(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> TestOut:
    """One notice on each channel the person left on (as if their AI asked them something)."""
    ids = await deliver.notify_user(
        db,
        principal.workspace_id,
        principal.user.id,
        Msg("Test notification"),
        Msg("This is how the office tells you when your AI needs you."),
        "/notifications",
        dedupe=f"test:{principal.user.id}:{datetime.now(UTC).timestamp():.0f}",
        event="my_ai",
    )
    await deliver.start(ids)
    return TestOut(queued=len(ids))
