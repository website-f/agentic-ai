"""P125: the IT support role, and the changes they make that wait for approval.

The owner (23 Nov 2026): "Add another high-privilege role under admin: IT support. ... whatever
IT support does, an owner, the developer or a global admin must approve it first; it shows on
the Approvals page with what they want approved, and only once approved does it take effect."

- memberships.role may be 'it_support' (core/security.py). "Admin" is shown as "Global admin";
  its id stays 'admin', so no data changes.
- held_changes: one row per held call (org/held_models.py, org/held.py).

Downgrade: IT support people become staff (never a wider role) and lose their sessions, so
nobody keeps an admin's access without the hold; then the table goes (its waiting changes were
never applied, so nothing else changes).

Revision ID: 0076
Revises: 0075
Create Date: 2026-11-23 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0076"
down_revision: str | None = "0075"
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
    "management",
    "hr",
    "group_hod",
)
NEW_ROLES = (*OLD_ROLES, "it_support")


def _role_check(roles: tuple[str, ...]) -> str:
    return "role IN (" + ", ".join(f"'{r}'" for r in roles) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(NEW_ROLES))
    op.create_table(
        "held_changes",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by",
            sa.String(length=40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requested_role", sa.String(length=32), nullable=False),
        sa.Column("method", sa.String(length=8), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("query", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_type", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("body_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("body_raw", sa.LargeBinary()),
        sa.Column("title", sa.String(length=300), nullable=False, server_default=""),
        sa.Column(
            "summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
        sa.Column(
            "details", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"
        ),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "decided_by", sa.String(length=40), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("apply_status", sa.Integer()),
        sa.Column("apply_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending', 'applying', 'applied', 'declined', 'cancelled', 'expired')",
            name="ck_held_changes_status",
        ),
        sa.CheckConstraint(
            "method IN ('POST', 'PUT', 'PATCH', 'DELETE')", name="ck_held_changes_m"
        ),
    )
    op.create_index("ix_held_changes_ws_status", "held_changes", ["workspace_id", "status"])
    op.create_index("ix_held_changes_ws_by", "held_changes", ["workspace_id", "requested_by"])


def downgrade() -> None:
    op.execute(
        "DELETE FROM auth_sessions WHERE user_id IN "
        "(SELECT user_id FROM memberships WHERE role = 'it_support')"
    )
    op.execute("UPDATE memberships SET role = 'staff' WHERE role = 'it_support'")
    op.drop_index("ix_held_changes_ws_by", table_name="held_changes")
    op.drop_index("ix_held_changes_ws_status", table_name="held_changes")
    op.drop_table("held_changes")
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(OLD_ROLES))
