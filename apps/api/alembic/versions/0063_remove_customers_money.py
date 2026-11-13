"""P102: the office's "Customers and money" module is removed (Prima does that work now).

Dropped: the CRM (crm_objects, crm_fields, crm_records, crm_views, crm_widgets,
crm_connectors, crm_access), customers and suppliers (parties, party_contacts), the sales
pipeline (deals), money owed both ways (money_docs, payments), party timelines
(interactions) and each company's payment-reminder policy (branches.reminder_policy).

Also cleaned: desk pins of a contact or of a removed page, the approval limits
(workspaces.settings["approval_limits"]), the shared mailboxes' "capture_bills" rule, and
the removed money and contact tools on agents and blueprints.

Downgrade recreates the tables, the column and the desk pin kind exactly as 0035 and 0041
made them (empty: the rows dropped here do not come back).

Revision ID: 0063
Revises: 0062
Create Date: 2026-11-13 12:00:00
"""

import importlib.util
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Children before parents (foreign keys).
TABLES = (
    "interactions",
    "payments",
    "money_docs",
    "deals",
    "party_contacts",
    "parties",
    "crm_access",
    "crm_connectors",
    "crm_widgets",
    "crm_views",
    "crm_records",
    "crm_fields",
    "crm_objects",
)
TOOLS = (
    "find_party",
    "get_party",
    "create_party",
    "update_party",
    "add_party_note",
    "log_interaction",
    "list_deals",
    "create_deal",
    "update_deal",
    "list_money",
    "money_summary",
    "aging_report",
    "cashflow_forecast",
    "create_invoice_draft",
    "capture_bill",
    "draft_payment_reminder",
)
GONE_PAGES = r"^/(crm|contacts|deals|money|settings/approval-limits)([/?#]|$)"
PIN_KINDS = "'sop', 'workflow', 'file', 'document', 'template', 'page', 'task', 'agent', 'search'"
OLD_KINDS = PIN_KINDS + ", 'route', 'link', 'report', 'contact'"
NEW_KINDS = PIN_KINDS + ", 'route', 'link', 'report'"


def upgrade() -> None:
    op.execute(
        "DELETE FROM desk_items WHERE kind = 'contact'"  # noqa: S608 - constants of this file
        f" OR (kind = 'route' AND ref ~ '{GONE_PAGES}')"
    )
    op.drop_constraint("ck_desk_items_kind", "desk_items", type_="check")
    op.create_check_constraint("ck_desk_items_kind", "desk_items", f"kind IN ({NEW_KINDS})")

    for t in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
    op.drop_column("branches", "reminder_policy")

    op.execute(
        "UPDATE workspaces SET settings = settings - 'approval_limits'"
        " WHERE settings ? 'approval_limits'"
    )
    op.execute(
        "UPDATE shared_mailboxes SET rules = rules - 'capture_bills' WHERE rules ? 'capture_bills'"
    )
    names = "ARRAY[" + ", ".join(f"'{n}'" for n in TOOLS) + "]::text[]"
    for table in ("agents", "blueprints"):
        op.execute(
            f"UPDATE {table} SET tools = tools - {names}"  # noqa: S608 - constants of this file
            f" WHERE jsonb_typeof(tools) = 'object' AND tools ?| {names}"
        )


def _run(file: str) -> None:
    """The upgrade() of an earlier revision in this folder (it made these tables)."""
    path = Path(__file__).with_name(file)
    spec = importlib.util.spec_from_file_location(f"_p102_{path.stem}", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.upgrade()


def downgrade() -> None:
    _run("0035_crm_money.py")  # parties ... interactions, and branches.reminder_policy
    _run("0041_crm_hub.py")  # crm_objects ... crm_access
    op.drop_constraint("ck_desk_items_kind", "desk_items", type_="check")
    op.create_check_constraint("ck_desk_items_kind", "desk_items", f"kind IN ({OLD_KINDS})")
