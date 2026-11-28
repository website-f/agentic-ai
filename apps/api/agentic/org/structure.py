"""P145: the group structure (units and positions) each workspace starts with.

The owner (27 Nov 2026): "Roles come from DIRECTOR OFFICE GORVERNANCE.pdf and GOVERNMENT
OPERATION.pdf ... The org chart must be fully flexible; I can add a new role when it's not listed."

structure_seed.json (next to this file) holds what was read from the two PDFs (no personal
data), the office role each position usually has (role_map), the companies and central
departments the PDFs leave out (standing_*), and which office company or PWVSB department a unit
stands for (links). `ensure` creates what is missing, matched by key, so it can run again any
time: at the API's start for every workspace that has no structure yet (run_at_startup), on the
first read of a workspace that has none, and when an owner asks for the defaults back
(POST /api/org/structure/seed). It never changes a unit or position that is already there, apart
from filling a company or department link that was still empty.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.db import SessionLocal
from ..knowledge import library_units
from ..models import Branch, Department, Workspace
from .structure_models import UNIT_KINDS, OrgPosition, OrgUnit

log = logging.getLogger(__name__)

SEED_PATH = Path(__file__).with_name("structure_seed.json")
# Office roles a position may carry by default: anything but owner.
DEFAULT_ROLES = (
    "admin", "it_support", "management", "hr", "branch_manager", "group_hod", "hod",
    "supervisor", "staff", "operator", "approver", "viewer",
)  # fmt: skip


@lru_cache(maxsize=1)
def seed_data() -> dict[str, Any]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def _short(name: str) -> str:
    """The PDFs' long unit names without their trailing note in brackets."""
    return re.sub(r"\s*\([^()]*\)\s*$", "", name).strip() or name


def _title_case(s: str) -> str:
    small = {"dan", "&", "/"}
    return " ".join(w if w in small else w[:1].upper() + w[1:].lower() for w in s.split())


@dataclass
class SeedUnit:
    key: str
    name: str
    name_ms: str | None
    parent: str | None
    kind: str
    sort: int


@dataclass
class SeedPosition:
    key: str
    title: str
    title_ms: str | None
    unit: str
    reports_to: str | None
    level: int
    default_role: str | None
    headcount: int | None
    duties: str | None
    aliases: list[str] = field(default_factory=list)
    sort: int = 0


def seed_units() -> list[SeedUnit]:
    d = seed_data()
    names, ms, kinds = d.get("unit_name", {}), d.get("unit_ms", {}), d.get("unit_kind", {})
    out: list[SeedUnit] = []
    for i, u in enumerate([*d["units"], *d.get("standing_units", [])]):
        key = u["key"]
        kind = kinds.get(key) or kinds.get(u.get("kind", "")) or u.get("kind") or "unit"
        out.append(
            SeedUnit(
                key=key,
                name=names.get(key) or _short(u.get("name_en") or key),
                name_ms=ms.get(key) or u.get("name_ms"),
                parent=u.get("parent"),
                kind=kind if kind in UNIT_KINDS else "unit",
                sort=i,
            )
        )
    return out


def seed_positions() -> list[SeedPosition]:
    d = seed_data()
    roles = d.get("role_map", {})
    out: list[SeedPosition] = []
    for i, p in enumerate([*d["positions"], *d.get("standing_positions", [])]):
        suggested = [s for s in p.get("ms_suggested") or [] if isinstance(s, str)]
        # The PDFs have no Malay titles: our suggested Malay one, else the seed's own.
        title_ms = _title_case(suggested[0]) if suggested else p.get("title_ms")
        aliases: list[str] = []
        for a in [*(p.get("aliases") or []), *suggested]:
            if isinstance(a, str) and a.strip() and a not in aliases:
                aliases.append(a.strip())
        role = roles.get(p["key"])
        hc = p.get("headcount")
        out.append(
            SeedPosition(
                key=p["key"],
                title=p.get("title_en") or p["key"],
                title_ms=title_ms,
                unit=p["unit"],
                reports_to=p.get("reports_to"),
                level=int(p.get("level") or 0),
                default_role=role if role in DEFAULT_ROLES else None,
                headcount=int(hc) if isinstance(hc, int) else None,
                duties=p.get("duties"),
                aliases=aliases[:30],
                sort=i,
            )
        )
    return out


def default_role_of(key: str) -> str | None:
    role = seed_data().get("role_map", {}).get(key)
    return role if role in DEFAULT_ROLES else None


# ---------------------------------------------------------------- links to office places


class _Places:
    def __init__(self, branches: list[Branch], depts: list[Department], prima_ids: dict):
        self.branches = branches
        self.depts = depts
        groups = [b for b in branches if library_units._is_group(b, str(prima_ids.get(b.id) or ""))]
        self.group = sorted(groups, key=lambda b: (len(b.name), b.id))[0] if groups else None

    def branch(self, marks: str | list[str]) -> str | None:
        if marks == "group":
            return self.group.id if self.group else None
        for b in self.branches:
            name = b.name.lower()
            if any(m in name for m in marks):
                return b.id
        return None

    def department(self, mirror_key: str) -> tuple[str | None, str | None]:
        if self.group is None:
            return None, None
        wanted = library_units._wanted(mirror_key)
        for d in self.depts:
            if d.branch_id == self.group.id and library_units._matches(d, wanted):
                return self.group.id, d.id
        return self.group.id, None

    @classmethod
    async def load(cls, db: AsyncSession, ws: str) -> _Places:
        branches = list(
            (
                await db.scalars(
                    select(Branch).where(Branch.workspace_id == ws).order_by(Branch.name)
                )
            ).all()
        )
        depts = list(
            (
                await db.scalars(
                    select(Department)
                    .where(Department.workspace_id == ws)
                    .order_by(Department.position, Department.name)
                )
            ).all()
        )
        settings = await db.scalar(select(Workspace.settings).where(Workspace.id == ws))
        return cls(branches, depts, dict((settings or {}).get("prima_companies") or {}))


def _link(u: OrgUnit, places: _Places) -> bool:
    """Fill an empty company or department link from the seed's links. True when changed."""
    spec = seed_data().get("links", {}).get(u.key)
    if not spec:
        return False
    changed = False
    if "branch" in spec and u.branch_id is None:
        bid = places.branch(spec["branch"])
        if bid:
            u.branch_id, changed = bid, True
    if "department" in spec and u.department_id is None:
        bid, did = places.department(spec["department"])
        if did:
            u.department_id, changed = did, True
            if u.branch_id is None:
                u.branch_id = bid
    return changed


# ---------------------------------------------------------------- seeding


@dataclass
class Seeded:
    units: int = 0
    positions: int = 0
    linked: int = 0


async def ensure(db: AsyncSession, ws: str, *, only_if_empty: bool = False) -> Seeded:
    """Create the seed's units and positions this workspace is missing (by key) and fill empty
    links. With only_if_empty: nothing at all once the workspace has any unit. The caller
    commits."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"org-structure:{ws}"}
    )
    out = Seeded()
    have = await db.scalar(
        select(func.count()).select_from(OrgUnit).where(OrgUnit.workspace_id == ws)
    )
    if only_if_empty and have:
        return out
    units = {
        u.key: u for u in (await db.scalars(select(OrgUnit).where(OrgUnit.workspace_id == ws)))
    }
    places = await _Places.load(db, ws)
    new_keys: set[str] = set()
    for s in seed_units():
        u = units.get(s.key)
        if u is None:
            u = OrgUnit(
                workspace_id=ws,
                key=s.key,
                name=s.name[:160],
                name_ms=(s.name_ms or None) and s.name_ms[:160],
                kind=s.kind,
                sort=s.sort,
                custom=False,
            )
            db.add(u)
            units[s.key] = u
            new_keys.add(s.key)
            out.units += 1
        if _link(u, places):
            out.linked += 1
    await db.flush()
    # A new unit takes its parent once every unit has its id; existing ones keep theirs.
    for s in seed_units():
        if s.key in new_keys and s.parent and s.parent in units:
            units[s.key].parent_id = units[s.parent].id
    positions = {
        p.key: p
        for p in (await db.scalars(select(OrgPosition).where(OrgPosition.workspace_id == ws)))
    }
    made: list[tuple[OrgPosition, SeedPosition]] = []
    for s in seed_positions():
        if s.key in positions or s.unit not in units:
            continue
        p = OrgPosition(
            workspace_id=ws,
            key=s.key,
            title=s.title[:160],
            title_ms=(s.title_ms or None) and s.title_ms[:160],
            unit_id=units[s.unit].id,
            level=s.level,
            default_role=s.default_role,
            headcount=s.headcount,
            duties=s.duties,
            aliases=s.aliases,
            sort=s.sort,
            custom=False,
        )
        db.add(p)
        positions[s.key] = p
        made.append((p, s))
        out.positions += 1
    await db.flush()
    for p, s in made:
        if s.reports_to and s.reports_to in positions:
            p.reports_to_id = positions[s.reports_to].id
    await db.flush()
    return out


# ---------------------------------------------------------------- P146: every office company


def _plain(s: str | None) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split())


@dataclass
class CompaniesDone:
    companies: int = 0
    departments: int = 0
    linked: int = 0


async def ensure_companies(db: AsyncSession, ws: str) -> CompaniesDone:
    """P146 (the owner, 28 Nov 2026: "In the org chart I can set and sort by department, but in
    Companies why not the same?"): every office company (branch) has a unit of kind "company"
    and each of its departments a unit under it, so the Companies view edits the same tree.

    Additive and idempotent: a company is found by a unit already standing for it (branch_id and
    no department), else by an unlinked company unit with the same name (its empty link is
    filled), else one is made (key office_co_<branch id>) under the seed's Group companies. A
    department likewise (key office_dept_<department id>), under its company's unit; the seed's
    own department links are filled first so PWVSB's departments keep their seeded units. Nothing
    is renamed, moved or removed. The caller commits."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"org-structure:{ws}"}
    )
    out = CompaniesDone()
    places = await _Places.load(db, ws)
    if not places.branches:
        return out
    units = list((await db.scalars(select(OrgUnit).where(OrgUnit.workspace_id == ws))).all())
    # The seed's empty links first (a department added since gets its seeded unit, not a new one).
    for u in units:
        if (u.branch_id is None or u.department_id is None) and _link(u, places):
            out.linked += 1
    by_key = {u.key: u for u in units}
    parent = by_key.get("group_companies")
    last = max((u.sort for u in units), default=0)
    company_of: dict[str, OrgUnit] = {}
    for u in sorted(units, key=lambda x: (x.kind != "company", x.sort, x.key)):
        if u.branch_id and u.department_id is None:
            company_of.setdefault(u.branch_id, u)
    for b in places.branches:
        if b.id in company_of:
            continue
        same = next(
            (
                u
                for u in units
                if u.kind == "company"
                and u.branch_id is None
                and u.department_id is None
                and _plain(u.name) == _plain(b.name)
                and u.key not in ("pwvsb_group", "group_companies")
            ),
            None,
        )
        if same is not None:
            same.branch_id = b.id
            company_of[b.id] = same
            out.linked += 1
            continue
        key = f"office_co_{b.id}"[:80]
        if key in by_key:  # its link was cleared by hand: leave it as it is
            company_of[b.id] = by_key[key]
            continue
        last += 1
        u = OrgUnit(
            workspace_id=ws,
            key=key,
            name=b.name[:160],
            parent_id=parent.id if parent else None,
            kind="company",
            branch_id=b.id,
            sort=last,
            custom=False,
        )
        db.add(u)
        units.append(u)
        by_key[key] = u
        company_of[b.id] = u
        out.companies += 1
    await db.flush()
    has_dept = {u.department_id for u in units if u.department_id}
    for d in places.depts:
        if d.id in has_dept or d.branch_id not in company_of:
            continue
        co = company_of[d.branch_id]
        same = next(
            (
                u
                for u in units
                if u.parent_id == co.id
                and u.department_id is None
                and u.kind == "department"
                and _plain(u.name) == _plain(d.name)
            ),
            None,
        )
        if same is not None:
            same.department_id = d.id
            same.branch_id = same.branch_id or d.branch_id
            has_dept.add(d.id)
            out.linked += 1
            continue
        key = f"office_dept_{d.id}"[:80]
        if key in by_key:
            continue
        last += 1
        u = OrgUnit(
            workspace_id=ws,
            key=key,
            name=d.name[:160],
            parent_id=co.id,
            kind="department",
            branch_id=d.branch_id,
            department_id=d.id,
            sort=last,
            custom=False,
        )
        db.add(u)
        units.append(u)
        by_key[key] = u
        has_dept.add(d.id)
        out.departments += 1
    await db.flush()
    return out


async def run_at_startup() -> None:
    """At the API's start: every workspace without a structure gets the seed. Never fails."""
    try:
        async with SessionLocal() as db:
            ids = list((await db.scalars(select(Workspace.id))).all())
        for ws in ids:
            async with SessionLocal() as db:
                done = await ensure(db, ws, only_if_empty=True)
                await db.commit()
                if done.units:
                    log.info("org structure: seeded %s units, %s positions", done.units, ws)
    except Exception:  # noqa: BLE001
        log.warning("org structure: start-up seed failed", exc_info=True)
