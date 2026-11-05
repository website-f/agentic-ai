"""P67: prisma_links, which Prima staff record each person in the office is.

The office is Prima's sign-in (agentic/prisma): each call it signs names the linked record.
Linked automatically when the person's verified Microsoft account is the one IT recorded in
Prima, else by the owner on the Prisma page. One record per person, one person per record.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-06 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "prisma_links",
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("prima_user_id", sa.String(100), nullable=False),
        sa.Column("prima_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("how", sa.String(10), nullable=False),
        sa.Column("linked_by", sa.String(80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("workspace_id", "prima_user_id", name="uq_prisma_links_record"),
        sa.CheckConstraint("how IN ('microsoft', 'owner')", name="ck_prisma_links_how"),
    )


def downgrade() -> None:
    op.drop_table("prisma_links")
