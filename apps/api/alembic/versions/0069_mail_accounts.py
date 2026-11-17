"""P109: other email accounts and their attachment backups.

Fitri (17 Nov 2026): people may connect other email accounts besides Microsoft 365 (Gmail,
Yahoo, a cPanel mailbox), back up every attachment into their own Files, then stop using them.

- mail_accounts: a person's other email account read over IMAP with an app password (the
  password encrypted at rest, deleted on disconnect). Only its person uses it.
- mail_backup_jobs: one "back up all attachments" run (resumable progress, counts).

Additive only: two new tables. Downgrade drops them (the saved files stay in Files).

Revision ID: 0069
Revises: 0068
Create Date: 2026-11-17 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0069"
down_revision: str | None = "0068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mail_accounts",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False, server_default="other"),
        sa.Column("host", sa.String(253), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("security", sa.String(10), nullable=False, server_default="ssl"),
        sa.Column("username", sa.String(254), nullable=False),
        sa.Column("secret_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False, server_default="untested"),
        sa.Column("last_error", sa.String(500)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("backup_done_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("workspace_id", "user_id", "email", name="uq_mail_accounts_email"),
        sa.CheckConstraint(
            "status IN ('untested', 'ok', 'error')", name="ck_mail_accounts_status"
        ),
        sa.CheckConstraint("security IN ('ssl', 'starttls')", name="ck_mail_accounts_security"),
    )
    op.create_table(
        "mail_backup_jobs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "account_id", sa.String(40), sa.ForeignKey("mail_accounts.id", ondelete="SET NULL")
        ),
        sa.Column("source", sa.String(10), nullable=False, server_default="imap"),
        sa.Column("label", sa.String(254), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="queued"),
        sa.Column(
            "progress", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("messages_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("messages_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("saved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duplicates", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("too_large", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inline_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bytes_saved", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(500)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("notified_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'cancelled')",
            name="ck_mail_backup_jobs_status",
        ),
        sa.CheckConstraint("source IN ('imap', 'gmail')", name="ck_mail_backup_jobs_source"),
    )
    op.create_index(
        "ix_mail_backup_jobs_owner", "mail_backup_jobs", ["workspace_id", "user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_mail_backup_jobs_owner", table_name="mail_backup_jobs")
    op.drop_table("mail_backup_jobs")
    op.drop_table("mail_accounts")
