from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import SCOPED_ROLES, can, hash_password, temp_password
from ...i18n import Msg
from ...i18n.labels import role_label
from ...models import Agent, AuthSession, Branch, Department, Membership, User
from ...services import audit
from ..deps import Principal, api_error, current_principal, require
from ..schemas import (
    MemberCreateIn,
    MemberCreateOut,
    MemberOut,
    MemberUpdateIn,
    TempPasswordOut,
)

router = APIRouter(prefix="/api/members", tags=["members"])


# P9: what a branch manager or HOD may hand out to their own people ("team.manage").
TEAM_ROLES = {"branch_manager": {"hod", "supervisor", "staff"}, "hod": {"supervisor", "staff"}}


def _out(
    m: Membership,
    names: dict[str, str] | None = None,
    agents: dict[str, int] | None = None,
) -> MemberOut:
    u = m.user
    names = names or {}
    return MemberOut(
        branch_id=m.branch_id,
        branch_name=names.get(m.branch_id or ""),
        department_id=m.department_id,
        department_name=names.get(m.department_id or ""),
        agents=(agents or {}).get(u.id, 0),
        user_id=u.id,
        email=u.email,
        name=u.name,
        role=m.role,  # type: ignore[arg-type]
        is_active=u.is_active,
        must_change_password=u.must_change_password,
        last_login_at=u.last_login_at,
        joined_at=m.created_at,
    )


async def _membership(db: AsyncSession, workspace_id: str, user_id: str) -> Membership:
    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    return m


async def _owner_count(db: AsyncSession, workspace_id: str) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.workspace_id == workspace_id, Membership.role == "owner")
        )
        or 0
    )


def _check_can_touch(actor: Principal, target_role: str, new_role: str | None = None) -> None:
    """Only owners may grant, change or remove the owner role. A branch manager or HOD
    (team.manage) may only touch the roles below them."""
    touches_owner = target_role == "owner" or new_role == "owner"
    if touches_owner and not can(actor.role, "members.assign_owner"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can change owner access."
        )
    if not can(actor.role, "members.manage"):
        allowed = TEAM_ROLES.get(actor.role, set())
        if target_role not in allowed or (new_role is not None and new_role not in allowed):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "You can add and change only {roles} members.",
                roles=Msg(
                    ", ".join("{" + r + "}" for r in sorted(allowed)),
                    **{r: role_label(r) for r in allowed},
                ),
            )


def people_manager():
    async def checker(principal: Principal = Depends(current_principal)) -> Principal:
        if not (can(principal.role, "members.manage") or can(principal.role, "team.manage")):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "Your role ({role}) cannot manage members.",
                role=role_label(principal.role),
            )
        return principal

    return checker


async def _placement(
    db: AsyncSession,
    principal: Principal,
    role: str,
    branch_id: str | None,
    department_id: str | None,
) -> tuple[str | None, str | None]:
    """Check (and complete) where a scoped member sits. Workspace roles sit nowhere."""
    if role not in SCOPED_ROLES:
        return None, None
    if department_id:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department from here."
            )
        branch_id = d.branch_id
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a branch from here.")
    if role == "branch_manager" and not branch_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "branch_required",
            "A branch manager needs a branch.",
        )
    if role in ("hod", "supervisor") and not department_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "department_required",
            "A head of department or supervisor needs a department.",
        )
    if role == "staff" and not branch_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "branch_required",
            "Staff need a branch (their own agents are placed there).",
        )
    sc = principal.scope
    if not sc.everything and (
        (sc.kind == "branch" and branch_id != sc.branch_id)
        or (sc.kind == "department" and department_id != sc.department_id)
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "outside_scope",
            "You can only add people to {where}.",
            where=sc.label,
        )
    return branch_id, department_id


def _member_in_scope(principal: Principal, m: Membership) -> bool:
    sc = principal.scope
    if sc.everything or m.user_id == principal.user.id:
        return True
    if sc.kind == "branch":
        return m.branch_id == sc.branch_id
    if sc.kind == "department":
        return m.department_id == sc.department_id
    return False


async def _names(db: AsyncSession, ws: str) -> dict[str, str]:
    out = {
        i: n
        for i, n in (
            await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws))
        ).all()
    }
    out.update(
        {
            i: n
            for i, n in (
                await db.execute(
                    select(Department.id, Department.name).where(Department.workspace_id == ws)
                )
            ).all()
        }
    )
    return out


@router.get("")
async def list_members(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[MemberOut]:
    rows = (
        await db.scalars(
            select(Membership)
            .where(Membership.workspace_id == principal.workspace_id)
            .order_by(Membership.created_at)
        )
    ).all()
    agents: dict[str, int] = {
        uid: n
        for uid, n in (
            (
                await db.execute(
                    select(Agent.owner_user_id, func.count())
                    .where(
                        Agent.workspace_id == principal.workspace_id,
                        Agent.owner_user_id.is_not(None),
                        Agent.status != "retired",
                        Agent.clone_of.is_(None),
                    )
                    .group_by(Agent.owner_user_id)
                )
            ).all()
        )
        if uid
    }
    names = await _names(db, principal.workspace_id)
    return [_out(m, names, agents) for m in rows if _member_in_scope(principal, m)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_member(
    body: MemberCreateIn,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> MemberCreateOut:
    _check_can_touch(principal, body.role, body.role)
    branch_id, department_id = await _placement(
        db, principal, body.role, body.branch_id, body.department_id
    )
    email = body.email.lower()
    user = await db.scalar(select(User).where(User.email == email))
    password: str | None = None
    if user is None:
        password = temp_password()
        user = User(
            email=email,
            name=body.name.strip(),
            password_hash=hash_password(password),
            must_change_password=True,
        )
        db.add(user)
        await db.flush()
    elif await db.get(Membership, (principal.workspace_id, user.id)):
        raise api_error(
            status.HTTP_409_CONFLICT, "already_member", "{email} is already a member.", email=email
        )

    m = Membership(
        workspace_id=principal.workspace_id,
        user_id=user.id,
        role=body.role,
        branch_id=branch_id,
        department_id=department_id,
    )
    db.add(m)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.added",
        target=user.id,
        after={
            "email": email,
            "role": body.role,
            "branch_id": branch_id,
            "department_id": department_id,
        },
    )
    await db.commit()
    await db.refresh(m)
    return MemberCreateOut(
        member=_out(m, await _names(db, principal.workspace_id)), temp_password=password
    )


@router.patch("/{user_id}")
async def update_member(
    user_id: str,
    body: MemberUpdateIn,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "You cannot change your own role. Ask another owner or admin.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role, body.role)
    branch_id, department_id = await _placement(
        db, principal, body.role, body.branch_id, body.department_id
    )
    if m.role == "owner" and body.role != "owner" and await _owner_count(db, m.workspace_id) <= 1:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "last_owner", "A workspace needs at least one owner."
        )
    before = {"role": m.role, "branch_id": m.branch_id, "department_id": m.department_id}
    m.role, m.branch_id, m.department_id = body.role, branch_id, department_id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.role_changed",
        target=user_id,
        before=before,
        after={"role": body.role, "branch_id": branch_id, "department_id": department_id},
    )
    await db.commit()
    await db.refresh(m)
    return _out(m, await _names(db, principal.workspace_id))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: str,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if user_id == principal.user.id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "self_remove", "You cannot remove yourself.")
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    if m.role == "owner" and await _owner_count(db, m.workspace_id) <= 1:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "last_owner", "A workspace needs at least one owner."
        )
    email = m.user.email
    await db.delete(m)
    await db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.workspace_id == principal.workspace_id
        )
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.removed",
        target=user_id,
        before={"email": email},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> TempPasswordOut:
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "self_reset", "Use Change password for your own account."
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    password = temp_password()
    m.user.password_hash = hash_password(password)
    m.user.must_change_password = True
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await audit.record(
        db, principal.workspace_id, principal.actor, "member.password_reset", target=user_id
    )
    await db.commit()
    return TempPasswordOut(temp_password=password)
