"""P61: labels on files (the Library's own tags: "urgent", "Q3", "for audit").

files.labels: a short list of strings a person puts on a file (at most 12, each 1..30
characters, case kept). Created folders that hold no file yet live in the workspace's
settings ("file_folders"), so they need no table.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-03 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column(
            "labels",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("files", "labels")
