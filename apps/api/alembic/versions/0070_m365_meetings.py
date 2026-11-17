"""P109b: Teams meetings made from the Microsoft 365 workspace, and their Prima record.

Fitri (17 Nov 2026): a person asks the AI to set up a Teams meeting, checks it, presses
"Create and send invitations" (Outlook sends them), and the meeting is also recorded in Prima's
Meetings as that person. The office keeps which Outlook event is which Prima meeting, so a later
change or cancel made in the office reaches the Prima record too.

- m365_meetings: one row per meeting a person made here (their own Outlook event id, the join
  link, the Prima meeting id or why it was not added).

Additive only: one new table. Downgrade drops it (the Outlook events and Prima meetings stay).

Revision ID: 0070
Revises: 0069
Create Date: 2026-11-17 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0070"
down_revision: str | None = "0069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "m365_meetings",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(40),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("event_id", sa.String(512), nullable=False),
        sa.Column("title", sa.String(255), nullable=False, server_default=""),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "attendees",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("agenda", sa.Text(), nullable=False, server_default=""),
        sa.Column("join_url", sa.Text()),
        sa.Column("web_link", sa.Text()),
        sa.Column("kind", sa.String(20), nullable=False, server_default="management"),
        sa.Column("prima_status", sa.String(12), nullable=False, server_default="none"),
        sa.Column("prima_meeting_id", sa.String(120)),
        sa.Column("prima_error", sa.String(500)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("workspace_id", "user_id", "event_id", name="uq_m365_meetings_event"),
        sa.CheckConstraint(
            "prima_status IN ('none', 'added', 'failed', 'skipped', 'cancelled')",
            name="ck_m365_meetings_prima_status",
        ),
    )
    op.create_index(
        "ix_m365_meetings_owner", "m365_meetings", ["workspace_id", "user_id", "start_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_m365_meetings_owner", table_name="m365_meetings")
    op.drop_table("m365_meetings")
