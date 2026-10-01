"""Budgets (Paperclip pattern): an alert at 80 %, and at 100 % the agent stops and asks.

Usage comes from the llm_calls log (tokens per local day, cost per local month). A person
who approves the ask grants extra allowance for that day or month (budget_grants).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, AgentPing, BudgetGrant, LLMCall, Workspace
from ..services import events

ALERT_AT = 0.8
GRANT_SHARE = 0.5  # approving an ask adds half the limit again


@dataclass
class Periods:
    day: str  # 2026-10-01 (workspace local)
    month: str  # 2026-10
    day_start: datetime  # UTC
    month_start: datetime


def periods(tz: str, now: datetime | None = None) -> Periods:
    local = (now or datetime.now(UTC)).astimezone(ZoneInfo(tz))
    day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    month0 = day0.replace(day=1)
    return Periods(
        day0.strftime("%Y-%m-%d"),
        day0.strftime("%Y-%m"),
        day0.astimezone(UTC),
        month0.astimezone(UTC),
    )


@dataclass
class BudgetState:
    tokens_today: int
    usd_month: float
    token_limit: int | None  # including grants
    usd_limit: float | None
    periods: Periods

    @property
    def token_ratio(self) -> float:
        return self.tokens_today / self.token_limit if self.token_limit else 0.0

    @property
    def usd_ratio(self) -> float:
        return self.usd_month / self.usd_limit if self.usd_limit else 0.0

    @property
    def over(self) -> bool:
        return self.token_ratio >= 1 or self.usd_ratio >= 1

    @property
    def near(self) -> bool:
        return max(self.token_ratio, self.usd_ratio) >= ALERT_AT

    def reason(self, name: str) -> str:
        if self.token_limit and self.token_ratio >= 1:
            return (
                f"{name} used {self.tokens_today:,} of its {self.token_limit:,} tokens for today. "
                "Approve to allow half its daily limit again for today."
            )
        limit = self.usd_limit or 0
        return (
            f"{name} spent ${self.usd_month:,.2f} of its ${limit:,.2f} for this month. "
            "Approve to allow half as much again this month."
        )

    def dict(self) -> dict:
        return {
            "tokens_today": self.tokens_today,
            "token_limit": self.token_limit,
            "usd_month": round(self.usd_month, 4),
            "usd_limit": self.usd_limit,
            "token_ratio": round(self.token_ratio, 3),
            "usd_ratio": round(self.usd_ratio, 3),
            "over": self.over,
            "near": self.near,
            "day": self.periods.day,
            "month": self.periods.month,
        }


async def state(db: AsyncSession, agent: Agent, tz: str) -> BudgetState:
    p = periods(tz)
    tokens = (
        await db.scalar(
            select(
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0)
            ).where(LLMCall.agent_id == agent.id, LLMCall.ts >= p.day_start)
        )
        or 0
    )
    usd = await db.scalar(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0)).where(
            LLMCall.agent_id == agent.id, LLMCall.ts >= p.month_start
        )
    ) or Decimal(0)
    grants = (
        await db.execute(
            select(
                BudgetGrant.period,
                func.sum(BudgetGrant.extra_tokens),
                func.sum(BudgetGrant.extra_usd),
            )
            .where(BudgetGrant.agent_id == agent.id, BudgetGrant.period_key.in_((p.day, p.month)))
            .group_by(BudgetGrant.period)
        )
    ).all()
    extra_tokens = sum(int(t or 0) for period, t, _ in grants if period == "day")
    extra_usd = sum(float(u or 0) for period, _, u in grants if period == "month")
    token_limit = agent.budget_daily_tokens + extra_tokens if agent.budget_daily_tokens else None
    usd_limit = (
        float(agent.budget_monthly_usd) + extra_usd
        if agent.budget_monthly_usd is not None
        else None
    )
    return BudgetState(int(tokens), float(usd), token_limit, usd_limit, p)


async def grant(db: AsyncSession, agent: Agent, st: BudgetState, actor: str) -> None:
    now = datetime.now(UTC)
    if agent.budget_daily_tokens and st.token_ratio >= 1:
        db.add(
            BudgetGrant(
                agent_id=agent.id,
                period="day",
                period_key=st.periods.day,
                extra_tokens=int(agent.budget_daily_tokens * GRANT_SHARE),
                granted_by=actor,
                created_at=now,
            )
        )
    if agent.budget_monthly_usd is not None and st.usd_ratio >= 1:
        db.add(
            BudgetGrant(
                agent_id=agent.id,
                period="month",
                period_key=st.periods.month,
                extra_usd=float(agent.budget_monthly_usd) * GRANT_SHARE,
                granted_by=actor,
                created_at=now,
            )
        )
    await db.commit()


async def ping_once(
    db: AsyncSession, agent: Agent, kind: str, period_key: str, message: str
) -> bool:
    """One ping per agent, kind and period (unique key). Returns True if this call created it."""
    seen = await db.scalar(
        select(AgentPing.id).where(
            AgentPing.agent_id == agent.id,
            AgentPing.kind == kind,
            AgentPing.period_key == period_key,
        )
    )
    if seen is not None:
        return False
    try:
        async with db.begin_nested():
            db.add(
                AgentPing(
                    workspace_id=agent.workspace_id,
                    agent_id=agent.id,
                    kind=kind,
                    message=message,
                    period_key=period_key,
                    created_at=datetime.now(UTC),
                )
            )
            await db.flush()
    except IntegrityError:
        return False
    await db.commit()
    await events.publish(
        agent.workspace_id, "agent.ping", {"agent_id": agent.id, "kind": kind, "message": message}
    )
    return True


async def alert_if_near(db: AsyncSession, agent: Agent, ws: Workspace, st: BudgetState) -> None:
    if not st.near or st.over:
        return
    pct = round(max(st.token_ratio, st.usd_ratio) * 100)
    key = st.periods.day if st.token_ratio >= st.usd_ratio else st.periods.month
    when = "today" if key == st.periods.day else "this month"
    msg = f"{agent.name} has used {pct}% of its budget ({when})."
    if await ping_once(db, agent, "budget_alert", key, msg):
        from ..channels import deliver  # late: channels import the agents package

        await deliver.start(
            await deliver.notify_people(
                db,
                ws.id,
                f"{agent.name}: budget at {pct}%",
                msg,
                f"/agents/{agent.id}?tab=team",
                dedupe=f"budget:{agent.id}:{key}",
            )
        )
