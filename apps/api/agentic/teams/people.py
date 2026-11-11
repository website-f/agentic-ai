"""P97: people's work. Who manages whom, who may give a person a task, and how a person's
task moves on the board.

Managing (memberships.reports_to_user_id): a member reports to at most one manager in a
workspace. A manager "manages" their direct reports (not the reports of their reports). Only
the roles in MANAGER_ROLES can have people reporting to them. Nobody is placed under anyone
automatically: imported members report to no one until a person with members.manage sets it.

Who may give a person a task (`may_assign`), the rule the API enforces:
- anyone who may write work (work.write) gives themselves a task;
- whoever manages all members (members.manage: owner, admin, management, HR by default) gives
  anyone in the workspace a task;
- a branch manager gives a task to the people of their branch and to their direct reports;
- an HOD or a supervisor gives a task to their direct reports;
- anyone else (staff, operators) to no one but themselves.

A person's task never starts an agent run (agents/launch.py refuses a task without an
agent). Its moves are PERSON_MOVES; "done" by the assignee on a task someone else gave them
that asks for a check (`requires_review`) lands in review, and only the giver (or someone
else over it) accepts it.
"""

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import can
from ..i18n import Msg
from ..models import Membership, Task, User
from .branches import member_in_branches

log = logging.getLogger(__name__)

MANAGER_ROLES = frozenset(
    {"owner", "admin", "management", "hr", "branch_manager", "hod", "supervisor"}
)

# The moves a person's task may make by hand (drag or button). No "failed": people do not
# fail, they say what they wait for (blocked) or the task is cancelled.
PERSON_MOVES: dict[str, set[str]] = {
    "triage": {"ready", "running", "done", "cancelled"},
    "ready": {"triage", "running", "done", "cancelled"},
    "running": {"ready", "blocked", "review", "done", "cancelled"},
    "blocked": {"running", "ready", "done", "cancelled"},
    "review": {"done", "running", "cancelled"},
    "done": {"running"},
    "cancelled": {"triage"},
}
OPEN = ("triage", "ready", "running", "blocked", "review")
# What a person's move says in the task's timeline.
MOVE_NOTES = {
    "triage": "put it back to new",
    "ready": "took it on",
    "running": "is working on it",
    "blocked": "is waiting on something",
    "review": "sent it for a check",
    "done": "marked it done",
    "cancelled": "cancelled it",
}


class PeopleError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class Actor:
    """Who is acting (a Principal's fields; kept apart from api/ so teams/ stays below it)."""

    workspace_id: str
    user_id: str
    role: str
    branch_id: str | None
    # P98: every branch they work in (a branch manager gives tasks to the people of each).
    branch_ids: tuple[str, ...] = ()

    @property
    def actor(self) -> str:
        return f"user:{self.user_id}"


def actor_of(principal: Any) -> Actor:
    return Actor(
        principal.workspace_id,
        principal.user.id,
        principal.role,
        principal.branch_id,
        tuple(getattr(principal, "branch_ids", ()) or ()),
    )


def is_person_task(t: Task) -> bool:
    return bool(getattr(t, "assignee_user_id", None))


async def direct_reports(db: AsyncSession, workspace_id: str, user_id: str) -> list[str]:
    return list(
        (
            await db.scalars(
                select(Membership.user_id).where(
                    Membership.workspace_id == workspace_id,
                    Membership.reports_to_user_id == user_id,
                )
            )
        ).all()
    )


async def managers_of(db: AsyncSession, workspace_id: str, user_ids: set[str]) -> set[str]:
    """The managers the given people report to (who follows their tasks)."""
    if not user_ids:
        return set()
    rows = await db.scalars(
        select(Membership.reports_to_user_id).where(
            Membership.workspace_id == workspace_id,
            Membership.user_id.in_(user_ids),
            Membership.reports_to_user_id.is_not(None),
        )
    )
    return {r for r in rows.all() if r}


def assignable_where(a: Actor, team: list[str]) -> Any:
    """SQL on Membership: the people this actor may give a task to (self included)."""
    me = Membership.user_id == a.user_id
    if can(a.role, "members.manage"):
        return Membership.workspace_id == a.workspace_id
    parts: list[Any] = [me]
    if team:
        parts.append(Membership.user_id.in_(team))
    if a.role == "branch_manager" and a.branch_id:
        parts.append(member_in_branches(a.branch_ids or (a.branch_id,)))
    return or_(*parts)


async def may_assign(db: AsyncSession, a: Actor, user_id: str) -> Membership:
    """The member this actor may give a task to, or PeopleError (400: not a member here or
    switched off; 403: not one of the people they may give work to)."""
    m = await db.get(Membership, (a.workspace_id, user_id))
    if m is None or not m.user.is_active:
        raise PeopleError(400, "bad_person", "Pick someone who is a member here.")
    if user_id == a.user_id or can(a.role, "members.manage"):
        return m
    if m.reports_to_user_id == a.user_id and a.role in MANAGER_ROLES:
        return m
    if a.role == "branch_manager" and set(m.branch_ids) & set(a.branch_ids or (a.branch_id,)):
        return m
    raise PeopleError(
        403,
        "cannot_assign",
        "You can give tasks only to yourself and the people you manage.",
    )


async def names(db: AsyncSession, user_ids: set[str]) -> dict[str, str]:
    ids = {u for u in user_ids if u}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())


def land(t: Task, new_status: str, a: Actor) -> str:
    """Where a person's move lands, or PeopleError. Done by the assignee on someone else's
    task that asks for a check goes to review; only the giver side accepts it."""
    if new_status not in PERSON_MOVES.get(t.status, set()):
        raise PeopleError(409, "bad_move", "That move is not possible for this task.")
    doer = t.assignee_user_id == a.user_id and t.created_by != a.actor
    if new_status == "done" and doer and t.requires_review and t.status != "review":
        return "review"
    if new_status == "done" and doer and t.status == "review":
        raise PeopleError(
            403, "giver_accepts", "The person who gave you this task checks and accepts it."
        )
    return new_status


def event_data(t: Task, actor: str, **extra: Any) -> dict[str, Any]:
    """A live event about a person's task: it reaches them, their managers, whoever gave it
    and (for a branch's task) the branch manager (api/scope.py event_visible)."""
    return {
        "task_id": t.id,
        "status": t.status,
        "assignee_user_id": t.assignee_user_id,
        "branch_id": t.branch_id,
        "by": actor,
        **extra,
    }


async def notify(
    db: AsyncSession, t: Task, user_id: str | None, title: Msg, body: Msg, dedupe: str
) -> None:
    """Phone push / Telegram / WhatsApp to one person about a task; never breaks the call."""
    if not user_id:
        return
    from ..channels import deliver  # late: channels import agent modules

    try:
        ids = await deliver.notify_user(
            db, t.workspace_id, user_id, title, body, f"/tasks?task={t.id}", dedupe=dedupe
        )
        await deliver.start(ids)
    except Exception:  # noqa: BLE001 - a notice must never break the work
        log.warning("could not notify %s about %s", user_id, t.id, exc_info=True)


def giver_id(t: Task) -> str | None:
    return t.created_by.removeprefix("user:") if t.created_by.startswith("user:") else None


async def told_assigned(db: AsyncSession, t: Task, a: Actor, by_name: str) -> None:
    if t.assignee_user_id and t.assignee_user_id != a.user_id:
        await notify(
            db,
            t,
            t.assignee_user_id,
            Msg("New task for you: {title}", title=t.title[:100]),
            Msg("{name} gave you a task. Open it to accept it.", name=by_name),
            f"assigned:{t.id}:{t.assignee_user_id}",
        )


async def told_moved(db: AsyncSession, t: Task, a: Actor, by_name: str, before: str) -> None:
    """The other side hears of the moves that matter: the giver when the person finishes,
    sends it for a check or waits on something; the person when it is sent back."""
    giver = giver_id(t)
    if t.status in ("done", "review", "blocked") and giver and giver != a.user_id:
        title = {
            "done": Msg("Task done: {title}", title=t.title[:100]),
            "review": Msg("Ready for your check: {title}", title=t.title[:100]),
            "blocked": Msg("Task waiting: {title}", title=t.title[:100]),
        }[t.status]
        await notify(
            db,
            t,
            giver,
            title,
            Msg("{name} moved it.", name=by_name),
            f"moved:{t.id}:{t.status}:{giver}",
        )
    if (
        before == "review"
        and t.status == "running"
        and t.assignee_user_id
        and t.assignee_user_id != a.user_id
    ):
        await notify(
            db,
            t,
            t.assignee_user_id,
            Msg("Sent back to you: {title}", title=t.title[:100]),
            Msg("{name} sent it back. See the comments.", name=by_name),
            f"sentback:{t.id}:{t.updated_at}",
        )
