"""P109: tasks for people, Trello-like: who a task is for and who follows it, its checklist,
its sub-tasks and its files.

- PUT    /api/tasks/{id}/people                 assignees and/or watchers, exactly these (new
                                                assignees hear of it: bell, phone, email)
- POST   /api/tasks/{id}/checklist              add an item
- PATCH  /api/tasks/{id}/checklist/{item_id}    tick, untick, rename or move an item
- DELETE /api/tasks/{id}/checklist/{item_id}    remove an item
- POST   /api/tasks/{id}/subtasks               a sub-task: its own person's task under it
- GET    /api/tasks/{id}/attachments            its files (uploaded to it, or linked to it)
- DELETE /api/tasks/{id}/attachments/{file_id}  take a file off the task (the file stays)
- GET    /api/team/watchable                    who I may add as a watcher

Every route reaches only a task the person sees (tasks._task: scope, or being on it, or down
their reporting line); writes need work.write. Who may be given or follow work:
teams/task_parts.py and teams/people.py.
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import runtime
from ...core.db import get_db
from ...core.security import can
from ...models import Branch, Department, DocFile, Membership, Task, User
from ...services import audit, events
from ...teams import people, task_parts
from ...teams.task_models import TaskAttachment, TaskChecklistItem
from ..agent_schemas import SubtaskIn, TaskOut
from ..deps import Principal, api_error, require
from .files import FileOut, file_out
from .tasks import (
    _add_checklist,
    _task,
    new_subtask,
    people_error,
    people_event,
    task_out,
    tell_assigned,
)

router = APIRouter(prefix="/api", tags=["people tasks"])


def _person_task(t: Task) -> None:
    if not people.is_person_task(t):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_a_person_task",
            "This is for tasks given to people.",
        )


async def _changed(db: AsyncSession, principal: Principal, t: Task) -> None:
    """Every board and sheet showing the task refreshes (live), and its time moves on."""
    t.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(t)
    await events.publish(
        principal.workspace_id, "task.updated", await people_event(db, t, principal.actor)
    )


# ---------------------------------------------------------------- people


class PeopleIn(BaseModel):
    assignee_user_ids: list[str] | None = Field(default=None, max_length=25)
    watcher_user_ids: list[str] | None = Field(default=None, max_length=25)


@router.put("/tasks/{task_id}/people")
async def set_task_people(
    task_id: str,
    body: PeopleIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """Who the task is for (at least one) and who follows it. The people already on it stay
    whoever added them; a new assignee must be someone the actor may give work to, a new
    watcher someone they may add (teams/task_parts.may_watch)."""
    t = await _task(db, principal, task_id)
    _person_task(t)
    if body.assignee_user_ids is not None and not body.assignee_user_ids:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "no_assignee", "Pick at least one person."
        )
    rows = (await task_parts.people_of(db, [t.id])).get(t.id, [])
    have = {r.user_id for r in rows}
    actor = people.actor_of(principal)
    try:
        new_a = [u for u in body.assignee_user_ids or [] if u not in have]
        new_w = [u for u in body.watcher_user_ids or [] if u not in have]
        await task_parts.check_people(db, actor, new_a, new_w)
        # Taking someone else off: whoever gave the task, or someone who may give them work.
        keep = set(body.assignee_user_ids or []) | set(body.watcher_user_ids or [])
        for r in rows:
            listed = (
                body.assignee_user_ids if r.role == task_parts.ASSIGNEE else body.watcher_user_ids
            )
            if listed is None or r.user_id in keep or r.user_id == principal.user.id:
                continue
            if t.created_by != principal.actor:
                await people.may_assign(db, actor, r.user_id)
    except people.PeopleError as e:
        raise people_error(e) from e
    told, _ = await task_parts.set_people(
        db, t, body.assignee_user_ids, body.watcher_user_ids, principal.actor
    )
    if t.assignee_user_id:
        m = await db.get(Membership, (t.workspace_id, t.assignee_user_id))
        t.branch_id = t.branch_id or (m.branch_id if m else None)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.people",
        target=t.id,
        after={
            "assignees": body.assignee_user_ids,
            "watchers": body.watcher_user_ids,
        },
    )
    await _changed(db, principal, t)
    if told:
        names = await people.names(db, set(told))
        await runtime.task_event(
            db,
            t,
            "people",
            principal.actor,
            "gave it to " + ", ".join(names.get(u, "") for u in told),
            {"added": told},
        )
        await tell_assigned(db, principal, t, told)
    return await task_out(db, t)


@router.get("/team/watchable")
async def watchable(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Who I may add as a watcher: the people I may give a task to, the people I report to
    (up my line), and for whoever manages all members, everyone. No email addresses."""
    from .tasks import team_ids

    actor = people.actor_of(principal)
    reports = set(await team_ids(db, principal)) - {principal.user.id}
    ups = await task_parts.managers_up(db, principal.workspace_id, principal.user.id)
    where = people.assignable_where(actor, sorted(reports))
    if not can(principal.role, "members.manage") and ups:
        from sqlalchemy import or_

        where = or_(where, Membership.user_id.in_(ups))
    rows = (
        await db.execute(
            select(Membership, Branch.name, Department.name)
            .join(User, User.id == Membership.user_id)
            .outerjoin(Branch, Branch.id == Membership.branch_id)
            .outerjoin(Department, Department.id == Membership.department_id)
            .where(
                Membership.workspace_id == principal.workspace_id,
                User.is_active.is_(True),
                where,
            )
            .order_by(func.lower(User.name))
            .limit(1000)
        )
    ).all()
    return [
        {
            "user_id": m.user_id,
            "name": m.user.name,
            "branch_name": b,
            "department_name": d,
            "me": m.user_id == principal.user.id,
            "manages_me": m.user_id in ups,
        }
        for m, b, d in rows
    ]


# ---------------------------------------------------------------- checklist


class ChecklistIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class ChecklistPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None
    position: float | None = None


async def _item(db: AsyncSession, t: Task, item_id: str) -> TaskChecklistItem:
    it = await db.get(TaskChecklistItem, item_id)
    if it is None or it.task_id != t.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "item_not_found", "That item is not here.")
    return it


@router.post("/tasks/{task_id}/checklist", status_code=status.HTTP_201_CREATED)
async def add_item(
    task_id: str,
    body: ChecklistIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Add an item at the end. Returns the whole checklist."""
    from .tasks import checklist_out

    t = await _task(db, principal, task_id)
    n = await db.scalar(
        select(func.count()).select_from(TaskChecklistItem).where(TaskChecklistItem.task_id == t.id)
    )
    if (n or 0) >= 100:
        raise api_error(
            status.HTTP_409_CONFLICT, "too_many_items", "A checklist holds up to 100 items."
        )
    await _add_checklist(db, t, [body.text], principal.actor)
    await _changed(db, principal, t)
    return await checklist_out(db, t)


@router.patch("/tasks/{task_id}/checklist/{item_id}")
async def change_item(
    task_id: str,
    item_id: str,
    body: ChecklistPatch,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Tick, untick, rename or move an item. Returns the whole checklist."""
    from .tasks import checklist_out

    t = await _task(db, principal, task_id)
    it = await _item(db, t, item_id)
    note = None
    if body.text is not None:
        it.text = " ".join(body.text.split())[:300] or it.text
    if body.position is not None:
        it.position = body.position
    if body.done is not None and body.done != it.done:
        it.done = body.done
        it.done_by = principal.actor if body.done else None
        it.done_at = datetime.now(UTC) if body.done else None
        note = ("ticked " if body.done else "unticked ") + f"“{it.text[:120]}”"
    await _changed(db, principal, t)
    if note:
        await runtime.task_event(db, t, "checklist", principal.actor, note, {"item": it.id})
    return await checklist_out(db, t)


@router.delete("/tasks/{task_id}/checklist/{item_id}")
async def remove_item(
    task_id: str,
    item_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    from .tasks import checklist_out

    t = await _task(db, principal, task_id)
    it = await _item(db, t, item_id)
    await db.delete(it)
    await _changed(db, principal, t)
    return await checklist_out(db, t)


# ---------------------------------------------------------------- sub-tasks


@router.post("/tasks/{task_id}/subtasks", status_code=status.HTTP_201_CREATED)
async def add_subtask(
    task_id: str,
    body: SubtaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    """A sub-task of a person's task: its own person's task (its own person, status and due
    date) under it. Its person hears of it as of any task given to them."""
    t = await _task(db, principal, task_id)
    _person_task(t)
    if (t.depth or 0) >= 5:
        raise api_error(
            status.HTTP_409_CONFLICT, "too_deep", "Sub-tasks go at most five levels deep."
        )
    kid = await new_subtask(db, principal, t, body)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=kid.id,
        after={"title": kid.title, "assignee": kid.assignee_user_id, "parent": t.id},
    )
    await db.commit()
    await runtime.task_event(db, kid, "created", principal.actor, "created the task")
    await runtime.task_event(
        db, t, "subtask", principal.actor, f"added a sub-task: {kid.title[:120]}", {"task": kid.id}
    )
    await events.publish(
        principal.workspace_id, "task.created", await people_event(db, kid, principal.actor)
    )
    await _changed(db, principal, t)
    await tell_assigned(db, principal, kid, [kid.assignee_user_id or ""])
    await db.refresh(kid)
    return await task_out(db, kid)


# ---------------------------------------------------------------- files


@router.get("/tasks/{task_id}/attachments")
async def attachments(
    task_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[FileOut]:
    """The task's files: uploaded to it, or linked to it (a Library guideline, another
    task's file), newest first. Someone on the task opens each with the file's own rules."""
    t = await _task(db, principal, task_id)
    linked = select(TaskAttachment.file_id).where(TaskAttachment.task_id == t.id)
    files = (
        await db.scalars(
            select(DocFile)
            .where(
                DocFile.workspace_id == principal.workspace_id,
                (DocFile.id.in_(linked))
                | ((DocFile.task_id == t.id) & (DocFile.source == "upload")),
            )
            .order_by(DocFile.created_at.desc())
            .limit(200)
        )
    ).all()
    return [await file_out(db, f) for f in files]


@router.delete("/tasks/{task_id}/attachments/{file_id}")
async def remove_attachment(
    task_id: str,
    file_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Take a file off the task. The file itself stays (in Files or the Library)."""
    t = await _task(db, principal, task_id)
    _person_task(t)
    gone = await db.execute(
        delete(TaskAttachment).where(
            TaskAttachment.task_id == t.id, TaskAttachment.file_id == file_id
        )
    )
    f = await db.get(DocFile, file_id)
    owned = f is not None and f.task_id == t.id and f.workspace_id == t.workspace_id
    if owned and f is not None:
        f.task_id = None
    if not owned and not gone.rowcount:
        raise api_error(status.HTTP_404_NOT_FOUND, "file_not_found", "That file is not here.")
    await _changed(db, principal, t)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
