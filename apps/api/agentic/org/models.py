"""P109 tables (migration 0068). Imported by agentic.models so Alembic and the app see them.

- department_heads: who heads which department. A member may head several departments (in any
  company of the workspace) and a department may have several heads. memberships.heads_department
  stays true while they head at least one (older screens and the task board read it).
- file_handoffs: a file someone uploaded FOR another company (org/handoffs.py). The file sits in
  the target company, out of its Library, until the uploader checks it and approves; then it
  joins that company's Library and leaves the uploader's view (the row stays as their audit line).
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base, Timestamps
from ..core.ids import new_id

HANDOFF_STATUSES = ("pending", "approved")
# P120: a person's request that waits for someone above them (org/requests.py).
REQUEST_STATUSES = ("pending", "approved", "declined", "cancelled")
REQUEST_KINDS = ("library_link",)


class DepartmentHead(Base):
    __tablename__ = "department_heads"
    __table_args__ = (Index("ix_department_heads_ws_user", "workspace_id", "user_id"),)

    department_id: Mapped[str] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FileHandoff(Timestamps, Base):
    __tablename__ = "file_handoffs"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved')", name="ck_file_handoffs_status"),
        Index("ix_file_handoffs_ws_uploader", "workspace_id", "uploader_user_id", "status"),
        Index("ix_file_handoffs_ws_target", "workspace_id", "target_branch_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("fh"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    # The file in the target company (None once someone deleted it: the line stays).
    file_id: Mapped[str | None] = mapped_column(
        ForeignKey("files.id", ondelete="SET NULL"), index=True
    )
    file_name: Mapped[str] = mapped_column(String(200), default="")
    uploader_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    target_branch_id: Mapped[str | None] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL")
    )
    # The task that asked for the upload (optional).
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    # The title the uploader typed ("" = let the AI describe it when the file is read).
    title: Mapped[str] = mapped_column(String(200), default="", server_default="")
    status: Mapped[str] = mapped_column(String(10), default="pending", server_default="pending")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The people told about it (heads of the target company, or its managers), and which of
    # them opened their incoming list since (the bell stops counting it for them).
    notified: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    seen_by: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")


class PersonRequest(Base):
    """P120 (Fitri, 20 Nov 2026): something a person asks for that someone above them approves,
    on the Approvals page beside the AI's asks. The first kind: a SharePoint or OneDrive folder
    for the Library, pasted by someone who may not connect one (org/requests.py)."""

    __tablename__ = "person_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'declined', 'cancelled')",
            name="ck_person_requests_status",
        ),
        Index("ix_person_requests_ws_status", "workspace_id", "status"),
        Index("ix_person_requests_ws_by", "workspace_id", "requested_by"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("prq"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Who was asked first (the person they report to; None: the office's managers).
    approver_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300), default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # What the request is about (for library_link: the link, the folder's name and ids).
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(String(12), default="pending", server_default="pending")
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # What approving made (for library_link: the linked folder's id).
    result_id: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
