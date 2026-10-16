"""P34 mail features: what the AI understood about each mail (category, one-line summary,
needs a person, due date, answered / followed up), a person's own mail preferences, Outlook
drafts and calendar proposals waiting for approval next to Gmail's (provider + mailbox),
and digests as reports only the right people see

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-16 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUS = "status IN ('new', 'processed', 'ignored', 'failed')"
NEW_STATUS = "status IN ('new', 'pending', 'processed', 'ignored', 'failed')"


def _box_fks(table: str) -> None:
    op.add_column(
        table,
        sa.Column("provider", sa.String(16), nullable=False, server_default="google"),
    )
    op.add_column(
        table,
        sa.Column(
            "ms_account_id",
            sa.String(40),
            sa.ForeignKey("microsoft_accounts.id", ondelete="CASCADE"),
        ),
    )
    op.add_column(
        table,
        sa.Column(
            "shared_mailbox_id",
            sa.String(40),
            sa.ForeignKey("shared_mailboxes.id", ondelete="CASCADE"),
        ),
    )
    op.create_index(f"ix_{table}_shared_mailbox", table, ["shared_mailbox_id", "status"])


def upgrade() -> None:
    # What the AI understood about each mail (never the body).
    op.add_column("mail_items", sa.Column("summary", sa.String(200)))
    op.add_column(
        "mail_items",
        sa.Column("needs_person", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("mail_items", sa.Column("due_at", sa.DateTime(timezone=True)))
    op.add_column("mail_items", sa.Column("answered_at", sa.DateTime(timezone=True)))
    op.add_column("mail_items", sa.Column("followed_up_at", sa.DateTime(timezone=True)))
    op.drop_constraint("ck_mail_items_status", "mail_items", type_="check")
    op.create_check_constraint("ck_mail_items_status", "mail_items", NEW_STATUS)
    op.create_index("ix_mail_items_box_status", "mail_items", ["mailbox_ref", "status"])

    # A person's own mail preferences (digest, tasks, attachments, follow-ups).
    op.add_column(
        "microsoft_accounts",
        sa.Column("prefs", JSONB(), nullable=False, server_default="{}"),
    )

    # Outlook drafts next to Gmail's. Graph ids are longer than Gmail's.
    _box_fks("email_drafts")
    op.alter_column("email_drafts", "user_id", existing_type=sa.String(40), nullable=True)
    op.alter_column("email_drafts", "account_id", existing_type=sa.String(40), nullable=True)
    for col in ("gmail_draft_id", "thread_id", "in_reply_to"):
        op.alter_column("email_drafts", col, existing_type=sa.String(120), type_=sa.String(400))

    # Outlook calendar proposals next to Google's.
    _box_fks("calendar_proposals")
    op.alter_column("calendar_proposals", "user_id", existing_type=sa.String(40), nullable=True)

    # Reports only one person (a personal digest) or a mailbox's viewers may see.
    op.add_column(
        "reports",
        sa.Column("owner_user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE")),
    )
    op.add_column(
        "reports",
        sa.Column(
            "mailbox_id",
            sa.String(40),
            sa.ForeignKey("shared_mailboxes.id", ondelete="SET NULL"),
        ),
    )
    op.create_index("ix_reports_call_id", "reports", ["call_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_call_id", table_name="reports")
    op.drop_column("reports", "mailbox_id")
    op.drop_column("reports", "owner_user_id")
    op.execute("DELETE FROM calendar_proposals WHERE provider <> 'google' OR user_id IS NULL")
    op.alter_column("calendar_proposals", "user_id", existing_type=sa.String(40), nullable=False)
    op.drop_index("ix_calendar_proposals_shared_mailbox", table_name="calendar_proposals")
    for col in ("shared_mailbox_id", "ms_account_id", "provider"):
        op.drop_column("calendar_proposals", col)
    op.execute("DELETE FROM email_drafts WHERE provider <> 'google'")
    for col in ("gmail_draft_id", "thread_id", "in_reply_to"):
        op.alter_column("email_drafts", col, existing_type=sa.String(400), type_=sa.String(120))
    op.alter_column("email_drafts", "account_id", existing_type=sa.String(40), nullable=False)
    op.alter_column("email_drafts", "user_id", existing_type=sa.String(40), nullable=False)
    op.drop_index("ix_email_drafts_shared_mailbox", table_name="email_drafts")
    for col in ("shared_mailbox_id", "ms_account_id", "provider"):
        op.drop_column("email_drafts", col)
    op.drop_column("microsoft_accounts", "prefs")
    op.drop_index("ix_mail_items_box_status", table_name="mail_items")
    op.execute("UPDATE mail_items SET status = 'new' WHERE status = 'pending'")
    op.drop_constraint("ck_mail_items_status", "mail_items", type_="check")
    op.create_check_constraint("ck_mail_items_status", "mail_items", OLD_STATUS)
    for col in ("followed_up_at", "answered_at", "due_at", "needs_person", "summary"):
        op.drop_column("mail_items", col)
