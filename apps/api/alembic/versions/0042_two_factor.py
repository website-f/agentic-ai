"""P57: two-step sign-in (an authenticator app's 6-digit codes).

users.totp_secret_enc is sealed like every other secret (core/crypto, bound to the user
id); totp_enabled_at is set once the person confirmed a code (a secret without it is a setup
in progress); totp_last_step is the last 30-second step accepted, so a code works once;
recovery_codes holds the sha-256 of each unused one-time code.

The workspace rule (settings.require_2fa: off | admins | everyone) needs no column. Existing
workspaces have no key, which reads as "off", so nobody is locked out by this deploy; a
workspace created after it starts at "admins" (config new_workspace_require_2fa).

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-02 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("totp_secret_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "recovery_codes",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "recovery_codes")
    op.drop_column("users", "totp_last_step")
    op.drop_column("users", "totp_enabled_at")
    op.drop_column("users", "totp_secret_enc")
