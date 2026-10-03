"""llm_calls.error_detail: the provider's error text for failed calls

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-04 12:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("llm_calls", sa.Column("error_detail", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_calls", "error_detail")
