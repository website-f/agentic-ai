"""P109: who heads which departments (department_heads, migration 0068).

A member may head several departments, in any company of the workspace, and a department may
have several heads. memberships.heads_department follows: true while they head at least one
(the task board and older screens read it). Heading a department is a label and a line of
contact (who is told when files are uploaded for their company, org/handoffs.py); it never
widens what anyone sees: a HOD's scope stays the department they sit in (api/scope.py).

Only people who manage all members (members.manage) change it (api/routers/members.py).
"""

from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Branch, Department, Membership, User
from .models import DepartmentHead


async def heads_of(db: AsyncSession, workspace_id: str, user_ids: list[str]) -> dict[str, list]:
    """For each member: the departments they head, as (id, name, branch id, branch name),
    company then department name."""
    if not user_ids:
        return {}
    rows = await db.execute(
        select(DepartmentHead.user_id, Department.id, Department.name, Branch.id, Branch.name)
        .join(Department, Department.id == DepartmentHead.department_id)
        .join(Branch, Branch.id == Department.branch_id)
        .where(DepartmentHead.workspace_id == workspace_id, DepartmentHead.user_id.in_(user_ids))
        .order_by(Branch.name, Department.position, Department.name)
    )
    out: dict[str, list] = defaultdict(list)
    for uid, did, dname, bid, bname in rows.all():
        out[uid].append((did, dname, bid, bname))
    return dict(out)


async def headed_ids(db: AsyncSession, workspace_id: str, user_id: str) -> list[str]:
    return list(
        (
            await db.scalars(
                select(DepartmentHead.department_id).where(
                    DepartmentHead.workspace_id == workspace_id, DepartmentHead.user_id == user_id
                )
            )
        ).all()
    )


async def check_departments(db: AsyncSession, workspace_id: str, ids: list[str]) -> list[str]:
    """The ids, deduplicated, each a department of this workspace (else ValueError)."""
    want = list(dict.fromkeys(i for i in ids if i))
    if not want:
        return []
    found = set(
        (
            await db.scalars(
                select(Department.id).where(
                    Department.workspace_id == workspace_id, Department.id.in_(want)
                )
            )
        ).all()
    )
    if found != set(want):
        raise ValueError("bad_department")
    return want


async def set_heads(db: AsyncSession, m: Membership, department_ids: list[str]) -> bool:
    """Exactly these departments are headed by this member (ids already checked). Keeps
    memberships.heads_department in step. Answers whether anything changed; the caller
    audits and commits."""
    now = set(await headed_ids(db, m.workspace_id, m.user_id))
    want = set(department_ids)
    if now == want and bool(m.heads_department) == bool(want):
        return False
    gone = now - want
    if gone:
        await db.execute(
            delete(DepartmentHead).where(
                DepartmentHead.user_id == m.user_id, DepartmentHead.department_id.in_(gone)
            )
        )
    for did in sorted(want - now):
        db.add(DepartmentHead(department_id=did, user_id=m.user_id, workspace_id=m.workspace_id))
    m.heads_department = bool(want)
    await db.flush()
    return True


async def company_heads(db: AsyncSession, workspace_id: str, branch_id: str) -> list[str]:
    """The active members who head a department of this company."""
    return list(
        (
            await db.scalars(
                select(DepartmentHead.user_id)
                .join(Department, Department.id == DepartmentHead.department_id)
                .join(User, User.id == DepartmentHead.user_id)
                .join(
                    Membership,
                    (Membership.user_id == DepartmentHead.user_id)
                    & (Membership.workspace_id == workspace_id),
                )
                .where(
                    DepartmentHead.workspace_id == workspace_id,
                    Department.branch_id == branch_id,
                    User.is_active.is_(True),
                )
                .distinct()
            )
        ).all()
    )
