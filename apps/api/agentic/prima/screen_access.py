"""P128: what a person really gets in Prima, from what Members > Access sets.

Fitri (24 Nov 2026): "when we custom its access to prima module then when refresh, at their
sidebar it doesn't even show what has been given access to, just basic ... whatever is set like
roles, permissions, permissions on module, it doesn't reflect correctly."

Why: Prima opens a screen by the person's Prima role, department and job (its menu in App.tsx
and the same checks on its server). The Prima modules picked in the office only narrowed that.
A supervisor (central staff, no department) with Finance screens picked therefore kept the
plain staff menu: Prima had nothing that opened Finance for them.

Now:
- Prima's own menu rule is run (screen_access_build.cjs, on App.tsx as it is) for every
  account the office can make (screen_access.json): central staff (pwvsb_officer) or a
  company's admin executive (admin_exec), in each office department, and for Prima's own jobs.
- explain(): the Prima role, department and screens a person will really get, and for each
  picked screen Prima does not open for them, what it needs: a department (one office setting
  away), the company-office role (a branch manager in the office), a Prima job (made only in
  Prima, Accounts and access, never from the office), or group leadership.
- suggest(): the department that would open most of the picked screens, for Members > Access to
  offer. It is never given silently: in Prima a department is a job (everyone in Transport heads
  transport payment requests, Procurement decides stock, HR and Finance open pay and personal
  data), so ticking a screen never makes anyone an approver or opens a data wall by itself. The
  person who manages members picks the department by name, with its warning, and it reaches
  the person's own Prima account on their next reload (client.link_for).
"""

import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from . import modules

OFFICER = "pwvsb_officer"
ADMIN_EXEC = "admin_exec"
# P125: the departments that open staff personal data, payroll or money (client.py has the
# same list; Prima's office-accounts.ts CENTRAL_ONLY_DEPARTMENTS).
CENTRAL_ONLY = ("hr", "finance", "chief_of_staff", "audit", "legal")
# Office departments in the order a tie goes (the first: fewest powers of its own).
ORDER = (
    "transport",
    "procurement",
    "operations",
    "asset",
    "pdpa",
    "it",
    "fwm",
    "cms",
    "legal",
    "chief_of_staff",
    "audit",
    "finance",
    "hr",
)
# Screens with a company's own records (sites, guards, rosters...): central staff see a company
# there only once Prima gives them access to it (Prima's Accounts and access, a dated grant).
COMPANY_SCREENS = frozenset(
    {
        "ops",
        "sites",
        "roster",
        "guardroster",
        "duty",
        "cleaning",
        "people",
        "attendance",
        "cases",
        "surveys",
        "sitehours",
        "cmsready",
        "socso",
        "hostels",
        "compliance",
        "selfaudit",
        "commercial",
        "clients",
        "contracts",
        "branchwork",
    }
)


@cache
def table() -> dict[str, object]:
    return json.loads(Path(__file__).with_name("screen_access.json").read_text(encoding="utf-8"))


def _profile(role: str, department: str | None, record: bool = True) -> dict[str, list[str]]:
    key = f"{role}|{department or ''}|{'record' if record else 'none'}"
    profiles: dict[str, dict[str, list[str]]] = table()["profiles"]  # type: ignore[assignment]
    return profiles.get(key) or {"views": [], "walls": []}


def views(role: str, department: str | None, record: bool = True) -> frozenset[str]:
    """The screens Prima's menu gives an office account of this role and department."""
    return frozenset(_profile(role, department, record)["views"])


def walls(role: str, department: str | None) -> frozenset[str]:
    """The data walls Prima's database opens to it (core access.ts dataWalls)."""
    return frozenset(_profile(role, department)["walls"])


def allowed(role: str, department: str) -> bool:
    """Whether an office account of this role may be in this department at all (Prima's
    office-accounts.ts: the central-only ones are for central staff)."""
    return department in ORDER and (role == OFFICER or department not in CENTRAL_ONLY)


def department(role: str, setting: str | None) -> str | None:
    """The department their own Prima account gets: the one chosen (Members > Access), when
    an account of this role may be in it (a branch manager is never in a central-only one)."""
    return setting if setting and allowed(role, setting) else None


def opens_wall(role: str, dept: str) -> bool:
    """Whether this department opens a data wall the role has not without one."""
    return not walls(role, dept) <= walls(role, None)


@dataclass
class Suggestion:
    department: str
    # The picked screens it would open that the current department does not.
    adds: list[str]
    # Central-only, or opens a data wall (pay, staff personal data, firearms...): say so.
    sensitive: bool


def suggest(
    role: str, current: str | None, chosen: list[str] | None, record: bool = True
) -> Suggestion | None:
    """The department that opens most of the picked screens, when it opens more of them than
    the current one (ties: the earlier in ORDER, the fewer powers)."""
    if not chosen:
        return None
    want = set(chosen)
    now = want & views(role, current, record)
    best, most = None, len(now)
    for d in ORDER:
        if allowed(role, d):
            n = len(want & views(role, d, record))
            if n > most:
                best, most = d, n
    if best is None:
        return None
    adds = [v for v in modules.ids() if v in want & views(role, best, record) and v not in now]
    return Suggestion(best, adds, best in CENTRAL_ONLY or opens_wall(role, best))


@dataclass
class Need:
    """A picked screen Prima will not open for them, and what would open it."""

    screen: str
    # "department": one of `departments`; "branch_manager": a company's office role (office
    # role Branch manager); "central_staff": central staff, not a branch manager; "job": a
    # Prima job (`jobs`, made only in Prima); "leadership": group leadership only; "none".
    kind: str
    departments: list[str] = field(default_factory=list)
    jobs: list[dict[str, str]] = field(default_factory=list)


@dataclass
class Effective:
    role: str
    department: str | None
    # "chosen" (in `department`), "none", or "refused" (Prima refused the chosen one: their own
    # staff record makes them a company's office staff).
    how: str
    # The screens they will have (the menu's order), and the picked ones that need more.
    screens: list[str]
    needs: list[Need]
    # Screens they have that show a company's records only once Prima gives them that company.
    company_access: list[str]
    suggestion: Suggestion | None = None


def _jobs_for(screen: str) -> list[dict[str, str]]:
    jobs: dict[str, dict[str, object]] = table()["jobs"]  # type: ignore[assignment]
    return [j["label"] for j in jobs.values() if screen in j["views"]]  # type: ignore[misc]


def need(screen: str, role: str, record: bool = True) -> Need:
    """What would open this screen for an office account of this role."""
    depts = [d for d in ORDER if allowed(role, d) and screen in views(role, d, record)]
    if depts:
        return Need(screen, "department", departments=depts)
    other = ADMIN_EXEC if role == OFFICER else OFFICER
    if any(screen in views(other, d, record) for d in (None, *ORDER) if not d or allowed(other, d)):
        return Need(screen, "branch_manager" if other == ADMIN_EXEC else "central_staff")
    jobs = _jobs_for(screen)
    if jobs:
        return Need(screen, "job", jobs=jobs)
    if screen in table()["leaders"]:  # type: ignore[operator]
        return Need(screen, "leadership")
    return Need(screen, "none")


def explain(
    role: str,
    setting: str | None,
    chosen: list[str] | None,
    *,
    refused: str | None = None,
    record: bool = True,
) -> Effective:
    """What an office account (own Prima account) of this Prima role gets, with this department
    chosen and these modules picked (None: all their role allows). `refused`: the department
    Prima refused on their account (prima_links.department_refused), so they have none."""
    dept = department(role, setting)
    how = "chosen" if dept else "none"
    if refused and refused == dept:
        dept, how = None, "refused"
    have = views(role, dept, record)
    keep = None if chosen is None else set(chosen) | set(modules.ALWAYS)
    order = modules.ids()
    screens = [v for v in order if v in have and (keep is None or v in keep)]
    needs = [need(v, role, record) for v in order if chosen and v in chosen and v not in have]
    company = [v for v in screens if role == OFFICER and v in COMPANY_SCREENS]
    tip = None if how == "refused" else suggest(role, dept, chosen, record)
    return Effective(role, dept, how, screens, needs, company, tip)


def leaders(chosen: list[str] | None) -> list[str]:
    """The screens of Prima's top record (owners and admins open Prima as it), narrowed by the
    modules picked for an admin."""
    have = set(table()["leaders"])  # type: ignore[arg-type]
    keep = None if chosen is None else set(chosen) | set(modules.ALWAYS)
    return [v for v in modules.ids() if v in have and (keep is None or v in keep)]


# ---------------------------------------------------------------- drift (tests)

_BLOCKS = (
    ("const NAV: ", "\n];"),
    ("const LINE: ", "\n  };"),
    ("const roleNav = NAV.filter(", "\n  )\n"),
)


def source(app_tsx: str) -> str:
    """The fingerprint screen_access_build.cjs gives Prima's menu rule (App.tsx)."""
    import hashlib

    app = app_tsx.replace("\r\n", "\n")
    parts = []
    for start, end in _BLOCKS:
        i = app.index(start)
        j = app.index(end, i)
        parts.append(app[i : j + len(end)])
    return hashlib.sha256("\n\0\n".join(parts).encode("utf-8")).hexdigest()
