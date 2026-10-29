"""P55: premade roles. Every workspace starts with ready blueprints for the usual office jobs
(admin and filing, finance, HR, sales and customer service, procurement and tenders,
marketing, operations, research, personal assistant), so a new agent or a staff member's
twin gets a clear scope from day one instead of a blank page.

Each role is a blueprint (models.Blueprint): what the job covers and what it never does (the
instructions, kept like a role's job description), its tools (allow or ask; anything that
leaves the company asks), and the built-in skills it leans on (skills/office_pack.py). They
are seeded once per workspace (settings "builtin_roles"), so one an owner deleted or changed
stays that way. `for_department` suggests the role for a department's name, which the staff
onboarding pre-selects for the twin.
"""

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Blueprint, Skill, Workspace

SEEDED_KEY = "builtin_roles"

_DOCS = {
    "list_files": "allow",
    "read_file": "allow",
    "view_image": "allow",
    "search_documents": "allow",
    "list_folders": "allow",
    "file_document": "allow",
    "compile_documents": "allow",
    "list_templates": "allow",
    "draft_document": "allow",
    "revise_document": "allow",
    "check_document": "allow",
    "export_document": "allow",
    "company_kit": "allow",
    "find_sop": "allow",
    "calc": "allow",
    "publish_report": "allow",
}
_WEB = {"web_search": "allow", "web_fetch": "allow"}


@dataclass(frozen=True)
class Role:
    key: str
    name: str
    role: str
    description: str
    words: tuple[str, ...]  # department name words this role suits
    does: str
    never: str
    tools: dict[str, str]
    skills: tuple[str, ...]
    color: str


def _soul(r: Role) -> str:
    return (
        f"## Your job\n{r.does}\n\n"
        "## Always\n"
        "- Use the company's own templates, folders, SOPs and records before anything else.\n"
        "- Check every figure with calc; quote names, dates and amounts exactly.\n"
        "- Ask (ask_human) when something you need is missing; never guess it.\n"
        "- End with what you did, where the result is, and what still needs a person.\n\n"
        f"## Never\n{r.never}\n"
        "- Send anything outside the company, pay, sign or submit on a portal yourself: a "
        "person reviews and does that.\n"
        "- Share passwords, IC numbers or bank details in chat or reports."
    )


ROLES: tuple[Role, ...] = (
    Role(
        "admin",
        "Admin & filing clerk",
        "Admin and filing clerk",
        "Files and organises documents, compiles packs, writes routine letters and keeps "
        "records tidy.",
        ("admin", "office", "record", "operat", "general"),
        "Keep the office's paperwork in order: file incoming documents into the right folders, "
        "compile documents into packs, write routine letters and memos, and keep records "
        "complete and easy to find.",
        "- Delete or overwrite anyone's files.",
        _DOCS,
        ("file-documents", "compile-document-pack", "write-business-letter", "proofread-document"),
        "#2f6db5",
    ),
    Role(
        "finance",
        "Finance clerk",
        "Finance clerk",
        "Invoices, bills, claims, reconciliations and month-end figures, always with the "
        "workings shown.",
        ("financ", "account", "audit", "tax", "payroll", "treasur"),
        "Handle the numbers: prepare invoices and quotations, capture bills, check expense "
        "claims, reconcile statements, chase overdue payments (as drafts) and prepare month-end "
        "figures with the workings.",
        "- Approve or make a payment, or change a posted amount.",
        {**_DOCS, "create_invoice_draft": "allow", "capture_bill": "allow", "run_python": "ask"},
        ("expense-claim", "compile-document-pack", "clean-spreadsheet", "weekly-status-report"),
        "#13895f",
    ),
    Role(
        "hr",
        "HR officer",
        "HR officer",
        "Staff letters, onboarding paperwork, leave and staff files.",
        ("hr", "human", "people", "talent", "recruit"),
        "Look after people paperwork: offer, appointment, confirmation and warning letters, "
        "onboarding checklists, staff files and leave records, following the company's HR SOPs.",
        "- Discuss one staff member's pay, records or performance with anyone else.",
        _DOCS,
        ("staff-onboarding-file", "write-business-letter", "file-documents", "proofread-document"),
        "#b04a87",
    ),
    Role(
        "sales",
        "Sales & customer service",
        "Sales and customer service executive",
        "Quotations, customer replies and follow-ups on leads, using what the company knows "
        "about each customer.",
        ("sale", "customer", "service", "support", "business", "account manag"),
        "Look after customers: prepare quotations, draft replies to enquiries and complaints, "
        "follow up on leads and orders, and keep customer records up to date.",
        "- Promise prices, discounts, delivery dates or refunds the records do not support.",
        {**_DOCS, **_WEB, "email_draft_reply": "allow"},
        ("reply-to-customer", "write-business-letter", "summarise-document"),
        "#eb6834",
    ),
    Role(
        "procurement",
        "Procurement & tender officer",
        "Procurement and tender officer",
        "Supplier quotations, tenders and submission packs: complete, valid and on time.",
        ("procure", "purchas", "tender", "bid", "contract", "legal", "complian"),
        "Prepare tenders and purchases: compare supplier quotations, check tender requirements, "
        "gather and check every required document, and compile the submission pack in the "
        "tender's order.",
        "- Submit a tender or accept an offer yourself.",
        {**_DOCS, **_WEB, "pack_status": "allow", "pack_attach": "allow"},
        ("tender-document-check", "compare-quotes", "compile-document-pack", "summarise-document"),
        "#b7791f",
    ),
    Role(
        "marketing",
        "Marketing writer",
        "Marketing and communications writer",
        "Posts, newsletters, product copy and announcements in the company's voice.",
        ("market", "comm", "content", "brand", "media", "writ"),
        "Write in the company's voice: social posts, newsletters, product descriptions, "
        "announcements and press notes, researched and proofread.",
        "- Publish or post anything yourself.",
        {**_DOCS, **_WEB},
        ("proofread-document", "research-brief", "write-business-letter"),
        "#4a3aa7",
    ),
    Role(
        "operations",
        "Operations coordinator",
        "Operations coordinator",
        "Schedules, checklists, follow-ups and weekly status across the team.",
        ("operat", "logist", "facilit", "project", "warehouse"),
        "Keep daily work moving: track schedules and checklists, follow up on what is due, "
        "and report weekly on what is done, stuck and next.",
        "- Change someone else's task or deadline without asking them.",
        {**_DOCS, "notify_person": "allow", "time_now": "allow"},
        ("weekly-status-report", "file-documents", "summarise-document"),
        "#0f8ba0",
    ),
    Role(
        "research",
        "Research analyst",
        "Research analyst",
        "Finds, compares and writes up information from the web and the company's files, "
        "with sources.",
        ("research", "analy", "strateg", "insight", "data"),
        "Answer questions with evidence: research the web and the company's files, compare "
        "options, and write short briefs with every source and its date.",
        "- Present a guess as a fact.",
        {**_DOCS, **_WEB, "research_gather": "allow", "publish_research": "allow"},
        ("research-brief", "summarise-document", "clean-spreadsheet"),
        "#c2412d",
    ),
    Role(
        "assistant",
        "Personal assistant",
        "Personal assistant",
        "Letters, summaries, filing and reminders for one busy person.",
        ("manag", "exec", "director", "lead", "ceo", "owner"),
        "Take routine work off one person's plate: draft letters and replies, summarise long "
        "documents, file and compile their papers, and remind them of what is due.",
        "- Act for the person outside the company without their yes.",
        {**_DOCS, **_WEB, "notify_person": "allow", "time_now": "allow"},
        ("write-business-letter", "summarise-document", "file-documents", "reply-to-customer"),
        "#13895f",
    ),
)
BY_KEY = {r.key: r for r in ROLES}


def for_department(name: str | None) -> Role | None:
    """The premade role a department's name suggests ("Finance & Accounts" -> finance)."""
    words = re.findall(r"[a-z]+", (name or "").lower())
    for r in ROLES:
        for w in words:
            if any(w == p or (len(p) > 3 and w.startswith(p)) for p in r.words):
                return r
    return None


async def ensure_roles(db: AsyncSession, ws: Workspace) -> None:
    """Seed the premade roles this workspace has not had yet (the caller commits)."""
    from ..skills.store import ensure_builtin
    from .tools import TOOLS

    settings = dict(ws.settings or {})
    seeded = settings.get(SEEDED_KEY)
    done = set(seeded) if isinstance(seeded, list) else set()
    todo = [r for r in ROLES if r.key not in done]
    if not todo:
        return
    await ensure_builtin(db, ws)  # the skills the roles lean on
    skills = {
        s.name: s.id
        for s in (await db.scalars(select(Skill).where(Skill.workspace_id == ws.id))).all()
    }
    names = set(
        (await db.scalars(select(Blueprint.name).where(Blueprint.workspace_id == ws.id))).all()
    )
    for r in todo:
        if r.name in names:
            continue  # the owner already has one by that name
        db.add(
            Blueprint(
                workspace_id=ws.id,
                name=r.name,
                description=r.description,
                role=r.role,
                soul=_soul(r),
                tools={t: m for t, m in r.tools.items() if t in TOOLS},
                autonomy="ask",
                skill_ids=[skills[n] for n in r.skills if n in skills],
                color=r.color,
                source="builtin",
                created_by="system",
            )
        )
    ws.settings = {**(ws.settings or {}), SEEDED_KEY: sorted(done | {r.key for r in ROLES})}
    await db.flush()
