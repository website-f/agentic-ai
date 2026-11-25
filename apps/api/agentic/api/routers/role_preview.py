"""P131 (Fitri, 25 Nov 2026: "global admin can log in as every kind of role except owner and
developer, to see that role's view ... a dummy account auto-created so they can experiment,
change permissions and so on").

GET  /api/role-preview         the roles one may try, the companies and departments, and
                               whether this browser is in a try-out now
POST /api/role-preview/start   sign this browser in as the practice account for a role
POST /api/role-preview/stop    back to one's own account

Only an owner (the developer is an owner) or a global admin starts one; never as an owner. A
practice account is an ordinary member of this workspace with an address on PREVIEW_DOMAIN and
an unusable password: nobody signs in to it with a password, only through here. One practice
account per role (and company/department), kept, so what is set on it (permissions, Prima
screens, tasks) is still there next time. The way back is the admin's own session, kept in an
httpOnly cookie of this browser, checked against the database again on the way back; the
try-out session is deleted.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from ...core.db import get_db
from ...core.security import ROLES, hash_password, new_token, token_hash
from ...models import AuthSession, Branch, Membership, MembershipBranch, User
from ...services import audit
from ..deps import (
    SESSION_COOKIE,
    Principal,
    api_error,
    current_principal,
    is_app_client,
    start_session,
)

router = APIRouter(prefix="/api/role-preview", tags=["role-preview"])

PREVIEW_DOMAIN = "role-preview.local"
BACK_COOKIE = "agentic_preview_back"
STARTERS = frozenset({"owner", "admin"})
# Every role but the owner (the developer is an owner): what a global admin may look through.
TRY_ROLES = tuple(r for r in ROLES if r != "owner")
# Roles that work inside one company (branch) and, for some, one department.
BRANCH_ROLES = frozenset({"branch_manager", "group_hod", "hod", "supervisor", "staff"})
DEPT_ROLES = frozenset({"hod", "supervisor", "staff"})

LABELS = {
    "admin": "Global admin",
    "it_support": "IT support",
    "branch_manager": "Branch manager",
    "hod": "Head of department",
    "group_hod": "Group HOD",
    "supervisor": "Supervisor",
    "staff": "Staff",
    "operator": "Operator",
    "approver": "Approver",
    "viewer": "Viewer",
    "management": "Management",
    "hr": "HR",
}


def is_preview_email(email: str | None) -> bool:
    return bool(email) and str(email).lower().endswith("@" + PREVIEW_DOMAIN)


class StartIn(BaseModel):
    role: str = Field(min_length=2, max_length=16)
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)


class RoleOption(BaseModel):
    role: str
    label: str
    needs_branch: bool
    needs_department: bool


class DeptOption(BaseModel):
    id: str
    name: str


class BranchOption(BaseModel):
    id: str
    name: str
    departments: list[DeptOption]


class PreviewOut(BaseModel):
    can_start: bool
    previewing: bool
    as_role: str | None = None
    as_label: str | None = None
    roles: list[RoleOption] = []
    branches: list[BranchOption] = []


@router.get("")
async def state(
    request: Request,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> PreviewOut:
    previewing = is_preview_email(principal.user.email) and bool(request.cookies.get(BACK_COOKIE))
    can_start = principal.role in STARTERS and not is_preview_email(principal.user.email)
    out = PreviewOut(
        can_start=can_start,
        previewing=previewing,
        as_role=principal.role if previewing else None,
        as_label=LABELS.get(principal.role, principal.role) if previewing else None,
    )
    if not can_start:
        return out
    out.roles = [
        RoleOption(
            role=r,
            label=LABELS.get(r, r.replace("_", " ").title()),
            needs_branch=r in BRANCH_ROLES,
            needs_department=r in DEPT_ROLES,
        )
        for r in TRY_ROLES
    ]
    branches = (
        await db.scalars(
            select(Branch)
            .where(Branch.workspace_id == principal.workspace_id)
            .order_by(Branch.name)
        )
    ).all()
    out.branches = [
        BranchOption(
            id=b.id,
            name=b.name,
            departments=[DeptOption(id=d.id, name=d.name) for d in b.departments],
        )
        for b in branches
    ]
    return out


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:24] or "x"


@router.post("/start")
async def start(
    body: StartIn,
    request: Request,
    response: Response,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> PreviewOut:
    if principal.role not in STARTERS or is_preview_email(principal.user.email):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only an owner or a global admin can do this."
        )
    if is_app_client(request):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "web_only", "Try a role in the browser, not the phone app."
        )
    if body.role not in TRY_ROLES:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_role", "This role cannot be tried.")
    ws = principal.workspace_id
    branch = dept = None
    if body.role in BRANCH_ROLES:
        q = select(Branch).where(Branch.workspace_id == ws)
        q = q.where(Branch.id == body.branch_id) if body.branch_id else q.order_by(Branch.name)
        branch = await db.scalar(q.limit(1))
        if branch is None:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "no_company", "Add a company first, or choose one."
            )
        if body.role in DEPT_ROLES:
            depts = list(branch.departments)
            dept = next((d for d in depts if d.id == body.department_id), None) or (
                depts[0] if depts else None
            )

    # One practice account per role, company and department, kept between try-outs.
    key = ".".join(
        x for x in (body.role, branch.slug if branch else "", _slug(dept.name) if dept else "") if x
    )
    tag = hashlib.sha256(ws.encode()).hexdigest()[:6]
    email = f"try.{key.replace('_', '-')}.{tag}@{PREVIEW_DOMAIN}"
    label = LABELS.get(body.role, body.role)
    where = " · ".join(x for x in (branch.name if branch else "", dept.name if dept else "") if x)
    name = f"Try: {label}" + (f" ({where})" if where else "")

    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            name=name[:120],
            # Unusable: a random password nobody is told. Only this page signs in as it.
            password_hash=hash_password(new_token()),
            is_active=True,
        )
        db.add(user)
        await db.flush()
    user.is_active = True
    m = await db.scalar(
        select(Membership).where(Membership.workspace_id == ws, Membership.user_id == user.id)
    )
    if m is None:
        m = Membership(
            workspace_id=ws,
            user_id=user.id,
            role=body.role,
            branch_id=branch.id if branch else None,
            department_id=dept.id if dept else None,
            job_title=f"Practice account ({label})"[:120],
        )
        db.add(m)
        await db.flush()
        if branch is not None:
            db.add(MembershipBranch(workspace_id=ws, user_id=user.id, branch_id=branch.id))
    else:
        m.role = body.role

    # The way back: this browser's own session, kept aside (httpOnly) until Back.
    own = request.cookies.get(SESSION_COOKIE)
    if not own or await db.get(AuthSession, token_hash(own)) is None:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "no_session", "Sign in again, then try the role."
        )
    user.last_login_at = datetime.now(UTC)
    await start_session(db, response, request, user, ws)
    response.set_cookie(
        BACK_COOKIE,
        own,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    await audit.record(
        db,
        ws,
        f"user:{principal.user.id}",
        "auth.role_preview_start",
        target=user.id,
        note=f"as {body.role}" + (f" in {where}" if where else ""),
    )
    await db.commit()
    return PreviewOut(can_start=False, previewing=True, as_role=body.role, as_label=label)


@router.post("/stop")
async def stop(
    request: Request,
    response: Response,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    back = request.cookies.get(BACK_COOKIE)
    if not is_preview_email(principal.user.email) or not back:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "not_previewing", "You are on your own account."
        )
    own = await db.get(AuthSession, token_hash(back))
    if (
        own is None
        or own.expires_at <= datetime.now(UTC)
        or own.workspace_id != principal.workspace_id
    ):
        # The own session ended meanwhile: sign out fully; the person signs in again.
        await db.execute(delete(AuthSession).where(AuthSession.id == principal.session_id))
        await db.commit()
        response.delete_cookie(BACK_COOKIE, path="/")
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"signed_out": True}
    await db.execute(delete(AuthSession).where(AuthSession.id == principal.session_id))
    await audit.record(
        db,
        principal.workspace_id,
        f"user:{own.user_id}",
        "auth.role_preview_stop",
        target=principal.user.id,
    )
    await db.commit()
    max_age = settings.session_days * 86400
    response.set_cookie(
        SESSION_COOKIE,
        back,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(BACK_COOKIE, path="/")
    return {"signed_out": False}
