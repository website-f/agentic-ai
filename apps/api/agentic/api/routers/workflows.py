"""Workflows (P9): visual procedures. People draw a graph of steps, or describe a job and an
analyst agent drafts the graph. Attaching a workflow to agents layers its compiled procedure
into their prompt, like an SOP — guidance they follow, not an automation that runs by itself.
"""

import json
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...engine import gateway
from ...models import Agent, Workflow
from ...services import audit, events
from ...workflows.procedure import DRAFT_SYSTEM, clean_graph, compile_text, draft_prompt
from ..deps import Principal, api_error, require
from .agents import manage_perm

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


def _loads_lenient(text: str) -> dict[str, Any] | None:
    """Parse the draft JSON; if it was cut off mid-stream, recover the complete prefix."""
    text = text.strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    for end in range(len(text), 1, -1):  # trim back to the last point that parses
        if text[end - 1] in "}]":
            for close in ("", "}", "]}", "}]}"):
                try:
                    return json.loads(text[:end] + close)
                except ValueError:
                    continue
    return None


class WorkflowIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    graph: dict[str, Any] = Field(default_factory=dict)
    status: str = Field(default="draft", pattern="^(draft|active)$")
    agent_ids: list[str] = Field(default_factory=list, max_length=100)
    branch_id: str | None = None


class WorkflowOut(BaseModel):
    id: str
    name: str
    description: str
    graph: dict[str, Any]
    status: str
    source: str
    agent_ids: list[str]
    branch_id: str | None
    created_by: str
    created_at: Any
    steps: int
    procedure: str


def _out(wf: Workflow) -> WorkflowOut:
    graph = clean_graph(wf.graph or {})
    return WorkflowOut(
        id=wf.id,
        name=wf.name,
        description=wf.description,
        graph=graph,
        status=wf.status,
        source=wf.source,
        agent_ids=wf.agent_ids or [],
        branch_id=wf.branch_id,
        created_by=wf.created_by,
        created_at=wf.created_at,
        steps=len(graph["nodes"]),
        procedure=compile_text(wf.name, graph),
    )


async def _get(db: AsyncSession, ws: str, workflow_id: str) -> Workflow:
    wf = await db.get(Workflow, workflow_id)
    if wf is None or wf.workspace_id != ws:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "workflow_not_found", "That workflow is not here."
        )
    return wf


async def _check_agents(db: AsyncSession, principal: Principal, ids: list[str]) -> list[str]:
    out: list[str] = []
    for aid in ids:
        a = await db.get(Agent, aid)
        if (
            a is None
            or a.workspace_id != principal.workspace_id
            or not principal.scope.sees_agent(a)
        ):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick agents you can see.")
        if a.id not in out:
            out.append(a.id)
    return out


@router.get("")
async def list_workflows(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> list[WorkflowOut]:
    rows = (
        await db.scalars(
            select(Workflow)
            .where(Workflow.workspace_id == principal.workspace_id)
            .order_by(Workflow.name)
        )
    ).all()
    return [_out(wf) for wf in rows]


@router.get("/{workflow_id}")
async def read_workflow(
    workflow_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> WorkflowOut:
    return _out(await _get(db, principal.workspace_id, workflow_id))


async def _name_taken(db: AsyncSession, ws: str, name: str, exclude: str = "") -> bool:
    found = await db.scalar(
        select(Workflow.id).where(Workflow.workspace_id == ws, Workflow.name == name)
    )
    return found is not None and found != exclude


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workflow(
    body: WorkflowIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> WorkflowOut:
    if await _name_taken(db, principal.workspace_id, body.name.strip()):
        raise api_error(status.HTTP_409_CONFLICT, "name_taken", "A workflow with that name exists.")
    wf = Workflow(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        name=body.name.strip(),
        description=body.description,
        graph=clean_graph(body.graph),
        status=body.status,
        agent_ids=await _check_agents(db, principal, body.agent_ids),
        created_by=principal.actor,
    )
    db.add(wf)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.created",
        target=wf.id,
        after={"name": wf.name},
    )
    await db.commit()
    await db.refresh(wf)
    return _out(wf)


@router.patch("/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    body: WorkflowIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> WorkflowOut:
    wf = await _get(db, principal.workspace_id, workflow_id)
    if body.name.strip() != wf.name and await _name_taken(
        db, principal.workspace_id, body.name.strip(), wf.id
    ):
        raise api_error(status.HTTP_409_CONFLICT, "name_taken", "A workflow with that name exists.")
    wf.name = body.name.strip()
    wf.description = body.description
    wf.graph = clean_graph(body.graph)
    wf.status = body.status
    wf.agent_ids = await _check_agents(db, principal, body.agent_ids)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.updated",
        target=wf.id,
        after={"name": wf.name, "status": wf.status, "agents": len(wf.agent_ids)},
    )
    await db.commit()
    await db.refresh(wf)
    for aid in wf.agent_ids:
        await events.publish(principal.workspace_id, "agent.upsert", {"agent_id": aid, "name": ""})
    return _out(wf)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: str,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> Response:
    wf = await _get(db, principal.workspace_id, workflow_id)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.deleted",
        target=wf.id,
        before={"name": wf.name},
    )
    await db.delete(wf)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class DraftIn(BaseModel):
    description: str = Field(min_length=10, max_length=4000)


class DraftOut(BaseModel):
    graph: dict[str, Any]


@router.post("/draft")
async def draft_workflow(
    body: DraftIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> DraftOut:
    """An analyst agent drafts a procedure graph from a plain-language description."""
    messages = [
        {"role": "system", "content": DRAFT_SYSTEM},
        {"role": "user", "content": draft_prompt(body.description)},
    ]
    try:
        r = await gateway.chat(
            db,
            principal.workspace_id,
            "smart",
            messages,
            task="workflow.draft",
            max_tokens=2000,
            json_mode=True,
        )
    except gateway.GatewayUnavailable as e:
        raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    try:
        raw = json.loads(r.content)
    except ValueError:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY,
            "bad_draft",
            "The model did not return a usable draft. Try again.",
        ) from None
    graph = clean_graph(raw)
    if not graph["nodes"]:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, "empty_draft", "The draft had no steps. Try rephrasing."
        )
    # Lay the drafted nodes out in a simple grid so they are readable before the person edits.
    for i, n in enumerate(graph["nodes"]):
        n["x"], n["y"] = 60 + (i % 3) * 260, 60 + (i // 3) * 150
    return DraftOut(graph=graph)
