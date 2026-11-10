"""P97: people's work: the tasks given to me, the people I may give work to, comments on a
person's task and handing a step of it to my own AI.

- GET  /api/me/assigned-tasks          the open tasks given to me (newest first within each
                                       state, due soonest first) and their counts, for the
                                       workspace and the bell.
- GET  /api/team/people                the people I may give a task to (myself, my direct
                                       reports; a branch manager their branch; members.manage
                                       everyone), with their open task counts.
- POST /api/tasks/{id}/comments        a comment on a person's task (the other side hears it).
- POST /api/tasks/{id}/hand-to-ai      the person it is for hands a step of it to their own AI
                                       (a sub-task of it that their AI runs as any agent task).

The rules are teams/people.py; who sees which task is api/scope.py.
"""

import contextlib
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...i18n import Msg
from ...models import Agent, Branch, Department, Membership, Task, User
from ...services import audit
from ...teams import people
from ..deps import Principal, api_error, ensure_work_scope, require
from .tasks import _task, people_error, start, task_out, tasks_out, team_ids

router = APIRouter(prefix="/api", tags=["team work"])

ASSIGNED_LIMIT = 50


@router.get("/me/assigned-tasks")
async def my_assigned_tasks(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """The open tasks given to me (new ones first, then due soonest) and counts: open, new
    (not yet taken), overdue, due today. Done ones of the last week come in `done`."""
    ws, me = principal.workspace_id, principal.user.id
    mine = (Task.workspace_id == ws, Task.assignee_user_id == me)
    now = datetime.now(UTC)
    new_first = case((Task.status == "triage", 0), else_=1)
    rows = list(
        (
            await db.scalars(
                select(Task)
                .where(*mine, Task.status.in_(people.OPEN))
                .order_by(
                    new_first, Task.due_at.asc().nulls_last(), Task.created_at.desc(), Task.id
                )
                .limit(ASSIGNED_LIMIT)
            )
        ).all()
    )
    done = list(
        (
            await db.scalars(
                select(Task)
                .where(*mine, Task.status == "done", Task.finished_at >= now - timedelta(days=7))
                .order_by(Task.finished_at.desc())
                .limit(10)
            )
        ).all()
    )
    end_of_day = now.replace(hour=23, minute=59, second=59)
    counts = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(Task.status == "triage"),
                func.count().filter(Task.due_at < now),
                func.count().filter(Task.due_at >= now, Task.due_at <= end_of_day),
            ).where(*mine, Task.status.in_(people.OPEN))
        )
    ).one()
    return {
        "items": [o.model_dump(mode="json") for o in await tasks_out(db, rows, trim=True)],
        "done": [o.model_dump(mode="json") for o in await tasks_out(db, done, trim=True)],
        "counts": {
            "open": counts[0],
            "new": counts[1],
            "overdue": counts[2],
            "due_today": counts[3],
        },
    }


@router.get("/team/people")
async def team_people(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Who I may give a task to (teams/people.py), me first, then my direct reports, then
    the rest by name; each with their open task count and place."""
    team = await team_ids(db, principal)
    reports = set(team) - {principal.user.id}
    where = people.assignable_where(people.actor_of(principal), sorted(reports))
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
    ids = [m.user_id for m, _, _ in rows]
    open_n = dict(
        (
            await db.execute(
                select(Task.assignee_user_id, func.count())
                .where(
                    Task.workspace_id == principal.workspace_id,
                    Task.assignee_user_id.in_(ids),
                    Task.status.in_(people.OPEN),
                )
                .group_by(Task.assignee_user_id)
            )
        ).all()
    )
    out = [
        {
            "user_id": m.user_id,
            "name": m.user.name,
            "email": m.user.email,
            "role": m.role,
            "branch_name": b,
            "department_name": d,
            "heads_department": m.heads_department,
            "me": m.user_id == principal.user.id,
            "reports_to_me": m.user_id in reports,
            "open_tasks": open_n.get(m.user_id, 0),
        }
        for m, b, d in rows
    ]
    out.sort(key=lambda p: (not p["me"], not p["reports_to_me"]))
    return out


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/tasks/{task_id}/comments", status_code=status.HTTP_201_CREATED)
async def comment(
    task_id: str,
    body: CommentIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A comment on a person's task: in its timeline; the person hears a manager's comment
    and the giver hears the person's. An agent does not read comments (send it back with
    feedback instead), so agents' tasks take none."""
    from ...agents import runtime

    t = await _task(db, principal, task_id)
    if not people.is_person_task(t):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "not_a_person_task",
            "Comments are for people's tasks. To tell an agent something, send the work back "
            "with your feedback.",
        )
    text = body.text.strip()
    if not text:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "empty", "Type a comment.")
    await runtime.task_event(db, t, "comment", principal.actor, text)
    to = t.assignee_user_id if principal.user.id != t.assignee_user_id else people.giver_id(t)
    if to and to != principal.user.id:
        await people.notify(
            db,
            t,
            to,
            Msg("New comment: {title}", title=t.title[:100]),
            Msg("{name}: {text}", name=principal.user.name, text=text[:200]),
            f"comment:{t.id}:{datetime.now(UTC).isoformat()}",
        )
    return {"ok": True}


class HandIn(BaseModel):
    agent_id: str = Field(min_length=1, max_length=40)
    title: str | None = Field(default=None, max_length=200)
    brief: str = Field(default="", max_length=20_000)


@router.post("/tasks/{task_id}/hand-to-ai", status_code=status.HTTP_201_CREATED)
async def hand_to_ai(
    task_id: str,
    body: HandIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
):
    """The person a task is for gives a step of it to their own AI: a sub-task of it,
    assigned to an agent they own, that runs like any agent task (the engine is unchanged).
    The person's task itself never runs."""
    t = await _task(db, principal, task_id)
    if t.assignee_user_id != principal.user.id:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "not_your_task",
            "Only the person this task is for can hand a step of it to their AI.",
        )
    agent = await db.get(Agent, body.agent_id)
    if (
        agent is None
        or agent.workspace_id != principal.workspace_id
        or agent.owner_user_id != principal.user.id
        or agent.status != "active"
        or not principal.scope.sees_agent(agent)
    ):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick one of your own AI.")
    title = (body.title or "").strip() or t.title
    brief = body.brief.strip() or t.brief or ""
    await ensure_work_scope(db, principal, f"{title}\n{brief}")
    child = Task(
        workspace_id=principal.workspace_id,
        title=title[:200],
        brief=brief,
        priority=t.priority,
        assignee_agent_id=agent.id,
        branch_id=agent.branch_id,
        requires_review=True,
        labels=list(t.labels or []),
        created_by=principal.actor,
        source="handoff",
        status="ready",
        parent_task_id=t.id,
        depth=(t.depth or 0) + 1,
        root_task_id=t.root_task_id or t.id,
        objective_id=t.objective_id,
        due_at=t.due_at,
        position=float(t.position or 0),
    )
    db.add(child)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.handed_to_ai",
        target=child.id,
        after={"parent": t.id, "agent": agent.id},
    )
    await db.commit()
    from ...agents import runtime
    from ...services import events

    await runtime.task_event(db, child, "created", principal.actor, "created the task")
    await runtime.task_event(
        db, t, "delegated", principal.actor, f"handed a step to {agent.name}", {"child": child.id}
    )
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": child.id, "agent_id": agent.id}
    )
    with contextlib.suppress(HTTPException):  # it stays ready: the person can start it
        await start(db, child, principal.actor)
    await db.refresh(child)
    return await task_out(db, child)


__all__ = ["router", "people_error"]
