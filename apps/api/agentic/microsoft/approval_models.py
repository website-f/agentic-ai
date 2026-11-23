"""P127 table (migration 0079). Imported by agentic.models so Alembic and the app see it."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

ANSWER_STATUSES = ("pending", "sent", "discarded", "failed")


class ApprovalAnswer(Timestamps, Base):
    """An answer (Approve / Reject with a reason) a person's own AI prepared for a Microsoft
    approval that waits for that person. Nothing reaches Microsoft until the person themselves
    presses Send on the Approvals page (microsoft/org_approvals.py): never a manager, never the
    AI. `approval_id` is Microsoft's id of the approval; `ms_account_id` the person's own account
    in which they are an approver."""

    __tablename__ = "m365_approval_answers"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in ANSWER_STATUSES) + ")",
            name="ck_m365_approval_answers_status",
        ),
        Index("ix_m365_approval_answers_person", "workspace_id", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("aa"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    ms_account_id: Mapped[str] = mapped_column(
        ForeignKey("microsoft_accounts.id", ondelete="CASCADE")
    )
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    approval_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300), default="")
    response: Mapped[str] = mapped_column(String(60))
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="pending")
    error: Mapped[str | None] = mapped_column(String(500))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
