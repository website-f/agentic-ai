from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import ColumnElement, Select, and_, delete, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ...assistants import access as assistant_access
from ...core.access import ACCESS, AGENTIC, is_prima_only
from ...core.db import get_db
from ...core.security import (
    ROLES,
    SCOPED_ROLES,
    can,
    hash_password,
    role_permissions,
    temp_password,
)
from ...i18n import Msg, current_lang, render
from ...i18n.labels import role_label
from ...models import (
    Agent,
    AuthSession,
    Branch,
    Department,
    Membership,
    PrimaLink,
    PushSubscription,
    User,
)
from ...prima import client as prima_client
from ...prima import modules
from ...prima.client import PrimaError
from ...services import audit, identity
from ...teams import people
from ...teams.branches import member_in_branches, ordered, set_branches
from ..deps import Principal, api_error, current_principal, is_developer, require
from ..schemas import (
    BranchRef,
    MemberCreateIn,
    MemberCreateOut,
    MemberOut,
    MembersBulkIn,
    MembersBulkOut,
    MembersBulkResult,
    MembersPageOut,
    MembersSummary,
    MemberTeamIn,
    MemberUpdateIn,
    PrimaAccessIn,
    TempPasswordOut,
)

router = APIRouter(prefix="/api/members", tags=["members"])


# P9: what a branch manager or HOD may hand out to their own people ("team.manage").
TEAM_ROLES = {"branch_manager": {"hod", "supervisor", "staff"}, "hod": {"supervisor", "staff"}}


def _out(
    m: Membership,
    names: dict[str, str] | None = None,
    agents: dict[str, int] | None = None,
    org: "Org | None" = None,
) -> MemberOut:
    u = m.user
    names = names or {}
    org = org or Org()
    return MemberOut(
        reports_to_user_id=m.reports_to_user_id,
        reports_to_name=org.people.get(m.reports_to_user_id or ""),
        heads_department=bool(m.heads_department),
        manages=org.manages.get(u.id, 0),
        branch_id=m.branch_id,
        branch_name=names.get(m.branch_id or ""),
        branches=[BranchRef(id=b, name=names.get(b, "")) for b in m.branch_ids],
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
        access="prima_only" if is_prima_only(m.access, m.role) else "agentic",
        prima_modules=None if m.role == "owner" else m.prima_modules,
    )


class Org:
    """P97: managers' names and how many report to each, for member rows (two queries)."""

    def __init__(
        self, people_: dict[str, str] | None = None, manages: dict[str, int] | None = None
    ):
        self.people = people_ or {}
        self.manages = manages or {}

    @classmethod
    async def load(cls, db: AsyncSession, ws: str, rows: list[Membership]) -> "Org":
        bosses = {m.reports_to_user_id for m in rows if m.reports_to_user_id}
        ids = [m.user_id for m in rows]
        manages = (
            dict(
                (
                    await db.execute(
                        select(Membership.reports_to_user_id, func.count())
                        .where(
                            Membership.workspace_id == ws,
                            Membership.reports_to_user_id.in_(ids),
                        )
                        .group_by(Membership.reports_to_user_id)
                    )
                ).all()
            )
            if ids
            else {}
        )
        return cls(await people.names(db, bosses), manages)


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
    if can(actor.role, "members.manage") and not all(
        within_own(actor, r) for r in (target_role, new_role) if r is not None
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "more_access",
            "You cannot give or change a role that has more access than your own.",
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


# P92: what a role may hold that gives no power over anyone else (their own AI and logins).
_PERSONAL = frozenset({"agents.own", "vault.own"})


def within_own(actor: Principal, role: str) -> bool:
    """P92: nobody but an owner gives a role (or changes someone in a role) with more access
    than their own, so management cannot make an admin to reach the AI engine. Managing all
    members includes managing a team (team.manage)."""
    if actor.role == "owner":
        return True
    mine = set(role_permissions(actor.role))
    if "members.manage" in mine:
        mine.add("team.manage")
    return role_permissions(role) - _PERSONAL <= mine


def assignable_roles(actor: Principal) -> list[str]:
    return assignable_for(actor.role)


def assignable_for(role: str) -> list[str]:
    """The roles someone in `role` may give (as _check_can_touch decides), in the app's
    order. Follows this request's role access (core/security.use_settings)."""
    if can(role, "members.manage"):
        mine = set(role_permissions(role)) | {"team.manage"}
        return [
            r
            for r in ROLES
            if (r == "owner" and can(role, "members.assign_owner"))
            or (r != "owner" and (role == "owner" or role_permissions(r) - _PERSONAL <= mine))
        ]
    allowed = TEAM_ROLES.get(role, set())
    return [r for r in ROLES if r in allowed]


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
    branch_ids: list[str] | None = None,
) -> tuple[str | None, str | None, list[str]]:
    """Check (and complete) where a scoped member sits: (home branch, department, every
    branch they work in, home first). Workspace roles sit nowhere. P98: `branch_ids` are all
    their branches; the home is the department's branch, else `branch_id`, else the first."""
    if role not in SCOPED_ROLES:
        return None, None, []
    if not branch_id and branch_ids:
        branch_id = next((b for b in branch_ids if b), None)
    if department_id:
        d = await db.get(Department, department_id)
        if d is None or d.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department from here."
            )
        branch_id = d.branch_id
    every = ordered(branch_id, branch_ids or [])
    if len(every) > 100:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "too_many_branches", "Pick up to 100 branches."
        )
    for bid in every:
        b = await db.get(Branch, bid)
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
    # P98: a scoped manager places people only in their own branches (each of them).
    if not sc.everything and (
        not all(sc.in_branch(b) for b in every)
        or (sc.kind == "department" and department_id != sc.department_id)
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "outside_scope",
            "You can only add people to {where}.",
            where=sc.label,
        )
    return branch_id, department_id, every


def _member_in_scope(principal: Principal, m: Membership) -> bool:
    sc = principal.scope
    if sc.everything or m.user_id == principal.user.id:
        return True
    if sc.kind == "branch":  # P98: they work in one of the manager's branches
        return any(sc.in_branch(b) for b in m.branch_ids)
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
        return or_(me, member_in_branches(sc.branch_ids))
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
    manager: str = Query(default="", max_length=40),
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
        seen = [m for m in rows if _member_in_scope(principal, m)]
        org = await Org.load(db, ws, seen)
        return [_out(m, names, agents, org) for m in seen]

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
    elif company:  # P98: anyone who works there (home or not)
        where.append(member_in_branches([company]))
    if department:
        where.append(Membership.department_id == department)
    if role:
        where.append(Membership.role == role)
    if manager == "none":
        where.append(Membership.reports_to_user_id.is_(None))
    elif manager:
        where.append(Membership.reports_to_user_id == manager)
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
    org = await Org.load(db, ws, list(rows))
    return MembersPageOut(
        items=[_out(m, names, agents, org) for m in rows],
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
    branch_ids: list[str] | None = None,
    access: str = AGENTIC,
    prima_modules: list[str] | None = None,
) -> tuple[Membership, str | None]:
    """Add one person: the role and place rules, a new account with a one-time password
    (None when they already have an account), and the audit row. One path for the form and
    the Excel import (`via="import"`); the caller commits."""
    _check_can_touch(principal, role, role)
    branch_id, department_id, every = await _placement(
        db, principal, role, branch_id, department_id, branch_ids
    )
    # P99: Prima only, or some Prima screens, from the start (the same rules as a change).
    access, prima_modules = check_prima_access(
        principal, role, access, prima_modules, AGENTIC, None
    )
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
        access=access,
        prima_modules=prima_modules,
    )
    set_branches(m, branch_id, every)
    db.add(m)
    after: dict[str, object] = {
        "email": email,
        "role": role,
        "branch_id": branch_id,
        "department_id": department_id,
    }
    if len(every) > 1:
        after["branch_ids"] = every
    if access != AGENTIC:
        after["access"] = access
    if prima_modules is not None:
        after["prima_modules"] = prima_modules
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
        branch_ids=body.branch_ids,
        access=body.access,
        prima_modules=body.prima_modules,
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
    org_change = body.heads_department is not None or "reports_to_user_id" in body.model_fields_set
    prima_change = body.access is not None or "prima_modules" in body.model_fields_set
    unchanged = body.role is None and body.name is None and body.email is None
    if unchanged and not org_change and not prima_change:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "nothing_to_change", "Nothing to change."
        )
    if body.role is not None:
        await change_access(
            db, principal, user_id, body.role, body.branch_id, body.department_id, body.branch_ids
        )
    if "reports_to_user_id" in body.model_fields_set:
        await set_manager(db, principal, user_id, body.reports_to_user_id)
    if body.heads_department is not None:
        await set_head(db, principal, user_id, body.heads_department)
    if prima_change:  # P99: after the role, so an owner's access is checked against it
        await set_prima_access(
            db,
            principal,
            user_id,
            body.access,
            body.prima_modules,
            "prima_modules" in body.model_fields_set,
        )
    # P92: a name or email typed wrong (in the form or an import) is corrected here. Last:
    # every check runs before anything is saved.
    if body.name is not None or body.email is not None:
        await change_identity(db, principal, user_id, body.name, body.email)
    await db.commit()
    return await _one_out(db, principal, user_id)


async def _one_out(db: AsyncSession, principal: Principal, user_id: str) -> MemberOut:
    m = await _membership(db, principal.workspace_id, user_id)
    await db.refresh(m)
    org = await Org.load(db, principal.workspace_id, [m])
    return _out(m, await _names(db, principal.workspace_id), None, org)


# ---------------------------------------------------------------- P97 who reports to whom


def _org_editor(principal: Principal) -> None:
    """Who reports to whom and who heads a department: whoever manages all members
    (members.manage: owner, admin, management, HR by default)."""
    if not can(principal.role, "members.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only owners, admins, management and HR set who reports to whom.",
        )


async def set_manager(
    db: AsyncSession, principal: Principal, user_id: str, manager_id: str | None
) -> Membership:
    """One person reports to `manager_id` (None: to no one), with every rule; the caller
    commits. The manager is a member in a role that manages people; no loops."""
    _org_editor(principal)
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    if manager_id == m.reports_to_user_id:
        return m
    if manager_id is not None:
        if manager_id == user_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "self_manager", "Nobody reports to themselves."
            )
        boss = await db.get(Membership, (principal.workspace_id, manager_id))
        if boss is None or not boss.user.is_active:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_manager", "Pick a manager who is a member here."
            )
        if boss.role not in people.MANAGER_ROLES:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "not_a_manager",
                "{name} is {role}, a role that does not manage people. Make them a head of "
                "department, supervisor or manager first.",
                name=boss.user.name,
                role=role_label(boss.role),
            )
        up, seen = boss, set()
        while up is not None and up.reports_to_user_id and up.user_id not in seen:
            seen.add(up.user_id)
            if up.reports_to_user_id == user_id:
                raise api_error(
                    status.HTTP_409_CONFLICT,
                    "manager_loop",
                    "{boss} already reports to {name}, so {name} cannot report to {boss}.",
                    boss=boss.user.name,
                    name=m.user.name,
                )
            up = await db.get(Membership, (principal.workspace_id, up.reports_to_user_id))
    before = m.reports_to_user_id
    m.reports_to_user_id = manager_id
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.manager_changed",
        target=user_id,
        before={"reports_to": before},
        after={"reports_to": manager_id},
    )
    await db.flush()
    return m


async def set_head(db: AsyncSession, principal: Principal, user_id: str, on: bool) -> Membership:
    """P97: this person heads the department they sit in (a department may have several)."""
    _org_editor(principal)
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    if on and not m.department_id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "no_department",
            "Put them in a department first: they head the department they sit in.",
        )
    if bool(m.heads_department) != on:
        m.heads_department = on
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "member.head_changed",
            target=user_id,
            after={"heads_department": on, "department_id": m.department_id},
        )
        await db.flush()
    return m


@router.get("/{user_id}/team")
async def member_team(
    user_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut]:
    """P97: the people who report to this member (anyone who may see the member)."""
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    rows = list(
        (
            await db.scalars(
                select(Membership)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.workspace_id == principal.workspace_id,
                    Membership.reports_to_user_id == user_id,
                )
                .order_by(func.lower(User.name))
            )
        ).all()
    )
    names = await _names(db, principal.workspace_id)
    org = await Org.load(db, principal.workspace_id, rows)
    return [_out(r, names, None, org) for r in rows]


@router.put("/{user_id}/team")
async def set_member_team(
    user_id: str,
    body: MemberTeamIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> MembersBulkOut:
    """P97: exactly these people report to this member ("Manages"): the ones listed are
    placed under them, the ones who reported to them and are not listed report to no one.
    Each change follows set_manager's rules; anyone the rules stop is skipped and says why."""
    _org_editor(principal)
    boss = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, boss):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    want = list(dict.fromkeys(body.user_ids))
    now = set(await people.direct_reports(db, principal.workspace_id, user_id))
    results: list[MembersBulkResult] = []
    for uid, target in [*((u, user_id) for u in want), *((u, None) for u in now - set(want))]:
        try:
            async with db.begin_nested():
                await set_manager(db, principal, uid, target)
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            results.append(
                MembersBulkResult(
                    user_id=uid, ok=False, message=render(detail.get("message", ""), current_lang())
                )
            )
            continue
        results.append(MembersBulkResult(user_id=uid, ok=True))
    await db.commit()
    done = sum(1 for r in results if r.ok)
    return MembersBulkOut(results=results, done=done, skipped=len(results) - done)


async def email_taken(db: AsyncSession, email: str, user_id: str) -> bool:
    return (
        await db.scalar(select(User.id).where(User.email == email, User.id != user_id).limit(1))
    ) is not None


async def change_identity(
    db: AsyncSession,
    principal: Principal,
    user_id: str,
    name: str | None,
    email: str | None,
) -> Membership:
    """P92: correct someone's name or sign-in email (members.manage; only an owner corrects
    an owner). A new email lets go of the Microsoft account the old one was linked to and
    signs them out everywhere (services/identity); the caller commits."""
    if not can(principal.role, "members.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Your role ({role}) cannot change names or emails.",
            role=role_label(principal.role),
        )
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "Change your own name or email in Settings.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    user = m.user
    new_name = " ".join(name.split()) if name is not None else user.name
    new_email = email.strip().lower() if email is not None else user.email
    if not new_name:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "name_required", "Type a name.")
    if new_name == user.name and new_email == user.email:
        return m
    elsewhere = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.user_id == user_id, Membership.workspace_id != principal.workspace_id)
    )
    if elsewhere:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "other_workspace",
            "This person is also in another workspace, so their name and email are not changed "
            "from here.",
        )
    if new_email != user.email and await email_taken(db, new_email, user_id):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "email_taken",
            "{email} already belongs to another account.",
            email=new_email,
        )
    before = {"name": user.name, "email": user.email}
    after: dict[str, object] = {"name": new_name, "email": new_email}
    email_changed = new_email != user.email
    user.name, user.email = new_name, new_email
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.identity_changed",
        target=user_id,
        before=before,
        after=after,
    )
    if email_changed:
        await _let_go(db, principal, user_id, "member.microsoft_reset", "their email changed")
    else:
        await identity.prima_follows(db, principal.workspace_id, user_id, name_only=True)
    await db.flush()
    return m


async def _let_go(db: AsyncSession, principal: Principal, user_id: str, action: str, why: str):
    """The Microsoft link and sessions after a correction, audited (services/identity)."""
    await db.flush()
    done = await identity.let_go_of_microsoft(db, principal.workspace_id, user_id)  # commits
    sessions = await identity.sign_out_everywhere(db, user_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        action,
        target=user_id,
        after={**done, "sessions_ended": sessions},
        note=f"Microsoft link reset: {why}; they sign in again",
    )


@router.post("/{user_id}/reset-microsoft")
async def reset_microsoft(
    user_id: str,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    """P92: let go of the Microsoft account a person is linked to (the wrong one signed in as
    them), without changing their email: their next Microsoft sign-in links again."""
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "Change your own name or email in Settings.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    await _let_go(db, principal, user_id, "member.microsoft_reset", "reset by hand")
    await db.commit()
    m = await _membership(db, principal.workspace_id, user_id)
    await db.refresh(m)
    return _out(m, await _names(db, principal.workspace_id))


async def change_access(
    db: AsyncSession,
    principal: Principal,
    user_id: str,
    role: str,
    branch_id: str | None,
    department_id: str | None,
    branch_ids: list[str] | None = None,
) -> Membership:
    """One person's role and place, with every rule (one path for the row and the bulk
    change, P82); the caller commits. P98: `branch_ids` is every branch they work in."""
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
    branch_id, department_id, every = await _placement(
        db, principal, role, branch_id, department_id, branch_ids
    )
    sc = principal.scope
    if every and not sc.everything:
        # P98: a scoped manager neither sees nor changes the person's other branches (outside
        # their own): those stay as they are.
        every += [b for b in m.branch_ids if not sc.in_branch(b) and b not in every]
    if m.role == "owner" and role != "owner" and await _owner_count(db, m.workspace_id) <= 1:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "last_owner", "A workspace needs at least one owner."
        )
    before: dict[str, object] = {
        "role": m.role,
        "branch_id": m.branch_id,
        "department_id": m.department_id,
        "branch_ids": m.branch_ids,
    }
    if department_id != m.department_id:
        m.heads_department = False  # P97: they headed the department they left
    if role not in people.MANAGER_ROLES and m.role in people.MANAGER_ROLES:
        # P97: a role that manages no one: the people who reported to them report to no one.
        for r in await db.scalars(
            select(Membership).where(
                Membership.workspace_id == m.workspace_id,
                Membership.reports_to_user_id == user_id,
            )
        ):
            r.reports_to_user_id = None
    m.role, m.department_id = role, department_id
    set_branches(m, branch_id, every)
    if role == "owner" and (m.access != AGENTIC or m.prima_modules is not None):
        # P99: owners always have the office and all of Prima.
        before["access"], before["prima_modules"] = m.access, m.prima_modules
        m.access, m.prima_modules = AGENTIC, None
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.role_changed",
        target=user_id,
        before=before,
        after={
            "role": role,
            "branch_id": branch_id,
            "department_id": department_id,
            "branch_ids": every,
        },
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
    for r in await db.scalars(  # P97: their people report to no one now
        select(Membership).where(
            Membership.workspace_id == principal.workspace_id,
            Membership.reports_to_user_id == user_id,
        )
    ):
        r.reports_to_user_id = None
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
    if body.action == "manager":
        _org_editor(principal)
    if body.action == "prima":
        _prima_access_editor(principal)
        if body.access is None and "prima_modules" not in body.model_fields_set:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "nothing_to_change", "Nothing to change."
            )
    results: list[MembersBulkResult] = []
    for user_id in dict.fromkeys(body.user_ids):  # each person once
        try:
            async with db.begin_nested():
                if body.action == "remove":
                    await remove_one(db, principal, user_id)
                elif body.action == "manager":  # P97: they all report to this manager
                    await set_manager(db, principal, user_id, body.manager_id)
                elif body.action == "prima":  # P99: what they reach
                    await set_prima_access(
                        db,
                        principal,
                        user_id,
                        body.access,
                        body.prima_modules,
                        "prima_modules" in body.model_fields_set,
                    )
                else:
                    assert body.role is not None
                    await change_access(
                        db,
                        principal,
                        user_id,
                        body.role,
                        body.branch_id,
                        body.department_id,
                        body.branch_ids,
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


# ---------------------------------------------------------------- P99 what each person reaches
#
# Access: the office and Prima ("agentic", everyone by default), or Prima only. Prima screens:
# all their Prima role allows (None), or a chosen list (prima/modules.py), on top of Prima's own
# role checks: a choice only narrows. Set by whoever manages all members (members.manage:
# owner, admin, management and HR by default), for people in their scope, never themselves,
# never an owner, and never beyond what they have themselves. Every change is audited.


def _prima_access_editor(principal: Principal) -> None:
    if not can(principal.role, "members.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only owners, admins, management and HR set what someone reaches.",
        )


def check_prima_access(
    principal: Principal,
    role: str,
    access: str | None,
    chosen: list[str] | None,
    old_access: str,
    old_chosen: list[str] | None,
    set_chosen: bool = True,
) -> tuple[str, list[str] | None]:
    """The access and Prima screens this person may be given (cleaned), or the refusal.
    `access` None keeps `old_access`; `set_chosen` False keeps `old_chosen`."""
    if access is not None and access not in ACCESS:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_access", "Pick an access.")
    if set_chosen and chosen is not None:
        known = set(modules.ids())
        if any(c not in known for c in chosen):
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_module",
                "Pick Prima screens from the list.",
            )
    new_access = old_access if access is None else access
    new_chosen = modules.clean(chosen) if set_chosen else old_chosen
    if new_access == old_access and new_chosen == old_chosen:
        return new_access, new_chosen
    _prima_access_editor(principal)
    if role == "owner" and (new_access != AGENTIC or new_chosen is not None):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "owner_access",
            "Owners always have the office and all of Prima.",
        )
    # Nobody gives more than they have: someone with chosen screens gives only those (or what
    # the other person already had); all of Prima only from someone who has all of it.
    mine = None if principal.role == "owner" else principal.prima_modules
    if mine is not None and new_chosen != old_chosen:
        had = set(modules.ids()) if old_chosen is None else set(old_chosen)
        if new_chosen is None or not set(new_chosen) <= set(mine) | had:
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "more_access",
                "You can give only the Prima screens you have yourself.",
            )
    return new_access, new_chosen


async def set_prima_access(
    db: AsyncSession,
    principal: Principal,
    user_id: str,
    access: str | None,
    chosen: list[str] | None,
    set_chosen: bool,
) -> Membership:
    """One person's access and Prima screens, with every rule; the caller commits."""
    _prima_access_editor(principal)
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "self_change",
            "You cannot change your own access. Ask another owner or admin.",
        )
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    _check_can_touch(principal, m.role)
    if m.role == "owner" or is_developer(m.user, m.role):
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "owner_access",
            "Owners always have the office and all of Prima.",
        )
    before = {"access": m.access, "prima_modules": m.prima_modules}
    new_access, new_chosen = check_prima_access(
        principal, m.role, access, chosen, m.access, m.prima_modules, set_chosen
    )
    if new_access == m.access and new_chosen == m.prima_modules:
        return m
    m.access, m.prima_modules = new_access, new_chosen
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.prima_access",
        target=user_id,
        before=before,
        after={"access": new_access, "prima_modules": new_chosen},
    )
    await db.flush()
    return m


@router.put("/{user_id}/prima-access")
async def put_prima_access(
    user_id: str,
    body: PrimaAccessIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    """P99: what one member reaches (the office and Prima, or Prima only) and their screens."""
    if body.access is None and "prima_modules" not in body.model_fields_set:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "nothing_to_change", "Nothing to change."
        )
    await set_prima_access(
        db,
        principal,
        user_id,
        body.access,
        body.prima_modules,
        "prima_modules" in body.model_fields_set,
    )
    await db.commit()
    return await _one_out(db, principal, user_id)


def _words(w: dict[str, str]) -> str:
    return w.get(current_lang()) or w["en"]


@router.get("/prima-modules")
async def prima_modules(
    principal: Principal = Depends(require("members.manage")),
) -> dict[str, object]:
    """P99: Prima's screens to choose from, in its own apps and groups and the reader's
    language; the ones everyone keeps; and the ones the reader may give (null: all)."""
    always = set(modules.ALWAYS)
    return {
        "enabled": prima_client.enabled(principal.workspace_id),
        "always": list(modules.ALWAYS),
        "mine": None if principal.role == "owner" else principal.prima_modules,
        "apps": [
            {
                "id": a["id"],
                "title": _words(a["title"]),
                "blurb": _words(a["blurb"]),
                "groups": [
                    {
                        "title": _words(g["title"]),
                        "modules": [
                            {
                                "id": x["id"],
                                "title": _words(x["title"]),
                                "blurb": _words(x["blurb"]),
                                "always": x["id"] in always,
                            }
                            for x in g["modules"]
                        ],
                    }
                    for g in a["groups"]
                ],
            }
            for a in modules.catalog()["apps"]  # type: ignore[union-attr]
        ],
    }


# Prima's roles (apps/prima/packages/core User role), named as its own menu names them.
PRIMA_ROLE_LABELS = {
    "director": Msg("Group leadership"),
    "pwvsb_officer": Msg("PWVSB staff"),
    "company_manager": Msg("Company Manager"),
    "admin_exec": Msg("Admin Executive"),
    "supervisor": Msg("Supervisor"),
    "guard": Msg("Guard"),
    "site_device": Msg("Site device"),
}


def _prima_role(role: str) -> str:
    label = PRIMA_ROLE_LABELS.get(role)
    return label.render() if label is not None else role


@router.get("/{user_id}/prima")
async def member_prima(
    user_id: str,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """P99: the Prima role this member has and where it is set, for the Access section."""
    m = await _membership(db, principal.workspace_id, user_id)
    if not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    out: dict[str, object] = {
        "enabled": prima_client.enabled(principal.workspace_id),
        "role": None,
        "role_label": None,
        "where": "",
        "record": None,
    }
    if not out["enabled"]:
        out["where"] = render(Msg("Prima is not set up on this server."))
        return out
    office_role = render(role_label(m.role))
    if prima_client.opens_as_top(m):
        out["role"], out["role_label"] = "director", _prima_role("director")
        out["where"] = render(Msg("Owners open Prima as its top record (the CEO)."))
        return out
    link = await db.get(PrimaLink, (principal.workspace_id, user_id))
    auto = prima_client.prima_role(m.role)
    if link is None:
        out["role"], out["role_label"] = auto, _prima_role(auto)
        out["where"] = render(
            Msg(
                "Not opened Prima yet. Prima uses their staff record if it has one; else they "
                "get {prima_role} from their office role ({role}).",
                prima_role=_prima_role(auto),
                role=office_role,
            )
        )
        return out
    out["record"] = link.prima_name
    if link.how == "auto":
        out["role"], out["role_label"] = auto, _prima_role(auto)
        out["where"] = render(
            Msg(
                "Their own Prima account, given from their office role ({role}) when they first "
                "opened Prima.",
                role=office_role,
            )
        )
        return out
    try:
        record = next((r for r in await prima_client.staff() if r.id == link.prima_user_id), None)
    except PrimaError:
        record = None
    if record is not None:
        out["role"], out["role_label"] = record.role, _prima_role(record.role)
    out["where"] = render(
        Msg(
            "Their Prima staff record ({name}). Its role is set in Prima, on that record.",
            name=link.prima_name,
        )
    )
    return out
