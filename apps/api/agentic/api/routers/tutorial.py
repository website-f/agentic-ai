"""The tutorial's progress (P19): which lessons a person has already done for real.

GET /api/tutorial/progress answers with yes/no signals read from real data (one round trip
of EXISTS checks, each stopping at the first row), the person's track, and what they marked
done by hand (users.prefs.tutorial). The web app maps signals onto lessons.

Signals about the office being set up (a provider, a company, people) are workspace facts;
everything else is about this person or what they see, so a staff member's progress is
theirs, not the owner's.
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import exists, false, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import (
    SOP,
    Agent,
    AIProvider,
    Approval,
    AuditLog,
    Blueprint,
    Branch,
    Channel,
    ChannelLink,
    ChatSession,
    DocFile,
    GoogleAccount,
    Membership,
    ModelGroup,
    PushSubscription,
    Schedule,
    Task,
    User,
    Workflow,
    WorkflowRun,
)
from ...services import prefs
from ..deps import Principal, current_principal

router = APIRouter(prefix="/api/tutorial", tags=["tutorial"])

Track = Literal["owner", "management", "staff", "approver"]

TRACK_OF_ROLE: dict[str, Track] = {
    "owner": "owner",
    "admin": "owner",
    "branch_manager": "management",
    "hod": "management",
    "supervisor": "management",
    "operator": "management",
    "staff": "staff",
    "approver": "approver",
    "viewer": "approver",
}


class ProgressOut(BaseModel):
    role: str
    track: Track
    signals: dict[str, bool]
    done: list[str]
    dismissed: bool


@router.get("/progress")
async def progress(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> ProgressOut:
    ws, uid, actor, sc = (
        principal.workspace_id,
        principal.user.id,
        principal.actor,
        principal.scope,
    )
    in_scope = Agent.workspace_id == ws, sc.agent_where(), Agent.status != "retired"
    team = (*in_scope, Agent.private.is_(False), Agent.is_twin.is_(False))
    twin = (Agent.workspace_id == ws, Agent.owner_user_id == uid, Agent.is_twin.is_(True))
    twin = (*twin, Agent.status != "retired")
    mine = Agent.owner_user_id == uid

    checks: dict[str, Any] = {
        # The office is set up (workspace facts).
        "provider": exists().where(AIProvider.workspace_id == ws),
        "model_group": exists().where(
            ModelGroup.workspace_id == ws, func.jsonb_array_length(ModelGroup.members) > 0
        ),
        "company": exists().where(Branch.workspace_id == ws),
        "people": select(func.count())
        .select_from(Membership)
        .where(Membership.workspace_id == ws)
        .scalar_subquery()
        > 1,
        "blueprint": exists().where(Blueprint.workspace_id == ws),
        "workflow": exists().where(
            Workflow.workspace_id == ws,
            or_(
                Workflow.branch_id.is_(None),
                true() if sc.everything else Workflow.branch_id == sc.branch_id,
            ),
        ),
        "autopilot": exists().where(
            AuditLog.workspace_id == ws, AuditLog.action == "learning.mode"
        ),
        "sop": exists().where(SOP.workspace_id == ws),
        # What this person sees or did.
        "agent": exists().where(*team),
        "budget": exists().where(
            *in_scope,
            or_(Agent.budget_daily_tokens.is_not(None), Agent.budget_monthly_usd.is_not(None)),
        ),
        "task_created": exists().where(Task.workspace_id == ws, Task.created_by == actor),
        "task_done": exists().where(
            Task.workspace_id == ws, Task.created_by == actor, Task.status == "done"
        ),
        "reviewed": exists().where(
            AuditLog.workspace_id == ws, AuditLog.actor == actor, AuditLog.action == "task.accepted"
        ),
        "approved": exists().where(Approval.workspace_id == ws, Approval.decided_by == actor),
        "workflow_run": exists().where(
            WorkflowRun.workspace_id == ws, WorkflowRun.created_by == actor
        ),
        "schedule": exists().where(Schedule.workspace_id == ws, Schedule.created_by == actor),
        "library": exists().where(
            DocFile.workspace_id == ws,
            DocFile.library.is_(True),
            or_(DocFile.created_by == actor, true() if sc.everything else false()),
        ),
        "chat": exists().where(ChatSession.workspace_id == ws, ChatSession.user_id == uid),
        "twin": exists().where(*twin),
        "work_hours": exists().where(*twin, Agent.work_hours.is_not(None)),
        "assistant": exists().where(
            Agent.workspace_id == ws, mine, Agent.private.is_(True), Agent.status != "retired"
        ),
        "gmail": exists().where(GoogleAccount.workspace_id == ws, GoogleAccount.user_id == uid),
        "whatsapp": exists()
        .where(ChannelLink.user_id == uid, Channel.kind == "whatsapp", Channel.workspace_id == ws)
        .where(ChannelLink.channel_id == Channel.id),
        "push": exists().where(
            PushSubscription.workspace_id == ws, PushSubscription.user_id == uid
        ),
    }
    row = (await db.execute(select(*(c.label(k) for k, c in checks.items())))).one()
    signals = {k: bool(v) for k, v in row._mapping.items()}

    user = await db.get(User, uid)
    tut = prefs.visible(user.prefs if user else None)["tutorial"]
    return ProgressOut(
        role=principal.role,
        track=TRACK_OF_ROLE.get(principal.role, "approver"),
        signals=signals,
        done=[d for d in tut.get("done", []) if isinstance(d, str)],
        dismissed=bool(tut.get("dismissed")),
    )
