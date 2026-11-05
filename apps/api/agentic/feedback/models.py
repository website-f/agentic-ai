"""P73 table. Imported by agentic.models so Alembic and the app see it."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

KINDS = ("screenshot", "general")
CATEGORIES = ("bug", "confusing", "not_needed", "idea", "praise", "other")
STATUSES = ("new", "planned", "in_progress", "done", "wont_do")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class Feedback(Timestamps, Base):
    """One piece of feedback someone sent from the floating button: what they think of a page
    (a bug, something confusing, something not needed, an idea), optionally with a screenshot
    of the page as they saw it and their own marks drawn on it. The developer reads them on the
    Feedbacks page, moves each along (new -> planned -> in progress -> done, or won't do) and
    can answer; the sender sees the status and the answer under My feedback."""

    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint(_in("kind", KINDS), name="ck_feedback_kind"),
        CheckConstraint(_in("category", CATEGORIES), name="ck_feedback_category"),
        CheckConstraint(_in("status", STATUSES), name="ck_feedback_status"),
        Index("ix_feedback_ws_created", "workspace_id", "created_at"),
        Index("ix_feedback_ws_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("fb"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # Who sent it. Kept as a name and role too, so it still reads well after they leave.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    author_name: Mapped[str] = mapped_column(String(120), default="")
    author_role: Mapped[str] = mapped_column(String(16), default="")
    kind: Mapped[str] = mapped_column(String(16))
    category: Mapped[str] = mapped_column(String(16))
    note: Mapped[str] = mapped_column(Text, default="")
    # The page they were on (its address and title) when they opened the button.
    page_path: Mapped[str] = mapped_column(String(500), default="")
    page_title: Mapped[str] = mapped_column(String(200), default="")
    marks: Mapped[int] = mapped_column(Integer, default=0)  # circles, arrows, lines drawn
    # Screen size, language, theme, browser: what helps reproduce it. Never secrets.
    context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    screenshot: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    screenshot_type: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="new")
    dev_note: Mapped[str] = mapped_column(Text, default="")  # the developer's answer
    handled_by: Mapped[str | None] = mapped_column(String(40))  # user id
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
