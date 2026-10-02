"""Blueprints (P9): reusable role packages — role, instructions, model, tool scope, SOPs and
skills — that people define once and apply to agents, so a new agent is a trained specialist
from the first minute instead of a blank slate.

Applying a blueprint copies its role/soul/model/tools/autonomy/SOPs onto the agent and grants
it the blueprint's skills. The tool map is the capability scope: a blueprint can `deny` tools
a role should never touch, which limits what agents stamped from it can ever do.
"""

from collections.abc import Mapping
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents.tools import TOOLS
from ...core.db import get_db
from ...models import SOP, Agent, Blueprint, Skill
from ...services import audit, events
from ..deps import Principal, api_error, require
from .agents import manage_perm, managed_agent

router = APIRouter(prefix="/api/blueprints", tags=["blueprints"])

Mode = str


class BlueprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    role: str = Field(default="", max_length=120)
    soul: str = Field(default="", max_length=8000)
    model_group: str = Field(default="smart", max_length=40)
    tools: dict[str, Mode] = Field(default_factory=dict)
    autonomy: str = Field(default="ask", pattern="^(ask|auto)$")
    sop_ids: list[str] = Field(default_factory=list, max_length=40)
    skill_ids: list[str] = Field(default_factory=list, max_length=40)
    color: str = Field(default="#13895f", pattern=r"^#[0-9a-fA-F]{6}$")
    branch_id: str | None = None


class BlueprintOut(BaseModel):
    id: str
    name: str
    description: str
    role: str
    soul: str
    model_group: str
    tools: dict[str, str]
    autonomy: str
    sop_ids: list[str]
    skill_ids: list[str]
    color: str
    source: str
    branch_id: str | None
    created_by: str
    created_at: Any
    used_by: int  # agents currently matching this blueprint's name as their template


def _out(bp: Blueprint, used_by: int = 0) -> BlueprintOut:
    return BlueprintOut(
        id=bp.id,
        name=bp.name,
        description=bp.description,
        role=bp.role,
        soul=bp.soul,
        model_group=bp.model_group,
        tools=bp.tools or {},
        autonomy=bp.autonomy,
        sop_ids=bp.sop_ids or [],
        skill_ids=bp.skill_ids or [],
        color=bp.color,
        source=bp.source,
        branch_id=bp.branch_id,
        created_by=bp.created_by,
        created_at=bp.created_at,
        used_by=used_by,
    )


def _check_tools(tools: Mapping[str, str]) -> None:
    unknown = set(tools) - set(TOOLS)
    if unknown:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "unknown_tool",
            f"Unknown tools: {', '.join(sorted(unknown))}.",
        )
    bad = {m for m in tools.values() if m not in ("allow", "ask", "deny")}
    if bad:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_mode", "Each tool is allow, ask or deny.")


async def _check_refs(db: AsyncSession, ws: str, sop_ids: list[str], skill_ids: list[str]) -> None:
    if sop_ids:
        found = (
            await db.scalars(select(SOP.id).where(SOP.id.in_(sop_ids), SOP.workspace_id == ws))
        ).all()
        if set(found) != set(sop_ids):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_sop", "One of the SOPs is not here.")
    if skill_ids:
        found = (
            await db.scalars(
                select(Skill.id).where(Skill.id.in_(skill_ids), Skill.workspace_id == ws)
            )
        ).all()
        if set(found) != set(skill_ids):
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_skill", "One of the skills is not here."
            )


async def _get(db: AsyncSession, ws: str, blueprint_id: str) -> Blueprint:
    bp = await db.get(Blueprint, blueprint_id)
    if bp is None or bp.workspace_id != ws:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "blueprint_not_found", "That blueprint is not here."
        )
    return bp


async def _used_by(db: AsyncSession, ws: str, name: str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Agent)
            .where(Agent.workspace_id == ws, Agent.template == name, Agent.status != "retired")
        )
        or 0
    )


@router.get("")
async def list_blueprints(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[BlueprintOut]:
    rows = (
        await db.scalars(
            select(Blueprint)
            .where(Blueprint.workspace_id == principal.workspace_id)
            .order_by(Blueprint.name)
        )
    ).all()
    counts = dict(
        (
            await db.execute(
                select(Agent.template, func.count())
                .where(Agent.workspace_id == principal.workspace_id, Agent.status != "retired")
                .group_by(Agent.template)
            )
        ).all()
    )
    return [_out(bp, int(counts.get(bp.name, 0))) for bp in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_blueprint(
    body: BlueprintIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> BlueprintOut:
    _check_tools(body.tools)
    await _check_refs(db, principal.workspace_id, body.sop_ids, body.skill_ids)
    if await db.scalar(
        select(Blueprint.id).where(
            Blueprint.workspace_id == principal.workspace_id, Blueprint.name == body.name.strip()
        )
    ):
        raise api_error(
            status.HTTP_409_CONFLICT, "name_taken", "A blueprint with that name exists."
        )
    bp = Blueprint(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        name=body.name.strip(),
        description=body.description,
        role=body.role,
        soul=body.soul,
        model_group=body.model_group,
        tools=body.tools,
        autonomy=body.autonomy,
        sop_ids=body.sop_ids,
        skill_ids=body.skill_ids,
        color=body.color,
        created_by=principal.actor,
    )
    db.add(bp)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "blueprint.created",
        target=bp.id,
        after={"name": bp.name, "role": bp.role},
    )
    await db.commit()
    await db.refresh(bp)
    return _out(bp)


@router.patch("/{blueprint_id}")
async def update_blueprint(
    blueprint_id: str,
    body: BlueprintIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> BlueprintOut:
    bp = await _get(db, principal.workspace_id, blueprint_id)
    _check_tools(body.tools)
    await _check_refs(db, principal.workspace_id, body.sop_ids, body.skill_ids)
    if body.name.strip() != bp.name and await db.scalar(
        select(Blueprint.id).where(
            Blueprint.workspace_id == principal.workspace_id, Blueprint.name == body.name.strip()
        )
    ):
        raise api_error(
            status.HTTP_409_CONFLICT, "name_taken", "A blueprint with that name exists."
        )
    for k, v in body.model_dump().items():
        setattr(bp, k, v.strip() if isinstance(v, str) else v)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "blueprint.updated",
        target=bp.id,
        after={"name": bp.name},
    )
    await db.commit()
    await db.refresh(bp)
    return _out(bp, await _used_by(db, principal.workspace_id, bp.name))


@router.delete("/{blueprint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blueprint(
    blueprint_id: str,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> Response:
    bp = await _get(db, principal.workspace_id, blueprint_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "blueprint.deleted",
        target=bp.id,
        before={"name": bp.name},
    )
    await db.delete(bp)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class ApplyIn(BaseModel):
    agent_id: str


async def _apply(db: AsyncSession, principal: Principal, bp: Blueprint, agent: Agent) -> None:
    agent.role = bp.role or agent.role
    agent.soul = bp.soul
    agent.model_group = bp.model_group
    agent.tools = dict(bp.tools or {})
    agent.autonomy = bp.autonomy
    agent.sop_ids = list(bp.sop_ids or [])
    agent.template = bp.name
    agent.color = bp.color
    # Grant the blueprint's skills to this agent (skills list the agents that may load them).
    for sid in bp.skill_ids or []:
        skill = await db.get(Skill, sid)
        if skill and skill.workspace_id == principal.workspace_id and skill.agent_ids:
            if agent.id not in skill.agent_ids:
                skill.agent_ids = [*skill.agent_ids, agent.id]
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "blueprint.applied",
        target=agent.id,
        after={"blueprint": bp.name},
    )


@router.post("/{blueprint_id}/apply")
async def apply_blueprint(
    blueprint_id: str,
    body: ApplyIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> BlueprintOut:
    bp = await _get(db, principal.workspace_id, blueprint_id)
    agent = await managed_agent(db, principal, body.agent_id)
    await _apply(db, principal, bp, agent)
    await db.commit()
    await events.publish(
        principal.workspace_id, "agent.upsert", {"agent_id": agent.id, "name": agent.name}
    )
    return _out(bp, await _used_by(db, principal.workspace_id, bp.name))
