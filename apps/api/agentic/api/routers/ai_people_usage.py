"""P113: AI usage per user, the developer's report (AI Engine > AI usage per user).

Read-only, from the model-call ledger (llm_calls, one row per model call attempt, written by
engine/store.record_call). Each row already says who the work was for (user_id, engine/
acting.py), what it was for (`task`, e.g. "agent.chat", "document.write"), the agent and task
when there was one, the provider, model and group, the tokens and the cost in USD (worked out
when the call was made from the model's prices in AI Engine > Models; None = unpriced).

P115 (Fitri, 18 Nov 2026): owners, admins and the system's developer see it (require_usage_reader,
403 for every other role). P114: they also see what each call was about:
the person's chat message and the AI's reply (matched by person, agent and time, since a chat
call does not record its conversation), a task's brief and result, their conversations and the
tasks their use paid for. Opening a person's report, a call or a conversation is audited
("ai_usage.*_viewed"). Tool-call arguments are never shown, only the text people and the AI wrote.

- GET /api/ai/people-usage                     everyone, one row per person, for the period
                                               (?period=today|7d|30d|month|last_month|custom
                                               &start=&end= dates, &role= &branch= id | "none",
                                               ?q=&page=&size=&sort=, X-Total-Count)
- GET /api/ai/people-usage/{user_id}           one person's full report for the period
- GET /api/ai/people-usage/{user_id}/events    their calls, one page (?feature=&agent=&model=
                                               &q=&sort=), each with what it was about
- GET /api/ai/people-usage/{user_id}/events/{id}  one call in full (audited)
- GET /api/ai/people-usage/{user_id}/conversations       their chats in the period (paged)
- GET /api/ai/people-usage/{user_id}/conversations/{id}  one chat's messages (audited)
- GET /api/ai/people-usage/{user_id}/tasks     the tasks their use paid for, tokens per task
`user_id` "office" is the work nobody asked for (routines, learning, the office's own jobs).
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, exists, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ...core.db import get_db
from ...models import (
    Agent,
    AgentMessage,
    Branch,
    ChatSession,
    Department,
    LLMCall,
    Membership,
    Task,
    User,
    Workspace,
)
from ...services import audit
from ...teams import allowance
from ...teams.budget import periods
from ..deps import Principal, api_error, current_principal, is_developer
from ..paging import TOTAL
from ..table import TableParams, like, matches, page_of
from .allowances import _grants

router = APIRouter(prefix="/api/ai/people-usage", tags=["ai-engine"])

# P115 (Fitri, 18 Nov 2026): "the AI usage report open for owner and admins as well".
READERS = ("owner", "admin", "it_support")  # P125: IT support reads it too


async def require_usage_reader(principal: Principal = Depends(current_principal)) -> Principal:
    """Owners, admins and the system's developer; everyone else 403."""
    if principal.role not in READERS and not is_developer(principal.user, principal.role):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only owners, admins and the system's developer see AI usage per user.",
        )
    return principal


OFFICE = "office"  # the {user_id} for work nobody asked for (llm_calls.user_id IS NULL)
MAX_DAYS = 366
Period = Literal["today", "7d", "30d", "month", "last_month", "custom"]

# What each call was for, by its `task` label (first match wins, so "agent.chat" before
# "agent."). Anything else is "other"; the raw label is always shown next to it.
FEATURES: tuple[tuple[str, str], ...] = (
    ("agent.chat", "chat"),
    ("agent.api", "api"),
    ("agent.", "agent_task"),
    ("goal.", "agent_task"),
    ("quality.", "agent_task"),
    ("context.", "agent_task"),
    ("scope.", "agent_task"),
    ("colleague.", "agent_task"),
    ("browser.", "agent_task"),
    ("workflow.", "workflows"),
    ("builders.", "workflows"),
    ("pack.", "workflows"),
    ("document.", "documents"),
    ("minutes.", "meetings"),
    ("meeting.", "meetings"),
    ("audio.", "voice"),
    ("mail.", "mail"),
    ("mail_accounts.", "mail"),
    ("skill.", "learning"),
    ("brain.", "learning"),
    ("routine.", "learning"),
    ("broadcast.", "broadcasts"),
    ("file.", "files"),
    ("vision.", "files"),
    ("image.", "images"),
    ("overview.", "overview"),
    ("twin.", "twin"),
    ("help.", "help"),
    ("members.", "admin"),
    ("engine.", "engine"),
    ("playground", "engine"),
)
FEATURE_KEYS = tuple(dict.fromkeys([k for _, k in FEATURES] + ["other"]))


def feature_of(task: str | None) -> str:
    t = task or ""
    for prefix, key in FEATURES:
        if t.startswith(prefix):
            return key
    return "other"


def _feature_where(key: str) -> ColumnElement[bool]:
    if key == "other":
        return not_(or_(*[LLMCall.task.startswith(p) for p, _ in FEATURES]))
    # Earlier prefixes of another feature win (e.g. "agent.chat" is chat, not an agent task).
    mine: list[ColumnElement[bool]] = []
    for i, (prefix, k) in enumerate(FEATURES):
        if k != key:
            continue
        before = [LLMCall.task.startswith(p) for p, k2 in FEATURES[:i] if k2 != key]
        mine.append(and_(LLMCall.task.startswith(prefix), *[not_(b) for b in before]))
    return or_(*mine)


def charged(task: str | None) -> bool:
    """Counts toward the person's daily allowance (teams/allowance.NOT_CHARGED)."""
    return not any((task or "").startswith(p) for p in allowance.NOT_CHARGED)


# ---------------------------------------------------------------- the period


@dataclass
class Window:
    key: str
    start: date  # first day, workspace local
    end: date  # last day, inclusive
    since: datetime  # UTC
    until: datetime  # UTC, exclusive
    tz: str

    def out(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "days": (self.end - self.start).days + 1,
            "timezone": self.tz,
        }


def window(
    tz: str, period: str, start: date | None, end: date | None, now: datetime | None = None
) -> Window:
    zone = ZoneInfo(tz or "Asia/Kuala_Lumpur")
    today = (now or datetime.now(UTC)).astimezone(zone).date()
    if period == "today":
        d0, d1 = today, today
    elif period == "7d":
        d0, d1 = today - timedelta(days=6), today
    elif period == "30d":
        d0, d1 = today - timedelta(days=29), today
    elif period == "month":
        d0, d1 = today.replace(day=1), today
    elif period == "last_month":
        d1 = today.replace(day=1) - timedelta(days=1)
        d0 = d1.replace(day=1)
    else:
        if start is None or end is None:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_period",
                "Pick a start and an end date for a custom period.",
            )
        if end < start or (end - start).days + 1 > MAX_DAYS:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_period",
                "The end must be on or after the start, and a period can be {days} days at most.",
                days=MAX_DAYS,
            )
        d0, d1 = start, end

    def at(d: date) -> datetime:
        return datetime.combine(d, time.min, zone).astimezone(UTC)

    return Window(period, d0, d1, at(d0), at(d1 + timedelta(days=1)), zone.key)


class PeriodParams:
    def __init__(
        self,
        period: Period = Query(default="7d"),
        start: date | None = Query(default=None),
        end: date | None = Query(default=None),
    ) -> None:
        self.period = period
        self.start = start
        self.end = end


def _in(w: Window, ws_id: str) -> tuple[ColumnElement[bool], ...]:
    return (LLMCall.workspace_id == ws_id, LLMCall.ts >= w.since, LLMCall.ts < w.until)


# ---------------------------------------------------------------- shapes


class Sums(BaseModel):
    calls: int = 0
    errors: int = 0
    prompt: int = 0
    completion: int = 0
    cached: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    unpriced: int = 0  # successful calls with no price for the model

    def add(self, r: Any) -> None:
        self.calls += int(r.calls or 0)
        self.errors += int(r.errors or 0)
        self.prompt += int(r.prompt or 0)
        self.completion += int(r.completion or 0)
        self.cached += int(r.cached or 0)
        self.tokens = self.prompt + self.completion
        self.cost_usd = round(self.cost_usd + float(r.cost or 0), 6)
        self.unpriced += int(r.unpriced or 0)


class FeatureSums(Sums):
    feature: str


class PersonUsage(Sums):
    user_id: str
    name: str
    email: str
    role: str  # "" = not a member now
    member: bool = True
    branch_id: str | None = None
    branch_name: str | None = None
    department_name: str | None = None
    share: float = 0.0  # % of all tokens in the period
    top_feature: str | None = None
    last_used: str | None = None  # in the period
    today_used: int = 0  # what counts toward the allowance today
    today_limit: int | None = None  # None = no limit


class Totals(Sums):
    active_users: int = 0
    office_tokens: int = 0  # work nobody asked for
    office_calls: int = 0
    top_feature: str | None = None
    top_feature_tokens: int = 0
    features: list[FeatureSums] = []


class PeopleOut(BaseModel):
    period: dict[str, Any]
    currency: str = "USD"
    totals: Totals
    people: list[PersonUsage]


def _sums(*group: Any):
    return select(
        *group,
        func.count().label("calls"),
        func.coalesce(func.sum(case((LLMCall.status == "error", 1), else_=0)), 0).label("errors"),
        func.coalesce(func.sum(LLMCall.prompt_tokens), 0).label("prompt"),
        func.coalesce(func.sum(LLMCall.completion_tokens), 0).label("completion"),
        func.coalesce(func.sum(LLMCall.cached_tokens), 0).label("cached"),
        func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
        func.coalesce(
            func.sum(case((LLMCall.cost_usd.is_(None) & (LLMCall.status == "ok"), 1), else_=0)), 0
        ).label("unpriced"),
    )


async def _place_names(db: AsyncSession, ws_id: str) -> dict[str, str]:
    out = {
        i: n
        for i, n in (
            await db.execute(select(Branch.id, Branch.name).where(Branch.workspace_id == ws_id))
        ).all()
    }
    out.update(
        {
            i: n
            for i, n in (
                await db.execute(
                    select(Department.id, Department.name).where(Department.workspace_id == ws_id)
                )
            ).all()
        }
    )
    return out


def _place(p: PersonUsage) -> str:
    return f"{p.branch_name or ''} {p.department_name or ''}".strip().lower()


SORT_KEYS: dict[str, Any] = {
    "name": lambda p: p.name.lower(),
    "email": lambda p: p.email.lower(),
    "role": lambda p: p.role,
    "place": _place,
    "calls": lambda p: p.calls,
    "prompt": lambda p: p.prompt,
    "completion": lambda p: p.completion,
    "tokens": lambda p: p.tokens,
    "cost": lambda p: p.cost_usd,
    "share": lambda p: p.share,
    "today": lambda p: p.today_used,
    "last_used": lambda p: p.last_used,
}


def _top(features: dict[str, Sums]) -> tuple[str | None, int]:
    best = max(features.items(), key=lambda kv: (kv[1].tokens, kv[1].calls), default=None)
    return (best[0], best[1].tokens) if best and best[1].calls else (None, 0)


# ---------------------------------------------------------------- everyone


@router.get("")
async def people_usage(
    response: Response,
    params: TableParams = Depends(),
    period: PeriodParams = Depends(),
    role: str | None = Query(default=None, max_length=16),
    branch: str | None = Query(default=None, max_length=40),
    department: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> PeopleOut:
    """One row per person, most tokens first. Members with no use in the period are listed
    too (at the end), and people who used AI but are no longer members (role "")."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    key, desc = params.sort_by(SORT_KEYS, "-tokens")

    rows = (
        await db.execute(
            _sums(LLMCall.user_id, LLMCall.task, func.max(LLMCall.ts).label("last"))
            .where(*_in(w, ws.id))
            .group_by(LLMCall.user_id, LLMCall.task)
        )
    ).all()
    totals = Totals()
    by_feature: dict[str, Sums] = defaultdict(Sums)
    per: dict[str, Sums] = defaultdict(Sums)
    per_feature: dict[str, dict[str, Sums]] = defaultdict(lambda: defaultdict(Sums))
    last: dict[str, datetime] = {}
    for r in rows:
        totals.add(r)
        by_feature[feature_of(r.task)].add(r)
        if r.user_id is None:
            totals.office_calls += int(r.calls or 0)
            totals.office_tokens += int(r.prompt or 0) + int(r.completion or 0)
            continue
        uid = str(r.user_id)
        per[uid].add(r)
        per_feature[uid][feature_of(r.task)].add(r)
        if r.last is not None and (uid not in last or r.last > last[uid]):
            last[uid] = r.last
    totals.active_users = len(per)
    totals.top_feature, totals.top_feature_tokens = _top(by_feature)
    totals.features = sorted(
        (FeatureSums(feature=k, **v.model_dump()) for k, v in by_feature.items()),
        key=lambda f: (-f.tokens, -f.calls, f.feature),
    )

    names = await _place_names(db, ws.id)
    members = list(
        (await db.scalars(select(Membership).where(Membership.workspace_id == ws.id))).all()
    )
    today = await allowance.used_by_person(db, ws)
    limits = {m.user_id: allowance.limit_of(ws, m) for m in members}
    grants = await _grants(
        ws.id, [u for u, b in limits.items() if b is not None], periods(ws.timezone).day
    )

    def person(uid: str, base: dict[str, Any]) -> PersonUsage:
        s = per.get(uid, Sums())
        top, _ = _top(per_feature.get(uid, {}))
        lim = limits.get(uid)
        return PersonUsage(
            **base,
            **s.model_dump(),
            user_id=uid,
            share=round(s.tokens * 100 / totals.tokens, 2) if totals.tokens else 0.0,
            top_feature=top,
            last_used=last[uid].isoformat() if uid in last else None,
            today_used=today.get(uid, 0),
            today_limit=None if lim is None else lim + sum(grants.get(uid, (0, 0))),
        )

    everyone: list[PersonUsage] = []
    for m in members:
        if role and m.role != role:
            continue
        if branch and (m.branch_id or "none") != branch:
            continue
        if department and (m.department_id or "none") != department:
            continue
        everyone.append(
            person(
                m.user_id,
                {
                    "name": m.user.name,
                    "email": m.user.email,
                    "role": m.role,
                    "branch_id": m.branch_id,
                    "branch_name": names.get(m.branch_id or ""),
                    "department_name": names.get(m.department_id or ""),
                },
            )
        )
    gone = [u for u in per if u not in limits]
    if gone and not role and not branch and not department:
        for u in (await db.scalars(select(User).where(User.id.in_(gone)))).all():
            everyone.append(
                person(u.id, {"name": u.name, "email": u.email, "role": "", "member": False})
            )

    words = params.words
    if words:
        everyone = [
            p
            for p in everyone
            if matches(words, p.name, p.email, p.role, p.branch_name, p.department_name)
        ]
    everyone.sort(key=lambda p: p.name.lower())  # ties keep name order
    people = page_of(everyone, params, response, SORT_KEYS[key], desc)
    return PeopleOut(period=w.out(), totals=totals, people=people)


# ---------------------------------------------------------------- one person


class Person(BaseModel):
    user_id: str
    name: str
    email: str
    role: str
    member: bool
    branch_name: str | None = None
    department_name: str | None = None
    today_used: int = 0
    today_limit: int | None = None


class PurposeSums(Sums):
    purpose: str
    feature: str
    charged: bool


class AgentSums(Sums):
    agent_id: str | None
    name: str | None


class ModelSums(Sums):
    provider: str
    model: str
    group: str | None


class DaySums(BaseModel):
    day: str
    calls: int = 0
    tokens: int = 0
    cost_usd: float = 0.0


class ReportOut(BaseModel):
    period: dict[str, Any]
    currency: str = "USD"
    person: Person
    totals: Sums
    tasks: int = 0  # different tasks the calls worked on
    first_used: str | None = None
    last_used: str | None = None
    by_feature: list[FeatureSums]
    by_purpose: list[PurposeSums]
    by_agent: list[AgentSums]
    by_model: list[ModelSums]
    daily: list[DaySums]


async def _person(db: AsyncSession, ws: Workspace, user_id: str) -> Person:
    if user_id == OFFICE:
        return Person(user_id=OFFICE, name="", email="", role="", member=False)
    m = await db.scalar(
        select(Membership).where(Membership.workspace_id == ws.id, Membership.user_id == user_id)
    )
    if m is not None:
        names = await _place_names(db, ws.id)
        base = allowance.limit_of(ws, m)
        grant = (await _grants(ws.id, [user_id], periods(ws.timezone).day)).get(user_id)
        return Person(
            user_id=user_id,
            name=m.user.name,
            email=m.user.email,
            role=m.role,
            member=True,
            branch_name=names.get(m.branch_id or ""),
            department_name=names.get(m.department_id or ""),
            today_used=await allowance.used_today(db, ws, user_id),
            today_limit=None if base is None else base + sum(grant or (0, 0)),
        )
    # Not a member now: only if their AI use is on this workspace's ledger.
    used = await db.scalar(
        select(LLMCall.id).where(LLMCall.workspace_id == ws.id, LLMCall.user_id == user_id).limit(1)
    )
    u = await db.get(User, user_id) if used is not None else None
    if u is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That person is not here.")
    return Person(user_id=u.id, name=u.name, email=u.email, role="", member=False)


def _who(user_id: str) -> ColumnElement[bool]:
    return LLMCall.user_id.is_(None) if user_id == OFFICE else LLMCall.user_id == user_id


@router.get("/{user_id}")
async def person_usage(
    user_id: str,
    period: PeriodParams = Depends(),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """Everything one person's AI did in the period: by feature, purpose, agent, model, day."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    who = await _person(db, ws, user_id)
    where = (*_in(w, ws.id), _who(user_id))
    await _viewed(db, principal, "ai_usage.report_viewed", user_id, period=w.key)

    totals = Sums()
    features: dict[str, Sums] = defaultdict(Sums)
    purposes: list[PurposeSums] = []
    for r in (await db.execute(_sums(LLMCall.task).where(*where).group_by(LLMCall.task))).all():
        totals.add(r)
        features[feature_of(r.task)].add(r)
        s = Sums()
        s.add(r)
        purposes.append(
            PurposeSums(
                purpose=r.task,
                feature=feature_of(r.task),
                charged=charged(r.task),
                **s.model_dump(),
            )
        )

    agents: list[AgentSums] = []
    agent_rows = (
        await db.execute(_sums(LLMCall.agent_id).where(*where).group_by(LLMCall.agent_id))
    ).all()
    ids = [r.agent_id for r in agent_rows if r.agent_id]
    agent_names = (
        dict((await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(ids)))).all())
        if ids
        else {}
    )
    for r in agent_rows:
        s = Sums()
        s.add(r)
        agents.append(
            AgentSums(agent_id=r.agent_id, name=agent_names.get(r.agent_id or ""), **s.model_dump())
        )

    models: list[ModelSums] = []
    for r in (
        await db.execute(
            _sums(LLMCall.provider_name, LLMCall.model, LLMCall.group_name)
            .where(*where)
            .group_by(LLMCall.provider_name, LLMCall.model, LLMCall.group_name)
        )
    ).all():
        s = Sums()
        s.add(r)
        models.append(
            ModelSums(provider=r.provider_name, model=r.model, group=r.group_name, **s.model_dump())
        )

    local_day = func.date(func.timezone(w.tz, LLMCall.ts)).label("day")
    days = {
        r.day.isoformat(): r
        for r in (
            await db.execute(
                select(
                    local_day,
                    func.count().label("calls"),
                    func.coalesce(
                        func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0
                    ).label("tokens"),
                    func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
                )
                .where(*where)
                .group_by(local_day)
            )
        ).all()
    }
    daily = []
    d = w.start
    while d <= w.end:
        r = days.get(d.isoformat())
        daily.append(
            DaySums(
                day=d.isoformat(),
                calls=int(r.calls) if r else 0,
                tokens=int(r.tokens) if r else 0,
                cost_usd=round(float(r.cost or 0), 6) if r else 0.0,
            )
        )
        d += timedelta(days=1)

    span = (
        await db.execute(
            select(
                func.min(LLMCall.ts),
                func.max(LLMCall.ts),
                func.count(func.distinct(LLMCall.task_id)),
            ).where(*where)
        )
    ).one()

    def order(items: list[Any]) -> list[Any]:
        return sorted(items, key=lambda s: (-s.tokens, -s.calls))

    return ReportOut(
        period=w.out(),
        person=who,
        totals=totals,
        tasks=int(span[2] or 0),
        first_used=span[0].isoformat() if span[0] else None,
        last_used=span[1].isoformat() if span[1] else None,
        by_feature=order([FeatureSums(feature=k, **v.model_dump()) for k, v in features.items()]),
        by_purpose=order(purposes),
        by_agent=order(agents),
        by_model=order(models),
        daily=daily,
    )


async def _viewed(
    db: AsyncSession, principal: Principal, action: str, user_id: str, **after: Any
) -> None:
    """P114: the developer read a person's AI use or what they wrote: kept in the audit log."""
    await audit.record(
        db, principal.workspace_id, principal.actor, action, target=user_id, after=after or None
    )
    await db.commit()


# ---------------------------------------------------------------- what each call was about

CLIP = 400  # characters of a prompt, reply, brief or result in a list (the detail has more)
FULL = 20_000  # characters in a detail view
CHAT_MATCH = timedelta(hours=6)  # a chat call is matched to the person's message before it

Msg = aliased(AgentMessage)
Sess = aliased(ChatSession)


def _clip(text: str | None, n: int = CLIP) -> str | None:
    if not text:
        return None
    t = text.strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _chat_call() -> ColumnElement[bool]:
    """A call made in a conversation with an agent (no task): chat, and the steps around it."""
    return and_(
        LLMCall.task_id.is_(None), LLMCall.agent_id.is_not(None), LLMCall.user_id.is_not(None)
    )


def _asked(col: Any) -> Any:
    """The person's own message just before a chat call, in their conversations with that agent
    (within CHAT_MATCH): `col` of it (Msg.id or Msg.content). A chat call does not record its
    conversation, so this is matched by person, agent and time."""
    return (
        select(col)
        .join(Sess, Sess.id == Msg.session_id)
        .where(
            Sess.workspace_id == LLMCall.workspace_id,
            Sess.user_id == LLMCall.user_id,
            Sess.agent_id == LLMCall.agent_id,
            Msg.role == "user",
            Msg.created_at <= LLMCall.ts,
            Msg.created_at > LLMCall.ts - CHAT_MATCH,
        )
        .order_by(Msg.created_at.desc(), Msg.id.desc())
        .limit(1)
        .correlate(LLMCall)
        .scalar_subquery()
    )


@dataclass
class Turn:
    session_id: str
    session_title: str
    asked: str | None
    answered: str | None
    asked_at: datetime


async def _turns(db: AsyncSession, msg_ids: set[int], n: int) -> dict[int, Turn]:
    """For the person's messages: the conversation, and the AI's reply that followed (the next
    assistant message with text in the same conversation). Three queries for any number."""
    if not msg_ids:
        return {}
    reply = aliased(AgentMessage)
    reply_id = (
        select(reply.id)
        .where(
            reply.session_id == Msg.session_id,
            reply.role == "assistant",
            reply.id > Msg.id,
            reply.content.is_not(None),
            reply.content != "",
        )
        .order_by(reply.id)
        .limit(1)
        .correlate(Msg)
        .scalar_subquery()
    )
    rows = (
        await db.execute(
            select(
                Msg.id, Msg.session_id, Msg.content, Msg.created_at, reply_id.label("reply_id")
            ).where(Msg.id.in_(msg_ids))
        )
    ).all()
    replies = {r.reply_id for r in rows if r.reply_id}
    texts = (
        dict(
            (
                await db.execute(
                    select(AgentMessage.id, AgentMessage.content).where(
                        AgentMessage.id.in_(replies)
                    )
                )
            ).all()
        )
        if replies
        else {}
    )
    sids = {r.session_id for r in rows if r.session_id}
    titles = (
        dict(
            (
                await db.execute(
                    select(ChatSession.id, ChatSession.title).where(ChatSession.id.in_(sids))
                )
            ).all()
        )
        if sids
        else {}
    )
    return {
        r.id: Turn(
            session_id=r.session_id,
            session_title=titles.get(r.session_id, ""),
            asked=_clip(r.content, n),
            answered=_clip(texts.get(r.reply_id), n),
            asked_at=r.created_at,
        )
        for r in rows
    }


class EventOut(BaseModel):
    id: int
    ts: str
    purpose: str
    feature: str
    charged: bool
    agent_id: str | None
    agent_name: str | None
    task_id: str | None
    task_title: str | None
    provider: str
    model: str
    group: str | None
    prompt: int
    completion: int
    cached: int
    tokens: int
    cost_usd: float | None
    status: str
    error_class: str | None
    latency_ms: int
    # P114: what it was about. "task": the task's brief and result; "chat": the person's message
    # before it and the reply after it, matched by time; None: nothing to show (documents,
    # meetings, voice and other direct features keep no link to their text).
    source: str | None = None
    asked: str | None = None
    answered: str | None = None
    session_id: str | None = None
    session_title: str | None = None


EVENT_SORTS = {
    "ts": LLMCall.ts,
    "tokens": LLMCall.prompt_tokens + LLMCall.completion_tokens,
    "cost": LLMCall.cost_usd,
}


def _task_text(word: str) -> ColumnElement[bool]:
    pat = like(word)
    return exists(
        select(Task.id).where(
            Task.id == LLMCall.task_id,
            or_(
                Task.title.ilike(pat, escape="\\"),
                Task.brief.ilike(pat, escape="\\"),
                Task.result.ilike(pat, escape="\\"),
            ),
        )
    )


async def _events_page(
    db: AsyncSession, ws: Workspace, calls: list[LLMCall], asked_ids: dict[int, int | None], n: int
) -> list[EventOut]:
    agent_ids = {c.agent_id for c in calls if c.agent_id}
    task_ids = {c.task_id for c in calls if c.task_id}
    agent_names = (
        dict(
            (
                await db.execute(
                    select(Agent.id, Agent.name).where(
                        Agent.id.in_(agent_ids), Agent.workspace_id == ws.id
                    )
                )
            ).all()
        )
        if agent_ids
        else {}
    )
    tasks = (
        {
            r.id: r
            for r in (
                await db.execute(
                    select(Task.id, Task.title, Task.brief, Task.result).where(
                        Task.id.in_(task_ids), Task.workspace_id == ws.id
                    )
                )
            ).all()
        }
        if task_ids
        else {}
    )
    turns = await _turns(db, {i for i in asked_ids.values() if i}, n)
    out = []
    for c in calls:
        t = tasks.get(c.task_id or "")
        turn = turns.get(asked_ids.get(c.id) or 0)
        source, asked, answered = None, None, None
        if t is not None:
            source, asked, answered = "task", _clip(t.brief, n), _clip(t.result, n)
        elif turn is not None:
            source, asked, answered = "chat", turn.asked, turn.answered
        out.append(
            EventOut(
                id=c.id,
                ts=c.ts.isoformat(),
                purpose=c.task,
                feature=feature_of(c.task),
                charged=charged(c.task),
                agent_id=c.agent_id,
                agent_name=agent_names.get(c.agent_id or ""),
                task_id=c.task_id,
                task_title=t.title if t is not None else None,
                provider=c.provider_name,
                model=c.model,
                group=c.group_name,
                prompt=c.prompt_tokens or 0,
                completion=c.completion_tokens or 0,
                cached=c.cached_tokens or 0,
                tokens=(c.prompt_tokens or 0) + (c.completion_tokens or 0),
                cost_usd=float(c.cost_usd) if c.cost_usd is not None else None,
                status=c.status,
                error_class=c.error_class,
                latency_ms=c.latency_ms or 0,
                source=source,
                asked=asked,
                answered=answered,
                session_id=turn.session_id if turn else None,
                session_title=turn.session_title if turn else None,
            )
        )
    return out


@router.get("/{user_id}/events")
async def person_events(
    user_id: str,
    response: Response,
    params: TableParams = Depends(),
    period: PeriodParams = Depends(),
    feature: str | None = Query(default=None, max_length=24),
    agent: str | None = Query(default=None, max_length=40),
    model: str | None = Query(default=None, max_length=200),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> list[EventOut]:
    """One page of the person's model calls, newest first: when, what for, which agent and
    task, which model, tokens and cost, and (P114) what it was about. `agent` is an agent id or
    "none"; the search also looks in what they asked, the task and its result."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    await _person(db, ws, user_id)
    key, desc = params.sort_by(EVENT_SORTS, "-ts")
    where = [*_in(w, ws.id), _who(user_id)]
    if feature:
        if feature not in FEATURE_KEYS:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_feature",
                "There is no feature called {feature}.",
                feature=feature,
            )
        where.append(_feature_where(feature))
    if agent:
        where.append(LLMCall.agent_id.is_(None) if agent == "none" else LLMCall.agent_id == agent)
    if model:
        where.append(LLMCall.model == model)
    chat = _chat_call()
    asked_text = _asked(Msg.content)
    for word in params.words:
        pat = like(word)
        where.append(
            or_(
                LLMCall.task.ilike(pat, escape="\\"),
                LLMCall.model.ilike(pat, escape="\\"),
                LLMCall.provider_name.ilike(pat, escape="\\"),
                and_(LLMCall.task_id.is_not(None), _task_text(word)),
                and_(chat, asked_text.ilike(pat, escape="\\")),
            )
        )
    total = await db.scalar(select(func.count()).select_from(LLMCall).where(*where))
    response.headers[TOTAL] = str(int(total or 0))
    col = EVENT_SORTS[key]
    sort_col = col.desc().nulls_last() if desc else col.asc().nulls_last()
    asked_id = case((chat, _asked(Msg.id)), else_=None).label("asked_id")
    rows = (
        await db.execute(
            select(LLMCall, asked_id)
            .where(*where)
            .order_by(sort_col, LLMCall.id.desc() if desc else LLMCall.id.asc())
            .offset(params.offset)
            .limit(params.size if params.paged else 25)
        )
    ).all()
    calls = [r[0] for r in rows]
    return await _events_page(db, ws, calls, {r[0].id: r[1] for r in rows}, CLIP)


class FacetsOut(BaseModel):
    agents: list[dict[str, Any]]  # [{id, name, calls}] (id None = no agent)
    models: list[dict[str, Any]]  # [{model, provider, calls}]


@router.get("/{user_id}/facets")
async def person_facets(
    user_id: str,
    period: PeriodParams = Depends(),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> FacetsOut:
    """P114: the agents and models in the person's calls for the period (the log's filters)."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    await _person(db, ws, user_id)
    where = (*_in(w, ws.id), _who(user_id))
    arows = (
        await db.execute(
            select(LLMCall.agent_id, func.count())
            .where(*where)
            .group_by(LLMCall.agent_id)
            .order_by(func.count().desc())
            .limit(200)
        )
    ).all()
    ids = [a for a, _ in arows if a]
    names = (
        dict((await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(ids)))).all())
        if ids
        else {}
    )
    mrows = (
        await db.execute(
            select(LLMCall.model, LLMCall.provider_name, func.count())
            .where(*where)
            .group_by(LLMCall.model, LLMCall.provider_name)
            .order_by(func.count().desc())
            .limit(200)
        )
    ).all()
    return FacetsOut(
        agents=[{"id": a, "name": names.get(a or "") if a else None, "calls": n} for a, n in arows],
        models=[{"model": m, "provider": p, "calls": n} for m, p, n in mrows],
    )


class EventDetailOut(EventOut):
    task_status: str | None = None
    error_detail: str | None = None


@router.get("/{user_id}/events/{call_id}")
async def person_event(
    user_id: str,
    call_id: int,
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> EventDetailOut:
    """P114: one call in full: what they asked and what came back (up to 20,000 characters
    each), or the task's brief and result. Audited."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    await _person(db, ws, user_id)
    row = (
        await db.execute(
            select(LLMCall, case((_chat_call(), _asked(Msg.id)), else_=None)).where(
                LLMCall.id == call_id, LLMCall.workspace_id == ws.id, _who(user_id)
            )
        )
    ).first()
    if row is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That call is not here.")
    c = row[0]
    ev = (await _events_page(db, ws, [c], {c.id: row[1]}, FULL))[0]
    t = await db.get(Task, c.task_id) if c.task_id else None
    await _viewed(db, principal, "ai_usage.call_viewed", user_id, call_id=call_id)
    return EventDetailOut(
        **ev.model_dump(),
        task_status=t.status if t is not None and t.workspace_id == ws.id else None,
        error_detail=c.error_detail,
    )


# ---------------------------------------------------------------- conversations and tasks


class ConversationOut(BaseModel):
    id: str
    title: str
    agent_id: str
    agent_name: str | None
    messages: int  # theirs and the AI's, in the period
    asked: int  # their own messages in the period
    first_at: str
    last_at: str
    first_message: str | None  # the first thing they asked in the period
    tokens: int  # chat calls with that agent while it ran (about: matched by time)
    cost_usd: float


CONVO_SORTS = ("last", "first", "messages", "tokens", "title")


@router.get("/{user_id}/conversations")
async def person_conversations(
    user_id: str,
    response: Response,
    params: TableParams = Depends(),
    period: PeriodParams = Depends(),
    agent: str | None = Query(default=None, max_length=40),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationOut]:
    """P114: the person's conversations with agents that had messages in the period, last
    active first. Search: the title, the agent's name or anything they or the AI wrote."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    await _person(db, ws, user_id)
    key, desc = params.sort_by(CONVO_SORTS, "-last")
    if user_id == OFFICE:
        response.headers[TOTAL] = "0"
        return []
    talk = (AgentMessage.role.in_(("user", "assistant")), AgentMessage.content.is_not(None))
    agg = (
        select(
            AgentMessage.session_id.label("sid"),
            func.count().label("messages"),
            func.coalesce(func.sum(case((AgentMessage.role == "user", 1), else_=0)), 0).label(
                "asked"
            ),
            func.min(AgentMessage.created_at).label("first_at"),
            func.max(AgentMessage.created_at).label("last_at"),
        )
        .join(ChatSession, ChatSession.id == AgentMessage.session_id)
        .where(
            ChatSession.workspace_id == ws.id,
            ChatSession.user_id == user_id,
            AgentMessage.created_at >= w.since,
            AgentMessage.created_at < w.until,
            *talk,
        )
        .group_by(AgentMessage.session_id)
        .subquery()
    )
    tokens = (
        select(func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0))
        .where(
            LLMCall.workspace_id == ws.id,
            LLMCall.user_id == user_id,
            LLMCall.agent_id == ChatSession.agent_id,
            LLMCall.task_id.is_(None),
            LLMCall.ts >= agg.c.first_at,
            LLMCall.ts <= agg.c.last_at + timedelta(minutes=10),
        )
        .correlate(ChatSession, agg)
        .scalar_subquery()
    )
    cost = (
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0))
        .where(
            LLMCall.workspace_id == ws.id,
            LLMCall.user_id == user_id,
            LLMCall.agent_id == ChatSession.agent_id,
            LLMCall.task_id.is_(None),
            LLMCall.ts >= agg.c.first_at,
            LLMCall.ts <= agg.c.last_at + timedelta(minutes=10),
        )
        .correlate(ChatSession, agg)
        .scalar_subquery()
    )
    where: list[ColumnElement[bool]] = []
    if agent:
        where.append(ChatSession.agent_id == agent)
    for word in params.words:
        pat = like(word)
        where.append(
            or_(
                ChatSession.title.ilike(pat, escape="\\"),
                Agent.name.ilike(pat, escape="\\"),
                exists(
                    select(AgentMessage.id).where(
                        AgentMessage.session_id == ChatSession.id,
                        *talk,
                        AgentMessage.content.ilike(pat, escape="\\"),
                    )
                ),
            )
        )
    base = (
        select(ChatSession, Agent.name, agg, tokens.label("tokens"), cost.label("cost"))
        .join(agg, agg.c.sid == ChatSession.id)
        .outerjoin(Agent, Agent.id == ChatSession.agent_id)
        .where(*where)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    response.headers[TOTAL] = str(int(total or 0))
    cols = {
        "last": agg.c.last_at,
        "first": agg.c.first_at,
        "messages": agg.c.messages,
        "tokens": tokens,
        "title": ChatSession.title,
    }
    col = cols[key]
    rows = (
        await db.execute(
            base.order_by(col.desc() if desc else col.asc(), ChatSession.id)
            .offset(params.offset)
            .limit(params.size if params.paged else 25)
        )
    ).all()
    sids = [r[0].id for r in rows]
    first_asked: dict[str, str] = {}
    if sids:
        firsts = (
            select(AgentMessage.session_id, func.min(AgentMessage.id).label("mid"))
            .where(
                AgentMessage.session_id.in_(sids),
                AgentMessage.role == "user",
                AgentMessage.created_at >= w.since,
                AgentMessage.created_at < w.until,
            )
            .group_by(AgentMessage.session_id)
            .subquery()
        )
        first_asked = {
            s: c
            for s, c in (
                await db.execute(
                    select(AgentMessage.session_id, AgentMessage.content).join(
                        firsts, firsts.c.mid == AgentMessage.id
                    )
                )
            ).all()
        }
    return [
        ConversationOut(
            id=r[0].id,
            title=r[0].title,
            agent_id=r[0].agent_id,
            agent_name=r[1],
            messages=int(r.messages or 0),
            asked=int(r.asked or 0),
            first_at=r.first_at.isoformat(),
            last_at=r.last_at.isoformat(),
            first_message=_clip(first_asked.get(r[0].id), 200),
            tokens=int(r.tokens or 0),
            cost_usd=round(float(r.cost or 0), 6),
        )
        for r in rows
    ]


class ChatLine(BaseModel):
    id: int
    role: str  # user | assistant
    content: str
    at: str


class ConversationDetailOut(BaseModel):
    id: str
    title: str
    agent_id: str
    agent_name: str | None
    lines: list[ChatLine]
    more: bool  # older messages were left out (the newest MAX_LINES are shown)


MAX_LINES = 500


@router.get("/{user_id}/conversations/{session_id}")
async def person_conversation(
    user_id: str,
    session_id: str,
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> ConversationDetailOut:
    """P114: one conversation: what the person and the AI wrote (text only, never tool calls or
    their arguments), oldest first. Audited."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    s = await db.get(ChatSession, session_id)
    if s is None or s.workspace_id != ws.id or s.user_id != user_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "That conversation is not here.")
    rows = list(
        (
            await db.scalars(
                select(AgentMessage)
                .where(
                    AgentMessage.session_id == s.id,
                    AgentMessage.role.in_(("user", "assistant")),
                    AgentMessage.content.is_not(None),
                    AgentMessage.content != "",
                )
                .order_by(AgentMessage.id.desc())
                .limit(MAX_LINES + 1)
            )
        ).all()
    )
    more = len(rows) > MAX_LINES
    rows = list(reversed(rows[:MAX_LINES]))
    a = await db.get(Agent, s.agent_id)
    await _viewed(db, principal, "ai_usage.conversation_viewed", user_id, session_id=s.id)
    return ConversationDetailOut(
        id=s.id,
        title=s.title,
        agent_id=s.agent_id,
        agent_name=a.name if a is not None else None,
        lines=[
            ChatLine(
                id=m.id,
                role=m.role,
                content=(m.content or "")[:FULL],
                at=m.created_at.isoformat(),
            )
            for m in rows
        ],
        more=more,
    )


class PaidTaskOut(BaseModel):
    task_id: str
    title: str
    status: str | None
    brief: str | None
    agent_name: str | None
    created_at: str | None
    calls: int
    tokens: int
    cost_usd: float
    last_at: str


TASK_SORTS = ("tokens", "cost", "calls", "last", "title")


@router.get("/{user_id}/tasks")
async def person_tasks(
    user_id: str,
    response: Response,
    params: TableParams = Depends(),
    period: PeriodParams = Depends(),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> list[PaidTaskOut]:
    """P114: the tasks the person's AI use paid for in the period, most tokens first, with what
    they asked (the brief). Search: the title, brief or result."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    await _person(db, ws, user_id)
    key, desc = params.sort_by(TASK_SORTS, "-tokens")
    agg = (
        select(
            LLMCall.task_id.label("tid"),
            func.count().label("calls"),
            func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0).label(
                "tokens"
            ),
            func.coalesce(func.sum(LLMCall.cost_usd), 0).label("cost"),
            func.max(LLMCall.ts).label("last_at"),
        )
        .where(*_in(w, ws.id), _who(user_id), LLMCall.task_id.is_not(None))
        .group_by(LLMCall.task_id)
        .subquery()
    )
    where: list[ColumnElement[bool]] = []
    for word in params.words:
        pat = like(word)
        where.append(
            or_(
                Task.title.ilike(pat, escape="\\"),
                Task.brief.ilike(pat, escape="\\"),
                Task.result.ilike(pat, escape="\\"),
            )
        )
    base = (
        select(agg, Task.title, Task.status, Task.brief, Task.created_at, Agent.name)
        .join(Task, Task.id == agg.c.tid)
        .outerjoin(Agent, Agent.id == Task.assignee_agent_id)
        .where(Task.workspace_id == ws.id, *where)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    response.headers[TOTAL] = str(int(total or 0))
    cols = {
        "tokens": agg.c.tokens,
        "cost": agg.c.cost,
        "calls": agg.c.calls,
        "last": agg.c.last_at,
        "title": Task.title,
    }
    col = cols[key]
    rows = (
        await db.execute(
            base.order_by(col.desc() if desc else col.asc(), agg.c.tid)
            .offset(params.offset)
            .limit(params.size if params.paged else 25)
        )
    ).all()
    return [
        PaidTaskOut(
            task_id=r.tid,
            title=r.title,
            status=r.status,
            brief=_clip(r.brief, 300),
            agent_name=r.name,
            created_at=r.created_at.isoformat() if r.created_at else None,
            calls=int(r.calls or 0),
            tokens=int(r.tokens or 0),
            cost_usd=round(float(r.cost or 0), 6),
            last_at=r.last_at.isoformat(),
        )
        for r in rows
    ]


# ---------------------------------------------------------------- P114: the report as a file

EXPORT_CALLS = 20_000  # calls in one file, newest first
EXPORT_TEXT = 5_000  # characters of what was asked or answered, per cell
CHUNK = 500


def _xlsx_name(text: str) -> str:
    keep = "".join(ch if ch.isalnum() or ch in " -_" else " " for ch in text).strip()
    return "-".join(keep.split())[:60] or "report"


@router.get("/{user_id}/report.xlsx")
async def person_report_file(
    user_id: str,
    period: PeriodParams = Depends(),
    principal: Principal = Depends(require_usage_reader),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """P114 (Fitri, 18 Nov 2026): one person's whole report for the period as an Excel file:
    Summary, By feature, By purpose, By agent, By model, By day and Calls (each call with what
    was asked and what came back, newest first, up to 20,000). Recorded in the audit log."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    rep = await person_usage(user_id, period, principal, db)
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    where = (*_in(w, ws.id), _who(user_id))
    chat = _chat_call()
    asked_id = case((chat, _asked(Msg.id)), else_=None).label("asked_id")
    rows = (
        await db.execute(
            select(LLMCall, asked_id)
            .where(*where)
            .order_by(LLMCall.ts.desc(), LLMCall.id.desc())
            .limit(EXPORT_CALLS)
        )
    ).all()
    events: list[EventOut] = []
    for i in range(0, len(rows), CHUNK):
        part = rows[i : i + CHUNK]
        events += await _events_page(
            db, ws, [r[0] for r in part], {r[0].id: r[1] for r in part}, EXPORT_TEXT
        )
    await _viewed(
        db, principal, "ai_usage.report_downloaded", user_id, period=w.key, calls=len(events)
    )

    zone = ZoneInfo(ws.timezone or "Asia/Kuala_Lumpur")
    bold = Font(bold=True)
    book = Workbook()

    def sheet(title: str, head: list[str], body: list[list[Any]], first: bool = False) -> None:
        sh = book.active if first else book.create_sheet()
        assert sh is not None
        sh.title = title
        sh.append(head)
        for c in sh[1]:
            c.font = bold
        for line in body:
            sh.append(line)
        sh.freeze_panes = "A2"
        for i, h in enumerate(head, start=1):
            width = max([len(str(h))] + [len(str(x[i - 1] or "")) for x in body[:200]])
            sh.column_dimensions[get_column_letter(i)].width = max(10, min(60, width + 2))

    who = rep.person
    name = who.name or "The office's own work"
    pr = rep.period
    sheet(
        "Summary",
        ["Item", "Value"],
        [
            ["Person", name],
            ["Email", who.email],
            ["Role", who.role],
            ["Company", who.branch_name or ""],
            ["Department", who.department_name or ""],
            ["Period", f"{pr['start']} to {pr['end']} ({pr['days']} days, {pr['timezone']})"],
            ["Calls", rep.totals.calls],
            ["Failed calls", rep.totals.errors],
            ["Tokens in", rep.totals.prompt],
            ["Tokens out", rep.totals.completion],
            ["Tokens (total)", rep.totals.tokens],
            ["Cached tokens", rep.totals.cached],
            ["Cost (USD)", round(rep.totals.cost_usd, 4)],
            ["Calls with no model price", rep.totals.unpriced],
            ["Tasks worked on", rep.tasks],
            ["First used", rep.first_used or ""],
            ["Last used", rep.last_used or ""],
            ["Used today (allowance)", who.today_used],
            ["Today's limit", "No limit" if who.today_limit is None else who.today_limit],
            ["Calls in this file", len(events)],
        ],
        first=True,
    )
    sums = ["Calls", "Failed", "Tokens in", "Tokens out", "Tokens", "Cost (USD)"]

    def nums(x: Sums) -> list[Any]:
        return [x.calls, x.errors, x.prompt, x.completion, x.tokens, round(x.cost_usd, 4)]

    sheet("By feature", ["Feature", *sums], [[f.feature, *nums(f)] for f in rep.by_feature])
    sheet(
        "By purpose",
        ["Purpose", "Feature", "Counts to allowance", *sums],
        [[x.purpose, x.feature, "yes" if x.charged else "no", *nums(x)] for x in rep.by_purpose],
    )
    sheet("By agent", ["Agent", *sums], [[x.name or "(no agent)", *nums(x)] for x in rep.by_agent])
    sheet(
        "By model",
        ["Provider", "Model", "Group", *sums],
        [[x.provider, x.model, x.group or "", *nums(x)] for x in rep.by_model],
    )
    sheet(
        "By day",
        ["Day", "Calls", "Tokens", "Cost (USD)"],
        [[d.day, d.calls, d.tokens, round(d.cost_usd, 4)] for d in rep.daily],
    )

    def local(ts: str) -> str:
        return datetime.fromisoformat(ts).astimezone(zone).strftime("%Y-%m-%d %H:%M:%S")

    sheet(
        "Calls",
        [
            "When",
            "Feature",
            "Purpose",
            "Agent",
            "Task",
            "Source",
            "Conversation",
            "What they asked",
            "What came back",
            "Model",
            "Tokens in",
            "Tokens out",
            "Tokens",
            "Cost (USD)",
            "Status",
            "Seconds",
        ],
        [
            [
                local(e.ts),
                e.feature,
                e.purpose,
                e.agent_name or "",
                e.task_title or "",
                {"task": "Task", "chat": "Chat (matched by time)"}.get(e.source or "", ""),
                e.session_title or "",
                e.asked or "",
                e.answered or "",
                e.model,
                e.prompt,
                e.completion,
                e.tokens,
                e.cost_usd if e.cost_usd is not None else "",
                e.status if not e.error_class else f"{e.status} ({e.error_class})",
                round(e.latency_ms / 1000, 1),
            ]
            for e in events
        ],
    )
    buf = BytesIO()
    book.save(buf)
    file = f"AI-usage-{_xlsx_name(name)}-{pr['start']}-{pr['end']}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file}"'},
    )
