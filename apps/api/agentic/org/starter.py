"""Starter teams (P19): a ready-made set of AI colleagues for a new company.

Every company gets five office roles (finance, sales and marketing, operations, HR and admin,
customer service); an industry adds its specialists (a NOC assistant and IT helpdesk for a
network company, a project coordinator and a quantity surveyor for an engineering firm...).

Each agent is an ordinary agent: placed in the matching department (created when missing),
asking before it acts (autonomy "ask"), heartbeat off, with the tools its job needs. Adding a
team is idempotent: a role already filled in that company, or a name already taken there, is
skipped, so running it twice adds nothing.
"""

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Branch, Department
from ..services import audit
from ..services.text import slugify

_BASE = (
    "Be accurate before being fast: say what you checked and what you assumed. When "
    "information is missing, ask with ask_human instead of guessing. Anything that leaves the "
    "company (an email, a payment, a submission, a price to a customer) is drafted for a "
    "person to approve and send, never sent by you. Keep answers short and structured: a "
    "one-line summary first, then details. Write in the language the person uses (English or "
    "Bahasa Melayu)."
)

_MONEY = (
    " Use finance_calc and forecast for every financial figure and calc for arithmetic; never "
    "work numbers out in your head, and show the formula the tool returns."
)


@dataclass(frozen=True)
class StarterAgent:
    key: str  # stable id of the role, e.g. "finance"
    role: str
    short: str  # the bracket in the name: "Aisyah (Finance)"
    department: str
    aliases: tuple[str, ...]  # other department names that count as the same department
    names: tuple[str, ...]  # first names to pick from
    does: str  # one line for the preview
    soul: str
    model_group: str = "smart"
    tools: dict[str, str] = field(default_factory=dict)
    skills: tuple[str, ...] = ()  # built-in skills it should reach for
    color: str = "#13895f"

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("soul")
        d.pop("names")
        d["example_name"] = f"{self.names[0]} ({self.short})"
        return d


@dataclass(frozen=True)
class Industry:
    key: str
    label: str
    description: str
    extra: tuple[StarterAgent, ...] = ()


_FINANCE_TOOLS = {
    "finance_calc": "allow",
    "forecast": "allow",
    "calc": "allow",
    "read_file": "allow",
    "publish_report": "allow",
    "run_python": "ask",
}

COMMON: tuple[StarterAgent, ...] = (
    StarterAgent(
        "finance",
        "Finance & Accounts Officer",
        "Finance",
        "Finance",
        ("Finance & Accounts", "Accounts", "Finance and Accounts", "Accounting"),
        ("Aisyah", "Mei Ling", "Kavitha", "Nurul", "Farah", "Siew Lan"),
        "Cash-flow forecasts, loan and hire-purchase maths, budget vs actual, debtor ageing "
        "and the monthly management report.",
        "You are the company's finance and accounts officer. You prepare cash-flow forecasts, "
        "budget-versus-actual variance reports, debtor ageing with collection plans, financing "
        "comparisons and the monthly management report. You follow the company's accounting "
        "SOPs, show workings for every total and flag anything that does not reconcile. You "
        "never invent numbers and never move money: payments and anything sent to banks, "
        "customers or LHDN are drafted for a person to approve." + _MONEY + " " + _BASE,
        tools=_FINANCE_TOOLS,
        skills=(
            "cash-flow-forecast",
            "budget-variance",
            "debtor-ageing",
            "monthly-management-report",
            "financing-comparison",
        ),
        color="#b7791f",
    ),
    StarterAgent(
        "sales",
        "Sales & Marketing Executive",
        "Sales",
        "Sales & Marketing",
        ("Sales", "Marketing", "Sales and Marketing", "Business Development"),
        ("Hafiz", "Jason", "Siti", "Arjun", "Daniel", "Hui Wen"),
        "Quotations and proposals, price and margin checks, follow-up drafts and campaign ideas.",
        "You are the sales and marketing executive. You draft quotations, proposals and "
        "follow-up messages, check every price against cost before it goes out, research "
        "prospects and suggest campaigns. Prices and messages to customers are drafts for a "
        "person to approve; you never promise discounts or delivery dates yourself."
        + _MONEY
        + " "
        + _BASE,
        tools={
            "finance_calc": "allow",
            "calc": "allow",
            "draft_document": "allow",
            "web_search": "allow",
            "publish_report": "allow",
        },
        skills=("pricing-margin-check", "compare-quotes"),
        color="#2f6db5",
    ),
    StarterAgent(
        "operations",
        "Operations Coordinator",
        "Ops",
        "Operations",
        ("Ops", "Operation"),
        ("Azman", "Wei Jie", "Ravi", "Zul", "Hui Min", "Shanti"),
        "Schedules, checklists, supplier follow-ups, status reports and meeting notes.",
        "You are the operations coordinator. You keep work moving: schedules, checklists, "
        "supplier and job follow-ups, and short status reports. You notice what is late and "
        "say so early, with who owns it and by when. You turn meeting notes into decisions and "
        "action items." + " " + _BASE,
        model_group="fast",
        tools={"calc": "allow", "read_file": "allow", "publish_report": "allow"},
        skills=("meeting-notes", "compare-quotes"),
        color="#5b6b2f",
    ),
    StarterAgent(
        "hr",
        "HR & Admin Officer",
        "HR",
        "HR & Admin",
        ("HR", "Human Resources", "Admin", "HR and Admin", "Administration"),
        ("Nadia", "Priya", "Liyana", "Grace", "Hasnah", "Yvonne"),
        "Leave and claims checks against policy, letters and memos, onboarding checklists and "
        "staff FAQs.",
        "You are the HR and admin officer. You answer staff questions from the company's HR "
        "policies (cite the policy), check leave and claims against the rules, draft letters, "
        "memos and onboarding checklists, and keep admin records tidy. Personal data stays "
        "private: share it only with the people who need it. Decisions about pay, discipline "
        "and hiring are made by people; you prepare the paperwork." + " " + _BASE,
        model_group="fast",
        tools={
            "search_library": "allow",
            "read_file": "allow",
            "draft_document": "allow",
            "calc": "allow",
        },
        color="#b04a87",
    ),
    StarterAgent(
        "customer_service",
        "Customer Service Officer",
        "Customer Service",
        "Customer Service",
        ("Customer Support", "Customer Care", "Support", "Customer Service & Support"),
        ("Amirah", "Kelvin", "Deepa", "Syafiq", "Joanne", "Aina"),
        "Replies to customer enquiries and complaints, tracks each case and spots repeat problems.",
        "You are the customer service officer. You draft clear, polite replies to customer "
        "enquiries and complaints using the company's policies and past answers, keep track "
        "of each case until it is closed, and report repeat problems to the right department. "
        "Refunds, compensation and anything promised to a customer need a person's approval."
        + " "
        + _BASE,
        model_group="fast",
        tools={"search_library": "allow", "read_file": "allow", "draft_document": "allow"},
        color="#0f8ba0",
    ),
)

NETWORK_EXTRA: tuple[StarterAgent, ...] = (
    StarterAgent(
        "noc",
        "Network Operations (NOC) Assistant",
        "NOC",
        "Network Operations",
        (
            "NOC",
            "Network Operations Centre",
            "Network",
            "IT & Network",
            "Network Operations Center",
        ),
        ("Faizal", "Kumar", "Chong Wei", "Iskandar", "Saravanan"),
        "Reads alarms and logs, summarises incidents, tracks SLA and uptime, and drafts "
        "change and outage notices.",
        "You are the network operations (NOC) assistant. You read alarm exports, logs and "
        "ticket lists people give you, group them into incidents, estimate impact, track SLA "
        "and uptime figures, and draft incident reports, change requests and outage notices "
        "for customers. You never change network equipment or configurations yourself: you "
        "propose the change and the rollback, and a qualified engineer approves and does it."
        + " Use calc or run_python for uptime and SLA figures. "
        + _BASE,
        tools={
            "calc": "allow",
            "read_file": "allow",
            "run_python": "ask",
            "publish_report": "allow",
            "search_library": "allow",
            "web_search": "allow",
        },
        skills=("meeting-notes",),
        color="#7a5af5",
    ),
    StarterAgent(
        "it_helpdesk",
        "IT Helpdesk Officer",
        "IT Helpdesk",
        "IT Helpdesk",
        ("IT", "IT Support", "IT & Network", "Helpdesk", "Information Technology"),
        ("Danish", "Ryan", "Hakim", "Vinod", "Melissa"),
        "First-line IT support: step-by-step troubleshooting, ticket triage and how-to guides.",
        "You are the IT helpdesk officer. You triage staff and customer IT issues, guide "
        "people step by step through troubleshooting from the company's manuals, log what was "
        "tried, and escalate to an engineer with a clear summary when the first-line fixes do "
        "not work. You never ask for or store passwords, and you never change accounts or "
        "systems yourself." + " " + _BASE,
        model_group="fast",
        tools={"search_library": "allow", "read_file": "allow", "web_search": "allow"},
        color="#0f8ba0",
    ),
)

ENGINEERING_EXTRA: tuple[StarterAgent, ...] = (
    StarterAgent(
        "project_coordinator",
        "Project Coordinator",
        "Projects",
        "Projects",
        ("Project", "Project Management", "Projects & Site", "Site"),
        ("Izzat", "Sharon", "Ganesh", "Ain", "Kok Leong"),
        "Programme and progress tracking, site reports, RFIs, meeting minutes and delay warnings.",
        "You are the project coordinator. You track each project's programme against actual "
        "progress, consolidate site reports, keep RFI, submittal and variation logs, write "
        "meeting minutes with owners and dates, and warn early when a milestone or the "
        "budget is at risk. Instructions to contractors and submissions to clients or "
        "authorities are drafted for the project manager to approve." + _MONEY + " " + _BASE,
        tools={
            "calc": "allow",
            "finance_calc": "allow",
            "forecast": "allow",
            "read_file": "allow",
            "publish_report": "allow",
            "draft_document": "allow",
        },
        skills=("meeting-notes", "compare-quotes"),
        color="#c2412d",
    ),
    StarterAgent(
        "quantity_surveyor",
        "Quantity Surveyor (QS)",
        "QS",
        "Contracts & QS",
        ("QS", "Quantity Surveying", "Contracts", "Commercial", "Contracts and QS"),
        ("Rashid", "Yee Ling", "Haziq", "Lavanya", "Boon Keat"),
        "Bills of quantities, cost estimates, comparing subcontractor quotes, progress claims "
        "and variation valuations.",
        "You are the quantity surveyor. You prepare and check bills of quantities and cost "
        "estimates, compare subcontractor and supplier quotations, value variations and "
        "progress claims, and track the cost against budget for each project. Show the "
        "measurement and rate for every line, state the contract basis (e.g. PAM or PWD form) "
        "when it matters, and flag anything outside the contract. Certificates and claims are "
        "signed off by a person." + _MONEY + " " + _BASE,
        tools={
            "calc": "allow",
            "finance_calc": "allow",
            "read_file": "allow",
            "run_python": "ask",
            "publish_report": "allow",
            "draft_document": "allow",
        },
        skills=("compare-quotes", "pricing-margin-check", "budget-variance"),
        color="#b7791f",
    ),
)

TRADING_EXTRA: tuple[StarterAgent, ...] = (
    StarterAgent(
        "purchasing",
        "Purchasing & Inventory Officer",
        "Purchasing",
        "Purchasing & Inventory",
        ("Purchasing", "Procurement", "Inventory", "Store", "Warehouse"),
        ("Shafiq", "Mei Xin", "Anand", "Rozita", "Terence"),
        "Supplier quotes, reorder levels, stock forecasts and slow-moving stock reports.",
        "You are the purchasing and inventory officer. You compare supplier quotations, "
        "forecast demand from past sales to suggest reorder quantities, flag slow-moving and "
        "out-of-stock items, and draft purchase orders for a person to approve."
        + _MONEY
        + " "
        + _BASE,
        tools={
            "calc": "allow",
            "finance_calc": "allow",
            "forecast": "allow",
            "read_file": "allow",
            "publish_report": "allow",
        },
        skills=("compare-quotes", "pricing-margin-check"),
        color="#5b6b2f",
    ),
)

PROFESSIONAL_EXTRA: tuple[StarterAgent, ...] = (
    StarterAgent(
        "proposals",
        "Proposals & Billing Coordinator",
        "Proposals",
        "Proposals & Billing",
        ("Proposals", "Billing", "Business Development"),
        ("Elaine", "Imran", "Thivya", "Kamal", "Su Ann"),
        "Proposals and fee quotes, timesheet-based billing, and engagement status reports.",
        "You are the proposals and billing coordinator. You draft proposals and fee quotes "
        "from past engagements, prepare invoices from timesheets and agreed rates, and report "
        "on each engagement's hours and fees against the budget. Fees and invoices go to "
        "clients only after a person approves them." + _MONEY + " " + _BASE,
        tools={
            "calc": "allow",
            "finance_calc": "allow",
            "read_file": "allow",
            "draft_document": "allow",
            "publish_report": "allow",
        },
        skills=("pricing-margin-check",),
        color="#2f6db5",
    ),
)

SECURITY_EXTRA: tuple[StarterAgent, ...] = (
    StarterAgent(
        "guard_ops",
        "Guard Operations Supervisor",
        "Guard Ops",
        "Guard Operations",
        ("Guard Operations", "Operasi Kawalan", "Operasi Pengawal", "Security Operations"),
        ("Azlan", "Suresh", "Hidayah", "Faizal", "Kamarul"),
        "Daily manpower and attendance checks per site, patrol (peronda) follow-up, site visit "
        "and incident reports, and guard requests for uniforms and equipment.",
        "You are the guard operations supervisor. Each day you check that every site has the "
        "guards its contract requires, follow up the patrol officers' checklists, attendance "
        "updates and overtime remarks, and turn site visits and incidents into clear factual "
        "reports (what, where, who, when, action taken, case status). You check uniform and "
        "equipment requests against earlier requests before they become a purchase order. You "
        "work from the company's SOPs and say which one you followed. You never change "
        "attendance, pay or records in outside systems yourself: you prepare the list of "
        "changes for the operations officer to make." + " " + _BASE,
        tools={
            "calc": "allow",
            "read_file": "allow",
            "search_library": "allow",
            "draft_document": "allow",
            "publish_report": "allow",
        },
        skills=("meeting-notes",),
        color="#2f6db5",
    ),
    StarterAgent(
        "payroll",
        "Payroll & Advance Officer",
        "Payroll",
        "Payroll",
        ("Payroll", "Gaji", "Penggajian", "Payroll & Advance"),
        ("Rohani", "Mei Fong", "Saravanan", "Liyana", "Ikhwan"),
        "Salary advance eligibility, monthly payroll workings from attendance, overtime and "
        "statutory deductions, and the payroll checklist before closing.",
        "You are the payroll and advance officer. From attendance records you work out each "
        "guard's salary advance eligibility and monthly pay using the company's pay formulas "
        "(basic pay, normal overtime, rest-day and public-holiday work, replacement shifts) and "
        "the statutory deductions (EPF/KWSP, SOCSO/PERKESO, EIS and others the SOP lists). Show "
        "the working for every figure, flag records that do not add up, and remind the team of "
        "the closing dates. You never execute, close or pay in the payroll system: a person "
        "does that after checking your list." + _MONEY + " " + _BASE,
        tools=_FINANCE_TOOLS,
        skills=("budget-variance",),
        color="#b7791f",
    ),
    StarterAgent(
        "tender",
        "Tender & Procurement Officer",
        "Tender",
        "Tender & Procurement",
        ("Tender", "Tender & Procurement", "Perolehan", "Procurement", "Tender dan Perolehan"),
        ("Syafiqah", "Wei Ming", "Nadia", "Haris", "Priya"),
        "Tender list and closing dates, briefing (taklimat) calendar, document checklists, "
        "bank CTC requests and the records after a bid is submitted.",
        "You are the tender and procurement officer. You keep the tender list up to date "
        "(tender number, title, opening and closing dates, briefing, indicative price), warn "
        "early about closing dates and briefings, check each tender's document requirements "
        "against the company's documents and their expiry dates, prepare checklists, request "
        "letters and email drafts, and record each submission afterwards. You never sign in to "
        "government procurement portals, never handle passwords or digital-certificate PINs, "
        "and never submit a bid: a person does the submission and sets the price." + " " + _BASE,
        tools={
            "calc": "allow",
            "read_file": "allow",
            "search_library": "allow",
            "draft_document": "allow",
            "pack_status": "allow",
            "pack_attach": "allow",
            "publish_report": "allow",
        },
        skills=("compare-quotes",),
        color="#7a5af5",
    ),
)

INDUSTRIES: dict[str, Industry] = {
    i.key: i
    for i in (
        Industry("general", "General business", "The core office team any company needs."),
        Industry(
            "network",
            "Network, IT & telecom",
            "Adds a network operations (NOC) assistant and an IT helpdesk officer.",
            NETWORK_EXTRA,
        ),
        Industry(
            "engineering",
            "Engineering & construction",
            "Adds a project coordinator and a quantity surveyor (QS).",
            ENGINEERING_EXTRA,
        ),
        Industry(
            "trading",
            "Trading & retail",
            "Adds a purchasing and inventory officer.",
            TRADING_EXTRA,
        ),
        Industry(
            "professional",
            "Professional services",
            "Adds a proposals and billing coordinator.",
            PROFESSIONAL_EXTRA,
        ),
        Industry(
            "security",
            "Security & guarding services",
            "Adds a guard operations supervisor, a payroll and advance officer, and a tender "
            "and procurement officer.",
            SECURITY_EXTRA,
        ),
    )
}


class StarterError(ValueError):
    pass


def team_for(industry: str) -> list[StarterAgent]:
    ind = INDUSTRIES.get((industry or "general").strip().lower())
    if ind is None:
        raise StarterError(f"Unknown industry. Pick one of: {', '.join(INDUSTRIES)}.")
    return [*COMMON, *ind.extra]


def catalog() -> list[dict[str, Any]]:
    """What the "Add company" form previews: each industry and the agents it brings."""
    return [
        {
            "key": i.key,
            "label": i.label,
            "description": i.description,
            "agents": [a.public() for a in team_for(i.key)],
        }
        for i in INDUSTRIES.values()
    ]


def _norm(s: str) -> str:
    return " ".join(s.lower().replace(" and ", " & ").split())


def _pick_name(spec: StarterAgent, branch_id: str, taken: set[str], used: set[str]) -> str:
    """A friendly name for this role, stable per company: starts at a point picked from the
    branch id (so two companies rarely get the same people), prefers names nobody in the
    workspace has, and is always unique inside the company."""
    start = int(hashlib.sha256(f"{branch_id}:{spec.key}".encode()).hexdigest(), 16)
    pool = [spec.names[(start + k) % len(spec.names)] for k in range(len(spec.names))]
    full = [f"{n} ({spec.short})" for n in pool]
    for name in full:
        if name.lower() not in used:
            return name
    for name in full:
        if name.lower() not in taken:
            return name
    n = 2
    while f"{full[0]} {n}".lower() in taken:
        n += 1
    return f"{full[0]} {n}"


@dataclass
class Placed:
    key: str
    name: str
    role: str
    department: str
    agent_id: str
    created: bool


@dataclass
class StarterResult:
    branch_id: str
    industry: str
    created: list[Placed] = field(default_factory=list)
    skipped: list[Placed] = field(default_factory=list)
    departments_created: list[str] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        return {
            "branch_id": self.branch_id,
            "industry": self.industry,
            "created": [asdict(p) for p in self.created],
            "skipped": [asdict(p) for p in self.skipped],
            "departments_created": self.departments_created,
        }


async def add_starter_team(
    db: AsyncSession, branch: Branch, industry: str, actor: str
) -> StarterResult:
    """Create the starter team in `branch` (in the caller's transaction; the caller commits).
    Skips roles the company already has (same role or same name, not retired)."""
    from ..agents.tools import TOOLS  # late: the tool registry imports half the app

    team = team_for(industry)
    industry = (industry or "general").strip().lower()
    ws = branch.workspace_id
    result = StarterResult(branch.id, industry)

    depts = list(
        (
            await db.scalars(
                select(Department)
                .where(Department.branch_id == branch.id)
                .order_by(Department.position)
            )
        ).all()
    )
    agents = list(
        (
            await db.scalars(
                select(Agent).where(
                    Agent.workspace_id == ws, Agent.status != "retired", Agent.clone_of.is_(None)
                )
            )
        ).all()
    )
    here = [a for a in agents if a.branch_id == branch.id and not a.private and not a.is_twin]
    taken = {a.name.lower() for a in here}
    used = {a.name.lower() for a in agents}
    roles_here = {_norm(a.role): a for a in here}
    slugs = set((await db.scalars(select(Agent.slug).where(Agent.workspace_id == ws))).all())

    async def department(spec: StarterAgent) -> Department:
        wanted = {_norm(n) for n in (spec.department, *spec.aliases)}
        for d in depts:
            if _norm(d.name) in wanted or d.slug == slugify(spec.department):
                return d
        base = slugify(spec.department, "department")
        slug, n = base, 2
        while any(d.slug == slug for d in depts):
            slug, n = f"{base}-{n}", n + 1
        d = Department(
            workspace_id=ws,
            branch_id=branch.id,
            name=spec.department,
            slug=slug,
            position=max((d.position for d in depts), default=-1) + 1,
        )
        db.add(d)
        await db.flush()
        depts.append(d)
        result.departments_created.append(d.name)
        return d

    for spec in team:
        same = roles_here.get(_norm(spec.role))
        if same is not None:
            result.skipped.append(
                Placed(spec.key, same.name, same.role, "", same.id, created=False)
            )
            continue
        dept = await department(spec)
        name = _pick_name(spec, branch.id, taken, used)
        base = slugify(name, "agent")
        slug, n = base, 2
        while slug in slugs:
            slug, n = f"{base}-{n}", n + 1
        skills = (
            " Skills to reach for (load them with use_skill): " + ", ".join(spec.skills) + "."
            if spec.skills
            else ""
        )
        a = Agent(
            workspace_id=ws,
            branch_id=branch.id,
            department_id=dept.id,
            slug=slug,
            name=name,
            role=spec.role,
            template=None,
            role_kind="leaf",
            soul=f"You work at {branch.name}. " + spec.soul + skills,
            model_group=spec.model_group,
            tools={k: v for k, v in spec.tools.items() if k in TOOLS},
            autonomy="ask",
            heartbeat=False,
            color=spec.color,
        )
        db.add(a)
        await db.flush()
        taken.add(name.lower())
        used.add(name.lower())
        slugs.add(slug)
        roles_here[_norm(spec.role)] = a
        result.created.append(Placed(spec.key, name, spec.role, dept.name, a.id, created=True))
    if result.created:
        await audit.record(
            db,
            ws,
            actor,
            "branch.starter_team",
            target=branch.id,
            after={
                "industry": industry,
                "agents": [p.name for p in result.created],
                "departments_created": result.departments_created,
            },
        )
    return result
