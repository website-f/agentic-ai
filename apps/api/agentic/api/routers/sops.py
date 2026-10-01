"""SOPs: the written procedures agents follow. Versioned on every edit."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import SOP, Agent, Branch, Department
from ...services import audit
from ..agent_schemas import SOPIn, SOPOut, SOPUpdateIn
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/sops", tags=["sops"])


async def _label(db: AsyncSession, s: SOP) -> str:
    if s.scope == "workspace":
        return "Every company"
    if s.scope == "library":
        return "Library (attach to agents)"
    if s.scope == "branch" and s.scope_id:
        b = await db.get(Branch, s.scope_id)
        return f"{b.name}" if b else "Removed branch"
    if s.scope == "department" and s.scope_id:
        d = await db.get(Department, s.scope_id)
        b = await db.get(Branch, d.branch_id) if d else None
        return f"{d.name}, {b.name}" if d and b else "Removed department"
    return s.scope


async def _out(db: AsyncSession, s: SOP) -> SOPOut:
    return SOPOut(
        id=s.id,
        scope=s.scope,
        scope_id=s.scope_id,
        scope_label=await _label(db, s),
        title=s.title,
        body=s.body,
        version=s.version,
        updated_by=s.updated_by,
        updated_at=s.updated_at,
    )


async def _get(db: AsyncSession, ws: str, sop_id: str) -> SOP:
    s = await db.get(SOP, sop_id)
    if s is None or s.workspace_id != ws:
        raise api_error(status.HTTP_404_NOT_FOUND, "sop_not_found", "That SOP is not here.")
    return s


@router.get("")
async def list_sops(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[SOPOut]:
    rows = (
        await db.scalars(
            select(SOP)
            .where(SOP.workspace_id == principal.workspace_id)
            .order_by(SOP.scope, SOP.title)
        )
    ).all()
    return [await _out(db, s) for s in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_sop(
    body: SOPIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> SOPOut:
    if body.scope in ("branch", "department"):
        model = Branch if body.scope == "branch" else Department
        target = await db.get(model, body.scope_id or "")
        if target is None or target.workspace_id != principal.workspace_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_scope",
                f"Pick a {body.scope} from this workspace.",
            )
    s = SOP(
        workspace_id=principal.workspace_id,
        scope=body.scope,
        scope_id=body.scope_id if body.scope in ("branch", "department") else None,
        title=body.title.strip(),
        body=body.body,
        updated_by=principal.actor,
    )
    db.add(s)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "sop.created",
        target=s.id,
        after={"title": s.title, "scope": s.scope},
    )
    await db.commit()
    await db.refresh(s)
    return await _out(db, s)


@router.patch("/{sop_id}")
async def update_sop(
    sop_id: str,
    body: SOPUpdateIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> SOPOut:
    s = await _get(db, principal.workspace_id, sop_id)
    before = {"title": s.title, "version": s.version}
    if body.title is not None:
        s.title = body.title.strip()
    if body.body is not None and body.body != s.body:
        s.body = body.body
        s.version += 1
    s.updated_by = principal.actor
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "sop.updated",
        target=s.id,
        before=before,
        after={"title": s.title, "version": s.version},
    )
    await db.commit()
    await db.refresh(s)
    return await _out(db, s)


@router.delete("/{sop_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sop(
    sop_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    s = await _get(db, principal.workspace_id, sop_id)
    for a in (
        await db.scalars(select(Agent).where(Agent.workspace_id == principal.workspace_id))
    ).all():
        if s.id in (a.sop_ids or []):
            a.sop_ids = [x for x in a.sop_ids if x != s.id]
    await db.delete(s)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "sop.deleted",
        target=sop_id,
        before={"title": s.title},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
