"""P127: the organization hierarchy kept in step with Prima's org chart (prima/org_sync.py).

Fitri (23 Nov 2026): "make sure the organization and hierarchy things sync with agentic side,
because agentic and prima is one so all things must be sync."

- prima_org_sync: per member, the line both sides last agreed on, an office change waiting for
  Prima, and what the org chart page shows (in step, waiting for Prima, a difference and why).
- prima_org_sync_runs: per workspace, the last run.

Downgrade: both tables go (nothing else reads them; the lines themselves stay where they are).

Revision ID: 0078
Revises: 0077
Create Date: 2026-11-23 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0078"
down_revision: str | None = "0077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "prima_org_sync",
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(length=40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("office_manager", sa.String(length=40)),
        sa.Column("prima_manager", sa.String(length=120)),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
        sa.Column("office_at", sa.DateTime(timezone=True)),
        sa.Column("pending", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("pending_by", sa.String(length=200)),
        sa.Column("pending_reason", sa.String(length=300)),
        sa.Column("prima_now", sa.String(length=120)),
        sa.Column("prima_now_name", sa.String(length=200)),
        sa.Column("prima_how", sa.String(length=20)),
        sa.Column("state", sa.String(length=20), nullable=False, server_default="in_step"),
        sa.Column("winner", sa.String(length=10)),
        sa.Column("why", sa.String(length=40)),
        sa.Column("message", sa.Text()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "state IN ('in_step', 'waiting', 'differs', 'skipped')",
            name="ck_prima_org_sync_state",
        ),
    )
    op.create_index("ix_prima_org_sync_ws_state", "prima_org_sync", ["workspace_id", "state"])
    op.create_table(
        "prima_org_sync_runs",
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("problem", sa.String(length=40)),
        sa.Column("installed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
    )


def downgrade() -> None:
    op.drop_table("prima_org_sync_runs")
    op.drop_index("ix_prima_org_sync_ws_state", table_name="prima_org_sync")
    op.drop_table("prima_org_sync")
