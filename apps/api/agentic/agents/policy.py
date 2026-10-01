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

from ..models import Agent
from .tools import GLOBAL_DENY, TOOLS, check_url_arg

MAX_ARGS_CHARS = 20_000


@dataclass(frozen=True)
class Decision:
    effect: str  # allow | ask | deny
    rule: str
    reason: str
    hardline: bool = False


async def evaluate(agent: Agent, tool_name: str, args: dict[str, Any]) -> Decision:
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

    mode = (agent.tools or {}).get(tool_name, tool.default_mode)
    if mode == "deny":
        return Decision(
            "deny", f"agent.{tool_name}=deny", f"{agent.name} is not allowed to use {tool.label}."
        )
    if mode == "allow":
        return Decision("allow", f"agent.{tool_name}=allow", "Allowed for this agent.")
    if agent.autonomy == "auto" and tool.risk != "high":
        return Decision("allow", "autonomy.auto", "Agent runs on auto for non-high-risk tools.")
    return Decision(
        "ask", f"agent.{tool_name}=ask", f"{tool.label} needs approval for {agent.name}."
    )
