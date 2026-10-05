"""AI twins (P18): each staff member's one agent, their virtual self at work.

Rules
- Who has one: people whose role has `agents.own` (staff). Without `agents.manage` it is the
  only agent they can create, through the twin wizard (POST /api/me/twin) or, the first time,
  POST /api/agents (which then makes it their twin). A second one is refused with 409. If they
  already own an agent from before twins existed, they adopt it as their twin
  (POST /api/me/twin/adopt) instead of adding another.
- Where it sits: in its person's branch and department (their membership), as a leaf that
  reports to no agent. Saving the persona again moves it with its person.
- Who changes what:
  * the person owns who it is: name, job title, persona (soul), colour, languages, hours,
    heartbeat, what it helps with and what it asks first;
  * managers with `agents.manage` over it govern it: pause/retire, budgets, model group, SOPs,
    tool modes, autonomy. They cannot rewrite its name, role, persona or colour (a twin speaks
    for its person) and nobody moves it away from its person;
  * colleagues in the branch only watch it (P16 view-only), like any other agent.
  When the person saves the wizard again, a tool mode someone else made stricter stays strict.
- Retiring a twin frees the place: the next twin replaces it (the old row stops being a twin).
- It starts safe: autonomy "ask", browser / code / outside tools off unless the person chose
  work that needs them, and sending forms, running code and outside tools always ask.
"""

import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import core as core_memory
from ..brain.store import Author, save_page
from ..core import threats
from ..models import SOP, Agent, BrainPage, Branch, Department, Membership, User, Workspace
from .tools import TOOLS

# ---------------------------------------------------------------- wizard options


@dataclass(frozen=True)
class Help:
    key: str
    label: str
    hint: str
    tools: dict[str, str]


@dataclass(frozen=True)
class Ask:
    key: str
    label: str
    hint: str
    tools: tuple[str, ...]
    locked: bool = False


_BROWSER = {
    "browser_open": "allow",
    "browser_click": "allow",
    "browser_type": "allow",
    "browser_fill": "allow",
    "browser_select": "allow",
    "browser_check": "allow",
    "browser_scroll": "allow",
    "browser_back": "allow",
    "browser_read": "allow",
    "browser_snapshot": "allow",
    "browser_find": "allow",
    "browser_wait": "allow",
    "browser_login": "allow",
    "browser_submit": "ask",
    "browser_close": "allow",
    "web_fetch": "allow",
}

HELPS: tuple[Help, ...] = (
    Help(
        "documents",
        "Letters and documents",
        "Drafts quotations, letters and replies from the company's templates.",
        {
            "list_templates": "allow",
            "draft_document": "allow",
            "revise_document": "allow",
            "check_document": "allow",
            "company_kit": "allow",
        },
    ),
    Help(
        "reports",
        "Summaries and reports",
        "Turns finished work into short reports with tables you can download.",
        {"publish_report": "allow", "calc": "allow"},
    ),
    Help(
        "files",
        "Finding things in files",
        "Looks through the company's files and SOPs for what you need.",
        {"list_files": "allow", "read_file": "allow", "view_image": "allow", "find_sop": "allow"},
    ),
    Help(
        "research",
        "Looking things up online",
        "Searches the web and reads pages, and says where each fact came from.",
        {"web_search": "allow", "web_fetch": "allow"},
    ),
    Help(
        "followups",
        "Reminders and follow-ups",
        "Keeps track of what is due and nudges you on your phone.",
        {"notify_person": "allow", "time_now": "allow"},
    ),
    Help(
        "numbers",
        "Checking figures",
        "Adds up, reconciles and double-checks numbers, showing the workings.",
        {"calc": "allow", "run_python": "ask"},
    ),
    Help(
        "forms",
        "Filling in online forms",
        "Works in a web browser with your saved logins. Sending a form always needs you.",
        _BROWSER,
    ),
    Help(
        "packs",
        "Submission packs",
        "Matches the checklist of a tender or application to real files.",
        {"pack_status": "allow", "pack_attach": "allow"},
    ),
)
HELP_BY_KEY = {h.key: h for h in HELPS}

ASKS: tuple[Ask, ...] = (
    Ask(
        "web",
        "Opening web pages",
        "Before it reads any website.",
        ("web_fetch", "research_gather", "browser_open"),
    ),
    Ask(
        "documents",
        "Drafting or changing documents",
        "Before it starts or edits a document.",
        ("draft_document", "revise_document"),
    ),
    Ask(
        "wiki",
        "Writing to the shared wiki",
        "Before it adds or changes a page the whole office reads.",
        ("write_page",),
    ),
    Ask(
        "colleagues",
        "Asking colleagues or calling meetings",
        "Before it pulls other agents into your work.",
        ("ask_colleague", "consult", "delegate"),
    ),
    Ask(
        "logins",
        "Signing in to websites",
        "Before it uses one of your saved logins.",
        ("browser_login",),
    ),
    Ask(
        "submit",
        "Sending forms",
        "A form is only sent when you say so.",
        ("browser_submit",),
        locked=True,
    ),
    Ask("code", "Running code", "You see the code first.", ("run_python",), locked=True),
    Ask(
        "external",
        "Using connected outside tools",
        "Every call to an outside system needs you.",
        ("tool_call",),
        locked=True,
    ),
)
ASK_BY_KEY = {a.key: a for a in ASKS}
LOCKED_ASKS = tuple(a.key for a in ASKS if a.locked)

# Off for a twin unless the person picked work that needs them.
GATED = (*_BROWSER, "run_python", "tool_call", "split_work")

TONES: dict[str, tuple[str, str]] = {
    "friendly": ("Warm and friendly", "warm, friendly and encouraging, but still to the point"),
    "professional": ("Professional", "polite, professional and precise"),
    "brief": ("Short and direct", "short and direct: the answer first, no small talk"),
    "detailed": ("Thorough", "thorough: explain the reasoning and the steps behind each answer"),
}

LANGUAGES = ("English", "Malay", "Chinese", "Tamil", "Arabic", "Indonesian")
HOURS = (
    "Weekdays, 9am to 6pm",
    "Weekdays, 8am to 5pm",
    "Every day, 9am to 9pm",
    "Only when I ask",
)
COLORS = (
    "#13895f",
    "#2f6db5",
    "#4a3aa7",
    "#0f8ba0",
    "#b7791f",
    "#eb6834",
    "#b04a87",
    "#c2412d",
)

# Department name words -> what a twin there usually does and helps with.
_DEPTS: tuple[tuple[tuple[str, ...], str, tuple[str, ...]], ...] = (
    (
        ("financ", "account", "audit", "tax", "payroll", "treasur"),
        "I handle invoices, payments, reconciliations and the month-end figures.",
        ("numbers", "reports", "files", "documents"),
    ),
    (
        ("tender", "bid", "legal", "contract", "complian", "procure"),
        "I prepare tenders and submissions and keep the paperwork complete and on time.",
        ("documents", "packs", "files", "followups"),
    ),
    (
        ("research", "analy", "strateg", "insight"),
        "I research questions, compare options and write up what I find.",
        ("research", "reports", "files"),
    ),
    (
        ("operat", "admin", "logist", "facilit", "office"),
        "I keep daily work moving: schedules, checklists, follow-ups and status updates.",
        ("followups", "forms", "reports", "files"),
    ),
    (
        ("data", "record", "entry", "it", "tech", "system", "software"),
        "I collect and tidy records and systems so the data is complete and consistent.",
        ("files", "forms", "numbers"),
    ),
    (
        ("writ", "market", "comm", "content", "brand", "media"),
        "I write and polish copy, letters and posts in the company's voice.",
        ("documents", "research"),
    ),
    (
        ("sale", "business", "customer", "service", "support"),
        "I look after customers: quotations, replies and following up on leads.",
        ("documents", "followups", "research"),
    ),
    (
        ("hr", "human", "people", "talent", "recruit"),
        "I look after people matters: letters, leave, onboarding and records.",
        ("documents", "files", "followups"),
    ),
    (
        ("manag", "exec", "director", "lead"),
        "I keep track of the team's work and report on how things are going.",
        ("reports", "followups", "files"),
    ),
)
_DEFAULT_HELPS = ("documents", "reports", "files", "followups")
_DEFAULT_JOB = "I handle the day-to-day work of my role and keep things moving."
DEFAULT_ASK_FIRST = ("web", "wiki", "colleagues", "logins")

PROFILE_FILE = "TWIN.md"
_JSON_BLOCK = re.compile(r"```json\n(.*?)\n```", re.S)


def first_name(name: str) -> str:
    return (name or "").strip().split(" ")[0] or "You"


def initials(name: str) -> str:
    parts = [p for p in (name or "").replace("#", "").split() if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


def default_name(person: str) -> str:
    return f"{first_name(person)}'s twin"


def _dept_match(dept: str | None) -> tuple[str, tuple[str, ...]]:
    words = re.findall(r"[a-z]+", (dept or "").lower())

    def hit(w: str, p: str) -> bool:  # short keys ("hr", "it") must match a whole word
        return w == p or (len(p) > 3 and w.startswith(p))

    for prefixes, job, helps in _DEPTS:
        if any(hit(w, p) for w in words for p in prefixes):
            return job, helps
    return _DEFAULT_JOB, _DEFAULT_HELPS


def tools_for(helps: list[str], ask_first: list[str]) -> dict[str, str]:
    """Tool modes from the wizard answers. Unlisted tools keep their default mode."""
    tools: dict[str, str] = {name: "deny" for name in GATED}
    tools["notify_person"] = "allow"  # it reports to its person
    for key in helps:
        if key in HELP_BY_KEY:
            tools.update(HELP_BY_KEY[key].tools)
    for key in dict.fromkeys([*ask_first, *LOCKED_ASKS]):
        for name in ASK_BY_KEY[key].tools if key in ASK_BY_KEY else ():
            if tools.get(name, TOOLS[name].default_mode if name in TOOLS else "deny") != "deny":
                tools[name] = "ask"
    return {k: v for k, v in tools.items() if k in TOOLS}


_RANK = {"allow": 0, "ask": 1, "deny": 2}


def keep_stricter(
    new: dict[str, str], current: dict[str, str], last: dict[str, str]
) -> dict[str, str]:
    """Re-saving the wizard: where someone else (a manager) set a tool stricter than what the
    wizard last produced, that stricter mode stays."""
    out = dict(new)
    for name, mode in (current or {}).items():
        if name not in TOOLS or last.get(name) == mode:
            continue
        mine = out.get(name, TOOLS[name].default_mode)
        if _RANK.get(mode, 0) > _RANK.get(mine, 0):
            out[name] = mode
    return out


# ---------------------------------------------------------------- the person


@dataclass
class Home:
    user: User
    role: str
    branch: Branch | None
    department: Department | None

    @property
    def where(self) -> str:
        if self.branch and self.department:
            return f"{self.department.name}, {self.branch.name}"
        return self.branch.name if self.branch else "the company"

    def where_for(self, role: str | None) -> str:
        """Where, without repeating the department when the job title already says it
        ("Finance staff in Qbot Sdn Bhd", not "...in Finance, Qbot Sdn Bhd")."""
        if self.department and self.department.name.lower() in (role or "").lower():
            return self.branch.name if self.branch else "the company"
        return self.where


async def home_of(db: AsyncSession, workspace_id: str, user: User) -> Home:
    """Where the person's twin sits: their membership's branch and department (falling back
    to the first branch when the membership names none)."""
    m = await db.get(Membership, (workspace_id, user.id))
    branch = await db.get(Branch, m.branch_id) if m and m.branch_id else None
    dept = await db.get(Department, m.department_id) if m and m.department_id else None
    if dept is not None and branch is None:
        branch = await db.get(Branch, dept.branch_id)
    if dept is not None and branch is not None and dept.branch_id != branch.id:
        dept = None
    if branch is None:
        branch = await db.scalar(
            select(Branch).where(Branch.workspace_id == workspace_id).order_by(Branch.created_at)
        )
    return Home(user=user, role=m.role if m else "staff", branch=branch, department=dept)


def suggestions(home: Home) -> dict[str, Any]:
    dept = home.department.name if home.department else None
    job, helps = _dept_match(dept)
    return {
        "name": default_name(home.user.name),
        "role": f"{dept} staff" if dept else "Staff",
        "job": job,
        "style": "",
        "tone": "friendly",
        "languages": ["English"],
        "helps_with": list(helps),
        "ask_first": list(DEFAULT_ASK_FIRST),
        "hours": HOURS[0],
        "heartbeat": False,
        "color": COLORS[sum(map(ord, home.user.id)) % len(COLORS)],
    }


def options() -> dict[str, Any]:
    return {
        "helps_with": [{"key": h.key, "label": h.label, "hint": h.hint} for h in HELPS],
        "ask_first": [
            {"key": a.key, "label": a.label, "hint": a.hint, "locked": a.locked} for a in ASKS
        ],
        "tones": [{"key": k, "label": v[0], "hint": v[1]} for k, v in TONES.items()],
        "languages": list(LANGUAGES),
        "hours": list(HOURS),
        "colors": list(COLORS),
    }


async def auto_sops(db: AsyncSession, workspace_id: str, home: Home) -> list[dict[str, str]]:
    """SOPs the twin follows without attaching anything: workspace, branch and department."""
    scopes: list[tuple[str, str | None, str]] = [("workspace", None, "Every company")]
    if home.branch:
        scopes.append(("branch", home.branch.id, home.branch.name))
    if home.department:
        scopes.append(("department", home.department.id, home.department.name))
    out: list[dict[str, str]] = []
    for scope, scope_id, label in scopes:
        q = select(SOP).where(SOP.workspace_id == workspace_id, SOP.scope == scope)
        q = q.where(SOP.scope_id.is_(None) if scope_id is None else SOP.scope_id == scope_id)
        for s in (await db.scalars(q.order_by(SOP.title).limit(20))).all():
            out.append({"id": s.id, "title": s.title, "scope": scope, "scope_label": label})
    return out


# ---------------------------------------------------------------- the persona


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def intro(p: dict[str, Any], person: str, where: str) -> str:
    """Who the twin is: the part the optional AI polish may rewrite."""
    first = first_name(person)
    tone = TONES.get(p.get("tone") or "friendly", TONES["friendly"])[1]
    lines = [
        f"You are {p['name']}, the AI twin of {person}: {first}'s virtual self at work, "
        f"{p['role']} in {where}. You handle routine work the way {first} would, and you ask "
        f"{first} before anything important.",
    ]
    if (p.get("job") or "").strip():
        lines.append(f"What {first} does: {p['job'].strip()}")
    if (p.get("style") or "").strip():
        lines.append(f"How {first} works: {p['style'].strip()}")
    lines.append(f"Your tone is {tone}.")
    return "\n\n".join(lines)


def rules(p: dict[str, Any], person: str) -> str:
    """The fixed part: what it helps with, what it asks first, hours, how it reports."""
    first = first_name(person)
    langs = [x for x in p.get("languages") or [] if x] or ["English"]
    helps = [HELP_BY_KEY[k].label.lower() for k in p.get("helps_with") or [] if k in HELP_BY_KEY]
    chosen: list[str] = [str(k) for k in p.get("ask_first") or []]
    asks = [
        ASK_BY_KEY[k].label.lower()
        for k in dict.fromkeys([*chosen, *LOCKED_ASKS])
        if k in ASK_BY_KEY
    ]
    hours = (p.get("hours") or "").strip() or HOURS[0]
    lines = [
        f"Languages: {_join(langs)}. Answer in the language you are spoken to in.",
    ]
    if helps:
        lines.append(f"You help {first} with: {_join(helps)}.")
    lines.append(f"Always ask {first} first (ask_human) before: {_join(asks)}.")
    if hours == "Only when I ask":
        lines.append(f"You work when {first} or the office gives you something to do.")
    else:
        lines.append(
            f"{first}'s working hours: {hours}."
            + (" In those hours you pick up queued work by yourself." if p.get("heartbeat") else "")
        )
    lines += [
        f"Report to {first}: when you finish something that matters, or you are stuck, tell "
        f'them with notify_person (person: "me") in one short message.',
        f"You are not {first}. When you deal with other people or agents, say you are "
        f"{first}'s AI twin; never sign as {first} or promise anything in their name.",
        "Never invent facts, figures or names; say what you checked and what you assumed. When "
        "something is unclear, ask instead of guessing. Follow the company's SOPs.",
    ]
    return "\n".join(f"- {x}" for x in lines)


def soul(p: dict[str, Any], person: str, where: str, polished_intro: str | None = None) -> str:
    out = (
        (polished_intro or intro(p, person, where)).strip()
        + "\n\nHow you work:\n"
        + rules(p, person)
    )
    # P19: a blueprint applied to the twin adds its role playbook; the persona stays.
    bp = p.get("_blueprint")
    if isinstance(bp, dict) and str(bp.get("soul") or "").strip():
        out += f"\n\nYour role playbook ({bp.get('name') or 'blueprint'}):\n{bp['soul'].strip()}"
    return out


async def polish(db: AsyncSession, workspace_id: str, text: str) -> str | None:
    """Optional: the fast model rewrites the intro in natural words. None when no model is
    reachable or the answer looks wrong; the template is used then."""
    from ..engine import gateway

    try:
        r = await gateway.chat_first(
            db,
            workspace_id,
            ("fast",),
            [
                {
                    "role": "system",
                    "content": "Rewrite the persona below as one or two short, natural "
                    "paragraphs addressed to the agent ('You are...'). Keep every fact, the "
                    "names and the meaning; add nothing new; no headings, no lists, no quotes. "
                    "Reply with the paragraphs only.",
                },
                {"role": "user", "content": text},
            ],
            task="twin.polish",
            max_tokens=500,
            temperature=0.4,
        )
    except gateway.GatewayUnavailable:
        return None
    except Exception:  # noqa: BLE001 - polish is a nicety; the template always works
        return None
    out = (r.content or "").strip().strip('"').strip()
    if not (60 <= len(out) <= 1800) or threats.scan(out, "strict") or out.count("```"):
        return None
    return out


# ---------------------------------------------------------------- memory and profile


def profile_facts(p: dict[str, Any], home: Home) -> list[str]:
    """What the twin knows about its person (USER.md), from the answers and the membership."""
    u, first = home.user, first_name(home.user.name)
    role = p.get("role") or "staff"
    facts = [f"I am the AI twin of {u.name} ({u.email}), {role} in {home.where_for(role)}."]
    if (p.get("job") or "").strip():
        facts.append(f"{first}'s work: {p['job'].strip()[:300]}")
    if (p.get("style") or "").strip():
        facts.append(f"How {first} works: {p['style'].strip()[:300]}")
    tone = TONES.get(p.get("tone") or "friendly", TONES["friendly"])[0].lower()
    langs = _join([x for x in p.get("languages") or [] if x] or ["English"])
    facts.append(f"{first} likes answers {tone}, in {langs}.")
    facts.append(f"{first}'s hours: {(p.get('hours') or HOURS[0]).strip()}.")
    return [" ".join(f.split()) for f in facts]


async def seed_user_memory(
    db: AsyncSession,
    ws: Workspace,
    agent: Agent,
    new: list[str],
    old: list[str],
    author: Author,
) -> None:
    """Profile facts first, then whatever else the twin or its person added (kept), trimmed
    from the end if the file would overflow."""
    current = (await core_memory.read(db, agent))["user"]
    rest = [e for e in current if e not in old and e not in new]
    items = new + rest
    while items and core_memory.used(items) > core_memory.CAPS["user"]:
        items.pop()
    if items != current:
        await core_memory.write(db, ws, agent, "user", items, author)


def profile_path(agent: Agent) -> str:
    return f"agents/{agent.slug}/{PROFILE_FILE}"


async def read_profile(db: AsyncSession, agent: Agent) -> dict[str, Any] | None:
    body = await db.scalar(
        select(BrainPage.body).where(
            BrainPage.workspace_id == agent.workspace_id, BrainPage.path == profile_path(agent)
        )
    )
    m = _JSON_BLOCK.search(body or "")
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


async def write_profile(
    db: AsyncSession, ws: Workspace, agent: Agent, p: dict[str, Any], author: Author
) -> None:
    """The wizard's answers, kept next to the twin's core memory so the persona can be edited
    later (the vault shows them as a readable page)."""
    keep = {k: v for k, v in p.items() if k != "polish"}
    helps = [HELP_BY_KEY[k].label for k in p.get("helps_with") or [] if k in HELP_BY_KEY]
    body = (
        f"# {agent.name}: twin profile\n\n"
        "The answers its person gave in the twin wizard. Edit them from My twin, not here.\n\n"
        f"- Job: {p.get('job') or '-'}\n- Helps with: {', '.join(helps) or '-'}\n\n"
        f"```json\n{json.dumps(keep, ensure_ascii=False, indent=1)}\n```\n"
    )
    await save_page(db, ws, profile_path(agent), body, author, f"{agent.name}: twin profile")


# ---------------------------------------------------------------- lookups


async def twin_of(db: AsyncSession, workspace_id: str, user_id: str) -> Agent | None:
    """The person's live twin (a retired one no longer counts)."""
    return await db.scalar(
        select(Agent).where(
            Agent.workspace_id == workspace_id,
            Agent.owner_user_id == user_id,
            Agent.is_twin.is_(True),
            Agent.status != "retired",
        )
    )


async def adoptable(db: AsyncSession, workspace_id: str, user_id: str) -> list[Agent]:
    """Agents the person owned before twins: not assistants, not helpers, not retired."""
    return list(
        (
            await db.scalars(
                select(Agent)
                .where(
                    Agent.workspace_id == workspace_id,
                    Agent.owner_user_id == user_id,
                    Agent.is_twin.is_(False),
                    Agent.private.is_(False),
                    Agent.clone_of.is_(None),
                    Agent.status != "retired",
                )
                .order_by(Agent.created_at)
            )
        ).all()
    )


async def free_retired_place(db: AsyncSession, workspace_id: str, user_id: str) -> None:
    """A retired twin keeps its row but gives up the one-twin place (unique index)."""
    for a in (
        await db.scalars(
            select(Agent).where(
                Agent.workspace_id == workspace_id,
                Agent.owner_user_id == user_id,
                Agent.is_twin.is_(True),
                Agent.status == "retired",
            )
        )
    ).all():
        a.is_twin = False
    await db.flush()


async def seed_basic(db: AsyncSession, agent: Agent, user: User) -> None:
    """A twin made outside the wizard (POST /api/agents) still knows whose twin it is."""
    ws = await db.get(Workspace, agent.workspace_id)
    if ws is None:
        return
    home = await home_of(db, agent.workspace_id, user)
    facts = profile_facts({"role": agent.role}, home)[:1]
    await seed_user_memory(db, ws, agent, facts, [], Author(f"user:{user.id}", user.name))
