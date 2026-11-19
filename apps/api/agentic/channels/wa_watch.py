"""P115 (Fitri, 19 Nov 2026: "WAHA sessions keeps on failing"): a watchdog for the office's WAHA
WhatsApp sessions, run on the 10-minute liveness round (workflows/reconcile_activities.py).

- WORKING: all is well; the restart count resets.
- FAILED or STOPPED: restart it (a network drop or a gateway restart comes back by itself), at
  most MAX_RESTARTS rounds in a row. NOWEB never reconnects a FAILED session on its own.
- Still down after that, or waiting for a QR scan after it was connected: only a person with the
  office phone can fix it (WhatsApp removed the linked device). Everyone who manages channels
  hears it once a day (app, Telegram, email), with the way back: Channels > Start the session
  shows a new QR code (whatsapp.waha_recover), then scan it with the office phone.

The gateway's own state is never changed here beyond a restart: logging out (dropping a dead
login) is a person's decision, from the Channels page.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..i18n import Msg
from ..models import Channel, Workspace
from . import whatsapp

log = logging.getLogger(__name__)

MAX_RESTARTS = 2
DOWN = ("FAILED", "STOPPED")


def _today(ws: Workspace | None) -> str:
    from ..teams.budget import periods

    return periods(ws.timezone if ws else "Asia/Kuala_Lumpur").day


async def _tell(db: AsyncSession, ch: Channel, number: str, why: Msg) -> list[str]:
    """Everyone who manages channels hears it, once a day per channel."""
    from . import deliver  # late: deliver imports the agents

    ws = await db.get(Workspace, ch.workspace_id)
    return await deliver.notify_people(
        db,
        ch.workspace_id,
        Msg("The office WhatsApp is disconnected"),
        Msg(
            "{why} Open Channels and press Start the session: it reconnects, or shows a new QR "
            "code to scan with the office phone ({number}).",
            why=why,
            number=number or "?",
        ),
        "/channels",
        dedupe=f"wa-down:{ch.id}:{_today(ws)}",
        perm="channels.manage",
        event="approvals",
    )


async def watch(db: AsyncSession) -> dict[str, int]:
    out = {"wa_checked": 0, "wa_restarted": 0, "wa_down": 0}
    ids: list[str] = []
    rows = (
        await db.scalars(
            select(Channel).where(Channel.kind == "whatsapp", Channel.enabled.is_(True))
        )
    ).all()
    for ch in rows:
        try:
            from .deliver import channel_token

            cfg = whatsapp.Config.load(channel_token(ch))
        except Exception:  # noqa: BLE001 - a channel we cannot read is not ours to fix
            log.warning("WhatsApp channel %s: settings unreadable", ch.id)
            continue
        if cfg.provider != "waha":
            continue
        try:
            st = await whatsapp.waha_status(cfg)
        except Exception:  # noqa: BLE001 - the gateway is down: the page says so
            log.info("WhatsApp gateway not answering for %s", ch.id)
            continue
        out["wa_checked"] += 1
        state: dict[str, Any] = dict(ch.state or {})
        now, before = st["status"], state.get("status")
        number = state.get("number") or ""
        if now == "WORKING":
            state["restarts"] = 0
            state.pop("needs_scan", None)
        elif now in DOWN and int(state.get("restarts") or 0) < MAX_RESTARTS:
            try:
                await whatsapp.waha_restart(cfg)
                out["wa_restarted"] += 1
            except Exception:  # noqa: BLE001
                log.warning("could not restart WhatsApp session of %s", ch.id, exc_info=True)
            state["restarts"] = int(state.get("restarts") or 0) + 1
        elif now in DOWN or (now == "SCAN_QR_CODE" and before == "WORKING"):
            state["needs_scan"] = True
            why = (
                Msg("WhatsApp logged the office phone out (the linked device was removed).")
                if now == "SCAN_QR_CODE" or now == "FAILED"
                else Msg("The WhatsApp session stopped and did not start again.")
            )
            try:
                ids += await _tell(db, ch, number, why)
                out["wa_down"] += 1
            except Exception:  # noqa: BLE001 - a notice never breaks the round
                log.warning("could not tell about WhatsApp %s", ch.id, exc_info=True)
        state["status"] = now
        state["checked_at"] = datetime.now(UTC).isoformat()
        ch.state = state
        flag_modified(ch, "state")
        await db.commit()
    if ids:
        from .deliver import start

        await start(ids)
    return out
