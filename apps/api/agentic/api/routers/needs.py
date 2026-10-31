"""P48 "Needs you": everything waiting on this person, in one place (the bell in the top bar
and the phone's More menu). Only what they may act on, each with where to do it:

- approvals and questions from AI (theirs, or the ones they decide);
- work waiting for a decision they own (a blocked task), and work done that waits for them to
  accept, and documents an AI made for them to review;
- their own failed tasks of the last week (retry, another AI, or finish it themselves);
- email drafts waiting to be sent (their Outlook, and shared mailboxes they approve);
- bills and receipts waiting for approval (finance);
- skill proposals and routines that wait to be trusted (people who manage agents).

GET /api/me/needs -> {"total", "unread", "items": [{"key", "count", "to", "search"}],
"entries": [{"key", "id", "title", "at", "to", "search", "new"}]}; POST /api/me/needs/seen
marks them read (P56: the badge counts what is new since).
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
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
from ...services import prefs
from ..deps import Principal, current_principal
from .desk import _mine, my_agents

router = APIRouter(prefix="/api/me", tags=["me"])

FAILED_DAYS = 7


async def _count(db: AsyncSession, q: Any) -> int:
    return int(await db.scalar(select(func.count()).select_from(q.subquery())) or 0)


PER_KIND = 25  # the newest of each kind listed in the bell (the count covers them all)


def _seen_at(principal: Principal) -> datetime | None:
    """When the person last marked the bell read (P56): only newer items count as new."""
    raw = ((principal.user.prefs or {}).get("needs") or {}).get("seen_at")
    try:
        return datetime.fromisoformat(str(raw)) if raw else None
    except ValueError:
        return None


@router.get("/needs")
async def needs(
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws, role = principal.workspace_id, principal.role
    items: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []

    async def add(
        key: str,
        q: Any,
        cols: tuple[Any, Any, Any],
        to: str,
        search: dict[str, Any] | None = None,
        link: Callable[[str], dict[str, Any]] | None = None,
    ) -> None:
        """One kind: its count, and its newest PER_KIND items (id, title, when) as links."""
        n = await _count(db, q)
        if not n:
            return
        items.append({"key": key, "count": n, "to": to, "search": search or {}})
        newest = q.with_only_columns(*cols).order_by(cols[2].desc()).limit(PER_KIND)
        rows = (await db.execute(newest)).all()
        for rid, title, at in rows:
            entries.append(
                {
                    "key": key,
                    "id": rid,
                    "title": (str(title or "").strip().splitlines() or [""])[0][:160],
                    "at": at,
                    "to": to,
                    "search": link(rid) if link else (search or {}),
                }
            )

    if can(role, "approvals.decide"):
        q = select(Approval.id).where(Approval.workspace_id == ws, Approval.status == "pending")
        cond = principal.scope.approval_where()
        if cond is not None:
            q = q.where(cond)
        q = q.join(Task, Task.id == Approval.task_id)
        await add("approvals", q, (Approval.id, Task.title, Approval.created_at), "/approvals")

    await add(
        "blocked",
        select(Task.id).where(
            Task.workspace_id == ws,
            Task.status == "blocked",
            Task.blocked_owner == principal.actor,
        ),
        (Task.id, Task.title, Task.updated_at),
        "/tasks",
        {"status": "blocked"},
        lambda i: {"task": i},
    )
    agent_ids = [a.id for a in await my_agents(db, principal)]
    await add(
        "reviews",
        select(Task.id).where(*_mine(principal, agent_ids), Task.status == "review"),
        (Task.id, Task.title, Task.updated_at),
        "/workspace",
        {"tab": "work"},
        lambda i: {"task": i},
    )
    await add(
        "documents",
        select(Document.id).where(
            Document.workspace_id == ws,
            Document.owner_user_id == principal.user.id,
            Document.origin == "agent",
            Document.status == "review",
        ),
        (Document.id, Document.title, Document.updated_at),
        "/documents",
        None,
        lambda i: {"d": i},
    )
    await add(
        "failed",
        select(Task.id).where(
            Task.workspace_id == ws,
            Task.created_by == principal.actor,
            Task.parent_task_id.is_(None),
            Task.status == "failed",
            Task.updated_at >= now() - timedelta(days=FAILED_DAYS),
        ),
        (Task.id, Task.title, Task.updated_at),
        "/tasks",
        {"status": "failed"},
        lambda i: {"task": i},
    )

    boxes = mail_access.approvable_where(ws, principal.user.id, role, principal.branch_id)
    draft_cond = [EmailDraft.user_id == principal.user.id]
    if boxes is not None:
        draft_cond.append(EmailDraft.shared_mailbox_id.in_(select(SharedMailbox.id).where(boxes)))
    await add(
        "drafts",
        select(EmailDraft.id).where(
            EmailDraft.workspace_id == ws, EmailDraft.status == "pending", or_(*draft_cond)
        ),
        (EmailDraft.id, EmailDraft.subject, EmailDraft.created_at),
        "/mail",
    )

    if can(role, "finance.manage"):
        await add(
            "bills",
            select(MoneyDoc.id).where(
                MoneyDoc.workspace_id == ws,
                MoneyDoc.status == "awaiting_approval",
                MoneyDoc.direction == "payable",
                crm_access.finance_where(principal),
            ),
            (MoneyDoc.id, MoneyDoc.number, MoneyDoc.created_at),
            "/money",
            {"tab": "payable"},
        )

    if any(can(role, p) for p in ("brain.manage", "agents.manage", "team.manage")):
        await add(
            "skills",
            select(SkillProposal.id).where(
                SkillProposal.workspace_id == ws, SkillProposal.status == "pending"
            ),
            (SkillProposal.id, SkillProposal.name, SkillProposal.created_at),
            "/skills",
            {"tab": "proposals"},
        )
        await add(
            "routines",
            select(Routine.id).where(Routine.workspace_id == ws, Routine.status == "candidate"),
            (Routine.id, Routine.name, Routine.created_at),
            "/learning",
            {},
        )
    seen = _seen_at(principal)
    entries.sort(key=lambda e: e["at"] or datetime.min.replace(tzinfo=UTC), reverse=True)
    for e in entries:
        e["new"] = seen is None or (e["at"] is not None and e["at"] > seen)
    counted = [e for e in entries if e["key"] != "routines"]
    return {
        "total": sum(i["count"] for i in items if i["key"] != "routines"),
        # The bell's badge: what arrived since "Mark all as read" (the list keeps them all).
        "unread": sum(1 for e in counted if e["new"]),
        "items": items,
        "entries": entries,
        "seen_at": seen,
    }


@router.post("/needs/seen")
async def needs_seen(
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """P56 "Mark all as read": the badge counts only what comes after this. Nothing is
    decided or hidden; the items stay in the list until they are done."""
    at = datetime.now(UTC)
    await prefs.update(db, principal.user.id, {"needs": {"seen_at": at.isoformat()}})
    await db.commit()
    return {"seen_at": at}
