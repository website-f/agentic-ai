"""P145: the group structure (units, positions) and who holds which position.

The owner (27 Nov 2026): "Full revamp of the org chart, organization and members setup. Roles
come from DIRECTOR OFFICE GORVERNANCE.pdf and GOVERNMENT OPERATION.pdf ... If a member's role
can't be identified, I must be able to sort them manually very easily. The org chart must be
fully flexible; I can add a new role when it's not listed."

Contract (apps/prima/apps/web/src/api/structure.ts):
  GET    /api/org/structure                     everyone signed in (members: their own scope)
  POST   /api/org/structure/seed                owners: put back the defaults that are missing
  POST   /api/org/structure/units               PATCH/DELETE /api/org/structure/units/{id}
  POST   /api/org/structure/positions           PATCH/DELETE /api/org/structure/positions/{id}
  PUT    /api/members/{user_id}/position        one member's position (and job title)
  POST   /api/org/structure/assign              many members to one position (or none)
Changes: whoever has org.manage or members.manage, and the head of HR. Every change is audited.
"""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...i18n import Msg, render
from ...knowledge import library_units
from ...models import (
    Branch,
    Department,
    DepartmentHead,
    Membership,
    OrgPosition,
    OrgUnit,
    PrimaLink,
)
from ...org import structure as seed
from ...org.structure_models import UNIT_KINDS
from ...services import audit
from ...services.text import slugify
from ..deps import Principal, api_error, require
from .members import _member_in_scope, _names, clean_title

router = APIRouter(tags=["org-structure"])

UnitKind = Literal[
    "governance", "office", "department", "unit", "division", "region", "company", "team"
]
DefaultRole = Literal[
    "admin", "it_support", "management", "hr", "branch_manager", "group_hod", "hod",
    "supervisor", "staff", "operator", "approver", "viewer",
]  # fmt: skip
assert set(UnitKind.__args__) == set(UNIT_KINDS)  # type: ignore[attr-defined]
assert set(DefaultRole.__args__) == set(seed.DEFAULT_ROLES)  # type: ignore[attr-defined]

# ---------------------------------------------------------------- shapes


class UnitOut(BaseModel):
    id: str
    key: str
    name: str
    name_ms: str | None
    parent_id: str | None
    kind: str
    branch_id: str | None
    department_id: str | None
    sort: int
    custom: bool


class PositionOut(BaseModel):
    id: str
    key: str
    title: str
    title_ms: str | None
    unit_id: str
    reports_to_id: str | None
    level: int
    default_role: str | None
    headcount: int | None
    duties: str | None
    aliases: list[str]
    sort: int
    custom: bool


class StructureMemberOut(BaseModel):
    user_id: str
    name: str
    email: str
    work_email: str | None
    role: str
    is_active: bool
    branch_id: str | None
    branch_name: str | None
    department_id: str | None
    department_name: str | None
    job_title: str | None
    position_id: str | None
    # Their Prima account (the org chart's person id), when linked.
    prima_id: str | None = None


class StructureOut(BaseModel):
    units: list[UnitOut]
    positions: list[PositionOut]
    members: list[StructureMemberOut]
    can_edit: bool


class UnitIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    name_ms: str | None = Field(default=None, max_length=160)
    parent_id: str | None = Field(default=None, max_length=40)
    kind: UnitKind = "unit"
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)


class UnitPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    name_ms: str | None = Field(default=None, max_length=160)
    parent_id: str | None = Field(default=None, max_length=40)
    kind: UnitKind | None = None
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)
    sort: int | None = Field(default=None, ge=-100_000, le=100_000)


class PositionIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    title_ms: str | None = Field(default=None, max_length=160)
    unit_id: str = Field(min_length=1, max_length=40)
    reports_to_id: str | None = Field(default=None, max_length=40)
    default_role: DefaultRole | None = None
    headcount: int | None = Field(default=None, ge=0, le=100_000)
    duties: str | None = Field(default=None, max_length=4000)


class PositionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    title_ms: str | None = Field(default=None, max_length=160)
    unit_id: str | None = Field(default=None, max_length=40)
    reports_to_id: str | None = Field(default=None, max_length=40)
    default_role: DefaultRole | None = None
    headcount: int | None = Field(default=None, ge=0, le=100_000)
    duties: str | None = Field(default=None, max_length=4000)
    sort: int | None = Field(default=None, ge=-100_000, le=100_000)


class SetPositionIn(BaseModel):
    position_id: str | None = Field(default=None, max_length=40)
    set_job_title: bool = True


class AssignIn(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=1000)
    position_id: str | None = Field(default=None, max_length=40)


class Skipped(BaseModel):
    user_id: str
    message: str


class AssignOut(BaseModel):
    done: int
    skipped: list[Skipped]


class SeedOut(BaseModel):
    units: int
    positions: int
    linked: int


# ---------------------------------------------------------------- helpers


def _unit_out(u: OrgUnit) -> UnitOut:
    return UnitOut(
        id=u.id,
        key=u.key,
        name=u.name,
        name_ms=u.name_ms,
        parent_id=u.parent_id,
        kind=u.kind,
        branch_id=u.branch_id,
        department_id=u.department_id,
        sort=u.sort,
        custom=bool(u.custom),
    )


def _position_out(p: OrgPosition) -> PositionOut:
    return PositionOut(
        id=p.id,
        key=p.key,
        title=p.title,
        title_ms=p.title_ms,
        unit_id=p.unit_id,
        reports_to_id=p.reports_to_id,
        level=p.level,
        default_role=p.default_role,
        headcount=p.headcount,
        duties=p.duties,
        aliases=[a for a in (p.aliases or []) if isinstance(a, str)],
        sort=p.sort,
        custom=bool(p.custom),
    )


def _text(s: str | None, limit: int) -> str | None:
    """One line, trimmed; empty is none."""
    if s is None:
        return None
    out = " ".join("".join(ch for ch in s if ch.isprintable()).split())[:limit]
    return out or None


def _duties(s: str | None) -> str | None:
    if s is None:
        return None
    out = "\n".join(line.rstrip() for line in s.strip().splitlines())[:4000]
    return out or None


async def _is_hr_head(db: AsyncSession, principal: Principal) -> bool:
    """The head of HR (a department matching Human Resources, as the Library's HR unit is
    found) changes the structure too."""
    me = principal.user.id
    rows = (
        await db.scalars(
            select(Department)
            .join(DepartmentHead, DepartmentHead.department_id == Department.id)
            .where(
                DepartmentHead.workspace_id == principal.workspace_id, DepartmentHead.user_id == me
            )
        )
    ).all()
    m = await db.get(Membership, (principal.workspace_id, me))
    if m is not None and m.heads_department and m.department_id:
        d = await db.get(Department, m.department_id)
        if d is not None:
            rows = [*rows, d]
    wanted = library_units._wanted("hr")
    return any(library_units._matches(d, wanted) for d in rows)


async def can_edit(db: AsyncSession, principal: Principal) -> bool:
    if can(principal.role, "org.manage") or can(principal.role, "members.manage"):
        return True
    return await _is_hr_head(db, principal)


async def _editor(db: AsyncSession, principal: Principal) -> None:
    if not await can_edit(db, principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only owners, admins, management, HR and the head of HR change the structure.",
        )


async def _unit(db: AsyncSession, ws: str, unit_id: str) -> OrgUnit:
    u = await db.get(OrgUnit, unit_id)
    if u is None or u.workspace_id != ws:
        raise api_error(status.HTTP_404_NOT_FOUND, "unit_not_found", "That unit is not here.")
    return u


async def _position(db: AsyncSession, ws: str, position_id: str) -> OrgPosition:
    p = await db.get(OrgPosition, position_id)
    if p is None or p.workspace_id != ws:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "position_not_found", "That position is not here."
        )
    return p


async def _check_place(
    db: AsyncSession, ws: str, branch_id: str | None, department_id: str | None
) -> None:
    if branch_id is not None:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != ws:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_branch",
                "Pick a company of this workspace.",
            )
    if department_id is not None:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != ws:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_department",
                "Pick a department of this workspace.",
            )


async def _unit_loop(db: AsyncSession, ws: str, unit_id: str, parent_id: str | None) -> None:
    """A unit never sits under itself or under one of its own sub-units."""
    seen: set[str] = set()
    at = parent_id
    while at is not None and at not in seen:
        if at == unit_id:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "unit_loop",
                "A unit cannot sit under itself or one of its own sub-units.",
            )
        seen.add(at)
        at = await db.scalar(
            select(OrgUnit.parent_id).where(OrgUnit.id == at, OrgUnit.workspace_id == ws)
        )


async def _reporting_loop(
    db: AsyncSession, ws: str, position_id: str, reports_to_id: str | None
) -> None:
    """A position never reports to itself, directly or through the positions under it."""
    seen: set[str] = set()
    at = reports_to_id
    while at is not None and at not in seen:
        if at == position_id:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "reporting_loop",
                "That would make a reporting loop: a position cannot report to itself or to "
                "one of the positions under it.",
            )
        seen.add(at)
        at = await db.scalar(
            select(OrgPosition.reports_to_id).where(
                OrgPosition.id == at, OrgPosition.workspace_id == ws
            )
        )


def _custom_key(prefix: str, name: str) -> str:
    return f"{prefix}_{slugify(name, prefix)[:40].replace('-', '_')}_{secrets.token_hex(3)}"


def _unit_state(u: OrgUnit) -> dict:
    return {
        "name": u.name,
        "name_ms": u.name_ms,
        "parent_id": u.parent_id,
        "kind": u.kind,
        "branch_id": u.branch_id,
        "department_id": u.department_id,
        "sort": u.sort,
    }


def _position_state(p: OrgPosition) -> dict:
    return {
        "title": p.title,
        "title_ms": p.title_ms,
        "unit_id": p.unit_id,
        "reports_to_id": p.reports_to_id,
        "default_role": p.default_role,
        "headcount": p.headcount,
        "duties": p.duties,
        "sort": p.sort,
    }


# ---------------------------------------------------------------- reading


@router.get("/api/org/structure")
async def get_structure(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> StructureOut:
    ws = principal.workspace_id
    if not await db.scalar(
        select(func.count()).select_from(OrgUnit).where(OrgUnit.workspace_id == ws)
    ):
        # A workspace made after the API started: its structure on the first read.
        await seed.ensure(db, ws, only_if_empty=True)
        await db.commit()
    units = (
        await db.scalars(
            select(OrgUnit).where(OrgUnit.workspace_id == ws).order_by(OrgUnit.sort, OrgUnit.name)
        )
    ).all()
    positions = (
        await db.scalars(
            select(OrgPosition)
            .where(OrgPosition.workspace_id == ws)
            .order_by(OrgPosition.level, OrgPosition.sort, OrgPosition.title)
        )
    ).all()
    rows = (
        await db.scalars(
            select(Membership).where(Membership.workspace_id == ws).order_by(Membership.created_at)
        )
    ).all()
    seen = [m for m in rows if _member_in_scope(principal, m)]
    names = await _names(db, ws)
    links = {
        uid: pid
        for uid, pid in (
            await db.execute(
                select(PrimaLink.user_id, PrimaLink.prima_user_id).where(
                    PrimaLink.workspace_id == ws
                )
            )
        ).all()
    }
    members = [
        StructureMemberOut(
            user_id=m.user_id,
            name=m.user.name,
            email=m.user.email,
            work_email=m.work_email,
            role=m.role,
            is_active=bool(m.user.is_active),
            branch_id=m.branch_id,
            branch_name=names.get(m.branch_id or ""),
            department_id=m.department_id,
            department_name=names.get(m.department_id or ""),
            job_title=m.job_title,
            position_id=m.position_id,
            prima_id=links.get(m.user_id),
        )
        for m in seen
    ]
    return StructureOut(
        units=[_unit_out(u) for u in units],
        positions=[_position_out(p) for p in positions],
        members=members,
        can_edit=await can_edit(db, principal),
    )


@router.post("/api/org/structure/seed")
async def seed_structure(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SeedOut:
    """Owners: put back the units and positions from the PDFs that are missing (by key) and
    link units to their companies and departments where that is still empty."""
    if not can(principal.role, "members.assign_owner"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can put the defaults back."
        )
    done = await seed.ensure(db, principal.workspace_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "org.structure_seeded",
        after={"units": done.units, "positions": done.positions, "linked": done.linked},
    )
    await db.commit()
    return SeedOut(units=done.units, positions=done.positions, linked=done.linked)


# ---------------------------------------------------------------- units


@router.post("/api/org/structure/units", status_code=status.HTTP_201_CREATED)
async def add_unit(
    body: UnitIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> UnitOut:
    await _editor(db, principal)
    ws = principal.workspace_id
    name = _text(body.name, 160)
    if not name:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "name_required", "Give it a name.")
    if body.parent_id is not None:
        await _unit(db, ws, body.parent_id)
    await _check_place(db, ws, body.branch_id, body.department_id)
    last = await db.scalar(select(func.max(OrgUnit.sort)).where(OrgUnit.workspace_id == ws))
    u = OrgUnit(
        workspace_id=ws,
        key=_custom_key("unit", name),
        name=name,
        name_ms=_text(body.name_ms, 160),
        parent_id=body.parent_id,
        kind=body.kind,
        branch_id=body.branch_id,
        department_id=body.department_id,
        sort=(last or 0) + 1,
        custom=True,
    )
    db.add(u)
    await db.flush()
    await audit.record(db, ws, principal.actor, "org.unit_added", target=u.id, after=_unit_state(u))
    await db.commit()
    return _unit_out(u)


@router.patch("/api/org/structure/units/{unit_id}")
async def update_unit(
    unit_id: str,
    body: UnitPatch,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> UnitOut:
    await _editor(db, principal)
    ws = principal.workspace_id
    u = await _unit(db, ws, unit_id)
    before = _unit_state(u)
    sent = body.model_fields_set
    if "name" in sent:
        name = _text(body.name, 160)
        if not name:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "name_required", "Give it a name."
            )
        u.name = name
    if "name_ms" in sent:
        u.name_ms = _text(body.name_ms, 160)
    if "parent_id" in sent:
        if body.parent_id is not None:
            await _unit(db, ws, body.parent_id)
        await _unit_loop(db, ws, u.id, body.parent_id)
        u.parent_id = body.parent_id
    if "kind" in sent and body.kind is not None:
        u.kind = body.kind
    if "branch_id" in sent or "department_id" in sent:
        await _check_place(
            db,
            ws,
            body.branch_id if "branch_id" in sent else None,
            body.department_id if "department_id" in sent else None,
        )
        if "branch_id" in sent:
            u.branch_id = body.branch_id
        if "department_id" in sent:
            u.department_id = body.department_id
    if "sort" in sent and body.sort is not None:
        u.sort = body.sort
    after = _unit_state(u)
    if after != before:
        await audit.record(
            db, ws, principal.actor, "org.unit_changed", target=u.id, before=before, after=after
        )
    await db.commit()
    return _unit_out(u)


@router.delete("/api/org/structure/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_unit(
    unit_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _editor(db, principal)
    ws = principal.workspace_id
    u = await _unit(db, ws, unit_id)
    if not u.custom:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "unit_standard",
            "This unit comes from the group's structure: rename it or move it, but it stays.",
        )
    subs = await db.scalar(
        select(func.count()).select_from(OrgUnit).where(OrgUnit.parent_id == u.id)
    )
    roles = await db.scalar(
        select(func.count()).select_from(OrgPosition).where(OrgPosition.unit_id == u.id)
    )
    if subs or roles:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "unit_not_empty",
            "Move or remove its sub-units and positions first.",
        )
    before = _unit_state(u)
    await db.delete(u)
    await audit.record(db, ws, principal.actor, "org.unit_removed", target=unit_id, before=before)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- positions


@router.post("/api/org/structure/positions", status_code=status.HTTP_201_CREATED)
async def add_position(
    body: PositionIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PositionOut:
    await _editor(db, principal)
    ws = principal.workspace_id
    title = _text(body.title, 160)
    if not title:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "title_required", "Give the position a title."
        )
    await _unit(db, ws, body.unit_id)
    level = 0
    if body.reports_to_id is not None:
        boss = await _position(db, ws, body.reports_to_id)
        level = boss.level + 1
    last = await db.scalar(select(func.max(OrgPosition.sort)).where(OrgPosition.workspace_id == ws))
    p = OrgPosition(
        workspace_id=ws,
        key=_custom_key("pos", title),
        title=title,
        title_ms=_text(body.title_ms, 160),
        unit_id=body.unit_id,
        reports_to_id=body.reports_to_id,
        level=level,
        default_role=body.default_role,
        headcount=body.headcount,
        duties=_duties(body.duties),
        aliases=[],
        sort=(last or 0) + 1,
        custom=True,
    )
    db.add(p)
    await db.flush()
    await audit.record(
        db, ws, principal.actor, "org.position_added", target=p.id, after=_position_state(p)
    )
    await db.commit()
    return _position_out(p)


@router.patch("/api/org/structure/positions/{position_id}")
async def update_position(
    position_id: str,
    body: PositionPatch,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PositionOut:
    await _editor(db, principal)
    ws = principal.workspace_id
    p = await _position(db, ws, position_id)
    before = _position_state(p)
    sent = body.model_fields_set
    if "title" in sent:
        title = _text(body.title, 160)
        if not title:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "title_required",
                "Give the position a title.",
            )
        p.title = title
    if "title_ms" in sent:
        p.title_ms = _text(body.title_ms, 160)
    if "unit_id" in sent and body.unit_id is not None:
        await _unit(db, ws, body.unit_id)
        p.unit_id = body.unit_id
    if "reports_to_id" in sent:
        if body.reports_to_id is not None:
            boss = await _position(db, ws, body.reports_to_id)
            await _reporting_loop(db, ws, p.id, boss.id)
            p.level = boss.level + 1
        p.reports_to_id = body.reports_to_id
    if "default_role" in sent:
        p.default_role = body.default_role
    if "headcount" in sent:
        p.headcount = body.headcount
    if "duties" in sent:
        p.duties = _duties(body.duties)
    if "sort" in sent and body.sort is not None:
        p.sort = body.sort
    after = _position_state(p)
    if after != before:
        await audit.record(
            db,
            ws,
            principal.actor,
            "org.position_changed",
            target=p.id,
            before=before,
            after=after,
        )
    await db.commit()
    return _position_out(p)


@router.delete("/api/org/structure/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_position(
    position_id: str,
    move_holders: bool = Query(default=False),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Only a position nobody holds; with move_holders its holders go to Unsorted first. The
    positions that reported to it report to its own boss from then on."""
    await _editor(db, principal)
    ws = principal.workspace_id
    p = await _position(db, ws, position_id)
    holders = list(
        (
            await db.scalars(
                select(Membership.user_id).where(
                    Membership.workspace_id == ws, Membership.position_id == p.id
                )
            )
        ).all()
    )
    if holders and not move_holders:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "position_held",
            "{n} people hold this position. Move them first, or confirm to put them in Unsorted.",
            n=len(holders),
        )
    for uid in holders:
        await db.execute(
            update(Membership)
            .where(Membership.workspace_id == ws, Membership.user_id == uid)
            .values(position_id=None)
        )
        await audit.record(
            db,
            ws,
            principal.actor,
            "member.position_changed",
            target=uid,
            before={"position_id": p.id, "title": p.title},
            after={"position_id": None},
            note="The position was removed",
        )
    await db.execute(
        update(OrgPosition)
        .where(OrgPosition.workspace_id == ws, OrgPosition.reports_to_id == p.id)
        .values(reports_to_id=p.reports_to_id)
    )
    before = _position_state(p)
    await db.delete(p)
    await audit.record(
        db, ws, principal.actor, "org.position_removed", target=position_id, before=before
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- who holds which position


async def place(
    db: AsyncSession,
    principal: Principal,
    user_id: str,
    position: OrgPosition | None,
    set_job_title: bool,
) -> bool:
    """Put one member in a position (None: back to Unsorted). The caller checked the editor
    and commits. True when something changed."""
    ws = principal.workspace_id
    m = await db.get(Membership, (ws, user_id))
    if m is None or not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    if m.role == "owner" and not can(principal.role, "members.assign_owner"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can change an owner's position."
        )
    new_id = position.id if position else None
    title = clean_title(position.title) if position and set_job_title else m.job_title
    if m.position_id == new_id and m.job_title == title:
        return False
    before = {"position_id": m.position_id, "job_title": m.job_title}
    m.position_id = new_id
    m.job_title = title
    await audit.record(
        db,
        ws,
        principal.actor,
        "member.position_changed",
        target=user_id,
        before=before,
        after={"position_id": new_id, "job_title": title},
    )
    await db.flush()
    return True


@router.put("/api/members/{user_id}/position")
async def set_member_position(
    user_id: str,
    body: SetPositionIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _editor(db, principal)
    pos = (
        await _position(db, principal.workspace_id, body.position_id) if body.position_id else None
    )
    await place(db, principal, user_id, pos, body.set_job_title)
    await db.commit()
    return {"ok": True}


@router.post("/api/org/structure/assign")
async def assign(
    body: AssignIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> AssignOut:
    """Many members to one position (or none: Unsorted), each on its own: one refused never
    undoes the others."""
    await _editor(db, principal)
    pos = (
        await _position(db, principal.workspace_id, body.position_id) if body.position_id else None
    )
    done = 0
    skipped: list[Skipped] = []
    for uid in dict.fromkeys(body.user_ids):
        try:
            async with db.begin_nested():
                await place(db, principal, uid, pos, True)
            done += 1
        except Exception as e:  # noqa: BLE001
            detail = getattr(e, "detail", None)
            message = detail.get("message") if isinstance(detail, dict) else None
            skipped.append(Skipped(user_id=uid, message=render(message or Msg("Not changed."))))
    await db.commit()
    return AssignOut(done=done, skipped=skipped)
