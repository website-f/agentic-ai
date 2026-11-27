"""P143b: the Library's units (the owner, 27 Nov 2026: "In the Library, instead of company,
add HR unit, Audit unit and Kewangan unit").

The three central units are departments of the group employer, PWVSB ("PW Venture Sdn Bhd
(PWVSB)"), as Prima's org mirror makes them (prima/mirror.py DEPARTMENT_LABEL): Human
Resources, ACT (Audit, Compliance and Transformation) and Finance. Each unit's folder space is
that department's files: the same files, folders, uploads and actions as a company folder,
narrowed to the department.

A unit is found by the mirror's key, the department's slug or its name (a department may have
been renamed in Prima's chart; the mirror keeps the slug it was made with), never by a stored
id. When the group employer has several matches, its own departments win; without a PWVSB
company, the company holding the most of the three is used. A unit missing from the workspace
is simply not offered.

Who opens a unit: exactly who reads a department's files today (api/scope.py, documents
service, knowledge/search.sees): the workspace roles (owner, admin, IT support, management,
HR...), a branch manager or group HOD of that company, and the department's own HOD,
supervisor and staff. Nothing here widens what anyone sees: inside a unit every list is still
the person's visible files (documents.service.visible_files), narrowed to the department.
"""

import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..models import Branch, Department, DocFile, Workspace

# (key, the mirror's department key, the label as the owner wrote it: Malay first).
UNITS: tuple[tuple[str, str, str], ...] = (
    ("hr", "hr", Msg("Unit HR")),
    ("audit", "audit", Msg("Unit Audit")),
    ("finance", "finance", Msg("Unit Kewangan")),
)
UNIT_KEYS = tuple(u[0] for u in UNITS)

# Other names a unit's department goes by (slugs), besides the mirror's label and key.
ALIASES: dict[str, set[str]] = {
    "hr": {"hr", "human-resources", "human-resource", "unit-hr", "sumber-manusia"},
    "audit": {"audit", "unit-audit", "act", "audit-compliance-and-transformation"},
    "finance": {"finance", "unit-kewangan", "kewangan"},
}
GROUP_MARKS = ("pwvsb", "pw venture", "pw-venture")


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:70]


def _wanted(mirror_key: str) -> set[str]:
    from ..prima.mirror import DEPARTMENT_LABEL

    label = DEPARTMENT_LABEL.get(mirror_key, "")
    out = set(ALIASES.get(mirror_key, set()))
    out.add(mirror_key.replace("_", "-"))
    if label:
        out.add(slugify(label))
    return out


def _matches(d: Department, wanted: set[str]) -> bool:
    return (d.slug or "") in wanted or slugify(d.name) in wanted


def _is_group(b: Branch, prima_id: str) -> bool:
    text = f"{b.name} {b.slug} {prima_id}".lower()
    return any(m in text for m in GROUP_MARKS)


@dataclass
class Unit:
    key: str
    label: str
    department: Department
    branch: Branch


async def find(db: AsyncSession, workspace_id: str) -> list[Unit]:
    """The units this workspace has, in order (missing ones left out)."""
    branches = {
        b.id: b
        for b in (await db.scalars(select(Branch).where(Branch.workspace_id == workspace_id)))
    }
    depts = list(
        (
            await db.scalars(
                select(Department)
                .where(Department.workspace_id == workspace_id)
                .order_by(Department.position, Department.name)
            )
        ).all()
    )
    hits: dict[str, list[Department]] = {
        key: [d for d in depts if d.branch_id in branches and _matches(d, _wanted(mk))]
        for key, mk, _ in UNITS
    }
    if not any(hits.values()):
        return []
    settings = await db.scalar(select(Workspace.settings).where(Workspace.id == workspace_id))
    prima_ids = dict((settings or {}).get("prima_companies") or {})
    groups = [bid for bid, b in branches.items() if _is_group(b, str(prima_ids.get(bid) or ""))]
    home: str | None = None
    for bid in groups:  # the group employer: the one that holds the units
        if any(d.branch_id == bid for ds in hits.values() for d in ds):
            home = bid
            break
    if home is None:  # no PWVSB here: the company holding the most of the three
        held: dict[str, int] = {}
        for ds in hits.values():
            for bid in {d.branch_id for d in ds}:
                held[bid] = held.get(bid, 0) + 1
        home = sorted(held, key=lambda b: (-held[b], branches[b].name.lower(), b))[0]
    out: list[Unit] = []
    for key, _, label in UNITS:
        d = next((x for x in hits[key] if x.branch_id == home), None)
        if d is not None:
            out.append(Unit(key=key, label=label, department=d, branch=branches[home]))
    return out


def may_open(principal: object, d: Department) -> bool:
    """Who reads a department's files today (no wider): the workspace roles, a branch manager
    or group HOD of its company, and the department's own HOD, supervisor and staff. P144: and
    whoever was given the unit (or its department) on the Members page (knowledge/grants.py)."""
    sc = principal.scope  # type: ignore[attr-defined]
    if sc.everything:
        return True
    from . import grants

    g = grants.of(principal)
    if g is not None and g.department(d.id):
        return True
    if not sc.in_branch(d.branch_id):
        return False
    if sc.kind == "branch":
        return True
    return sc.department_id == d.id


async def file_count(db: AsyncSession, principal: object, d: Department) -> int:
    """The files of the unit this person sees (the Files rules, narrowed to the department)."""
    from ..documents import service

    q = select(DocFile.id).where(
        DocFile.workspace_id == d.workspace_id,
        DocFile.branch_id == d.branch_id,
        DocFile.department_id == d.id,
    )
    q = service.visible_files(q, principal)
    return int(await db.scalar(select(func.count()).select_from(q.subquery())) or 0)
