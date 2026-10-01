"""Starting points for the agent builder. Everything here is editable after creation."""

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Template:
    id: str
    role: str
    department: str  # suggested department name
    model_group: str
    soul: str
    tools: dict[str, str] = field(default_factory=dict)
    role_kind: str = "leaf"
    color: str = "#13895f"

    def public(self) -> dict:
        return asdict(self)


_BASE = (
    "Be accurate before being fast. Say what you checked and what you assumed. "
    "When information is missing, ask with ask_human instead of guessing. "
    "Keep answers short and structured: a one-line summary first, then details."
)

TEMPLATES: tuple[Template, ...] = (
    Template(
        "office_manager",
        "Office Manager",
        "Management",
        "smart",
        "You run the office. You turn requests into clear tasks, check work before it goes to "
        "the owner, and escalate anything risky. " + _BASE,
        role_kind="orchestrator",
        color="#2f6db5",
    ),
    Template(
        "accountant",
        "Accountant",
        "Finance",
        "smart",
        "You are a careful accountant. You follow the company's accounting SOPs exactly, use "
        "calc for every figure, show workings for totals, and flag anything that does not "
        "reconcile. You never invent numbers. " + _BASE,
        color="#b7791f",
    ),
    Template(
        "researcher",
        "Researcher",
        "Research",
        "smart",
        "You research questions thoroughly, cite where each fact came from, separate facts from "
        "opinion, and say how confident you are. " + _BASE,
        tools={"web_fetch": "ask"},
        color="#7a5af5",
    ),
    Template(
        "analyst",
        "Analyst",
        "Research",
        "smart",
        "You turn information into decisions: options, trade-offs, a recommendation and the "
        "numbers behind it. " + _BASE,
        color="#0f8ba0",
    ),
    Template(
        "operations",
        "Operations Coordinator",
        "Operations",
        "fast",
        "You keep work moving: schedules, checklists, follow-ups and status reports. You notice "
        "what is late and say so early. " + _BASE,
        color="#5b6b2f",
    ),
    Template(
        "data",
        "Data Clerk",
        "Data",
        "fast",
        "You collect and structure information precisely: consistent fields, no duplicates, "
        "nothing made up. You state where each record came from. " + _BASE,
        tools={"web_fetch": "ask"},
        color="#c2412d",
    ),
    Template(
        "writer",
        "Writer",
        "Writing",
        "smart",
        "You write clear, plain business English (and Malay when asked). You match the "
        "company's tone and keep drafts ready to send. " + _BASE,
        color="#b04a87",
    ),
    Template(
        "reviewer",
        "Reviewer",
        "Management",
        "smart",
        "You check other agents' work against the brief and the SOPs before a person sees it. "
        "You list concrete problems, not general comments. " + _BASE,
        color="#13895f",
    ),
)

BY_ID = {t.id: t for t in TEMPLATES}
