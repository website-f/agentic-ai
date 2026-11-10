"""P97: pin anything to the desk, name pins and keep them in folders.

A pin can now be any screen of the app or of Prima (`route`), a web link (`link`), a report or
a contact, besides SOPs, workflows, files, documents, templates, wiki pages, tasks, agents and
saved searches. Each pin may carry the person's own name for it (`label`) and sit in one of
their folders (`folder`); a screen's address can be longer than an id, so `ref` grows to 600.

Revision ID: 0060
Revises: 0058
Create Date: 2026-11-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "'sop', 'workflow', 'file', 'document', 'template', 'page', 'task', 'agent', 'search'"
NEW = OLD + ", 'route', 'link', 'report', 'contact'"


def upgrade() -> None:
    op.drop_constraint("ck_desk_items_kind", "desk_items", type_="check")
    op.create_check_constraint("ck_desk_items_kind", "desk_items", f"kind IN ({NEW})")
    op.alter_column("desk_items", "ref", type_=sa.String(600), existing_type=sa.String(300))
    op.add_column("desk_items", sa.Column("label", sa.String(120), nullable=True))
    op.add_column("desk_items", sa.Column("folder", sa.String(60), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM desk_items WHERE kind IN ('route', 'link', 'report', 'contact')")
    op.drop_column("desk_items", "folder")
    op.drop_column("desk_items", "label")
    op.execute("DELETE FROM desk_items WHERE length(ref) > 300")
    op.alter_column("desk_items", "ref", type_=sa.String(300), existing_type=sa.String(600))
    op.drop_constraint("ck_desk_items_kind", "desk_items", type_="check")
    op.create_check_constraint("ck_desk_items_kind", "desk_items", f"kind IN ({OLD})")
