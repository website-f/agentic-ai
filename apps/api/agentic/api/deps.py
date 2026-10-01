"""Request auth: session cookie -> Principal, permission checks, CSRF, cookie helpers."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.db import get_db
from ..core.security import PERMISSIONS, can, new_token, token_hash
from ..models import AuthSession, Membership, User

SESSION_COOKIE = "agentic_session"
CSRF_COOKIE = "agentic_csrf"
CSRF_HEADER = "x-csrf-token"


@dataclass(frozen=True)
class Principal:
    user: User
    workspace_id: str
    role: str
    session_id: str

    @property
    def actor(self) -> str:
        return f"user:{self.user.id}"

    @property
    def permissions(self) -> list[str]:
        return sorted(PERMISSIONS.get(self.role, frozenset()))


def api_error(status_code: int, code: str, message: str) -> HTTPException:
    """Errors carry a stable `code` for the client and a sentence for the person."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def start_session(
    db: AsyncSession, response: Response, request: Request, user: User, workspace_id: str
) -> None:
    token = new_token()
    now = datetime.now(UTC)
    expires = now + timedelta(days=settings.session_days)
    db.add(
        AuthSession(
            id=token_hash(token),
            user_id=user.id,
            workspace_id=workspace_id,
            created_at=now,
            expires_at=expires,
            user_agent=(request.headers.get("user-agent") or "")[:400],
            ip=client_ip(request),
        )
    )
    max_age = settings.session_days * 86400
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    # Readable by JS on purpose: the SPA echoes it in X-CSRF-Token (double submit).
    response.set_cookie(
        CSRF_COOKIE,
        new_token(),
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


async def _load_principal(request: Request, db: AsyncSession) -> Principal:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "not_authenticated", "Sign in to continue.")
    session = await db.get(AuthSession, token_hash(token))
    if session is None or session.expires_at <= datetime.now(UTC):
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "session_expired", "Your session ended. Sign in again."
        )
    row = (
        await db.execute(
            select(User, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(User.id == session.user_id, Membership.workspace_id == session.workspace_id)
        )
    ).first()
    if row is None or not row[0].is_active:
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "access_removed",
            "This account no longer has access to the workspace.",
        )
    user, role = row
    return Principal(user=user, workspace_id=session.workspace_id, role=role, session_id=session.id)


async def principal_allow_pw_change(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Principal:
    """For the few endpoints a user may call while a password change is pending."""
    return await _load_principal(request, db)


async def current_principal(request: Request, db: AsyncSession = Depends(get_db)) -> Principal:
    principal = await _load_principal(request, db)
    if principal.user.must_change_password:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "password_change_required",
            "Set a new password before continuing.",
        )
    return principal


def require(permission: str):
    async def checker(principal: Principal = Depends(current_principal)) -> Principal:
        if not can(principal.role, permission):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                f"Your role ({principal.role}) cannot do this.",
            )
        return principal

    return checker
