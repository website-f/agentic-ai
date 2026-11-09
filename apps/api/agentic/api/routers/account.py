"""P92: Settings > Account: the owner changes their own sign-in email.

It needs proof it is them: their current password, or a Microsoft sign-in in the last ten
minutes (the session it made). Then the same rules as an owner correcting anyone's email
(members.change_identity): the Microsoft account the old email was linked to is let go of,
so their next Microsoft sign-in links the account of the new email (Prima follows), and
every other session of theirs ends. This session stays: they just proved who they are.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import verify_password
from ...models import AuditLog, AuthSession, Membership, User
from ...services import audit, identity, loginguard
from ..deps import Principal, api_error, client_ip, current_principal
from ..schemas import MeOut
from .members import email_taken

router = APIRouter(prefix="/api/account", tags=["account"])

RECENT_MICROSOFT = timedelta(minutes=10)


class EmailChangeIn(BaseModel):
    email: EmailStr
    current_password: str | None = Field(default=None, max_length=200)


async def _microsoft_just_now(db: AsyncSession, principal: Principal) -> bool:
    """This session was made by Sign in with Microsoft in the last ten minutes."""
    session = await db.get(AuthSession, principal.session_id)
    now = datetime.now(UTC)
    if session is None or now - session.created_at > RECENT_MICROSOFT:
        return False
    # The sign-in's audit row (routers/auth._signed_in, from microsoft._sign_in) is written
    # in the same request that made the session.
    got = await db.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.workspace_id == principal.workspace_id,
            AuditLog.action == "auth.login",
            AuditLog.target == principal.user.id,
            AuditLog.ts >= session.created_at - timedelta(seconds=5),
            AuditLog.ts <= session.created_at + timedelta(seconds=60),
            AuditLog.note.like("%, Microsoft%"),
        )
    )
    return bool(got)


@router.put("/email")
async def change_my_email(
    body: EmailChangeIn,
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    from .auth import _me

    if principal.role != "owner":
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "owner_only",
            "Ask an owner or admin to correct your email on the Members page.",
        )
    user = await db.get(User, principal.user.id)
    assert user is not None
    new_email = str(body.email).strip().lower()
    ip = client_ip(request)
    if body.current_password:
        wait = await loginguard.locked_for(user.email, ip)
        if wait or not verify_password(user.password_hash, body.current_password):
            if not wait:
                await loginguard.register_failure(user.email, ip)
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_current_password",
                "Current password is incorrect.",
            )
    elif not await _microsoft_just_now(db, principal):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "password_required",
            "Type your current password (or sign in with Microsoft again first).",
        )
    if new_email == user.email:
        return await _me(db, user, principal.workspace_id, principal.role)
    elsewhere = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.user_id == user.id, Membership.workspace_id != principal.workspace_id)
    )
    if elsewhere:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "other_workspace",
            "This person is also in another workspace, so their name and email are not changed "
            "from here.",
        )
    if await email_taken(db, new_email, user.id):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "email_taken",
            "{email} already belongs to another account.",
            email=new_email,
        )
    before = user.email
    user.email = new_email
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "account.email_changed",
        target=user.id,
        before={"email": before},
        after={"email": new_email},
        note="by themselves, "
        + ("with their password" if body.current_password else "just signed in with Microsoft"),
    )
    await db.flush()
    done = await identity.let_go_of_microsoft(db, principal.workspace_id, user.id)  # commits
    ended = await db.scalar(
        select(func.count())
        .select_from(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.id != principal.session_id)
    )
    await db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id, AuthSession.id != principal.session_id
        )
    )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.microsoft_reset",
        target=user.id,
        after={**done, "sessions_ended": int(ended or 0)},
        note="Microsoft link reset: their email changed; this device stays signed in",
    )
    await db.commit()
    return await _me(db, user, principal.workspace_id, principal.role)
