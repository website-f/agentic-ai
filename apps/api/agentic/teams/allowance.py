"""P36: each person's daily AI allowance (tokens per local day), set by the owner.

Every model call is logged against the person the work was for (engine/acting.py). Staff
get the workspace's default allowance unless the owner set their own; managers have none
unless one was set for them. When it is used up:
- a chat with their AI answers with a fixed note, no model call;
- a task they gave stops and asks a manager (never the person themselves) for more today;
- direct AI features (voice notes, summaries) refuse with the same note.
It resets at local midnight. P114: a manager can also add tokens for today only or for every
day to the end of this week (Monday to Sunday, local), from AI use and limits. Background
learning (facts, skills) never counts: it is the company's investment, not the person's use.

Workspace setting `ai_allowance`: {"daily_tokens": 300000, "roles": ["staff"],
"office_daily_tokens": 2000000}.

P51: work no person asked for (a shared mailbox's rules, an agent's own follow-ups) draws on
one office pool per day (`office_daily_tokens`, 0 = no limit). When it is used up, that work
stops and asks a manager, like a person's allowance.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..i18n import Msg, tr
from ..models import Agent, LLMCall, Membership, Schedule, Task, User, Workspace
from .budget import periods

log = logging.getLogger(__name__)

DEFAULT_DAILY_TOKENS = 300_000  # Fitri, 18 Nov 2026: 50k was only 2 or 3 tasks a day
# P123 (Fitri, 23 Nov 2026: "each staff has their limit; owners, developer, admins unlimited"):
# every role has the daily allowance by default except owners (the developer is one) and admins.
# The owner can still change the roles on AI use and limits; a person's own setting always wins.
DEFAULT_ROLES = (
    "branch_manager",
    "hod",
    "group_hod",
    "supervisor",
    "staff",
    "operator",
    "approver",
    "viewer",
    "management",
    "hr",
)
DEFAULT_OFFICE_DAILY = 2_000_000
OFFICE = "office"  # the pool's id in approvals and grants
MAX_DAILY_TOKENS = 50_000_000
GRANT_SHARE = 0.5  # a manager approving more adds half the allowance again, for today
# Learning and housekeeping the office does by itself: never charged to a person.
NOT_CHARGED = ("brain.", "skill.", "routine.")


def policy(ws: Workspace) -> tuple[int, tuple[str, ...]]:
    """(default tokens per day, roles it applies to). 0 tokens = no default limit."""
    raw: dict[str, Any] = (ws.settings or {}).get("ai_allowance") or {}
    try:
        daily = max(0, min(MAX_DAILY_TOKENS, int(raw.get("daily_tokens", DEFAULT_DAILY_TOKENS))))
    except (TypeError, ValueError):
        daily = DEFAULT_DAILY_TOKENS
    roles = raw.get("roles", DEFAULT_ROLES)
    if not isinstance(roles, list | tuple):
        roles = DEFAULT_ROLES
    return daily, tuple(str(r) for r in roles)


def limit_of(ws: Workspace, m: Membership) -> int | None:
    """The person's own setting wins (0 = no limit); else the default for their role."""
    if m.ai_daily_tokens is not None:
        return m.ai_daily_tokens or None
    daily, roles = policy(ws)
    return daily or None if m.role in roles else None


@dataclass
class Allowance:
    user_id: str
    used: int
    limit: int | None  # including what managers granted today; None = no limit
    extra: int
    day: str
    resets_at: str  # ISO, the next local midnight

    @property
    def over(self) -> bool:
        return self.limit is not None and self.used >= self.limit

    @property
    def remaining(self) -> int | None:
        return None if self.limit is None else max(0, self.limit - self.used)

    def dict(self) -> dict[str, Any]:
        return {
            "used": self.used,
            "limit": self.limit,
            "remaining": self.remaining,
            "extra": self.extra,
            "over": self.over,
            "day": self.day,
            "resets_at": self.resets_at,
        }

    def note(self, lang: str | None = None) -> str:
        if self.user_id == OFFICE:
            return tr(
                "The office's AI work that nobody asked for directly (mail rules, follow-ups) "
                "used today's limit ({used} of {limit} tokens). It resets at midnight, or a "
                "manager can give more.",
                lang,
                used=f"{self.used:,}",
                limit=f"{self.limit or 0:,}",
            )
        return tr(
            "Your AI allowance for today is used up ({used} of {limit} tokens). It resets at "
            "midnight, or a manager can give you more.",
            lang,
            used=f"{self.used:,}",
            limit=f"{self.limit or 0:,}",
        )


def _grant_key(ws_id: str, user_id: str, day: str) -> str:
    return f"allowance:grant:{ws_id}:{user_id}:{day}"


def week_of(day: str) -> str:
    """The Monday (YYYY-MM-DD) of the local week a local day is in."""
    d = datetime.strptime(day, "%Y-%m-%d")
    return (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d")


def week_end(tz: str, now: datetime | None = None) -> datetime:
    """The end of this local week (the next Monday 00:00), in UTC."""
    local = (now or datetime.now(UTC)).astimezone(ZoneInfo(tz))
    day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return (day0 + timedelta(days=7 - day0.weekday())).astimezone(UTC)


def _week_key(ws_id: str, user_id: str, day: str) -> str:
    """P114: tokens a manager added to every day of this week (the key is the week's Monday)."""
    return f"allowance:grant-week:{ws_id}:{user_id}:{week_of(day)}"


def grant_keys(ws_id: str, user_id: str, day: str) -> tuple[str, str]:
    """(today's extra, this week's extra per day): a day's limit adds both."""
    return _grant_key(ws_id, user_id, day), _week_key(ws_id, user_id, day)


async def _granted(ws_id: str, user_id: str, day: str) -> int:
    try:
        raw = await valkey().mget(list(grant_keys(ws_id, user_id, day)))
        return sum(int(v or 0) for v in raw)
    except Exception:  # noqa: BLE001 - no Valkey: no extra today
        return 0


Span = Literal["today", "week"]
MAX_GIVE = 5_000_000  # one gift at most (tokens a day)


async def give(ws: Workspace, user_id: str, tokens: int, span: Span) -> str:
    """P114: a manager adds `tokens` to a person's limit for today only, or for every day to the
    end of this week. Returns when it ends (ISO, local midnight / next Monday)."""
    p = periods(ws.timezone)
    if span == "week":
        key, ends = _week_key(ws.id, user_id, p.day), week_end(ws.timezone)
    else:
        key, ends = _grant_key(ws.id, user_id, p.day), p.day_start + timedelta(days=1)
    await valkey().incrby(key, tokens)
    await valkey().expire(key, 9 * 86400 if span == "week" else 2 * 86400)
    return ends.isoformat()


async def used_today(db: AsyncSession, ws: Workspace, user_id: str) -> int:
    p = periods(ws.timezone)
    q = select(func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0)).where(
        LLMCall.workspace_id == ws.id,
        LLMCall.user_id == user_id,
        LLMCall.ts >= p.day_start,
    )
    for prefix in NOT_CHARGED:
        q = q.where(~LLMCall.task.startswith(prefix))
    return int(await db.scalar(q) or 0)


async def used_by_person(db: AsyncSession, ws: Workspace) -> dict[str, int]:
    """Today's tokens per person, for the members list."""
    p = periods(ws.timezone)
    q = (
        select(LLMCall.user_id, func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens))
        .where(
            LLMCall.workspace_id == ws.id,
            LLMCall.user_id.is_not(None),
            LLMCall.ts >= p.day_start,
        )
        .group_by(LLMCall.user_id)
    )
    for prefix in NOT_CHARGED:
        q = q.where(~LLMCall.task.startswith(prefix))
    return {str(u): int(n or 0) for u, n in (await db.execute(q)).all()}


async def state(db: AsyncSession, ws: Workspace, user_id: str) -> Allowance:
    p = periods(ws.timezone)
    resets = (p.day_start + timedelta(days=1)).isoformat()
    m = await db.scalar(
        select(Membership).where(Membership.workspace_id == ws.id, Membership.user_id == user_id)
    )
    base = limit_of(ws, m) if m is not None else None
    if base is None:
        return Allowance(user_id, await used_today(db, ws, user_id), None, 0, p.day, resets)
    extra = await _granted(ws.id, user_id, p.day)
    return Allowance(user_id, await used_today(db, ws, user_id), base + extra, extra, p.day, resets)


async def check(db: AsyncSession, ws: Workspace, user_id: str | None) -> Allowance | None:
    """The person's allowance when they are over it, else None (no person, no limit, or
    some left)."""
    if not user_id:
        return None
    st = await state(db, ws, user_id)
    return st if st.over else None


async def grant(db: AsyncSession, ws: Workspace, user_id: str) -> int:
    """A manager approved more for today: half the person's allowance again. Returns it."""
    m = await db.scalar(
        select(Membership).where(Membership.workspace_id == ws.id, Membership.user_id == user_id)
    )
    base = limit_of(ws, m) if m is not None else None
    if not base:
        return 0
    extra = int(base * GRANT_SHARE)
    day = periods(ws.timezone).day
    key = _grant_key(ws.id, user_id, day)
    await valkey().incrby(key, extra)
    await valkey().expire(key, 2 * 86400)
    return extra


def office_limit(ws: Workspace) -> int | None:
    raw: dict[str, Any] = (ws.settings or {}).get("ai_allowance") or {}
    try:
        n = int(raw.get("office_daily_tokens", DEFAULT_OFFICE_DAILY))
    except (TypeError, ValueError):
        n = DEFAULT_OFFICE_DAILY
    return max(0, min(MAX_DAILY_TOKENS * 10, n)) or None


async def office_check(db: AsyncSession, ws: Workspace) -> Allowance | None:
    """P51: the office pool when it is used up, else None."""
    base = office_limit(ws)
    if base is None:
        return None
    p = periods(ws.timezone)
    q = select(func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0)).where(
        LLMCall.workspace_id == ws.id, LLMCall.user_id.is_(None), LLMCall.ts >= p.day_start
    )
    for prefix in NOT_CHARGED:
        q = q.where(~LLMCall.task.startswith(prefix))
    used = int(await db.scalar(q) or 0)
    extra = await _granted(ws.id, OFFICE, p.day)
    if used < base + extra:
        return None
    resets = (p.day_start + timedelta(days=1)).isoformat()
    return Allowance(OFFICE, used, base + extra, extra, p.day, resets)


async def grant_office(db: AsyncSession, ws: Workspace) -> int:
    """A manager approved more office work today: half the pool again."""
    base = office_limit(ws)
    if not base:
        return 0
    extra = int(base * GRANT_SHARE)
    key = _grant_key(ws.id, OFFICE, periods(ws.timezone).day)
    await valkey().incrby(key, extra)
    await valkey().expire(key, 2 * 86400)
    return extra


async def people_of_tasks(db: AsyncSession, tasks: list[Task]) -> dict[str, str | None]:
    """P114: person_of_task for many tasks at once (lists): who started each one's request.
    A few queries whatever the number of tasks: the first task of each request, then up the
    parent chain (bounded) for older rows without one, then the schedules they came from."""
    from .schedules import origin

    known: dict[str, Task] = {t.id: t for t in tasks}
    out: dict[str, str | None] = {}

    # Each task's next step up: its request's first task, else its parent.
    def up(t: Task) -> str | None:
        if t.root_task_id and t.root_task_id != t.id:
            return t.root_task_id
        return t.parent_task_id

    head: dict[str, str] = {t.id: t.id for t in tasks}  # task -> the task we are looking at
    for _ in range(6):
        need = {
            u
            for tid, at in head.items()
            if tid not in out
            and not (known[at].created_by or "").startswith(("user:", "schedule:"))
            and (u := up(known[at]))
            and u not in known
        }
        if need:
            for r in (await db.scalars(select(Task).where(Task.id.in_(need)))).all():
                known[r.id] = r
        moved = False
        for tid, at in list(head.items()):
            if tid in out:
                continue
            who = known[at].created_by or ""
            if who.startswith(("user:", "schedule:")):
                continue
            nxt = up(known[at])
            if nxt and nxt in known and nxt != at:
                head[tid], moved = nxt, True
            else:
                out[tid] = None
        if not moved:
            break
    sched_ids = {
        (known[at].created_by or "").removeprefix("schedule:")
        for tid, at in head.items()
        if tid not in out and (known[at].created_by or "").startswith("schedule:")
    }
    makers: dict[str, str] = {}
    if sched_ids:
        rows = (
            await db.execute(
                select(Schedule.id, Schedule.created_by).where(Schedule.id.in_(sched_ids))
            )
        ).all()
        makers = {i: by or "" for i, by in rows}
    for tid, at in head.items():
        if tid in out:
            continue
        who = known[at].created_by or ""
        if who.startswith("user:"):
            out[tid] = who.removeprefix("user:")
        elif who.startswith("schedule:"):
            by = makers.get(who.removeprefix("schedule:"), "")
            out[tid] = origin(by).person if by.startswith("user:") else None
        else:
            out[tid] = None
    return out


async def person_of_task(db: AsyncSession, task: Task) -> str | None:
    """The person a task's work is for: who gave it, or who gave the first task of its
    delegation tree, or who made the schedule it came from. None for the office's own
    work (a mail rule, an agent's own idea)."""
    seen: set[str] = set()
    t: Task | None = task
    while t is not None and t.id not in seen:
        seen.add(t.id)
        who = t.created_by or ""
        if who.startswith("user:"):
            return who.removeprefix("user:")
        if who.startswith("schedule:"):
            s = await db.get(Schedule, who.removeprefix("schedule:"))
            by = (s.created_by or "") if s is not None else ""
            from .schedules import origin  # "user:<id>" or, for a one-off, "user:<id>|once"

            return origin(by).person if by.startswith("user:") else None
        up = t.root_task_id if t.root_task_id and t.root_task_id != t.id else t.parent_task_id
        t = await db.get(Task, up) if up else None
    return None


async def tell_used_up(
    db: AsyncSession, ws: Workspace, user_id: str, agent: Agent | None, left: Allowance
) -> None:
    """P114: a person ran out (their chat was refused): they hear it, and so do the managers
    who may give more, once a day each (the delivery dedupe key). A task that runs out asks a
    manager through its approval instead (channels/deliver.approval_requested)."""
    from ..channels import deliver  # late: channels import the agents that import this

    try:
        who = await db.get(User, user_id)
        name = who.name if who else ""
        key = f"limit:{left.day}:{user_id}"
        ids = await deliver.notify_user(
            db,
            ws.id,
            user_id,
            Msg("Your AI allowance for today is used up"),
            Msg(
                "You used {used} of {limit} tokens. It resets at midnight, or a manager can give "
                "you more.",
                used=f"{left.used:,}",
                limit=f"{left.limit or 0:,}",
            ),
            "/",
            dedupe=key,
            event="limit",
        )
        for m in await deliver.deciders(db, ws.id, agent, budget=True):
            if m.id == user_id:
                continue
            ids += await deliver.notify_user(
                db,
                ws.id,
                m.id,
                Msg("{name} used today's AI allowance", name=name),
                Msg(
                    "{used} of {limit} tokens. Give more for today or for this week in AI use "
                    "and limits.",
                    used=f"{left.used:,}",
                    limit=f"{left.limit or 0:,}",
                ),
                "/settings/ai-use",
                dedupe=f"{key}:mgr",
                event="approvals",
            )
        await deliver.start(ids)
    except Exception:  # noqa: BLE001 - a notice never changes the answer
        log.warning("could not tell about %s's allowance", user_id, exc_info=True)


async def tell_given(
    db: AsyncSession, ws: Workspace, user_id: str, by: str, tokens: int, span: Span, resumed: int
) -> None:
    """P114: a manager gave the person more: they hear how much, for how long, and that their
    paused tasks carry on."""
    from ..channels import deliver  # late: channels import the agents that import this

    try:
        if span == "week":
            title = Msg(
                "{name} gave you {n} more AI tokens a day until Sunday", name=by, n=f"{tokens:,}"
            )
        else:
            title = Msg("{name} gave you {n} more AI tokens for today", name=by, n=f"{tokens:,}")
        body = (
            Msg("{n} of your paused tasks carry on now.", n=resumed)
            if resumed
            else Msg("Your AI can carry on.")
        )
        day = periods(ws.timezone).day
        ids = await deliver.notify_user(
            db,
            ws.id,
            user_id,
            title,
            body,
            "/tasks",
            dedupe=f"given:{day}:{user_id}:{datetime.now(UTC).timestamp():.0f}",
            event="limit",
        )
        await deliver.start(ids)
    except Exception:  # noqa: BLE001
        log.warning("could not tell %s about more allowance", user_id, exc_info=True)
