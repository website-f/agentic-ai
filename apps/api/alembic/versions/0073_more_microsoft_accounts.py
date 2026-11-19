"""P118: a person may connect more than one Microsoft account (a work one and a personal or
shared one), with one main account.

Fitri (19 Nov 2026): "1 user ... multiple email can connect but with main email to login", with
Personal and Work tabs on the Microsoft 365 page, and a shared work email several people use
recognised as shared. Until now microsoft_accounts was one row per person (a unique key on
workspace + user). Now:
- is_primary (true for every existing row): the person's main account, the one their AI, Teams,
  SharePoint and Prima use, exactly as before. At most one per person (partial unique index).
- label: what the person calls an extra account ("Personal", "Shared", or their own word).
- the same Microsoft account (its object id) only once per person (partial unique index, empty
  ids, left by a reset, excluded).

Additive, and every existing row stays the main one. Downgrade removes the extra accounts first
(their tokens and synced mail go with them) and puts the one-per-person key back.

Revision ID: 0073
Revises: 0072
Create Date: 2026-11-19 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "microsoft_accounts",
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "microsoft_accounts",
        sa.Column("label", sa.String(length=40), nullable=False, server_default=""),
    )
    op.drop_constraint("uq_microsoft_accounts_user", "microsoft_accounts", type_="unique")
    op.create_index(
        "uq_microsoft_accounts_primary",
        "microsoft_accounts",
        ["workspace_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )
    op.create_index(
        "uq_microsoft_accounts_user_oid",
        "microsoft_accounts",
        ["workspace_id", "user_id", "ms_user_id"],
        unique=True,
        postgresql_where=sa.text("ms_user_id <> ''"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM microsoft_accounts WHERE NOT is_primary")
    op.drop_index("uq_microsoft_accounts_user_oid", table_name="microsoft_accounts")
    op.drop_index("uq_microsoft_accounts_primary", table_name="microsoft_accounts")
    op.create_unique_constraint(
        "uq_microsoft_accounts_user", "microsoft_accounts", ["workspace_id", "user_id"]
    )
    op.drop_column("microsoft_accounts", "label")
    op.drop_column("microsoft_accounts", "is_primary")
