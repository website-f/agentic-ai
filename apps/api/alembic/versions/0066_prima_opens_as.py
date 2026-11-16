"""P106: the developer may open Prima as their own account, and a Prima department per member.

Fitri (owner and developer, 16 Nov 2026) loads company data into Prima herself and Fauzan (the
CEO) OKs each load as the CEO record. Prima's two-person rules mean she cannot prepare a load
while she opens Prima as the CEO record, so:

- memberships.prima_opens_as: "top" (the CEO record, today's behaviour and the default) or
  "own" (their own Prima account, central staff). Only the developer may choose "own"
  (prima/client.set_opens_as); everyone else stays "top"/ignored.
- memberships.prima_department: the Prima department their own Prima account gets (transport,
  procurement or hr; NULL = none), set in Members > Access (the developer's own on the Prima page).
- prima_links.department: the department last given to their own Prima account, so the next
  time they open Prima the account is brought up to date when it changed (prima/client.link_for).

Downgrade drops the three columns: everyone opens Prima as before.

Revision ID: 0066
Revises: 0065
Create Date: 2026-11-16 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("prima_opens_as", sa.String(8), nullable=False, server_default="top"),
    )
    op.create_check_constraint(
        "ck_memberships_prima_opens_as", "memberships", "prima_opens_as IN ('top', 'own')"
    )
    op.add_column("memberships", sa.Column("prima_department", sa.String(20), nullable=True))
    op.create_check_constraint(
        "ck_memberships_prima_department",
        "memberships",
        "prima_department IS NULL OR prima_department IN ('transport', 'procurement', 'hr')",
    )
    op.add_column("prima_links", sa.Column("department", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("prima_links", "department")
    op.drop_constraint("ck_memberships_prima_department", "memberships", type_="check")
    op.drop_column("memberships", "prima_department")
    op.drop_constraint("ck_memberships_prima_opens_as", "memberships", type_="check")
    op.drop_column("memberships", "prima_opens_as")
