"""P92: lessons people teach the agents. A lesson is a brain fact (source_kind "lesson") so the
usual recall, dedup, replace-by-newer and forgetting apply; its structure (topic, when, do,
don't, field, example, the agent it was taught to, how it was taught, how often) lives in a
new JSON column, `brain_facts.meta`. Existing facts get an empty object.

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-09 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0056"
down_revision: str | None = "0055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "brain_facts",
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    # The Lessons view lists one topic at a time, newest first.
    op.create_index(
        "ix_brain_facts_lessons",
        "brain_facts",
        ["workspace_id", sa.text("(meta->>'topic')")],
        postgresql_where=sa.text("source_kind = 'lesson'"),
    )


def downgrade() -> None:
    op.drop_index("ix_brain_facts_lessons", table_name="brain_facts")
    op.drop_column("brain_facts", "meta")
