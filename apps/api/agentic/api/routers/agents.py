"""Agents: templates, tools, the builder's prompt preview, CRUD, and direct chat."""

import logging
from collections.abc import Mapping

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch, runtime
from ...agents.prompt import build_parts, render
from ...agents.templates import BY_ID, TEMPLATES
from ...agents.tools import TOOLS
from ...core.db import get_db
from ...core.security import PERMISSIONS
from ...engine import gateway
from ...models import SOP, Agent, AgentMessage, Branch, ChatSession, Department, Task, User
from ...services import audit, events
from ...services.text import slugify
from ..agent_schemas import (
    AgentIn,
    AgentOut,
    AgentUpdateIn,
    ChatIn,
    ChatOut,
    PromptPreviewOut,
    TaskBrief,
    ToolOut,
)
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["agents"])
log = logging.getLogger("agentic.api.agents")

OPEN = ("triage", "ready", "running", "blocked", "review")


async def _work(db: AsyncSession, ids: list[str]) -> tuple[dict[str, Task], dict[str, int]]:
    """Current task and open-task count for many agents, in two queries."""
    if not ids:
        return {}, {}
    current: dict[str, Task] = {}
    for t in (
        await db.scalars(
            select(Task)
            .where(Task.assignee_agent_id.in_(ids), Task.status.in_(("running", "blocked")))
            .order_by(Task.updated_at.desc())
        )
    ).all():
        current.setdefault(t.assignee_agent_id or "", t)
    counts = {
        str(aid): int(n)
        for aid, n in (
            await db.execute(
                select(Task.assignee_agent_id, func.count())
                .where(Task.assignee_agent_id.in_(ids), Task.status.in_(OPEN))
                .group_by(Task.assignee_agent_id)
            )
        ).all()
    }
    return current, counts


async def agent_out(
    db: AsyncSession,
    a: Agent,
    work: tuple[dict[str, Task], dict[str, int]] | None = None,
    principal: Principal | None = None,
) -> AgentOut:
    branch = await db.get(Branch, a.branch_id)  # identity map: one query per branch
    dept = await db.get(Department, a.department_id) if a.department_id else None
    owner = await db.get(User, a.owner_user_id) if a.owner_user_id else None
    now, counts = work if work is not None else await _work(db, [a.id])
    current = now.get(a.id)
    open_tasks = counts.get(a.id, 0)
    return AgentOut(
        id=a.id,
        slug=a.slug,
        name=a.name,
        role=a.role,
        template=a.template,
        branch_id=a.branch_id,
        branch_name=branch.name if branch else "",
        department_id=a.department_id,
        department_name=dept.name if dept else None,
        soul=a.soul,
        model_group=a.model_group,
        tools=a.tools or {},
        autonomy=a.autonomy,
        sop_ids=a.sop_ids or [],
        color=a.color,
        reports_to=a.reports_to,
        status=a.status,
        role_kind=a.role_kind,
        max_parallel_children=a.max_parallel_children,
        max_spawn_depth=a.max_spawn_depth,
        budget_daily_tokens=a.budget_daily_tokens,
        budget_monthly_usd=float(a.budget_monthly_usd)
        if a.budget_monthly_usd is not None
        else None,
        heartbeat=a.heartbeat,
        current_task=TaskBrief(id=current.id, title=current.title, status=current.status)
        if current
        else None,
        open_tasks=open_tasks,
        created_at=a.created_at,
        owner_user_id=a.owner_user_id,
        owner_name=owner.name if owner else None,
        clone_of=a.clone_of,
        can_manage=principal is not None and can_manage(principal, a),
        view_only=principal is not None and not principal.scope.sees_agent(a),
        private=bool(a.private),
    )


def can_manage(principal: Principal, a: Agent) -> bool:
    return principal.scope.manages_agent(a, PERMISSIONS.get(principal.role, frozenset()))


async def get_agent(db: AsyncSession, who: Principal | str, agent_id: str) -> Agent:
    """The agent, if it is in this workspace and (given a person) inside their scope."""
    ws = who if isinstance(who, str) else who.workspace_id
    a = await db.get(Agent, agent_id)
    if (
        a is None
        or a.workspace_id != ws
        or (not isinstance(who, str) and not who.scope.sees_agent(a))
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    return a


async def managed_agent(db: AsyncSession, principal: Principal, agent_id: str) -> Agent:
    a = await get_agent(db, principal, agent_id)
    if not can_manage(principal, a):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            f"Your role ({principal.role}) cannot change {a.name}.",
        )
    return a


def manage_perm():
    """Agents are added and changed by people with agents.manage, or agents.own (their own)."""

    async def checker(principal: Principal = Depends(require("read"))) -> Principal:
        perms = PERMISSIONS.get(principal.role, frozenset())
        if "agents.manage" not in perms and "agents.own" not in perms:
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                f"Your role ({principal.role}) cannot add or change agents.",
            )
        return principal

    return checker


async def _check_placement(
    db: AsyncSession,
    ws: str,
    branch_id: str,
    dept_id: str | None,
    sop_ids: list[str],
    reports_to: str | None,
) -> None:
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != ws:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a branch from this workspace."
        )
    if dept_id:
        d = await db.get(Department, dept_id)
        if d is None or d.branch_id != branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "bad_department",
                "That department is not in the chosen branch.",
            )
    if sop_ids:
        found = (
            await db.scalars(select(SOP.id).where(SOP.id.in_(sop_ids), SOP.workspace_id == ws))
        ).all()
        if len(set(found)) != len(set(sop_ids)):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_sop", "One of the SOPs is not here.")
    if reports_to:
        await get_agent(db, ws, reports_to)


def _check_tools(tools: Mapping[str, str]) -> None:
    unknown = set(tools) - set(TOOLS)
    if unknown:
        raise api_error(
            status.HTTP_400_BAD_REQUEST,
            "unknown_tool",
            f"Unknown tools: {', '.join(sorted(unknown))}.",
        )


@router.get("/agents/templates")
async def templates(_: Principal = Depends(require("read"))) -> list[dict]:
    return [t.public() for t in TEMPLATES]


@router.get("/agents/tools")
async def tools(_: Principal = Depends(require("read"))) -> list[ToolOut]:
    return [
        ToolOut(
            name=t.name,
            label=t.label,
            description=t.description,
            risk=t.risk,
            default_mode=t.default_mode,  # type: ignore[arg-type]
        )
        for t in TOOLS.values()
    ]  # type: ignore[arg-type]


@router.post("/agents/preview-prompt")
async def preview_prompt(
    body: AgentIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> PromptPreviewOut:
    await _check_placement(
        db, principal.workspace_id, body.branch_id, body.department_id, body.sop_ids, None
    )
    draft = Agent(
        workspace_id=principal.workspace_id,
        branch_id=body.branch_id,
        department_id=body.department_id,
        name=body.name,
        role=body.role,
        soul=body.soul,
        sop_ids=body.sop_ids,
        tools=body.tools,
    )
    parts = await build_parts(db, draft, "task")
    text = render(parts)
    return PromptPreviewOut(
        prompt=text,
        tokens_estimate=len(text) // 4,
        parts=[{"title": p.title, "chars": len(p.text)} for p in parts],
    )


@router.get("/agents")
async def list_agents(
    branch_id: str | None = Query(default=None),
    include_retired: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[AgentOut]:
    # Staff also watch the rest of their office (marked view_only).
    q = select(Agent).where(
        Agent.workspace_id == principal.workspace_id, principal.scope.observe_where()
    )
    if branch_id:
        q = q.where(Agent.branch_id == branch_id)
    if not include_retired:
        q = q.where(Agent.status != "retired")
    rows = (await db.scalars(q.order_by(Agent.created_at))).all()
    work = await _work(db, [a.id for a in rows])
    return [await agent_out(db, a, work, principal) for a in rows]


@router.post("/agents", status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: AgentIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> AgentOut:
    perms = PERMISSIONS.get(principal.role, frozenset())
    personal = body.personal or "agents.manage" not in perms
    if not personal and not principal.scope.placement_ok(body.branch_id, body.department_id):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "outside_scope",
            f"You can only place agents in {principal.scope.label}.",
        )
    await _check_placement(
        db,
        principal.workspace_id,
        body.branch_id,
        body.department_id,
        body.sop_ids,
        body.reports_to,
    )
    _check_tools(body.tools)
    base, slug, n = slugify(body.name, "agent"), slugify(body.name, "agent"), 2
    while await db.scalar(
        select(func.count())
        .select_from(Agent)
        .where(Agent.workspace_id == principal.workspace_id, Agent.slug == slug)
    ):
        slug, n = f"{base}-{n}", n + 1
    fields = body.model_dump(exclude={"personal"})
    if personal:
        fields["owner_user_id"] = principal.user.id
        if "agents.manage" not in perms:
            # A personal agent works for its owner: no org-chart powers, no heartbeat.
            fields.update(role_kind="leaf", heartbeat=False, reports_to=None)
    if body.template in BY_ID:
        tpl = BY_ID[body.template]
        if "role_kind" not in body.model_fields_set:
            fields["role_kind"] = tpl.role_kind  # e.g. office manager: orchestrator
        if "tools" not in body.model_fields_set:
            fields["tools"] = dict(tpl.tools)  # e.g. the web operator's browser tools
    a = Agent(workspace_id=principal.workspace_id, slug=slug, **fields)
    db.add(a)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "agent.created",
        target=a.id,
        after={
            "name": a.name,
            "role": a.role,
            "branch_id": a.branch_id,
            "department_id": a.department_id,
            "owner_user_id": a.owner_user_id,
        },
    )
    await db.commit()
    await db.refresh(a)
    out = await agent_out(db, a, None, principal)
    await events.publish(principal.workspace_id, "agent.upsert", {"agent_id": a.id, "name": a.name})
    return out


@router.get("/agents/{agent_id}")
async def read_agent(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> AgentOut:
    a = await db.get(Agent, agent_id)
    if (
        a is None
        or a.workspace_id != principal.workspace_id
        or not principal.scope.observes_agent(a)
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    return await agent_out(db, a, None, principal)


@router.patch("/agents/{agent_id}")
async def update_agent(
    agent_id: str,
    body: AgentUpdateIn,
    principal: Principal = Depends(manage_perm()),
    db: AsyncSession = Depends(get_db),
) -> AgentOut:
    a = await managed_agent(db, principal, agent_id)
    changes = body.model_dump(exclude_unset=True)
    if "agents.manage" not in PERMISSIONS.get(principal.role, frozenset()):
        for k in ("role_kind", "heartbeat", "reports_to"):
            changes.pop(k, None)
    if "tools" in changes:
        _check_tools(changes["tools"] or {})
    branch_id = changes.get("branch_id", a.branch_id)
    if branch_id != a.branch_id and "department_id" not in changes:
        changes["department_id"] = None  # the old department belongs to the old branch
    dept_id = changes.get("department_id", a.department_id)
    if (
        ("branch_id" in changes or "department_id" in changes)
        and a.owner_user_id != principal.user.id
        and not principal.scope.placement_ok(branch_id, dept_id)
    ):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "outside_scope",
            f"You can only place agents in {principal.scope.label}.",
        )
    await _check_placement(
        db,
        principal.workspace_id,
        branch_id,
        dept_id,
        changes.get("sop_ids", []),
        changes.get("reports_to"),
    )
    if changes.get("reports_to") == a.id:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "self_manager", "An agent cannot report to itself."
        )
    boss, seen = changes.get("reports_to"), set()
    while boss and boss not in seen:  # the org chart must stay a tree
        if boss == a.id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST,
                "reporting_loop",
                "That would make a loop: someone above would end up reporting to this agent.",
            )
        seen.add(boss)
        up = await db.get(Agent, boss)
        boss = up.reports_to if up else None
    before = {k: getattr(a, k) for k in changes}
    for k, v in changes.items():
        setattr(a, k, v)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "agent.updated",
        target=a.id,
        before={k: v for k, v in before.items() if k != "soul"},
        after={k: v for k, v in changes.items() if k != "soul"},
        note="soul edited" if "soul" in changes else None,
    )
    await db.commit()
    await db.refresh(a)
    await events.publish(principal.workspace_id, "agent.upsert", {"agent_id": a.id, "name": a.name})
    return await agent_out(db, a, None, principal)


# ---------------------------------------------------------------- chat


@router.get("/agents/{agent_id}/sessions")
async def list_sessions(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await get_agent(db, principal, agent_id)
    rows = (
        await db.scalars(
            select(ChatSession)
            .where(ChatSession.agent_id == agent_id, ChatSession.user_id == principal.user.id)
            .order_by(ChatSession.updated_at.desc())
            .limit(30)
        )
    ).all()
    return [{"id": s.id, "title": s.title, "updated_at": s.updated_at} for s in rows]


@router.get("/chat/sessions/{session_id}/messages")
async def session_messages(
    session_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    s = await db.get(ChatSession, session_id)
    if s is None or s.user_id != principal.user.id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "session_not_found", "That conversation is not here."
        )
    rows = (
        await db.scalars(
            select(AgentMessage).where(AgentMessage.session_id == s.id).order_by(AgentMessage.id)
        )
    ).all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "name": m.name,
            "meta": m.meta,
            "created_at": m.created_at,
        }
        for m in rows
        if m.role in ("user", "assistant") and m.content
    ]


@router.post("/agents/{agent_id}/chat")
async def chat(
    agent_id: str,
    body: ChatIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> ChatOut:
    a = await get_agent(db, principal, agent_id)
    if a.status != "active":
        raise api_error(status.HTTP_409_CONFLICT, "agent_inactive", f"{a.name} is {a.status}.")
    if body.session_id:
        s = await db.get(ChatSession, body.session_id)
        if s is None or s.user_id != principal.user.id or s.agent_id != a.id:
            raise api_error(
                status.HTTP_404_NOT_FOUND, "session_not_found", "That conversation is not here."
            )
    else:
        s = ChatSession(
            workspace_id=a.workspace_id,
            agent_id=a.id,
            user_id=principal.user.id,
            title=body.message.strip()[:80],
        )
        db.add(s)
        await db.commit()
    try:
        reply = await runtime.chat_turn(db, a, s, body.message)
    except gateway.GatewayUnavailable as e:
        raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    s.title = s.title or body.message[:80]
    await db.commit()
    if reply.message_id is not None:
        try:  # learning is best effort: chat must work even if Temporal is down
            await dispatch.start_chat_learning(reply.message_id)
        except Exception:  # noqa: BLE001
            log.warning("could not start chat learning", exc_info=True)
    return ChatOut(
        session_id=s.id,
        reply=reply.content,
        provider=reply.provider_name,
        model=reply.model,
        tools_used=reply.tools_used,
    )
