"""Deterministic policy for every tool call. The model never decides alone.

Order (first match wins):
1. Hardline rules: unknown or globally denied tool, oversized arguments, URLs pointing
   at private or internal addresses. Nothing overrides these, including autonomy "auto".
2. The agent's own mode for the tool: deny | ask | allow (tool default if unset).
3. Autonomy "auto" turns ask into allow, except for high-risk tools.
"""

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..api.scope import Scope
from ..core.security import can
from ..models import Agent, Membership
from .tools import GLOBAL_DENY, TOOLS, check_url_arg

MAX_ARGS_CHARS = 20_000
# Outward actions a person signs off every time, whatever an agent's settings say.
ALWAYS_ASK = frozenset({"browser_submit"})
# Tools whose approver is the person asking: when someone who could approve the agent's
# requests asks for it directly in chat ("every Monday 9am send me the report"), that request
# is the approval. Anywhere else (a task, an email the agent read) a person approves it,
# even on autonomy "auto". An explicit "allow" or "deny" on the agent still wins.
PERSON_APPROVES = frozenset({"schedule_task"})
# Tools whose results carry text written by someone else (mail, pages, files, outside tools).
# After one of these runs in a chat turn, "the person asked for it" can no longer be told
# apart from "the text the agent just read asked for it", so PERSON_APPROVES tools wait for
# the person's own confirmation in their next message.
OUTSIDE_CONTENT = frozenset(
    {
        "email_read",
        "email_search",
        "web_fetch",
        "web_search",
        "read_file",
        "view_image",
        "tool_call",
        "calendar_agenda",
        "search_library",
        "browser_open",
        "browser_read",
        "browser_check",
    }
)


@dataclass(frozen=True)
class Decision:
    effect: str  # allow | ask | deny
    rule: str
    reason: str
    hardline: bool = False


async def chat_approver(db: AsyncSession, agent: Agent, user_id: str | None) -> str | None:
    """The person chatting, if they could approve this agent's requests anyway: its owner, or
    someone allowed to decide approvals who sees the agent. Else None."""
    if not user_id:
        return None
    if agent.owner_user_id == user_id:
        return user_id
    m = await db.get(Membership, (agent.workspace_id, user_id))
    if m is None or not can(m.role, "approvals.decide"):
        return None
    scope = Scope.of(m.role, user_id, m.branch_id, m.department_id)
    return user_id if scope.sees_agent(agent) else None


async def evaluate(
    agent: Agent, tool_name: str, args: dict[str, Any], *, asked_by: str | None = None
) -> Decision:
    """asked_by: in chat, the person talking to the agent when they may approve for it
    (chat_approver); it counts as the approval for PERSON_APPROVES tools."""
    tool = TOOLS.get(tool_name)
    if tool is None:
        return Decision(
            "deny", "hardline.unknown_tool", f"There is no tool called {tool_name}.", True
        )
    if tool_name in GLOBAL_DENY:
        return Decision(
            "deny", "hardline.global_deny", f"{tool.label} is disabled for everyone.", True
        )
    if len(json.dumps(args, default=str)) > MAX_ARGS_CHARS:
        return Decision("deny", "hardline.args_too_large", "The request was too large.", True)
    for arg in tool.url_args:
        problem = await check_url_arg(args.get(arg, ""))
        if problem:
            return Decision("deny", "hardline.internal_address", problem, True)

    if tool_name in ALWAYS_ASK:
        return Decision(
            "ask", f"hardline.{tool_name}", f"{tool.label} always waits for a person.", True
        )
    mode = (agent.tools or {}).get(tool_name, tool.default_mode)
    if mode == "deny":
        return Decision(
            "deny", f"agent.{tool_name}=deny", f"{agent.name} is not allowed to use {tool.label}."
        )
    if mode == "allow":
        return Decision("allow", f"agent.{tool_name}=allow", "Allowed for this agent.")
    if tool_name in PERSON_APPROVES:
        if asked_by:
            return Decision(
                "allow", "chat.person_asked", "The person asked for it directly in chat."
            )
        return Decision(
            "ask", f"agent.{tool_name}=ask", f"{tool.label} needs the person's OK for {agent.name}."
        )
    if agent.autonomy == "auto" and tool.risk != "high":
        return Decision("allow", "autonomy.auto", "Agent runs on auto for non-high-risk tools.")
    return Decision(
        "ask", f"agent.{tool_name}=ask", f"{tool.label} needs approval for {agent.name}."
    )
