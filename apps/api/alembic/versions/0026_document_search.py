"""P25: search inside every document (passages, headings, what is indexed; pg_trgm)

Idempotent and cheap: new, empty tables and their indexes, plus a trigram index on file
titles. pg_trgm is created when the database allows it; without it search still works
(substring and fuzzy-title matching fall back to plain ILIKE). The passages are filled by
`python -m agentic.search reindex` (or lazily as people search).

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-05 23:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRGM = """
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm is not available (%); search works without it', SQLERRM;
END $$;
"""

TRGM_INDEXES = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        CREATE INDEX IF NOT EXISTS ix_search_passages_trgm
            ON search_passages USING gin (text gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS ix_search_headings_trgm
            ON search_headings USING gin (text gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS ix_files_title_trgm
            ON files USING gin ((title || ' ' || name) gin_trgm_ops);
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(TRGM)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS search_passages (
            id BIGSERIAL PRIMARY KEY,
            workspace_id VARCHAR(40) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            source_kind VARCHAR(16) NOT NULL,
            source_id VARCHAR(40) NOT NULL,
            file_id VARCHAR(40) REFERENCES files(id) ON DELETE CASCADE,
            idx INTEGER NOT NULL,
            page INTEGER,
            heading VARCHAR(300) NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            tsv TSVECTOR NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_search_passages_tsv ON search_passages USING gin (tsv)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_search_passages_source "
        "ON search_passages (source_kind, source_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_search_passages_ws ON search_passages (workspace_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_search_passages_file ON search_passages (file_id)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS search_headings (
            id BIGSERIAL PRIMARY KEY,
            workspace_id VARCHAR(40) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            source_kind VARCHAR(16) NOT NULL,
            source_id VARCHAR(40) NOT NULL,
            file_id VARCHAR(40) REFERENCES files(id) ON DELETE CASCADE,
            page INTEGER,
            text VARCHAR(300) NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_search_headings_source "
        "ON search_headings (source_kind, source_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_search_headings_ws ON search_headings (workspace_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_search_headings_file ON search_headings (file_id)")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS search_sources (
            source_kind VARCHAR(16) NOT NULL,
            source_id VARCHAR(40) NOT NULL,
            workspace_id VARCHAR(40) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            file_id VARCHAR(40) REFERENCES files(id) ON DELETE CASCADE,
            version VARCHAR(120) NOT NULL DEFAULT '',
            passages INTEGER NOT NULL DEFAULT 0,
            indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (source_kind, source_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_search_sources_ws "
        "ON search_sources (workspace_id, source_kind)"
    )
    op.execute(TRGM_INDEXES)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_files_title_trgm")
    op.execute("DROP TABLE IF EXISTS search_sources")
    op.execute("DROP TABLE IF EXISTS search_headings")
    op.execute("DROP TABLE IF EXISTS search_passages")
    # pg_trgm stays: other things may use it, and keeping it costs nothing.
