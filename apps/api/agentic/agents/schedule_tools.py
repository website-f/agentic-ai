"""Schedules from chat (the Hermes cronjob tool): "every Monday 9am send me the slacking
report", "remind me Friday 4pm to submit the claim".

- schedule_task: a recurring or one-off job for this agent itself, never for another agent.
  `when` is plain words, read by a small deterministic parser in the workspace's time zone
  (teams/when.py), or a cron line; unclear words come back as a question for the person.
  Policy (policy.PERSON_APPROVES): asked for directly in chat by someone who could approve
  the agent's requests, the request is the approval; anywhere else a person approves it.
- list_my_schedules, cancel_schedule: what this agent runs on a timer; it may cancel only
  the ones it set up (people's own schedules are changed on the Schedules page).

Each run is an ordinary scheduled task for the same agent; its result goes to the person who
asked for it (teams/schedules.py). Caps: MAX_ACTIVE per agent, and at most every 15 minutes.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from ..models import Schedule, User
from ..services import audit
from ..teams import schedules, when
from .tools import Tool, ToolContext

MAX_ACTIVE = 20


def _requester(ctx: ToolContext) -> str | None:
    """Who the schedule reports to: the person chatting, the person who gave the task, else
    the agent's owner."""
    if ctx.person:
        return ctx.person
    if ctx.task is not None and (ctx.task.created_by or "").startswith("user:"):
        return ctx.task.created_by.removeprefix("user:")
    return ctx.agent.owner_user_id


def _local(dt: datetime, tz: str) -> str:
    from zoneinfo import ZoneInfo

    d = dt.astimezone(ZoneInfo(tz))
    return f"{d:%a} {d.day} {d:%b %H:%M}"


async def _schedule_task(ctx: ToolContext, args: dict[str, Any]) -> str:
    from . import dispatch  # late: dispatch imports the workflows

    title = " ".join(str(args.get("title") or "").split())[:180]
    brief = str(args.get("brief") or "").strip()[:6000]
    words = str(args.get("when") or "").strip()[:200]
    if not title or not brief:
        return "Error: give a short title and the brief (exactly what to do each time)."
    a, ws = ctx.agent, ctx.workspace
    tz = ws.timezone
    try:
        w = when.parse(words, tz)
    except when.Unclear as e:
        return f"Not scheduled: the time is unclear. Ask the person: {e}"
    except schedules.ScheduleError as e:
        return f"Error: {e}"
    active = (
        await ctx.db.scalar(
            select(func.count())
            .select_from(Schedule)
            .where(Schedule.agent_id == a.id, Schedule.enabled.is_(True))
        )
        or 0
    )
    same = await ctx.db.scalar(
        select(Schedule).where(
            Schedule.agent_id == a.id,
            Schedule.enabled.is_(True),
            Schedule.cron == w.cron,
            func.lower(Schedule.title) == title.lower(),
        )
    )
    if same is not None:
        return f"Already scheduled: '{same.title}' ({w.summary}, schedule {same.id})."
    if active >= MAX_ACTIVE:
        return (
            f"Error: you already run {active} schedules (the most is {MAX_ACTIVE}). Cancel one "
            "you no longer need first (list_my_schedules, cancel_schedule)."
        )
    person = _requester(ctx)
    who = await ctx.db.get(User, person) if person else None
    via = "chat" if ctx.person else "task"
    footer = (
        f"\n\n(This runs {w.summary}, set up by {who.name if who else 'a person'} through "
        f"{'chat' if via == 'chat' else 'a task'}. Your final answer is sent to "
        f"{who.name if who else 'them'}, so write it for them: short and to the point.)"
    )
    s = Schedule(
        workspace_id=ws.id,
        name=title[:160],
        agent_id=a.id,  # only ever for itself
        title=title,
        brief=brief + footer,
        cron=w.cron,
        timezone=tz,
        enabled=True,
        requires_review=False,  # the result goes straight to the person who asked
        created_by=schedules.by_agent(a.id, person, via, w.once),
    )
    ctx.db.add(s)
    await ctx.db.flush()
    await audit.record(
        ctx.db,
        ws.id,
        f"agent:{a.id}",
        "schedule.created",
        target=s.id,
        after={"name": s.name, "cron": s.cron, "agent": a.id, "for": person, "via": via},
    )
    await ctx.db.commit()
    try:
        await dispatch.upsert_schedule(s.id, s.cron, s.timezone, True, s.name)
    except Exception:  # noqa: BLE001 - the worker service is down: do not leave a dead row
        await ctx.db.delete(s)
        await ctx.db.commit()
        return "Error: the scheduler is not reachable, so nothing was set up. Try again shortly."
    return (
        f"Scheduled '{title}' {w.summary} ({tz}); first run {_local(w.first, tz)}. "
        f"Schedule {s.id}. Each result goes to {who.name if who else 'the person'}; it can be "
        "cancelled any time (cancel_schedule, or the Schedules page)."
    )


async def _list_my_schedules(ctx: ToolContext, args: dict[str, Any]) -> str:
    rows = (
        await ctx.db.scalars(
            select(Schedule)
            .where(Schedule.agent_id == ctx.agent.id)
            .order_by(Schedule.enabled.desc(), Schedule.created_at)
        )
    ).all()
    if not rows:
        return "You have no schedules."
    lines = []
    for s in rows[:40]:
        o = schedules.origin(s.created_by)
        try:
            nxt = schedules.next_runs(s.cron, s.timezone, 1)[0] if s.enabled else None
        except schedules.ScheduleError:
            nxt = None
        state = f"next {_local(nxt, s.timezone)}" if nxt else "off"
        made = "set up by you" if o.agent_id == ctx.agent.id else "set up by a person"
        lines.append(
            f"- [{s.id}] {s.title} | cron {s.cron}{' (once)' if o.once else ''} | {state} | {made}"
        )
    return "Your schedules:\n" + "\n".join(lines)


async def _cancel_schedule(ctx: ToolContext, args: dict[str, Any]) -> str:
    from . import dispatch

    sid = str(args.get("schedule_id") or "").strip()
    s = await ctx.db.get(Schedule, sid) if sid else None
    if s is None or s.agent_id != ctx.agent.id or s.workspace_id != ctx.workspace.id:
        return "Error: you have no schedule with that id (see list_my_schedules)."
    if schedules.origin(s.created_by).agent_id != ctx.agent.id:
        return (
            "Error: a person set this schedule up on the Schedules page; only they change it. "
            "Tell the person instead."
        )
    try:
        await dispatch.delete_schedule(s.id)
    except Exception:  # noqa: BLE001
        return (
            "Error: the scheduler is not reachable, so it could not be stopped. Try again shortly."
        )
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "schedule.deleted",
        target=s.id,
        note=str(args.get("reason") or "")[:300] or None,
    )
    title = s.title
    await ctx.db.delete(s)
    await ctx.db.commit()
    return f"Cancelled '{title}' ({sid}). It will not run again."


SCHEDULE_TOOLS: list[Tool] = [
    Tool(
        "schedule_task",
        "Schedule a job",
        "Set up work for yourself on a timer when a person asks: recurring ('every Monday at "
        "9am send me the slacking report') or once ('remind me Friday 4pm to submit the "
        "claim'). The brief is what you will do each time; the result is sent to the person. "
        "Pass `when` in plain words exactly as they said it (every day/weekday/Monday at 9am, "
        "every 2 hours, every month on the 1st at 9am, tomorrow 9am, on 10 Oct at 4pm) or a "
        "cron line. If the answer says the time is unclear, ask the person; never guess.",
        {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short name, e.g. Weekly slacking report",
                },
                "brief": {
                    "type": "string",
                    "description": "What to do on each run, self-contained.",
                },
                "when": {"type": "string", "description": "e.g. every Monday at 9am"},
            },
            "required": ["title", "brief", "when"],
        },
        "medium",
        "ask",
        _schedule_task,
    ),
    Tool(
        "list_my_schedules",
        "List my schedules",
        "The jobs you run on a timer: id, title, cron, next run, and who set each up.",
        {"type": "object", "properties": {}, "required": []},
        "low",
        "allow",
        _list_my_schedules,
    ),
    Tool(
        "cancel_schedule",
        "Cancel a schedule",
        "Stop one of the schedules you set up (by its id from list_my_schedules), e.g. when "
        "the person says 'stop the Monday report'.",
        {
            "type": "object",
            "properties": {"schedule_id": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["schedule_id"],
        },
        "low",
        "allow",
        _cancel_schedule,
    ),
]
