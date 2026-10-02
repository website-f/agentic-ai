"""office roles, personal agents and helpers, login vault, reports

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-02 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_ROLES = (
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
OLD_ROLES = ("owner", "admin", "operator", "approver", "viewer")


def _role_check(roles: tuple[str, ...]) -> str:
    return "role IN (" + ", ".join(f"'{r}'" for r in roles) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(NEW_ROLES))
    op.add_column("memberships", sa.Column("branch_id", sa.String(length=40), nullable=True))
    op.add_column("memberships", sa.Column("department_id", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "fk_memberships_branch",
        "memberships",
        "branches",
        ["branch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_memberships_department",
        "memberships",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("agents", sa.Column("owner_user_id", sa.String(length=40), nullable=True))
    op.add_column("agents", sa.Column("clone_of", sa.String(length=40), nullable=True))
    op.create_foreign_key(
        "fk_agents_owner_user", "agents", "users", ["owner_user_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_agents_owner_user_id", "agents", ["owner_user_id"])
    op.create_index("ix_agents_clone_of", "agents", ["clone_of"])

    op.add_column(
        "tasks",
        sa.Column(
            "labels", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False
        ),
    )

    op.create_table(
        "credentials",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("owner_user_id", sa.String(length=40), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("hosts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("username_enc", sa.Text(), nullable=False),
        sa.Column("password_enc", sa.Text(), nullable=False),
        sa.Column("username_hint", sa.String(length=40), nullable=False),
        sa.Column("agent_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.String(length=80), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_credentials_ws_name"),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=40), nullable=False),
        sa.Column("workspace_id", sa.String(length=40), nullable=False),
        sa.Column("branch_id", sa.String(length=40), nullable=True),
        sa.Column("agent_id", sa.String(length=40), nullable=True),
        sa.Column("task_id", sa.String(length=40), nullable=True),
        sa.Column("call_id", sa.String(length=80), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.String(length=600), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tables", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("labels", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_ws_created", "reports", ["workspace_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_reports_ws_created", table_name="reports")
    op.drop_table("reports")
    op.drop_table("credentials")
    op.drop_column("tasks", "labels")
    op.drop_index("ix_agents_clone_of", table_name="agents")
    op.drop_index("ix_agents_owner_user_id", table_name="agents")
    op.drop_constraint("fk_agents_owner_user", "agents", type_="foreignkey")
    op.drop_column("agents", "clone_of")
    op.drop_column("agents", "owner_user_id")
    op.drop_constraint("fk_memberships_department", "memberships", type_="foreignkey")
    op.drop_constraint("fk_memberships_branch", "memberships", type_="foreignkey")
    op.drop_column("memberships", "department_id")
    op.drop_column("memberships", "branch_id")
    op.execute(
        "DELETE FROM memberships WHERE role NOT IN ('owner', 'admin', 'operator', "
        "'approver', 'viewer')"
    )
    op.drop_constraint("ck_memberships_role", "memberships", type_="check")
    op.create_check_constraint("ck_memberships_role", "memberships", _role_check(OLD_ROLES))
