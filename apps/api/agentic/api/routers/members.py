from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can, hash_password, temp_password
from ...models import AuthSession, Membership, User
from ...services import audit
from ..deps import Principal, api_error, require
from ..schemas import (
    MemberCreateIn,
    MemberCreateOut,
    MemberOut,
    MemberUpdateIn,
    TempPasswordOut,
)

router = APIRouter(prefix="/api/members", tags=["members"])


def _out(m: Membership) -> MemberOut:
    u = m.user
    return MemberOut(
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
    """Only owners may grant, change or remove the owner role."""
    touches_owner = target_role == "owner" or new_role == "owner"
    if touches_owner and not can(actor.role, "members.assign_owner"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can change owner access."
        )


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
    return [_out(m) for m in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_member(
    body: MemberCreateIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> MemberCreateOut:
    _check_can_touch(principal, body.role, body.role)
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
        raise api_error(status.HTTP_409_CONFLICT, "already_member", f"{email} is already a member.")

    m = Membership(workspace_id=principal.workspace_id, user_id=user.id, role=body.role)
    db.add(m)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.added",
        target=user.id,
        after={"email": email, "role": body.role},
    )
    await db.commit()
    await db.refresh(m)
    return MemberCreateOut(member=_out(m), temp_password=password)


@router.patch("/{user_id}")
async def update_member(
    user_id: str,
    body: MemberUpdateIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "You cannot change your own role. Ask another owner or admin.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    _check_can_touch(principal, m.role, body.role)
    if m.role == "owner" and body.role != "owner" and await _owner_count(db, m.workspace_id) <= 1:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "last_owner", "A workspace needs at least one owner."
        )
    before = {"role": m.role}
    m.role = body.role
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.role_changed",
        target=user_id,
        before=before,
        after={"role": body.role},
    )
    await db.commit()
    await db.refresh(m)
    return _out(m)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: str,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if user_id == principal.user.id:
        raise api_error(status.HTTP_400_BAD_REQUEST, "self_remove", "You cannot remove yourself.")
    m = await _membership(db, principal.workspace_id, user_id)
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
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> TempPasswordOut:
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "self_reset", "Use Change password for your own account."
        )
    m = await _membership(db, principal.workspace_id, user_id)
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
