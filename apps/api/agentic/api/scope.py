"""Who sees which agents and work (P9 office roles).

Workspace roles (owner, admin, operator, approver, viewer) see everything. Office roles see
a slice: a branch manager their branch, a HOD and a supervisor their department, staff the
agents they own. Everyone also sees their own personal agents and the tasks they created.
Tasks follow their agent; approvals follow the agent that asked.

Two more rules (P16):
- A private agent (someone's personal assistant) is seen only by its owner: not by admins,
  not by the workspace owner, not in lists, the office, tasks, approvals or live events.
- Seeing is not the same as watching: staff *watch* the other (non-private) agents of their
  branch work (`observe_where` / `observes_agent`: lists, office floor, live activity) but
  act only on what they see (`sees_agent`: chat, tasks, approvals, settings).

Every list is filtered in SQL with `agent_where` / `task_where`; every single-row read and
write checks `sees_agent` / `sees_task` / `manages_agent`, and answers 404 when the row is
outside the scope (so a scoped user cannot probe what exists elsewhere).
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, and_, or_, select, true

from ..core.security import SCOPED_ROLES
from ..i18n import Msg
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
        """For sentences ("Pick an agent from {where}."): English, translated with them."""
        return Msg(
            {
                "all": "the whole workspace",
                "branch": "your branch",
                "department": "your department",
                "own": "your own agents",
            }[self.kind]
        )

    # ------------------------------------------------------------ agents

    def _open(self) -> ColumnElement[bool]:
        """Not someone else's private assistant."""
        return or_(Agent.private.is_(False), Agent.owner_user_id == self.user_id)

    def agent_where(self) -> ColumnElement[bool]:
        """SQL condition on Agent: the agents this person sees and acts on."""
        mine = Agent.owner_user_id == self.user_id
        if self.everything:
            return self._open()
        if self.kind == "branch":
            base = or_(Agent.branch_id == self.branch_id, mine) if self.branch_id else mine
        elif self.kind == "department":
            base = (
                or_(Agent.department_id == self.department_id, mine) if self.department_id else mine
            )
        else:
            base = mine
        return and_(base, self._open())

    def observe_where(self) -> ColumnElement[bool]:
        """The agents this person may watch working: what they see, plus (for staff) the
        rest of their branch's office."""
        if self.kind != "own":
            return self.agent_where()
        mine = Agent.owner_user_id == self.user_id
        office = Agent.branch_id == self.branch_id if self.branch_id else true()
        return and_(or_(mine, office), self._open())

    def observes_agent(self, a: Agent | None) -> bool:
        if a is None or (a.private and a.owner_user_id != self.user_id):
            return False
        if self.sees_agent(a):
            return True
        return self.kind == "own" and (not self.branch_id or a.branch_id == self.branch_id)

    def sees_agent(self, a: Agent | None) -> bool:
        if a is None:
            return False
        if a.private and a.owner_user_id != self.user_id:
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
        return select(Agent.id).where(self.agent_where())

    def _others_private_ids(self) -> Any:
        return select(Agent.id).where(
            Agent.private.is_(True),
            or_(Agent.owner_user_id.is_(None), Agent.owner_user_id != self.user_id),
        )

    def task_where(self) -> ColumnElement[bool] | None:
        if self.everything:  # everything but other people's assistants' work
            return or_(
                Task.assignee_agent_id.is_(None),
                Task.assignee_agent_id.not_in(self._others_private_ids()),
                Task.created_by == self.actor,
            )
        parts: list[ColumnElement[bool]] = [
            Task.assignee_agent_id.in_(self._visible_agent_ids()),
            Task.created_by == self.actor,
        ]
        if self.kind == "branch" and self.branch_id:
            parts.append(Task.branch_id == self.branch_id)  # unassigned work in the branch
        return or_(*parts)

    def sees_task(self, t: Task, agent: Agent | None) -> bool:
        if t.created_by == self.actor:
            return True
        if agent is not None and agent.private and agent.owner_user_id != self.user_id:
            return False
        if self.everything:
            return True
        if agent is not None and self.sees_agent(agent):
            return True
        return self.kind == "branch" and bool(self.branch_id) and t.branch_id == self.branch_id

    def approval_where(self) -> ColumnElement[bool] | None:
        if self.everything:
            return Approval.agent_id.not_in(self._others_private_ids())
        return Approval.agent_id.in_(self._visible_agent_ids())

    # ------------------------------------------------------------ live events

    def event_visible(
        self,
        type_: str,
        data: dict[str, Any],
        agent_ids: set[str],
        watched: frozenset[str] | set[str] = frozenset(),
    ) -> bool:
        """Live events: an agent's events reach the people who see that agent; office
        knowledge (brain, skills) reaches everyone; workspace plumbing (deliveries, incidents,
        job runs, broadcasts) only the workspace roles."""
        if type_ in KNOWLEDGE_EVENTS:
            return True
        aid = data.get("agent_id") or data.get("assignee_agent_id")
        if aid:
            return aid in agent_ids or (type_ in WATCH_EVENTS and aid in watched)
        if self.everything:
            return True
        parts = data.get("participants")
        if isinstance(parts, list):
            return any(p in agent_ids for p in parts)
        return False


# What watching an agent shows: that it is working and on what step, not its tasks' contents.
WATCH_EVENTS = frozenset({"agent.status", "agent.thinking", "agent.activity", "agent.upsert"})

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
