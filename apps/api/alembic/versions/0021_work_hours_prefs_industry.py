"""P19: agent working hours, per-person prefs, company industry

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-04 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("work_hours", JSONB(), nullable=True))
    op.add_column(
        "users", sa.Column("prefs", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"))
    )
    op.add_column(
        "branches", sa.Column("industry", sa.String(length=60), nullable=False, server_default="")
    )


def downgrade() -> None:
    op.drop_column("branches", "industry")
    op.drop_column("users", "prefs")
    op.drop_column("agents", "work_hours")
