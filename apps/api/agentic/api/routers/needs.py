"""P48 "Needs you": everything waiting on this person, in one place (the bell in the top bar
and the phone's More menu). Only what they may act on, each with where to do it:

- approvals and questions from AI (theirs, or the ones they decide);
- work waiting for a decision they own (a blocked task), and work done that waits for them to
  accept, and documents an AI made for them to review;
- their own failed tasks of the last week (retry, another AI, or finish it themselves);
- email drafts waiting to be sent (their Outlook, and shared mailboxes they approve);
- bills and receipts waiting for approval (finance);
- skill proposals and routines that wait to be trusted (people who manage agents).

GET /api/me/needs -> {"total": n, "items": [{"key", "count", "to", "search"}]}
"""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...crm import access as crm_access
from ...crm.service import now
from ...microsoft import access as mail_access
from ...models import (
    Approval,
    Document,
    EmailDraft,
    MoneyDoc,
    Routine,
    SharedMailbox,
    SkillProposal,
    Task,
)
from ..deps import Principal, current_principal
from .desk import _mine, my_agents

router = APIRouter(prefix="/api/me", tags=["me"])

FAILED_DAYS = 7


async def _count(db: AsyncSession, q: Any) -> int:
    return int(await db.scalar(select(func.count()).select_from(q.subquery())) or 0)


@router.get("/needs")
async def needs(
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws, role = principal.workspace_id, principal.role
    items: list[dict[str, Any]] = []

    def add(key: str, n: int, to: str, search: dict[str, Any] | None = None) -> None:
        if n:
            items.append({"key": key, "count": n, "to": to, "search": search or {}})

    if can(role, "approvals.decide"):
        q = select(Approval.id).where(Approval.workspace_id == ws, Approval.status == "pending")
        cond = principal.scope.approval_where()
        if cond is not None:
            q = q.where(cond)
        add("approvals", await _count(db, q), "/approvals")

    add(
        "blocked",
        await _count(
            db,
            select(Task.id).where(
                Task.workspace_id == ws,
                Task.status == "blocked",
                Task.blocked_owner == principal.actor,
            ),
        ),
        "/tasks",
        {"status": "blocked"},
    )
    agent_ids = [a.id for a in await my_agents(db, principal)]
    add(
        "reviews",
        await _count(
            db, select(Task.id).where(*_mine(principal, agent_ids), Task.status == "review")
        ),
        "/workspace",
        {"tab": "work"},
    )
    add(
        "documents",
        await _count(
            db,
            select(Document.id).where(
                Document.workspace_id == ws,
                Document.owner_user_id == principal.user.id,
                Document.origin == "agent",
                Document.status == "review",
            ),
        ),
        "/documents",
    )
    add(
        "failed",
        await _count(
            db,
            select(Task.id).where(
                Task.workspace_id == ws,
                Task.created_by == principal.actor,
                Task.parent_task_id.is_(None),
                Task.status == "failed",
                Task.updated_at >= now() - timedelta(days=FAILED_DAYS),
            ),
        ),
        "/tasks",
        {"status": "failed"},
    )

    boxes = mail_access.approvable_where(ws, principal.user.id, role, principal.branch_id)
    draft_cond = [EmailDraft.user_id == principal.user.id]
    if boxes is not None:
        draft_cond.append(EmailDraft.shared_mailbox_id.in_(select(SharedMailbox.id).where(boxes)))
    add(
        "drafts",
        await _count(
            db,
            select(EmailDraft.id).where(
                EmailDraft.workspace_id == ws, EmailDraft.status == "pending", or_(*draft_cond)
            ),
        ),
        "/mail",
    )

    if can(role, "finance.manage"):
        add(
            "bills",
            await _count(
                db,
                select(MoneyDoc.id).where(
                    MoneyDoc.workspace_id == ws,
                    MoneyDoc.status == "awaiting_approval",
                    MoneyDoc.direction == "payable",
                    crm_access.finance_where(principal),
                ),
            ),
            "/money",
            {"tab": "payable"},
        )

    if any(can(role, p) for p in ("brain.manage", "agents.manage", "team.manage")):
        add(
            "skills",
            await _count(
                db,
                select(SkillProposal.id).where(
                    SkillProposal.workspace_id == ws, SkillProposal.status == "pending"
                ),
            ),
            "/skills",
            {"tab": "proposals"},
        )
        add(
            "routines",
            await _count(
                db,
                select(Routine.id).where(Routine.workspace_id == ws, Routine.status == "candidate"),
            ),
            "/learning",
            {},
        )
    return {"total": sum(i["count"] for i in items if i["key"] != "routines"), "items": items}
