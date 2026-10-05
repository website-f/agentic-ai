"""P25: provenance of documents and files (who made it: a person, an agent, an upload), the
workflow run it came from, the file an export landed in, and the review of agent-made work

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-05 23:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------------------------------------------------------------- documents
    op.add_column(
        "documents", sa.Column("origin", sa.String(10), nullable=False, server_default="person")
    )
    op.create_check_constraint("ck_documents_origin", "documents", "origin IN ('person', 'agent')")
    op.add_column("documents", sa.Column("workflow_run_id", sa.String(40), nullable=True))
    op.add_column("documents", sa.Column("review", JSONB(), nullable=True))
    op.create_index("ix_documents_workflow_run_id", "documents", ["workflow_run_id"])
    op.create_index(
        "ix_documents_ws_origin_status", "documents", ["workspace_id", "origin", "status"]
    )
    op.execute(
        "UPDATE documents SET origin = 'agent' "
        "WHERE agent_id IS NOT NULL OR created_by LIKE 'agent:%'"
    )
    op.execute(
        "UPDATE documents d SET workflow_run_id = t.workflow_run_id FROM tasks t "
        "WHERE d.task_id = t.id AND t.workflow_run_id IS NOT NULL"
    )

    # ---------------------------------------------------------------- files
    op.add_column(
        "files", sa.Column("origin", sa.String(10), nullable=False, server_default="uploaded")
    )
    op.create_check_constraint(
        "ck_files_origin", "files", "origin IN ('uploaded', 'person', 'agent')"
    )
    op.add_column("files", sa.Column("workflow_run_id", sa.String(40), nullable=True))
    op.add_column(
        "files",
        sa.Column(
            "document_id",
            sa.String(40),
            sa.ForeignKey("documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "files",
        sa.Column(
            "report_id",
            sa.String(40),
            sa.ForeignKey("reports.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_files_workflow_run_id", "files", ["workflow_run_id"])
    op.create_index("ix_files_document_id", "files", ["document_id"])
    op.create_index("ix_files_report_id", "files", ["report_id"])
    op.create_index("ix_files_ws_origin", "files", ["workspace_id", "origin"])
    # Files an agent made before agent_id was always set (run_python outputs).
    op.execute(
        "UPDATE files f SET agent_id = a.id FROM agents a "
        "WHERE f.agent_id IS NULL AND f.created_by LIKE 'agent:%' "
        "AND a.id = substring(f.created_by from 7)"
    )
    op.execute(
        "UPDATE files SET origin = CASE "
        "WHEN source = 'upload' THEN 'uploaded' "
        "WHEN agent_id IS NOT NULL OR created_by LIKE 'agent:%' THEN 'agent' "
        "ELSE 'person' END"
    )
    op.execute(
        "UPDATE files f SET workflow_run_id = t.workflow_run_id FROM tasks t "
        "WHERE f.task_id = t.id AND t.workflow_run_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_files_ws_origin", table_name="files")
    op.drop_index("ix_files_report_id", table_name="files")
    op.drop_index("ix_files_document_id", table_name="files")
    op.drop_index("ix_files_workflow_run_id", table_name="files")
    for c in ("report_id", "document_id", "workflow_run_id"):
        op.drop_column("files", c)
    op.drop_constraint("ck_files_origin", "files", type_="check")
    op.drop_column("files", "origin")
    op.drop_index("ix_documents_ws_origin_status", table_name="documents")
    op.drop_index("ix_documents_workflow_run_id", table_name="documents")
    op.drop_column("documents", "review")
    op.drop_column("documents", "workflow_run_id")
    op.drop_constraint("ck_documents_origin", "documents", type_="check")
    op.drop_column("documents", "origin")
