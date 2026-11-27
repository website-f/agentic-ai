"""P144: per-member Library grants (extra access on top of what a person's role and place give).

The owner (27 Nov 2026): "Give the units access to Azizan B. Abdul Rahman ... for each user, I
(admin) can edit the member and have one section to give Library access: which module or
library I can give, like the units, or all companies".

memberships.library_grants (JSONB, null = none):
{"units": "all" | ["hr", "audit", "finance"], "companies": "all" | [branch_id, ...],
 "departments": [department_id, ...],
 "area_depts": [department_id, ...], "area_branches": [branch_id, ...]}
The last two are worked out when the grant is saved (the units' and departments' ids and their
companies) so every request, and an agent's file rule in SQL, reads them without looking the
units up again (knowledge/grants.py).

Downgrade: the column goes (the people keep what their role and place give).

Revision ID: 0082
Revises: 0081
Create Date: 2026-11-27 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0082"
down_revision: str | None = "0081"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("library_grants", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("memberships", "library_grants")
