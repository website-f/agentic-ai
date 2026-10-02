"""Who sees which agents and work (P9 office roles).

Workspace roles (owner, admin, operator, approver, viewer) see everything. Office roles see
a slice: a branch manager their branch, a HOD and a supervisor their department, staff the
agents they own. Everyone also sees their own personal agents and the tasks they created.
Tasks follow their agent; approvals follow the agent that asked.

Every list is filtered in SQL with `agent_where` / `task_where`; every single-row read and
write checks `sees_agent` / `sees_task` / `manages_agent`, and answers 404 when the row is
outside the scope (so a scoped user cannot probe what exists elsewhere).
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, false, or_, select

from ..core.security import SCOPED_ROLES
from ..models import Agent, Approval, Task


@dataclass(frozen=True)
class Scope:
    kind: str  # all | branch | department | own
    user_id: str
    branch_id: str | None = None
    department_id: str | None = None

    @classmethod
    def of(
        cls, role: str, user_id: str, branch_id: str | None, department_id: str | None
    ) -> "Scope":
        if role not in SCOPED_ROLES:
            return cls("all", user_id)
        if role == "branch_manager":
            return cls("branch", user_id, branch_id, department_id)
        if role in ("hod", "supervisor"):
            return cls("department", user_id, branch_id, department_id)
        return cls("own", user_id, branch_id, department_id)

    @property
    def everything(self) -> bool:
        return self.kind == "all"

    @property
    def actor(self) -> str:
        return f"user:{self.user_id}"

    @property
    def label(self) -> str:
        return {
            "all": "the whole workspace",
            "branch": "your branch",
            "department": "your department",
            "own": "your own agents",
        }[self.kind]

    # ------------------------------------------------------------ agents

    def agent_where(self) -> ColumnElement[bool] | None:
        """SQL condition on Agent, or None for no filter."""
        if self.everything:
            return None
        mine = Agent.owner_user_id == self.user_id
        if self.kind == "branch":
            return or_(Agent.branch_id == self.branch_id, mine) if self.branch_id else mine
        if self.kind == "department":
            return (
                or_(Agent.department_id == self.department_id, mine) if self.department_id else mine
            )
        return mine

    def sees_agent(self, a: Agent | None) -> bool:
        if a is None:
            return False
        if self.everything or a.owner_user_id == self.user_id:
            return True
        if self.kind == "branch":
            return bool(self.branch_id) and a.branch_id == self.branch_id
        if self.kind == "department":
            return bool(self.department_id) and a.department_id == self.department_id
        return False

    def manages_agent(self, a: Agent, role_perms: frozenset[str] | list[str]) -> bool:
        """May change this agent: agents.manage inside the scope, or agents.own for one's own."""
        if "agents.manage" in role_perms and self.sees_agent(a):
            return True
        return "agents.own" in role_perms and a.owner_user_id == self.user_id

    def placement_ok(self, branch_id: str, department_id: str | None) -> bool:
        """Where a new or moved agent may go."""
        if self.everything:
            return True
        if self.kind == "branch":
            return branch_id == self.branch_id
        if self.kind == "department":
            return department_id is not None and department_id == self.department_id
        return True  # personal agents may sit anywhere; they stay the owner's

    # ------------------------------------------------------------ tasks and approvals

    def _visible_agent_ids(self) -> Any:
        cond = self.agent_where()
        return select(Agent.id).where(cond if cond is not None else false())

    def task_where(self) -> ColumnElement[bool] | None:
        if self.everything:
            return None
        parts: list[ColumnElement[bool]] = [
            Task.assignee_agent_id.in_(self._visible_agent_ids()),
            Task.created_by == self.actor,
        ]
        if self.kind == "branch" and self.branch_id:
            parts.append(Task.branch_id == self.branch_id)  # unassigned work in the branch
        return or_(*parts)

    def sees_task(self, t: Task, agent: Agent | None) -> bool:
        if self.everything or t.created_by == self.actor:
            return True
        if agent is not None and self.sees_agent(agent):
            return True
        return self.kind == "branch" and bool(self.branch_id) and t.branch_id == self.branch_id

    def approval_where(self) -> ColumnElement[bool] | None:
        if self.everything:
            return None
        return Approval.agent_id.in_(self._visible_agent_ids())

    # ------------------------------------------------------------ live events

    def event_visible(self, type_: str, data: dict[str, Any], agent_ids: set[str]) -> bool:
        """Live events: an agent's events reach the people who see that agent; office
        knowledge (brain, skills) reaches everyone; workspace plumbing (deliveries, incidents,
        job runs, broadcasts) only the workspace roles."""
        if self.everything:
            return True
        if type_ in KNOWLEDGE_EVENTS:
            return True
        aid = data.get("agent_id") or data.get("assignee_agent_id")
        if aid:
            return aid in agent_ids
        parts = data.get("participants")
        if isinstance(parts, list):
            return any(p in agent_ids for p in parts)
        return False


KNOWLEDGE_EVENTS = frozenset(
    {"brain.page", "brain.dream", "skill.proposal", "skill.updated", "skill.used"}
)


def visible_agent_ids_sync(rows: list[Agent], scope: Scope) -> set[str]:
    return {a.id for a in rows if scope.sees_agent(a)}


async def member_scope(db: Any, workspace_id: str, user_id: str) -> Scope | None:
    """The scope of a member found by id (phone buttons, Telegram), or None if not one."""
    from ..models import Membership

    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        return None
    return Scope.of(m.role, user_id, m.branch_id, m.department_id)


async def member_sees_agent(db: Any, workspace_id: str, user_id: str, agent_id: str) -> bool:
    sc = await member_scope(db, workspace_id, user_id)
    return sc is not None and sc.sees_agent(await db.get(Agent, agent_id))
