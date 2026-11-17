"""P109b table (migration 0070). Imported by agentic.models so Alembic and the app see it."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

# none: not asked to add it; added: in Prima (prima_meeting_id); failed: Prima refused or did not
# answer (prima_error says why, "Add to Prima" retries); skipped: Prima is not set up here;
# cancelled: cancelled in Prima too.
PRIMA_STATUSES = ("none", "added", "failed", "skipped", "cancelled")
# Prima's own kinds of meeting (apps/prima controllers.ts scheduleMeeting).
PRIMA_KINDS = ("board", "management", "operations", "department", "client", "toolbox", "other")


class TeamsMeeting(Timestamps, Base):
    """A Teams meeting a person made from the Microsoft 365 workspace, in their own Outlook
    calendar (`event_id`), and the Prima meeting recorded for it as that person. Only its person
    reads or changes it; a change or cancel made here also reaches the Prima record."""

    __tablename__ = "m365_meetings"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", "event_id", name="uq_m365_meetings_event"),
        CheckConstraint(
            "prima_status IN (" + ", ".join(f"'{s}'" for s in PRIMA_STATUSES) + ")",
            name="ck_m365_meetings_prima_status",
        ),
        Index("ix_m365_meetings_owner", "workspace_id", "user_id", "start_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tm"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_id: Mapped[str] = mapped_column(String(512))
    title: Mapped[str] = mapped_column(String(255), default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # [{"name": ..., "email": ...}]: who was invited (names go to Prima).
    attendees: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    agenda: Mapped[str] = mapped_column(Text, default="")
    join_url: Mapped[str | None] = mapped_column(Text)
    web_link: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20), default="management")
    prima_status: Mapped[str] = mapped_column(String(12), default="none")
    prima_meeting_id: Mapped[str | None] = mapped_column(String(120))
    prima_error: Mapped[str | None] = mapped_column(String(500))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
