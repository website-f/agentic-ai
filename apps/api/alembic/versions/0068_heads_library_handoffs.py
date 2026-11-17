"""P109: heads of several departments, Library by department, files for other companies,
comments on feedback.

- department_heads (department_id, user_id): who heads which department. A member may head
  several departments, a department may have several heads. Filled from today's
  memberships.heads_department (they head the department they sit in), which stays as
  "heads at least one" for the screens that read it.
- memberships.library_scope: "company" (default: what everyone reads today) or "department"
  (only their own department's files, for them and their agents).
- memberships.uploads_for_others: may upload files for other companies (default off).
- file_handoffs: a file uploaded for another company, waiting for the uploader's check, then
  approved (their audit line).
- feedback_comments: comments on feedback with @mentions.

Additive only: no existing row changes meaning. Downgrade drops the new tables and columns.

Revision ID: 0068
Revises: 0067
Create Date: 2026-11-17 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0068"
down_revision: str | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMPTY = sa.text("'[]'::jsonb")


def upgrade() -> None:
    op.create_table(
        "department_heads",
        sa.Column(
            "department_id",
            sa.String(40),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_department_heads_ws_user", "department_heads", ["workspace_id", "user_id"])
    op.execute(
        "INSERT INTO department_heads (department_id, user_id, workspace_id) "
        "SELECT m.department_id, m.user_id, m.workspace_id FROM memberships m "
        "JOIN departments d ON d.id = m.department_id AND d.workspace_id = m.workspace_id "
        "WHERE m.heads_department AND m.department_id IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    )

    op.add_column(
        "memberships",
        sa.Column("library_scope", sa.String(12), nullable=False, server_default="company"),
    )
    op.create_check_constraint(
        "ck_memberships_library_scope",
        "memberships",
        "library_scope IN ('company', 'department')",
    )
    op.add_column(
        "memberships",
        sa.Column(
            "uploads_for_others", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )

    op.create_table(
        "file_handoffs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "file_id", sa.String(40), sa.ForeignKey("files.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("file_name", sa.String(200), nullable=False, server_default=""),
        sa.Column(
            "uploader_user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "target_branch_id",
            sa.String(40),
            sa.ForeignKey("branches.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified", postgresql.JSONB(), nullable=False, server_default=EMPTY),
        sa.Column("seen_by", postgresql.JSONB(), nullable=False, server_default=EMPTY),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("status IN ('pending', 'approved')", name="ck_file_handoffs_status"),
    )
    op.create_index("ix_file_handoffs_file_id", "file_handoffs", ["file_id"])
    op.create_index(
        "ix_file_handoffs_ws_uploader",
        "file_handoffs",
        ["workspace_id", "uploader_user_id", "status"],
    )
    op.create_index(
        "ix_file_handoffs_ws_target",
        "file_handoffs",
        ["workspace_id", "target_branch_id", "status"],
    )

    op.create_table(
        "feedback_comments",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "feedback_id",
            sa.String(40),
            sa.ForeignKey("feedback.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("author_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("mentions", postgresql.JSONB(), nullable=False, server_default=EMPTY),
        sa.Column("seen_by", postgresql.JSONB(), nullable=False, server_default=EMPTY),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_feedback_comments_feedback", "feedback_comments", ["feedback_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_comments_feedback", table_name="feedback_comments")
    op.drop_table("feedback_comments")
    op.drop_index("ix_file_handoffs_ws_target", table_name="file_handoffs")
    op.drop_index("ix_file_handoffs_ws_uploader", table_name="file_handoffs")
    op.drop_index("ix_file_handoffs_file_id", table_name="file_handoffs")
    op.drop_table("file_handoffs")
    op.drop_column("memberships", "uploads_for_others")
    op.drop_constraint("ck_memberships_library_scope", "memberships", type_="check")
    op.drop_column("memberships", "library_scope")
    op.drop_index("ix_department_heads_ws_user", table_name="department_heads")
    op.drop_table("department_heads")
