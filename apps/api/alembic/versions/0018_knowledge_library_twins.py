"""P18: knowledge library (searchable passages of library files and SOPs) and AI twins

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-04 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import TSVECTOR

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("source_kind", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.String(length=40), nullable=False),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("department_id", sa.String(length=40), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("idx", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "tsv",
            TSVECTOR(),
            sa.Computed("to_tsvector('simple', heading || ' ' || text)", persisted=True),
        ),
        sa.Column("embedding", Vector(384), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_chunks_workspace_id", "knowledge_chunks", ["workspace_id"])
    op.create_index("ix_knowledge_chunks_source", "knowledge_chunks", ["source_kind", "source_id"])
    op.execute("CREATE INDEX ix_knowledge_chunks_tsv ON knowledge_chunks USING gin (tsv)")
    op.execute(
        "CREATE INDEX ix_knowledge_chunks_embedding ON knowledge_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )

    op.add_column(
        "files", sa.Column("library", sa.Boolean(), nullable=False, server_default="false")
    )
    op.add_column("files", sa.Column("department_id", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "files_department_id_fkey",
        "files",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("files", sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column(
        "agents", sa.Column("is_twin", sa.Boolean(), nullable=False, server_default="false")
    )
    # One twin per person.
    op.execute(
        "CREATE UNIQUE INDEX ux_agents_one_twin ON agents (owner_user_id) "
        "WHERE is_twin AND owner_user_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_agents_one_twin")
    op.drop_column("agents", "is_twin")
    op.drop_column("files", "indexed_at")
    op.drop_constraint("files_department_id_fkey", "files", type_="foreignkey")
    op.drop_column("files", "department_id")
    op.drop_column("files", "library")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_chunks_embedding")
    op.execute("DROP INDEX IF EXISTS ix_knowledge_chunks_tsv")
    op.drop_index("ix_knowledge_chunks_source", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_workspace_id", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")
