"""P21: task blockers, review stages, objectives, saved browser sessions, prompt-prefix hash

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-05 13:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("review_policy", JSONB(), nullable=True))
    op.add_column("blueprints", sa.Column("review_policy", JSONB(), nullable=True))
    op.add_column("llm_calls", sa.Column("prefix_hash", sa.String(length=16), nullable=True))

    op.add_column("tasks", sa.Column("blocked_owner", sa.String(length=80), nullable=True))
    op.add_column("tasks", sa.Column("blocked_action", sa.String(length=300), nullable=True))
    op.add_column("tasks", sa.Column("objective_id", sa.String(length=40), nullable=True))
    op.add_column("tasks", sa.Column("root_task_id", sa.String(length=40), nullable=True))
    op.add_column("tasks", sa.Column("review_policy", JSONB(), nullable=True))
    op.add_column(
        "tasks", sa.Column("review_round", sa.Integer(), nullable=False, server_default="0")
    )
    op.create_index("ix_tasks_objective_id", "tasks", ["objective_id"])
    op.create_index("ix_tasks_root_task_id", "tasks", ["root_task_id"])

    op.create_table(
        "task_blockers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("blocker_task_id", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocker_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "blocker_task_id", name="uq_task_blockers"),
    )
    op.create_index("ix_task_blockers_task_id", "task_blockers", ["task_id"])
    op.create_index("ix_task_blockers_blocker_task_id", "task_blockers", ["blocker_task_id"])

    op.create_table(
        "objectives",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("department_id", sa.String(length=40), nullable=True),
        sa.Column("parent_id", sa.String(length=40), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("target", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("budget_usd", sa.Numeric(12, 4), nullable=True),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "credential_states",
        sa.Column("credential_id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("state_enc", sa.Text(), nullable=False),
        sa.Column("check_url", sa.String(length=500), nullable=True),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["credential_id"], ["credentials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("credential_id"),
    )


def downgrade() -> None:
    op.drop_table("credential_states")
    op.drop_table("objectives")
    op.drop_index("ix_task_blockers_blocker_task_id", table_name="task_blockers")
    op.drop_index("ix_task_blockers_task_id", table_name="task_blockers")
    op.drop_table("task_blockers")
    op.drop_index("ix_tasks_root_task_id", table_name="tasks")
    op.drop_index("ix_tasks_objective_id", table_name="tasks")
    for col in (
        "review_round",
        "review_policy",
        "root_task_id",
        "objective_id",
        "blocked_action",
        "blocked_owner",
    ):
        op.drop_column("tasks", col)
    op.drop_column("llm_calls", "prefix_hash")
    op.drop_column("blueprints", "review_policy")
    op.drop_column("departments", "review_policy")
