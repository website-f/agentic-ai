"""personal assistants, Gmail drafts, WhatsApp channels

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-03 20:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.add_column("agents", sa.Column("private", sa.Boolean(), server_default="false", nullable=False))
    op.drop_constraint("ck_channels_kind", "channels", type_="check")
    op.create_check_constraint("ck_channels_kind", "channels", "kind IN ('telegram', 'whatsapp')")
    op.create_table(
        "integrations",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("config_enc", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.String(length=80), nullable=False),
        *_ts(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "kind", name="uq_integrations_ws_kind"),
    )
    op.create_table(
        "google_accounts",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=40), nullable=False),
        sa.Column("email", sa.String(length=200), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("last_error", sa.String(length=300), nullable=True),
        *_ts(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_google_accounts_user"),
    )
    op.create_table(
        "email_drafts",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("user_id", sa.String(length=40), nullable=False),
        sa.Column("agent_id", sa.String(length=40), nullable=True),
        sa.Column("account_id", sa.String(length=40), nullable=False),
        sa.Column("gmail_draft_id", sa.String(length=120), nullable=False),
        sa.Column("thread_id", sa.String(length=120), nullable=False),
        sa.Column("in_reply_to", sa.String(length=120), nullable=False),
        sa.Column("to", sa.Text(), nullable=False),
        sa.Column("cc", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(length=400), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("original_from", sa.String(length=300), nullable=False),
        sa.Column("original_snippet", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        *_ts(),
        sa.CheckConstraint("status IN ('pending', 'sent', 'discarded', 'failed')", name="ck_email_drafts_status"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["google_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_drafts_user_status", "email_drafts", ["user_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_email_drafts_user_status", table_name="email_drafts")
    op.drop_table("email_drafts")
    op.drop_table("google_accounts")
    op.drop_table("integrations")
    op.drop_constraint("ck_channels_kind", "channels", type_="check")
    op.create_check_constraint("ck_channels_kind", "channels", "kind IN ('telegram')")
    op.drop_column("agents", "private")
