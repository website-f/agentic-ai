"""P66: the Microsoft account a person signed in with, per workspace.

memberships.ms_tenant_id / ms_oid: recorded at every "Sign in with Microsoft" (and when a
mailbox is connected), after Microsoft's answer is verified. Prima (/prisma/) links its staff
by this object ID only, so the office can open Prima for the person, and their AI can work in
it for them, without a second sign-in. Never typed by anyone; cleared with the membership.

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-06 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memberships", sa.Column("ms_tenant_id", sa.String(80), nullable=True))
    op.add_column("memberships", sa.Column("ms_oid", sa.String(80), nullable=True))
    # Accounts connected before P66 already carry a verified oid: fill those in.
    op.execute(
        """
        UPDATE memberships m SET ms_tenant_id = a.tenant_id, ms_oid = a.ms_user_id
        FROM microsoft_accounts a
        WHERE a.workspace_id = m.workspace_id AND a.user_id = m.user_id
          AND a.status <> 'disconnected' AND a.ms_user_id <> '' AND a.tenant_id <> ''
        """
    )


def downgrade() -> None:
    op.drop_column("memberships", "ms_oid")
    op.drop_column("memberships", "ms_tenant_id")
