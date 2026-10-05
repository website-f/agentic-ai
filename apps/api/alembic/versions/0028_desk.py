"""P26: each person's workspace (desk): pinned items, and whose desk a file or document
belongs to (the person who made it, whose task produced it, or whose AI worker made it)

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-06 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Whose desk: the person who made it, else the person who gave the (root) task, else the
# owner of the agent that made it. Only users that exist.
_OWNER = """
UPDATE {table} x SET owner_user_id = substring(x.created_by from 6)
WHERE x.owner_user_id IS NULL AND x.created_by LIKE 'user:%'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = substring(x.created_by from 6));
UPDATE {table} x SET owner_user_id = substring(r.created_by from 6)
FROM tasks t JOIN tasks r ON r.id = coalesce(t.root_task_id, t.id)
WHERE x.owner_user_id IS NULL AND x.task_id = t.id AND r.created_by LIKE 'user:%'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = substring(r.created_by from 6));
UPDATE {table} x SET owner_user_id = a.owner_user_id
FROM agents a
WHERE x.owner_user_id IS NULL AND x.agent_id = a.id AND a.owner_user_id IS NOT NULL;
"""


def upgrade() -> None:
    for table in ("files", "documents"):
        op.add_column(
            table,
            sa.Column(
                "owner_user_id",
                sa.String(40),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_{table}_owner_user_id", table, ["owner_user_id"])
        for stmt in _OWNER.format(table=table).split(";"):
            if stmt.strip():
                op.execute(stmt)
    op.create_table(
        "desk_items",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("ref", sa.String(300), nullable=False),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("position", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('sop', 'workflow', 'file', 'document', 'template', 'page', 'task', "
            "'agent', 'search')",
            name="ck_desk_items_kind",
        ),
        sa.UniqueConstraint("user_id", "kind", "ref", name="uq_desk_items_user_ref"),
    )
    op.create_index("ix_desk_items_ws_user", "desk_items", ["workspace_id", "user_id", "position"])


def downgrade() -> None:
    op.drop_index("ix_desk_items_ws_user", table_name="desk_items")
    op.drop_table("desk_items")
    for table in ("documents", "files"):
        op.drop_index(f"ix_{table}_owner_user_id", table_name=table)
        op.drop_column(table, "owner_user_id")
