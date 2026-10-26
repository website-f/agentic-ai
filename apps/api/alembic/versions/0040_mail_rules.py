"""P44: inbox rules, a person's own (their Outlook) or a shared mailbox's: when a mail is from
someone, about something, of a kind or has attachments, draft a reply a set way, save its
attachments to a folder, make a task, or ignore it.

Revision ID: 0040
Revises: 0039
Create Date: 2026-10-26 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mail_rules",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            sa.String(40),
            sa.ForeignKey("microsoft_accounts.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "mailbox_id",
            sa.String(40),
            sa.ForeignKey("shared_mailboxes.id", ondelete="CASCADE"),
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("when", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("then", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("matched", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_matched_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "(account_id IS NULL) <> (mailbox_id IS NULL)", name="ck_mail_rules_one_box"
        ),
    )
    op.create_index("ix_mail_rules_account", "mail_rules", ["account_id", "position"])
    op.create_index("ix_mail_rules_mailbox", "mail_rules", ["mailbox_id", "position"])


def downgrade() -> None:
    op.drop_index("ix_mail_rules_mailbox", "mail_rules")
    op.drop_index("ix_mail_rules_account", "mail_rules")
    op.drop_table("mail_rules")
