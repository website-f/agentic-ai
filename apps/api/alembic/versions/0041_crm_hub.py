"""P50: the universal CRM: objects (custom, built-in from the office's own data, synced from
other systems), their fields, records, saved views, dashboard widgets, connectors to other
systems, and who besides the owner may see which object.

Revision ID: 0041
Revises: 0040
Create Date: 2026-10-27 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def _ws() -> sa.Column:
    return sa.Column(
        "workspace_id",
        sa.String(40),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )


def _object(nullable: bool = False, on_delete: str = "CASCADE") -> sa.Column:
    return sa.Column(
        "object_id",
        sa.String(40),
        sa.ForeignKey("crm_objects.id", ondelete=on_delete),
        nullable=nullable,
    )


def upgrade() -> None:
    jsonb = postgresql.JSONB
    op.create_table(
        "crm_objects",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("singular", sa.String(80), nullable=False, server_default=""),
        sa.Column("description", sa.String(300), nullable=False, server_default=""),
        sa.Column("icon", sa.String(40), nullable=False, server_default="cube"),
        sa.Column("color", sa.String(20), nullable=False, server_default="#13895f"),
        sa.Column("kind", sa.String(10), nullable=False, server_default="custom"),
        sa.Column("source", sa.String(40)),
        sa.Column("connector_id", sa.String(40)),
        sa.Column("title_field", sa.String(60), nullable=False, server_default="name"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("meta", jsonb, nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(80), nullable=False),
        *_ts(),
        sa.UniqueConstraint("workspace_id", "key", name="uq_crm_objects_key"),
        sa.CheckConstraint("kind IN ('custom', 'builtin', 'synced')", name="ck_crm_objects_kind"),
    )
    op.create_table(
        "crm_fields",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        _object(),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="text"),
        sa.Column("options", jsonb, nullable=False, server_default="{}"),
        sa.Column("required", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("hidden", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("builtin", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("source_path", sa.String(200)),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(80), nullable=False),
        *_ts(),
        sa.UniqueConstraint("object_id", "key", name="uq_crm_fields_key"),
    )
    op.create_table(
        "crm_records",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        _object(),
        sa.Column("data", jsonb, nullable=False, server_default="{}"),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("external_id", sa.String(200)),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("updated_by", sa.String(80), nullable=False, server_default=""),
        *_ts(),
        sa.UniqueConstraint("object_id", "external_id", name="uq_crm_records_external"),
    )
    op.create_index("ix_crm_records_object", "crm_records", ["object_id", "updated_at"])
    op.create_index("ix_crm_records_data", "crm_records", ["data"], postgresql_using="gin")
    op.create_table(
        "crm_views",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        _object(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="table"),
        sa.Column("config", jsonb, nullable=False, server_default="{}"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(80), nullable=False),
        *_ts(),
    )
    op.create_table(
        "crm_widgets",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="number"),
        sa.Column("config", jsonb, nullable=False, server_default="{}"),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("size", sa.String(6), nullable=False, server_default="sm"),
        sa.Column("created_by", sa.String(80), nullable=False),
        *_ts(),
    )
    op.create_table(
        "crm_connectors",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("preset", sa.String(40)),
        sa.Column("config", jsonb, nullable=False, server_default="{}"),
        _object(nullable=True, on_delete="SET NULL"),
        sa.Column("every_minutes", sa.Integer, nullable=False, server_default="60"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("webhook_hash", sa.String(64), unique=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("last_status", sa.String(10), nullable=False, server_default="never"),
        sa.Column("last_error", sa.String(500)),
        sa.Column("stats", jsonb, nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(80), nullable=False),
        *_ts(),
        sa.CheckConstraint("kind IN ('rest', 'csv', 'webhook')", name="ck_crm_connectors_kind"),
    )
    op.create_table(
        "crm_access",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column(
            "user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        _object(nullable=True),
        sa.Column("level", sa.String(6), nullable=False, server_default="view"),
        sa.Column("hidden_fields", jsonb, nullable=False, server_default="[]"),
        sa.Column("granted_by", sa.String(80), nullable=False),
        *_ts(),
        sa.UniqueConstraint("workspace_id", "user_id", "object_id", name="uq_crm_access"),
        sa.CheckConstraint("level IN ('view', 'edit')", name="ck_crm_access_level"),
    )


def downgrade() -> None:
    for t in ("crm_access", "crm_connectors", "crm_widgets", "crm_views"):
        op.drop_table(t)
    op.drop_index("ix_crm_records_data", "crm_records")
    op.drop_index("ix_crm_records_object", "crm_records")
    op.drop_table("crm_records")
    op.drop_table("crm_fields")
    op.drop_table("crm_objects")
