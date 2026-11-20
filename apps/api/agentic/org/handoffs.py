"""P109: files uploaded for other companies.

A person asked (by their HOD, often through a task) to collect files that belong to other
companies uploads them from the Library: each file goes to one or more target companies, with a
title they type or one the AI writes when it reads the file. Each (file, company) pair is one
file in that company and one file_handoffs row:

1. pending: the file sits in the target company, out of its Library (not searched, not read by
   its agents, not shown to its staff). The uploader sees it under "Uploaded for others" and
   may preview it, fix its title or company, or take it back. The target company's heads of
   department are told at once (in the app, on their phone and by email): what came in and from
   whom; without heads, its branch managers; without those, the workspace's owners and admins.
2. approved: the uploader checked it. The file joins the target company's Library (restricted
   when it reads as confidential, as any Library file) and leaves the uploader's Files and
   search (documents/service.scoped); the row stays as their audit line.

Who may upload for others (the safer rule): the workspace roles that already reach every
company (owner, admin, management, HR, ...) and members an owner, admin, management, HR or their
own manager switched on ("May upload for other companies", memberships.uploads_for_others).
A task alone is not enough: anyone may give themselves a task, so it would let anyone file into
any company; the switch is explicit, audited and taken back in one click. The task that asked
is still linked to each upload when given.
"""

from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import COMPANY_ROLES, can
from ..models import Branch, Department, DocFile, Membership, User
from ..teams.branches import member_in_branches
from . import heads
from .models import DepartmentHead, FileHandoff

MAX_TARGETS = 20


async def typed_title(db: AsyncSession, file_id: str) -> str:
    """The title the uploader typed for a file uploaded for another company ("" = none)."""
    return (
        await db.scalar(select(FileHandoff.title).where(FileHandoff.file_id == file_id).limit(1))
        or ""
    )


def everywhere(principal: Any) -> bool:
    return bool(principal.scope.everything)


async def may_upload(db: AsyncSession, principal: Any) -> bool:
    if not can(principal.role, "work.write"):
        return False
    if everywhere(principal):
        return True
    m = await db.get(Membership, (principal.workspace_id, principal.user.id))
    return bool(m and m.uploads_for_others)


async def recipients(db: AsyncSession, workspace_id: str, branch_id: str) -> list[str]:
    """Who hears that files came in for a company: its heads of department; else its branch
    managers; else the workspace's owners and admins."""
    got = await heads.company_heads(db, workspace_id, branch_id)
    if got:
        return sorted(got)
    active = User.is_active.is_(True)
    bms = (
        await db.scalars(
            select(Membership.user_id)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.workspace_id == workspace_id,
                Membership.role.in_(sorted(COMPANY_ROLES)),
                member_in_branches([branch_id]),
                active,
            )
        )
    ).all()
    if bms:
        return sorted(bms)
    return sorted(
        (
            await db.scalars(
                select(Membership.user_id)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.workspace_id == workspace_id,
                    Membership.role.in_(("owner", "admin")),
                    active,
                )
            )
        ).all()
    )


def incoming_where(principal: Any) -> Any:
    """SQL on FileHandoff: what came in for the companies this person answers for."""
    ws = FileHandoff.workspace_id == principal.workspace_id
    if everywhere(principal):
        return ws
    uid = principal.user.id
    headed = (
        select(Department.branch_id)
        .join(DepartmentHead, DepartmentHead.department_id == Department.id)
        .where(DepartmentHead.workspace_id == principal.workspace_id, DepartmentHead.user_id == uid)
    )
    parts = [
        FileHandoff.target_branch_id.in_(headed),
        FileHandoff.notified.contains([uid]),
    ]
    if principal.role in COMPANY_ROLES and principal.scope.branch_ids:
        parts.append(FileHandoff.target_branch_id.in_(sorted(principal.scope.branch_ids)))
    return and_(ws, or_(*parts))


async def names(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())


async def branch_names(db: AsyncSession, workspace_id: str) -> dict[str, str]:
    return dict(
        (
            await db.execute(
                select(Branch.id, Branch.name).where(Branch.workspace_id == workspace_id)
            )
        ).all()
    )


async def file_of(db: AsyncSession, h: FileHandoff) -> DocFile | None:
    return await db.get(DocFile, h.file_id) if h.file_id else None
