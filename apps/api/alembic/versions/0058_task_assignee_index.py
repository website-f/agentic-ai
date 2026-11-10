"""P96: an index on a task's agent and status.

The agents page (current task and open-task count for every agent), an agent's page, the
desk and each scoped person's task board filter tasks by `assignee_agent_id` (often with a
status); without an index every one of those read the whole tasks table, which only grows.

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-10 12:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0058"
down_revision: str | None = "0057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_tasks_assignee_status", "tasks", ["assignee_agent_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_tasks_assignee_status", table_name="tasks")
