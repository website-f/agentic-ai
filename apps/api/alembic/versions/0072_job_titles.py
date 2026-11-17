"""P111: a member's job title (designation) for the organization chart.

Fitri (17 Nov 2026): admins set who each person reports to, the Organization page shows the
chart of who reports to whom, and My workspace shows each person's own line of managers. The
chart's boxes show each person's job title (for example "Operation General Manager"), kept on
their membership here (memberships.job_title). Owners, admins, management and HR set it on the
Members page; empty until then.

Additive only: one nullable column. Downgrade drops it (only the titles are lost).

Revision ID: 0072
Revises: 0071
Create Date: 2026-11-17 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072"
down_revision: str | None = "0071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memberships", sa.Column("job_title", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("memberships", "job_title")
