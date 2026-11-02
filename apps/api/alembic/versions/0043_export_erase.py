"""P57: export and erase a workspace.

workspace_exports: one row per export (a ZIP on this server's disk, downloaded once); goes
with the workspace. erasure_records: server level, no foreign key, kept after the workspace
is erased: ids, a name, counts, timestamps and the deletion certificate's SHA-256, never any
content. Its id column is erased_workspace_id so the "no row left with this workspace_id"
check does not count the proof itself.

The audit log stays append-only, except for one thing: an erase may delete a workspace's
entries, in a transaction that set `agentic.erasure = 'on'` (SET LOCAL) first.

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-02 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    jsonb = postgresql.JSONB
    op.create_table(
        "workspace_exports",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requested_by", sa.String(40), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("step", sa.String(40), nullable=False, server_default=""),
        sa.Column("path", sa.String(500), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("counts", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_workspace_exports_workspace_id", "workspace_exports", ["workspace_id"])

    op.create_table(
        "erasure_records",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("erased_workspace_id", sa.String(40), nullable=False),
        sa.Column("workspace_name", sa.String(120), nullable=False),
        sa.Column("requested_by", sa.String(40), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="requested"),
        sa.Column("step", sa.String(40), nullable=False, server_default=""),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("counts", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("revoked", jsonb(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("access_hash", sa.String(64), nullable=True),
        sa.Column("certificate_sha256", sa.String(64), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("due_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_erasure_records_erased_workspace_id", "erasure_records", ["erased_workspace_id"]
    )

    op.execute("""
        CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('agentic.erasure', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_log is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.drop_index("ix_erasure_records_erased_workspace_id", table_name="erasure_records")
    op.drop_table("erasure_records")
    op.drop_index("ix_workspace_exports_workspace_id", table_name="workspace_exports")
    op.drop_table("workspace_exports")
