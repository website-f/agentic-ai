"""Hiring an AI worker (P19): what a staff member's onboarding gives their AI twin.

A twin speaks for its person, so a blueprint applied to it does not replace who it is (as
blueprints do for ordinary agents): its name, job title, persona and colour stay, and the
blueprint's instructions become the twin's "role playbook" (kept in its profile, so saving
the twin wizard again keeps it). The blueprint's SOPs are added, its skills granted, and
its tool modes merged, but sending forms, running code and outside tools always still ask,
and the twin's autonomy stays "ask".
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.store import Author
from ..models import Agent, Blueprint, Skill, User, Workspace
from . import twin
from .tools import TOOLS

PLAYBOOK_MAX = 6000


def merge_tools(current: dict[str, str], blueprint: dict[str, str]) -> dict[str, str]:
    out = dict(current or {})
    locked = {name for key in twin.LOCKED_ASKS for name in twin.ASK_BY_KEY[key].tools}
    for name, mode in (blueprint or {}).items():
        if name not in TOOLS or mode not in ("allow", "ask", "deny"):
            continue
        out[name] = "ask" if name in locked and mode == "allow" else mode
    return out


async def apply_blueprint_to_twin(
    db: AsyncSession, ws: Workspace, agent: Agent, bp: Blueprint, author: Author
) -> None:
    """Layer the blueprint onto the twin (the caller audits and commits)."""
    owner = await db.get(User, agent.owner_user_id) if agent.owner_user_id else None
    if owner is None:
        return
    home = await twin.home_of(db, ws.id, owner)
    profile = await twin.read_profile(db, agent) or {
        "name": agent.name,
        "role": agent.role,
        "color": agent.color,
        "heartbeat": agent.heartbeat,
    }
    p: dict[str, Any] = {**twin.suggestions(home), **profile}
    p["_blueprint"] = {"id": bp.id, "name": bp.name, "soul": (bp.soul or "")[:PLAYBOOK_MAX]}
    agent.soul = twin.soul(p, owner.name, home.where_for(p.get("role")))
    agent.tools = merge_tools(dict(agent.tools or {}), dict(bp.tools or {}))
    sops: list[str] = [str(x) for x in [*(agent.sop_ids or []), *(bp.sop_ids or [])]]
    agent.sop_ids = list(dict.fromkeys(sops))[:30]
    agent.template = bp.name
    for sid in bp.skill_ids or []:
        skill = await db.get(Skill, sid)
        if skill and skill.workspace_id == ws.id and skill.agent_ids:
            if agent.id not in skill.agent_ids:
                skill.agent_ids = [*skill.agent_ids, agent.id]
    await db.flush()
    await twin.write_profile(db, ws, agent, p, author)
