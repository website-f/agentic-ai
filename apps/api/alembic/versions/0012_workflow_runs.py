"""workflow runs: a job carried through a workflow, one task per step

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-02 20:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("workflow_id", sa.String(length=40), nullable=True),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("file_ids", JSONB, nullable=False),
        sa.Column("graph", JSONB, nullable=False),
        sa.Column("assign", JSONB, nullable=False),
        sa.Column("state", JSONB, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("temporal_id", sa.String(length=120), nullable=True),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('running', 'waiting', 'done', 'failed', 'cancelled')",
            name="ck_workflow_runs_status",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_runs_ws_created", "workflow_runs", ["workspace_id", "created_at"])
    op.create_index("ix_workflow_runs_workflow_id", "workflow_runs", ["workflow_id"])
    op.add_column("tasks", sa.Column("workflow_run_id", sa.String(length=40), nullable=True))
    op.create_index("ix_tasks_workflow_run_id", "tasks", ["workflow_run_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_workflow_run_id", table_name="tasks")
    op.drop_column("tasks", "workflow_run_id")
    op.drop_index("ix_workflow_runs_workflow_id", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_ws_created", table_name="workflow_runs")
    op.drop_table("workflow_runs")
