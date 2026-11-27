"""P145: the group structure (units and positions) and who holds which position.

The owner (27 Nov 2026): "Full revamp of the org chart, organization and members setup. Roles
come from DIRECTOR OFFICE GORVERNANCE.pdf and GOVERNMENT OPERATION.pdf ... if a member's role
can't be identified, I must be able to sort them manually very easily ... I can add a new role
when it's not listed."

- org_units: offices, departments, divisions, regions and companies of the group, as a tree
  (parent_id). A unit may stand for an office company (branch_id) or department (department_id).
- org_positions: the job roles in each unit, each reporting to another position (reports_to_id),
  with the office role its holders usually have, the planned headcount and the duties.
- memberships.position_id: the position this member holds (one; null = not sorted yet).
- memberships.work_email: their work email from the staff lists (the CSV sync fills it).

Seeded per workspace from agentic/org/structure_seed.json (org/structure.py).

Downgrade: the two columns and both tables go (job titles stay as they are).

Revision ID: 0083
Revises: 0082
Create Date: 2026-11-27 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0083"
down_revision: str | None = "0082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _times() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "org_units",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("name_ms", sa.String(length=160)),
        sa.Column(
            "parent_id", sa.String(length=40), sa.ForeignKey("org_units.id", ondelete="SET NULL")
        ),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="unit"),
        sa.Column(
            "branch_id", sa.String(length=40), sa.ForeignKey("branches.id", ondelete="SET NULL")
        ),
        sa.Column(
            "department_id",
            sa.String(length=40),
            sa.ForeignKey("departments.id", ondelete="SET NULL"),
        ),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("custom", sa.Boolean(), nullable=False, server_default="false"),
        *_times(),
        sa.UniqueConstraint("workspace_id", "key", name="uq_org_units_ws_key"),
        sa.CheckConstraint(
            "kind IN ('governance', 'office', 'department', 'unit', 'division', 'region', "
            "'company', 'team')",
            name="ck_org_units_kind",
        ),
    )
    op.create_index("ix_org_units_ws_parent", "org_units", ["workspace_id", "parent_id"])
    op.create_table(
        "org_positions",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("title_ms", sa.String(length=160)),
        sa.Column(
            "unit_id",
            sa.String(length=40),
            sa.ForeignKey("org_units.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reports_to_id",
            sa.String(length=40),
            sa.ForeignKey("org_positions.id", ondelete="SET NULL"),
        ),
        sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("default_role", sa.String(length=16)),
        sa.Column("headcount", sa.Integer()),
        sa.Column("duties", sa.Text()),
        sa.Column(
            "aliases",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("custom", sa.Boolean(), nullable=False, server_default="false"),
        *_times(),
        sa.UniqueConstraint("workspace_id", "key", name="uq_org_positions_ws_key"),
    )
    op.create_index("ix_org_positions_ws_unit", "org_positions", ["workspace_id", "unit_id"])
    op.add_column(
        "memberships",
        sa.Column(
            "position_id",
            sa.String(length=40),
            sa.ForeignKey("org_positions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("memberships", sa.Column("work_email", sa.String(length=254), nullable=True))
    op.create_index("ix_memberships_position", "memberships", ["position_id"])


def downgrade() -> None:
    op.drop_index("ix_memberships_position", table_name="memberships")
    op.drop_column("memberships", "work_email")
    op.drop_column("memberships", "position_id")
    op.drop_index("ix_org_positions_ws_unit", table_name="org_positions")
    op.drop_table("org_positions")
    op.drop_index("ix_org_units_ws_parent", table_name="org_units")
    op.drop_table("org_units")
