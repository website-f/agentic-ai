"""P112: which office member a Prima person is, and adding one who is not a member yet.

Fitri (17 Nov 2026): "...and then can't see link to the members, and if not match then add them
into the members in agentic ai with correct designation, email and so on."

Prima's person details (inside the office at /prima/) show whether the person is a member of the
office, with a link to them on the Members page, or offer to add them (api/routers/
prima_members.py). The person is always read from Prima as the person asking (client.call), so
Prima's own walls decide whether they may see that person, and what is saved comes from that
read, never from the browser.

A member is that person when, in this order:
1. linked: their Prima link (models.PrimaLink: their own staff record, or their own Prima account
   u-off-<id> that Prima tied to the staff record) names this person;
2. email: their sign-in email is one of the person's work emails in Prima (any case);
3. name: they are the only member with the person's name, written the same way once case, dots
   and bin / binti / b. / bt. are set aside, and not linked to another Prima person. Two members
   of that name: no guess.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import Branch, Department, Membership, PrimaLink, User, Workspace
from . import client, people
from .client import PrimaError

# Prima's ids (people "p-...", companies "co-..."): letters, digits and - _ . ~ only.
PERSON_ID = re.compile(r"^[A-Za-z0-9_\-.~]{1,120}$")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{1,60}$")
# Malay patronymic words, set aside when names are compared ("Ali bin Abu" = "Ali b. Abu").
_PATRONYMIC = frozenset({"bin", "binti", "binte", "bte", "bt", "b"})

HOW = ("linked", "email", "name")


@dataclass(frozen=True)
class PrimaPerson:
    id: str
    name: str
    emails: tuple[str, ...]
    job_title: str
    company_id: str
    staff_no: str
    department: str


@dataclass
class Match:
    """The member this person is (how: HOW), or none; `same_name` counts the members of the
    person's name when there were several (no guess)."""

    member: Membership | None = None
    how: str | None = None
    same_name: int = 0
    linked_elsewhere: list[str] = field(default_factory=list)


class PersonRefused(Exception):
    """Prima refused to show this person to the person asking: its status and own words."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def name_key(name: str) -> str:
    """'Siti Aminah Bt. Ahmad' and 'siti aminah binti ahmad' are the same name."""
    return " ".join(w for w in people.name_key(name).split() if w not in _PATRONYMIC)


def clean_email(text: object) -> str:
    s = str(text or "").strip().lower()
    return s if len(s) <= 254 and _EMAIL.match(s) else ""


def parse_person(data: object) -> PrimaPerson | None:
    """Prima's person details (GET /api/people/:id answers {person, branch, ...})."""
    p = data.get("person") if isinstance(data, dict) else None
    if not isinstance(p, dict) or not p.get("id"):
        return None
    emails: list[str] = []
    for e in [p.get("email"), *(p.get("otherEmails") or [])[:10]]:
        c = clean_email(e)
        if c and c not in emails:
            emails.append(c)
    return PrimaPerson(
        id=str(p["id"])[:120],
        name=" ".join(str(p.get("name") or "").split())[:120],
        emails=tuple(emails),
        job_title=" ".join(str(p.get("jobTitle") or "").split())[:120],
        company_id=str(p.get("companyId") or "")[:120],
        staff_no=str(p.get("staffNo") or "")[:40],
        department=" ".join(str(p.get("department") or "").split())[:120],
    )


async def read_person(
    db: AsyncSession, workspace_id: str, user_id: str, person_id: str, client_ip: str = ""
) -> PrimaPerson:
    """The person, as Prima shows them to `user_id` (their Prima record and walls), or
    PrimaError (the office's refusal) / PersonRefused (Prima's)."""
    if not PERSON_ID.match(person_id):
        raise PrimaError(400, Msg("That is not a Prima person."))
    ans = await client.call(
        db,
        workspace_id=workspace_id,
        user_id=user_id,
        method="GET",
        path=f"api/people/{quote(person_id, safe='')}",
        client_ip=client_ip,
    )
    if ans.status != 200:
        message = ""
        try:
            data = ans.json()
            message = str(data.get("message") or "") if isinstance(data, dict) else ""
        except ValueError:
            pass
        status = ans.status if 400 <= ans.status < 500 else 503
        raise PersonRefused(status, message[:300])
    try:
        person = parse_person(ans.json())
    except ValueError:
        person = None
    if person is None or person.id != person_id:
        raise PersonRefused(503, "")
    return person


async def _members(db: AsyncSession, workspace_id: str) -> list[Membership]:
    """Every member here (switched-off accounts too: adding them again is refused anyway)."""
    return list(
        (
            await db.scalars(
                select(Membership)
                .join(User, User.id == Membership.user_id)
                .where(Membership.workspace_id == workspace_id)
                .order_by(User.name, Membership.user_id)
            )
        ).all()
    )


async def find(
    db: AsyncSession,
    workspace_id: str,
    person: PrimaPerson,
    records: list[client.StaffRecord],
) -> Match:
    """The member this Prima person is (module docstring), with `records` Prima's staff list
    (client.staff(): its accounts, each with the person it belongs to)."""
    members = await _members(db, workspace_id)
    links = {
        lk.user_id: lk.prima_user_id
        for lk in (
            await db.scalars(select(PrimaLink).where(PrimaLink.workspace_id == workspace_id))
        ).all()
    }
    person_of = {r.id: r.person_id for r in records if r.person_id}
    linked_to = {uid: person_of.get(pid) for uid, pid in links.items()}

    # 1. Their Prima link names this person (only one member: never a guess).
    hits = [m for m in members if linked_to.get(m.user_id) == person.id]
    if len(hits) == 1:
        return Match(hits[0], "linked")
    # 2. Their sign-in email is one of the person's work emails.
    emails = set(person.emails)
    hits = [m for m in members if (m.user.email or "").lower() in emails]
    if len(hits) == 1:
        return Match(hits[0], "email")
    # 3. The only member of that name, not linked to another Prima person.
    key = name_key(person.name)
    if not key:
        return Match()
    same = [m for m in members if name_key(m.user.name or "") == key]
    elsewhere = [m.user_id for m in same if linked_to.get(m.user_id) not in (None, person.id)]
    free = [m for m in same if m.user_id not in elsewhere]
    if len(same) == 1 and len(free) == 1:
        return Match(free[0], "name")
    return Match(same_name=len(same) if len(same) > 1 else 0, linked_elsewhere=elsewhere)


async def branches_for(db: AsyncSession, workspace_id: str, company_id: str) -> list[Branch]:
    """The office branches the owner said are this Prima company (Workspace.settings
    "prima_companies", branch -> company), in name order. Several may be one company."""
    mapped = client.company_map(await db.get(Workspace, workspace_id))
    ids = [b for b, c in mapped.items() if c == company_id and company_id]
    if not ids:
        return []
    return list(
        (
            await db.scalars(
                select(Branch)
                .where(Branch.workspace_id == workspace_id, Branch.id.in_(ids))
                .order_by(Branch.name)
            )
        ).all()
    )


async def all_branches(db: AsyncSession, workspace_id: str) -> list[Branch]:
    return list(
        (
            await db.scalars(
                select(Branch).where(Branch.workspace_id == workspace_id).order_by(Branch.name)
            )
        ).all()
    )


async def departments_of(db: AsyncSession, branch_ids: list[str]) -> list[Department]:
    if not branch_ids:
        return []
    return list(
        (
            await db.scalars(
                select(Department)
                .where(Department.branch_id.in_(branch_ids))
                .order_by(Department.position, Department.name)
            )
        ).all()
    )


def department_guess(depts: list[Department], prima_department: str) -> str | None:
    """The office department of the person's Prima department, when exactly one has its name."""
    key = people.name_key(prima_department)
    if not key:
        return None
    hits = [d.id for d in depts if people.name_key(d.name) == key]
    return hits[0] if len(hits) == 1 else None
