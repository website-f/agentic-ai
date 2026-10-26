"""P46: the owner's approval limits (crm/limits.py), and what went through under them lately.

- GET /api/approval-limits   the limits, today's count, the latest automatic approvals
- PUT /api/approval-limits   change them (org.manage)
"""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...core.valkey import valkey
from ...crm import limits
from ...crm import service as svc
from ...models import AuditLog, MoneyDoc, Party, Task, TaskEvent, Workspace
from ...services import audit
from ..deps import Principal, require

router = APIRouter(prefix="/api/approval-limits", tags=["approvals"])

RECENT = 20


async def _recent(db: AsyncSession, workspace_id: str) -> list[dict[str, Any]]:
    bills = (
        await db.execute(
            select(AuditLog.ts, AuditLog.target, AuditLog.after)
            .where(
                AuditLog.workspace_id == workspace_id,
                AuditLog.actor == limits.ACTOR,
                AuditLog.action == "money.approved",
            )
            .order_by(AuditLog.ts.desc())
            .limit(RECENT)
        )
    ).all()
    out: list[dict[str, Any]] = []
    for ts, target, after in bills:
        doc = await db.get(MoneyDoc, target) if target else None
        party = await db.get(Party, doc.party_id) if doc is not None else None
        number = (after or {}).get("number") or ""
        out.append(
            {
                "kind": "bill",
                "at": ts,
                "money_doc_id": target,
                "label": f"{party.name if party else '-'} {number}".strip(),
                "amount": svc.amount_text(doc.currency, doc.total) if doc is not None else "",
            }
        )
    tools = (
        await db.execute(
            select(TaskEvent.ts, TaskEvent.task_id, TaskEvent.text)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(Task.workspace_id == workspace_id, TaskEvent.kind == "auto_approved")
            .order_by(TaskEvent.ts.desc())
            .limit(RECENT)
        )
    ).all()
    out += [
        {"kind": "tool", "at": ts, "task_id": task_id, "label": text, "amount": ""}
        for ts, task_id, text in tools
    ]
    out.sort(key=lambda r: r["at"], reverse=True)
    return out[:RECENT]


async def _out(db: AsyncSession, ws: Workspace) -> dict[str, Any]:
    used = await valkey().get(f"limits:{ws.id}:{svc.now().date().isoformat()}")
    return {
        "limits": limits.stored(limits.of(ws)),
        "used_today": int(used or 0),
        "recent": await _recent(db, ws.id),
    }


@router.get("")
async def get_limits(
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return await _out(db, ws)


@router.put("")
async def set_limits(
    body: limits.Limits,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    before = limits.stored(limits.of(ws))
    ws.settings = {**(ws.settings or {}), limits.KEY: limits.stored(body)}
    flag_modified(ws, "settings")
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "approval_limits.changed",
        before=before,
        after=limits.stored(body),
    )
    await db.commit()
    return await _out(db, ws)
