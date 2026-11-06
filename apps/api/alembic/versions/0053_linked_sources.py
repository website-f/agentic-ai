"""P80: SharePoint and OneDrive folders in the Library. A manager pastes a folder link; its
files are read and only their searchable text is kept (knowledge_chunks, source_kind
"sharepoint"), never the files themselves. linked_sources is the folder (who connected it,
the scope, the last sync), linked_files one file of it (its link, path and Microsoft cTag, so
a sync re-reads only what changed).

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-06 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _stamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "linked_sources",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "connected_by",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("connected_by_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("provider", sa.String(16), nullable=False, server_default="sharepoint"),
        sa.Column("drive_id", sa.String(200), nullable=False),
        sa.Column("item_id", sa.String(200), nullable=False),
        sa.Column("is_folder", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("name", sa.String(300), nullable=False, server_default=""),
        sa.Column("web_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("branch_id", sa.String(40), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="syncing"),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("files_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("capped", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_stamps(),
        sa.UniqueConstraint("workspace_id", "drive_id", "item_id", name="uq_linked_sources_item"),
        sa.CheckConstraint(
            "status IN ('syncing', 'ready', 'needs_reconnect', 'error')",
            name="ck_linked_sources_status",
        ),
    )
    op.create_table(
        "linked_files",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_id",
            sa.String(40),
            sa.ForeignKey("linked_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.String(200), nullable=False),
        sa.Column("name", sa.String(300), nullable=False, server_default=""),
        sa.Column("path", sa.String(1000), nullable=False, server_default=""),
        sa.Column("web_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("etag", sa.String(200), nullable=False, server_default=""),
        sa.Column("ctag", sa.String(200), nullable=False, server_default=""),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="indexed"),
        sa.Column("passages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.UniqueConstraint("source_id", "item_id", name="uq_linked_files_item"),
        sa.CheckConstraint(
            "status IN ('indexed', 'empty', 'held', 'too_large', 'failed')",
            name="ck_linked_files_status",
        ),
    )
    op.create_index("ix_linked_sources_workspace_id", "linked_sources", ["workspace_id"])
    op.create_index("ix_linked_files_workspace_id", "linked_files", ["workspace_id"])


def downgrade() -> None:
    op.execute("DELETE FROM knowledge_chunks WHERE source_kind = 'sharepoint'")
    op.drop_index("ix_linked_files_workspace_id", table_name="linked_files")
    op.drop_index("ix_linked_sources_workspace_id", table_name="linked_sources")
    op.drop_table("linked_files")
    op.drop_table("linked_sources")
