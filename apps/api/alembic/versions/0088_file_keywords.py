"""P149c: keywords on files, and who put a file in its folder.

The owner (28 Nov 2026): "In the Library users find it hard to group and organize uploaded
files ... add another input when they upload: they're asked for keywords for all the files
uploaded, so sorting and organizing is easier", and files sorted into folders automatically.

- files.keywords text[]: the uploader's keywords (lower case, trimmed), searched with a GIN
  index (`keywords @> ARRAY['payroll']`).
- files.folder_by: who put the file in its folder: "" (as uploaded, or before P149c), "sort"
  (uploaded with "sort into folders automatically", waiting to be read), "auto" (sorted by the
  rules), "person" (a person moved it: never moved by the sorter again), "agent" (an AI moved
  it after the plan was confirmed).

Both columns have constant defaults (no table rewrite). The index is built CONCURRENTLY outside
the migration's transaction, so the files table stays writable while it builds; a build that
failed part way leaves an INVALID index, which is dropped and built again. Downgrade drops it
(also concurrently) and the two columns.

Revision ID: 0088
Revises: 0087
Create Date: 2026-11-28 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0088"
down_revision: str | None = "0087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX = "ix_files_keywords"


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column(
            "keywords",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "files",
        sa.Column("folder_by", sa.String(10), nullable=False, server_default=""),
    )
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        invalid = bind.execute(
            sa.text(
                "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "WHERE c.relname = :n AND NOT i.indisvalid"
            ),
            {"n": INDEX},
        ).scalar()
        if invalid:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}")
        op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {INDEX} ON files USING gin (keywords)")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}")
    op.drop_column("files", "folder_by")
    op.drop_column("files", "keywords")
