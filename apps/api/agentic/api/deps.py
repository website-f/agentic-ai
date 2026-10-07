"""Request auth: session cookie -> Principal, permission checks, CSRF, cookie helpers."""

import ipaddress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.db import get_db
from ..core.security import PERMISSIONS, can, new_token, token_hash
from ..i18n import Msg, explicit_lang, lookup, normalize, set_lang
from ..i18n.labels import role_label
from ..models import AuthSession, Membership, User
from .scope import Scope

SESSION_COOKIE = "agentic_session"
CSRF_COOKIE = "agentic_csrf"
CSRF_HEADER = "x-csrf-token"


@dataclass(frozen=True)
class Principal:
    user: User
    workspace_id: str
    role: str
    session_id: str
    branch_id: str | None = None  # P9: a scoped role's branch / department
    department_id: str | None = None

    @property
    def actor(self) -> str:
        return f"user:{self.user.id}"

    @property
    def scope(self) -> Scope:
        return Scope.of(self.role, self.user.id, self.branch_id, self.department_id)

    @property
    def permissions(self) -> list[str]:
        return sorted(PERMISSIONS.get(self.role, frozenset()))


def api_error(status_code: int, code: str, message: str, **vars: Any) -> HTTPException:
    """Errors carry a stable `code` for the client and a sentence for the person.

    `message` is an English template, like t() in the app: `{var}` placeholders filled from
    `vars`. It stays English here (logs, tests); the error handler renders it in the
    request's language when it answers. Never pass an f-string: Malay word order differs.
    """
    if isinstance(message, Msg):
        text: Msg = message
    elif vars:
        text = Msg(message, **vars)
    else:  # a literal, or English from elsewhere (str(e)): exact key, then known templates
        text = lookup(message)
    return HTTPException(status_code=status_code, detail={"code": code, "message": text})


LANG_HEADER = "x-lang"


def header_lang(request: Request) -> str | None:
    """The language the app asked for (X-Lang: en | ms), if valid."""
    return normalize(request.headers.get(LANG_HEADER))


def _remember_lang(request: Request, user: User) -> None:
    """No X-Lang header: answer in the person's saved language."""
    if explicit_lang() is not None or header_lang(request):
        return
    saved = ((user.prefs or {}).get("locale") or {}).get("language")
    lang = normalize(saved)
    if lang:
        request.state.lang = lang
        set_lang(lang)


def _ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    v = value.strip().strip('"')
    if v.startswith("["):  # [v6]:port
        v = v[1 : v.find("]")] if "]" in v else v
    elif v.count(":") == 1:  # v4:port
        v = v.split(":", 1)[0]
    try:
        return ipaddress.ip_address(v)
    except ValueError:
        return None


def _public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified
    )


def client_ip(request: Request) -> str:
    """The address that really connected, for sign-in lockouts and the audit trail.

    P29: uvicorn runs with --proxy-headers, and with --forwarded-allow-ips '*' it takes the
    LEFTMOST X-Forwarded-For entry, which the client writes itself (nginx only appends).
    So: X-Real-IP first (our nginx sets it to $remote_addr), else the rightmost public
    X-Forwarded-For entry (the one our proxy added), else the socket peer."""
    real = _ip(request.headers.get("x-real-ip", ""))
    if real is not None:
        return str(real)
    hops = [
        ip
        for raw in request.headers.getlist("x-forwarded-for")
        for part in raw.split(",")
        if (ip := _ip(part)) is not None
    ]
    for ip in reversed(hops):
        if _public(ip):
            return str(ip)
    if hops:  # all private: an office network talking to an internal install
        return str(hops[-1])
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
            select(User, Membership)
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
    user, m = row
    _remember_lang(request, user)
    return Principal(
        user=user,
        workspace_id=session.workspace_id,
        role=m.role,
        session_id=session.id,
        branch_id=m.branch_id,
        department_id=m.department_id,
    )


async def principal_allow_pw_change(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Principal:
    """For the few endpoints a user may call while a password change is pending."""
    return await _load_principal(request, db)


async def optional_principal(
    request: Request, db: AsyncSession = Depends(get_db)
) -> Principal | None:
    """P29: the signed-in person, or None. For top-level GET redirects (an OAuth callback)
    that must answer with a page, not a JSON 401. The Lax session cookie is sent on them."""
    try:
        p = await _load_principal(request, db)
    except HTTPException:
        return None
    return None if p.user.must_change_password else p


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
                "Your role ({role}) cannot do this.",
                role=role_label(principal.role),
            )
        return principal

    return checker
