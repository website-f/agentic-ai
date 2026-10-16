"""P34: Microsoft 365 / Outlook through Microsoft Graph: each person's own mailbox, company
shared mailboxes, Graph change-notification subscriptions, and the metadata of mail that
arrived (never bodies)

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-16 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ws() -> sa.Column:
    return sa.Column(
        "workspace_id",
        sa.String(40),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )


def _created() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def _ts() -> list[sa.Column]:
    return [
        _created(),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "microsoft_accounts",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("ms_user_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("tenant_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("display_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("scopes", sa.Text(), nullable=False, server_default=""),
        sa.Column("token_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="connected"),
        sa.Column("last_error", sa.String(500)),
        sa.Column("delta_link", sa.Text()),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        *_ts(),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_microsoft_accounts_user"),
    )
    op.create_table(
        "shared_mailboxes",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("address", sa.String(254), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("tenant_id", sa.String(80), nullable=False, server_default=""),
        sa.Column(
            "branch_id",
            sa.String(40),
            sa.ForeignKey("branches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("agent_id", sa.String(40), sa.ForeignKey("agents.id", ondelete="SET NULL")),
        sa.Column("rules", JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("last_error", sa.String(500)),
        sa.Column("delta_link", sa.Text()),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(80), nullable=False, server_default=""),
        *_ts(),
        sa.UniqueConstraint("workspace_id", "address", name="uq_shared_mailboxes_address"),
    )
    op.create_table(
        "mail_subscriptions",
        sa.Column("id", sa.String(80), primary_key=True),
        _ws(),
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
        sa.Column("resource", sa.String(400), nullable=False),
        sa.Column("client_state_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _created(),
        sa.CheckConstraint(
            "(account_id IS NULL) <> (mailbox_id IS NULL)", name="ck_mail_subscriptions_owner"
        ),
    )
    op.create_index("ix_mail_subscriptions_expires", "mail_subscriptions", ["expires_at"])
    op.create_index("ix_mail_subscriptions_account_id", "mail_subscriptions", ["account_id"])
    op.create_index("ix_mail_subscriptions_mailbox_id", "mail_subscriptions", ["mailbox_id"])
    op.create_table(
        "mail_items",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("mailbox_kind", sa.String(10), nullable=False),
        sa.Column("mailbox_ref", sa.String(40), nullable=False),
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
        sa.Column("graph_message_id", sa.String(255), nullable=False),
        sa.Column("conversation_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("internet_message_id", sa.String(400), nullable=False, server_default=""),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("from_address", sa.String(254), nullable=False, server_default=""),
        sa.Column("from_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("subject", sa.String(400), nullable=False, server_default=""),
        sa.Column("has_attachments", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("category", sa.String(40)),
        sa.Column("status", sa.String(16), nullable=False, server_default="new"),
        sa.Column("task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("actions", JSONB(), nullable=False, server_default="[]"),
        _created(),
        sa.UniqueConstraint("mailbox_ref", "graph_message_id", name="uq_mail_items_message"),
        sa.CheckConstraint("mailbox_kind IN ('personal', 'shared')", name="ck_mail_items_kind"),
        sa.CheckConstraint(
            "status IN ('new', 'processed', 'ignored', 'failed')", name="ck_mail_items_status"
        ),
    )
    op.create_index("ix_mail_items_box_received", "mail_items", ["mailbox_ref", "received_at"])


def downgrade() -> None:
    op.drop_index("ix_mail_items_box_received", table_name="mail_items")
    op.drop_table("mail_items")
    op.drop_index("ix_mail_subscriptions_mailbox_id", table_name="mail_subscriptions")
    op.drop_index("ix_mail_subscriptions_account_id", table_name="mail_subscriptions")
    op.drop_index("ix_mail_subscriptions_expires", table_name="mail_subscriptions")
    op.drop_table("mail_subscriptions")
    op.drop_table("shared_mailboxes")
    op.drop_table("microsoft_accounts")
