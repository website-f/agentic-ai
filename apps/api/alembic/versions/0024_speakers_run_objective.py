"""P23: meeting speakers, workflow run objective

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-05 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meeting_recordings",
        sa.Column("speakers", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column("workflow_runs", sa.Column("objective_id", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "workflow_runs_objective_id_fkey",
        "workflow_runs",
        "objectives",
        ["objective_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_workflow_runs_objective_id", "workflow_runs", ["objective_id"])


def downgrade() -> None:
    op.drop_index("ix_workflow_runs_objective_id", table_name="workflow_runs")
    op.drop_constraint("workflow_runs_objective_id_fkey", "workflow_runs", type_="foreignkey")
    op.drop_column("workflow_runs", "objective_id")
    op.drop_column("meeting_recordings", "speakers")
