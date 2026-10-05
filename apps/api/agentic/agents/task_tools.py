"""P21 create_task: an agent lines work up ("start B when A is done").

- create_task(title, brief, assignee?, after=[task ids], priority?, start?): a new board task.
  With `after`, it waits (status blocked, "Waiting for ...") and starts by itself when every
  task in `after` is done; a cancelled or failed one sends it to its owner to decide.
- Scope: an orchestrator may give work to any active office agent it can see (its own branch
  only when the branch is isolated); any other agent only to itself. Never to someone's
  private assistant or a helper copy. `after` must name tasks in the same office (and branch,
  when isolated). At most MAX_PER_HOUR new tasks per agent per hour.
- Risk medium, allowed by default: work inside the office with no outside effect, like
  delegate. The agent's own tool settings still win (set it to ask or deny per agent).
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from ..models import Agent, Branch, Task
from .tools import Tool, ToolContext

MAX_PER_HOUR = 20
MAX_AFTER = 10


async def _assignee(ctx: ToolContext, ref: str) -> Agent | str:
    a = ctx.agent
    if not ref.strip() or ref.strip().lower() in ("me", "myself", "self", a.name.lower(), a.id):
        return a
    if a.role_kind != "orchestrator":
        return (
            "Error: only orchestrators give work to other agents. Leave `assignee` out to line "
            "it up for yourself, or ask_colleague."
        )
    ref = ref.strip()
    rows = (
        await ctx.db.scalars(
            select(Agent).where(
                Agent.workspace_id == a.workspace_id,
                Agent.status == "active",
                (Agent.id == ref)
                | (Agent.slug == ref.lower())
                | (func.lower(Agent.name) == ref.lower()),
            )
        )
    ).all()
    who = rows[0] if rows else None
    if who is None or who.clone_of or (who.private and who.owner_user_id != a.owner_user_id):
        return (
            f"Error: no active agent called {ref!r} you can give work to. "
            "Use team_directory for names."
        )
    branch = await ctx.db.get(Branch, a.branch_id)
    if branch is not None and branch.isolated and who.branch_id != a.branch_id:
        return f"Error: {who.name} is outside your company, which keeps its work separate."
    return who


async def _create_task(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..services import events
    from ..teams import blockers
    from . import launch, runtime

    a, db = ctx.agent, ctx.db
    title = " ".join(str(args.get("title") or "").split())[:200]
    brief = str(args.get("brief") or "").strip()[:8000]
    if not title:
        return (
            "Error: give the task a short title (and a brief: what to do and what done looks like)."
        )
    after = args.get("after") or []
    if isinstance(after, str):
        after = [after]
    if not isinstance(after, list) or len(after) > MAX_AFTER:
        return f"Error: `after` is a list of up to {MAX_AFTER} task ids."
    priority = str(args.get("priority") or "normal")
    if priority not in ("low", "normal", "high", "urgent"):
        priority = "normal"
    who = await _assignee(ctx, str(args.get("assignee") or ""))
    if isinstance(who, str):
        return who
    since = datetime.now(UTC) - timedelta(hours=1)
    made = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.created_by == f"agent:{a.id}", Task.source == "agent", Task.created_at >= since
            )
        )
        or 0
    )
    if made >= MAX_PER_HOUR:
        return (
            f"Error: you created {made} tasks in the last hour (the most is {MAX_PER_HOUR}). "
            "Finish or merge work first."
        )
    branch = await db.get(Branch, a.branch_id)
    isolated = a.branch_id if branch is not None and branch.isolated else None
    after = [str(x).strip() for x in dict.fromkeys(after) if str(x).strip()]
    for bid in after:  # checked before anything is written (a new task cannot form a cycle)
        b = await db.get(Task, bid)
        if b is None or b.workspace_id != a.workspace_id or (isolated and b.branch_id != isolated):
            return f"Error: there is no task {bid} to wait for. Use the task ids you were given."
    lowest = (
        await db.scalar(select(func.min(Task.position)).where(Task.workspace_id == a.workspace_id))
        or 0
    )
    t = Task(
        workspace_id=a.workspace_id,
        branch_id=who.branch_id,
        title=title,
        brief=brief,
        priority=priority,
        assignee_agent_id=who.id,
        # Asked in chat: the person owns it (and decides if what it waits for fails).
        created_by=f"user:{ctx.person}" if ctx.person else f"agent:{a.id}",
        source="agent",
        requires_review=True,
        status="ready",
        position=float(lowest) - 1,
        labels=list((ctx.task.labels if ctx.task else None) or [])[:8],
        objective_id=ctx.task.objective_id if ctx.task else None,
    )
    db.add(t)
    await db.flush()
    await blockers.add(db, t, after, branch_only=isolated)
    await db.commit()
    await runtime.task_event(
        db,
        t,
        "created",
        f"agent:{a.id}",
        f"lined up by {a.name}" + (f" from {ctx.task.title[:120]}" if ctx.task else ""),
    )
    await events.publish(
        a.workspace_id, "task.created", {"task_id": t.id, "agent_id": t.assignee_agent_id}
    )
    start = args.get("start", True) is not False
    if after:
        state = await blockers.refresh(db, t, f"agent:{a.id}", start=start)
    elif start:
        try:
            await launch.launch(db, t, f"agent:{a.id}")
            state = "started"
        except launch.LaunchError as e:
            state = f"not started ({e.message})"
    else:
        state = "queued"
    for_whom = "you" if who.id == a.id else who.name
    if state == "waiting":
        what = (t.blocked_reason or "").removeprefix(blockers.WAITING) or "those tasks"
        return (
            f'Created task {t.id} for {for_whom}: "{title}". It waits and starts by itself '
            f"when {what} are done."
        )
    if state == "routed":
        return (
            f"Created task {t.id}, but a task it waits for was cancelled or failed, so it is "
            "with its owner to decide."
        )
    return f'Created task {t.id} for {for_whom}: "{title}" ({state}).'


TASK_TOOLS: list[Tool] = [
    Tool(
        "create_task",
        "Line up a task",
        "Create a task on the board, for yourself or (orchestrators) a colleague. Use `after` to "
        "line work up: the task waits and starts by itself when every task in `after` is done "
        "(e.g. 'start the report after the data clean-up'). Unlike delegate, you do not wait for "
        "it: it is new, separate work with its own result.",
        {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "brief": {"type": "string", "description": "What to do and what done looks like"},
                "assignee": {
                    "type": "string",
                    "description": "Agent name; leave out for yourself "
                    "(only orchestrators assign others)",
                },
                "after": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Task ids that must be done before this starts",
                },
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                "start": {
                    "type": "boolean",
                    "description": "Start as soon as it can (default true); false leaves it queued",
                },
            },
            "required": ["title", "brief"],
        },
        "medium",
        "allow",
        _create_task,
    ),
]
