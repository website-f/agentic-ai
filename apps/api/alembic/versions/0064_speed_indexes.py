"""P103: indexes for the slowest office queries (pg_stat_statements on live, 14-15 Nov 2026).

- llm_calls (agent_id, ts): an agent's spend and tokens so far today (budget checks on every
  model call).
- llm_calls (provider_id, ts): a provider's recent failures (the model router's health check,
  the slowest query: 32 ms on average, 478 ms at worst, on 25k rows; it grows with every AI call).
- events (workspace_id, type, ts): the latest event of a kind (e.g. when something last ran).

Only new indexes; no data changes. The tables are small today, so a plain CREATE INDEX locks them
for well under a second. Downgrade drops the three indexes.

Revision ID: 0064
Revises: 0063
Create Date: 2026-11-15 10:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = (
    ("ix_llm_calls_agent_ts", "llm_calls", ["agent_id", "ts"]),
    ("ix_llm_calls_provider_ts", "llm_calls", ["provider_id", "ts"]),
    ("ix_events_ws_type_ts", "events", ["workspace_id", "type", "ts"]),
)


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns, if_not_exists=True)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table, if_exists=True)
