"""P48 "Needs you": everything waiting on this person, in one place (the bell in the top bar
and the phone's More menu). Only what they may act on, each with where to do it:

- approvals and questions from AI (theirs, or the ones they decide);
- tasks a person gave them that they have not taken yet, and their overdue ones (P97);
- work waiting for a decision they own (a blocked task), and work done that waits for them to
  accept, and documents an AI made for them to review;
- their own failed tasks of the last week (retry, another AI, or finish it themselves);
- email drafts waiting to be sent (their Outlook, and shared mailboxes they approve);
- skill proposals and routines that wait to be trusted (people who manage agents).

GET /api/me/needs -> {"total", "unread", "items": [{"key", "count", "to", "search"}],
"entries": [{"key", "id", "title", "at", "to", "search", "new"}]}; POST /api/me/needs/seen
marks them read (P56: the badge counts what is new since).
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import APPROVER_ROLES, HELD_ROLE, can
from ...microsoft import access as mail_access
from ...models import (
    Approval,
    Document,
    EmailDraft,
    Routine,
    SharedMailbox,
    SkillProposal,
    Task,
)
from ...services import prefs
from ...services.clock import now
from ...teams.task_parts import assigned_to
from ..deps import Principal, current_principal
from .desk import _mine, my_agents

router = APIRouter(prefix="/api/me", tags=["me"])

FAILED_DAYS = 7


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
        """One kind: its count, and its newest PER_KIND items (id, title, when) as links.
        P123: one query for both (the count of every row rides on each of the newest)."""
        newest = (
            q.with_only_columns(*cols, func.count().over()).order_by(cols[2].desc()).limit(PER_KIND)
        )
        rows = (await db.execute(newest)).all()
        n = int(rows[0][3]) if rows else 0
        if not n:
            return
        items.append({"key": key, "count": n, "to": to, "search": search or {}})
        for rid, title, at, _ in rows:
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
    # P97: tasks a person gave me that I have not taken yet, and my overdue ones (P109: as
    # any one of its assignees).
    await add(
        "assigned",
        select(Task.id).where(
            Task.workspace_id == ws,
            assigned_to([principal.user.id]),
            or_(
                Task.status == "triage",
                and_(Task.status.in_(("ready", "running", "blocked")), Task.due_at < now()),
            ),
        ),
        (Task.id, Task.title, Task.updated_at),
        "/tasks",
        {"who": "assigned"},
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

    boxes = mail_access.approvable_where(ws, principal.user.id, role, principal.branch_ids)
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
    # P109: another email account whose attachments are all backed up: disconnect it and use
    # Microsoft 365 (shown until the person disconnects it).
    from ...mailbox.models import ExternalMailAccount as Xm

    await add(
        "mail_backup",
        select(Xm.id).where(
            Xm.workspace_id == ws, Xm.user_id == principal.user.id, Xm.backup_done_at.is_not(None)
        ),
        (Xm.id, Xm.email, Xm.backup_done_at),
        "/mail",
        {"app": "accounts"},
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
    if can(role, "org.manage") and principal.scope.everything:
        # P57: services the approved-services lock stopped, waiting for an owner's decision.
        from ...engine import compliance
        from ...models import Workspace

        st = compliance.state(await db.get(Workspace, ws))
        waiting = {k: r for k, r in st.requests.items() if st.lock and k not in st.approved}
        if waiting:
            items.append(
                {"key": "services", "count": len(waiting), "to": "/approved-services", "search": {}}
            )
            for key, r in waiting.items():
                at = r.get("last_at")
                entries.append(
                    {
                        "key": "services",
                        "id": key,
                        "title": f"{r.get('label') or key}: {r.get('what') or ''}".strip(": "),
                        "at": datetime.fromisoformat(at) if at else None,
                        "to": "/approved-services",
                        "search": {},
                    }
                )
    await _p109_needs(db, principal, add)
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


async def _p109_needs(db: AsyncSession, principal: Principal, add: Any) -> None:
    """P109: files I uploaded for other companies that wait for my check; files uploaded for
    my company that I was told about and have not opened; feedback comments mentioning me."""
    from ...feedback.models import Feedback, FeedbackComment
    from ...org.models import FileHandoff

    ws, me = principal.workspace_id, principal.user.id
    # P120: people's requests waiting for me (I was asked first; the office's managers, the
    # ones of people who report to no one).
    from ...org.models import PersonRequest

    first = PersonRequest.approver_id == me
    if can(principal.role, "org.manage") and principal.role != HELD_ROLE:  # P125
        first = or_(first, PersonRequest.approver_id.is_(None))
    await add(
        "requests",
        select(PersonRequest.id).where(
            PersonRequest.workspace_id == ws,
            PersonRequest.status == "pending",
            PersonRequest.requested_by != me,
            first,
        ),
        (PersonRequest.id, PersonRequest.title, PersonRequest.created_at),
        "/approvals",
        {"tab": "people"},
        lambda i: {"tab": "people", "request": i},
    )
    # P125: IT support's changes waiting for an owner or global admin.
    if principal.role in APPROVER_ROLES:
        from ...org.held_models import HeldChange
        from .held_changes import pending_count_where

        await add(
            "it_changes",
            select(HeldChange.id).where(pending_count_where(principal)),
            (HeldChange.id, HeldChange.title, HeldChange.created_at),
            "/approvals",
            {"tab": "it"},
            lambda i: {"tab": "it", "change": i},
        )
    await add(
        "handoffs_check",
        select(FileHandoff.id).where(
            FileHandoff.workspace_id == ws,
            FileHandoff.uploader_user_id == me,
            FileHandoff.status == "pending",
        ),
        (FileHandoff.id, FileHandoff.file_name, FileHandoff.created_at),
        "/handoffs",
        {"tab": "check"},
    )
    await add(
        "handoffs_in",
        select(FileHandoff.id).where(
            FileHandoff.workspace_id == ws,
            FileHandoff.notified.contains([me]),
            ~FileHandoff.seen_by.contains([me]),
        ),
        (FileHandoff.id, FileHandoff.file_name, FileHandoff.created_at),
        "/handoffs",
        {"tab": "received"},
    )
    await add(
        "mentions",
        select(FeedbackComment.id)
        .join(Feedback, Feedback.id == FeedbackComment.feedback_id)
        .where(
            FeedbackComment.workspace_id == ws,
            FeedbackComment.mentions.contains([me]),
            ~FeedbackComment.seen_by.contains([me]),
        ),
        (
            func.concat(FeedbackComment.feedback_id, ":", FeedbackComment.id),
            FeedbackComment.body,
            FeedbackComment.created_at,
        ),
        "/feedbacks",
        None,
        lambda i: {"f": i.split(":")[0]},
    )
