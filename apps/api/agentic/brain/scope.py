"""Who can see which memories.

An agent sees: workspace-wide items, its own private facts, and items from its branch.
Branches that are not isolated share with each other (one group of companies); an isolated
branch shares with nobody, and its agents see no other branch's memories.
People see what their role sees (P29, `for_person`): the facts and conversations of the
agents they see (never someone else's private assistant), and office roles only their own
company's memories, by the same isolation rule as its agents.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Branch


@dataclass(frozen=True)
class Viewer:
    workspace_id: str
    agent_id: str | None = None  # None = a person (sees everything)
    branch_ids: frozenset[str] | None = None  # None = all branches
    # P29: a person's agents: whose private facts and conversations they may see. None = all.
    agent_ids: frozenset[str] | None = None


async def _branches(db: AsyncSession, workspace_id: str, branch_id: str | None) -> frozenset[str]:
    """The branches whose memories someone in `branch_id` shares: all the non-isolated ones,
    or only its own when it is isolated."""
    if not branch_id:
        return frozenset()
    own = await db.get(Branch, branch_id)
    if own is None or own.isolated:
        return frozenset({branch_id})
    return frozenset(
        (
            await db.scalars(
                select(Branch.id).where(
                    Branch.workspace_id == workspace_id, Branch.isolated.is_(False)
                )
            )
        ).all()
    )


async def for_agent(db: AsyncSession, agent: Agent) -> Viewer:
    ids = await _branches(db, agent.workspace_id, agent.branch_id)
    # A helper (P9) remembers what its original remembers.
    return Viewer(agent.workspace_id, agent.clone_of or agent.id, ids)


def for_people(workspace_id: str) -> Viewer:
    """Everything in the workspace. For internal use (dedup, the dream); a person asking
    gets `for_person`."""
    return Viewer(workspace_id)


async def for_person(db: AsyncSession, workspace_id: str, scope: Any) -> Viewer:
    """P29: what a person (an api.scope.Scope) may recall. Workspace roles see every branch;
    office roles their company's share, like its agents. Private facts and past conversations
    follow the agents the person sees, so nobody but its owner reads a private assistant's."""
    agents = (await db.scalars(select(Agent).where(Agent.workspace_id == workspace_id))).all()
    ids = frozenset(a.id for a in agents if scope.sees_agent(a))
    if scope.everything:
        return Viewer(workspace_id, None, None, ids)
    return Viewer(workspace_id, None, await _branches(db, workspace_id, scope.branch_id), ids)


def sees_fact(v: Viewer, fact: Any) -> bool:
    """The single-row twin of facts.scope_filter (ended facts included)."""
    if fact.workspace_id != v.workspace_id:
        return False
    if fact.agent_id is not None:
        if v.agent_id is not None and fact.agent_id != v.agent_id:
            return False
        if v.agent_ids is not None and fact.agent_id not in v.agent_ids:
            return False
    return v.branch_ids is None or fact.branch_id is None or fact.branch_id in v.branch_ids
