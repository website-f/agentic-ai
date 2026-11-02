"""P57: two-step sign-in (an authenticator app's 6-digit codes, plus one-time recovery codes).

Every endpoint here stays reachable while the workspace asks a person to set it up
(principal_allow_2fa_setup); all other endpoints answer 403 2fa_required until then.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import verify_password
from ...models import AuthSession, Membership, User, Workspace
from ...services import audit, two_factor
from ..deps import Principal, api_error, principal_allow_2fa_setup, require

router = APIRouter(prefix="/api/auth/2fa", tags=["auth"])


class TwoFactorStatusOut(BaseModel):
    enabled: bool
    enabled_at: datetime | None
    pending: bool  # a setup is waiting for its first code
    recovery_codes_left: int
    required: bool  # the workspace asks this person for it
    policy: two_factor.Policy


class SetupOut(BaseModel):
    secret: str
    uri: str


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)


class DisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=20)
    recovery_code: str | None = Field(default=None, max_length=40)


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class PolicyIn(BaseModel):
    require_2fa: Literal["off", "admins", "everyone"]


class PolicyOut(BaseModel):
    require_2fa: two_factor.Policy


class MemberTwoFactorOut(BaseModel):
    user_id: str
    enabled: bool
    enabled_at: datetime | None
    required: bool


async def _locked_user(db: AsyncSession, principal: Principal) -> User:
    """The person's row, locked: a code is checked and its step saved in one transaction."""
    user = await db.scalar(
        select(User)
        .where(User.id == principal.user.id)
        .with_for_update()
        # The principal loaded this row already: re-read it under the lock, so a code another
        # request just accepted (totp_last_step) is seen.
        .execution_options(populate_existing=True)
    )
    assert user is not None
    return user


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return ws


async def _not_locked(principal: Principal) -> None:
    wait = await two_factor.locked_for(principal.user.id)
    if wait:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_codes",
            "Too many wrong codes. Try again in {minutes} min.",
            minutes=max(1, round(wait / 60)),
        )


async def _wrong_code(db: AsyncSession, principal: Principal) -> None:
    user_id = principal.user.id  # read before the rollback expires the row
    await db.rollback()
    await two_factor.register_failure(user_id)
    raise api_error(
        status.HTTP_400_BAD_REQUEST,
        "bad_code",
        "That code is not right. Use the newest code in your app.",
    )


def _owner_only(principal: Principal) -> None:
    if principal.role != "owner":
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "owner_only",
            "Only an owner can change two-step sign-in for the company.",
        )


@router.get("")
async def get_status(
    principal: Principal = Depends(principal_allow_2fa_setup), db: AsyncSession = Depends(get_db)
) -> TwoFactorStatusOut:
    user = await db.get(User, principal.user.id)
    assert user is not None
    ws = await _ws(db, principal)
    rule = two_factor.policy(ws.settings)
    return TwoFactorStatusOut(
        enabled=two_factor.enabled(user),
        enabled_at=user.totp_enabled_at,
        pending=bool(user.totp_secret_enc) and user.totp_enabled_at is None,
        recovery_codes_left=len(user.recovery_codes or []),
        required=two_factor.covers(rule, principal.role),
        policy=rule,
    )


@router.post("/setup")
async def start_setup(
    principal: Principal = Depends(principal_allow_2fa_setup), db: AsyncSession = Depends(get_db)
) -> SetupOut:
    """A new secret for the person's authenticator app. Nothing changes until a code from
    it is confirmed; starting again replaces a setup still waiting."""
    user = await _locked_user(db, principal)
    if two_factor.enabled(user):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "already_enabled",
            "Two-step sign-in is already on. Turn it off first to move it to a new phone.",
        )
    secret, uri = two_factor.start_setup(user)
    await db.commit()
    return SetupOut(secret=secret, uri=uri)


@router.post("/confirm")
async def confirm_setup(
    body: CodeIn,
    principal: Principal = Depends(principal_allow_2fa_setup),
    db: AsyncSession = Depends(get_db),
) -> RecoveryCodesOut:
    """The first code from the app turns it on. The recovery codes are shown only now."""
    await _not_locked(principal)
    user = await _locked_user(db, principal)
    if two_factor.enabled(user):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "already_enabled",
            "Two-step sign-in is already on. Turn it off first to move it to a new phone.",
        )
    if not user.totp_secret_enc:
        raise api_error(status.HTTP_409_CONFLICT, "setup_not_started", "Start the setup again.")
    if not two_factor.check_code(user, body.code):
        await _wrong_code(db, principal)
    codes = two_factor.turn_on(user)
    await audit.record(
        db, principal.workspace_id, principal.actor, "auth.2fa_enabled", target=user.id
    )
    await db.commit()
    await two_factor.clear_failures(user.id)
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable(
    body: DisableIn,
    principal: Principal = Depends(principal_allow_2fa_setup),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Needs the password and a current code (or a recovery code). If the company requires
    two-step sign-in, the next request asks the person to set it up again."""
    await _not_locked(principal)
    user = await _locked_user(db, principal)
    if not verify_password(user.password_hash, body.password):
        user_id = user.id
        await db.rollback()
        await two_factor.register_failure(user_id)
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_current_password", "Current password is incorrect."
        )
    if two_factor.enabled(user):
        if body.recovery_code:
            ok = two_factor.use_recovery_code(user, body.recovery_code)
        else:
            ok = two_factor.check_code(user, body.code or "")
        if not ok:
            await _wrong_code(db, principal)
    two_factor.turn_off(user)
    await audit.record(
        db, principal.workspace_id, principal.actor, "auth.2fa_disabled", target=user.id
    )
    await db.commit()


@router.post("/recovery-codes")
async def regenerate_recovery_codes(
    body: CodeIn,
    principal: Principal = Depends(principal_allow_2fa_setup),
    db: AsyncSession = Depends(get_db),
) -> RecoveryCodesOut:
    """Ten new codes; the old ones stop working."""
    await _not_locked(principal)
    user = await _locked_user(db, principal)
    if not two_factor.enabled(user):
        raise api_error(status.HTTP_409_CONFLICT, "not_enabled", "Two-step sign-in is not on.")
    if not two_factor.check_code(user, body.code):
        await _wrong_code(db, principal)
    codes = two_factor.new_recovery_codes(user)
    await audit.record(
        db, principal.workspace_id, principal.actor, "auth.2fa_recovery_regenerated", target=user.id
    )
    await db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


# ---------------------------------------------------------------- the workspace rule (owners)


@router.get("/policy")
async def get_policy(
    principal: Principal = Depends(principal_allow_2fa_setup), db: AsyncSession = Depends(get_db)
) -> PolicyOut:
    return PolicyOut(require_2fa=two_factor.policy((await _ws(db, principal)).settings))


@router.put("/policy")
async def set_policy(
    body: PolicyIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> PolicyOut:
    """Owners only. Turning it on never signs anyone out: each person covered is asked to
    set it up on their next request."""
    _owner_only(principal)
    ws = await db.scalar(
        select(Workspace).where(Workspace.id == principal.workspace_id).with_for_update()
    )
    assert ws is not None
    before = two_factor.policy(ws.settings)
    if before != body.require_2fa:
        ws.settings = {**(ws.settings or {}), two_factor.SETTING: body.require_2fa}
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "workspace.require_2fa_changed",
            target=ws.id,
            before={"require_2fa": before},
            after={"require_2fa": body.require_2fa},
        )
        await db.commit()
    return PolicyOut(require_2fa=body.require_2fa)


# ---------------------------------------------------------------- members (owners and admins)


@router.get("/members")
async def members_status(
    principal: Principal = Depends(require("members.manage")), db: AsyncSession = Depends(get_db)
) -> list[MemberTwoFactorOut]:
    """Who has two-step sign-in on, for the members page."""
    rule = two_factor.policy((await _ws(db, principal)).settings)
    rows = (
        await db.execute(
            select(User.id, User.totp_enabled_at, User.totp_secret_enc, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == principal.workspace_id)
        )
    ).all()
    return [
        MemberTwoFactorOut(
            user_id=uid,
            enabled=enabled_at is not None and bool(secret),
            enabled_at=enabled_at if secret else None,
            required=two_factor.covers(rule, role),
        )
        for uid, enabled_at, secret, role in rows
    ]


@router.post("/members/{user_id}/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_member(
    user_id: str,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """An owner turns off another member's two-step sign-in (a lost phone). Their sessions
    end too: whoever has the phone may still be signed in."""
    _owner_only(principal)
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "own_account",
            "Turn off your own two-step sign-in in Settings.",
        )
    m = await db.get(Membership, (principal.workspace_id, user_id))
    if m is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    assert user is not None
    was_on = two_factor.enabled(user)
    two_factor.turn_off(user)
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "auth.2fa_reset",
        target=user_id,
        before={"enabled": was_on, "email": user.email},
        after={"enabled": False},
    )
    await db.commit()
    await two_factor.clear_failures(user_id)
