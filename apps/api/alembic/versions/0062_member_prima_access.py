"""P99: what each member reaches: the office and Prima, or Prima only; and which Prima screens.

- memberships.access: "agentic" (the office and Prima: everyone today, the default) or
  "prima_only" (signs in on the same page and works in Prima only: the office's pages, agents,
  chat and desk are refused by the API). Owners (the developer is one) are never Prima only.
- memberships.prima_modules: NULL = every Prima screen their Prima role allows (everyone today);
  a list of Prima screen ids = only those (agentic/prima/modules.py), on top of Prima's own role
  checks. The home screen and their own things always come.

Downgrade drops both: everyone is back to the office and all of Prima.

Revision ID: 0062
Revises: 0061
Create Date: 2026-11-11 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("access", sa.String(16), nullable=False, server_default="agentic"),
    )
    op.create_check_constraint(
        "ck_memberships_access", "memberships", "access IN ('agentic', 'prima_only')"
    )
    op.add_column("memberships", sa.Column("prima_modules", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("memberships", "prima_modules")
    op.drop_constraint("ck_memberships_access", "memberships", type_="check")
    op.drop_column("memberships", "access")
