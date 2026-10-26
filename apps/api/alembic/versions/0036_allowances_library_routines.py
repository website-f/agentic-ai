"""P36: whose work each model call was (llm_calls.user_id) and each person's daily AI
allowance (memberships.ai_daily_tokens); one library (files.restricted: only a department's
own agents and managers read it; every other company document is in the library for every
agent of the company); learned routines agents replay without the paid model (routines)

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-26 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A copy of agentic.intake.sort.SENSITIVE_PATTERN as it was for this migration (Postgres word
# boundaries \m \M); migrations never import app code that may change later.
SENSITIVE_PATTERN = (
    r"\m(salary|salaries|payroll|payslips?|wages?|gaji|upah|bonus|epf|kwsp|socso|perkeso"
    r"|employee data|employee records?|personnel|maklumat pekerja|rekod pekerja"
    r"|appraisals?|penilaian prestasi|disciplinary|tatatertib|medical|perubatan"
    r"|contracts?|kontrak|agreements?|perjanjian|bank|penyata|statements? of account"
    r"|financial|kewangan|accounts?|akaun|ledger|budget|bajet|invoices?|invois"
    r"|mykad|ic numbers?|passports?|pasport)\M"
)


def upgrade() -> None:
    op.add_column("llm_calls", sa.Column("user_id", sa.String(40)))
    op.create_index("ix_llm_calls_ws_user_ts", "llm_calls", ["workspace_id", "user_id", "ts"])
    op.add_column("memberships", sa.Column("ai_daily_tokens", sa.Integer()))

    op.add_column(
        "files",
        sa.Column("restricted", sa.Boolean(), nullable=False, server_default="false"),
    )
    bind = op.get_bind()
    # One library: a department on a document is where it is filed, not a wall. A document
    # that reads as confidential (pay, personnel, contracts, bank...) is restricted and keeps
    # its department's wall: the same words as intake.sort.SENSITIVE_PATTERN.
    sensitive = (
        "(coalesce(kind, '') || ' ' || coalesce(name, '') || ' ' || coalesce(folder, '')"
        " || ' ' || coalesce(title, '')) ~* :pat"
    )
    bind.execute(
        sa.text(
            f"UPDATE files SET restricted = true WHERE library = true AND ({sensitive} "
            "OR kind IN ('financial', 'contract'))"
        ),
        {"pat": SENSITIVE_PATTERN},
    )
    # Only a restricted file keeps its department on its passages (indexer.index_file); SOP
    # passages are for every agent of their company.
    op.execute(
        """
        UPDATE knowledge_chunks SET department_id = NULL
         WHERE NOT (source_kind = 'file'
                    AND source_id IN (SELECT id FROM files WHERE restricted))
        """
    )
    # Every company document sorted in from Browse joins the library (the catch-up in the
    # liveness reconciler indexes them); confidential ones restricted.
    bind.execute(
        sa.text(
            f"""
            UPDATE files SET library = true,
                   restricted = (kind IN ('financial', 'contract') OR {sensitive}),
                   indexed_at = NULL
             WHERE batch_id IS NOT NULL AND library = false AND quarantined = false
               AND origin = 'uploaded' AND status = 'ready'
               AND folder NOT LIKE 'My workspace%' AND folder NOT LIKE 'Meja kerja saya%'
            """
        ),
        {"pat": SENSITIVE_PATTERN},
    )

    op.create_table(
        "routines",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(300), nullable=False, server_default=""),
        sa.Column("example", sa.Text(), nullable=False, server_default=""),
        sa.Column("embedding", Vector(384), nullable=True),
        sa.Column("slots", JSONB(), nullable=False, server_default="[]"),
        sa.Column("steps", JSONB(), nullable=False, server_default="[]"),
        sa.Column("answer", JSONB(), nullable=False, server_default="{}"),
        sa.Column("tools", JSONB(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(16), nullable=False, server_default="candidate"),
        sa.Column("source_task_ids", JSONB(), nullable=False, server_default="[]"),
        sa.Column("agent_id", sa.String(40)),
        sa.Column("baseline_tokens", sa.Integer()),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("successes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tokens_saved", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("confirmed_by", sa.String(80)),
        sa.Column("note", sa.String(300)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.CheckConstraint(
            "status IN ('candidate', 'active', 'paused', 'retired')", name="ck_routines_status"
        ),
    )  # fmt: skip
    op.create_index("ix_routines_ws_status", "routines", ["workspace_id", "status"])
    op.execute(
        "CREATE INDEX ix_routines_embedding ON routines USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_routines_embedding")
    op.drop_index("ix_routines_ws_status", table_name="routines")
    op.drop_table("routines")
    op.drop_column("files", "restricted")
    op.drop_column("memberships", "ai_daily_tokens")
    op.drop_index("ix_llm_calls_ws_user_ts", table_name="llm_calls")
    op.drop_column("llm_calls", "user_id")
