"""P128: a Prima department Prima refused on a person's own account is remembered.

Fitri (24 Nov 2026): access set in the office (roles, Prima modules, Prima department) did not
show in Prima. One of the causes: when Prima's accounts service refused the department chosen
for someone (a central-only department, while their own staff record makes them a licensed
company's office staff), their Prima did not open at all, on every call. The office now keeps
their account with no department, remembers the department Prima refused here (so it is not
asked again on every call), and Members > Access says so.

Downgrade: the column goes (the next Prima open asks Prima again).

Revision ID: 0080
Revises: 0079
Create Date: 2026-11-24 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "prima_links", sa.Column("department_refused", sa.String(length=20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("prima_links", "department_refused")
