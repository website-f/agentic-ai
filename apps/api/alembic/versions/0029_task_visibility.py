"""P26: who else may look at a task (read only): private, department, company or everyone,
chosen by the manager or owner who gives it

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-06 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("visibility", sa.String(12), nullable=False, server_default="private"),
    )
    op.create_check_constraint(
        "ck_tasks_visibility",
        "tasks",
        "visibility IN ('private', 'department', 'company', 'everyone')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_tasks_visibility", "tasks", type_="check")
    op.drop_column("tasks", "visibility")
