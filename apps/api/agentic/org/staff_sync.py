"""P145c: bring the office's members in line with the staff lists (the CSVs), with a plan first.

The owner (Fitri, 27 Nov 2026): "Update all the members according to the CSV files; where they
overlap, sync it all; where someone is missing, add them. The email used for login is their
personal email account; the shared mailbox/work email is used only inside the Microsoft 365 page.
Check their roles from the CSV and change them accordingly to match the PDF roles; anyone that
can't be identified goes to an unsorted list for manual sorting."

    python -m agentic.org.staff_sync plan  --file staff.json [--workspace <id|slug>] [--out p.json]
    python -m agentic.org.staff_sync apply --file staff.json [--workspace <id|slug>] [--mailboxes]

The input is prepared outside the repository from the matched staff lists (personal data never
lives here): {"company_domains": [...], "people": [...], "mailboxes": [...]}; see `Person` and
`MailboxIn` for the fields. `plan` reads the database and changes nothing; `apply` works the same
plan out again against the database as it is now and carries it out, so running it twice changes
nothing the second time.

What the plan does for each person the lists name (action "update": matched to a member):

a. login: their sign-in email becomes the personal email from the list, through the Members
   page's own correction (members.change_identity, no email sent, every session ended). Their
   connected work Microsoft account is KEPT as an extra account (still connected, mail kept, on
   the Microsoft 365 page) and only the link to their identity is cleared, so their next Microsoft
   sign-in links their own account as the main one; with no room for another extra account (P118,
   5) it is let go as before and they are listed. Skipped and
   listed when the personal email is already someone else's sign-in, and left for review when
   they are an owner, global admin, IT support or the developer, or already sign in with another
   personal email.
b. work email: memberships.work_email := the list's work email (a company or shared mailbox),
   else the company address they signed in with until now. Used on the Microsoft 365 page and by
   the Prima mirror to know the person (prima/mirror.py), never to sign in.
c. job title := JAWATAN, in title case ("Eksekutif Pentadbiran"; IT, HR, CMS... stay capitals).
d. position := the group structure position the rules below find (org/structure.py), else none:
   they show under Unsorted, with the reason. A position someone already holds is never replaced.
e. place: their company (and department) from the company map when they have none, when the list
   clearly puts them elsewhere (a match of 0.9 or better and none of their companies is the
   list's), or a department the list names in their own company; companies the list adds are
   added (never removed). Owners, global admins, IT support and the developer never move.
f. office role := the position's default role, only as a raise of a staff or supervisor to
   supervisor or head of department (hod, which needs a department), and for Head of Company to
   branch manager of their company (ROLE_ABOVE_HOD). Any other higher default role (group HOD,
   HR, management...) is listed for review, never given; nobody is lowered; the owner, global
   admin and IT support roles are never changed.

Action "add": a new member (staff, their company and department, the personal email to sign in,
then b-f), through members.add_one: pending (one-time password, never sent; they sign in with an
emailed code or Microsoft). Action "review": listed only.

Another office account of the same person (a company or shared mailbox login made earlier): never
merged or deleted. It is switched off (the account is made inactive, as the Members page's
"disabled") only when it has never signed in and has no agents or tasks; otherwise listed.

Shared mailboxes (the work emails several people use): listed per company with who uses them. With
`apply --mailboxes` each one not registered yet is registered for its company on the Microsoft 365
settings as a PAUSED shared mailbox (nothing is read until an owner turns it on, after Microsoft
access is granted for the tenant). People see their work mailbox on the Microsoft 365 page by
connecting it as their own extra account (P118; P124 approval below HOD).

Every change is one audit row (actor system:staff-sync, note "CSV sync 27 Nov 2026"). Each person
is one transaction with a savepoint per change, so one refused change does not hold up the rest;
the sign-in email change comes last and commits on its own (letting go of Microsoft commits).

Position rules (`match_position`), first that applies; JAWATAN is the job title, TUGASAN the
duties, the place is the CSV company or unit:
- JAWATAN "STORE HELPER" -> Store Helper.
- JAWATAN "KETUA UNIT ..." (head of a unit): the position TUGASAN names, else the head of that
  unit (Head of FWM for UNIT PENGURUSAN NEPAL), else Unsorted. Nothing is created.
- TUGASAN that names a structure position (OGM, Deputy OGM, Cleaning Administration Manager,
  Procurement & Inventory Manager, Transportation & Cleaning Manager, Admin Executive (Goodwill /
  PKK), Storekeeper, Inventory Admin).
- "PENGURUS OPERASI" / "OM": Regional Operations Manager when the wording is regional (wilayah,
  serantau, regional, ROM), else Operations Manager.
- "PEGAWAI OPERASI" (or "OPERASI" with TUGASAN "PEGAWAI OPERASI", or at an operations zone):
  Patrolling Officer when TUGASAN says patrol / rondaan, else Operations Executive.
- "PENGURUS" / "PENGURUS SYARIKAT" at a subsidiary company: Head of Company.
- Admin titles (EKSEKUTIF / KERANI / PEMBANTU / PEGAWAI PENTADBIRAN, PEMBANTU TADBIR OPERASI): Local
  Company Administrator at a subsidiary company, Admin Executive at Goodwill operations, and in a
  central unit that department's executive (HR Administrator, IT, CMS, FWM, Finance, ACT, Asset).
- "EKSEKUTIF KEWANGAN": the Finance executive. "EKSEKUTIF HR": HR Administrator. "PENGURUS HR":
  Head of Human Resources. "IT EKSEKUTIF": IT Executive. "IT LEADER" / "PENGURUS PENTADBIRAN IT":
  Head of IT. "EKSEKUTIF AUDIT DALAMAN" / "AUDIT DALAMAN SPECIALIST": the ACT executive. "CCTV
  CMS": CMS Executive. "EKSEKUTIF PENYELENGGARAAN" in the asset unit: the asset executive.
- Anything else, or a position the structure does not have (yet): Unsorted, with the reason.
A target is found by its key, else by its title, Malay title or an alias, so a position the owner
adds later (for example "Finance Executive") is picked up by the next run. Each match carries a
confidence (0.6-0.95).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

ACTOR = "system:staff-sync"
NOTE = "CSV sync 27 Nov 2026"
PINNED = frozenset({"owner", "admin", "it_support"})
# Roles that sit in a company (core/security.SCOPED_ROLES): only they are placed here.
SCOPED = frozenset({"branch_manager", "group_hod", "hod", "supervisor", "staff"})
# Roles the sync may raise someone FROM, and TO (scoped roles up to head of department).
RAISE_FROM = frozenset({"staff", "supervisor"})
RAISE_TO = ("hod", "supervisor", "staff")  # higher first
# A position whose default role may go above head of department (the owner, 27 Nov 2026: Heads
# of Company are their company's branch managers). Never admin, owner, management, IT support, HR.
ROLE_ABOVE_HOD = {"head_of_company": frozenset({"branch_manager"})}
MAX_EXTRA_ACCOUNTS = 5  # microsoft/auth.MAX_EXTRA_ACCOUNTS (P118), checked by the test
RANK = (
    "owner", "admin", "it_support", "management", "hr", "branch_manager", "group_hod", "hod",
    "supervisor", "staff", "operator", "approver", "viewer",
)  # fmt: skip
SURE = 0.9  # a match this good may move someone's company or change their sign-in email
MIN_POSITION = 0.6


def rank(role: str | None) -> int:
    return RANK.index(role) if role in RANK else len(RANK)


# ---------------------------------------------------------------- text


def norm(s: object) -> str:
    """Capitals, letters and digits only, single spaces: for comparing titles."""
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", str(s or "").upper()).split())


ACRONYMS = frozenset(
    "IT HR OM CCTV CMS HQ PKK KBK AP ACT OGM ROM PDPA FWM CEO COO COS DOA VCOS KNS".split()
)
SMALL = {"DAN": "dan", "DI": "di", "OF": "of", "AND": "and"}


def title_case(s: str | None) -> str | None:
    """A JAWATAN as a job title: "EKSEKUTIF PENTADBIRAN/PEGAWAI OPERASI" -> "Eksekutif
    Pentadbiran / Pegawai Operasi"; acronyms stay capitals."""
    if not s or not s.strip():
        return None
    s = re.sub(r"\s*/\s*", " / ", " ".join(s.split()))

    def word(mt: re.Match[str]) -> str:
        w = mt.group(0)
        up = w.upper()
        if up in ACRONYMS:
            return up
        if up in SMALL and mt.start() > 0:
            return SMALL[up]
        return up[:1] + up[1:].lower()

    return re.sub(r"[A-Za-z]+", word, s)[:120]


def name_case(s: str) -> str:
    """A person's name from the lists (capitals) as the office keeps names: "Nur Aina Binti Ali"."""
    return re.sub(r"[A-Za-z']+", lambda mt: mt.group(0)[:1].upper() + mt.group(0)[1:].lower(), s)


def mask(email: str | None) -> str:
    if not email or "@" not in email:
        return email or ""
    local, dom = email.split("@", 1)
    return f"{local[:2]}***@{dom}"


def domain(email: str | None) -> str:
    return email.rsplit("@", 1)[-1].lower() if email and "@" in email else ""


# ---------------------------------------------------------------- positions


@dataclass
class Position:
    key: str
    title: str
    title_ms: str | None = None
    aliases: list[str] = field(default_factory=list)
    default_role: str | None = None
    id: str | None = None

    def names(self) -> set[str]:
        out = {norm(self.title), norm(self.key.replace("_", " "))}
        if self.title_ms:
            out.add(norm(self.title_ms))
        out.update(norm(a) for a in self.aliases)
        out.add(norm(re.sub(r"\s*\([^()]*\)\s*$", "", self.title)))
        return out - {""}


def seed_catalogue() -> list[Position]:
    """The positions the structure seed gives a workspace (org/structure.py), first key wins."""
    from .structure import seed_positions

    out: dict[str, Position] = {}
    for p in seed_positions():
        out.setdefault(p.key, Position(p.key, p.title, p.title_ms, list(p.aliases), p.default_role))
    return list(out.values())


@dataclass(frozen=True)
class Target:
    """What a rule points at: position keys first, then titles (English or Malay)."""

    label: str
    keys: tuple[str, ...]
    titles: tuple[str, ...] = ()


T = Target
STORE_HELPER = T("Store Helper", ("store_helper",))
STOREKEEPER = T("Storekeeper", ("storekeeper",))
OGM = T("OGM", ("ogm",))
DEPUTY_OGM = T("Deputy OGM", ("deputy_ogm",))
CLEANING_ADMIN = T("Cleaning Administration Manager", ("cleaning_administration_manager",))
INVENTORY_MANAGER = T("Inventory Manager", ("inventory_manager",))
INVENTORY_EXEC = T("Inventory Executive / Store Head", ("inventory_executive_store_head",))
LOGISTICS = T("Logistics & Head of Cleaning Operations", ("logistics_head_cleaning_ops_manager",))
GOODWILL_ADMIN = T("Goodwill Admin Executive", ("goodwill_admin_executive",))
ADMIN_EXEC = T("Admin Executive", ("admin_executive_third",), ("Admin Executive",))
ROM = T("Regional Operations Manager", ("regional_operations_manager",))
OM = T("Operations Manager", ("operations_manager",))
OE = T("Operations Executive", ("operations_executive",))
PATROL = T("Patrolling Officer", ("patrolling_officer",))
HEAD_OF_COMPANY = T("Head of Company", ("head_of_company",))
LOCAL_ADMIN = T("Local Company Administrator", ("local_company_administrator",))
HR_ADMIN = T("HR Administrator", ("hr_administrator",))
# The HR unit's own executive (P145 seed: dept_hr_executive), else the HR Administrator.
HR_EXEC = T("HR Executive", ("dept_hr_executive", "hr_executive", "hr_administrator"))
HEAD_HR = T(
    "Head of Human Resources",
    ("head_of_human_resources", "head_of_hr", "dept_hr_head"),
    ("Head of Human Resources", "Head of HR", "Ketua Sumber Manusia", "Pengurus HR"),
)
IT_EXEC = T("IT Executive", ("it_executive", "dept_it_executive"), ("IT Executive", "Eksekutif IT"))
HEAD_IT = T("Head of IT", ("head_of_it",))
FINANCE_EXEC = T(
    "Finance Executive",
    ("finance_executive", "dept_finance_executive"),
    ("Finance Executive", "Eksekutif Kewangan", "Accounts Executive"),
)
ACT_EXEC = T(
    "ACT Executive",
    ("act_executive", "dept_act_executive", "audit_executive", "dept_audit_executive"),
    ("ACT Executive", "Audit Executive", "Internal Audit Executive", "Eksekutif Audit Dalaman"),
)
CMS_EXEC = T(
    "CMS Executive", ("cms_executive", "dept_cms_executive"), ("CMS Executive", "Eksekutif CMS")
)
FWM_EXEC = T(
    "FWM Executive", ("fwm_executive", "dept_fwm_executive"), ("FWM Executive", "Eksekutif FWM")
)
HEAD_FWM = T("Head of FWM", ("head_of_fwm",))
ASSET_EXEC = T(
    "Asset Executive",
    ("asset_executive", "dept_asset_executive", "maintenance_executive"),
    ("Asset Executive", "Maintenance Executive", "Eksekutif Penyelenggaraan", "Eksekutif Aset"),
)

# TUGASAN that names a position itself (the Goodwill HQ lines write the English title there).
DUTY_TITLES: tuple[tuple[str, Target, float], ...] = (
    (r"\bDEPUTY (OF )?(OPERATION|OPERATIONS) GENERAL MANAGER\b|\bDEPUTY OGM\b", DEPUTY_OGM, 0.85),
    (r"\b(OPERATION|OPERATIONS) GENERAL MANAGER\b|^OGM$", OGM, 0.85),
    (r"\bCLEANING ADMINISTRATION MANAGER\b", CLEANING_ADMIN, 0.9),
    (r"\bPROCU?RE?MENT (AND )?INVENTORY MANAGER\b", INVENTORY_MANAGER, 0.8),
    (r"\bTRANSPORTATION (AND )?CLEANING MANAGER\b", LOGISTICS, 0.8),
    (r"\bADMIN EXECUTIVE GOODWILL\b", GOODWILL_ADMIN, 0.9),
    (r"\bADMIN EXECUTIVE PKK\b", ADMIN_EXEC, 0.7),
    (r"^STOREKEEPER$|^STORE KEEPER$", STOREKEEPER, 0.85),
    (r"^INVENTORY ADMIN$", INVENTORY_EXEC, 0.6),
)
ADMIN_TITLES = frozenset(
    {
        "EKSEKUTIF PENTADBIRAN",
        "EKSEKUTIF PENTADBIRAN PROTEGE",
        "KERANI PENTADBIRAN",
        "PEMBANTU PENTADBIRAN",
        "PEGAWAI PENTADBIRAN",
        "PEMBANTU TADBIR OPERASI",
    }
)
# A central unit's own executive (for the admin titles there).
UNIT_EXEC = {
    "hr": (HR_EXEC, 0.7),
    "it": (IT_EXEC, 0.75),
    "cms": (CMS_EXEC, 0.75),
    "fwm": (FWM_EXEC, 0.8),
    "finance": (FINANCE_EXEC, 0.75),
    "act": (ACT_EXEC, 0.75),
    "asset": (ASSET_EXEC, 0.7),
}
REGIONAL = re.compile(r"\b(WILAYAH|SERANTAU|REGIONAL|REGION|ROM)\b")
PATROLLING = re.compile(r"\b(RONDA|RONDAAN|PATROL|PATROLLING)\b")


def place_kind(companies: list[str], units: list[str], places: list[dict[str, Any]]) -> str:
    """Where the list puts someone: goodwill_ops (an operations zone), goodwill_hq (Goodwill's
    school / KBK / PKK management), a central unit (finance, hr, it, act, cms, fwm, asset),
    sasa_team, company (a subsidiary) or unknown."""
    us = [norm(u) for u in units]
    for u in us:
        if u.startswith("OPERASI "):
            return "goodwill_ops"
    for u in us:
        if "KEWANGAN" in u:
            return "finance"
        if u == "UNIT HR" or u.endswith(" HR"):
            return "hr"
        if u == "UNIT IT":
            return "it"
        if "AUDIT" in u:
            return "act"
        if "CONTROL ROOM" in u or "CMS" in u:
            return "cms"
        if "NEPAL" in u:
            return "fwm"
        if "SEKOLAH" in u or "KBK" in u or "PKK" in u:
            return "goodwill_hq"
        if "ASSET" in u or "ASET" in u:
            return "asset"
        if u.startswith("SASA TEAM"):
            return "sasa_team"
    branches = [norm(p.get("branch")) for p in places if p.get("branch")]
    if any(b.startswith("GOODWILL EMPIRE") for b in branches):
        return "goodwill_hq"
    if companies or branches:
        return "company"
    return "unknown"


@dataclass
class Match:
    key: str | None
    title: str | None
    confidence: float
    reason: str
    position_id: str | None = None
    default_role: str | None = None


class Catalogue:
    def __init__(self, positions: list[Position]):
        self.positions = positions
        self.by_key = {p.key: p for p in positions}
        self.by_name: dict[str, Position] = {}
        for p in positions:
            for n in p.names():
                self.by_name.setdefault(n, p)

    def find(self, t: Target) -> Position | None:
        for k in t.keys:
            if k in self.by_key:
                return self.by_key[k]
        for title in t.titles:
            hit = self.by_name.get(norm(title))
            if hit is not None:
                return hit
        return None


def _hit(cat: Catalogue, t: Target, conf: float, why: str) -> Match:
    p = cat.find(t)
    if p is None:
        return Match(None, None, 0.0, f"no '{t.label}' position in the structure yet ({why})")
    return Match(p.key, p.title, conf, why, p.id, p.default_role)


def _unsorted(why: str) -> Match:
    return Match(None, None, 0.0, why)


def match_position(
    cat: Catalogue,
    jawatan: str | None,
    tugasan: str | None,
    companies: list[str],
    units: list[str],
    places: list[dict[str, Any]],
) -> Match:
    """The structure position for a JAWATAN / TUGASAN at a place (rules: the module doc)."""
    j, t = norm(jawatan), norm(tugasan)
    kind = place_kind(companies, units, places)
    if not j:
        return _unsorted("no JAWATAN in the list")
    if j == "STORE HELPER":
        return _hit(cat, STORE_HELPER, 0.95, "JAWATAN Store Helper")
    duty = next(((tg, c) for rx, tg, c in DUTY_TITLES if t and re.search(rx, t)), None)
    if j.startswith("KETUA UNIT"):
        if duty:
            return _hit(
                cat, duty[0], duty[1] - 0.05, f"head of unit; TUGASAN names {duty[0].label}"
            )
        if kind == "fwm":
            return _hit(cat, HEAD_FWM, 0.85, "head of the Nepal (FWM) unit")
        return _unsorted(f"head of a unit with no position ({title_case(jawatan)})")
    if duty and j not in ("PENGURUS OPERASI", "OM", "PEGAWAI OPERASI"):
        return _hit(cat, duty[0], duty[1], f"TUGASAN names {duty[0].label}")
    if j in ("PENGURUS OPERASI", "OM") or (j == "HEAD OF DEPARTMENT" and REGIONAL.search(t)):
        if REGIONAL.search(j) or REGIONAL.search(t):
            return _hit(cat, ROM, 0.8, "regional operations manager wording")
        conf = 0.9 if kind == "goodwill_ops" else 0.75
        return _hit(cat, OM, conf, f"{j} at {kind}")
    if j.startswith("PENGURUS OPERASI") and REGIONAL.search(j):
        return _hit(cat, ROM, 0.85, "regional operations manager wording")
    operations = j == "PEGAWAI OPERASI" or (
        j == "OPERASI" and ("PEGAWAI OPERASI" in t or kind in ("goodwill_ops", "sasa_team"))
    )
    if operations:
        if PATROLLING.search(t):
            return _hit(cat, PATROL, 0.85, "operations officer on patrol (TUGASAN)")
        conf = 0.85 if kind == "goodwill_ops" else 0.7
        return _hit(cat, OE, conf, f"{j} at {kind}")
    if j == "EKSEKUTIF PENTADBIRAN PEGAWAI OPERASI":
        if kind == "goodwill_ops":
            return _hit(cat, OE, 0.7, "admin and operations officer at an operations zone")
        return _unsorted("admin and operations officer outside the operations zones")
    if j in ("PENGURUS", "PENGURUS SYARIKAT"):
        if kind == "company":
            return _hit(cat, HEAD_OF_COMPANY, 0.9, f"{j} of a company")
        if kind == "asset" or (kind == "sasa_team" and companies):
            # Prisma Wiramaju (the asset unit) and the companies Sasa Team runs are companies too.
            return _hit(cat, HEAD_OF_COMPANY, 0.75, f"{j} of a company ({kind})")
        return _unsorted(f"{title_case(jawatan)} outside a subsidiary company ({kind})")
    if j in ADMIN_TITLES:
        if kind == "company":
            return _hit(cat, LOCAL_ADMIN, 0.85, "admin at a subsidiary company")
        if kind == "sasa_team":
            return _hit(cat, LOCAL_ADMIN, 0.7, "admin at Sasa Team")
        if kind in ("goodwill_ops", "goodwill_hq"):
            return _hit(cat, ADMIN_EXEC, 0.7, "admin at Goodwill operations")
        if kind in UNIT_EXEC:
            tg, conf = UNIT_EXEC[kind]
            return _hit(cat, tg, conf, f"admin in the {kind} unit")
        return _unsorted(f"admin title at an unknown place ({kind})")
    if j == "EKSEKUTIF KEWANGAN":
        return _hit(cat, FINANCE_EXEC, 0.9, "finance executive")
    if j == "EKSEKUTIF HR":
        return _hit(cat, HR_ADMIN, 0.9, "HR executive")
    if j == "PENGURUS HR":
        return _hit(cat, HEAD_HR, 0.85, "HR manager")
    if j == "IT EKSEKUTIF" or j == "EKSEKUTIF IT":
        return _hit(cat, IT_EXEC, 0.95, "IT executive")
    if j in ("IT LEADER", "PENGURUS PENTADBIRAN IT", "PENGURUS IT"):
        return _hit(cat, HEAD_IT, 0.8, "IT lead")
    if j in ("EKSEKUTIF AUDIT DALAMAN", "AUDIT DALAMAN SPECIALIST"):
        return _hit(cat, ACT_EXEC, 0.85, "internal audit (ACT)")
    if j == "CCTV CMS" or (j.startswith("CCTV") and kind == "cms"):
        return _hit(cat, CMS_EXEC, 0.9, "CMS control room")
    if j == "EKSEKUTIF PENYELENGGARAAN" and kind == "asset":
        return _hit(cat, ASSET_EXEC, 0.7, "maintenance in the asset unit")
    return _unsorted(f"JAWATAN '{title_case(jawatan)}' at {kind}: no rule")


# ---------------------------------------------------------------- the office as it is


@dataclass
class Member:
    user_id: str
    email: str
    name: str
    role: str
    branch_id: str | None = None
    department_id: str | None = None
    branch_ids: list[str] = field(default_factory=list)
    job_title: str | None = None
    position_id: str | None = None
    work_email: str | None = None
    is_active: bool = True
    last_login_at: str | None = None
    is_developer: bool = False
    agents: int = 0
    tasks: int = 0
    other_ws: int = 0
    ms_main: int = 0  # their main Microsoft account, connected (not disconnected)
    ms_extra: int = 0  # their extra Microsoft accounts (any status)


@dataclass
class Snapshot:
    members: dict[str, Member]
    users_by_email: dict[str, str]  # every account here, member or not
    branches: dict[str, str]  # id -> name
    departments: dict[str, tuple[str, str]]  # id -> (name, branch_id)
    positions: list[Position]
    mailboxes: set[str] = field(default_factory=set)

    def branch_id(self, name: str | None) -> str | None:
        want = norm(name)
        return next((i for i, n in sorted(self.branches.items()) if norm(n) == want), None)

    def department_id(self, branch_id: str | None, name: str | None) -> str | None:
        want = norm(name)
        return next(
            (
                i
                for i, (n, b) in sorted(self.departments.items())
                if b == branch_id and norm(n) == want
            ),
            None,
        )


# ---------------------------------------------------------------- the plan


def _resolve(snap: Snapshot, places: list[dict[str, Any]]) -> list[tuple[str, str | None]]:
    """The list's places as (branch id, department id or None), known ones only, in order."""
    out: list[tuple[str, str | None]] = []
    for p in places:
        bid = snap.branch_id(p.get("branch"))
        if bid is None:
            continue
        did = snap.department_id(bid, p.get("dept")) if p.get("dept") else None
        if all(b != bid for b, _ in out):
            out.append((bid, did))
    return out


def _place_change(m: Member | None, at: list[tuple[str, str | None]], sure: bool) -> dict | None:
    """Their home company, department and companies after the list (None: as they are)."""
    if not at:
        return None
    home, dept = at[0]
    listed = [b for b, _ in at]
    if m is None or m.branch_id is None:
        new_home, new_dept, every = home, dept, listed
    else:
        mine = [m.branch_id, *[b for b in m.branch_ids if b != m.branch_id]]
        if not set(mine) & set(listed):
            if not sure:
                return None
            new_home, new_dept = home, dept
            every = listed + [b for b in mine[1:] if b not in listed]
        else:
            new_home, new_dept = m.branch_id, m.department_id
            want = next((d for b, d in at if b == m.branch_id), None)
            if want and want != m.department_id:
                new_dept = want
            every = mine + [b for b in listed if b not in mine]
    before = (m.branch_id, m.department_id, sorted(m.branch_ids)) if m else (None, None, [])
    if (new_home, new_dept, sorted(every)) == before:
        return None
    return {
        "kind": "place",
        "branch_id": new_home,
        "department_id": new_dept,
        "branch_ids": every,
        "from": {"branch_id": before[0], "department_id": before[1], "branch_ids": before[2]},
    }


def _role_change(
    current: str, wanted: str | None, department_id: str | None, position: str | None = None
) -> tuple[dict | None, str | None]:
    """(the role change, a review reason) for a position's default role."""
    if not wanted or wanted == current:
        return None, None
    if current in PINNED:
        return None, None
    above = ROLE_ABOVE_HOD.get(position or "", frozenset())
    if current not in RAISE_FROM and not (wanted in above and current == "hod"):
        return None, None  # a manager's role stays as the owner set it
    if rank(wanted) >= rank(current):
        return None, None  # never lowered here
    if wanted not in RAISE_TO and wanted not in above:
        return None, f"position suggests role {wanted}: the owner decides"
    if wanted in ("hod", "supervisor") and not department_id:
        return None, f"position suggests role {wanted}, which needs a department"
    return {"kind": "role", "from": current, "to": wanted}, None


def compute(inp: dict[str, Any], snap: Snapshot) -> dict[str, Any]:
    """The plan for every person and mailbox in the prepared input (no database)."""
    cat = Catalogue(snap.positions)
    company = {d.lower() for d in inp.get("company_domains") or []}
    people_out: list[dict[str, Any]] = []
    extras_out: list[dict[str, Any]] = []
    planned_work: dict[str, str] = {}  # user id or ref -> work email after the plan
    seen_extra: set[str] = set()
    adding: set[str] = set()  # sign-in emails this plan gives (an add or a change)
    for p in inp.get("people") or []:
        item: dict[str, Any] = {
            "ref": p.get("ref"),
            "name": p.get("name"),
            "action": p.get("action"),
            "user_id": p.get("office_user_id"),
            "confidence": p.get("confidence"),
            "changes": [],
            "review": [],
            "notes": list(p.get("notes") or []),
        }
        people_out.append(item)
        conf = float(p.get("confidence") or 0)
        login = (p.get("login_email") or "").strip().lower() or None
        work = (p.get("work_email") or "").strip().lower() or None
        match = match_position(
            cat,
            p.get("jawatan"),
            p.get("tugasan"),
            list(p.get("companies") or []),
            list(p.get("units") or []),
            list(p.get("places") or []),
        )
        item["position"] = asdict(match)
        if match.key is None:
            item["unsorted"] = match.reason
        if p.get("action") == "review":
            item["review"].append(
                "listed for review by the matching"
                + (" (the lists disagree)" if p.get("conflict") else "")
            )
            continue
        at = _resolve(snap, list(p.get("places") or []))
        if p.get("places") and not at:
            item["notes"].append("the list's company is not in the office")
        m: Member | None = None
        owner = snap.users_by_email.get(login) if login else None
        if p.get("action") == "add" and owner in snap.members:
            # Added by an earlier run (or since): kept in step like anyone matched.
            item["user_id"] = owner
            item["notes"].append("already a member: added before")
            m = snap.members[owner]
        elif p.get("action") == "add":
            if not login:
                item["review"].append("no personal email to sign in with")
                continue
            if login in adding:
                item["review"].append(f"{mask(login)} twice in the lists")
                continue
            if not at:
                item["review"].append("no office company for this person")
                continue
            adding.add(login)
            item["changes"].append(
                {
                    "kind": "add",
                    "email": login,
                    "name": name_case(str(p.get("name") or login)),
                    "branch_id": at[0][0],
                    "department_id": at[0][1],
                }
            )
        else:
            m = snap.members.get(str(p.get("office_user_id") or ""))
            if m is None:
                item["review"].append("the matched member is no longer here")
                continue
        role = m.role if m else "staff"
        frozen = m is not None and (m.role in PINNED or m.is_developer)
        cur_email = m.email if m else login
        # b. work email: the list's, else the company address they signed in with.
        want_work = work
        if (
            not want_work
            and m is not None
            and login
            and m.email != login
            and domain(m.email) in company
        ):
            want_work = m.email
        if want_work and (m is None or m.work_email != want_work):
            item["changes"].append(
                {"kind": "work_email", "from": m.work_email if m else None, "to": want_work}
            )
        planned_work[m.user_id if m else f"ref:{p.get('ref')}"] = (
            want_work or (m.work_email if m else None) or ""
        )
        # c. job title.
        title = title_case(p.get("jawatan"))
        if title and (m is None or (m.job_title or None) != title):
            item["changes"].append(
                {"kind": "job_title", "from": m.job_title if m else None, "to": title}
            )
        # d. position (never replaces one already held).
        if match.key is not None and match.confidence >= MIN_POSITION:
            held = m.position_id if m else None
            if held is None or (match.position_id and held != match.position_id):
                if held is None:
                    item["changes"].append(
                        {
                            "kind": "position",
                            "key": match.key,
                            "title": match.title,
                            "position_id": match.position_id,
                            "confidence": match.confidence,
                        }
                    )
                else:
                    item["notes"].append(f"holds another position; the rules say {match.title}")
        # e. place (an add is placed by the add itself; workspace-wide roles sit nowhere).
        place = None
        if m is not None and not frozen:
            if m.role in SCOPED:
                place = _place_change(m, at, conf >= SURE)
            elif at:
                item["notes"].append(f"role {m.role} sits in no company: place left")
        dept_after = (
            (place or {}).get("department_id")
            if place
            else (m.department_id if m else (at[0][1] if at else None))
        )
        # f. role.
        change, why = (None, None)
        if not frozen:
            change, why = _role_change(role, match.default_role, dept_after, match.key)
        if why:
            item["review"].append(why)
        if place:
            item["changes"].append(place)
        if change:
            item["changes"].append(change)
        # a. sign-in email (last).
        if m is not None and login and login != m.email.lower():
            owner = snap.users_by_email.get(login)
            if frozen:
                item["review"].append("sign-in email of an owner, admin or developer: by hand")
            elif conf < SURE:
                item["review"].append(f"match {conf:.2f}: sign-in email left as it is")
            elif owner and owner != m.user_id:
                item["email_taken"] = owner
                item["review"].append(f"{mask(login)} is already another account's sign-in")
            elif m.other_ws:
                item["review"].append("also in another workspace: sign-in email left")
            elif domain(cur_email) not in company and cur_email:
                item["review"].append("already signs in with another personal email")
            elif login in adding:
                item["review"].append(f"{mask(login)} is given to someone else in this plan")
            else:
                adding.add(login)
                # Their connected Microsoft account stays as an extra one when there is room.
                ms = "none"
                if m.ms_main:
                    ms = "kept_as_extra"
                    if m.ms_extra + m.ms_main > MAX_EXTRA_ACCOUNTS:
                        ms = "let_go"
                        item["notes"].append(
                            "too many extra Microsoft accounts: the work account is disconnected"
                        )
                item["changes"].append(
                    {"kind": "login_email", "from": m.email, "to": login, "microsoft": ms}
                )
        # Their other office accounts.
        for xid in p.get("extra_accounts") or []:
            x = snap.members.get(xid)
            if x is None or xid in seen_extra or (m is not None and xid == m.user_id):
                continue
            seen_extra.add(xid)
            row: dict[str, Any] = {"user_id": xid, "email": x.email, "of": p.get("ref")}
            if not x.is_active:
                row["action"] = "none"
            elif x.role in PINNED or x.is_developer:
                row.update(action="review", why="an owner, admin or developer account")
            else:
                busy = [
                    w
                    for w, on in (
                        ("has signed in", bool(x.last_login_at)),
                        (f"owns {x.agents} agents", x.agents > 0),
                        (f"has {x.tasks} tasks", x.tasks > 0),
                    )
                    if on
                ]
                if busy:
                    row.update(action="review", why=", ".join(busy))
                else:
                    row["action"] = "switch_off"
            extras_out.append(row)

    # Shared mailboxes: one row each, with the people who use it.
    users_of: dict[str, list[str]] = {}
    for who, addr in planned_work.items():
        if addr:
            users_of.setdefault(addr, []).append(who)
    boxes: list[dict[str, Any]] = []
    for b in inp.get("mailboxes") or []:
        addr = str(b.get("address") or "").strip().lower()
        if not addr:
            continue
        at = _resolve(snap, list(b.get("places") or []))
        row = {
            "address": addr,
            "label": b.get("label"),
            "branch_id": at[0][0] if at else None,
            "company": snap.branches.get(at[0][0]) if at else None,
            "used_by": sorted(users_of.get(addr, [])),
        }
        if addr in snap.mailboxes:
            row["action"] = "exists"
        elif not at:
            row["action"] = "no_company"
        else:
            row["action"] = "register"
        boxes.append(row)
    return {
        "people": people_out,
        "extra_accounts": extras_out,
        "mailboxes": boxes,
        "summary": summarize(people_out, extras_out, boxes),
    }


def summarize(people: list[dict], extras: list[dict], boxes: list[dict]) -> dict[str, Any]:
    kinds = Counter(c["kind"] for p in people for c in p["changes"])
    positions = Counter(c["title"] for p in people for c in p["changes"] if c["kind"] == "position")
    unsorted = Counter(
        p["unsorted"] for p in people if p.get("unsorted") and p["action"] != "review"
    )
    return {
        "people": len(people),
        "actions": dict(Counter(p["action"] for p in people)),
        "with_changes": sum(1 for p in people if p["changes"]),
        "changes": dict(kinds),
        "roles": dict(
            Counter(
                f"{c['from']}->{c['to']}"
                for p in people
                for c in p["changes"]
                if c["kind"] == "role"
            )
        ),
        "positions": dict(positions.most_common()),
        "unsorted": sum(unsorted.values()),
        "unsorted_reasons": dict(unsorted.most_common()),
        "review": sum(1 for p in people if p["review"]),
        "login_microsoft": dict(
            Counter(
                c.get("microsoft", "none")
                for p in people
                for c in p["changes"]
                if c["kind"] == "login_email"
            )
        ),
        "extra_accounts": dict(Counter(x["action"] for x in extras)),
        "mailboxes": dict(Counter(b["action"] for b in boxes)),
    }


# ---------------------------------------------------------------- database


async def snapshot(db: AsyncSession, ws: str) -> Snapshot:
    from ..models import (
        Agent,
        Branch,
        Department,
        Membership,
        MicrosoftAccount,
        SharedMailbox,
        Task,
        User,
    )
    from ..teams.task_models import TaskPerson
    from .structure_models import OrgPosition

    rows = (await db.scalars(select(Membership).where(Membership.workspace_id == ws))).all()
    ids = [m.user_id for m in rows]
    agents = dict(
        (
            await db.execute(
                select(Agent.owner_user_id, func.count())
                .where(Agent.owner_user_id.in_(ids))
                .group_by(Agent.owner_user_id)
            )
        ).all()
    )
    tasks: Counter[str] = Counter()
    for uid, n in (
        await db.execute(
            select(Task.assignee_user_id, func.count())
            .where(Task.assignee_user_id.in_(ids))
            .group_by(Task.assignee_user_id)
        )
    ).all():
        tasks[uid] += n
    for uid, n in (
        await db.execute(
            select(TaskPerson.user_id, func.count())
            .where(TaskPerson.user_id.in_(ids))
            .group_by(TaskPerson.user_id)
        )
    ).all():
        tasks[uid] += n
    for actor, n in (
        await db.execute(
            select(Task.created_by, func.count())
            .where(Task.created_by.in_([f"user:{i}" for i in ids]))
            .group_by(Task.created_by)
        )
    ).all():
        tasks[actor.removeprefix("user:")] += n
    other = dict(
        (
            await db.execute(
                select(Membership.user_id, func.count())
                .where(Membership.user_id.in_(ids), Membership.workspace_id != ws)
                .group_by(Membership.user_id)
            )
        ).all()
    )
    ms_main: Counter[str] = Counter()
    ms_extra: Counter[str] = Counter()
    for uid, primary, st in (
        await db.execute(
            select(
                MicrosoftAccount.user_id, MicrosoftAccount.is_primary, MicrosoftAccount.status
            ).where(MicrosoftAccount.workspace_id == ws, MicrosoftAccount.user_id.in_(ids))
        )
    ).all():
        if not primary:
            ms_extra[uid] += 1
        elif st != "disconnected":
            ms_main[uid] += 1
    members = {
        m.user_id: Member(
            user_id=m.user_id,
            email=m.user.email,
            name=m.user.name,
            role=m.role,
            branch_id=m.branch_id,
            department_id=m.department_id,
            branch_ids=list(m.branch_ids),
            job_title=m.job_title,
            position_id=m.position_id,
            work_email=m.work_email,
            is_active=m.user.is_active,
            last_login_at=m.user.last_login_at.isoformat() if m.user.last_login_at else None,
            is_developer=bool(m.user.is_developer),
            agents=int(agents.get(m.user_id, 0)),
            tasks=int(tasks.get(m.user_id, 0)),
            other_ws=int(other.get(m.user_id, 0)),
            ms_main=int(ms_main.get(m.user_id, 0)),
            ms_extra=int(ms_extra.get(m.user_id, 0)),
        )
        for m in rows
    }
    users = dict((await db.execute(select(User.email, User.id))).all())
    branches = dict(
        (await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws))).all()
    )
    depts = {
        i: (n, b)
        for i, n, b in (
            await db.execute(
                select(Department.id, Department.name, Department.branch_id).where(
                    Department.workspace_id == ws
                )
            )
        ).all()
    }
    positions = [
        Position(p.key, p.title, p.title_ms, list(p.aliases or []), p.default_role, p.id)
        for p in (
            await db.scalars(
                select(OrgPosition)
                .where(OrgPosition.workspace_id == ws)
                .order_by(OrgPosition.sort, OrgPosition.key)
            )
        ).all()
    ]
    boxes = set(
        (
            await db.scalars(select(SharedMailbox.address).where(SharedMailbox.workspace_id == ws))
        ).all()
    )
    return Snapshot(
        members=members,
        users_by_email={e.lower(): i for e, i in users.items()},
        branches=branches,
        departments=depts,
        positions=positions,
        mailboxes=boxes,
    )


@dataclass
class Applied:
    done: Counter[str] = field(default_factory=Counter)
    skipped: list[str] = field(default_factory=list)

    def out(self) -> dict[str, Any]:
        return {"done": dict(self.done), "skipped": len(self.skipped), "why": self.skipped[:200]}


def _refusal(e: Exception) -> str:
    if isinstance(e, HTTPException):
        d = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
        return str(d.get("code") or d.get("message") or e.status_code)
    return type(e).__name__


async def _person(db: AsyncSession, principal: Any, item: dict[str, Any], res: Applied) -> None:
    from ..api.routers import members as mem
    from ..models import Membership
    from ..services import audit

    ws = principal.workspace_id
    uid: str | None = item.get("user_id")
    ref = item.get("ref") or uid
    changes = item["changes"]
    add = next((c for c in changes if c["kind"] == "add"), None)
    if add:
        try:
            async with db.begin_nested():
                m, _ = await mem.add_one(
                    db,
                    principal,
                    email=add["email"],
                    name=add["name"],
                    role="staff",
                    branch_id=add["branch_id"],
                    department_id=add["department_id"],
                    via="csv-sync",
                )
                uid = m.user_id
            res.done["add"] += 1
        except Exception as e:  # noqa: BLE001
            res.skipped.append(f"{ref}: add refused ({_refusal(e)})")
            return
    assert uid is not None
    place = next((c for c in changes if c["kind"] == "place"), None)
    role = next((c for c in changes if c["kind"] == "role"), None)
    for c in changes:
        kind = c["kind"]
        if kind in ("add", "login_email", "role") or (kind == "place" and role):
            continue
        try:
            async with db.begin_nested():
                m = await db.get(Membership, (ws, uid))
                assert m is not None
                if kind == "work_email":
                    await mem.set_work_email(db, principal, uid, c["to"])
                elif kind == "job_title":
                    await mem.set_title(db, principal, uid, c["to"])
                elif kind == "position":
                    if not c.get("position_id"):
                        raise LookupError(f"no position {c['key']} in this workspace")
                    before = m.position_id
                    m.position_id = c["position_id"]
                    await audit.record(
                        db, ws, principal.actor, "member.position_set", target=uid,
                        before={"position_id": before},
                        after={"position_id": c["position_id"], "key": c["key"],
                               "confidence": c.get("confidence")},
                    )  # fmt: skip
                elif kind == "place":
                    await mem.change_access(
                        db, principal, uid, m.role, c["branch_id"], c["department_id"],
                        c["branch_ids"],
                    )  # fmt: skip
                await db.flush()
            res.done[kind] += 1
        except Exception as e:  # noqa: BLE001
            res.skipped.append(f"{ref}: {kind} refused ({_refusal(e)})")
    if role:
        try:
            async with db.begin_nested():
                m = await db.get(Membership, (ws, uid))
                assert m is not None
                branch_id = place["branch_id"] if place else m.branch_id
                dept_id = place["department_id"] if place else m.department_id
                every = place["branch_ids"] if place else m.branch_ids
                await mem.change_access(db, principal, uid, role["to"], branch_id, dept_id, every)
                await db.flush()
            res.done["role"] += 1
            if place:
                res.done["place"] += 1
        except Exception as e:  # noqa: BLE001
            res.skipped.append(f"{ref}: role refused ({_refusal(e)})")
    await db.commit()
    login = next((c for c in changes if c["kind"] == "login_email"), None)
    if login:
        try:
            await mem.change_identity(db, principal, uid, None, login["to"], keep_microsoft=True)
            await db.commit()
            res.done["login_email"] += 1
        except Exception as e:  # noqa: BLE001
            await db.rollback()
            res.skipped.append(f"{ref}: login_email refused ({_refusal(e)})")


async def apply(
    db: AsyncSession, principal: Any, plan: dict[str, Any], *, mailboxes: bool = False
) -> Applied:
    """Carry out a plan made by `compute` against this database (see the module doc)."""
    from ..models import SharedMailbox, User
    from ..services import audit

    res = Applied()
    ws = principal.workspace_id
    with audit.noting(NOTE):
        for item in plan["people"]:
            if item["changes"]:
                await _person(db, principal, item, res)
        for x in plan["extra_accounts"]:
            if x["action"] != "switch_off":
                continue
            user = await db.get(User, x["user_id"])
            if user is None or not user.is_active:
                continue
            user.is_active = False
            await audit.record(
                db, ws, principal.actor, "member.switched_off", target=user.id,
                before={"is_active": True}, after={"is_active": False, "main_account_of": x["of"]},
            )  # fmt: skip
            await db.commit()
            res.done["extra_switched_off"] += 1
        if mailboxes:
            for b in plan["mailboxes"]:
                if b["action"] != "register":
                    continue
                mb = SharedMailbox(
                    workspace_id=ws,
                    address=b["address"],
                    display_name=(b.get("label") or "")[:200],
                    tenant_id="",
                    branch_id=b["branch_id"],
                    status="paused",
                    created_by=principal.actor,
                )
                db.add(mb)
                await db.flush()
                await audit.record(
                    db, ws, principal.actor, "mailbox.created", target=mb.id,
                    after={"address": b["address"], "branch_id": b["branch_id"],
                           "status": "paused", "used_by": len(b["used_by"])},
                )  # fmt: skip
                await db.commit()
                res.done["mailbox_registered"] += 1
    return res


# ---------------------------------------------------------------- command line


async def _workspace(db: AsyncSession, which: str | None) -> str:
    from ..models import Workspace

    q = select(Workspace.id).order_by(Workspace.created_at)
    if which:
        q = q.where(or_(Workspace.id == which, Workspace.slug == which))
    ids = list((await db.scalars(q)).all())
    if not ids:
        raise SystemExit(f"No workspace {which or ''}".strip())
    if len(ids) > 1:
        raise SystemExit("More than one workspace: give --workspace <id|slug>.")
    return ids[0]


async def _principal(db: AsyncSession, ws: str) -> Any:
    from ..members_import import CliPrincipal
    from ..models import Membership, User

    row = (
        await db.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == ws, Membership.role == "owner")
            .order_by(Membership.created_at, User.id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise SystemExit("This workspace has no owner to act as.")

    class SyncPrincipal(CliPrincipal):
        @property
        def actor(self) -> str:
            return ACTOR

    return SyncPrincipal(user=row[0], workspace_id=ws, role="owner", session_id="cli")


async def _cli(args: argparse.Namespace) -> int:
    from ..core.db import SessionLocal, engine
    from ..i18n import use_lang

    inp = json.loads(await asyncio.to_thread(Path(args.file).read_text, encoding="utf-8"))
    try:
        with use_lang("en"):
            async with SessionLocal() as db:
                ws = await _workspace(db, args.workspace or inp.get("workspace"))
                plan = compute(inp, await snapshot(db, ws))
                if args.out:
                    text = json.dumps(plan, indent=1, ensure_ascii=False)
                    await asyncio.to_thread(Path(args.out).write_text, text, encoding="utf-8")
                print(json.dumps(plan["summary"], indent=1, ensure_ascii=False))
                if args.cmd == "plan":
                    await db.rollback()
                    print("PLAN ONLY: nothing changed.")
                    return 0
                res = await apply(db, await _principal(db, ws), plan, mailboxes=args.mailboxes)
                print("APPLIED " + json.dumps(res.out(), indent=1, ensure_ascii=False))
    finally:
        await engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m agentic.org.staff_sync")
    p.add_argument("cmd", choices=("plan", "apply"))
    p.add_argument("--file", required=True, help="the prepared staff input (JSON)")
    p.add_argument("--workspace", help="workspace id or slug (default: the only one)")
    p.add_argument("--out", help="also write the full plan here (personal data: keep it private)")
    p.add_argument("--mailboxes", action="store_true", help="apply: register shared mailboxes")
    return asyncio.run(_cli(p.parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
