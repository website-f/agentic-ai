"""P36: each person's daily AI allowance (tokens per local day), set by the owner.

Every model call is logged against the person the work was for (engine/acting.py). Staff
get the workspace's default allowance unless the owner set their own; managers have none
unless one was set for them. When it is used up:
- a chat with their AI answers with a fixed note, no model call;
- a task they gave stops and asks a manager (never the person themselves) for more today;
- direct AI features (voice notes, summaries) refuse with the same note.
It resets at local midnight. Background learning (facts, skills) never counts: it is the
company's investment, not the person's use.

Workspace setting `ai_allowance`: {"daily_tokens": 50000, "roles": ["staff"]}.
"""

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..i18n import tr
from ..models import LLMCall, Membership, Schedule, Task, Workspace
from .budget import periods

DEFAULT_DAILY_TOKENS = 50_000
DEFAULT_ROLES = ("staff",)
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
        return tr(
            "Your AI allowance for today is used up ({used} of {limit} tokens). It resets at "
            "midnight, or a manager can give you more.",
            lang,
            used=f"{self.used:,}",
            limit=f"{self.limit or 0:,}",
        )


def _grant_key(ws_id: str, user_id: str, day: str) -> str:
    return f"allowance:grant:{ws_id}:{user_id}:{day}"


async def _granted(ws_id: str, user_id: str, day: str) -> int:
    try:
        return int(await valkey().get(_grant_key(ws_id, user_id, day)) or 0)
    except Exception:  # noqa: BLE001 - no Valkey: no extra today
        return 0


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
            return by.removeprefix("user:") if by.startswith("user:") else None
        up = t.root_task_id if t.root_task_id and t.root_task_id != t.id else t.parent_task_id
        t = await db.get(Task, up) if up else None
    return None
