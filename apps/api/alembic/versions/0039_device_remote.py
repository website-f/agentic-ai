"""P42: seeing and using a linked computer from anywhere. Two locks, both needed:
devices.remote_pc is what the person allowed ON the computer (`agentic-pc remote ...`), and
devices.remote_allowed what they allowed on the web (with their password). off | view | control.

Revision ID: 0039
Revises: 0038
Create Date: 2026-10-26 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "devices", sa.Column("remote_pc", sa.String(8), nullable=False, server_default="off")
    )
    op.add_column(
        "devices",
        sa.Column("remote_allowed", sa.String(8), nullable=False, server_default="off"),
    )


def downgrade() -> None:
    op.drop_column("devices", "remote_allowed")
    op.drop_column("devices", "remote_pc")
