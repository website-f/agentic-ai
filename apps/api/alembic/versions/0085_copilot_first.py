"""P147: Microsoft 365 Copilot first (owner, 28 Nov 2026: "Copilot first; our AI engine only for
big tasks Copilot can't handle; only for people connected via Microsoft who have the
subscription").

- llm_calls.saved_tokens: a call Copilot answered instead of our engine (provider "copilot",
  cost 0) records the tokens our engine would have used, estimated from the characters. Its
  prompt/completion tokens stay 0, so nothing counts toward allowances or budgets.
- microsoft_accounts.copilot: the last Copilot licence check of a person's main account
  ({"licensed": bool, "checked_at": iso, "skus": [...]}), kept beside the Valkey cache.

Additive only: nothing existing changes. Downgrade drops both columns.

Revision ID: 0085
Revises: 0084
Create Date: 2026-11-28 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0085"
down_revision: str | None = "0084"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "llm_calls",
        sa.Column("saved_tokens", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "microsoft_accounts",
        sa.Column(
            "copilot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("microsoft_accounts", "copilot")
    op.drop_column("llm_calls", "saved_tokens")
