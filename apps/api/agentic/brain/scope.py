"""Who can see which memories.

An agent sees: workspace-wide items, its own private facts, and items from its branch.
Branches that are not isolated share with each other (one group of companies); an isolated
branch shares with nobody, and its agents see no other branch's memories.
People in the workspace see everything.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Branch


@dataclass(frozen=True)
class Viewer:
    workspace_id: str
    agent_id: str | None = None  # None = a person (sees everything)
    branch_ids: frozenset[str] | None = None  # None = all branches


async def for_agent(db: AsyncSession, agent: Agent) -> Viewer:
    own = await db.get(Branch, agent.branch_id)
    if own is None or own.isolated:
        ids = frozenset({agent.branch_id})
    else:
        ids = frozenset(
            (
                await db.scalars(
                    select(Branch.id).where(
                        Branch.workspace_id == agent.workspace_id, Branch.isolated.is_(False)
                    )
                )
            ).all()
        )
    # A helper (P9) remembers what its original remembers.
    return Viewer(agent.workspace_id, agent.clone_of or agent.id, ids)


def for_people(workspace_id: str) -> Viewer:
    return Viewer(workspace_id)
