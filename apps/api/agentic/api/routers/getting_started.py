"""P109 Getting started: each person's checklist for their role, and their guided tours.

Fitri (17 Nov 2026): newcomers see what to set up first, in their role's order (owners set up
the system mail, the workspace, the Library's sources, companies and people, the AI engine;
staff connect their email, set up their workspace and then customise their own AI), and a
guided tour of every page they can start again at any time.

GET  /api/getting-started  the steps for this person's role, each ticked from real data
                           (one round trip of EXISTS checks), from a tour they took, or by hand
PUT  /api/getting-started  tick a step by hand, mark a tour seen, the welcome tour's state and
                           where to resume it

Only the person's own membership is read or written (memberships.getting_started), so the
progress is per person and per workspace; workspace facts (a company, a provider) are the
office's, everything else is theirs.
"""

import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.workspace_settings import system_mail
from ...models import (
    Agent,
    AIProvider,
    Approval,
    AuditLog,
    Branch,
    Channel,
    ChannelLink,
    DeskItem,
    DocFile,
    Membership,
    MicrosoftAccount,
    ModelGroup,
    PushSubscription,
    StorageTarget,
    Task,
    User,
    Workspace,
)
from ...prima.client import company_map
from ...sharepoint.models import LinkedSource
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/getting-started", tags=["getting-started"])

Group = Literal["owner", "admin", "branch", "hod", "staff"]

GROUP_OF_ROLE: dict[str, Group] = {
    "owner": "owner",
    "admin": "admin",
    "management": "admin",
    "hr": "admin",
    "operator": "admin",
    "branch_manager": "branch",
    "hod": "hod",
    "supervisor": "hod",
    "staff": "staff",
    "approver": "staff",
    "viewer": "staff",
}

ALL: frozenset[str] = frozenset({"owner", "admin", "branch", "hod", "staff"})
MANAGERS: frozenset[str] = frozenset({"admin", "branch", "hod"})
OWN_AI = ("agents.own", "assistants.use")


@dataclass(frozen=True)
class Step:
    key: str
    groups: frozenset[str]
    # Done when any of these facts is true, or any of these tours was taken.
    signals: tuple[str, ...] = ()
    tours: tuple[str, ...] = ()
    # Shown only to people with one of these permissions (or these roles).
    perm: tuple[str, ...] = ()
    roles: tuple[str, ...] = ()
    optional: bool = False
    # Nothing in the data says it is done (a look around): the person may tick it.
    manual: bool = False


# In the order people do them. The app holds each step's words and where it leads.
STEPS: tuple[Step, ...] = (
    Step("welcome", ALL, signals=("welcome_done",), manual=True),
    Step("account", ALL, signals=("password",)),
    Step(
        "email",
        ALL,
        signals=("microsoft",),
        perm=("agents.own", "assistants.use", "channels.manage"),
    ),
    Step("language", ALL, signals=("language",), optional=True),
    # Owners set up the office.
    Step("system_mail", frozenset({"owner"}), signals=("system_mail",), roles=("owner",)),
    Step(
        "workspace_settings",
        frozenset({"owner"}),
        signals=("settings_changed",),
        tours=("settings",),
        manual=True,
    ),
    Step("ai_engine", frozenset({"owner"}), signals=("ai_engine",), perm=("engine.manage",)),
    Step("companies", frozenset({"owner", "admin"}), signals=("company",), perm=("org.manage",)),
    Step(
        "prima_map",
        frozenset({"owner"}),
        signals=("prima_map",),
        perm=("org.manage",),
        optional=True,
    ),
    Step(
        "library_sources",
        frozenset({"owner"}),
        signals=("library_sources",),
        perm=("storage.manage", "org.manage"),
        manual=True,
    ),
    Step(
        "members",
        frozenset({"owner", "admin", "branch"}),
        signals=("people",),
        perm=("members.manage", "team.manage"),
    ),
    Step(
        "roles",
        frozenset({"owner"}),
        signals=("roles_set",),
        tours=("members",),
        roles=("owner",),  # only an owner changes what each role may do (auth.py)
        optional=True,
        manual=True,
    ),
    # Managers check their people.
    Step(
        "team", frozenset({"branch", "hod"}), signals=("has_team",), tours=("members",), manual=True
    ),
    # Everyone's own desk and AI.
    Step("workspace", ALL, signals=("desk",), tours=("workspace",)),
    Step("own_ai", ALL, signals=("own_ai",), perm=OWN_AI),
    Step("ai_custom", ALL, signals=("ai_custom",), perm=OWN_AI),
    Step("library", ALL, signals=("library_upload",), tours=("library",), manual=True),
    Step("first_task", ALL, signals=("task_created",), perm=("work.write",)),
    Step(
        "approvals",
        MANAGERS,
        signals=("approved",),
        tours=("approvals",),
        perm=("approvals.decide",),
        optional=True,
        manual=True,
    ),
    Step("phone", ALL, signals=("phone",), optional=True),
)
STEP_KEYS = frozenset(s.key for s in STEPS)

TOUR_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_TOURS = 80
Welcome = Literal["started", "done", "skipped"]


def steps_for(principal: Principal) -> list[Step]:
    group = GROUP_OF_ROLE.get(principal.role, "staff")
    perms = set(principal.permissions)
    return [
        s
        for s in STEPS
        if group in s.groups
        and (not s.perm or perms.intersection(s.perm))
        and (not s.roles or principal.role in s.roles)
    ]


def _state(m: Membership) -> dict[str, Any]:
    raw = m.getting_started if isinstance(m.getting_started, dict) else {}
    marked = [k for k in raw.get("marked", []) if isinstance(k, str) and k in STEP_KEYS]
    tours = [t for t in raw.get("tours", []) if isinstance(t, str) and TOUR_ID.match(t)]
    welcome = raw.get("welcome") if raw.get("welcome") in ("started", "done", "skipped") else None
    resume = raw.get("resume")
    ok = (
        isinstance(resume, dict)
        and isinstance(resume.get("tour"), str)
        and TOUR_ID.match(resume["tour"])
        and isinstance(resume.get("step"), int)
    )
    return {
        "marked": marked,
        "tours": tours,
        "welcome": welcome,
        "resume": {"tour": resume["tour"], "step": resume["step"]} if ok else None,
        "dismissed": raw.get("dismissed") is True,
    }


class StepOut(BaseModel):
    key: str
    done: bool
    # How it was found done: "data" (real data), "tour" (they took its tour), "hand" (ticked).
    by: Literal["data", "tour", "hand"] | None
    optional: bool
    manual: bool


class Resume(BaseModel):
    tour: str = Field(pattern=TOUR_ID.pattern)
    step: int = Field(ge=0, le=60)


class ProgressOut(BaseModel):
    role: str
    group: Group
    is_developer: bool
    steps: list[StepOut]
    done: int
    total: int
    complete: bool
    tours_seen: list[str]
    welcome: Welcome | None
    resume: Resume | None
    dismissed: bool


class ProgressIn(BaseModel):
    # step key -> ticked (true) or not (false); only steps that may be ticked by hand.
    mark: dict[str, bool] | None = None
    tour_seen: str | None = Field(default=None, pattern=TOUR_ID.pattern)
    welcome: Welcome | None = None
    # Where the running tour is (null: none running).
    resume: Resume | None = None
    dismissed: bool | None = None


async def _membership(db: AsyncSession, principal: Principal, lock: bool = False) -> Membership:
    q = select(Membership).where(
        Membership.workspace_id == principal.workspace_id,
        Membership.user_id == principal.user.id,
    )
    if lock:
        q = q.with_for_update(of=Membership).execution_options(populate_existing=True)
    m = (await db.execute(q)).unique().scalar_one_or_none()
    if m is None:  # the session's membership went away mid-request
        raise api_error(status.HTTP_404_NOT_FOUND, "not_found", "Not found.")
    return m


async def _signals(
    db: AsyncSession, principal: Principal, m: Membership, state: dict[str, Any]
) -> dict[str, bool]:
    ws, uid, actor = principal.workspace_id, principal.user.id, principal.actor
    own = (
        Agent.workspace_id == ws,
        Agent.owner_user_id == uid,
        Agent.status != "retired",
        or_(Agent.is_twin.is_(True), Agent.private.is_(True)),
    )
    phone_kinds = ("whatsapp", "telegram")
    checks: dict[str, Any] = {
        "microsoft": exists().where(
            MicrosoftAccount.workspace_id == ws, MicrosoftAccount.user_id == uid
        ),
        "settings_changed": exists().where(
            AuditLog.workspace_id == ws, AuditLog.action.like("settings.%")
        ),
        "ai_engine": exists().where(AIProvider.workspace_id == ws)
        & exists().where(
            ModelGroup.workspace_id == ws, func.jsonb_array_length(ModelGroup.members) > 0
        ),
        "company": exists().where(Branch.workspace_id == ws),
        "library_sources": exists().where(LinkedSource.workspace_id == ws)
        | exists().where(StorageTarget.workspace_id == ws),
        "people": select(func.count())
        .select_from(Membership)
        .where(Membership.workspace_id == ws)
        .scalar_subquery()
        > 1,
        "has_team": exists().where(
            Membership.workspace_id == ws, Membership.reports_to_user_id == uid
        ),
        "desk": exists().where(DeskItem.workspace_id == ws, DeskItem.user_id == uid),
        "own_ai": exists().where(*own),
        "ai_custom": exists().where(
            *own,
            or_(
                Agent.work_hours.is_not(None),
                Agent.updated_at > Agent.created_at + timedelta(minutes=1),
            ),
        ),
        "library_upload": exists().where(
            DocFile.workspace_id == ws, DocFile.library.is_(True), DocFile.created_by == actor
        ),
        "task_created": exists().where(Task.workspace_id == ws, Task.created_by == actor),
        "approved": exists().where(Approval.workspace_id == ws, Approval.decided_by == actor),
        "phone": exists().where(
            PushSubscription.workspace_id == ws, PushSubscription.user_id == uid
        )
        | exists()
        .where(ChannelLink.user_id == uid, ChannelLink.channel_id == Channel.id)
        .where(Channel.workspace_id == ws, Channel.kind.in_(phone_kinds)),
    }
    row = (await db.execute(select(*(c.label(k) for k, c in checks.items())))).one()
    out = {k: bool(v) for k, v in row._mapping.items()}

    user = await db.get(User, uid)
    wsrow = await db.get(Workspace, ws)
    settings = (wsrow.settings if wsrow else None) or {}
    prefs = (user.prefs if user else None) or {}
    locale = prefs.get("locale") if isinstance(prefs.get("locale"), dict) else {}
    out["microsoft"] = out["microsoft"] or bool(m.ms_oid)
    out["password"] = bool(user and not user.must_change_password)
    out["language"] = locale.get("language") in ("en", "ms")
    out["system_mail"] = system_mail(settings).enabled
    out["prima_map"] = bool(company_map(wsrow))
    out["roles_set"] = bool(settings.get("role_permissions"))
    out["has_team"] = out["has_team"] or bool(m.heads_department)
    out["desk"] = out["desk"] or isinstance(prefs.get("desk"), dict)
    out["welcome_done"] = state["welcome"] == "done"
    return out


async def _progress(db: AsyncSession, principal: Principal, m: Membership) -> ProgressOut:
    state = _state(m)
    signals = await _signals(db, principal, m, state)
    seen = set(state["tours"])
    marked = set(state["marked"])
    out: list[StepOut] = []
    for s in steps_for(principal):
        by: Literal["data", "tour", "hand"] | None = None
        if any(signals.get(k) for k in s.signals):
            by = "data"
        elif any(t in seen for t in s.tours):
            by = "tour"
        elif s.manual and s.key in marked:
            by = "hand"
        out.append(
            StepOut(key=s.key, done=by is not None, by=by, optional=s.optional, manual=s.manual)
        )
    needed = [s for s in out if not s.optional]
    done = sum(1 for s in needed if s.done)
    return ProgressOut(
        role=principal.role,
        group=GROUP_OF_ROLE.get(principal.role, "staff"),
        is_developer=bool(principal.user.is_developer and principal.role == "owner"),
        steps=out,
        done=done,
        total=len(needed),
        complete=done >= len(needed),
        tours_seen=state["tours"],
        welcome=state["welcome"],
        resume=Resume(**state["resume"]) if state["resume"] else None,
        dismissed=state["dismissed"],
    )


@router.get("")
async def get_progress(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> ProgressOut:
    return await _progress(db, principal, await _membership(db, principal))


@router.put("")
async def put_progress(
    body: ProgressIn,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> ProgressOut:
    """Save what the person did: {"mark": {"library": true}}, {"tour_seen": "tasks"},
    {"welcome": "done", "resume": null}... Anything left out stays as it was."""
    sent = body.model_fields_set
    m = await _membership(db, principal, lock=True)
    state = _state(m)
    if body.mark:
        allowed = {s.key for s in steps_for(principal) if s.manual}
        bad = sorted(set(body.mark) - allowed)
        if bad:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "bad_step",
                "That step cannot be ticked by hand: {steps}.",
                steps=", ".join(bad),
            )
        marked = [k for k in state["marked"] if body.mark.get(k) is not False]
        marked += [k for k, v in body.mark.items() if v and k not in marked]
        state["marked"] = marked
    if body.tour_seen and body.tour_seen not in state["tours"]:
        state["tours"] = [*state["tours"], body.tour_seen][-MAX_TOURS:]
    if "welcome" in sent:
        state["welcome"] = body.welcome
    if "resume" in sent:
        state["resume"] = body.resume.model_dump() if body.resume else None
    if body.dismissed is not None:
        state["dismissed"] = body.dismissed
    if sent:
        m.getting_started = state  # a new dict, so the JSONB column is marked dirty
        await db.commit()
    return await _progress(db, principal, m)
