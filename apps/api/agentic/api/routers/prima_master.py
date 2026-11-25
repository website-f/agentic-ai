"""P132: Prima keeps the organization and the people; this is the office's view of that.

GET  /api/prima-master             on or not, the last run's summary and what is held (org.manage
                                    or members.manage, to show the Organization page read-only)
POST /api/prima-master/run         follow Prima now (owner or global admin); the first run switches
                                    the office to following Prima for good
POST /api/prima-master/apply-held  apply what was held: lower access levels and accounts Prima
                                    closed (owner only), after the owner looked at the list
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Workspace
from ...prima import client, mirror
from ...prima.client import PrimaError
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/prima-master", tags=["prima"])


class HeldOut(BaseModel):
    user_id: str
    name: str
    kind: str  # "down": a lower access level; "close": Prima closed their access
    from_role: str | None = None
    to_role: str | None = None


class MasterOut(BaseModel):
    on: bool
    summary: dict[str, int] = {}
    held: list[HeldOut] = []
    can_run: bool = False
    can_apply_held: bool = False


async def _state(db: AsyncSession, p: Principal) -> MasterOut:
    w = await db.get(Workspace, p.workspace_id)
    st = ((w.settings or {}).get(mirror.STATE_KEY) or {}) if w else {}
    held = [
        HeldOut(
            user_id=str(h.get("user_id")),
            name=str(h.get("name") or ""),
            kind=str(h.get("kind") or ""),
            from_role=h.get("from"),
            to_role=h.get("to"),
        )
        for h in (st.get("held") or [])
        if isinstance(h, dict)
    ]
    return MasterOut(
        on=bool(st.get("on")),
        summary={k: int(v) for k, v in (st.get("summary") or {}).items() if isinstance(v, int)},
        held=held if p.role in ("owner", "admin") else [],
        can_run=p.role in ("owner", "admin") and client.enabled(p.workspace_id),
        can_apply_held=p.role == "owner" and bool(held),
    )


@router.get("")
async def master_state(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    return await _state(db, principal)


async def _run(db: AsyncSession, principal: Principal, held_too: bool) -> MasterOut:
    try:
        await mirror.run(db, principal.workspace_id, held_too=held_too)
    except PrimaError as e:
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "prima_down", e.message) from e
    return await _state(db, principal)


@router.post("/run")
async def master_run(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    if principal.role not in ("owner", "admin"):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "forbidden", "Only an owner or a global admin can do this."
        )
    return await _run(db, principal, held_too=False)


@router.post("/apply-held")
async def master_apply_held(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> MasterOut:
    if principal.role != "owner":
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Only an owner can do this.")
    return await _run(db, principal, held_too=True)
