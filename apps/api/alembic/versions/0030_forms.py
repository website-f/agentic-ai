"""P27: company forms people fill in and hand back (claims, monthly records, requests),
with when they are due, and each person's submission per period

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-06 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "forms",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="CASCADE")),
        sa.Column(
            "department_id", sa.String(40), sa.ForeignKey("departments.id", ondelete="SET NULL")
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(16), nullable=False, server_default="other"),
        sa.Column("file_id", sa.String(40), sa.ForeignKey("files.id", ondelete="SET NULL")),
        sa.Column("schedule", JSONB(), nullable=False, server_default="{}"),
        sa.Column("guide", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_forms_status"),
    )
    op.create_index("ix_forms_ws_branch", "forms", ["workspace_id", "branch_id"])
    op.create_table(
        "form_submissions",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "form_id",
            sa.String(40),
            sa.ForeignKey("forms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="SET NULL")),
        sa.Column("period", sa.String(40), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("file_ids", JSONB(), nullable=False, server_default="[]"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("made_by", sa.String(10), nullable=False, server_default="person"),
        sa.Column("task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("review_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviewed_by", sa.String(80)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'returned', 'accepted')",
            name="ck_form_submissions_status",
        ),
        sa.UniqueConstraint("form_id", "user_id", "period", name="uq_form_submissions_period"),
    )
    op.create_index("ix_form_submissions_form_period", "form_submissions", ["form_id", "period"])


def downgrade() -> None:
    op.drop_index("ix_form_submissions_form_period", table_name="form_submissions")
    op.drop_table("form_submissions")
    op.drop_index("ix_forms_ws_branch", table_name="forms")
    op.drop_table("forms")
