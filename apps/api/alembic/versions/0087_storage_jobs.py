"""P149a: background storage jobs (documents/offload.py) and the nightly backup's status.

The owner (28 Nov 2026): Library files compressed and kept on the company's S3 file server so
they no longer fill the VPS; backups to the same server. One small table holds each job's
switch (enabled, paused) and progress (counts, bytes, errors, cursor):

- move:<workspace>      file bytes from Postgres / this server's disk to the primary storage
- compress:<workspace>  files saved before P143c made smaller where they live
- backup                the nightly backup (deploy/backup/s3backup.py reports here)

Additive only; downgrade drops the table.

Revision ID: 0087
Revises: 0086
Create Date: 2026-11-28 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0087"
down_revision: str | None = "0086"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "storage_jobs",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "state", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_storage_jobs_workspace_id", "storage_jobs", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_storage_jobs_workspace_id", table_name="storage_jobs")
    op.drop_table("storage_jobs")
