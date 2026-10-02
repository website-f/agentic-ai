"""task goal loop: keep working until a 'done when…' is met

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-03 11:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("goal", sa.Text(), nullable=True))
    op.add_column(
        "tasks", sa.Column("goal_tries", sa.Integer(), server_default="0", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("tasks", "goal_tries")
    op.drop_column("tasks", "goal")
