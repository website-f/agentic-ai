"""Deciding an approval. One function for every way a person can decide: the dashboard,
a phone notification button, or a Telegram button. Same checks, same audit, same signal."""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Approval, Task
from ..services import audit, events
from . import dispatch


class DecisionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


async def decide(
    db: AsyncSession,
    a: Approval,
    actor: str,
    decision: str,
    scope: str | None = "once",
    answer: str | None = None,
    via: str = "dashboard",
) -> Approval:
    if a.status != "pending":
        raise DecisionError(409, "already_decided", f"This was already {a.status}.")
    answer = (answer or "").strip() or None
    if a.kind == "question":
        if decision == "deny":
            a.status, a.answer = "denied", answer
        elif not answer:
            raise DecisionError(422, "answer_required", "Type an answer.")
        else:
            a.status, a.answer = "answered", answer
    else:
        if decision not in ("approve", "deny"):
            raise DecisionError(422, "bad_decision", "Approve or deny this request.")
        a.status = "approved" if decision == "approve" else "denied"
        a.scope = (scope or "once") if decision == "approve" else None
        a.answer = answer
    a.decided_by, a.decided_at = actor, datetime.now(UTC)
    await audit.record(
        db,
        a.workspace_id,
        actor,
        f"approval.{a.status}",
        target=a.id,
        after={"tool": a.tool_name, "task_id": a.task_id, "scope": a.scope, "via": via},
    )
    await db.commit()

    t = await db.get(Task, a.task_id)
    if t and t.workflow_id:
        try:
            # Temporal stores the signal even if no worker is running right now.
            await dispatch.signal_decision(t.workflow_id, a.id)
        except Exception as e:  # noqa: BLE001 - Temporal itself is unreachable
            a.status, a.scope, a.answer, a.decided_by, a.decided_at = (
                "pending",
                None,
                None,
                None,
                None,
            )
            await db.commit()
            raise DecisionError(
                503,
                "temporal_unavailable",
                "Temporal is not reachable, so the decision was not sent. Try again in a moment.",
            ) from e
    await events.publish(
        a.workspace_id,
        "approval.resolved",
        {"approval_id": a.id, "status": a.status, "task_id": a.task_id, "via": via},
    )
    return a
