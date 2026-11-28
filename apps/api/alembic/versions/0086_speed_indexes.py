"""P148b: indexes for the hot filters and foreign keys the live server scanned for.

The owner (28 Nov 2026): "all queries fully optimized; users and members load super fast; every
action on the server super fast". From pg_stat_statements on the live server and the code:

- microsoft_accounts (workspace_id, user_id): "has this person connected Microsoft" (Getting
  started, identity) ran 7.6k times at 16 ms: only partial indexes (main account, by Graph id)
  existed, which that question cannot use, so it read the whole table.
- agents (workspace_id, owner_user_id, status) where not a helper copy: each member's AI workers
  (the Members list's counts, 29.7k calls at 4.2 ms; who sees which agent).
- files: the Library (workspace, company, department of library files), an agent's files, a
  department's files; and search_sources.file_id, mail_items.task_id, approvals.task_id,
  device_activity.task_id: foreign keys with no index, so deleting a file or a task read those
  whole tables while holding its locks.
- mail_items (account_id, received_at): an account's mail (deleting an account's mail read the
  whole table).

Built with CREATE INDEX CONCURRENTLY outside the migration's transaction, so the live tables
stay writable while they build. A build that failed part way leaves an INVALID index; it is
dropped and built again. Additive only; downgrade drops them (also concurrently).

Revision ID: 0086
Revises: 0085
Create Date: 2026-11-28 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0086"
down_revision: str | None = "0085"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# name -> (table, columns, partial predicate or None)
INDEXES: dict[str, tuple[str, str, str | None]] = {
    "ix_microsoft_accounts_ws_user": ("microsoft_accounts", "workspace_id, user_id", None),
    "ix_agents_ws_owner": (
        "agents",
        "workspace_id, owner_user_id, status",
        "clone_of IS NULL",
    ),
    "ix_files_ws_library": ("files", "workspace_id, branch_id, department_id", "library"),
    "ix_files_agent": ("files", "agent_id", "agent_id IS NOT NULL"),
    "ix_files_department": ("files", "department_id", "department_id IS NOT NULL"),
    "ix_search_sources_file": ("search_sources", "file_id", "file_id IS NOT NULL"),
    "ix_mail_items_account_received": ("mail_items", "account_id, received_at", None),
    "ix_mail_items_task": ("mail_items", "task_id", "task_id IS NOT NULL"),
    "ix_approvals_task": ("approvals", "task_id", None),
    "ix_device_activity_task": ("device_activity", "task_id", "task_id IS NOT NULL"),
}


def upgrade() -> None:
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        for name, (table, cols, where) in INDEXES.items():
            # A concurrent build that failed leaves the index INVALID: drop it, build again.
            invalid = bind.execute(
                sa.text(
                    "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                    "WHERE c.relname = :n AND NOT i.indisvalid"
                ),
                {"n": name},
            ).scalar()
            if invalid:
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            pred = f" WHERE {where}" if where else ""
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({cols}){pred}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name in INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
