"""P92: two leadership roles, management and hr (admin's access without the AI engine, file
storage and MCP tools), and prima_links.relink_needed: a person whose email or Microsoft link
was corrected gets their Prima account brought up to date the next time they open Prima.

Role access the owner changes lives in workspaces.settings["role_permissions"] (no column).

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Merging after another 0054: change only down_revision below (to "0054").
revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ROLES = (
    "owner",
    "admin",
    "branch_manager",
    "hod",
    "supervisor",
    "staff",
    "operator",
    "approver",
    "viewer",
)
NEW_ROLES = (*OLD_ROLES, "management", "hr")


def _role_check(roles: tuple[str, ...]) -> str:
    return "role IN (" + ", ".join(f"'{r}'" for r in roles) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(NEW_ROLES))
    op.add_column(
        "prima_links",
        sa.Column("relink_needed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("prima_links", "relink_needed")
    # Nobody may be left in a role the old constraint does not know. Management and HR become
    # viewers (they still sign in and read; an owner gives them a role again): never admin,
    # which would hand them the AI engine, storage and MCP tools on a rollback.
    op.execute("UPDATE memberships SET role = 'viewer' WHERE role IN ('management', 'hr')")
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(OLD_ROLES))
