"""P127: answers a person's own AI prepared for their Microsoft approvals.

Fitri (23 Nov 2026): "when in chat or task the AI agent can help with approval kind of things".
The AI may prepare an Approve / Reject with a reason; it waits here until the person presses
Send on the Approvals page (microsoft/approval_models.py, microsoft/org_approvals.py).

Downgrade: the table goes (its answers were never sent).

Revision ID: 0079
Revises: 0078
Create Date: 2026-11-23 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0079"
down_revision: str | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "m365_approval_answers",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(length=40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ms_account_id",
            sa.String(length=40),
            sa.ForeignKey("microsoft_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id", sa.String(length=40), sa.ForeignKey("agents.id", ondelete="SET NULL")
        ),
        sa.Column("approval_id", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("response", sa.String(length=60), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("error", sa.String(length=500)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'discarded', 'failed')",
            name="ck_m365_approval_answers_status",
        ),
    )
    op.create_index(
        "ix_m365_approval_answers_person",
        "m365_approval_answers",
        ["workspace_id", "user_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_m365_approval_answers_person", table_name="m365_approval_answers")
    op.drop_table("m365_approval_answers")
