"""P68: a Prima link can also be made by an exact, unique name (how="name").

People open Prima straight from their office sign-in: the first time, the office links them
when the match is sure (agentic/prisma/client.link_for). The owner can change any link.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-06 15:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_prisma_links_how", "prisma_links", type_="check")
    op.create_check_constraint(
        "ck_prisma_links_how", "prisma_links", "how IN ('microsoft', 'name', 'owner')"
    )


def downgrade() -> None:
    op.execute("UPDATE prisma_links SET how = 'owner' WHERE how = 'name'")
    op.drop_constraint("ck_prisma_links_how", "prisma_links", type_="check")
    op.create_check_constraint(
        "ck_prisma_links_how", "prisma_links", "how IN ('microsoft', 'owner')"
    )
