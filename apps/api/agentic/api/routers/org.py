"""Branches (one per company) and their departments."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Branch, Department
from ...services import audit
from ...services.text import slugify
from ..deps import Principal, api_error, require
from ..schemas import (
    BranchCreateIn,
    BranchOut,
    BranchUpdateIn,
    DepartmentCreateIn,
    DepartmentOut,
    DepartmentUpdateIn,
)

router = APIRouter(prefix="/api", tags=["organization"])

DEFAULT_DEPARTMENTS = ("Management", "Finance", "Research", "Operations", "Data", "Writing")


def _dept_out(d: Department) -> DepartmentOut:
    return DepartmentOut(
        id=d.id, branch_id=d.branch_id, name=d.name, slug=d.slug, position=d.position
    )


def _branch_out(b: Branch) -> BranchOut:
    return BranchOut(
        id=b.id,
        name=b.name,
        slug=b.slug,
        color=b.color,
        isolated=b.isolated,
        created_at=b.created_at,
        departments=[_dept_out(d) for d in b.departments],
    )


async def _branch(db: AsyncSession, workspace_id: str, branch_id: str) -> Branch:
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "branch_not_found", "That branch is not here.")
    return b


async def _reload(db: AsyncSession, branch_id: str) -> Branch:
    """Fresh load after commit, so server defaults and the department list are populated
    eagerly (async sessions cannot lazy-load on attribute access)."""
    b = await db.scalar(
        select(Branch).where(Branch.id == branch_id).execution_options(populate_existing=True)
    )
    assert b is not None
    return b


async def _department(db: AsyncSession, workspace_id: str, dept_id: str) -> Department:
    d = await db.get(Department, dept_id)
    if d is None or d.workspace_id != workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "department_not_found", "That department is not here."
        )
    return d


async def _unique_slug(
    db: AsyncSession, model, scope_col, scope_val: str, name: str, fallback: str
) -> str:
    base = slugify(name, fallback)
    slug, n = base, 2
    while await db.scalar(
        select(func.count()).select_from(model).where(scope_col == scope_val, model.slug == slug)
    ):
        slug, n = f"{base}-{n}", n + 1
    return slug


@router.get("/branches")
async def list_branches(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[BranchOut]:
    rows = (
        await db.scalars(
            select(Branch)
            .where(Branch.workspace_id == principal.workspace_id)
            .order_by(Branch.created_at)
        )
    ).all()
    return [_branch_out(b) for b in rows]


@router.post("/branches", status_code=status.HTTP_201_CREATED)
async def create_branch(
    body: BranchCreateIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> BranchOut:
    name = body.name.strip()
    slug = await _unique_slug(
        db, Branch, Branch.workspace_id, principal.workspace_id, name, "branch"
    )
    b = Branch(
        workspace_id=principal.workspace_id,
        name=name,
        slug=slug,
        color=body.color,
        isolated=body.isolated,
    )
    db.add(b)
    await db.flush()
    seeded = DEFAULT_DEPARTMENTS if body.seed_departments else ()
    db.add_all(
        Department(
            workspace_id=principal.workspace_id, branch_id=b.id, name=n, slug=slugify(n), position=i
        )
        for i, n in enumerate(seeded)
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "branch.created",
        target=b.id,
        after={"name": name, "departments": len(seeded)},
    )
    await db.commit()
    return _branch_out(await _reload(db, b.id))


@router.patch("/branches/{branch_id}")
async def update_branch(
    branch_id: str,
    body: BranchUpdateIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> BranchOut:
    b = await _branch(db, principal.workspace_id, branch_id)
    before = {"name": b.name, "color": b.color, "isolated": b.isolated}
    if body.name is not None:
        b.name = body.name.strip()
    if body.color is not None:
        b.color = body.color
    if body.isolated is not None:
        b.isolated = body.isolated
    after = {"name": b.name, "color": b.color, "isolated": b.isolated}
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "branch.updated",
        target=b.id,
        before=before,
        after=after,
    )
    await db.commit()
    return _branch_out(await _reload(db, b.id))


@router.delete("/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch(
    branch_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    b = await _branch(db, principal.workspace_id, branch_id)
    before = {"name": b.name, "departments": len(b.departments)}
    await db.delete(b)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "branch.deleted",
        target=branch_id,
        before=before,
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/branches/{branch_id}/departments", status_code=status.HTTP_201_CREATED)
async def create_department(
    branch_id: str,
    body: DepartmentCreateIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> DepartmentOut:
    b = await _branch(db, principal.workspace_id, branch_id)
    name = body.name.strip()
    slug = await _unique_slug(db, Department, Department.branch_id, b.id, name, "department")
    position = (max((d.position for d in b.departments), default=-1)) + 1
    d = Department(
        workspace_id=principal.workspace_id, branch_id=b.id, name=name, slug=slug, position=position
    )
    db.add(d)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "department.created",
        target=d.id,
        after={"name": name, "branch": b.name},
    )
    try:
        await db.commit()
    except IntegrityError as e:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "department_exists",
            f"{b.name} already has a department called {name}.",
        ) from e
    return _dept_out(d)


@router.patch("/departments/{dept_id}")
async def update_department(
    dept_id: str,
    body: DepartmentUpdateIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> DepartmentOut:
    d = await _department(db, principal.workspace_id, dept_id)
    before = {"name": d.name, "position": d.position}
    if body.name is not None:
        d.name = body.name.strip()
    if body.position is not None:
        d.position = body.position
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "department.updated",
        target=d.id,
        before=before,
        after={"name": d.name, "position": d.position},
    )
    await db.commit()
    return _dept_out(d)


@router.delete("/departments/{dept_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_department(
    dept_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    d = await _department(db, principal.workspace_id, dept_id)
    before = {"name": d.name, "branch_id": d.branch_id}
    await db.delete(d)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "department.deleted",
        target=dept_id,
        before=before,
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
