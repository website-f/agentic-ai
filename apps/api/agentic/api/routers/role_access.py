"""P92: Settings > Roles and access (owner only): what each role may do in this workspace.

The defaults are the table in core/security.py (PERMISSIONS). The owner gives a role more
(grant) or takes some away (revoke); the change is saved in the workspace's settings
("role_permissions") and every signed-in request reads it (api/deps.py), so the person's
next request follows it, on the server and in the app's menu (/api/auth/me).

Never editable: the owner role itself, the owner-only powers (making owners, this page, the
CRM, the developer's feedback page) and "read" (signing in at all).
"""

from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import (
    EDITABLE_ROLES,
    GRANTABLE,
    LOCKED,
    OWNER_ONLY,
    PERMISSIONS,
    ROLE_ACCESS_SETTING,
    ROLES,
    effective,
    role_overrides,
)
from ...models import Workspace
from ...services import audit
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/org/role-access", tags=["org"])


async def owner_only(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role != "owner":
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "owner_only",
            "Only an owner can change what each role may do.",
        )
    return principal


class RoleChange(BaseModel):
    grant: list[str] = Field(default_factory=list, max_length=60)
    revoke: list[str] = Field(default_factory=list, max_length=60)


class RoleAccessIn(BaseModel):
    """Every role's change from its default (a role left out goes back to its default)."""

    roles: dict[str, RoleChange] = Field(default_factory=dict)


class RoleAccessRole(BaseModel):
    role: str
    editable: bool
    default: list[str]
    effective: list[str]
    grant: list[str]
    revoke: list[str]


class RoleAccessOut(BaseModel):
    roles: list[RoleAccessRole]
    grantable: list[str]
    owner_only: list[str]


def _out(ws_settings: dict[str, Any] | None) -> RoleAccessOut:
    changes = role_overrides(ws_settings)
    return RoleAccessOut(
        roles=[
            RoleAccessRole(
                role=r,
                editable=r in EDITABLE_ROLES,
                default=sorted(PERMISSIONS[r]),
                effective=sorted(effective(r, ws_settings)),
                grant=changes.get(r, {}).get("grant", []),
                revoke=changes.get(r, {}).get("revoke", []),
            )
            for r in ROLES
        ],
        grantable=sorted(GRANTABLE),
        owner_only=sorted(OWNER_ONLY),
    )


def _check(body: RoleAccessIn) -> dict[str, dict[str, list[str]]]:
    """Refuse what can never be changed (rather than quietly dropping it)."""
    for role, change in body.roles.items():
        if role == "owner":
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "owner_locked",
                "The owner role always has everything. It cannot be changed.",
            )
        if role not in EDITABLE_ROLES:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "unknown_role",
                "There is no role called {role}.",
                role=role[:40],
            )
        for perm in [*change.grant, *change.revoke]:
            if perm in OWNER_ONLY:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "owner_only_permission",
                    "Only an owner can ever do that ({permission}).",
                    permission=perm,
                )
            if perm in LOCKED:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "locked_permission",
                    "Everyone in the workspace can sign in and read. That cannot be taken away.",
                )
            if perm not in GRANTABLE:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "unknown_permission",
                    "There is no permission called {permission}.",
                    permission=perm[:60],
                )
        if set(change.grant) & set(change.revoke):
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "grant_and_revoke",
                "A permission cannot be both given and taken away.",
            )
    raw = {r: {"grant": c.grant, "revoke": c.revoke} for r, c in body.roles.items()}
    return role_overrides({ROLE_ACCESS_SETTING: raw})


@router.get("")
async def get_role_access(
    principal: Principal = Depends(owner_only), db: AsyncSession = Depends(get_db)
) -> RoleAccessOut:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return _out(ws.settings)


@router.put("")
async def put_role_access(
    body: RoleAccessIn,
    principal: Principal = Depends(owner_only),
    db: AsyncSession = Depends(get_db),
) -> RoleAccessOut:
    clean = _check(body)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    before = role_overrides(ws.settings)
    if clean != before:
        settings = dict(ws.settings or {})
        if clean:
            settings[ROLE_ACCESS_SETTING] = clean
        else:
            settings.pop(ROLE_ACCESS_SETTING, None)
        ws.settings = settings  # a new dict: JSONB changes are saved on assignment
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "org.role_access_changed",
            target=principal.workspace_id,
            before={"roles": before},
            after={"roles": clean},
            note="Roles and access: " + (_summary(before, clean) or "back to the defaults"),
        )
        await db.commit()
    return _out(ws.settings)


def _summary(before: dict[str, Any], after: dict[str, Any]) -> str:
    """'hr: +engine.view; management: -finance.manage' for the audit trail."""
    parts = []
    for role in ROLES:
        if before.get(role) == after.get(role):
            continue
        change = after.get(role) or {"grant": [], "revoke": []}
        bits = [f"+{p}" for p in change["grant"]] + [f"-{p}" for p in change["revoke"]]
        parts.append(f"{role}: " + (" ".join(bits) if bits else "default"))
    return "; ".join(parts)
