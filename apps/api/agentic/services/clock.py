"""The time now (UTC) and the workspace's own date today (its time zone)."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Workspace


def now() -> datetime:
    return datetime.now(UTC)


async def today(db: AsyncSession, workspace_id: str) -> date:
    ws = await db.get(Workspace, workspace_id)
    try:
        zone = ZoneInfo((ws.timezone if ws else "") or "UTC")
    except Exception:  # noqa: BLE001 - a bad zone name: UTC
        zone = ZoneInfo("UTC")
    return datetime.now(zone).date()
