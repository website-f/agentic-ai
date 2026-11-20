"""P120: people's requests on the Approvals page (org/requests.py has the rules).

GET  /api/requests                 what waits for me, what I decided lately, and my own
POST /api/requests/{id}/decide     approve or decline, with a reason
POST /api/requests/{id}/cancel     take back my own request while it waits

A SharePoint or OneDrive folder is asked for at POST /api/library/linked/requests.
"""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Branch, User
from ...org import requests as rules
from ...org.models import PersonRequest
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/requests", tags=["requests"])

RECENT = 40


class RequestOut(BaseModel):
    id: str
    kind: str
    title: str
    note: str
    status: Literal["pending", "approved", "declined", "cancelled"]
    branch_id: str | None
    branch_name: str | None
    requested_by: str
    requested_by_name: str
    approver_name: str | None
    created_at: datetime
    decided_at: datetime | None
    decided_by_name: str | None
    decision_note: str
    # What it is about, for the screen (library_link: the link, its name, folder or file).
    detail: dict[str, Any]
    result_id: str | None
    can_decide: bool
    can_cancel: bool


class RequestsOut(BaseModel):
    to_decide: list[RequestOut]
    decided: list[RequestOut]
    mine: list[RequestOut]


class DecideIn(BaseModel):
    decision: Literal["approve", "decline"]
    reason: str = Field(default="", max_length=rules.MAX_NOTE)


def fail(e: rules.RequestError) -> Exception:
    return api_error(e.status, e.code, e.message, **{k: str(v) for k, v in e.vars.items()})


DETAIL_KEYS = ("url", "web_url", "name", "is_folder", "provider")


async def outs(
    db: AsyncSession, principal: Principal, rows: list[PersonRequest], deciding: set[str]
) -> list[RequestOut]:
    users = {u for r in rows for u in (r.requested_by, r.approver_id, r.decided_by) if u}
    names: dict[str, str] = {}
    if users:
        for uid, name, email in (
            await db.execute(select(User.id, User.name, User.email).where(User.id.in_(users)))
        ).all():
            names[uid] = name or email
    bids = {r.branch_id for r in rows if r.branch_id}
    branches: dict[str, str] = {}
    if bids:
        branches = dict(
            (await db.execute(select(Branch.id, Branch.name).where(Branch.id.in_(bids)))).all()
        )
    me = principal.user.id
    return [
        RequestOut(
            id=r.id,
            kind=r.kind,
            title=r.title,
            note=r.note,
            status=r.status,  # type: ignore[arg-type]
            branch_id=r.branch_id,
            branch_name=branches.get(r.branch_id or ""),
            requested_by=r.requested_by,
            requested_by_name=names.get(r.requested_by, ""),
            approver_name=names.get(r.approver_id) if r.approver_id else None,
            created_at=r.created_at,
            decided_at=r.decided_at,
            decided_by_name=names.get(r.decided_by) if r.decided_by else None,
            decision_note=r.decision_note,
            detail={k: (r.data or {}).get(k) for k in DETAIL_KEYS if k in (r.data or {})},
            result_id=r.result_id,
            can_decide=r.status == "pending" and r.id in deciding,
            can_cancel=r.status == "pending" and r.requested_by == me,
        )
        for r in rows
    ]


async def one_out(db: AsyncSession, principal: Principal, r: PersonRequest) -> RequestOut:
    deciding = {r.id} if await rules.may_decide(db, principal, r) else set()
    return (await outs(db, principal, [r], deciding))[0]


@router.get("")
async def list_requests(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> RequestsOut:
    ws = PersonRequest.workspace_id == principal.workspace_id
    mine_where = await rules.to_decide_where(db, principal)
    waiting = list(
        (
            await db.scalars(
                select(PersonRequest)
                .where(ws, PersonRequest.status == "pending", mine_where)
                .order_by(PersonRequest.created_at)
                .limit(200)
            )
        ).all()
    )
    decided = list(
        (
            await db.scalars(
                select(PersonRequest)
                .where(
                    ws,
                    PersonRequest.status.in_(("approved", "declined")),
                    mine_where,
                )
                .order_by(PersonRequest.decided_at.desc())
                .limit(RECENT)
            )
        ).all()
    )
    mine = list(
        (
            await db.scalars(
                select(PersonRequest)
                .where(ws, PersonRequest.requested_by == principal.user.id)
                .order_by(PersonRequest.created_at.desc())
                .limit(RECENT)
            )
        ).all()
    )
    deciding = {r.id for r in waiting}
    return RequestsOut(
        to_decide=await outs(db, principal, waiting, deciding),
        decided=await outs(db, principal, decided, set()),
        mine=await outs(db, principal, mine, set()),
    )


async def _one(db: AsyncSession, principal: Principal, request_id: str) -> PersonRequest:
    r = await db.get(PersonRequest, request_id)
    if (
        r is None
        or r.workspace_id != principal.workspace_id
        or (r.requested_by != principal.user.id and not await rules.may_decide(db, principal, r))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "request_not_found", "That request is not here.")
    return r


@router.post("/{request_id}/decide")
async def decide(
    request_id: str,
    body: DecideIn,
    background: BackgroundTasks,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    r = await _one(db, principal, request_id)
    try:
        await rules.decide(db, principal, r, body.decision == "approve", body.reason)
    except rules.RequestError as e:
        raise fail(e) from e
    await db.commit()
    if r.status == "approved" and r.kind == rules.LIBRARY_LINK and r.result_id:
        from .linked_sources import _start

        await _start(background, r.result_id)
    await rules.tell_decided(db, r, principal.user.name or principal.user.email)
    return await one_out(db, principal, r)


@router.post("/{request_id}/cancel")
async def cancel(
    request_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> RequestOut:
    r = await _one(db, principal, request_id)
    try:
        await rules.cancel(db, principal, r)
    except rules.RequestError as e:
        raise fail(e) from e
    await db.commit()
    return await one_out(db, principal, r)
