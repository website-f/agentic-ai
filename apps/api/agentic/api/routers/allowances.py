"""P36: the owner's controls over how people use AI: each person's daily AI allowance and the
work-scope guard (teams/allowance.py, agents/scope_guard.py).

- GET  /api/me/allowance              my allowance today (everyone)
- GET  /api/allowances                the policy and everyone's use today (people managers)
- PUT  /api/allowances/policy         the default allowance and who it applies to (owner, admin)
- PUT  /api/allowances/{user_id}      one person's own allowance (people managers, in scope)
- GET  /api/work-scope                what staff may use their AI for (people managers)
- PUT  /api/work-scope                change it (owner, admin)
- GET  /api/work-scope/refusals       recent requests the guard refused (people managers)
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...agents import scope_guard
from ...core.db import get_db
from ...core.security import ROLES, can
from ...models import AuditLog, Membership, Workspace
from ...services import audit
from ...teams import allowance
from ..deps import Principal, api_error, current_principal, require
from .members import _member_in_scope, people_manager

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


class PolicyIn(BaseModel):
    daily_tokens: int = Field(ge=0, le=allowance.MAX_DAILY_TOKENS)
    roles: list[str] = Field(default_factory=lambda: list(allowance.DEFAULT_ROLES))


class AllowancesOut(BaseModel):
    policy: PolicyIn
    people: list[PersonAllowance]


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


@router.get("/allowances")
async def list_allowances(
    principal: Principal = Depends(people_manager()), db: AsyncSession = Depends(get_db)
) -> AllowancesOut:
    ws = await _ws(db, principal)
    daily, roles = allowance.policy(ws)
    used = await allowance.used_by_person(db, ws)
    rows = (await db.scalars(select(Membership).where(Membership.workspace_id == ws.id))).all()
    people = []
    for m in rows:
        if not _member_in_scope(principal, m):
            continue
        st = await allowance.state(db, ws, m.user_id)
        people.append(
            PersonAllowance(
                **{**st.dict(), "used": used.get(m.user_id, 0)},
                user_id=m.user_id,
                name=m.user.name,
                email=m.user.email,
                role=m.role,
                own=m.ai_daily_tokens,
            )
        )
    people.sort(key=lambda p: (-(p.used or 0), p.name.lower()))
    return AllowancesOut(policy=PolicyIn(daily_tokens=daily, roles=list(roles)), people=people)


@router.put("/allowances/policy")
async def set_policy(
    body: PolicyIn,
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> PolicyIn:
    ws = await _ws(db, principal)
    before = dict((ws.settings or {}).get("ai_allowance") or {})
    value = {"daily_tokens": body.daily_tokens, "roles": _roles(body.roles)}
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
    st = await allowance.state(db, ws, user_id)
    return PersonAllowance(
        **st.dict(),
        user_id=user_id,
        name=m.user.name,
        email=m.user.email,
        role=m.role,
        own=m.ai_daily_tokens,
    )


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
