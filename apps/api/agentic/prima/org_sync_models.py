"""P127 tables (migration 0078): the organization hierarchy kept in step with Prima's org chart
(prima/org_sync.py). Imported by agentic.models so Alembic and the app see them.

- prima_org_sync: one row per office member the sync has looked at: the line both sides last
  agreed on (or last showed), whether an office change still waits to reach Prima, and the
  outcome shown on the org chart page (in step, waiting for Prima, a difference and why).
- prima_org_sync_runs: one row per workspace: the last run (when, whether Prima answered,
  whether Prima's org chart settings are installed, the counts).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

# What a row shows: in step; an office line waiting for Prima; a difference (and why); a person
# the sync leaves alone (not linked, switched off).
SYNC_STATES = ("in_step", "waiting", "differs", "skipped")


class PrimaOrgSync(Base):
    __tablename__ = "prima_org_sync"
    __table_args__ = (Index("ix_prima_org_sync_ws_state", "workspace_id", "state"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The base both sides are compared with (valid once `synced_at` is set): the office manager
    # (an office user id) and Prima's manager (a Prima user id; never an "assumed" one).
    office_manager: Mapped[str | None] = mapped_column(String(40))
    prima_manager: Mapped[str | None] = mapped_column(String(120))
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # An office change (members.set_manager): when, by whom, why; `pending` until Prima has it.
    office_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pending: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    pending_by: Mapped[str | None] = mapped_column(String(200))
    pending_reason: Mapped[str | None] = mapped_column(String(300))
    # What Prima shows now (for the chart page and the export): its manager's id and name, and
    # how Prima has it ("set" by a head, "standard" from the job, "assumed", "top").
    prima_now: Mapped[str | None] = mapped_column(String(120))
    prima_now_name: Mapped[str | None] = mapped_column(String(200))
    prima_how: Mapped[str | None] = mapped_column(String(20))
    state: Mapped[str] = mapped_column(String(20), default="in_step", server_default="in_step")
    # "office" / "prima" / "none" and a short code saying why (web/org-chart-sync.tsx).
    winner: Mapped[str | None] = mapped_column(String(10))
    why: Mapped[str | None] = mapped_column(String(40))
    message: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PrimaOrgSyncRun(Base):
    __tablename__ = "prima_org_sync_runs"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ok: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Why a run could not read Prima ("prima_down", "no_top", "refused"), else None.
    problem: Mapped[str | None] = mapped_column(String(40))
    installed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
