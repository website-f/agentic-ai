"""P18: indexes for the keyset (cursor) pages of the bigger lists

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-04 17:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = {
    "ix_approvals_page": "approvals (workspace_id, created_at, id)",
    "ix_tasks_page": "tasks (workspace_id, status, position, created_at)",
    "ix_meetings_page": "meetings (workspace_id, created_at)",
    "ix_broadcasts_page": "broadcasts (workspace_id, created_at)",
    "ix_chat_sessions_page": "chat_sessions (agent_id, user_id, updated_at)",
    "ix_skill_proposals_page": "skill_proposals (workspace_id, created_at)",
}


def upgrade() -> None:
    for name, target in INDEXES.items():
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")


def downgrade() -> None:
    for name in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
