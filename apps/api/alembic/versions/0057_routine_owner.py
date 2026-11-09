"""P96: a learned procedure (routine) can belong to one agent and one person.

- `agent_only`: only the agent that learned it (or its helper copies) replays it. Set for work
  learned by a person's own AI (twin), and for any routine with browser steps (they ran on one
  person's computer and sites).
- `person_id`: the person the work was for; an agent-only routine replays only for that person.
- `checked_at`: when people last saw the job done this way and accepted it (or when it was
  learned). A lesson taught on this kind of work after that time means the routine may be out
  of date: the agent does the job itself until it is confirmed again.

Revision ID: 0057
Revises: 0056
Create Date: 2026-11-10 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "routines",
        sa.Column("agent_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("routines", sa.Column("person_id", sa.String(length=40), nullable=True))
    op.add_column("routines", sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE routines SET checked_at = created_at")
    # Routines a person's own AI learned before this change become that AI's own.
    op.execute(
        "UPDATE routines r SET agent_only = true, person_id = a.owner_user_id "
        "FROM agents a WHERE a.id = r.agent_id AND a.owner_user_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("routines", "checked_at")
    op.drop_column("routines", "person_id")
    op.drop_column("routines", "agent_only")
