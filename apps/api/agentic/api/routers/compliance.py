"""P57: Settings > Approved services (owners and admins with org.manage).

GET  /api/compliance            the lock, every outside service this workspace uses (found from
                                its own settings), which are approved and which wait
PUT  /api/compliance/lock       {on}: only approved services from now on, or as before
POST /api/compliance/approve    {key, location, data, note}: approve one (recorded who/when)
DELETE /api/compliance/approve/{key}   withdraw an approval
DELETE /api/compliance/requests/{key}  dismiss a request (keep it blocked, stop listing it)

See engine/compliance.py for what the lock does.
"""

from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...engine import compliance, privacy
from ...models import (
    AIProvider,
    Channel,
    CrmConnector,
    GoogleAccount,
    McpServer,
    MicrosoftAccount,
    PushSubscription,
    StorageTarget,
    Workspace,
)
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/compliance", tags=["compliance"])


def _host(url: str | None) -> str:
    return urlparse(url or "").hostname or ""


async def services_in_use(db: AsyncSession, ws_id: str) -> list[dict[str, Any]]:
    """Every outside service the workspace is set up to use, with what it is."""
    out: list[dict[str, Any]] = []

    def add(key: str, name: str, detail: str = "") -> None:
        out.append(
            {
                "key": key,
                "kind": compliance.KINDS.get(key.split(":", 1)[0], "Service"),
                "name": name,
                "detail": detail,
            }
        )

    for p in (await db.scalars(select(AIProvider).where(AIProvider.workspace_id == ws_id))).all():
        if not privacy.is_local(p):
            add(f"ai:{p.id}", p.name, _host(p.base_url))
    for t in (
        await db.scalars(select(StorageTarget).where(StorageTarget.workspace_id == ws_id))
    ).all():
        if t.kind != "local":
            add(f"storage:{t.id}", t.name, t.kind)
    kinds = set((await db.scalars(select(Channel.kind).where(Channel.workspace_id == ws_id))).all())
    if "telegram" in kinds:
        add("telegram", "Telegram", "telegram.org")
    if "whatsapp" in kinds:
        add("whatsapp", "WhatsApp", "Meta / WhatsApp")
    if await db.scalar(
        select(func.count())
        .select_from(PushSubscription)
        .where(PushSubscription.workspace_id == ws_id)
    ):
        add("push", "Phone and browser notifications", "Google, Apple and Mozilla push services")
    # Agents search the web and read pages wherever web tools are on (most offices).
    add("web", "The web", "Search engines and the websites agents read")
    if await db.scalar(
        select(func.count())
        .select_from(MicrosoftAccount)
        .where(MicrosoftAccount.workspace_id == ws_id)
    ):
        add("m365", "Microsoft 365", "Outlook, Teams (Microsoft Graph)")
    if await db.scalar(
        select(func.count()).select_from(GoogleAccount).where(GoogleAccount.workspace_id == ws_id)
    ):
        add("google", "Google", "Gmail and Calendar")
    ws = await db.get(Workspace, ws_id)
    raw_proxy = ((ws.settings if ws else None) or {}).get("web_proxy") or {}
    if raw_proxy.get("list_enc"):
        add("proxy", "Web proxies", "The company's own proxy list (Settings > Web connections)")
    for m in (await db.scalars(select(McpServer).where(McpServer.workspace_id == ws_id))).all():
        add(f"mcp:{m.id}", m.name, _host(m.url))
    for c in (
        await db.scalars(select(CrmConnector).where(CrmConnector.workspace_id == ws_id))
    ).all():
        add(f"connector:{c.id}", c.name, c.kind)
    return out


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id, with_for_update=True)
    assert ws is not None
    return ws


def _save(ws: Workspace, comp: dict[str, Any]) -> None:
    ws.settings = {**(ws.settings or {}), compliance.SETTINGS_KEY: comp}


def _comp(ws: Workspace) -> dict[str, Any]:
    return dict((ws.settings or {}).get(compliance.SETTINGS_KEY) or {})


@router.get("")
async def overview(
    principal: Principal = Depends(require("org.manage")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    st = compliance.state(ws)
    services = await services_in_use(db, principal.workspace_id)
    known = {s["key"] for s in services}
    for s in services:
        s["approval"] = st.approved.get(s["key"])
        s["request"] = st.requests.get(s["key"])
    # Something blocked that is no longer set up still shows, so nothing is lost.
    for key, req in st.requests.items():
        if key not in known:
            services.append(
                {
                    "key": key,
                    "kind": req.get("kind") or "Service",
                    "name": req.get("label") or key,
                    "detail": "",
                    "approval": st.approved.get(key),
                    "request": req,
                }
            )
    return {
        "lock": st.lock,
        "services": services,
        "waiting": sum(1 for s in services if s["request"] and not s["approval"]),
    }


class LockIn(BaseModel):
    on: bool


@router.put("/lock")
async def set_lock(
    body: LockIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not principal.scope.everything:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only the workspace owner sets this."
        )
    ws = await _ws(db, principal)
    comp = _comp(ws)
    before = bool(comp.get("lock"))
    comp["lock"] = body.on
    _save(ws, comp)
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "compliance.lock",
        before={"lock": before},
        after={"lock": body.on},
    )
    await db.commit()
    return {"lock": body.on}


class ApproveIn(BaseModel):
    key: str = Field(min_length=2, max_length=120)
    location: str = Field(default="", max_length=200)
    data: str = Field(default="", max_length=500)
    note: str = Field(default="", max_length=1000)


@router.post("/approve")
async def approve(
    body: ApproveIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not principal.scope.everything:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only the workspace owner sets this."
        )
    ws = await _ws(db, principal)
    comp = _comp(ws)
    approved = dict(comp.get("approved") or {})
    entry = {
        "location": body.location.strip(),
        "data": body.data.strip(),
        "note": body.note.strip(),
        "by": principal.user.name,
        "by_id": principal.user.id,
        "at": datetime.now(UTC).isoformat(),
    }
    approved[body.key] = entry
    comp["approved"] = approved
    reqs = dict(comp.get("requests") or {})
    reqs.pop(body.key, None)
    comp["requests"] = reqs
    _save(ws, comp)
    await audit.record(
        db, ws.id, principal.actor, "compliance.approved", target=body.key, after=entry
    )
    await db.commit()
    return {"key": body.key, "approval": entry}


@router.delete("/approve/{key}")
async def withdraw(
    key: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not principal.scope.everything:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "owner_only", "Only the workspace owner sets this."
        )
    ws = await _ws(db, principal)
    comp = _comp(ws)
    approved = dict(comp.get("approved") or {})
    old = approved.pop(key, None)
    comp["approved"] = approved
    _save(ws, comp)
    await audit.record(db, ws.id, principal.actor, "compliance.withdrawn", target=key, before=old)
    await db.commit()
    return {"key": key}


@router.delete("/requests/{key}")
async def dismiss(
    key: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    comp = _comp(ws)
    reqs = dict(comp.get("requests") or {})
    reqs.pop(key, None)
    comp["requests"] = reqs
    _save(ws, comp)
    await db.commit()
    return {"key": key}
