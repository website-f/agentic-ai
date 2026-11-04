"""P65: SOPs imported from a knowledge pack (the Prima Secure SOPs, workflows and rules).

sops.pack_key: the pack section an SOP came from ("prima:docs/system/04-workflows.md#w12"),
unique per workspace, so re-running the import never duplicates it. sops.pack_hash: sha256
of the title and body the import last wrote (unchanged -> skipped; a person's edit is kept).

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sops", sa.Column("pack_key", sa.String(160), nullable=True))
    op.add_column("sops", sa.Column("pack_hash", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_sops_ws_pack_key", "sops", ["workspace_id", "pack_key"])


def downgrade() -> None:
    op.drop_constraint("uq_sops_ws_pack_key", "sops", type_="unique")
    op.drop_column("sops", "pack_hash")
    op.drop_column("sops", "pack_key")
