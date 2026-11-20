"""P120: the group HOD role and people's requests that wait for approval.

Fitri (20 Nov 2026):
- "HOD is for one company, so create another HOD role that can manage multiple branches or
  companies": memberships.role may be 'group_hod' (api/scope.py: each of their companies).
- "in the Library the OneDrive link ... available to normal staff but with an approval process:
  once they key in a link, their manager approves it or not, and all approvals are on the
  Approvals page, not just the AI's": person_requests, one row per request (org/requests.py).

Additive. Downgrade makes group HODs plain HODs first (never a wider role), then drops the table.

Revision ID: 0074
Revises: 0073
Create Date: 2026-11-20 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0074"
down_revision: str | None = "0073"
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
)
NEW_ROLES = (*OLD_ROLES, "group_hod")


def _role_check(roles: tuple[str, ...]) -> str:
    return "role IN (" + ", ".join(f"'{r}'" for r in roles) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(NEW_ROLES))
    op.create_table(
        "person_requests",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column(
            "requested_by",
            sa.String(length=40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "approver_id", sa.String(length=40), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column(
            "branch_id", sa.String(length=40), sa.ForeignKey("branches.id", ondelete="SET NULL")
        ),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"
        ),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column(
            "decided_by", sa.String(length=40), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("result_id", sa.String(length=40)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'declined', 'cancelled')",
            name="ck_person_requests_status",
        ),
    )
    op.create_index("ix_person_requests_ws_status", "person_requests", ["workspace_id", "status"])
    op.create_index("ix_person_requests_ws_by", "person_requests", ["workspace_id", "requested_by"])


def downgrade() -> None:
    op.drop_index("ix_person_requests_ws_by", table_name="person_requests")
    op.drop_index("ix_person_requests_ws_status", table_name="person_requests")
    op.drop_table("person_requests")
    op.execute("UPDATE memberships SET role = 'hod' WHERE role = 'group_hod'")
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(OLD_ROLES))
