"""P35 customers and suppliers (parties and their contacts), a sales pipeline (deals), money
owed to us and by us (money_docs and their payments), everything that happened with a party
(interactions), and each company's payment-reminder policy

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-16 23:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ws() -> sa.Column:
    return sa.Column(
        "workspace_id",
        sa.String(40),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
    ]  # fmt: skip


def _money(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name, sa.Numeric(14, 2), nullable=nullable, server_default=None if nullable else "0"
    )


def upgrade() -> None:
    op.add_column("branches", sa.Column("reminder_policy", JSONB()))

    op.create_table(
        "parties",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(10), nullable=False, server_default="company"),
        sa.Column("roles", ARRAY(sa.String(16)), nullable=False, server_default="{}"),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_key", sa.String(200), nullable=False, server_default=""),
        sa.Column("legal_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("reg_no", sa.String(60), nullable=False, server_default=""),
        sa.Column("tin", sa.String(40), nullable=False, server_default=""),
        sa.Column("sst_no", sa.String(40), nullable=False, server_default=""),
        sa.Column("industry", sa.String(80), nullable=False, server_default=""),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("phone", sa.String(60), nullable=False, server_default=""),
        sa.Column("website", sa.String(200), nullable=False, server_default=""),
        sa.Column("address", JSONB(), nullable=False, server_default="{}"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MYR"),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False, server_default="30"),
        _money("credit_limit", nullable=True),
        sa.Column("tags", ARRAY(sa.String(40)), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("owner_user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(10), nullable=False, server_default="active"),
        sa.Column("source", sa.String(12), nullable=False, server_default="manual"),
        sa.Column("external", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.String(80), nullable=False, server_default=""),
        *_stamps(),
        sa.CheckConstraint("kind IN ('company', 'person')", name="ck_parties_kind"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_parties_status"),
        sa.CheckConstraint(
            "source IN ('manual', 'email', 'import', 'accounting')", name="ck_parties_source"
        ),
    )
    op.create_index("ix_parties_ws_lower_name", "parties", ["workspace_id", sa.text("lower(name)")])
    op.create_index("ix_parties_ws_name_key", "parties", ["workspace_id", "name_key"])
    op.create_index("ix_parties_ws_tin", "parties", ["workspace_id", "tin"])
    op.create_index("ix_parties_ws_reg_no", "parties", ["workspace_id", "reg_no"])
    op.create_index("ix_parties_ws_email", "parties", ["workspace_id", sa.text("lower(email)")])

    op.create_table(
        "party_contacts",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column(
            "party_id",
            sa.String(40),
            sa.ForeignKey("parties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("email", sa.String(254), nullable=False, server_default=""),
        sa.Column("phone", sa.String(60), nullable=False, server_default=""),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        *_stamps(),
    )
    op.create_index("ix_party_contacts_party_id", "party_contacts", ["party_id"])
    op.create_index(
        "ix_party_contacts_ws_email", "party_contacts", ["workspace_id", sa.text("lower(email)")]
    )

    op.create_table(
        "deals",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column("branch_id", sa.String(40), sa.ForeignKey("branches.id", ondelete="CASCADE")),
        sa.Column(
            "party_id",
            sa.String(40),
            sa.ForeignKey("parties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        _money("value"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MYR"),
        sa.Column("stage", sa.String(12), nullable=False, server_default="lead"),
        sa.Column("probability", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("expected_close", sa.Date()),
        sa.Column("owner_user_id", sa.String(40), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("agent_id", sa.String(40), sa.ForeignKey("agents.id", ondelete="SET NULL")),
        sa.Column("source", sa.String(40), nullable=False, server_default=""),
        sa.Column("next_step", sa.String(300), nullable=False, server_default=""),
        sa.Column("next_step_due", sa.Date()),
        sa.Column("lost_reason", sa.String(300), nullable=False, server_default=""),
        sa.Column("position", sa.Float(), nullable=False, server_default="0"),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", sa.String(80), nullable=False, server_default=""),
        *_stamps(),
        sa.CheckConstraint(
            "stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')",
            name="ck_deals_stage",
        ),
    )
    op.create_index("ix_deals_ws_stage", "deals", ["workspace_id", "stage", "position"])
    op.create_index("ix_deals_party", "deals", ["party_id"])

    op.create_table(
        "money_docs",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column(
            "branch_id",
            sa.String(40),
            sa.ForeignKey("branches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "party_id",
            sa.String(40),
            sa.ForeignKey("parties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("direction", sa.String(12), nullable=False),
        sa.Column("number", sa.String(60), nullable=False, server_default=""),
        sa.Column("reference", sa.String(120), nullable=False, server_default=""),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date()),
        sa.Column("currency", sa.String(3), nullable=False, server_default="MYR"),
        _money("subtotal"),
        _money("tax_total"),
        _money("total"),
        _money("amount_paid"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("lines", JSONB(), nullable=False, server_default="[]"),
        sa.Column("document_id", sa.String(40), sa.ForeignKey("documents.id", ondelete="SET NULL")),
        sa.Column("file_id", sa.String(40), sa.ForeignKey("files.id", ondelete="SET NULL")),
        sa.Column(
            "mail_item_id", sa.String(40), sa.ForeignKey("mail_items.id", ondelete="SET NULL")
        ),
        sa.Column("source", sa.String(12), nullable=False, server_default="manual"),
        sa.Column("external", JSONB(), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("approved_by", sa.String(80)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "duplicate_of", sa.String(40), sa.ForeignKey("money_docs.id", ondelete="SET NULL")
        ),
        sa.Column("task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("reminders", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_by", sa.String(80), nullable=False, server_default=""),
        *_stamps(),
        sa.CheckConstraint(
            "direction IN ('receivable', 'payable')", name="ck_money_docs_direction"
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'awaiting_approval', 'approved', 'sent', 'partially_paid',"
            " 'paid', 'void')",
            name="ck_money_docs_status",
        ),
        sa.CheckConstraint(
            "source IN ('manual', 'document', 'email', 'upload', 'accounting')",
            name="ck_money_docs_source",
        ),
    )
    op.create_index(
        "ix_money_docs_ws_dir_status", "money_docs", ["workspace_id", "direction", "status"]
    )
    op.create_index("ix_money_docs_ws_due", "money_docs", ["workspace_id", "due_date"])
    op.create_index("ix_money_docs_party", "money_docs", ["party_id"])

    op.create_table(
        "payments",
        sa.Column("id", sa.String(40), primary_key=True),
        _ws(),
        sa.Column(
            "money_doc_id",
            sa.String(40),
            sa.ForeignKey("money_docs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("paid_at", sa.Date(), nullable=False),
        sa.Column("method", sa.String(16), nullable=False, server_default="bank_transfer"),
        sa.Column("reference", sa.String(120), nullable=False, server_default=""),
        sa.Column("recorded_by", sa.String(80), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),  # fmt: skip
        sa.CheckConstraint(
            "method IN ('bank_transfer', 'duitnow', 'fpx', 'cash', 'cheque', 'card', 'online',"
            " 'other')",
            name="ck_payments_method",
        ),
    )
    op.create_index("ix_payments_money_doc_id", "payments", ["money_doc_id"])

    op.create_table(
        "interactions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _ws(),
        sa.Column(
            "party_id",
            sa.String(40),
            sa.ForeignKey("parties.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column(
            "mail_item_id", sa.String(40), sa.ForeignKey("mail_items.id", ondelete="SET NULL")
        ),
        sa.Column("task_id", sa.String(40), sa.ForeignKey("tasks.id", ondelete="SET NULL")),
        sa.Column("document_id", sa.String(40), sa.ForeignKey("documents.id", ondelete="SET NULL")),
        sa.Column(
            "money_doc_id", sa.String(40), sa.ForeignKey("money_docs.id", ondelete="SET NULL")
        ),
        sa.Column("deal_id", sa.String(40), sa.ForeignKey("deals.id", ondelete="SET NULL")),
        sa.Column("summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("data", JSONB(), nullable=False, server_default="{}"),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.CheckConstraint(
            "kind IN ('email_in', 'email_out', 'note', 'call', 'meeting', 'task', 'document',"
            " 'invoice', 'payment', 'deal')",
            name="ck_interactions_kind",
        ),
    )
    op.create_index("ix_interactions_party_at", "interactions", ["party_id", "at"])
    op.create_index("ix_interactions_mail_item_id", "interactions", ["mail_item_id"])


def downgrade() -> None:
    op.drop_table("interactions")
    op.drop_table("payments")
    op.drop_table("money_docs")
    op.drop_table("deals")
    op.drop_table("party_contacts")
    op.drop_table("parties")
    op.drop_column("branches", "reminder_policy")
