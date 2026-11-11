"""P98: a member may work in several branches at once.

- membership_branches: every branch a member belongs to in a workspace (their home branch
  included). memberships.branch_id stays the home (primary) branch: where their own agents are
  placed and what older screens show. Every existing home branch is copied in.
- Scope (api/scope.py) covers all of a member's branches: a branch manager of two branches
  sees both, never a third.

Downgrade drops the table: each member keeps their home branch only.

Revision ID: 0061
Revises: 0060
Create Date: 2026-11-11 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "membership_branches",
        sa.Column("workspace_id", sa.String(40), primary_key=True),
        sa.Column("user_id", sa.String(40), primary_key=True),
        sa.Column(
            "branch_id",
            sa.String(40),
            sa.ForeignKey("branches.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "user_id"],
            ["memberships.workspace_id", "memberships.user_id"],
            ondelete="CASCADE",
            name="fk_membership_branches_membership",
        ),
    )
    op.create_index(
        "ix_membership_branches_branch", "membership_branches", ["workspace_id", "branch_id"]
    )
    op.execute(
        "INSERT INTO membership_branches (workspace_id, user_id, branch_id) "
        "SELECT workspace_id, user_id, branch_id FROM memberships WHERE branch_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_membership_branches_branch", table_name="membership_branches")
    op.drop_table("membership_branches")
