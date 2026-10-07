"""P31: a person's own computers (the PC agent), the one-time codes that link them, what
their own AI did on them, and which PC a task browses on

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-07 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ws() -> sa.Column:
    return sa.Column(
        "workspace_id",
        sa.String(40),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user() -> sa.Column:
    return sa.Column(
        "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


def _created() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        _user(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("os", sa.String(16), nullable=False, server_default=""),
        sa.Column("arch", sa.String(16), nullable=False, server_default=""),
        sa.Column("version", sa.String(40), nullable=False, server_default=""),
        sa.Column("hostname", sa.String(120), nullable=False, server_default=""),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("folders", JSONB(), nullable=False, server_default="[]"),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("browsers", JSONB(), nullable=False, server_default="[]"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        _created(),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_devices_user", "devices", ["user_id"])
    op.create_table(
        "device_link_codes",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        _ws(),
        _user(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("device_id", sa.String(40), sa.ForeignKey("devices.id", ondelete="SET NULL")),
        _created(),
    )
    op.create_index("ix_device_link_codes_user", "device_link_codes", ["user_id"])
    op.create_table(
        "device_activity",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "device_id",
            sa.String(40),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _ws(),
        _user(),
        sa.Column("agent_id", sa.String(40), sa.ForeignKey("agents.id", ondelete="SET NULL")),
        sa.Column("task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("detail", JSONB(), nullable=False, server_default="{}"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_device_activity_user", "device_activity", ["user_id"])
    op.create_index("ix_device_activity_device_ts", "device_activity", ["device_id", "ts"])
    op.add_column("tasks", sa.Column("device_id", sa.String(40)))


def downgrade() -> None:
    op.drop_column("tasks", "device_id")
    op.drop_index("ix_device_activity_device_ts", table_name="device_activity")
    op.drop_index("ix_device_activity_user", table_name="device_activity")
    op.drop_table("device_activity")
    op.drop_index("ix_device_link_codes_user", table_name="device_link_codes")
    op.drop_table("device_link_codes")
    op.drop_index("ix_devices_user", table_name="devices")
    op.drop_table("devices")
