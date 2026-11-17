"""P109: Getting started progress per person and workspace.

Fitri (17 Nov 2026): newcomers get a checklist for their role and guided tours of the pages.
What they ticked by hand, the tours they took and where to resume the welcome tour are kept
on their membership (memberships.getting_started, a small JSON object); everything else is
read from real data.

Additive only: one nullable column. Downgrade drops it (only the tour marks are lost).

Revision ID: 0071
Revises: 0070
Create Date: 2026-11-17 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0071"
down_revision: str | None = "0070"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("getting_started", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("memberships", "getting_started")
