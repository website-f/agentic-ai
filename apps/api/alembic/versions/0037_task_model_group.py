"""P38: a task may run on another model group than its agent's (retry with another AI, and
the automatic failover writes down the group that answered)

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-26 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("model_group", sa.String(40)))


def downgrade() -> None:
    op.drop_column("tasks", "model_group")
