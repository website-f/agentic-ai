"""P109: tasks for people, Trello-like. Who a task is for (one or many assignees) and who
follows it (watchers), its checklist and sub-tasks, the files linked to it, and who sees it.

Assignees and watchers live in task_people (task_models.py); tasks.assignee_user_id stays the
first assignee, so the P97 paths (scope, needs, a person's moves) keep working unchanged.
Change them only through `set_people`, which keeps the two in step.

Who sees a person's task (api/scope.py + `sees_by_chain`):
- whoever gave it, its assignees and its watchers;
- the people its assignees report to (P97 `team`), and further up their reporting line (an
  HOD's HOD), but beyond the direct manager only inside the companies the viewer works in;
- a branch manager the tasks of their branches (unchanged); workspace roles everything.
Nobody sees another company's task through a reporting line.

Who may be added (`may_watch`): an assignee is anyone the actor may give a task to
(people.may_assign). A watcher is one of those, or someone the actor reports to (up their
line), or, for whoever manages all members, anyone in the workspace.
"""

from collections.abc import Iterable
from typing import Any

from sqlalchemy import ColumnElement, and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import can
from ..models import Membership, Task, User
from .branches import member_in_branches
from .people import Actor, PeopleError, may_assign
from .task_models import ASSIGNEE, WATCHER, TaskAttachment, TaskChecklistItem, TaskPerson

MAX_ASSIGNEES = 25
MAX_WATCHERS = 25
CHAIN_DEPTH = 8  # how far down a reporting line a manager follows people's tasks
CHAIN_CAP = 2000

# What kind of work a person's task is (the composer's choices; free text is kept as typed).
CATEGORIES = (
    "general",
    "follow_up",
    "meeting",
    "document",
    "request",
    "review",
    "admin",
    "finance",
    "it",
    "site",
)


def clean_category(raw: str | None) -> str | None:
    text = " ".join((raw or "").split())[:40].lower().replace(" ", "_")
    return text or None


# ---------------------------------------------------------------- assignees and watchers


async def people_of(db: AsyncSession, task_ids: Iterable[str]) -> dict[str, list[TaskPerson]]:
    """Each task's people (assignees first, in the order they were added), one query."""
    ids = sorted(set(task_ids))
    out: dict[str, list[TaskPerson]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = await db.scalars(
        select(TaskPerson)
        .where(TaskPerson.task_id.in_(ids))
        .order_by(TaskPerson.role, TaskPerson.created_at, TaskPerson.user_id)
    )
    for r in rows.all():
        out.setdefault(r.task_id, []).append(r)
    return out


async def assignee_ids(db: AsyncSession, t: Task) -> list[str]:
    """The task's assignees: the first one (tasks.assignee_user_id) first."""
    rows = (await people_of(db, [t.id])).get(t.id, [])
    ids = [r.user_id for r in rows if r.role == ASSIGNEE]
    if t.assignee_user_id:
        ids = [t.assignee_user_id, *[i for i in ids if i != t.assignee_user_id]]
    return ids


async def set_people(
    db: AsyncSession,
    t: Task,
    assignees: list[str] | None,
    watchers: list[str] | None,
    by: str,
) -> tuple[list[str], list[str]]:
    """Make the task's assignees and/or watchers exactly these (None leaves that list as it
    is). The first assignee becomes tasks.assignee_user_id. Someone who is an assignee is
    never also a watcher. Returns (new assignees, new watchers): who to tell."""
    have = {r.user_id: r for r in (await people_of(db, [t.id])).get(t.id, [])}
    cur_a = [u for u, r in have.items() if r.role == ASSIGNEE]
    cur_w = [u for u, r in have.items() if r.role == WATCHER]
    want_a = list(dict.fromkeys(assignees)) if assignees is not None else cur_a
    want_w = [u for u in dict.fromkeys(watchers if watchers is not None else cur_w)]
    want_w = [u for u in want_w if u not in want_a]
    roles = {**{u: WATCHER for u in want_w}, **{u: ASSIGNEE for u in want_a}}
    gone = [u for u in have if u not in roles]
    if gone:
        await db.execute(
            delete(TaskPerson).where(TaskPerson.task_id == t.id, TaskPerson.user_id.in_(gone))
        )
    new_a: list[str] = []
    new_w: list[str] = []
    for u, role in roles.items():
        row = have.get(u)
        if row is None:
            db.add(TaskPerson(task_id=t.id, user_id=u, role=role, added_by=by))
        elif row.role != role:
            row.role = role
        else:
            continue
        (new_a if role == ASSIGNEE else new_w).append(u)
    if assignees is not None:
        first = want_a[0] if want_a else None
        if t.assignee_user_id not in want_a:
            t.assignee_user_id = first
    await db.flush()
    return new_a, new_w


async def check_people(
    db: AsyncSession, a: Actor, assignees: list[str], watchers: list[str]
) -> tuple[list[Membership], list[str]]:
    """The members behind these ids, or PeopleError: assignees as people.may_assign rules,
    watchers as `may_watch`. Returns (assignee memberships in order, watcher ids)."""
    if len(set(assignees)) > MAX_ASSIGNEES or len(set(watchers)) > MAX_WATCHERS:
        raise PeopleError(422, "too_many_people", "Pick at most 25 people for each.")
    ms = [await may_assign(db, a, u) for u in dict.fromkeys(assignees)]
    ok_w = [u for u in dict.fromkeys(watchers) if u not in set(assignees)]
    for u in ok_w:
        await may_watch(db, a, u)
    return ms, ok_w


async def managers_up(db: AsyncSession, workspace_id: str, user_id: str) -> list[str]:
    """Who this person reports to, and who that one reports to, up the line (no loops)."""
    out: list[str] = []
    cur = user_id
    for _ in range(CHAIN_DEPTH):
        nxt = await db.scalar(
            select(Membership.reports_to_user_id).where(
                Membership.workspace_id == workspace_id, Membership.user_id == cur
            )
        )
        if not nxt or nxt == user_id or nxt in out:
            break
        out.append(nxt)
        cur = nxt
    return out


async def may_watch(db: AsyncSession, a: Actor, user_id: str) -> Membership:
    """A member this actor may add as a watcher, or PeopleError."""
    m = await db.get(Membership, (a.workspace_id, user_id))
    if m is None or not m.user.is_active:
        raise PeopleError(400, "bad_person", "Pick someone who is a member here.")
    if can(a.role, "members.manage") or user_id in await managers_up(db, a.workspace_id, a.user_id):
        return m
    try:
        return await may_assign(db, a, user_id)
    except PeopleError:
        raise PeopleError(
            403,
            "cannot_watch",
            "You can add as watchers the people you may give tasks to and the people you report"
            " to.",
        ) from None


async def chain_below(
    db: AsyncSession, workspace_id: str, user_id: str, branch_ids: Iterable[str]
) -> set[str]:
    """Everyone under this manager down their reporting lines: direct reports always, the
    rest only when they work in one of `branch_ids` (never another company's people)."""
    direct = set(
        (
            await db.scalars(
                select(Membership.user_id).where(
                    Membership.workspace_id == workspace_id,
                    Membership.reports_to_user_id == user_id,
                )
            )
        ).all()
    )
    seen, frontier = set(direct) | {user_id}, set(direct)
    deeper: set[str] = set()
    branches = sorted(set(branch_ids))
    for _ in range(CHAIN_DEPTH - 1):
        if not frontier or not branches or len(seen) > CHAIN_CAP:
            break
        rows = set(
            (
                await db.scalars(
                    select(Membership.user_id).where(
                        Membership.workspace_id == workspace_id,
                        Membership.reports_to_user_id.in_(sorted(frontier)),
                        member_in_branches(branches),
                    )
                )
            ).all()
        )
        frontier = rows - seen
        seen |= frontier
        deeper |= frontier
    return direct | deeper


def people_task_ids(user_ids: Iterable[str], role: str | None = None) -> Any:
    """SQL: the ids of tasks these people are on (as `role`, or either)."""
    q = select(TaskPerson.task_id).where(TaskPerson.user_id.in_(sorted(set(user_ids))))
    return q.where(TaskPerson.role == role) if role else q


def assigned_to(user_ids: Iterable[str]) -> ColumnElement[bool]:
    """SQL on Task: given to any of these people (the first assignee or another)."""
    ids = sorted(set(user_ids))
    return or_(Task.assignee_user_id.in_(ids), Task.id.in_(people_task_ids(ids, ASSIGNEE)))


async def chain_where(db: AsyncSession, principal: Any) -> ColumnElement[bool] | None:
    """SQL on Task: people's tasks a scoped manager follows further down their line (beyond
    their direct reports, whom the scope covers already). None: nothing more."""
    if principal.scope.everything or not principal.team:
        return None
    below = await chain_below(
        db, principal.workspace_id, principal.user.id, principal.scope.branch_ids
    )
    extra = below - set(principal.team)
    return assigned_to(extra) if extra else None


async def sees_by_chain(db: AsyncSession, principal: Any, t: Task) -> bool:
    """Whether this person sees a person's task through their reporting line or by being on
    it (assignee or watcher), where the plain scope check said no."""
    rows = (await people_of(db, [t.id])).get(t.id, [])
    first = {t.assignee_user_id} if t.assignee_user_id else set()
    if principal.user.id in {r.user_id for r in rows} | first:
        return True
    assignees = set(by_role(rows, ASSIGNEE)) | first
    if not assignees:
        return False
    if assignees & set(principal.team):
        return True
    if principal.scope.everything or not principal.team:
        return False
    below = await chain_below(
        db, principal.workspace_id, principal.user.id, principal.scope.branch_ids
    )
    return bool(assignees & below)


# ---------------------------------------------------------------- counts for board cards


async def card_counts(db: AsyncSession, task_ids: list[str]) -> dict[str, dict[str, int]]:
    """Per task: checklist done/total, sub-tasks done/total and linked or uploaded files."""
    from ..models import DocFile

    ids = sorted(set(task_ids))
    out: dict[str, dict[str, int]] = {
        i: {"check_done": 0, "check_total": 0, "sub_done": 0, "sub_total": 0, "files": 0}
        for i in ids
    }
    if not ids:
        return out
    for tid, total, done in (
        await db.execute(
            select(
                TaskChecklistItem.task_id,
                func.count(),
                func.count().filter(TaskChecklistItem.done.is_(True)),
            )
            .where(TaskChecklistItem.task_id.in_(ids))
            .group_by(TaskChecklistItem.task_id)
        )
    ).all():
        out[tid]["check_total"], out[tid]["check_done"] = int(total), int(done)
    for tid, total, done in (
        await db.execute(
            select(
                Task.parent_task_id,
                func.count(),
                func.count().filter(Task.status == "done"),
            )
            .where(Task.parent_task_id.in_(ids), Task.status != "cancelled")
            .group_by(Task.parent_task_id)
        )
    ).all():
        out[tid]["sub_total"], out[tid]["sub_done"] = int(total), int(done)
    linked = select(TaskAttachment.task_id.label("tid"), TaskAttachment.file_id.label("fid")).where(
        TaskAttachment.task_id.in_(ids)
    )
    owned = select(DocFile.task_id.label("tid"), DocFile.id.label("fid")).where(
        DocFile.task_id.in_(ids), DocFile.source == "upload"
    )
    both = linked.union(owned).subquery()
    for tid, n in (await db.execute(select(both.c.tid, func.count()).group_by(both.c.tid))).all():
        out[tid]["files"] = int(n)
    return out


async def names_of(db: AsyncSession, ids: Iterable[str]) -> dict[str, str]:
    want = {i for i in ids if i}
    if not want:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(want)))).all())


def by_role(rows: list[TaskPerson], role: str) -> list[str]:
    return [r.user_id for r in rows if r.role == role]


def where_any(*parts: ColumnElement[bool] | None) -> ColumnElement[bool] | None:
    got = [p for p in parts if p is not None]
    return or_(*got) if got else None


def overlapping(start: Any, end: Any) -> ColumnElement[bool]:
    """SQL on Task: its span (start or due -> due or start) touches [start, end]."""
    first = func.coalesce(Task.start_at, Task.due_at)
    last = func.coalesce(Task.due_at, Task.start_at)
    return and_(first.is_not(None), first <= end, last >= start)
