from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import hash_password, needs_rehash, verify_password
from ...models import AuthSession, Membership, User, Workspace
from ...services import audit, loginguard
from ...services.text import slugify
from ..deps import (
    Principal,
    api_error,
    clear_session_cookies,
    client_ip,
    principal_allow_pw_change,
    start_session,
)
from ..schemas import ChangePasswordIn, LoginIn, MeOut, SetupIn, UserOut, WorkspaceOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _me(db: AsyncSession, user: User, workspace_id: str, role: str) -> MeOut:
    from ...core.security import PERMISSIONS
    from ...models import Branch, Department, Membership
    from ..schemas import ScopeOut
    from ..scope import Scope

    ws = await db.get(Workspace, workspace_id)
    assert ws is not None
    m = await db.get(Membership, (workspace_id, user.id))
    sc = Scope.of(role, user.id, m.branch_id if m else None, m.department_id if m else None)
    b = await db.get(Branch, sc.branch_id) if sc.branch_id else None
    d = await db.get(Department, sc.department_id) if sc.department_id else None
    return MeOut(
        scope=ScopeOut(
            kind=sc.kind,  # type: ignore[arg-type]
            label=sc.label,
            branch_id=sc.branch_id,
            branch_name=b.name if b else None,
            department_id=sc.department_id,
            department_name=d.name if d else None,
        ),
        user=UserOut(
            id=user.id,
            email=user.email,
            name=user.name,
            must_change_password=user.must_change_password,
        ),
        workspace=WorkspaceOut(id=ws.id, name=ws.name, slug=ws.slug, timezone=ws.timezone),
        role=role,  # type: ignore[arg-type]
        permissions=sorted(PERMISSIONS[role]),
    )


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

    ws = Workspace(name=body.workspace_name.strip(), slug=slugify(body.workspace_name, "workspace"))
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


@router.post("/login")
async def login(
    body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> MeOut:
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
    if not verify_password(user.password_hash if user else None, body.password) or not user:
        await loginguard.register_failure(email, ip)
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

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = datetime.now(UTC)
    await loginguard.clear(email)
    await start_session(db, response, request, user, membership.workspace_id)
    await audit.record(
        db,
        membership.workspace_id,
        f"user:{user.id}",
        "auth.login",
        target=user.id,
        note=f"ip {ip}",
    )
    await db.commit()
    return await _me(db, user, membership.workspace_id, membership.role)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    principal: Principal = Depends(principal_allow_pw_change),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(delete(AuthSession).where(AuthSession.id == principal.session_id))
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
    if not verify_password(user.password_hash, body.current_password):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_current_password", "Current password is incorrect."
        )
    if body.new_password == body.current_password:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "same_password", "Pick a password you have not used here."
        )
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
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
