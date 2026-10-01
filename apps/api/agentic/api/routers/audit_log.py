from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import AuditLog, User
from ...services import audit
from ..deps import Principal, require
from ..schemas import AuditOut, AuditPage

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(
    limit: int = Query(default=50, ge=1, le=200),
    before_id: int | None = Query(default=None),
    principal: Principal = Depends(require("audit.read")),
    db: AsyncSession = Depends(get_db),
) -> AuditPage:
    q = select(AuditLog).where(AuditLog.workspace_id == principal.workspace_id)
    if before_id is not None:
        q = q.where(AuditLog.id < before_id)
    rows = (await db.scalars(q.order_by(AuditLog.id.desc()).limit(limit + 1))).all()
    page, more = rows[:limit], len(rows) > limit

    user_ids = {r.actor.removeprefix("user:") for r in page if r.actor.startswith("user:")}
    names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all())
        if user_ids
        else {}
    )

    items = [
        AuditOut(
            id=r.id,
            ts=r.ts,
            actor=r.actor,
            actor_name=names.get(r.actor.removeprefix("user:")),
            action=r.action,
            target=r.target,
            before=r.before,
            after=r.after,
            note=r.note,
        )
        for r in page
    ]
    return AuditPage(items=items, next_before_id=page[-1].id if more and page else None)


@router.get("/verify")
async def verify(
    principal: Principal = Depends(require("audit.read")), db: AsyncSession = Depends(get_db)
) -> dict:
    return await audit.verify_chain(db, principal.workspace_id)
