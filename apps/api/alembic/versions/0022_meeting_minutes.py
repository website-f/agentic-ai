"""Meeting minutes from a recording: meeting_recordings

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "meeting_recordings",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "branch_id", sa.String(length=40), sa.ForeignKey("branches.id", ondelete="SET NULL")
        ),
        sa.Column(
            "department_id",
            sa.String(length=40),
            sa.ForeignKey("departments.id", ondelete="SET NULL"),
        ),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="en"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("stage_detail", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="upload"),
        sa.Column("source_file_id", sa.String(length=40)),
        sa.Column("original_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("mime", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("original_file", sa.String(length=80)),
        sa.Column("audio_file", sa.String(length=80)),
        sa.Column("audio_expires_at", sa.DateTime(timezone=True)),
        sa.Column("audio_purged_at", sa.DateTime(timezone=True)),
        sa.Column("duration_seconds", sa.Float()),
        sa.Column("chunks_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunks_done", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_results", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("transcript", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("heard_language", sa.String(length=32)),
        sa.Column("minutes", JSONB()),
        sa.Column("work", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "document_id",
            sa.String(length=40),
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "library_file_id", sa.String(length=40), sa.ForeignKey("files.id", ondelete="SET NULL")
        ),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(length=500)),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column(
            "agent_id", sa.String(length=40), sa.ForeignKey("agents.id", ondelete="SET NULL")
        ),
        sa.Column("task_id", sa.String(length=40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("workflow_id", sa.String(length=120)),
        sa.Column("runs", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('uploading', 'queued', 'extracting', 'transcribing', 'writing', 'ready',"
            " 'failed')",
            name="ck_meeting_recordings_status",
        ),
        sa.CheckConstraint("language IN ('en', 'ms')", name="ck_meeting_recordings_language"),
    )
    op.create_index(
        "ix_meeting_recordings_ws_created", "meeting_recordings", ["workspace_id", "created_at"]
    )
    op.create_index(
        "ix_meeting_recordings_source_file_id", "meeting_recordings", ["source_file_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_meeting_recordings_source_file_id", table_name="meeting_recordings")
    op.drop_index("ix_meeting_recordings_ws_created", table_name="meeting_recordings")
    op.drop_table("meeting_recordings")
