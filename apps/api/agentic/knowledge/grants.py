"""P144: per-member Library grants (the owner, 27 Nov 2026: "Give the units access to Azizan B.
Abdul Rahman ... for each user, I (admin) can edit the member and have one section to give
Library access: which module or library I can give, like the units, or all companies").

A grant is extra Library access on top of what a person's role and place give, never less
(memberships.library_grants, migration 0082):
- units ("all" or some of hr, audit, finance: library_units.UNITS) and departments: that
  department's Library files, read as a member of it reads them (a restricted file only by a
  person above staff, never by staff or by an agent), and filing into it;
- companies ("all" or some): each company's shared Library files as its staff read them (never
  a restricted one), and filing into the company (no department).

Never wider: only Library files (`library`), never a held-back one, never someone's own desk
files (those are never in the Library), never someone else's private assistant's work beyond
what the Library already shows. The person's own agents (AI twin, personal agents) read the
same extra files, minus restricted ones; the rule for an agent is read in SQL from its owner's
membership, so a change applies at once.

The units' and departments' ids and their companies are worked out when the grant is saved
(`area_depts`, `area_branches`), so a request reads them from the membership it loads anyway.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, and_, exists, func, or_, select

from ..models import DocFile, KnowledgeChunk, Membership

ALL = "all"


@dataclass(frozen=True)
class Grants:
    units: tuple[str, ...] = ()  # the unit keys given (every unit found when "all")
    all_units: bool = False
    companies: frozenset[str] = frozenset()
    all_companies: bool = False
    departments: tuple[str, ...] = ()  # departments given one by one
    area_depts: frozenset[str] = frozenset()  # units + departments: department ids
    area_branches: frozenset[str] = frozenset()  # their companies

    @property
    def empty(self) -> bool:
        return not (self.all_companies or self.companies or self.area_depts)

    def company(self, branch_id: str | None) -> bool:
        """A whole company given (its shared files; filing with no department)."""
        return bool(branch_id) and (self.all_companies or branch_id in self.companies)

    def department(self, department_id: str | None) -> bool:
        return bool(department_id) and department_id in self.area_depts

    def branch(self, branch_id: str | None) -> bool:
        """Any of the company is theirs to read: the whole of it or a unit / department in it."""
        return self.company(branch_id) or (bool(branch_id) and branch_id in self.area_branches)

    def stored(self) -> dict[str, Any] | None:
        if self.empty and not self.units and not self.departments:
            return None
        return {
            "units": ALL if self.all_units else list(self.units),
            "companies": ALL if self.all_companies else sorted(self.companies),
            "departments": list(self.departments),
            "area_depts": sorted(self.area_depts),
            "area_branches": sorted(self.area_branches),
        }

    def shown(self) -> dict[str, Any]:
        """As the Members page shows and sends it back."""
        return {
            "units": ALL if self.all_units else list(self.units),
            "companies": ALL if self.all_companies else sorted(self.companies),
            "departments": list(self.departments),
        }


def _ids(v: Any) -> list[str]:
    return [str(x) for x in v if isinstance(x, str) and x] if isinstance(v, list) else []


def parse(raw: Any) -> Grants | None:
    """The membership's column as Grants (None: no grant)."""
    if not isinstance(raw, dict):
        return None
    units, companies = raw.get("units"), raw.get("companies")
    g = Grants(
        units=tuple(_ids(units)),
        all_units=units == ALL,
        companies=frozenset(_ids(companies)),
        all_companies=companies == ALL,
        departments=tuple(_ids(raw.get("departments"))),
        area_depts=frozenset(_ids(raw.get("area_depts"))),
        area_branches=frozenset(_ids(raw.get("area_branches"))),
    )
    return None if g.empty and not g.units and not g.departments else g


def of(principal: Any) -> Grants | None:
    """A signed-in person's grants (loaded with their session; none for the workspace roles,
    who read everything already)."""
    g = getattr(principal, "library_grants", None)
    if g is None or g.empty or principal.scope.everything:
        return None
    return g


def restricted_ok(principal: Any) -> bool:
    """A restricted file of a granted department: as for its own people, never for staff."""
    return principal.scope.kind != "own"


# ---------------------------------------------------------------- SQL


def files_where(g: Grants | None, restricted: bool) -> ColumnElement[bool] | None:
    """SQL on DocFile: the extra files a grant opens (None: none)."""
    if g is None or g.empty:
        return None
    parts: list[ColumnElement[bool]] = []
    open_ = DocFile.restricted.is_(False)
    if g.all_companies:
        parts.append(and_(DocFile.branch_id.is_not(None), open_))
    elif g.companies:
        parts.append(and_(DocFile.branch_id.in_(sorted(g.companies)), open_))
    if g.area_depts:
        dept = DocFile.department_id.in_(sorted(g.area_depts))
        parts.append(dept if restricted else and_(dept, open_))
    return and_(DocFile.library.is_(True), DocFile.quarantined.is_(False), or_(*parts))


def person_files(principal: Any) -> ColumnElement[bool] | None:
    """SQL on DocFile: the extra files this person reads (visible_files ORs it in)."""
    g = of(principal)
    return files_where(g, restricted_ok(principal)) if g is not None else None


def owner_files(workspace_id: str, owner_user_id: str | None) -> ColumnElement[bool] | None:
    """SQL on DocFile: the extra files an agent reads because its owner was given them (read
    from the owner's membership in the same query; never a restricted file)."""
    if not owner_user_id:
        return None
    col = Membership.library_grants
    who = (Membership.workspace_id == workspace_id, Membership.user_id == owner_user_id)

    def listed(key: str) -> Any:  # the ids of an array field, once per query (not per row)
        return select(func.jsonb_array_elements_text(col[key])).where(
            *who, func.jsonb_typeof(col[key]) == "array"
        )

    every = exists(select(Membership.user_id).where(*who, col["companies"].astext == ALL))
    granted = or_(
        and_(every, DocFile.branch_id.is_not(None)),
        DocFile.branch_id.in_(listed("companies")),
        DocFile.department_id.in_(listed("area_depts")),
    )
    return and_(
        DocFile.library.is_(True),
        DocFile.quarantined.is_(False),
        DocFile.restricted.is_(False),
        granted,
    )


def chunks_where(
    workspace_id: str, g: Grants | None, restricted: bool, owner_user_id: str | None = None
) -> ColumnElement[bool] | None:
    """SQL on KnowledgeChunk (library search, recall): the passages of the extra files, for a
    person (`g`) or an agent's owner (`owner_user_id`)."""
    cond = files_where(g, restricted) if g is not None else owner_files(workspace_id, owner_user_id)
    if cond is None:
        return None
    files = select(DocFile.id).where(DocFile.workspace_id == workspace_id, cond)
    return and_(KnowledgeChunk.source_kind == "file", KnowledgeChunk.source_id.in_(files))


# ---------------------------------------------------------------- Python


def file_ok(g: Grants | None, restricted: bool, f: DocFile) -> bool:
    """files_where for one loaded file."""
    if g is None or g.empty or not f.library or f.quarantined:
        return False
    if g.department(f.department_id) and (restricted or not f.restricted):
        return True
    return g.company(f.branch_id) and not f.restricted


def may_file(principal: Any, branch_id: str | None, department_id: str | None) -> bool:
    """May put a file there because of a grant: into a granted unit / department, or into a
    granted company with no department."""
    g = of(principal)
    if g is None or not branch_id:
        return False
    if department_id:
        return g.department(department_id) and branch_id in g.area_branches
    return g.company(branch_id)


def reads_branch(principal: Any, branch_id: str | None) -> bool:
    g = of(principal)
    return g is not None and g.branch(branch_id)
