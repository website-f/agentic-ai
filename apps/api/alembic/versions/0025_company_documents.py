"""P24: company documents (folders, uploads, sensitive scan), draft SOPs, doc-built workflows

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-05 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("files", sa.Column("folder", sa.String(300), nullable=False, server_default=""))
    op.add_column("files", sa.Column("batch_id", sa.String(40), nullable=True))
    op.add_column(
        "files", sa.Column("source_path", sa.String(500), nullable=False, server_default="")
    )
    op.add_column(
        "files",
        sa.Column("sensitive", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "files", sa.Column("quarantined", sa.Boolean(), nullable=False, server_default="false")
    )
    op.create_index("ix_files_batch_id", "files", ["batch_id"])
    op.create_index("ix_files_ws_branch_folder", "files", ["workspace_id", "branch_id", "folder"])

    op.create_table(
        "intake_batches",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id", sa.String(40), sa.ForeignKey("workspaces.id", ondelete="CASCADE")
        ),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="unpacking"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("report", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('unpacking', 'reading', 'sorting', 'ready', 'failed')",
            name="ck_intake_batches_status",
        ),
    )
    op.create_index(
        "ix_intake_batches_ws_created", "intake_batches", ["workspace_id", "created_at"]
    )

    op.add_column(
        "sops", sa.Column("status", sa.String(16), nullable=False, server_default="active")
    )
    op.add_column(
        "sops",
        sa.Column(
            "source_file_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
    )
    op.add_column(
        "workflows",
        sa.Column(
            "source_file_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
    )


def downgrade() -> None:
    op.drop_column("workflows", "source_file_ids")
    op.drop_column("sops", "source_file_ids")
    op.drop_column("sops", "status")
    op.drop_index("ix_intake_batches_ws_created", table_name="intake_batches")
    op.drop_table("intake_batches")
    op.drop_index("ix_files_ws_branch_folder", table_name="files")
    op.drop_index("ix_files_batch_id", table_name="files")
    for c in ("quarantined", "sensitive", "source_path", "batch_id", "folder"):
        op.drop_column("files", c)
