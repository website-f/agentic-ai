"""Who may have personal assistants (P30).

Private assistants (company pulse, team performance, slacking report, Gmail, calendar,
chasing people) are for people who manage others: roles with `assistants.use` (owner, admin,
branch manager, HOD, supervisor). Staff, operators, approvers and viewers have at most one
personal AI, their twin.

An assistant made before this rule, or by someone whose role changed since, is never deleted.
While its owner's role has no `assistants.use` it is *dormant*: treated as paused. Chat and
new runs are refused with a plain reason (`dormant`), it reads as paused everywhere
(`agents.agent_out`), and a role change pauses it for real (`follow_role`) so schedules,
channels and workflows, which all check the agent's status, stop too. Getting the role back
resumes the assistants that this paused, and only those.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import can
from ..models import Agent, AuditLog, Membership

ASSIST = "assistants.use"
# The audit note on the pause a role change made: how follow_role knows what to resume.
PAUSED_NOTE = "paused: personal assistants are for people who manage others"
RESUMED_NOTE = "resumed: the owner's role has personal assistants again"


def may_assist(role: str | None) -> bool:
    return bool(role) and can(role or "", ASSIST)


async def dormant(db: AsyncSession, agent: Agent | None) -> bool:
    """A private assistant whose owner (as they are now) may not have assistants."""
    if agent is None or not agent.private:
        return False
    if not agent.owner_user_id:
        return True
    m = await db.get(Membership, (agent.workspace_id, agent.owner_user_id))
    return m is None or not may_assist(m.role)


async def _assistants(db: AsyncSession, workspace_id: str, user_id: str) -> list[Agent]:
    return list(
        (
            await db.scalars(
                select(Agent).where(
                    Agent.workspace_id == workspace_id,
                    Agent.owner_user_id == user_id,
                    Agent.private.is_(True),
                    Agent.status != "retired",
                )
            )
        ).all()
    )


async def settle_existing(db: AsyncSession) -> int:
    """Once at worker start: assistants made before the rule (or whose owner's role changed
    outside follow_role) are paused for real, audited, so schedules, channels and workflows
    that only read the stored status stop too. Idempotent; the caller commits."""
    owners = (
        await db.execute(
            select(Agent.workspace_id, Agent.owner_user_id, Membership.role)
            .join(
                Membership,
                (Membership.workspace_id == Agent.workspace_id)
                & (Membership.user_id == Agent.owner_user_id),
            )
            .where(Agent.private.is_(True), Agent.status == "active")
            .distinct()
        )
    ).all()
    changed = 0
    for ws, user_id, role in owners:
        if not may_assist(role):
            changed += await follow_role(db, ws, user_id, role, "system:assistants")
    return changed


async def follow_role(
    db: AsyncSession, workspace_id: str, user_id: str, role: str, actor: str
) -> int:
    """After a member's role changed (the caller commits): pause their active assistants when
    the new role has no assistants.use, or resume the ones a role change paused when it has.
    Returns how many changed. Nothing is deleted."""
    from ..services import audit  # late: services import the models this module needs

    keep = may_assist(role)
    changed = 0
    for a in await _assistants(db, workspace_id, user_id):
        if not keep and a.status == "active":
            a.status = "paused"
            note = PAUSED_NOTE
        elif keep and a.status == "paused":
            last = await db.scalar(
                select(AuditLog.note)
                .where(
                    AuditLog.workspace_id == workspace_id,
                    AuditLog.target == a.id,
                    AuditLog.action == "agent.updated",
                )
                .order_by(AuditLog.id.desc())
                .limit(1)
            )
            if last != PAUSED_NOTE:  # paused by a person: theirs to resume
                continue
            a.status = "active"
            note = RESUMED_NOTE
        else:
            continue
        changed += 1
        await audit.record(
            db,
            workspace_id,
            actor,
            "agent.updated",
            target=a.id,
            before={"status": "paused" if a.status == "active" else "active"},
            after={"status": a.status},
            note=note,
        )
    return changed
