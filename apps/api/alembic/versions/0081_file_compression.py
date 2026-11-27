"""P143c: uploaded files are made smaller in the background, same format.

The owner (27 Nov 2026): every file uploaded (the Library and the rest) is compressed as far as
it goes while it opens the same: same name, extension and type, only fewer bytes. The worker
does it after reading the file (documents/compress.py) and keeps what it did on the file:
{"result": "smaller" | "kept", "original_size", "original_sha256", "method", "reason", "at"}.
The size and sha256 columns then describe the bytes kept; original_sha256 lets an import or a
mail backup still know a file it saved before (they match on the original's hash).

Downgrade: the column goes (the smaller bytes stay; "compressed from" is no longer shown).

Revision ID: 0081
Revises: 0080
Create Date: 2026-11-27 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "files", sa.Column("compression", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("files", "compression")
