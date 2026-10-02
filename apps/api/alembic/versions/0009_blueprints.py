"""blueprints: reusable role packages applied to agents

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-02 14:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blueprints",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("soul", sa.Text(), nullable=False),
        sa.Column("model_group", sa.String(length=40), nullable=False),
        sa.Column("tools", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("autonomy", sa.String(length=8), nullable=False),
        sa.Column("sop_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("skill_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_blueprints_ws_name"),
    )


def downgrade() -> None:
    op.drop_table("blueprints")
