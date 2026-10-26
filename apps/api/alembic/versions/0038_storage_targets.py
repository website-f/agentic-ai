"""P40: file storage in several places (storage_targets: this server's disk, S3-compatible
buckets such as Backblaze B2, WebDAV file servers); a file's bytes may live in one of them
instead of files.data

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-26 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "storage_targets",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sync", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.CheckConstraint("kind IN ('local', 's3', 'webdav')", name="ck_storage_targets_kind"),
    )  # fmt: skip
    op.create_index("ix_storage_targets_ws", "storage_targets", ["workspace_id"])
    op.add_column(
        "files",
        sa.Column(
            "storage_id",
            sa.String(40),
            sa.ForeignKey("storage_targets.id", ondelete="SET NULL"),
        ),
    )
    op.add_column("files", sa.Column("storage_key", sa.String(1000)))
    op.add_column("files", sa.Column("storage_etag", sa.String(200)))
    op.create_index("ix_files_storage", "files", ["storage_id", "storage_key"])
    op.alter_column("files", "data", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE files SET data = ''::bytea WHERE data IS NULL")
    op.alter_column("files", "data", nullable=False)
    op.drop_index("ix_files_storage", table_name="files")
    op.drop_column("files", "storage_etag")
    op.drop_column("files", "storage_key")
    op.drop_column("files", "storage_id")
    op.drop_index("ix_storage_targets_ws", table_name="storage_targets")
    op.drop_table("storage_targets")
