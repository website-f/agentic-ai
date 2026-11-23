"""P124: an extra WORK email account waits for approval before it is used.

The owner (23 Nov 2026): "for work email, when someone who is not a HOD (or above) connects
one, it must request approval first, not connect immediately".

- mail_accounts.status may be 'pending' (an IMAP account on a company domain, signed in fine,
  waiting for the person above to approve it; never read, tested or backed up meanwhile).
- microsoft_accounts.status has no check constraint: 'pending' needs no change there.
- The request itself is a person_requests row (kind 'work_mail', migration 0074).

Downgrade: pending IMAP accounts (and their stored passwords) are deleted first, since the old
statuses cannot hold them; their requests are cancelled.

Revision ID: 0075
Revises: 0074
Create Date: 2026-11-23 10:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_mail_accounts_status", "mail_accounts", type_="check")
    op.create_check_constraint(
        "ck_mail_accounts_status",
        "mail_accounts",
        "status IN ('untested', 'ok', 'error', 'pending')",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE person_requests SET status = 'cancelled', decided_at = now() "
        "WHERE kind = 'work_mail' AND status = 'pending'"
    )
    op.execute("DELETE FROM mail_accounts WHERE status = 'pending'")
    op.execute("DELETE FROM microsoft_accounts WHERE status = 'pending'")
    op.drop_constraint("ck_mail_accounts_status", "mail_accounts", type_="check")
    op.create_check_constraint(
        "ck_mail_accounts_status", "mail_accounts", "status IN ('untested', 'ok', 'error')"
    )
