"""P21 task blockers: "start B when A is done".

A task with unfinished blockers is parked in `blocked` with blocked_reason "Waiting for
<titles>" (never started). When a blocker reaches done, every task whose blockers are now all
done is launched through launch.launch, so working hours, budgets and the usual run
bookkeeping apply. A cancelled or failed blocker does not count as done: the waiting task is
routed to its creator (blocked_owner) with an action to decide, and they are notified.

Nothing here leaves work where nobody is responsible for the next move: a parked task always
names what it waits for (a blocker, or an owner + action).
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Task, TaskBlocker

log = logging.getLogger("agentic.teams.blockers")

WAITING = "Waiting for "
# Routed to the owner because a blocker will never be done (cancelled or failed).
DEAD_BLOCKER = "A task it waits for was "
FINISHED = ("done", "failed", "cancelled")
DEAD = ("failed", "cancelled")
# Tasks that may still get blockers: not started, or already parked.
ADDABLE = ("triage", "ready", "blocked", "failed", "cancelled")
MAX_BLOCKERS = 20
ACTOR = "system:blockers"


class BlockerError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def parked(t: Task) -> bool:
    """Blocked because of its blockers (waiting, or a dead blocker routed to a person), not
    because a running agent waits on an approval."""
    return t.status == "blocked" and (
        (t.blocked_reason or "").startswith(WAITING)
        or (t.blocked_action or "").startswith(DEAD_BLOCKER)
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _titles(rows: list[Task]) -> str:
    names = [f'"{r.title[:60]}"' for r in rows[:3]]
    more = f" and {len(rows) - 3} more" if len(rows) > 3 else ""
    return ", ".join(names) + more


async def blockers_of(db: AsyncSession, task_id: str) -> list[Task]:
    return list(
        (
            await db.scalars(
                select(Task)
                .join(TaskBlocker, TaskBlocker.blocker_task_id == Task.id)
                .where(TaskBlocker.task_id == task_id)
                .order_by(TaskBlocker.id)
            )
        ).all()
    )


async def waiting_on(db: AsyncSession, blocker_id: str) -> list[Task]:
    """Tasks that wait for this one."""
    return list(
        (
            await db.scalars(
                select(Task)
                .join(TaskBlocker, TaskBlocker.task_id == Task.id)
                .where(TaskBlocker.blocker_task_id == blocker_id)
                .order_by(TaskBlocker.id)
            )
        ).all()
    )


async def open_map(db: AsyncSession, task_ids: list[str]) -> dict[str, list[Task]]:
    """For a page of tasks: their blockers that are not done yet (one query)."""
    if not task_ids:
        return {}
    out: dict[str, list[Task]] = {}
    for tid, b in (
        await db.execute(
            select(TaskBlocker.task_id, Task)
            .join(Task, Task.id == TaskBlocker.blocker_task_id)
            .where(TaskBlocker.task_id.in_(task_ids), Task.status != "done")
            .order_by(TaskBlocker.id)
        )
    ).all():
        out.setdefault(tid, []).append(b)
    return out


async def _creates_cycle(db: AsyncSession, task_id: str, blocker_id: str) -> bool:
    """Would "task waits for blocker" close a loop? True when the blocker already waits
    (directly or through others) for the task."""
    frontier, seen = {blocker_id}, {blocker_id}
    while frontier:
        nxt = set(
            (
                await db.scalars(
                    select(TaskBlocker.blocker_task_id).where(TaskBlocker.task_id.in_(frontier))
                )
            ).all()
        )
        if task_id in nxt:
            return True
        frontier = nxt - seen
        seen |= nxt
    return False


async def add(
    db: AsyncSession, t: Task, blocker_ids: list[str], *, branch_only: str | None = None
) -> int:
    """Make `t` wait for these tasks (validated: same workspace, not itself, no cycle).
    branch_only: an isolated branch's agent may only wait for its own branch's work.
    Returns how many were new. The caller commits and calls `refresh`."""
    if t.status not in ADDABLE or (t.status == "blocked" and not parked(t)):
        raise BlockerError(
            409, "task_started", "Only work that has not started can wait for other tasks."
        )
    ids = [str(i) for i in dict.fromkeys(blocker_ids) if str(i).strip()]
    have = set(
        (
            await db.scalars(select(TaskBlocker.blocker_task_id).where(TaskBlocker.task_id == t.id))
        ).all()
    )
    if len(have | set(ids)) > MAX_BLOCKERS:
        raise BlockerError(
            400, "too_many_blockers", f"A task can wait for at most {MAX_BLOCKERS} tasks."
        )
    added = 0
    for bid in ids:
        if bid == t.id:
            raise BlockerError(400, "self_blocker", "A task cannot wait for itself.")
        b = await db.get(Task, bid)
        if (
            b is None
            or b.workspace_id != t.workspace_id
            or (branch_only and b.branch_id != branch_only)
        ):
            raise BlockerError(400, "bad_blocker", f"There is no task {bid} to wait for.")
        if bid in have:
            continue
        if await _creates_cycle(db, t.id, bid):
            raise BlockerError(
                409,
                "blocker_cycle",
                f'"{b.title[:80]}" already waits for this task (directly or through others): '
                "waiting for it would block both forever.",
            )
        db.add(TaskBlocker(task_id=t.id, blocker_task_id=bid, created_at=_now()))
        await db.flush()
        added += 1
    return added


async def remove(db: AsyncSession, t: Task, blocker_id: str) -> bool:
    res = await db.execute(
        delete(TaskBlocker).where(
            TaskBlocker.task_id == t.id, TaskBlocker.blocker_task_id == blocker_id
        )
    )
    return bool(res.rowcount)  # type: ignore[attr-defined]


async def refresh(db: AsyncSession, t: Task, actor: str, *, start: bool = True) -> str:
    """Put a not-yet-started task where its blockers say it belongs:
    waiting | routed (a dead blocker) | released (all done; launched if `start`) | unchanged.
    """
    from ..agents import runtime  # late: the runtime imports team modules

    if t.status not in ADDABLE or (t.status == "blocked" and not parked(t)):
        return "unchanged"
    rows = await blockers_of(db, t.id)
    if not rows:
        if parked(t):
            return await _release(db, t, actor, start=start)
        return "unchanged"
    dead = [b for b in rows if b.status in DEAD]
    if dead:
        b = dead[0]
        what = "cancelled" if b.status == "cancelled" else "failed"
        action = f"{DEAD_BLOCKER}{what}: decide"
        if t.status == "blocked" and t.blocked_action == action:
            return "routed"  # already with its owner: do not notify twice
        await runtime.set_task_status(
            db,
            t,
            "blocked",
            actor=actor,
            note=f'is stuck: "{b.title[:80]}", which it waits for, was {what}',
            blocked_reason=f'"{b.title[:120]}" was {what}, so this cannot start'[:300],
            blocked_owner=t.created_by,
            blocked_action=action,
        )
        await _notify_owner(
            db, t, f'"{b.title[:80]}" was {what}. Start this anyway, remove the wait, or cancel it.'
        )
        return "routed"
    waiting = [b for b in rows if b.status != "done"]
    if waiting:
        reason = f"{WAITING}{_titles(waiting)}"[:300]
        if t.status == "blocked" and t.blocked_reason == reason:
            return "waiting"
        await runtime.set_task_status(
            db,
            t,
            "blocked",
            actor=actor,
            note=f"is waiting for {_titles(waiting)}",
            blocked_reason=reason,
            blocked_owner=None,
            blocked_action=None,
        )
        return "waiting"
    if parked(t) or t.status in ("triage", "ready"):
        return await _release(db, t, actor, start=start)
    return "unchanged"


async def _release(db: AsyncSession, t: Task, actor: str, *, start: bool) -> str:
    from ..agents import launch, runtime

    target = "ready" if t.assignee_agent_id else "triage"
    was_parked = parked(t)
    if was_parked:
        await runtime.set_task_status(
            db,
            t,
            target,
            actor=actor,
            note="can start: everything it waited for is done",
            blocked_reason=None,
            blocked_owner=None,
            blocked_action=None,
        )
    if not (start and t.assignee_agent_id and t.status == "ready"):
        return "released"
    try:
        await launch.launch(db, t, actor)
    except launch.LaunchError as e:
        t.blocked_reason = f"Did not start: {e.message}"[:300]
        await db.commit()
        return "released"
    return "started"


async def on_finished(db: AsyncSession, blocker: Task) -> list[str]:
    """A task reached done, failed or cancelled: move every task that waits for it on.
    Returns the ids of the tasks whose state changed."""
    if blocker.status not in FINISHED:
        return []
    moved: list[str] = []
    for t in await waiting_on(db, blocker.id):
        if not parked(t):
            continue
        try:
            before = (t.status, t.blocked_reason, t.blocked_action)
            await refresh(db, t, ACTOR)
            if (t.status, t.blocked_reason, t.blocked_action) != before:
                moved.append(t.id)
        except Exception:  # noqa: BLE001 - one waiting task must not stop the others
            log.warning("could not move %s on after %s", t.id, blocker.id, exc_info=True)
    return moved


async def owner_user(db: AsyncSession, t: Task) -> str | None:
    """The person to tell about a routed task: its creator, or the creating agent's owner."""
    who = t.created_by or ""
    if who.startswith("user:"):
        return who.removeprefix("user:")
    if who.startswith("agent:"):
        a = await db.get(Agent, who.removeprefix("agent:"))
        return a.owner_user_id if a else None
    return None


async def _notify_owner(db: AsyncSession, t: Task, body: str) -> None:
    await notify_owner(
        db,
        t,
        f"Needs your decision: {t.title}"[:120],
        body,
        dedupe=f"routed:{t.id}:{t.blocked_action}",
    )


async def notify_owner(db: AsyncSession, t: Task, title: str, body: str, *, dedupe: str) -> None:
    """Phone push / Telegram / WhatsApp to whoever owns the next move; when no one person
    owns it (an agent made the task), everyone who may manage work hears about it."""
    from ..channels import deliver  # late: channels import agent modules

    try:
        uid = await owner_user(db, t)
        url = f"/tasks?task={t.id}"
        if uid:
            ids = await deliver.notify_user(
                db, t.workspace_id, uid, title, body, url, dedupe=dedupe
            )
        else:
            ids = await deliver.notify_people(
                db, t.workspace_id, title, body, url, dedupe=dedupe, perm="work.write"
            )
        await deliver.start(ids)
    except Exception:  # noqa: BLE001 - a notice must never break the bookkeeping
        log.warning("could not notify the owner of %s", t.id, exc_info=True)
