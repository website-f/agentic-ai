"""P27: which round of a form a person is on, and their submission for it (shared by the
forms API and the agents' fill_form tool)."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Form, FormSubmission, Workspace
from . import Window, missed, window


async def today_in(db: AsyncSession, workspace_id: str) -> date:
    ws = await db.get(Workspace, workspace_id)
    try:
        return datetime.now(ZoneInfo(ws.timezone if ws else "Asia/Kuala_Lumpur")).date()
    except Exception:  # noqa: BLE001 - a bad zone name falls back to UTC
        return datetime.now(UTC).date()


def shown_round(f: Form, today: date, handed: set[str]) -> tuple[str, Window | None]:
    """The round to show a person: one they missed in the last days and never handed in,
    else the open or next one; (period, window)."""
    late = missed(f.schedule, today)
    # A round that closed before the form was added was never asked of anyone.
    added = f.created_at.date() if f.created_at else None
    if late is not None and late.period not in handed and (added is None or added <= late.due):
        return late.period, late
    w = window(f.schedule, today)
    return (w.period if w else "anytime"), w


async def person_round(
    db: AsyncSession, f: Form, user_id: str, today: date, period: str | None = None
) -> str:
    """The period a person's next hand-in counts for. A "whenever needed" form reuses their
    open draft or returned one, else starts a new round."""
    mine = (
        await db.scalars(
            select(FormSubmission).where(
                FormSubmission.form_id == f.id, FormSubmission.user_id == user_id
            )
        )
    ).all()
    if (f.schedule or {}).get("every", "none") == "none":
        open_one = next((s.period for s in mine if s.status in ("draft", "returned")), None)
        return open_one or f"{today.isoformat()}-{len(mine) + 1}"
    if period:
        return period
    return shown_round(f, today, {s.period for s in mine})[0]


async def upsert(
    db: AsyncSession, f: Form, user_id: str, branch_id: str | None, period: str
) -> FormSubmission:
    s = await db.scalar(
        select(FormSubmission).where(
            FormSubmission.form_id == f.id,
            FormSubmission.user_id == user_id,
            FormSubmission.period == period,
        )
    )
    if s is None:
        s = FormSubmission(
            workspace_id=f.workspace_id,
            form_id=f.id,
            user_id=user_id,
            branch_id=branch_id,
            period=period,
            file_ids=[],
        )
        db.add(s)
    return s
