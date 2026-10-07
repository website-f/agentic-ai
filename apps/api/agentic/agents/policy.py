"""Deterministic policy for every tool call. The model never decides alone.

Order (first match wins):
1. Hardline rules: unknown or globally denied tool, oversized arguments, URLs pointing
   at private or internal addresses. Nothing overrides these, including autonomy "auto".
2. Tools the agent is never offered (P29, the same gating as runtime.offered_tools): a
   personal assistant's tools on any other agent, run_python without a sandbox, the browser
   without a browser service, the PC tools (P31) on anything but its person's own AI with a
   linked computer. Naming one does not run it.
3. A "deny" a person set on the agent (before ALWAYS_ASK, so it raises no approval card).
4. ALWAYS_ASK tools wait for a person.
5. The agent's own mode for the tool: deny | ask | allow (tool default if unset).
6. Autonomy "auto" turns ask into allow, except for high-risk tools.
research_gather with model-supplied seed_urls also needs whatever web_fetch needs (P29).
"""

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..api.scope import Scope
from ..assistants.names import ASSISTANT_ONLY
from ..core.config import settings
from ..core.security import can
from ..devices.core import PC_TOOLS, has_device, personal
from ..models import Agent, Membership
from .tools import FOLLOWS, GLOBAL_DENY, TOOLS, check_url_arg, mode_of

MAX_ARGS_CHARS = 20_000
# Outward actions a person signs off every time, whatever an agent's settings say.
ALWAYS_ASK = frozenset({"browser_submit", "browser_upload", "pc_save_to_pc"})
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
        "research_gather",
        "read_file",
        "view_image",
        "tool_call",
        "calendar_agenda",
        "search_library",
        "search_documents",
        "company_documents",
        "browser_open",
        "browser_read",
        "browser_check",
        "browser_snapshot",
        "browser_find",
        "browser_wait",
        # P29: these carry outside text too (a stored result, an MCP server's own words, a
        # meeting's transcript).
        "expand_result",
        "tool_search",
        "tool_describe",
        "meeting_minutes",
        # P31: names, paths and text from the person's own computer.
        "pc_find_files",
        "pc_list_folder",
        "pc_read_file",
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


def hidden(agent: Agent, tool_name: str) -> str | None:
    """Why the agent is never offered this tool (runtime.offered_tools), else None."""
    if tool_name in ASSISTANT_ONLY and not agent.private:
        return "only a person's own assistant has it"
    if tool_name == "run_python" and not settings.sandbox_url:
        return "there is no code sandbox on this server"
    if tool_name.startswith("browser_") and not settings.browser_url:
        return "there is no browser on this server"
    if tool_name in PC_TOOLS and not personal(agent):  # P31
        return "only a person's own AI (their twin or private assistant) uses their computer"
    return None


_STRICT = {"allow": 0, "ask": 1, "deny": 2}


def _explicit(agent: Agent, tool_name: str) -> str | None:
    """The mode a person set on this agent for the tool (or the tool it follows), if any."""
    tools = agent.tools or {}
    if tool_name in tools:
        return tools[tool_name]
    return tools.get(FOLLOWS.get(tool_name, ""))


async def evaluate(
    agent: Agent, tool_name: str, args: dict[str, Any], *, asked_by: str | None = None
) -> Decision:
    """asked_by: in chat, the person talking to the agent when they may approve for it
    (chat_approver); it counts as the approval for PERSON_APPROVES tools."""
    own = await _evaluate(agent, tool_name, args, asked_by=asked_by)
    seeds = args.get("seed_urls") if tool_name == "research_gather" else None
    if own.effect == "deny" or not seeds or not isinstance(seeds, list):
        return own
    # P29: pages the model picked itself are read like web_fetch reads them, so they need
    # what web_fetch needs for this agent (search results from the search provider do not).
    for url in seeds[:20]:
        fetch = await _evaluate(agent, "web_fetch", {"url": str(url)}, asked_by=asked_by)
        if _STRICT[fetch.effect] > _STRICT[own.effect]:
            reason = f"Reading pages you picked needs what web_fetch needs: {fetch.reason}"
            return Decision(
                fetch.effect, f"research_gather.seed_urls/{fetch.rule}", reason, fetch.hardline
            )
    return own


async def _evaluate(
    agent: Agent, tool_name: str, args: dict[str, Any], *, asked_by: str | None = None
) -> Decision:
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

    why = hidden(agent, tool_name)
    if not why and tool_name in PC_TOOLS and not await has_device(agent):
        why = "its person has no linked computer"
    if why:
        return Decision(
            "deny", f"hidden.{tool_name}", f"{agent.name} does not have {tool.label}: {why}."
        )
    mode = mode_of(agent.tools, tool_name)
    denied = Decision(
        "deny", f"agent.{tool_name}=deny", f"{agent.name} is not allowed to use {tool.label}."
    )
    # P29: a manager's explicit "deny" comes before ALWAYS_ASK, so it never raises a card.
    # (A tool's own default "deny" still asks for these, as before.)
    if tool_name in ALWAYS_ASK and _explicit(agent, tool_name) == "deny":
        return denied
    if tool_name in ALWAYS_ASK:
        return Decision(
            "ask", f"hardline.{tool_name}", f"{tool.label} always waits for a person.", True
        )
    if mode == "deny":
        return denied
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
