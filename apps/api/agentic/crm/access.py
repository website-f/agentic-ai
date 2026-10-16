"""P35: who sees which parties, deals and money.

People
- Parties and deals: everyone with `read` sees the shared ones (branch_id None); workspace
  roles see every company's, office roles their own company's. Creating and changing them
  needs `work.write` in that company; archiving needs `agents.manage` or `org.manage`.
- Money (invoices, bills, payments, reminders): `finance.view` / `finance.manage` only.
  Owner and admin see every company; a branch manager only their own company. Everyone else
  never sees an amount (party balances and money on timelines are left out for them).

Agents
- Every agent reads its own company's parties and the shared ones (the CRM tools).
- The money tools (MONEY_TOOLS) are offered only to an agent in a finance department (a
  department named like finance / accounts / kewangan / akaun), or to one a person gave the
  tool to explicitly (its mode set on the agent). Approving, paying and voiding are never
  tools: people only.
"""

import re
from typing import Any

from sqlalchemy import ColumnElement, false, or_, true
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import can
from ..models import Agent, Deal, Department, MoneyDoc, Party

FINANCE_DEPT = re.compile(r"financ|account|kewangan|akaun", re.I)

MONEY_TOOLS = frozenset(
    {
        "list_money",
        "money_summary",
        "aging_report",
        "cashflow_forecast",
        "create_invoice_draft",
        "capture_bill",
        "draft_payment_reminder",
    }
)


# ---------------------------------------------------------------- people: parties and deals


def company_where(model: Any, branch_id: str | None) -> ColumnElement[bool]:
    """Rows a company (an agent's, a mailbox's) may use: its own and the shared ones."""
    if branch_id:
        return or_(model.branch_id.is_(None), model.branch_id == branch_id)
    return model.branch_id.is_(None)


def party_where(principal: Any, model: Any = Party) -> ColumnElement[bool]:
    sc = principal.scope
    if sc.everything:
        return true()
    return company_where(model, sc.branch_id)


def sees_branch(principal: Any, branch_id: str | None) -> bool:
    sc = principal.scope
    return sc.everything or branch_id is None or branch_id == sc.branch_id


def sees_party(principal: Any, p: Party | Deal | None) -> bool:
    return (
        p is not None
        and p.workspace_id == principal.workspace_id
        and sees_branch(principal, p.branch_id)
    )


def may_write(principal: Any, branch_id: str | None) -> bool:
    return can(principal.role, "work.write") and sees_branch(principal, branch_id)


def may_archive(principal: Any, branch_id: str | None) -> bool:
    return (
        can(principal.role, "agents.manage") or can(principal.role, "org.manage")
    ) and sees_branch(principal, branch_id)


# ---------------------------------------------------------------- people: money


def has_finance(principal: Any, manage: bool = False) -> bool:
    return can(principal.role, "finance.manage" if manage else "finance.view")


def finance_where(principal: Any, model: Any = MoneyDoc) -> ColumnElement[bool]:
    """The money rows this person may see (false() when none)."""
    if not has_finance(principal):
        return false()
    sc = principal.scope
    if sc.everything:
        return true()
    return model.branch_id == sc.branch_id if sc.branch_id else false()


def finance_sees(principal: Any, branch_id: str | None) -> bool:
    if not has_finance(principal) or not branch_id:
        return False
    sc = principal.scope
    return sc.everything or branch_id == sc.branch_id


# ---------------------------------------------------------------- agents


def explicit_money(agent: Agent, name: str) -> bool:
    """A person gave this agent the tool on purpose (its mode set to allow or ask)."""
    return (agent.tools or {}).get(name) in ("allow", "ask")


async def finance_agent(db: AsyncSession, agent: Agent | None) -> bool:
    """An agent in a finance department (finance, accounts, kewangan, akaun)."""
    if agent is None or not agent.department_id:
        return False
    d = await db.get(Department, agent.department_id)
    return d is not None and bool(FINANCE_DEPT.search(d.name or ""))


async def money_ready(db: AsyncSession, agent: Agent | None) -> bool:
    return await finance_agent(db, agent)


async def has_money(agent: Agent | None, tool_name: str) -> bool:
    """For policy.evaluate (no session): may this agent use this money tool?"""
    if agent is None:
        return False
    if explicit_money(agent, tool_name):
        return True
    if not agent.department_id:
        return False
    from ..core.db import SessionLocal

    async with SessionLocal() as db:
        return await finance_agent(db, agent)


def agent_money_where(agent: Agent) -> ColumnElement[bool]:
    """An agent's money: its own company's only."""
    return MoneyDoc.branch_id == agent.branch_id if agent.branch_id else false()
