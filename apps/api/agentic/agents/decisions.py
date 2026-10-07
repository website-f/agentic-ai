"""Deciding an approval. One function for every way a person can decide: the dashboard,
a phone notification button, or a Telegram button. Same checks, same audit, same signal.

P29: the approval row is locked while it is decided (a dashboard click, a Telegram button and
the expiry can race), and a run that no longer exists (Temporal NOT_FOUND) is not "Temporal
unreachable": the decision is kept and the task is handed back so a person can restart it;
the new run applies the recorded decision (runtime._resolve_calls).
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from ..i18n.labels import decision_status_label
from ..models import Approval, Task
from ..services import audit, events
from . import dispatch


class DecisionError(Exception):
    """`message` is a Msg: English in logs, the person's language when shown."""

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
    # P29: lock the row and read its current state; a second decider waits, then sees it.
    locked = await db.scalar(
        select(Approval)
        .where(Approval.id == a.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    a = locked or a
    if a.status != "pending":
        raise DecisionError(
            409,
            "already_decided",
            Msg("This was already {status}.", status=decision_status_label(a.status)),
        )
    answer = (answer or "").strip() or None
    if a.kind == "question":
        if decision == "deny":
            a.status, a.answer = "denied", answer
        elif not answer:
            raise DecisionError(422, "answer_required", Msg("Type an answer."))
        else:
            a.status, a.answer = "answered", answer
    else:
        if decision not in ("approve", "deny"):
            raise DecisionError(422, "bad_decision", Msg("Approve or deny this request."))
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
            if _not_found(e):
                await _run_gone(db, t, a)
                return await _resolved(a, via)
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
                Msg(
                    "Temporal is not reachable, so the decision was not sent. "
                    "Try again in a moment."
                ),
            ) from e
    return await _resolved(a, via)


async def _resolved(a: Approval, via: str) -> Approval:
    await events.publish(
        a.workspace_id,
        "approval.resolved",
        {
            "approval_id": a.id,
            "status": a.status,
            "task_id": a.task_id,
            "agent_id": a.agent_id,
            "via": via,
        },
    )
    return a


def _not_found(e: Exception) -> bool:
    """Temporal answered: that workflow does not exist (or has already closed)."""
    from temporalio.service import RPCError, RPCStatusCode

    return isinstance(e, RPCError) and e.status == RPCStatusCode.NOT_FOUND


GONE_REASON = "Its run ended before the decision arrived"


async def _run_gone(db: AsyncSession, t: Task, a: Approval) -> None:
    """The decision stands, but no run is waiting for it: hand the task to a person, who can
    start it again (launch.restartable); the new run applies the decision."""
    from ..teams.reconcile import STOPPED
    from . import runtime  # late: runtime imports the channels that import this module

    if t.status not in ("running", "blocked"):
        return  # finished or cancelled meanwhile: nothing waits for it
    owner = a.decided_by if (a.decided_by or "").startswith("user:") else t.created_by
    await runtime.set_task_status(
        db,
        t,
        "blocked",
        actor="system",
        note="its run had ended when the decision arrived; start it again to continue",
        blocked_reason=GONE_REASON[:300],
        blocked_owner=owner,
        blocked_action=f"{STOPPED}: start it again to apply the decision"[:300],
    )
