"""P97: heads of department, who reports to whom, and tasks for people.

- memberships.reports_to_user_id: the manager this member reports to in this workspace (an
  HOD, supervisor or manager "manages" the people who report to them). Nobody is placed
  under anyone automatically: imported members keep their branch and department and report
  to no one until a person sets it.
- memberships.heads_department: this member heads the department they sit in (one or more
  heads per department).
- tasks.assignee_user_id: a task for a person (a member) instead of an AI agent. A task has
  an agent or a person, never both; a person's task never starts an agent run.
- tasks.due_at: when the task is due (people's and agents' tasks).

Revision ID: 0059
Revises: 0058
Create Date: 2026-11-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column(
            "reports_to_user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "memberships",
        sa.Column(
            "heads_department", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.create_index(
        "ix_memberships_reports_to", "memberships", ["workspace_id", "reports_to_user_id"]
    )
    op.add_column(
        "tasks",
        sa.Column(
            "assignee_user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("tasks", sa.Column("due_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tasks_assignee_user_status", "tasks", ["assignee_user_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_tasks_assignee_user_status", table_name="tasks")
    op.drop_column("tasks", "due_at")
    op.drop_column("tasks", "assignee_user_id")
    op.drop_index("ix_memberships_reports_to", table_name="memberships")
    op.drop_column("memberships", "heads_department")
    op.drop_column("memberships", "reports_to_user_id")
