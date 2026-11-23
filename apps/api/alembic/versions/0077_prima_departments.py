"""P125: a member's own Prima account may be in every working central department.

Fitri (23 Nov 2026): a supervisor given Finance, Procurement, Requests and the like in their
Prima modules saw none of them: Prima opens those screens by department, and an office account
could only be in transport, procurement or hr. Now also finance, chief_of_staff, it, legal,
audit, operations, asset, pdpa, fwm and cms (not director_office or arms_control). HR, finance,
the Chief of Staff's office, audit and legal stay central staff only (Prima refuses them on any
other role).

Downgrade: a member in one of the new departments goes back to no department.

Revision ID: 0077
Revises: 0076
Create Date: 2026-11-23 16:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0077"
down_revision: str | None = "0076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "('transport', 'procurement', 'hr')"
NEW = (
    "('transport', 'procurement', 'hr', 'finance', 'chief_of_staff', 'it', 'legal', 'audit', "
    "'operations', 'asset', 'pdpa', 'fwm', 'cms')"
)


def upgrade() -> None:
    op.drop_constraint("ck_memberships_prima_department", "memberships", type_="check")
    op.create_check_constraint(
        "ck_memberships_prima_department",
        "memberships",
        f"prima_department IS NULL OR prima_department IN {NEW}",
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE memberships SET prima_department = NULL WHERE prima_department NOT IN {OLD}"  # noqa: S608
    )
    op.drop_constraint("ck_memberships_prima_department", "memberships", type_="check")
    op.create_check_constraint(
        "ck_memberships_prima_department",
        "memberships",
        f"prima_department IS NULL OR prima_department IN {OLD}",
    )
