"""Saved website logins (P9). People add them; agents use them without seeing them.

The API never returns a password or a full username, only a hint. Workspace admins manage
every login; branch managers and HODs (vault.manage) the logins of their branch; staff
(vault.own) only their own, which only their own agents can use.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import vault
from ...core.db import get_db
from ...core.security import can
from ...models import Agent, Branch, Credential
from ...services import audit
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/vault", tags=["vault"])


class LoginIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._-]*$")
    hosts: list[str] = Field(min_length=1, max_length=20)
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=400)
    branch_id: str | None = None
    agent_ids: list[str] = Field(default_factory=list, max_length=50)
    personal: bool = False


class LoginUpdateIn(BaseModel):
    hosts: list[str] | None = Field(default=None, min_length=1, max_length=20)
    username: str | None = Field(default=None, min_length=1, max_length=200)
    password: str | None = Field(default=None, min_length=1, max_length=400)
    agent_ids: list[str] | None = Field(default=None, max_length=50)


class LoginOut(BaseModel):
    id: str
    name: str
    hosts: list[str]
    username_hint: str
    branch_id: str | None
    branch_name: str | None
    owner_user_id: str | None
    agent_ids: list[str]
    created_by: str
    created_at: datetime
    last_used_at: datetime | None
    can_manage: bool


def vault_user():
    async def checker(principal: Principal = Depends(current_principal)) -> Principal:
        if not (can(principal.role, "vault.manage") or can(principal.role, "vault.own")):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                f"Your role ({principal.role}) cannot see saved logins.",
            )
        return principal

    return checker


def _manages(principal: Principal, c: Credential) -> bool:
    if c.owner_user_id:
        return c.owner_user_id == principal.user.id or principal.scope.everything
    if not can(principal.role, "vault.manage"):
        return False
    sc = principal.scope
    return sc.everything or (c.branch_id is not None and c.branch_id == sc.branch_id)


def _sees(principal: Principal, c: Credential) -> bool:
    """Managers also see (name and sites only) the workspace-wide logins their agents use."""
    if c.owner_user_id:
        return _manages(principal, c)
    sc = principal.scope
    return can(principal.role, "vault.manage") and (
        sc.everything or c.branch_id is None or c.branch_id == sc.branch_id
    )


async def _out(db: AsyncSession, principal: Principal, c: Credential) -> LoginOut:
    b = await db.get(Branch, c.branch_id) if c.branch_id else None
    return LoginOut(
        id=c.id,
        name=c.name,
        hosts=c.hosts,
        username_hint=c.username_hint,
        branch_id=c.branch_id,
        branch_name=b.name if b else None,
        owner_user_id=c.owner_user_id,
        agent_ids=c.agent_ids or [],
        created_by=c.created_by,
        created_at=c.created_at,
        last_used_at=c.last_used_at,
        can_manage=_manages(principal, c),
    )


async def _get(db: AsyncSession, principal: Principal, login_id: str) -> Credential:
    c = await db.get(Credential, login_id)
    if c is None or c.workspace_id != principal.workspace_id or not _sees(principal, c):
        raise api_error(status.HTTP_404_NOT_FOUND, "login_not_found", "That login is not here.")
    if not _manages(principal, c):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "You cannot change this login.")
    return c


async def _check_agents(db: AsyncSession, principal: Principal, ids: list[str]) -> list[str]:
    out: list[str] = []
    for aid in ids:
        a = await db.get(Agent, aid)
        if (
            a is None
            or a.workspace_id != principal.workspace_id
            or not principal.scope.sees_agent(a)
        ):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick agents you can see.")
        if a.id not in out:
            out.append(a.id)
    return out


@router.get("/logins")
async def list_logins(
    principal: Principal = Depends(vault_user()), db: AsyncSession = Depends(get_db)
) -> list[LoginOut]:
    rows = (
        await db.scalars(
            select(Credential)
            .where(Credential.workspace_id == principal.workspace_id)
            .order_by(Credential.name)
        )
    ).all()
    return [await _out(db, principal, c) for c in rows if _sees(principal, c)]


@router.post("/logins", status_code=status.HTTP_201_CREATED)
async def add_login(
    body: LoginIn, principal: Principal = Depends(vault_user()), db: AsyncSession = Depends(get_db)
) -> LoginOut:
    personal = body.personal or not can(principal.role, "vault.manage")
    branch_id = body.branch_id
    sc = principal.scope
    if personal:
        branch_id = None
    elif not sc.everything:
        branch_id = sc.branch_id  # branch managers and HODs: their branch's logins
        if not branch_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "no_branch", "You have no branch.")
    if branch_id:
        b = await db.get(Branch, branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a branch from here.")
    hosts = vault.clean_hosts(body.hosts)
    if not hosts:
        raise api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad_hosts", "Give the site address.")
    if await db.scalar(
        select(Credential.id).where(
            Credential.workspace_id == principal.workspace_id, Credential.name == body.name.strip()
        )
    ):
        raise api_error(status.HTTP_409_CONFLICT, "name_taken", "A login with that name exists.")
    c = Credential(
        workspace_id=principal.workspace_id,
        branch_id=branch_id,
        owner_user_id=principal.user.id if personal else None,
        name=body.name.strip(),
        hosts=hosts,
        agent_ids=await _check_agents(db, principal, body.agent_ids),
        created_by=principal.actor,
        username_enc="",
        password_enc="",
    )
    db.add(c)
    await db.flush()
    vault.seal(c, body.username, body.password)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "credential.added",
        target=c.id,
        after={"name": c.name, "hosts": hosts, "branch_id": branch_id, "personal": personal},
    )
    await db.commit()
    await db.refresh(c)
    return await _out(db, principal, c)


@router.patch("/logins/{login_id}")
async def update_login(
    login_id: str,
    body: LoginUpdateIn,
    principal: Principal = Depends(vault_user()),
    db: AsyncSession = Depends(get_db),
) -> LoginOut:
    c = await _get(db, principal, login_id)
    changed: list[str] = []
    if body.hosts is not None:
        c.hosts = vault.clean_hosts(body.hosts)
        changed.append("hosts")
    if body.agent_ids is not None:
        c.agent_ids = await _check_agents(db, principal, body.agent_ids)
        changed.append("agents")
    if body.username is not None or body.password is not None:
        user, pw = vault.reveal(c)
        vault.seal(c, body.username or user, body.password or pw)
        changed.append("secret")
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "credential.updated",
        target=c.id,
        after={"name": c.name, "changed": changed},
    )
    await db.commit()
    await db.refresh(c)
    return await _out(db, principal, c)


@router.delete("/logins/{login_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_login(
    login_id: str, principal: Principal = Depends(vault_user()), db: AsyncSession = Depends(get_db)
) -> Response:
    c = await _get(db, principal, login_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "credential.deleted",
        target=c.id,
        before={"name": c.name},
    )
    await db.delete(c)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
