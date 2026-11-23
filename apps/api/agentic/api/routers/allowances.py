"""P36: the owner's controls over how people use AI: each person's daily AI allowance and the
work-scope guard (teams/allowance.py, agents/scope_guard.py).

- GET  /api/me/allowance              my allowance today (everyone)
- GET  /api/allowances                the policy and everyone's use today (people managers);
                                      P96: ?q=&role=&branch=&status=&page=&size=&sort= for the
                                      data table (api/table.py), X-Total-Count = matching people
- PUT  /api/allowances/policy         the default allowance and who it applies to (owner, admin)
- PUT  /api/allowances/{user_id}      one person's own allowance (people managers, in scope)
- POST /api/allowances/{user_id}/give P114: add tokens for today only or for this week, and resume
                                      their tasks paused at the limit (people managers, in scope,
                                      never for themselves)
- GET  /api/allowances/paused         P114: tasks paused at a person's limit, first paused first
- GET  /api/work-scope                what staff may use their AI for (people managers)
- PUT  /api/work-scope                change it (owner, admin)
- GET  /api/work-scope/refusals       recent requests the guard refused (people managers)
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...agents import decisions, scope_guard
from ...core.db import get_db
from ...core.security import ROLES, can
from ...core.valkey import valkey
from ...models import Agent, Approval, AuditLog, LLMCall, Membership, Task, Workspace
from ...services import audit
from ...teams import allowance
from ...teams.budget import periods
from ..deps import Principal, api_error, current_principal, require
from ..paging import TOTAL
from ..table import TableParams, matches, page_of
from .members import _member_in_scope, _names, people_manager

router = APIRouter(prefix="/api", tags=["allowances"])


class AllowanceOut(BaseModel):
    used: int
    limit: int | None
    remaining: int | None
    extra: int
    over: bool
    day: str
    resets_at: str


class PersonAllowance(AllowanceOut):
    user_id: str
    name: str
    email: str
    role: str
    # The person's own setting: None = the default for their role, 0 = no limit.
    own: int | None
    # P96: where they sit, what today cost, and how much of the limit is used.
    branch_id: str | None = None
    branch_name: str | None = None
    department_name: str | None = None
    cost_usd: float = 0.0
    pct: int | None = None  # None = no limit
    status: str = "ok"  # ok | near (80% or more) | over | unlimited
    # P114: of `extra`, what was given for every day of this week; tasks paused at the limit.
    extra_week: int = 0
    paused: int = 0


class PolicyIn(BaseModel):
    daily_tokens: int = Field(ge=0, le=allowance.MAX_DAILY_TOKENS)
    roles: list[str] = Field(default_factory=lambda: list(allowance.DEFAULT_ROLES))
    # P51: the office's own pool (work nobody asked for). None keeps it as it is; 0 = no limit.
    office_daily_tokens: int | None = Field(default=None, ge=0, le=allowance.MAX_DAILY_TOKENS * 10)


class AllowanceSummary(BaseModel):
    people: int = 0
    over: int = 0
    near: int = 0
    used: int = 0
    cost_usd: float = 0.0
    paused: int = 0  # P114: tasks waiting for more allowance


class AllowancesOut(BaseModel):
    policy: PolicyIn
    # With ?page=: one page of the matching people; else every person in scope.
    people: list[PersonAllowance]
    total: int = 0
    # Everyone in scope, whatever the search (the stat tiles).
    summary: AllowanceSummary = Field(default_factory=AllowanceSummary)


class OwnIn(BaseModel):
    daily_tokens: int | None = Field(default=None, ge=0, le=allowance.MAX_DAILY_TOKENS)


class ScopeIO(BaseModel):
    enabled: bool = True
    roles: list[str] = Field(default_factory=lambda: list(scope_guard.DEFAULT_ROLES))
    about: str = Field(default="", max_length=scope_guard.MAX_ABOUT)


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return ws


def _roles(roles: list[str]) -> list[str]:
    bad = [r for r in roles if r not in ROLES]
    if bad:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_role",
            "There is no role called {role}.",
            role=bad[0],
        )
    # The owner is never limited by a policy (they can still set their own allowance).
    return sorted({r for r in roles if r != "owner"})


def _set(ws: Workspace, key: str, value: dict[str, Any]) -> None:
    ws.settings = {**(ws.settings or {}), key: value}
    flag_modified(ws, "settings")


@router.get("/me/allowance")
async def my_allowance(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> AllowanceOut:
    st = await allowance.state(db, await _ws(db, principal), principal.user.id)
    return AllowanceOut(**st.dict())


NEAR = 0.8  # "near the limit" from 80% used
SORTS = ("name", "email", "role", "place", "used", "cost", "limit", "pct", "paused")
Status = Literal["ok", "near", "over", "unlimited", "limited", "paused"]


def _status(used: int, limit: int | None) -> tuple[int | None, str]:
    """(percent of the limit used, ok | near | over | unlimited)."""
    if limit is None:
        return None, "unlimited"
    pct = 100 if not limit else min(999, round(used * 100 / limit))
    if used >= limit:
        return pct, "over"
    return pct, "near" if used >= limit * NEAR else "ok"


def _person(
    m: Membership,
    names: dict[str, str],
    used: int,
    cost: float,
    base: int | None,
    extra: int,
    day: str,
    resets: str,
    extra_week: int = 0,
    paused: int = 0,
) -> PersonAllowance:
    """allowance.state() for one person, from numbers worked out for everyone at once."""
    limit = None if base is None else base + extra
    pct, state = _status(used, limit)
    return PersonAllowance(
        used=used,
        limit=limit,
        remaining=None if limit is None else max(0, limit - used),
        extra=extra if base is not None else 0,
        over=limit is not None and used >= limit,
        day=day,
        resets_at=resets,
        user_id=m.user_id,
        name=m.user.name,
        email=m.user.email,
        role=m.role,
        own=m.ai_daily_tokens,
        branch_id=m.branch_id,
        branch_name=names.get(m.branch_id or ""),
        department_name=names.get(m.department_id or ""),
        cost_usd=round(cost, 4),
        pct=pct,
        status=state,
        extra_week=extra_week if base is not None else 0,
        paused=paused,
    )


async def _costs_today(db: AsyncSession, ws: Workspace, day_start: datetime) -> dict[str, float]:
    """Today's model cost per person (USD), counted the way the allowance counts tokens."""
    q = (
        select(LLMCall.user_id, func.coalesce(func.sum(LLMCall.cost_usd), 0))
        .where(
            LLMCall.workspace_id == ws.id,
            LLMCall.user_id.is_not(None),
            LLMCall.ts >= day_start,
        )
        .group_by(LLMCall.user_id)
    )
    for prefix in allowance.NOT_CHARGED:
        q = q.where(~LLMCall.task.startswith(prefix))
    return {str(u): float(c or 0) for u, c in (await db.execute(q)).all()}


async def _grants(ws_id: str, user_ids: list[str], day: str) -> dict[str, tuple[int, int]]:
    """What managers gave each person for today: (today only, every day this week), in one
    Valkey round trip."""
    if not user_ids:
        return {}
    keys = [k for u in user_ids for k in allowance.grant_keys(ws_id, u, day)]
    try:
        raw = await valkey().mget(keys)
    except Exception:  # noqa: BLE001 - no Valkey: no extra today
        return {}
    return {u: (int(raw[2 * i] or 0), int(raw[2 * i + 1] or 0)) for i, u in enumerate(user_ids)}


def _paused_q(ws_id: str) -> Select[tuple[Approval]]:
    """Tasks stopped at a person's daily limit: their pending allowance approvals."""
    return select(Approval).where(
        Approval.workspace_id == ws_id,
        Approval.status == "pending",
        Approval.kind == "budget",
        Approval.tool_call_id.startswith("allowance:"),
    )


async def _paused_by_person(db: AsyncSession, ws_id: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for a in (await db.scalars(_paused_q(ws_id))).all():
        u = str((a.args or {}).get("user_id") or "")
        if u:
            out[u] = out.get(u, 0) + 1
    return out


def _place(p: PersonAllowance) -> str:
    return f"{p.branch_name or ''} {p.department_name or ''}".strip().lower()


SORT_KEYS: dict[str, Any] = {
    "name": lambda p: p.name.lower(),
    "email": lambda p: p.email.lower(),
    "role": lambda p: p.role,
    "place": _place,
    "used": lambda p: p.used,
    "cost": lambda p: p.cost_usd,
    "limit": lambda p: p.limit,
    "pct": lambda p: p.pct,
    "paused": lambda p: p.paused,
}


@router.get("/allowances")
async def list_allowances(
    response: Response,
    params: TableParams = Depends(),
    role: str | None = Query(default=None, max_length=16),
    branch: str | None = Query(default=None, max_length=40),
    status_: Status | None = Query(default=None, alias="status"),
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> AllowancesOut:
    """Everyone the caller manages, with today's use. P96: worked out for all of them in a few
    queries (it was three per person), then searched, filtered, sorted and paged for the data
    table. `branch` is a branch id or "none"; `status` is ok, near, over, unlimited or limited."""
    ws = await _ws(db, principal)
    daily, roles = allowance.policy(ws)
    p = periods(ws.timezone)
    resets = (p.day_start + timedelta(days=1)).isoformat()
    used = await allowance.used_by_person(db, ws)
    costs = await _costs_today(db, ws, p.day_start)
    names = await _names(db, ws.id)
    rows = [
        m
        for m in (
            await db.scalars(select(Membership).where(Membership.workspace_id == ws.id))
        ).all()
        if _member_in_scope(principal, m)
    ]
    limits = {m.user_id: allowance.limit_of(ws, m) for m in rows}
    grants = await _grants(ws.id, [u for u, b in limits.items() if b is not None], p.day)
    paused = await _paused_by_person(db, ws.id)
    everyone = [
        _person(
            m,
            names,
            used.get(m.user_id, 0),
            costs.get(m.user_id, 0.0),
            limits[m.user_id],
            sum(grants.get(m.user_id, (0, 0))),
            p.day,
            resets,
            extra_week=grants.get(m.user_id, (0, 0))[1],
            paused=paused.get(m.user_id, 0),
        )
        for m in rows
    ]
    summary = AllowanceSummary(
        people=len(everyone),
        over=sum(1 for x in everyone if x.status == "over"),
        near=sum(1 for x in everyone if x.status == "near"),
        used=sum(x.used for x in everyone),
        cost_usd=round(sum(x.cost_usd for x in everyone), 4),
        paused=sum(x.paused for x in everyone),
    )
    people = everyone
    if params.words:
        people = [x for x in people if matches(params.words, x.name, x.email)]
    if role:
        people = [x for x in people if x.role == role]
    if branch:
        people = [x for x in people if (x.branch_id or "none") == branch]
    if status_ == "limited":
        people = [x for x in people if x.limit is not None]
    elif status_ == "paused":
        people = [x for x in people if x.paused]
    elif status_:
        people = [x for x in people if x.status == status_]
    # The usual order (and the tie-break of any other): most used first, then by name.
    people.sort(key=lambda x: (-(x.used or 0), x.name.lower()))
    key, desc = params.sort_by(SORTS)
    people = page_of(people, params, response, SORT_KEYS.get(key), desc)
    office = allowance.office_limit(ws) or 0
    return AllowancesOut(
        policy=PolicyIn(daily_tokens=daily, roles=list(roles), office_daily_tokens=office),
        people=people,
        total=int(response.headers[TOTAL]),
        summary=summary,
    )


@router.put("/allowances/policy")
async def set_policy(
    body: PolicyIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> PolicyIn:
    ws = await _ws(db, principal)
    before = dict((ws.settings or {}).get("ai_allowance") or {})
    value: dict[str, Any] = {"daily_tokens": body.daily_tokens, "roles": _roles(body.roles)}
    office = before.get("office_daily_tokens", allowance.DEFAULT_OFFICE_DAILY)
    value["office_daily_tokens"] = (
        body.office_daily_tokens if body.office_daily_tokens is not None else office
    )
    _set(ws, "ai_allowance", value)
    await audit.record(
        db, ws.id, principal.actor, "allowance.policy", target=ws.id, before=before, after=value
    )
    await db.commit()
    return PolicyIn(**value)


@router.put("/allowances/{user_id}")
async def set_own(
    user_id: str,
    body: OwnIn,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> PersonAllowance:
    ws = await _ws(db, principal)
    m = await db.get(Membership, (ws.id, user_id))
    if m is None or not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    if user_id == principal.user.id and not can(principal.role, "members.manage"):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "self_allowance",
            "You cannot change your own AI allowance. Ask an owner or admin.",
        )
    if m.role == "owner" and not can(principal.role, "members.assign_owner"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only an owner can change owner access."
        )
    if body.daily_tokens == 0 and not can(principal.role, "members.manage"):
        # P123: no limit at all is for owners and admins to give, to the people they manage.
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "unlimited_admin_only",
            "Only owners and admins can give unlimited AI. Give more for today or this week, "
            "or set a higher daily limit.",
        )
    before = m.ai_daily_tokens
    m.ai_daily_tokens = body.daily_tokens
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "allowance.person",
        target=user_id,
        before={"daily_tokens": before},
        after={"daily_tokens": body.daily_tokens},
    )
    await db.commit()
    return await _row(db, ws, m)


async def _row(db: AsyncSession, ws: Workspace, m: Membership) -> PersonAllowance:
    """One person's row, as the table shows it."""
    st = await allowance.state(db, ws, m.user_id)
    pct, state = _status(st.used, st.limit)
    names = await _names(db, ws.id)
    week = (await _grants(ws.id, [m.user_id], st.day)).get(m.user_id, (0, 0))[1]
    paused = (await _paused_by_person(db, ws.id)).get(m.user_id, 0)
    return PersonAllowance(
        **st.dict(),
        user_id=m.user_id,
        name=m.user.name,
        email=m.user.email,
        role=m.role,
        own=m.ai_daily_tokens,
        branch_id=m.branch_id,
        branch_name=names.get(m.branch_id or ""),
        department_name=names.get(m.department_id or ""),
        pct=pct,
        status=state,
        extra_week=week if st.limit is not None else 0,
        paused=paused,
    )


class GiveIn(BaseModel):
    tokens: int = Field(ge=1000, le=allowance.MAX_GIVE)
    span: allowance.Span = "today"


class GiveOut(BaseModel):
    person: PersonAllowance
    given: int
    span: str
    ends_at: str
    resumed: int  # paused tasks started again


@router.post("/allowances/{user_id}/give")
async def give_more(
    user_id: str,
    body: GiveIn,
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> GiveOut:
    """P114 (Fitri, 18 Nov 2026): add tokens to a person's limit for today only, or for every
    day to the end of this week, then start their tasks paused at the limit again, first
    paused first. Like approving the ask: never for yourself."""
    ws = await _ws(db, principal)
    m = await db.get(Membership, (ws.id, user_id))
    if m is None or not _member_in_scope(principal, m):
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That member is not here.")
    if user_id == principal.user.id:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "self_allowance",
            "You cannot give yourself more AI allowance. Ask another manager.",
        )
    if allowance.limit_of(ws, m) is None:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "no_limit",
            "{name} has no daily limit, so there is nothing to add.",
            name=m.user.name,
        )
    try:
        ends = await allowance.give(ws, user_id, body.tokens, body.span)
    except Exception as e:  # noqa: BLE001 - Valkey down: nothing was given
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "allowance_store_down",
            "Could not save the extra allowance. Try again in a moment.",
        ) from e
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "allowance.given",
        target=user_id,
        after={"tokens": body.tokens, "span": body.span, "ends_at": ends},
    )
    await db.commit()
    resumed = 0
    waiting = (await db.scalars(_paused_q(ws.id).order_by(Approval.created_at, Approval.id))).all()
    for a in waiting:
        if str((a.args or {}).get("user_id") or "") != user_id:
            continue
        if not await decisions._may_grant(db, a, principal.actor):  # noqa: SLF001
            continue  # their task waits for a manager who may give more
        # Saved before deciding (decide re-reads the row): the run applies this gift, not
        # its usual "half again".
        a.args = {**(a.args or {}), "given": {"tokens": body.tokens, "span": body.span}}
        await db.commit()
        try:
            await decisions.decide(
                db, a, principal.actor, "approve", answer="More AI allowance was given."
            )
            resumed += 1
        except decisions.DecisionError:
            await db.rollback()  # decided meanwhile, or this manager may not decide it
    await allowance.tell_given(
        db, ws, user_id, principal.user.name, body.tokens, body.span, resumed
    )
    return GiveOut(
        person=await _row(db, ws, m),
        given=body.tokens,
        span=body.span,
        ends_at=ends,
        resumed=resumed,
    )


class PausedTask(BaseModel):
    approval_id: str
    task_id: str
    title: str
    user_id: str
    name: str  # whose allowance it is: the person who started the work
    agent_id: str | None = None
    agent_name: str | None = None  # their AI, by whatever name they gave it
    agent_owner_name: str | None = None  # whose AI it is
    used: int = 0
    limit: int = 0
    paused_at: str
    order: int  # 1 = paused first


@router.get("/allowances/paused")
async def paused_tasks(
    principal: Principal = Depends(people_manager()), db: AsyncSession = Depends(get_db)
) -> list[PausedTask]:
    """P114: every task waiting because the person it is for used up today's allowance, in
    the people the caller manages, first paused first (the order a gift starts them again)."""
    ws = await _ws(db, principal)
    rows = (
        await db.scalars(_paused_q(ws.id).order_by(Approval.created_at, Approval.id).limit(500))
    ).all()
    if not rows:
        return []
    members = {
        m.user_id: m
        for m in (
            await db.scalars(select(Membership).where(Membership.workspace_id == ws.id))
        ).all()
    }
    task_ids = {a.task_id for a in rows}
    tasks = {t.id: t for t in (await db.scalars(select(Task).where(Task.id.in_(task_ids)))).all()}
    agent_ids = {a.agent_id for a in rows if a.agent_id}
    agents = {
        g.id: g for g in (await db.scalars(select(Agent).where(Agent.id.in_(agent_ids)))).all()
    }
    out: list[PausedTask] = []
    for a in rows:
        args = a.args or {}
        m = members.get(str(args.get("user_id") or ""))
        t = tasks.get(a.task_id)
        if m is None or t is None or not _member_in_scope(principal, m):
            continue
        g = agents.get(a.agent_id or "")
        owner = members.get(g.owner_user_id or "") if g is not None else None
        out.append(
            PausedTask(
                approval_id=a.id,
                task_id=t.id,
                title=t.title,
                user_id=m.user_id,
                name=m.user.name,
                agent_id=g.id if g else None,
                agent_name=g.name if g else None,
                agent_owner_name=owner.user.name if owner else None,
                used=int(args.get("used") or 0),
                limit=int(args.get("limit") or 0),
                paused_at=a.created_at.isoformat(),
                order=len(out) + 1,
            )
        )
    return out


@router.get("/work-scope")
async def get_scope(
    principal: Principal = Depends(people_manager()), db: AsyncSession = Depends(get_db)
) -> ScopeIO:
    enabled, roles, about = scope_guard.settings_of(await _ws(db, principal))
    return ScopeIO(enabled=enabled, roles=list(roles), about=about)


@router.put("/work-scope")
async def set_scope(
    body: ScopeIO,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> ScopeIO:
    ws = await _ws(db, principal)
    before = dict((ws.settings or {}).get("work_scope") or {})
    value = {"enabled": body.enabled, "roles": _roles(body.roles), "about": body.about.strip()}
    _set(ws, "work_scope", value)
    await audit.record(
        db, ws.id, principal.actor, "work_scope.changed", target=ws.id, before=before, after=value
    )
    await db.commit()
    return ScopeIO(**value)


class RefusalOut(BaseModel):
    at: str
    user_id: str | None
    name: str
    where: str
    text: str
    why: str


@router.get("/work-scope/refusals")
async def refusals(
    limit: int = Query(default=30, ge=1, le=200),
    principal: Principal = Depends(people_manager()),
    db: AsyncSession = Depends(get_db),
) -> list[RefusalOut]:
    rows = (
        await db.scalars(
            select(AuditLog)
            .where(
                AuditLog.workspace_id == principal.workspace_id,
                AuditLog.action == "ai.out_of_scope",
            )
            .order_by(AuditLog.id.desc())
            .limit(limit)
        )
    ).all()
    members = {
        m.user_id: m
        for m in (
            await db.scalars(
                select(Membership).where(Membership.workspace_id == principal.workspace_id)
            )
        ).all()
    }
    out = []
    for e in rows:
        m = members.get(e.target or "")
        if m is None or not _member_in_scope(principal, m):
            continue
        after = e.after or {}
        out.append(
            RefusalOut(
                at=e.ts.isoformat(),
                user_id=e.target,
                name=m.user.name,
                where=str(after.get("where") or ""),
                text=str(after.get("text") or ""),
                why=str(after.get("why") or ""),
            )
        )
    return out
