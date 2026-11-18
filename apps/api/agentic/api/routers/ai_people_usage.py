"""P113: AI usage per user, the developer's report (AI Engine > AI usage per user).

Read-only, from the model-call ledger (llm_calls, one row per model call attempt, written by
engine/store.record_call). Each row already says who the work was for (user_id, engine/
acting.py), what it was for (`task`, e.g. "agent.chat", "document.write"), the agent and task
when there was one, the provider, model and group, the tokens and the cost in USD (worked out
when the call was made from the model's prices in AI Engine > Models; None = unpriced).

Only the system's developer sees it (deps.require_developer, 403 for everyone else, owners and
admins included). No message contents: purposes, ids, task titles and agent names only.

- GET /api/ai/people-usage                     everyone, one row per person, for the period
                                               (?period=today|7d|30d|month|last_month|custom
                                               &start=&end= dates, &role= &branch= id | "none",
                                               ?q=&page=&size=&sort=, X-Total-Count)
- GET /api/ai/people-usage/{user_id}           one person's full report for the period
- GET /api/ai/people-usage/{user_id}/events    their calls, one page (?feature=&sort=)
`user_id` "office" is the work nobody asked for (routines, learning, the office's own jobs).
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, case, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Agent, Branch, Department, LLMCall, Membership, Task, User, Workspace
from ...teams import allowance
from ...teams.budget import periods
from ..deps import Principal, api_error, require_developer
from ..paging import TOTAL
from ..table import TableParams, like, matches, page_of
from .allowances import _grants

router = APIRouter(prefix="/api/ai/people-usage", tags=["ai-engine"])

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
    principal: Principal = Depends(require_developer),
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
            today_limit=None if lim is None else lim + grants.get(uid, 0),
        )

    everyone: list[PersonUsage] = []
    for m in members:
        if role and m.role != role:
            continue
        if branch and (m.branch_id or "none") != branch:
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
    if gone and not role and not branch:
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
            today_limit=None if base is None else base + (grant or 0),
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
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    """Everything one person's AI did in the period: by feature, purpose, agent, model, day."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    w = window(ws.timezone, period.period, period.start, period.end)
    who = await _person(db, ws, user_id)
    where = (*_in(w, ws.id), _who(user_id))

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


EVENT_SORTS = {
    "ts": LLMCall.ts,
    "tokens": LLMCall.prompt_tokens + LLMCall.completion_tokens,
    "cost": LLMCall.cost_usd,
}


@router.get("/{user_id}/events")
async def person_events(
    user_id: str,
    response: Response,
    params: TableParams = Depends(),
    period: PeriodParams = Depends(),
    feature: str | None = Query(default=None, max_length=24),
    principal: Principal = Depends(require_developer),
    db: AsyncSession = Depends(get_db),
) -> list[EventOut]:
    """One page of the person's model calls, newest first: when, what for, which agent and
    task, which model, tokens and cost. Never what was said."""
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
    for word in params.words:
        where.append(
            or_(
                LLMCall.task.ilike(like(word), escape="\\"),
                LLMCall.model.ilike(like(word), escape="\\"),
                LLMCall.provider_name.ilike(like(word), escape="\\"),
            )
        )
    total = await db.scalar(select(func.count()).select_from(LLMCall).where(*where))
    response.headers[TOTAL] = str(int(total or 0))
    col = EVENT_SORTS[key]
    sort_col = col.desc().nulls_last() if desc else col.asc().nulls_last()
    q = (
        select(LLMCall)
        .where(*where)
        .order_by(sort_col, LLMCall.id.desc() if desc else LLMCall.id.asc())
        .offset(params.offset)
        .limit(params.size if params.paged else 25)
    )
    calls = list((await db.scalars(q)).all())
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
    titles = (
        dict(
            (
                await db.execute(
                    select(Task.id, Task.title).where(
                        Task.id.in_(task_ids), Task.workspace_id == ws.id
                    )
                )
            ).all()
        )
        if task_ids
        else {}
    )
    return [
        EventOut(
            id=c.id,
            ts=c.ts.isoformat(),
            purpose=c.task,
            feature=feature_of(c.task),
            charged=charged(c.task),
            agent_id=c.agent_id,
            agent_name=agent_names.get(c.agent_id or ""),
            task_id=c.task_id,
            task_title=titles.get(c.task_id or ""),
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
        )
        for c in calls
    ]
