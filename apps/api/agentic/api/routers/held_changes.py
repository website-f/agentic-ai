"""P125: IT support's changes waiting for approval (org/held.py has the rules).

GET  /api/held-changes                what waits for me (owners, global admins), what was decided
                                      lately, and my own (IT support)
GET  /api/held-changes/{id}           one (its approvers and the person who asked only)
POST /api/held-changes/{id}/approve   run it now with my own sign-in (a reason is required)
POST /api/held-changes/{id}/decline   refuse it (a reason is required)
POST /api/held-changes/{id}/cancel    take back my own while it waits
"""

import json
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import HELD_ROLE, reset_acting_for, set_acting_for
from ...i18n import Msg, current_lang, render
from ...i18n.labels import role_label
from ...models import User
from ...org import held
from ...org.held_models import HeldChange
from ...services import audit
from ..deps import (
    APP_CLIENT_HEADER,
    CSRF_HEADER,
    LANG_HEADER,
    Principal,
    api_error,
    client_ip,
    require,
)

router = APIRouter(prefix="/api/held-changes", tags=["held changes"])

RECENT = 40

Status = Literal["pending", "applying", "applied", "declined", "cancelled", "expired"]


class DetailOut(BaseModel):
    field: str
    value: str


class HeldOut(BaseModel):
    id: str
    summary: str
    method: str
    path: str
    details: list[DetailOut]
    status: Status
    requested_by: str
    requested_by_name: str
    # P125: whether the person who asked is still IT support (their role may have changed).
    requester_role_now: str | None
    requester_role_label: str
    requester_still_it_support: bool
    created_at: datetime
    expires_at: datetime
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str
    attempts: int
    apply_status: int | None
    apply_message: str
    can_decide: bool
    can_cancel: bool


class HeldListOut(BaseModel):
    to_decide: list[HeldOut]
    decided: list[HeldOut]
    mine: list[HeldOut]
    is_approver: bool


class ReasonIn(BaseModel):
    reason: str = Field(default="", max_length=held.MAX_NOTE)


class ApproveOut(BaseModel):
    change: HeldOut
    applied: bool
    # The run's answer, for the approver only (a new member's one-time password, for one).
    result: Any = None


def _fail(e: held.HoldError) -> Exception:
    return api_error(e.status, e.code, e.message, **{k: str(v) for k, v in e.vars.items()})


async def _outs(db: AsyncSession, principal: Principal, rows: list[HeldChange]) -> list[HeldOut]:
    from ...models import Membership

    lang = current_lang()
    users = {u for r in rows for u in (r.requested_by, r.decided_by) if u}
    names: dict[str, str] = {}
    roles: dict[str, str] = {}
    if users:
        for uid, name, email in (
            await db.execute(select(User.id, User.name, User.email).where(User.id.in_(users)))
        ).all():
            names[uid] = name or email
        roles = dict(
            (
                await db.execute(
                    select(Membership.user_id, Membership.role).where(
                        Membership.workspace_id == principal.workspace_id,
                        Membership.user_id.in_(users),
                    )
                )
            ).all()
        )
    me = principal.user.id
    approver = held.is_approver(principal)
    out = []
    for r in rows:
        now_role = roles.get(r.requested_by)
        out.append(
            HeldOut(
                id=r.id,
                summary=render(held.dec(r.summary), lang),
                method=r.method,
                path=r.path,
                details=[
                    DetailOut(
                        field=str(d.get("field", "")),
                        value=render(held.dec(d.get("value")), lang),
                    )
                    for d in (r.details or [])
                    if isinstance(d, dict)
                ],
                status=r.status,  # type: ignore[arg-type]
                requested_by=r.requested_by,
                requested_by_name=names.get(r.requested_by, ""),
                requester_role_now=now_role,
                requester_role_label=render(role_label(now_role), lang) if now_role else "",
                requester_still_it_support=now_role == HELD_ROLE,
                created_at=r.created_at,
                expires_at=r.expires_at,
                decided_by_name=names.get(r.decided_by) if r.decided_by else None,
                decided_at=r.decided_at,
                decision_note=r.decision_note,
                attempts=r.attempts,
                apply_status=r.apply_status,
                apply_message=r.apply_message,
                can_decide=approver
                and r.requested_by != me
                and (r.status == "pending" or held.stale(r)),
                can_cancel=r.status == "pending" and r.requested_by == me,
            )
        )
    return out


async def _one_out(db: AsyncSession, principal: Principal, r: HeldChange) -> HeldOut:
    return (await _outs(db, principal, [r]))[0]


@router.get("")
async def list_changes(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> HeldListOut:
    ws = HeldChange.workspace_id == principal.workspace_id
    await held.expire_due(db, principal.workspace_id)
    await db.commit()
    approver = held.is_approver(principal)
    me = principal.user.id
    waiting: list[HeldChange] = []
    decided: list[HeldChange] = []
    if approver:
        waiting = list(
            (
                await db.scalars(
                    select(HeldChange)
                    .where(
                        ws,
                        HeldChange.requested_by != me,
                        HeldChange.status.in_(("pending", "applying")),
                    )
                    .order_by(HeldChange.created_at)
                    .limit(200)
                )
            ).all()
        )
        decided = list(
            (
                await db.scalars(
                    select(HeldChange)
                    .where(ws, HeldChange.status.in_(("applied", "declined", "expired")))
                    .order_by(
                        HeldChange.decided_at.desc().nulls_last(), HeldChange.created_at.desc()
                    )
                    .limit(RECENT)
                )
            ).all()
        )
    mine = list(
        (
            await db.scalars(
                select(HeldChange)
                .where(ws, HeldChange.requested_by == me)
                .order_by(HeldChange.created_at.desc())
                .limit(RECENT)
            )
        ).all()
    )
    return HeldListOut(
        to_decide=await _outs(db, principal, waiting),
        decided=await _outs(db, principal, decided),
        mine=await _outs(db, principal, mine),
        is_approver=approver,
    )


async def _row(
    db: AsyncSession, principal: Principal, change_id: str, *, lock: bool = False
) -> HeldChange:
    q = select(HeldChange).where(
        HeldChange.id == change_id, HeldChange.workspace_id == principal.workspace_id
    )
    if lock:
        q = q.with_for_update()
    q = q.execution_options(populate_existing=True)
    r = await db.scalar(q)
    if r is None or (r.requested_by != principal.user.id and not held.is_approver(principal)):
        raise api_error(status.HTTP_404_NOT_FOUND, "change_not_found", "That change is not here.")
    return r


@router.get("/{change_id}")
async def get_change(
    change_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> HeldOut:
    await held.expire_due(db, principal.workspace_id)
    await db.commit()
    return await _one_out(db, principal, await _row(db, principal, change_id))


def _replay_headers(request: Request, row: HeldChange) -> dict[str, str]:
    """The approver's own sign-in and language, for the run."""
    h = request.headers
    out = {"x-real-ip": client_ip(request), "user-agent": (h.get("user-agent") or "")[:400]}
    for name in ("cookie", CSRF_HEADER, LANG_HEADER, APP_CLIENT_HEADER, "authorization"):
        if h.get(name):
            out[name] = h[name]
    out["content-type"] = row.content_type or "application/json"
    return out


async def _replay(request: Request, row: HeldChange, body_json: Any, body_raw: bytes | None):
    from ..main import app  # late: the app includes this router

    url = row.path + (f"?{row.query}" if row.query else "")
    content = json.dumps(body_json).encode() if body_json is not None else (body_raw or b"")
    token = set_acting_for((row.requested_role, row.requested_by))
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://office.internal", timeout=300
        ) as c:
            return await c.request(
                row.method, url, content=content, headers=_replay_headers(request, row)
            )
    finally:
        reset_acting_for(token)


@router.post("/{change_id}/approve")
async def approve(
    change_id: str,
    body: ReasonIn,
    request: Request,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ApproveOut:
    await held.expire_due(db, principal.workspace_id)
    await db.commit()
    r = await _row(db, principal, change_id)
    try:
        held.check_decider(principal, r)
        if r.status == "expired":
            raise held.HoldError(409, "expired", "This change expired. Ask for it again.")
        if r.status != "pending":
            raise held.HoldError(409, "already_decided", "This change was decided already.")
        reason = held.clean_reason(body.reason)
        # The same rules as when it was asked (a person's role may have changed since).
        await held.precheck(db, r.workspace_id, r.requested_by, r.path, r.body_json)
    except held.HoldError as e:
        raise _fail(e) from e
    body_json = r.body_json
    body_raw = (
        await db.scalar(select(HeldChange.body_raw).where(HeldChange.id == r.id))
        if body_json is None
        else None
    )
    if not await held.claim(db, principal, r):  # someone else is approving it right now
        raise _fail(held.HoldError(409, "already_decided", "This change was decided already."))
    try:
        resp = await _replay(request, r, body_json, body_raw)
        code = resp.status_code
        try:
            data: Any = resp.json() if resp.content else None
        except ValueError:
            data = None
    except Exception as e:  # noqa: BLE001 - the change stays open with what went wrong
        code, data = 500, {"message": str(e)[:300] or type(e).__name__}
    r = await _row(db, principal, change_id, lock=True)
    ok = 200 <= code < 300
    asker = await db.get(User, r.requested_by)
    asker_name = (asker.name or asker.email) if asker else r.requested_by
    r.apply_status = code
    if ok:
        r.status = "applied"
        r.applied_at = datetime.now(UTC)
        r.decided_by, r.decided_at, r.decision_note = principal.user.id, datetime.now(UTC), reason
        r.apply_message = ""
        held.final(r)
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "held_change.approved",
            target=r.id,
            after={
                "note": f"approved IT support {asker_name}'s request",
                "summary": r.title,
                "method": r.method,
                "path": r.path,
                "reason": reason,
                "result": held.safe_result(data),
            },
        )
    else:
        r.status = "pending"
        r.apply_message = held.failure_text(code, data)
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "held_change.failed",
            target=r.id,
            after={"summary": r.title, "status": code, "message": r.apply_message},
        )
    await db.commit()
    if ok:
        await held.tell(
            db,
            r,
            [r.requested_by],
            Msg("Approved: {title}", title=r.title[:100]),
            Msg(
                "{name} approved it: {reason}. It is done.",
                name=principal.user.name or principal.user.email,
                reason=reason[:300],
            ),
        )
    out = await _one_out(db, principal, r)
    return ApproveOut(change=out, applied=ok, result=data if ok else None)


@router.post("/{change_id}/decline")
async def decline(
    change_id: str,
    body: ReasonIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> HeldOut:
    await held.expire_due(db, principal.workspace_id)
    r = await _row(db, principal, change_id, lock=True)
    try:
        held.check_decider(principal, r)
        if not (r.status == "pending" or held.stale(r)):
            raise held.HoldError(409, "already_decided", "This change was decided already.")
        reason = held.clean_reason(body.reason)
    except held.HoldError as e:
        raise _fail(e) from e
    r.status = "declined"
    r.decided_by, r.decided_at, r.decision_note = principal.user.id, datetime.now(UTC), reason
    held.final(r)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "held_change.declined",
        target=r.id,
        after={"summary": r.title, "reason": reason},
    )
    await db.commit()
    await held.tell(
        db,
        r,
        [r.requested_by],
        Msg("Declined: {title}", title=r.title[:100]),
        Msg(
            "{name} declined it: {reason}.",
            name=principal.user.name or principal.user.email,
            reason=reason[:300],
        ),
    )
    return await _one_out(db, principal, r)


@router.post("/{change_id}/cancel")
async def cancel(
    change_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> HeldOut:
    r = await _row(db, principal, change_id, lock=True)
    if r.requested_by != principal.user.id:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "not_yours", "Only the person who asked can cancel it."
        )
    if r.status != "pending":
        raise api_error(
            status.HTTP_409_CONFLICT, "already_decided", "This change was decided already."
        )
    r.status, r.decided_at = "cancelled", datetime.now(UTC)
    held.final(r)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "held_change.cancelled",
        target=r.id,
        after={"summary": r.title},
    )
    await db.commit()
    return await _one_out(db, principal, r)


def pending_count_where(principal: Principal) -> Any:
    """For the bell (api/routers/needs.py): changes this approver may decide."""
    return (
        (HeldChange.workspace_id == principal.workspace_id)
        & (HeldChange.status == "pending")
        & (HeldChange.requested_by != principal.user.id)
        & (HeldChange.expires_at > datetime.now(UTC))
    )
