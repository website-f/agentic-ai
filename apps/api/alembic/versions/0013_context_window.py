"""context window: checkpoint and prune point per task and chat session

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-03 09:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("tasks", "chat_sessions"):
        op.add_column(table, sa.Column("ctx_summary", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("ctx_summary_upto", sa.BigInteger(), nullable=True))
        op.add_column(table, sa.Column("ctx_cut", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    for table in ("tasks", "chat_sessions"):
        op.drop_column(table, "ctx_cut")
        op.drop_column(table, "ctx_summary_upto")
        op.drop_column(table, "ctx_summary")
