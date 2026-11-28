"""P146: work groups (pairs and small teams) inside the group structure's units.

The owner (28 Nov 2026): "Manager is this person, executive is that person, and two more people
under this manager; but the manager works directly with one person and the other two work with
each other. I want to set reports-to and have the visual change to side-by-side, pair by pair."

- org_work_groups: people of one unit who work together, drawn side by side on the org chart;
  lead_user_id is the person the group works with (reports to), when set. A member is in at
  most one group per unit (the API keeps that).

Additive only: nothing existing changes. Downgrade drops the table.

Revision ID: 0084
Revises: 0083
Create Date: 2026-11-28 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0084"
down_revision: str | None = "0083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "org_work_groups",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "unit_id",
            sa.String(length=40),
            sa.ForeignKey("org_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=160)),
        sa.Column(
            "lead_user_id", sa.String(length=40), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column(
            "member_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_org_work_groups_ws_unit", "org_work_groups", ["workspace_id", "unit_id"])


def downgrade() -> None:
    op.drop_index("ix_org_work_groups_ws_unit", table_name="org_work_groups")
    op.drop_table("org_work_groups")
