"""P58: one site's traffic through a company computer.

devices.tunnel_hosts: the sites (host suffixes) the computer's own person let through it
(`agentic-pc tunnel on eperolehan.gov.my`); empty = off on that computer. The workspace's
choice of computer and sites lives in its settings ("pc_tunnel").

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-03 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column(
            "tunnel_hosts",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("devices", "tunnel_hosts")
