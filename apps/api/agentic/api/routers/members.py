from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import ColumnElement, Select, and_, delete, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ...assistants import access as assistant_access
from ...core.db import get_db
from ...core.security import SCOPED_ROLES, can, hash_password, temp_password
from ...i18n import Msg, current_lang, render
from ...i18n.labels import role_label
from ...models import (
    Agent,
    AuthSession,
    Branch,
    Department,
    Membership,
    PushSubscription,
    User,
)
from ...services import audit
from ..deps import Principal, api_error, current_principal, require
from ..schemas import (
    MemberCreateIn,
    MemberCreateOut,
    MemberOut,
    MembersBulkIn,
    MembersBulkOut,
    MembersBulkResult,
    MembersPageOut,
    MembersSummary,
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
        microsoft=bool(m.ms_oid),
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


def _scope_where(principal: Principal) -> ColumnElement[bool]:
    """_member_in_scope in SQL, for the paged list (P82)."""
    sc = principal.scope
    if sc.everything:
        return true()
    me = Membership.user_id == principal.user.id
    if sc.kind == "branch":
        return or_(me, Membership.branch_id == sc.branch_id)
    if sc.kind == "department":
        return or_(me, Membership.department_id == sc.department_id)
    return me


def _agent_counts(principal: Principal, user_ids: list[str] | None = None) -> Select:
    q = select(Agent.owner_user_id, func.count()).where(
        Agent.workspace_id == principal.workspace_id,
        Agent.owner_user_id.is_not(None),
        Agent.status != "retired",
        Agent.clone_of.is_(None),
    )
    if user_ids is not None:
        q = q.where(Agent.owner_user_id.in_(user_ids))
    return q.group_by(Agent.owner_user_id)


# P82: what the Members table filters and sorts by.
STATUSES = ("active", "pending", "disabled")
SORTS = ("name", "email", "role", "company", "department", "last_seen", "joined")
PAGE_SIZES = (25, 50, 100)


def _status_where(value: str) -> ColumnElement[bool]:
    """active: signs in with their own password; pending: still on the one-time password;
    disabled: the account is off (a go-live reset left them with no workspace)."""
    if value == "disabled":
        return User.is_active.is_(False)
    if value == "pending":
        return and_(User.is_active.is_(True), User.must_change_password.is_(True))
    return and_(User.is_active.is_(True), User.must_change_password.is_(False))


async def _summary(db: AsyncSession, principal: Principal) -> MembersSummary:
    base = and_(Membership.workspace_id == principal.workspace_id, _scope_where(principal))
    roles = {
        r: n
        for r, n in (
            await db.execute(
                select(Membership.role, func.count()).where(base).group_by(Membership.role)
            )
        ).all()
    }
    temp, ms = (
        await db.execute(
            select(
                func.count().filter(User.must_change_password.is_(True)),
                func.count().filter(Membership.ms_oid.is_not(None)),
            )
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(base)
        )
    ).one()
    in_scope = select(Membership.user_id).where(base)
    agents = await db.scalar(
        select(func.count()).where(
            Agent.workspace_id == principal.workspace_id,
            Agent.owner_user_id.in_(in_scope),
            Agent.status != "retired",
            Agent.clone_of.is_(None),
        )
    )
    return MembersSummary(
        members=sum(roles.values()),
        owners_admins=roles.get("owner", 0) + roles.get("admin", 0),
        temp_password=temp or 0,
        microsoft=ms or 0,
        agents=agents or 0,
        roles=roles,
    )


@router.get("")
async def list_members(
    page: int | None = Query(default=None, ge=1, le=100_000),
    page_size: int = Query(default=25),
    q: str = Query(default="", max_length=200),
    company: str = Query(default="", max_length=40),
    department: str = Query(default="", max_length=40),
    role: str = Query(default="", max_length=20),
    status_: str = Query(default="", alias="status", max_length=20),
    sort: str = Query(default="name", max_length=20),
    dir: str = Query(default="asc", max_length=4),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut] | MembersPageOut:
    """Everyone the reader may see. With `page` (P82): one page of the Members table, with
    search (name or email), filters (company: a branch id or "none"; role; status) and a sort,
    the total that matches and the summary of the whole list. Without it, the plain list every
    other screen (people pickers) has always read."""
    ws = principal.workspace_id
    if page is None:
        rows = (
            await db.scalars(
                select(Membership)
                .where(Membership.workspace_id == ws)
                .order_by(Membership.created_at)
            )
        ).all()
        agents = {uid: n for uid, n in (await db.execute(_agent_counts(principal))).all() if uid}
        names = await _names(db, ws)
        return [_out(m, names, agents) for m in rows if _member_in_scope(principal, m)]

    if page_size not in PAGE_SIZES:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_page_size", "Show 25, 50 or 100 a page."
        )
    where = [Membership.workspace_id == ws, _scope_where(principal)]
    words = q.strip().lower()
    if words:
        like = "%" + words.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append(
            or_(
                func.lower(User.name).like(like, escape="\\"),
                func.lower(User.email).like(like, escape="\\"),
            )
        )
    if company == "none":
        where.append(Membership.branch_id.is_(None))
    elif company:
        where.append(Membership.branch_id == company)
    if department:
        where.append(Membership.department_id == department)
    if role:
        where.append(Membership.role == role)
    if status_ in STATUSES:
        where.append(_status_where(status_))
    branch = aliased(Branch)
    dept = aliased(Department)
    key = sort if sort in SORTS else "name"
    desc = dir == "desc"
    # Empty values (no company, never signed in) always go last, either way round.
    col = {
        "name": func.lower(User.name),
        "email": User.email,
        "role": Membership.role,
        "company": func.lower(branch.name),
        "department": func.lower(dept.name),
        "last_seen": User.last_login_at,
        "joined": Membership.created_at,
    }[key]
    order = [(col.desc() if desc else col.asc()).nulls_last()]
    if key != "name":
        order.append(func.lower(User.name).asc())
    order.append(User.id.asc())  # a stable order across pages
    base = (
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .outerjoin(branch, branch.id == Membership.branch_id)
        .outerjoin(dept, dept.id == Membership.department_id)
        .where(*where)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.scalars(base.order_by(*order).offset((page - 1) * page_size).limit(page_size))
    ).all()
    ids = [m.user_id for m in rows]
    agents = (
        {uid: n for uid, n in (await db.execute(_agent_counts(principal, ids))).all() if uid}
        if ids
        else {}
    )
    names = await _names(db, ws)
    return MembersPageOut(
        items=[_out(m, names, agents) for m in rows],
        total=total,
        page=page,
        page_size=page_size,
        summary=await _summary(db, principal),
    )


async def add_one(
    db: AsyncSession,
    principal: Principal,
    *,
    email: str,
    name: str,
    role: str,
    branch_id: str | None,
    department_id: str | None,
    via: str | None = None,
) -> tuple[Membership, str | None]:
    """Add one person: the role and place rules, a new account with a one-time password
    (None when they already have an account), and the audit row. One path for the form and
    the Excel import (`via="import"`); the caller commits."""
    _check_can_touch(principal, role, role)
    branch_id, department_id = await _placement(db, principal, role, branch_id, department_id)
    email = email.lower()
    user = await db.scalar(select(User).where(User.email == email))
    password: str | None = None
    if user is None:
        password = temp_password()
        user = User(
            email=email,
            name=name.strip(),
            password_hash=hash_password(password),
            must_change_password=True,
        )
        db.add(user)
        await db.flush()
    elif await db.get(Membership, (principal.workspace_id, user.id)):
        raise api_error(
            status.HTTP_409_CONFLICT, "already_member", "{email} is already a member.", email=email
        )
    # P81: someone a go-live reset left with no workspace was deactivated; adding them back
    # is the deliberate act that turns their account on again (their own password stays).
    reactivated = not user.is_active
    user.is_active = True

    m = Membership(
        workspace_id=principal.workspace_id,
        user_id=user.id,
        role=role,
        branch_id=branch_id,
        department_id=department_id,
    )
    db.add(m)
    after: dict[str, object] = {
        "email": email,
        "role": role,
        "branch_id": branch_id,
        "department_id": department_id,
    }
    if via:
        after["via"] = via
    if reactivated:
        after["reactivated"] = True
    await audit.record(
        db, principal.workspace_id, principal.actor, "member.added", target=user.id, after=after
    )
    await db.flush()
    return m, password


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_member(
    body: MemberCreateIn,
    response: Response,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> MemberCreateOut:
    # P52: the temporary password is shown once: never cached (as with a password reset).
    response.headers["Cache-Control"] = "no-store"
    m, password = await add_one(
        db,
        principal,
        email=body.email,
        name=body.name,
        role=body.role,
        branch_id=body.branch_id,
        department_id=body.department_id,
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
    m = await change_access(db, principal, user_id, body.role, body.branch_id, body.department_id)
    await db.commit()
    await db.refresh(m)
    return _out(m, await _names(db, principal.workspace_id))


async def change_access(
    db: AsyncSession,
    principal: Principal,
    user_id: str,
    role: str,
    branch_id: str | None,
    department_id: str | None,
) -> Membership:
    """One person's role and place, with every rule (one path for the row and the bulk
    change, P82); the caller commits."""
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "You cannot change your own role. Ask another owner or admin.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role, role)
    branch_id, department_id = await _placement(db, principal, role, branch_id, department_id)
    if m.role == "owner" and role != "owner" and await _owner_count(db, m.workspace_id) <= 1:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "last_owner", "A workspace needs at least one owner."
        )
    before = {"role": m.role, "branch_id": m.branch_id, "department_id": m.department_id}
    m.role, m.branch_id, m.department_id = role, branch_id, department_id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.role_changed",
        target=user_id,
        before=before,
        after={"role": role, "branch_id": branch_id, "department_id": department_id},
    )
    if before["role"] != role:  # P30: assistants follow the role (kept, never deleted)
        await assistant_access.follow_role(
            db, principal.workspace_id, user_id, role, principal.actor
        )
    await db.flush()
    return m


async def remove_one(db: AsyncSession, principal: Principal, user_id: str) -> None:
    """Take one person out of the workspace, with every rule; the caller commits."""
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
    await db.flush()


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: str,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await remove_one(db, principal, user_id)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bulk")
async def bulk(
    body: MembersBulkIn,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> MembersBulkOut:
    """P82: the people ticked in the Members table: removed, or given one role and place.
    Each goes through the same rules as one; anyone those rules stop is skipped and says why
    (never half done: one person's refusal never undoes the others)."""
    if body.action == "access" and body.role is None:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "role_required", "Pick a role.")
    results: list[MembersBulkResult] = []
    for user_id in dict.fromkeys(body.user_ids):  # each person once
        try:
            async with db.begin_nested():
                if body.action == "remove":
                    await remove_one(db, principal, user_id)
                else:
                    assert body.role is not None
                    await change_access(
                        db, principal, user_id, body.role, body.branch_id, body.department_id
                    )
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            results.append(
                MembersBulkResult(
                    user_id=user_id,
                    ok=False,
                    message=render(detail.get("message", ""), current_lang()),
                )
            )
            continue
        results.append(MembersBulkResult(user_id=user_id, ok=True))
    await db.commit()
    done = sum(1 for r in results if r.ok)
    return MembersBulkOut(results=results, done=done, skipped=len(results) - done)


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    response: Response,
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
    # P29: a password opens every workspace the person is in. Resetting it from here must not
    # hand this admin someone's place elsewhere (an owner there, added here as a viewer).
    elsewhere = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.user_id == user_id, Membership.workspace_id != principal.workspace_id)
    )
    if elsewhere:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "member_elsewhere",
            "This person also belongs to another workspace, so only they can change their "
            "password (Change password).",
        )
    password = temp_password()
    m.user.password_hash = hash_password(password)
    m.user.must_change_password = True  # the temp password only lets them set a new one
    # Every device signs out, and phones stop getting approval buttons until they sign in.
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id))
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.password_reset",
        target=user_id,
        note="sessions and push devices revoked; new password required at next sign-in",
    )
    await db.commit()
    # Shown once: never cached, never logged or audited.
    response.headers["Cache-Control"] = "no-store"
    return TempPasswordOut(temp_password=password)
