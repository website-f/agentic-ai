"""P109: the parts of a task for people (alembic 0067): who it is for and who follows it, its
checklist, and the files linked to it. Registered on Base.metadata by agentic/models."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base
from ..core.ids import new_id

ASSIGNEE = "assignee"
WATCHER = "watcher"


class TaskPerson(Base):
    """A person a task is for (assignee) or who follows it (watcher); one row per person.
    tasks.assignee_user_id stays the first assignee (P97 paths read it)."""

    __tablename__ = "task_people"
    __table_args__ = (
        CheckConstraint("role IN ('assignee', 'watcher')", name="ck_task_people_role"),
        Index("ix_task_people_user", "user_id", "role"),
    )

    task_id: Mapped[str] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(12), default=ASSIGNEE, server_default=ASSIGNEE)
    added_by: Mapped[str] = mapped_column(String(80), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskChecklistItem(Base):
    __tablename__ = "task_checklist_items"
    __table_args__ = (Index("ix_task_checklist_task", "task_id", "position"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tci"))
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String(300))
    done: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    position: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    created_by: Mapped[str] = mapped_column(String(80), default="", server_default="")
    done_by: Mapped[str | None] = mapped_column(String(80))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskAttachment(Base):
    """A file linked to a task: a Library guideline or another task's file stays where it is;
    the task only points at it."""

    __tablename__ = "task_attachments"
    __table_args__ = (Index("ix_task_attachments_file", "file_id"),)

    task_id: Mapped[str] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    file_id: Mapped[str] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
    )
    added_by: Mapped[str] = mapped_column(String(80), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
