"""Broadcasts: message everyone, chosen branches, departments, or picked agents."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch, runtime
from ...core.db import get_db
from ...models import Agent, Branch, Broadcast, BroadcastReceipt, Department, Task, User
from ...services import audit, events
from .. import paging
from ..agent_schemas import BroadcastIn, BroadcastOut, ReceiptOut
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/broadcasts", tags=["broadcasts"])
log = logging.getLogger("agentic.broadcasts")


async def resolve_audience(db: AsyncSession, ws: str, body: BroadcastIn) -> tuple[list[Agent], str]:
    """Active agents the audience covers, and a human label for it."""
    aud = body.audience
    q = select(Agent).where(Agent.workspace_id == ws, Agent.status == "active")
    labels: list[str] = []
    if aud.all:
        labels.append("Everyone")
    else:
        conds = []
        if aud.branch_ids:
            conds.append(Agent.branch_id.in_(aud.branch_ids))
            names = (
                await db.scalars(
                    select(Branch.name).where(
                        Branch.id.in_(aud.branch_ids), Branch.workspace_id == ws
                    )
                )
            ).all()
            labels += list(names)
        if aud.department_ids:
            conds.append(Agent.department_id.in_(aud.department_ids))
            rows = (
                await db.execute(
                    select(Department.name, Branch.name)
                    .join(Branch, Branch.id == Department.branch_id)
                    .where(Department.id.in_(aud.department_ids), Department.workspace_id == ws)
                )
            ).all()
            labels += [f"{d} ({b})" for d, b in rows]
        if aud.agent_ids:
            conds.append(Agent.id.in_(aud.agent_ids))
            names = (
                await db.scalars(
                    select(Agent.name).where(Agent.id.in_(aud.agent_ids), Agent.workspace_id == ws)
                )
            ).all()
            labels += list(names)
        if not conds:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "no_audience",
                "Pick who should receive this.",
            )
        q = q.where(or_(*conds))
    agents = list((await db.scalars(q.order_by(Agent.name))).all())
    label = (
        ", ".join(labels)
        if len(labels) <= 4
        else f"{', '.join(labels[:3])} and {len(labels) - 3} more"
    )
    return agents, label[:300]


async def _out(db: AsyncSession, b: Broadcast, with_receipts: bool = False) -> BroadcastOut:
    targets = (
        await db.scalar(
            select(func.count())
            .select_from(BroadcastReceipt)
            .where(BroadcastReceipt.broadcast_id == b.id)
        )
        or 0
    )
    acked = (
        await db.scalar(
            select(func.count())
            .select_from(BroadcastReceipt)
            .where(BroadcastReceipt.broadcast_id == b.id, BroadcastReceipt.ack_at.is_not(None))
        )
        or 0
    )
    sender = (
        await db.get(User, b.sender.removeprefix("user:")) if b.sender.startswith("user:") else None
    )
    receipts = None
    if with_receipts:
        rows = (
            await db.execute(
                select(BroadcastReceipt, Agent, Department.name, Branch.name)
                .join(Agent, Agent.id == BroadcastReceipt.agent_id)
                .join(Branch, Branch.id == Agent.branch_id)
                .outerjoin(Department, Department.id == Agent.department_id)
                .where(BroadcastReceipt.broadcast_id == b.id)
                .order_by(Agent.name)
            )
        ).all()
        receipts = [
            ReceiptOut(
                agent_id=a.id,
                agent_name=a.name,
                agent_role=a.role,
                agent_color=a.color,
                department_name=dname,
                branch_name=bname,
                delivered_at=r.delivered_at,
                ack_at=r.ack_at,
                reply=r.reply,
                task_id=r.task_id,
            )
            for r, a, dname, bname in rows
        ]
    return BroadcastOut(
        id=b.id,
        sender=b.sender,
        sender_name=sender.name if sender else None,
        audience=b.audience,
        audience_label=b.audience_label,
        mode=b.mode,
        request_reply=b.request_reply,
        body=b.body,
        created_at=b.created_at,
        targets=targets,
        acked=acked,
        receipts=receipts,
    )


async def scoped_audience(
    db: AsyncSession, principal: Principal, body: BroadcastIn
) -> tuple[list[Agent], str]:
    """Office roles (P9) reach only the agents in their scope: "everyone" from a HOD means
    everyone in the department."""
    agents, label = await resolve_audience(db, principal.workspace_id, body)
    sc = principal.scope
    if sc.everything:
        return agents, label
    return [a for a in agents if sc.sees_agent(a)], f"{label} (in {sc.label})"[:300]


@router.post("/preview")
async def preview(
    body: BroadcastIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agents, label = await scoped_audience(db, principal, body)
    return {
        "label": label,
        "count": len(agents),
        "agents": [{"id": a.id, "name": a.name} for a in agents],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def send(
    body: BroadcastIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> BroadcastOut:
    agents, label = await scoped_audience(db, principal, body)
    if not agents:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "nobody_there",
            "No active agents match that audience.",
        )
    now = datetime.now(UTC)
    b = Broadcast(
        workspace_id=principal.workspace_id,
        sender=principal.actor,
        audience=body.audience.model_dump(),
        audience_label=label,
        mode=body.mode,
        request_reply=body.request_reply and body.mode == "announcement",
        body=body.body,
        created_at=now,
    )
    db.add(b)
    await db.flush()
    for a in agents:
        receipt = BroadcastReceipt(broadcast_id=b.id, agent_id=a.id, delivered_at=now)
        if body.mode == "directive":
            # Each target gets a proposal in its triage column; a person decides to run it.
            first_line = body.body.strip().splitlines()[0][:120]
            t = Task(
                workspace_id=a.workspace_id,
                branch_id=a.branch_id,
                title=first_line,
                brief=body.body,
                assignee_agent_id=a.id,
                created_by=principal.actor,
                source="broadcast",
                status="triage",
            )
            db.add(t)
            await db.flush()
            receipt.task_id = t.id
            receipt.ack_at = now
        elif not b.request_reply:
            receipt.ack_at = now  # stored in the agent's context from now on
        db.add(receipt)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "broadcast.sent",
        target=b.id,
        after={"audience": label, "agents": len(agents), "mode": body.mode},
    )
    await db.commit()

    if b.request_reply:
        try:
            await dispatch.start_broadcast_replies(b.id, [a.id for a in agents])
        except Exception:  # noqa: BLE001 - replies are best effort; delivery already happened
            log.warning("could not start broadcast replies for %s", b.id, exc_info=True)
    for a in agents:
        await runtime.agent_status(a, "broadcast_received")
    await events.publish(
        principal.workspace_id,
        "broadcast.sent",
        {
            "broadcast_id": b.id,
            "label": label,
            "count": len(agents),
            "mode": b.mode,
            "agent_ids": [a.id for a in agents],
        },
    )
    return await _out(db, b, with_receipts=True)


@router.get("")
async def history(
    response: Response,
    limit: int = Query(default=100, ge=1, le=paging.MAX_LIMIT),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[BroadcastOut]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count). A scoped
    person sees what they sent and what reached an agent they can see."""
    q = select(Broadcast).where(Broadcast.workspace_id == principal.workspace_id)
    cond = principal.scope.agent_where()
    if cond is not None:
        reached = (
            select(BroadcastReceipt.broadcast_id)
            .join(Agent, Agent.id == BroadcastReceipt.agent_id)
            .where(BroadcastReceipt.broadcast_id == Broadcast.id, cond)
            .exists()
        )
        q = q.where(or_(Broadcast.sender == principal.actor, reached))
    rows = await paging.paginate(
        db,
        q,
        ((Broadcast.created_at, True), (Broadcast.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return [await _out(db, b) for b in rows]


@router.get("/{broadcast_id}")
async def detail(
    broadcast_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> BroadcastOut:
    b = await db.get(Broadcast, broadcast_id)
    if b is None or b.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "broadcast_not_found", "That broadcast is not here."
        )
    return await _out(db, b, with_receipts=True)
