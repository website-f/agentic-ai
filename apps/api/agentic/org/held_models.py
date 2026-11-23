"""P125: an IT support person's change, held until an owner or global admin approves it
(migration 0076; the rules are in org/held.py). Imported by agentic.models.

One row per held call: exactly what was sent (method, path, query, the body as JSON, or its
raw bytes up to 2 MB with their content type), who sent it, a plain-language summary and the
fields for the Approvals page, and how it ended: approved (run again with the approver's own
sign-in), declined (with a reason), cancelled by the person who asked, or expired after 7 days.
A run that failed keeps the request open with what went wrong (apply_status, apply_message).
Nothing about a row changes once it is saved but its outcome.
"""

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
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, deferred, mapped_column

from ..core.db import Base
from ..core.ids import new_id

HELD_STATUSES = ("pending", "applying", "applied", "declined", "cancelled", "expired")


class HeldChange(Base):
    __tablename__ = "held_changes"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'applying', 'applied', 'declined', 'cancelled', 'expired')",
            name="ck_held_changes_status",
        ),
        CheckConstraint("method IN ('POST', 'PUT', 'PATCH', 'DELETE')", name="ck_held_changes_m"),
        Index("ix_held_changes_ws_status", "workspace_id", "status"),
        Index("ix_held_changes_ws_by", "workspace_id", "requested_by"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("hc"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Their role when they asked (it_support); the approval still applies its rules if their
    # role changed since.
    requested_role: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(500))
    query: Mapped[str] = mapped_column(Text, default="", server_default="")
    content_type: Mapped[str] = mapped_column(String(200), default="", server_default="")
    body_json: Mapped[Any | None] = mapped_column(JSONB)
    body_raw: Mapped[bytes | None] = deferred(mapped_column(LargeBinary))
    # The summary in English (the bell's list and the audit trail).
    title: Mapped[str] = mapped_column(String(300), default="", server_default="")
    # {"t": English template, "v": {vars}}: rendered in the reader's language (org/held.py).
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    # [{"field": ..., "value": ...}] for the "Details" on the Approvals page.
    details: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    status: Mapped[str] = mapped_column(String(12), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # The last run: its HTTP status and a short message (never the answer's body: it may hold
    # a one-time password, which only the approver sees, once).
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    apply_status: Mapped[int | None] = mapped_column(Integer)
    apply_message: Mapped[str] = mapped_column(Text, default="", server_default="")
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
