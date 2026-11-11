from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.access import is_prima_only
from ...core.config import settings
from ...core.db import get_db
from ...core.security import hash_password, needs_rehash, verify_password
from ...models import AuthSession, Membership, PushSubscription, User, Workspace
from ...services import audit, loginguard, signin_mail, two_factor
from ...services.text import slugify
from ..deps import (
    DEVELOPER_PERMISSION,
    Principal,
    api_error,
    clear_session_cookies,
    client_ip,
    is_developer,
    principal_allow_pw_change,
    start_session,
)
from ..schemas import ChangePasswordIn, LoginIn, MeOut, SetupIn, UserOut, WorkspaceOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _me(db: AsyncSession, user: User, workspace_id: str, role: str) -> MeOut:
    from ...core.security import effective
    from ...models import Branch, Department, Membership
    from ..schemas import BranchRef, ScopeOut
    from ..scope import Scope

    ws = await db.get(Workspace, workspace_id)
    assert ws is not None
    m = await db.get(Membership, (workspace_id, user.id))
    sc = (
        Scope.of(role, user.id, m.branch_id, m.department_id, branch_ids=m.branch_ids)
        if m
        else Scope.of(role, user.id, None, None)
    )
    b = await db.get(Branch, sc.branch_id) if sc.branch_id else None
    d = await db.get(Department, sc.department_id) if sc.department_id else None
    # P98: every branch the scope covers, home first, with names.
    ids = [i for i in (m.branch_ids if m else []) if i in sc.branch_ids]
    found = (
        {x.id: x.name for x in (await db.scalars(select(Branch).where(Branch.id.in_(ids)))).all()}
        if ids
        else {}
    )
    return MeOut(
        scope=ScopeOut(
            kind=sc.kind,  # type: ignore[arg-type]
            label=sc.label,
            branch_id=sc.branch_id,
            branch_name=b.name if b else None,
            department_id=sc.department_id,
            department_name=d.name if d else None,
            branches=[BranchRef(id=i, name=found[i]) for i in ids if i in found],
        ),
        user=UserOut(
            id=user.id,
            email=user.email,
            name=user.name,
            must_change_password=user.must_change_password,
            two_factor_enabled=two_factor.enabled(user),
            two_factor_setup_required=two_factor.due(user, role, ws.settings),
            is_developer=is_developer(user, role),
        ),
        workspace=WorkspaceOut(id=ws.id, name=ws.name, slug=ws.slug, timezone=ws.timezone),
        role=role,  # type: ignore[arg-type]
        permissions=sorted(
            effective(role, ws.settings) | await _extra_permissions(db, ws.id, user.id, role)
        ),
        assignable_roles=_assignable(role, ws.settings),
        # P99: Prima only (the app opens Prima for them) and their chosen Prima screens.
        access="prima_only" if m and is_prima_only(m.access, role) else "agentic",
        prima_modules=m.prima_modules if m and role != "owner" else None,
    )


def _assignable(role: str, ws_settings: dict | None) -> list[str]:
    """P92: the roles this person may give, so the Members page offers only those."""
    from ...core.security import use_settings
    from .members import assignable_for

    use_settings(ws_settings)  # this workspace's role access (as every signed-in request)
    return assignable_for(role)


async def _extra_permissions(
    db: AsyncSession, workspace_id: str, user_id: str, role: str
) -> set[str]:
    """P50: the CRM is the owner's, and anyone the owner shared part of it with.
    P73: the developer (an owner marked by the operator) also manages feedback."""
    from ...models import CrmAccess

    if role == "owner":
        user = await db.get(User, user_id)
        # P92: only an owner edits what each role may do (Settings > Roles and access).
        extra = {"crm.access", "roles.manage"}
        return extra | ({DEVELOPER_PERMISSION} if is_developer(user, role) else set())
    shared = await db.scalar(
        select(CrmAccess.id)
        .where(CrmAccess.workspace_id == workspace_id, CrmAccess.user_id == user_id)
        .limit(1)
    )
    return {"crm.access"} if shared else set()


@router.get("/setup-status")
async def setup_status(db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    users = await db.scalar(select(func.count()).select_from(User))
    return {"needs_setup": not users}


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup(
    body: SetupIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> MeOut:
    """First run only: create the workspace and its owner, then sign them in."""
    # One lock for the whole install, so two browsers racing the setup page can't both win.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('agentic:setup'))"))
    if await db.scalar(select(func.count()).select_from(User)):
        raise api_error(status.HTTP_409_CONFLICT, "already_set_up", "This install is set up.")

    ws = Workspace(
        name=body.workspace_name.strip(),
        slug=slugify(body.workspace_name, "workspace"),
        # P57: a new workspace asks its owners and admins for two-step sign-in.
        settings={two_factor.SETTING: settings.new_workspace_require_2fa},
    )
    user = User(
        email=body.email.lower(), name=body.name.strip(), password_hash=hash_password(body.password)
    )
    db.add_all([ws, user])
    await db.flush()
    db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
    await audit.record(
        db,
        ws.id,
        f"user:{user.id}",
        "workspace.created",
        target=ws.id,
        after={"name": ws.name, "owner_email": user.email},
    )
    await start_session(db, response, request, user, ws.id)
    await db.commit()
    return await _me(db, user, ws.id, "owner")


class TwoFactorChallengeOut(BaseModel):
    """P57: the password was right; the code from the person's app comes next."""

    needs_2fa: bool = True
    challenge: str


class LoginCodeIn(BaseModel):
    challenge: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=20)
    recovery_code: str | None = Field(default=None, max_length=40)


async def _signed_in(
    db: AsyncSession,
    request: Request,
    response: Response,
    user: User,
    membership: Membership,
    note: str = "",
) -> MeOut:
    user.last_login_at = datetime.now(UTC)
    await start_session(db, response, request, user, membership.workspace_id)
    await audit.record(
        db,
        membership.workspace_id,
        f"user:{user.id}",
        "auth.login",
        target=user.id,
        note=f"ip {client_ip(request)}{note}",
    )
    await db.commit()
    return await _me(db, user, membership.workspace_id, membership.role)


@router.post("/login", response_model=MeOut | TwoFactorChallengeOut)
async def login(
    body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> MeOut | TwoFactorChallengeOut:
    email = body.email.lower()
    ip = client_ip(request)
    wait = await loginguard.locked_for(email, ip)
    if wait:
        minutes = max(1, round(wait / 60))
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_attempts",
            "Too many failed sign-ins. Try again in {minutes} min.",
            minutes=minutes,
        )

    user = await db.scalar(select(User).where(User.email == email))
    password_ok = verify_password(user.password_hash if user else None, body.password)
    # P92: or the temporary password emailed to them (never their real one). Every failure
    # makes this second check (against a dummy hash when there is no code): flat timing.
    code_hash = None if password_ok else signin_mail.live_code_hash(user)
    code_ok = not password_ok and verify_password(code_hash, body.password)
    if not (password_ok or code_ok) or not user:
        await loginguard.register_failure(email, ip)
        # P92: someone who never signed in gets a temporary password by email. Decided and
        # sent in the background for every failure, so the answer is the same for all.
        signin_mail.spawn(signin_mail.after_failed_login(email, ip))
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "bad_credentials", "Email or password is incorrect."
        )
    if not user.is_active:
        raise api_error(status.HTTP_403_FORBIDDEN, "account_disabled", "This account is disabled.")

    membership = await db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
    )
    if membership is None:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "no_workspace", "This account is not in any workspace yet."
        )

    note = ""
    if code_ok and code_hash:
        # P92: the emailed password works once; a new password of their own comes next.
        signin_mail.clear_code(user)
        user.must_change_password = True
        await signin_mail.remember_used(user.id, code_hash)
        note = ", emailed password"
    elif needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    await loginguard.clear(email)
    if two_factor.enabled(user):
        # P57: no session yet. The code from their app (or a recovery code) comes next.
        await db.commit()
        return TwoFactorChallengeOut(
            challenge=await two_factor.new_challenge(user.id, membership.workspace_id)
        )
    return await _signed_in(db, request, response, user, membership, note)


@router.post("/login/2fa")
async def login_code(
    body: LoginCodeIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> MeOut:
    """P57: the second step of signing in: the challenge from /login and a code."""
    ch = await two_factor.read_challenge(body.challenge)
    if ch is None:
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "challenge_expired",
            "This sign-in timed out. Enter your password again.",
        )
    wait = await two_factor.locked_for(ch["user_id"])
    if wait:
        await two_factor.drop_challenge(body.challenge)
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_codes",
            "Too many wrong codes. Try again in {minutes} min.",
            minutes=max(1, round(wait / 60)),
        )
    if not (body.code or body.recovery_code):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "code_needed", "Enter the 6-digit code from your app."
        )
    # Locked, so one code cannot be used by two requests at once.
    user = await db.scalar(select(User).where(User.id == ch["user_id"]).with_for_update())
    membership = await db.get(Membership, (ch["workspace_id"], ch["user_id"]))
    if user is None or membership is None or not user.is_active:
        await two_factor.drop_challenge(body.challenge)
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "access_removed",
            "This account no longer has access to the workspace.",
        )
    if not two_factor.enabled(user):  # turned off (an owner reset it) since the password step
        await two_factor.drop_challenge(body.challenge)
        return await _signed_in(db, request, response, user, membership)

    if body.recovery_code:
        ok = two_factor.use_recovery_code(user, body.recovery_code)
    else:
        ok = two_factor.check_code(user, body.code or "")
    if not ok:
        user_id = user.id  # read before the rollback expires the row
        await db.rollback()
        await two_factor.register_failure(user_id)
        left = await two_factor.challenge_failed(body.challenge)
        if left <= 0:
            raise api_error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "too_many_codes",
                "Too many wrong codes. Sign in again.",
            )
        if body.recovery_code:
            raise api_error(
                status.HTTP_401_UNAUTHORIZED,
                "bad_code",
                "That recovery code is not right, or it was used already.",
            )
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "bad_code",
            "That code is not right. Use the newest code in your app.",
        )

    await two_factor.drop_challenge(body.challenge)
    await two_factor.clear_failures(user.id)
    note = ", two-step"
    if body.recovery_code:
        note = ", recovery code"
        await audit.record(
            db,
            membership.workspace_id,
            f"user:{user.id}",
            "auth.2fa_recovery_used",
            target=user.id,
            after={"left": len(user.recovery_codes or [])},
        )
    return await _signed_in(db, request, response, user, membership, note)


# ---------------------------------------------------------------- P63 Sign in with Microsoft


class MicrosoftStartIn(BaseModel):
    email: str = Field(default="", max_length=254)
    next: str = Field(default="", max_length=500)


@router.get("/sso")
async def sso_options(db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    """Which other ways to sign in the sign-in page offers."""
    from ...microsoft import signin

    # P92: and "Email me a sign-in password" when some workspace sends sign-in emails.
    return {
        "microsoft": bool(await signin.offices(db)),
        "email_signin": await signin_mail.any_sender(db) is not None,
    }


@router.post("/microsoft/start")
async def microsoft_start(
    body: MicrosoftStartIn, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    """Microsoft's sign-in page for this office; it comes back to the Microsoft callback
    (routers/microsoft.py), which signs the person in (microsoft/signin.py)."""
    from ...microsoft import app as ms_app
    from ...microsoft import signin
    from ...microsoft.errors import MicrosoftError

    if await signin.slow_down(client_ip(request)):
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS, "too_many_attempts", "Too many tries. Wait a minute."
        )
    nxt = body.next if body.next.startswith("/") and not body.next.startswith("//") else ""
    try:
        url = await signin.start(
            db, ms_app.request_base(request.headers, request.url.scheme), body.email, nxt
        )
    except signin.EmailNeeded as e:
        raise api_error(status.HTTP_409_CONFLICT, "email_needed", e.args[0]) from e
    except MicrosoftError as e:
        raise api_error(status.HTTP_409_CONFLICT, "not_available", e.args[0]) from e
    return {"url": url}


class LogoutIn(BaseModel):
    # P29: this device's web-push endpoint (the browser's PushSubscription.endpoint). Push
    # subscriptions are per person, not per session, so the app names the one to drop.
    push_endpoint: str | None = Field(default=None, max_length=2000)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    body: LogoutIn | None = None,
    principal: Principal = Depends(principal_allow_pw_change),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(delete(AuthSession).where(AuthSession.id == principal.session_id))
    if body is not None and body.push_endpoint:
        # Signed out here: this device stops getting approval buttons. Only the person's own.
        await db.execute(
            delete(PushSubscription).where(
                PushSubscription.endpoint == body.push_endpoint,
                PushSubscription.user_id == principal.user.id,
            )
        )
    await db.commit()
    clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me")
async def me(
    principal: Principal = Depends(principal_allow_pw_change), db: AsyncSession = Depends(get_db)
) -> MeOut:
    return await _me(db, principal.user, principal.workspace_id, principal.role)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordIn,
    principal: Principal = Depends(principal_allow_pw_change),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    user = await db.get(User, principal.user.id)
    assert user is not None
    # P92: after signing in with an emailed password, that password counts as the current one.
    if not verify_password(user.password_hash, body.current_password) and not (
        user.must_change_password
        and await signin_mail.used_code_matches(user.id, body.current_password)
    ):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_current_password", "Current password is incorrect."
        )
    if body.new_password == body.current_password:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "same_password", "Pick a password you have not used here."
        )
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    signin_mail.clear_code(user)
    await signin_mail.forget_used(user.id)
    # Sign out every other device; keep this one.
    await db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id, AuthSession.id != principal.session_id
        )
    )
    await audit.record(
        db, principal.workspace_id, principal.actor, "auth.password_changed", target=user.id
    )
    await db.commit()
    return await _me(db, user, principal.workspace_id, principal.role)
