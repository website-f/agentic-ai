"""My AI twin (P18): the wizard behind a staff member's one agent, their virtual self at work.

Who may do what is written down in agents/twin.py. In short: the person creates, adopts and
edits their own twin here; managers govern it through the ordinary agent settings; colleagues
only watch it.
"""

from typing import Any, Literal

from fastapi import Depends, status
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import twin
from ...agents.tools import mode_of
from ...brain import core as core_memory
from ...brain.facts import _SECRET
from ...brain.store import Author
from ...core import threats
from ...core.db import get_db
from ...core.security import PERMISSIONS
from ...i18n.labels import role_label
from ...models import Agent, Workspace
from ...services import audit, events
from ...services.text import slugify
from ..agent_schemas import HEX
from ..deps import Principal, api_error, require
from .agents import agent_out, refuse_second_agent

router = APIRouter(prefix="/api", tags=["twins"])

Tone = Literal["friendly", "professional", "brief", "detailed"]


class TwinIn(BaseModel):
    """The wizard's answers. On create, anything left out takes the suggested value; on
    update, anything left out keeps what was saved."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    role: str | None = Field(default=None, min_length=1, max_length=120)
    job: str | None = Field(default=None, max_length=600)
    style: str | None = Field(default=None, max_length=600)
    tone: Tone | None = None
    languages: list[str] | None = Field(default=None, max_length=6)
    helps_with: list[str] | None = Field(default=None, max_length=len(twin.HELPS))
    ask_first: list[str] | None = Field(default=None, max_length=len(twin.ASKS))
    hours: str | None = Field(default=None, max_length=80)
    heartbeat: bool | None = None
    color: str | None = Field(default=None, pattern=HEX)
    # Let the fast model rewrite the intro in natural words (the template is used if it can't).
    polish: bool = False

    @field_validator("languages")
    @classmethod
    def _langs(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        out = list(dict.fromkeys(" ".join(x.split())[:30] for x in v if x.strip()))
        return out or ["English"]

    @field_validator("helps_with")
    @classmethod
    def _helps(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and (bad := [k for k in v if k not in twin.HELP_BY_KEY]):
            raise ValueError(f"Unknown choices: {', '.join(bad)}.")
        return list(dict.fromkeys(v)) if v is not None else v

    @field_validator("ask_first")
    @classmethod
    def _asks(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and (bad := [k for k in v if k not in twin.ASK_BY_KEY]):
            raise ValueError(f"Unknown choices: {', '.join(bad)}.")
        return list(dict.fromkeys(v)) if v is not None else v


class AdoptIn(BaseModel):
    agent_id: str = Field(min_length=1, max_length=40)


class TeachIn(BaseModel):
    text: str = Field(min_length=3, max_length=300)
    target: Literal["user", "memory"] = "user"


def own_perm():
    """Only people whose role has their own agents (agents.own) have a twin."""

    async def checker(principal: Principal = Depends(require("read"))) -> Principal:
        if "agents.own" not in PERMISSIONS.get(principal.role, frozenset()):
            raise api_error(
                status.HTTP_403_FORBIDDEN,
                "no_twin_role",
                "AI twins are for staff. Your role ({role}) adds agents from Agents.",
                role=role_label(principal.role),
            )
        return principal

    return checker


def _public(p: dict[str, Any] | None) -> dict[str, Any] | None:
    return None if p is None else {k: v for k, v in p.items() if not k.startswith("_")}


def _answers(base: dict[str, Any], body: TwinIn) -> dict[str, Any]:
    p = {**base, **body.model_dump(exclude_none=True, exclude={"polish"})}
    for k in ("name", "role", "hours"):
        p[k] = " ".join(str(p.get(k) or "").split())
    for k in ("job", "style"):
        p[k] = str(p.get(k) or "").strip()
    if not p["name"]:
        p["name"] = base.get("name") or "My twin"
    if not p["role"]:
        p["role"] = base.get("role") or "Staff"
    if p.get("hours") == "Only when I ask":
        p["heartbeat"] = False
    return p


async def _ws(db: AsyncSession, principal: Principal) -> Workspace:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    return ws


def _author(principal: Principal) -> Author:
    return Author(principal.actor, principal.user.name)


async def _state(db: AsyncSession, principal: Principal) -> dict[str, Any]:
    """Everything the My twin page and the wizard need, in one answer."""
    ws_id, user = principal.workspace_id, principal.user
    eligible = "agents.own" in PERMISSIONS.get(principal.role, frozenset())
    mine = await twin.twin_of(db, ws_id, user.id)
    home = await twin.home_of(db, ws_id, user)
    old = await twin.adoptable(db, ws_id, user.id) if eligible and mine is None else []
    profile = await twin.read_profile(db, mine) if mine else None
    return {
        "eligible": eligible,
        "can_create": eligible and mine is None and not old and home.branch is not None,
        "twin": await agent_out(db, mine, None, principal) if mine else None,
        "profile": _public(profile),
        "adoptable": [
            {
                "id": a.id,
                "name": a.name,
                "role": a.role,
                "color": a.color,
                "status": a.status,
            }
            for a in old
        ],
        "suggested": twin.suggestions(home),
        "person": {
            "name": user.name,
            "first_name": twin.first_name(user.name),
            "initials": twin.initials(user.name),
            "email": user.email,
            "role": home.role,
            "branch_name": home.branch.name if home.branch else None,
            "department_name": home.department.name if home.department else None,
        },
        "sops": await twin.auto_sops(db, ws_id, home),
        "options": twin.options(),
    }


async def _save(
    db: AsyncSession, principal: Principal, a: Agent | None, body: TwinIn
) -> dict[str, Any]:
    """Create (a is None) or re-save the twin from the wizard's answers."""
    ws = await _ws(db, principal)
    user = principal.user
    home = await twin.home_of(db, ws.id, user)
    if home.branch is None:
        raise api_error(
            status.HTTP_409_CONFLICT, "no_branch", "Ask an admin to create a company first."
        )
    old = (await twin.read_profile(db, a) or {}) if a else {}
    if a is not None and not old:  # adopted, never through the wizard: start from the agent
        old = {"name": a.name, "role": a.role, "color": a.color, "heartbeat": a.heartbeat}
    p = _answers({**twin.suggestions(home), **old}, body)
    text = twin.intro(p, user.name, home.where_for(p["role"]))
    polished = await twin.polish(db, ws.id, text) if body.polish else None
    soul = twin.soul(p, user.name, home.where_for(p["role"]), polished)
    made = twin.tools_for(p["helps_with"], p["ask_first"])
    dept_id = home.department.id if home.department else None
    if a is None:
        await refuse_second_agent(db, principal)
        await twin.free_retired_place(db, ws.id, user.id)
        base = slugify(p["name"], "twin")
        slug, n = base, 2
        while await db.scalar(
            select(func.count())
            .select_from(Agent)
            .where(Agent.workspace_id == ws.id, Agent.slug == slug)
        ):
            slug, n = f"{base}-{n}", n + 1
        a = Agent(
            workspace_id=ws.id,
            branch_id=home.branch.id,
            department_id=dept_id,
            slug=slug,
            name=p["name"],
            role=p["role"],
            template="twin",
            role_kind="leaf",
            soul=soul,
            model_group="smart",
            tools=made,
            autonomy="ask",
            sop_ids=[],
            status="active",
            color=p["color"],
            heartbeat=bool(p["heartbeat"]),
            reports_to=None,
            owner_user_id=user.id,
            private=False,
            is_twin=True,
        )
        db.add(a)
        try:
            await db.flush()
        except IntegrityError as e:  # a second create raced this one: one twin per person
            await db.rollback()
            raise api_error(
                status.HTTP_409_CONFLICT,
                "twin_exists",
                "You already have your AI twin. You can change it any time.",
            ) from e
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "agent.created",
            target=a.id,
            after={
                "name": a.name,
                "role": a.role,
                "branch_id": a.branch_id,
                "department_id": a.department_id,
                "owner_user_id": a.owner_user_id,
                "is_twin": True,
            },
            note="AI twin",
        )
    else:
        tools = twin.keep_stricter(made, dict(a.tools or {}), old.get("_tools") or {})
        changes: dict[str, Any] = {
            "name": p["name"],
            "role": p["role"],
            "soul": soul,
            "color": p["color"],
            "heartbeat": bool(p["heartbeat"]),
            "tools": tools,
            "branch_id": home.branch.id,
            "department_id": dept_id,
        }
        changes = {k: v for k, v in changes.items() if getattr(a, k) != v}
        before = {k: getattr(a, k) for k in changes if k != "soul"}
        for k, v in changes.items():
            setattr(a, k, v)
        await audit.record(
            db,
            ws.id,
            principal.actor,
            "agent.updated",
            target=a.id,
            before=before,
            after={k: v for k, v in changes.items() if k != "soul"},
            note="twin persona saved",
        )
    await db.commit()
    await db.refresh(a)
    facts = twin.profile_facts(p, home)
    author = _author(principal)
    await twin.write_profile(db, ws, a, {**p, "_tools": made, "_facts": facts}, author)
    await twin.seed_user_memory(db, ws, a, facts, list(old.get("_facts") or []), author)
    await events.publish(ws.id, "agent.upsert", {"agent_id": a.id, "name": a.name})
    out = await _state(db, principal)
    out["polished"] = polished is not None
    return out


@router.get("/me/twin")
async def my_twin(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    return await _state(db, principal)


@router.post("/me/twin/preview")
async def preview_twin(
    body: TwinIn,
    principal: Principal = Depends(own_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """What the answers would make, without saving: the persona text, tools and memory."""
    home = await twin.home_of(db, principal.workspace_id, principal.user)
    mine = await twin.twin_of(db, principal.workspace_id, principal.user.id)
    old = (await twin.read_profile(db, mine) or {}) if mine else {}
    p = _answers({**twin.suggestions(home), **old}, body)
    text = twin.intro(p, principal.user.name, home.where_for(p["role"]))
    polished = await twin.polish(db, principal.workspace_id, text) if body.polish else None
    return {
        "soul": twin.soul(p, principal.user.name, home.where_for(p["role"]), polished),
        "polished": polished is not None,
        "tools": twin.tools_for(p["helps_with"], p["ask_first"]),
        "facts": twin.profile_facts(p, home),
    }


@router.post("/me/twin", status_code=status.HTTP_201_CREATED)
async def create_twin(
    body: TwinIn,
    principal: Principal = Depends(own_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await refuse_second_agent(db, principal)
    return await _save(db, principal, None, body)


@router.patch("/me/twin")
async def update_twin(
    body: TwinIn,
    principal: Principal = Depends(own_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    mine = await twin.twin_of(db, principal.workspace_id, principal.user.id)
    if mine is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "no_twin", "You have no AI twin yet.")
    return await _save(db, principal, mine, body)


@router.post("/me/twin/adopt")
async def adopt_twin(
    body: AdoptIn,
    principal: Principal = Depends(own_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Make an agent the person already owns their twin, instead of adding a second one."""
    ws_id, user = principal.workspace_id, principal.user
    mine = await twin.twin_of(db, ws_id, user.id)
    if mine is not None:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "twin_exists",
            "You already have your AI twin, {name}. You can change it any time.",
            name=mine.name,
        )
    a = next((x for x in await twin.adoptable(db, ws_id, user.id) if x.id == body.agent_id), None)
    if a is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND,
            "agent_not_found",
            "Only an agent of your own can become your twin.",
        )
    home = await twin.home_of(db, ws_id, user)
    await twin.free_retired_place(db, ws_id, user.id)
    before = {"branch_id": a.branch_id, "department_id": a.department_id, "autonomy": a.autonomy}
    tools = dict(a.tools or {})
    for key in twin.LOCKED_ASKS:  # sending forms, code and outside tools always ask
        for name in twin.ASK_BY_KEY[key].tools:
            if mode_of(tools, name) == "allow":
                tools[name] = "ask"
    a.is_twin, a.tools, a.autonomy = True, tools, "ask"
    a.role_kind, a.reports_to = "leaf", None
    if home.branch is not None:
        a.branch_id = home.branch.id
        a.department_id = home.department.id if home.department else None
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT, "twin_exists", "You already have your AI twin."
        ) from e
    await audit.record(
        db,
        ws_id,
        principal.actor,
        "agent.updated",
        target=a.id,
        before=before,
        after={
            "is_twin": True,
            "branch_id": a.branch_id,
            "department_id": a.department_id,
            "autonomy": "ask",
        },
        note="made AI twin",
    )
    await db.commit()
    await db.refresh(a)
    await twin.seed_basic(db, a, user)
    await events.publish(ws_id, "agent.upsert", {"agent_id": a.id, "name": a.name})
    return await _state(db, principal)


@router.post("/me/twin/teach")
async def teach_twin(
    body: TeachIn,
    principal: Principal = Depends(own_perm()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Tell the twin one thing to keep in mind (core memory: about you, or a working note)."""
    mine = await twin.twin_of(db, principal.workspace_id, principal.user.id)
    if mine is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "no_twin", "You have no AI twin yet.")
    text = " ".join(body.text.split())
    if threats.scan(text, "strict"):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_saved",
            "Not saved: memory cannot change the rules, approvals or SOPs.",
        )
    if _SECRET.search(text):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "not_saved",
            "Not saved: never keep passwords, keys, card or IC numbers in memory.",
        )
    mem = await core_memory.read(db, mine)
    items = mem[body.target]
    if not any(text.lower() == e.lower() for e in items):
        try:
            await core_memory.write(
                db, await _ws(db, principal), mine, body.target, [*items, text], _author(principal)
            )
        except core_memory.MemoryFull as e:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "memory_full",
                "{name}'s memory is full. Remove or merge a few entries first.",
                name=mine.name,
            ) from e
        mem = await core_memory.read(db, mine)
    return {
        "memory": mem["memory"],
        "user": mem["user"],
        "caps": core_memory.CAPS,
        "used": {k: core_memory.used(v) for k, v in mem.items()},
    }
