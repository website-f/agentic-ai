# ruff: noqa: E501
"""P50 ready-made CRMs for kinds of business, and starter dashboard tiles.

A template adds the office's own data the business needs (contacts, deals, invoices...) and
the custom objects it tracks (Properties and Viewings for an estate agency, Patients and
Appointments for a clinic...), each with its fields, a board view when it has a status, and a
few dashboard tiles. Everything stays editable: rename, add or remove fields after.
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import CrmField, CrmObject, CrmView, CrmWidget
from .engine import ensure_builtin
from .fields import clean_choices

F = tuple[str, str, str, dict[str, Any]]


def ch(*labels: str) -> dict[str, Any]:
    return {"choices": clean_choices(list(labels))}


def rel(key: str) -> dict[str, Any]:
    return {"object": key}


MONEY = {"currency": "RM"}

# key, name, singular, icon, color, title field, fields
Obj = tuple[str, str, str, str, str, str, list[F]]

OBJECTS: dict[str, Obj] = {
    "projects": (
        "projects",
        "Projects",
        "Project",
        "kanban",
        "#7c5cc4",
        "name",
        [
            ("name", "Project", "text", {}),
            ("client", "Client", "relation", rel("contacts")),
            ("status", "Status", "select", ch("Brief", "In progress", "Review", "Done", "On hold")),
            ("budget", "Budget", "money", MONEY),
            ("start", "Start", "date", {}),
            ("due", "Due", "date", {}),
            ("owner", "Owner", "person", {}),
            ("progress", "Progress", "percent", {}),
            ("notes", "Notes", "long_text", {}),
        ],
    ),
    "retainers": (
        "retainers",
        "Retainers",
        "Retainer",
        "repeat",
        "#0e7490",
        "client_name",
        [
            ("client_name", "Client", "text", {}),
            ("client", "Contact", "relation", rel("contacts")),
            ("monthly_fee", "Monthly fee", "money", MONEY),
            ("start", "Started", "date", {}),
            ("renewal", "Renews on", "date", {}),
            ("status", "Status", "select", ch("Active", "Renewing", "Paused", "Ended")),
        ],
    ),
    "properties": (
        "properties",
        "Properties",
        "Property",
        "house",
        "#b7791f",
        "address",
        [
            ("address", "Address", "text", {}),
            (
                "type",
                "Type",
                "select",
                ch("Condo", "Terrace", "Semi-D", "Bungalow", "Land", "Shop lot", "Office"),
            ),
            ("price", "Price", "money", MONEY),
            ("status", "Status", "select", ch("Available", "Reserved", "Sold", "Rented")),
            ("bedrooms", "Bedrooms", "number", {}),
            ("size_sqft", "Size (sq ft)", "number", {}),
            ("owner_contact", "Owner", "relation", rel("contacts")),
            ("agent", "Agent", "person", {}),
            ("listed", "Listed on", "date", {}),
        ],
    ),
    "viewings": (
        "viewings",
        "Viewings",
        "Viewing",
        "calendar-check",
        "#2f6db5",
        "title",
        [
            ("title", "Viewing", "text", {}),
            ("property", "Property", "relation", rel("properties")),
            ("client", "Client", "relation", rel("contacts")),
            ("when", "When", "datetime", {}),
            (
                "outcome",
                "Outcome",
                "select",
                ch("Booked", "Viewed", "Interested", "Offer made", "Not interested", "No show"),
            ),
        ],
    ),
    "patients": (
        "patients",
        "Patients",
        "Patient",
        "first-aid",
        "#c2412d",
        "name",
        [
            ("name", "Name", "text", {}),
            ("ic", "IC / passport", "text", {}),
            ("phone", "Phone", "phone", {}),
            ("email", "Email", "email", {}),
            ("birth_date", "Date of birth", "date", {}),
            ("panel", "Panel / insurer", "text", {}),
            ("notes", "Notes", "long_text", {}),
        ],
    ),
    "appointments": (
        "appointments",
        "Appointments",
        "Appointment",
        "calendar-dots",
        "#2f6db5",
        "title",
        [
            ("title", "Appointment", "text", {}),
            ("patient", "Patient", "relation", rel("patients")),
            ("when", "When", "datetime", {}),
            ("doctor", "Doctor", "person", {}),
            ("reason", "Reason", "text", {}),
            ("status", "Status", "select", ch("Booked", "Arrived", "Done", "No show", "Cancelled")),
        ],
    ),
    "students": (
        "students",
        "Students",
        "Student",
        "student",
        "#7c5cc4",
        "name",
        [
            ("name", "Name", "text", {}),
            ("phone", "Phone", "phone", {}),
            ("parent", "Parent / guardian", "text", {}),
            ("parent_phone", "Parent's phone", "phone", {}),
            ("class", "Class", "relation", rel("classes")),
            ("status", "Status", "select", ch("Enquiry", "Trial", "Enrolled", "Paused", "Left")),
            ("joined", "Joined", "date", {}),
        ],
    ),
    "classes": (
        "classes",
        "Classes",
        "Class",
        "chalkboard-teacher",
        "#0e7490",
        "name",
        [
            ("name", "Class", "text", {}),
            ("teacher", "Teacher", "person", {}),
            ("day", "Day", "multi_select", ch("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")),
            ("time", "Time", "text", {}),
            ("fee", "Monthly fee", "money", MONEY),
            ("seats", "Seats", "number", {}),
        ],
    ),
    "sites": (
        "sites",
        "Sites",
        "Site",
        "hard-hat",
        "#b7791f",
        "name",
        [
            ("name", "Project / site", "text", {}),
            ("client", "Client", "relation", rel("contacts")),
            ("address", "Site address", "text", {}),
            ("contract_value", "Contract value", "money", MONEY),
            ("progress", "Progress", "percent", {}),
            (
                "status",
                "Status",
                "select",
                ch("Tender", "Awarded", "In progress", "Defects period", "Closed"),
            ),
            ("start", "Start", "date", {}),
            ("finish", "Finish", "date", {}),
        ],
    ),
    "variations": (
        "variations",
        "Variation orders",
        "Variation order",
        "files",
        "#c2412d",
        "title",
        [
            ("title", "Variation", "text", {}),
            ("site", "Site", "relation", rel("sites")),
            ("amount", "Amount", "money", MONEY),
            ("status", "Status", "select", ch("Submitted", "Approved", "Rejected", "Paid")),
            ("submitted", "Submitted", "date", {}),
        ],
    ),
    "products": (
        "products",
        "Products",
        "Product",
        "package",
        "#13895f",
        "name",
        [
            ("name", "Product", "text", {}),
            ("sku", "SKU", "text", {}),
            ("price", "Price", "money", MONEY),
            ("stock", "In stock", "number", {}),
            ("reorder_at", "Reorder at", "number", {}),
            ("category", "Category", "select", ch("General")),
            ("active", "On sale", "checkbox", {}),
        ],
    ),
    "orders": (
        "orders",
        "Orders",
        "Order",
        "shopping-cart",
        "#2f6db5",
        "number",
        [
            ("number", "Order", "auto", {}),
            ("customer", "Customer", "relation", rel("contacts")),
            ("total", "Total", "money", MONEY),
            (
                "status",
                "Status",
                "select",
                ch("New", "Paid", "Packed", "Shipped", "Delivered", "Returned", "Cancelled"),
            ),
            ("ordered", "Ordered", "date", {}),
            (
                "channel",
                "Channel",
                "select",
                ch("Shop", "Website", "Shopee", "Lazada", "TikTok", "WhatsApp"),
            ),
        ],
    ),
    "candidates": (
        "candidates",
        "Candidates",
        "Candidate",
        "identification-card",
        "#7c5cc4",
        "name",
        [
            ("name", "Name", "text", {}),
            ("email", "Email", "email", {}),
            ("phone", "Phone", "phone", {}),
            ("job", "Job", "relation", rel("jobs")),
            (
                "stage",
                "Stage",
                "select",
                ch("Applied", "Screened", "Interview", "Offer", "Hired", "Rejected"),
            ),
            ("rating", "Rating", "rating", {"max": 5}),
            ("cv", "CV", "file", {}),
            ("applied", "Applied", "date", {}),
        ],
    ),
    "jobs": (
        "jobs",
        "Jobs",
        "Job",
        "briefcase",
        "#0e7490",
        "title",
        [
            ("title", "Job", "text", {}),
            ("client", "Client", "relation", rel("contacts")),
            ("openings", "Openings", "number", {}),
            ("salary", "Salary", "money", MONEY),
            ("status", "Status", "select", ch("Open", "On hold", "Filled", "Closed")),
        ],
    ),
    "shipments": (
        "shipments",
        "Shipments",
        "Shipment",
        "truck",
        "#b7791f",
        "tracking",
        [
            ("tracking", "Tracking no.", "text", {}),
            ("customer", "Customer", "relation", rel("contacts")),
            ("origin", "From", "text", {}),
            ("destination", "To", "text", {}),
            (
                "status",
                "Status",
                "select",
                ch("Booked", "Picked up", "In transit", "Delivered", "Failed"),
            ),
            ("eta", "Arrives", "date", {}),
            ("weight_kg", "Weight (kg)", "number", {}),
        ],
    ),
    "events": (
        "events",
        "Events",
        "Event",
        "confetti",
        "#c2412d",
        "name",
        [
            ("name", "Event", "text", {}),
            ("date", "Date", "date", {}),
            ("venue", "Venue", "text", {}),
            ("budget", "Budget", "money", MONEY),
            ("status", "Status", "select", ch("Planning", "Confirmed", "Done", "Cancelled")),
        ],
    ),
    "attendees": (
        "attendees",
        "Attendees",
        "Attendee",
        "users-three",
        "#2f6db5",
        "name",
        [
            ("name", "Name", "text", {}),
            ("email", "Email", "email", {}),
            ("event", "Event", "relation", rel("events")),
            ("ticket", "Ticket", "select", ch("Free", "Standard", "VIP")),
            ("checked_in", "Checked in", "checkbox", {}),
        ],
    ),
    "tickets": (
        "tickets",
        "Support tickets",
        "Ticket",
        "lifebuoy",
        "#c2412d",
        "subject",
        [
            ("subject", "Subject", "text", {}),
            ("customer", "Customer", "relation", rel("contacts")),
            ("priority", "Priority", "select", ch("Low", "Normal", "High", "Urgent")),
            ("status", "Status", "select", ch("Open", "Waiting on customer", "Solved")),
            ("opened", "Opened", "datetime", {}),
            ("owner", "Owner", "person", {}),
        ],
    ),
}

TEMPLATES: dict[str, dict[str, Any]] = {
    "general": {"name": "Any business", "description": "Customers, deals, money and support tickets.", "icon": "storefront",
                "builtins": ["contacts", "deals", "invoices", "bills", "tasks"], "objects": ["tickets"]},
    "agency": {"name": "Agency or consultancy", "description": "Clients, projects, retainers and the sales pipeline.", "icon": "megaphone",
               "builtins": ["contacts", "deals", "invoices", "tasks"], "objects": ["projects", "retainers"]},
    "real_estate": {"name": "Real estate", "description": "Properties, viewings, owners and buyers.", "icon": "house",
                    "builtins": ["contacts", "deals", "invoices"], "objects": ["properties", "viewings"]},
    "clinic": {"name": "Clinic or health", "description": "Patients and appointments.", "icon": "first-aid",
               "builtins": ["contacts", "invoices", "bills"], "objects": ["patients", "appointments"]},
    "education": {"name": "School, tuition or training", "description": "Students, classes and fees.", "icon": "student",
                  "builtins": ["contacts", "invoices"], "objects": ["classes", "students"]},
    "construction": {"name": "Construction or contractor", "description": "Sites, contract values, progress and variation orders.", "icon": "hard-hat",
                     "builtins": ["contacts", "deals", "invoices", "bills"], "objects": ["sites", "variations"]},
    "retail": {"name": "Shop or online store", "description": "Products, stock and orders.", "icon": "shopping-cart",
               "builtins": ["contacts", "invoices", "bills"], "objects": ["products", "orders"]},
    "recruitment": {"name": "Recruitment or HR agency", "description": "Jobs and candidates through each stage.", "icon": "identification-card",
                    "builtins": ["contacts", "deals", "invoices"], "objects": ["jobs", "candidates"]},
    "logistics": {"name": "Logistics or delivery", "description": "Shipments from booking to delivery.", "icon": "truck",
                  "builtins": ["contacts", "invoices", "bills"], "objects": ["shipments"]},
    "events": {"name": "Events", "description": "Events, attendees and budgets.", "icon": "confetti",
               "builtins": ["contacts", "invoices", "bills"], "objects": ["events", "attendees"]},
}  # fmt: skip


def status_field(fields: list[F]) -> str | None:
    for key, _label, ftype, _opts in fields:
        if ftype == "select" and key in ("status", "stage", "outcome"):
            return key
    return None


async def add_object(db: AsyncSession, workspace_id: str, spec: Obj, actor: str) -> CrmObject:
    key, name, singular, icon, color, title, fields = spec
    obj = await db.scalar(
        select(CrmObject).where(CrmObject.workspace_id == workspace_id, CrmObject.key == key)
    )
    if obj is not None:
        obj.archived = False
        return obj
    last = await db.scalar(
        select(func.max(CrmObject.position)).where(CrmObject.workspace_id == workspace_id)
    )
    obj = CrmObject(workspace_id=workspace_id, key=key, name=name, singular=singular, icon=icon, color=color,
                    kind="custom", title_field=title, position=(last or 0) + 1, meta={}, created_by=actor)  # fmt: skip
    db.add(obj)
    await db.flush()
    for i, (fkey, label, ftype, options) in enumerate(fields):
        db.add(CrmField(workspace_id=workspace_id, object_id=obj.id, key=fkey, label=label, type=ftype,
                        options=options, position=i, required=fkey == title, created_by=actor))  # fmt: skip
    db.add(
        CrmView(
            workspace_id=workspace_id,
            object_id=obj.id,
            name="All",
            kind="table",
            config={},
            position=0,
            created_by=actor,
        )
    )
    if (sf := status_field(fields)) is not None:
        db.add(CrmView(workspace_id=workspace_id, object_id=obj.id, name="Board", kind="board",
                       config={"group_by": sf}, position=1, created_by=actor))  # fmt: skip
    await db.flush()
    return obj


async def default_views(
    db: AsyncSession, obj: CrmObject, fields: list[CrmField], actor: str
) -> None:
    """An "All" table, and a board when the object has a status-like choice."""
    if await db.scalar(
        select(func.count()).select_from(CrmView).where(CrmView.object_id == obj.id)
    ):
        return
    db.add(
        CrmView(
            workspace_id=obj.workspace_id,
            object_id=obj.id,
            name="All",
            kind="table",
            config={},
            position=0,
            created_by=actor,
        )
    )
    for f in fields:
        if f.type == "select" and f.key in ("status", "stage", "outcome", "category"):
            db.add(CrmView(workspace_id=obj.workspace_id, object_id=obj.id, name="Board", kind="board",
                           config={"group_by": f.key}, position=1, created_by=actor))  # fmt: skip
            break
    await db.flush()


SUGGESTED_TILES: dict[str, list[dict[str, Any]]] = {
    "invoices": [
        {"title": "Owed to you", "kind": "number", "config": {"metric": "sum", "field": "balance",
                                                              "filters": [{"field": "status", "op": "any_of", "value": ["approved", "sent", "partially_paid"]}]}},
        {"title": "Overdue invoices", "kind": "number", "config": {"metric": "count", "filters": [{"field": "days_overdue", "op": "gt", "value": 0}]}},
    ],
    "bills": [{"title": "You owe suppliers", "kind": "number", "config": {"metric": "sum", "field": "balance",
                                                                          "filters": [{"field": "status", "op": "any_of", "value": ["awaiting_approval", "approved", "partially_paid"]}]}}],
    "deals": [
        {"title": "Deals by stage", "kind": "bar", "size": "md", "config": {"metric": "sum", "field": "value", "group_by": "stage"}},
        {"title": "Open pipeline", "kind": "number", "config": {"metric": "sum", "field": "value",
                                                                "filters": [{"field": "stage", "op": "any_of", "value": ["lead", "qualified", "proposal", "negotiation"]}]}},
    ],
    "contacts": [{"title": "New contacts per month", "kind": "line", "size": "md", "config": {"metric": "count", "date_field": "created", "period": "month"}}],
    "tasks": [{"title": "Tasks done this week", "kind": "number", "config": {"metric": "count", "filters": [
        {"field": "status", "op": "is", "value": "done"}, {"field": "finished", "op": "this_week"}]}}],
    "mail": [{"title": "Mail waiting for a person", "kind": "number", "config": {"metric": "count", "filters": [{"field": "needs_person", "op": "is", "value": "true"}]}}],
}  # fmt: skip


async def add_tiles(
    db: AsyncSession, obj: CrmObject, actor: str, fields: list[CrmField] | None = None
) -> int:
    """Starter tiles for an object (its suggested ones; for a custom object: how many, and by
    status). Skips tiles already there."""
    tiles = list(SUGGESTED_TILES.get(obj.source or "", []))
    if obj.kind != "builtin" and fields is not None:
        tiles.append({"title": f"{obj.name}", "kind": "number", "config": {"metric": "count"}})
        sf = next(
            (
                f.key
                for f in fields
                if f.type == "select" and f.key in ("status", "stage", "outcome")
            ),
            None,
        )
        if sf:
            tiles.append(
                {
                    "title": f"{obj.name} by {sf}",
                    "kind": "pie",
                    "size": "md",
                    "config": {"metric": "count", "group_by": sf},
                }
            )
        money = next((f for f in fields if f.type == "money"), None)
        if money:
            tiles.append(
                {
                    "title": f"Total {money.label.lower()}",
                    "kind": "number",
                    "config": {"metric": "sum", "field": money.key},
                }
            )
    have = {
        (w.title, (w.config or {}).get("object"))
        for w in (
            await db.scalars(select(CrmWidget).where(CrmWidget.workspace_id == obj.workspace_id))
        ).all()
    }
    last = await db.scalar(
        select(func.max(CrmWidget.position)).where(CrmWidget.workspace_id == obj.workspace_id)
    )
    n = 0
    for t in tiles:
        if (t["title"], obj.key) in have:
            continue
        n += 1
        db.add(CrmWidget(workspace_id=obj.workspace_id, title=t["title"], kind=t["kind"], size=t.get("size", "sm"),
                         config={**t["config"], "object": obj.key}, position=(last or 0) + n, created_by=actor))  # fmt: skip
    await db.flush()
    return n


async def apply_template(
    db: AsyncSession, workspace_id: str, key: str, actor: str
) -> list[CrmObject]:
    tpl = TEMPLATES.get(key)
    if tpl is None:
        raise KeyError(key)
    made: list[CrmObject] = []
    for source in tpl["builtins"]:
        obj = await ensure_builtin(db, workspace_id, source, actor)
        from .engine import fields_of

        await default_views(db, obj, await fields_of(db, obj), actor)
        await add_tiles(db, obj, actor)
        made.append(obj)
    for okey in tpl["objects"]:
        obj = await add_object(db, workspace_id, OBJECTS[okey], actor)
        from .engine import fields_of

        await add_tiles(db, obj, actor, await fields_of(db, obj))
        made.append(obj)
    return made


__all__ = ["OBJECTS", "TEMPLATES", "add_object", "add_tiles", "apply_template", "default_views"]
