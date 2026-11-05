"""P73: feedback from everyone, read by the developer.

users.is_developer marks the system's developer: an owner of the workspace who also has the
Feedbacks page (set only from the operator command line, agentic/admin.py). feedback holds
what people send from the floating button on any page: a note, optionally a screenshot of
the page with their own marks drawn on it.

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-05 23:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_developer", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "feedback",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("author_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(16), nullable=False, server_default=""),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("page_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("page_title", sa.String(200), nullable=False, server_default=""),
        sa.Column("marks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "context", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("screenshot", sa.LargeBinary(), nullable=True),
        sa.Column("screenshot_type", sa.String(40), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("dev_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("handled_by", sa.String(40), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('screenshot', 'general')", name="ck_feedback_kind"),
        sa.CheckConstraint(
            "category IN ('bug', 'confusing', 'not_needed', 'idea', 'praise', 'other')",
            name="ck_feedback_category",
        ),
        sa.CheckConstraint(
            "status IN ('new', 'planned', 'in_progress', 'done', 'wont_do')",
            name="ck_feedback_status",
        ),
    )
    op.create_index("ix_feedback_ws_created", "feedback", ["workspace_id", "created_at"])
    op.create_index("ix_feedback_ws_status", "feedback", ["workspace_id", "status"])
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_user_id", table_name="feedback")
    op.drop_index("ix_feedback_ws_status", table_name="feedback")
    op.drop_index("ix_feedback_ws_created", table_name="feedback")
    op.drop_table("feedback")
    op.drop_column("users", "is_developer")
