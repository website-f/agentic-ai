"""P92: an emailed sign-in password that never replaces the real one. A first sign-in (or a
forgotten password) gets a temporary password by email, kept only here as an argon2id hash
with its expiry, so a stranger asking for one can never change anyone's password. Used once:
signing in with it clears all three.

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("signin_code_hash", sa.Text(), nullable=True))
    op.add_column(
        "users", sa.Column("signin_code_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "users", sa.Column("signin_code_sent_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "signin_code_sent_at")
    op.drop_column("users", "signin_code_expires_at")
    op.drop_column("users", "signin_code_hash")
