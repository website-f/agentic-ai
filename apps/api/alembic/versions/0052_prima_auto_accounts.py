"""P75: automatic Prima accounts. Anyone in the office opening Prima with no staff record of
their own gets their own Prima account, from their office role; their link says how="auto".

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-06 20:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_prima_links_how", "prima_links", type_="check")
    op.create_check_constraint(
        "ck_prima_links_how", "prima_links", "how IN ('microsoft', 'name', 'owner', 'auto')"
    )


def downgrade() -> None:
    # Automatic links go; those people get their own account linked again when they next open
    # Prima after an upgrade.
    op.execute("DELETE FROM prima_links WHERE how = 'auto'")
    op.drop_constraint("ck_prima_links_how", "prima_links", type_="check")
    op.create_check_constraint(
        "ck_prima_links_how", "prima_links", "how IN ('microsoft', 'name', 'owner')"
    )
