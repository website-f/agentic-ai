"""P70: Prisma is now Prima: prisma_links becomes prima_links (its constraints too).

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-06 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("prisma_links", "prima_links")
    op.execute("ALTER TABLE prima_links RENAME CONSTRAINT prisma_links_pkey TO prima_links_pkey")
    op.execute(
        "ALTER TABLE prima_links RENAME CONSTRAINT uq_prisma_links_record TO uq_prima_links_record"
    )
    op.execute(
        "ALTER TABLE prima_links RENAME CONSTRAINT ck_prisma_links_how TO ck_prima_links_how"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE prima_links RENAME CONSTRAINT ck_prima_links_how TO ck_prisma_links_how"
    )
    op.execute(
        "ALTER TABLE prima_links RENAME CONSTRAINT uq_prima_links_record TO uq_prisma_links_record"
    )
    op.execute("ALTER TABLE prima_links RENAME CONSTRAINT prima_links_pkey TO prisma_links_pkey")
    op.rename_table("prima_links", "prisma_links")
