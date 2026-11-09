"""P92: the lessons people taught the agents, and the daily "getting smarter" digest.

- GET  /api/lessons                    lessons (filter by topic, agent, state, words)
- PATCH /api/lessons/{id}              edit a lesson (owner/admin); the edit is a new lesson
- POST /api/lessons/{id}/forget        forget a lesson (owner/admin)
- POST /api/lessons/{id}/undo          take back a lesson just taught (whoever taught it, or
                                       owner/admin); the lesson it replaced comes back
- GET  /api/learning/digest            one day: lessons learned, skills improved, repeated
                                       mistakes (no model call)

Who sees what: owners and workspace roles see every lesson except other people's private
assistants'; everyone else (staff included) sees the lessons of the agents they see, which for
staff is their own AI. Editing and forgetting is owner/admin (brain.manage).
"""

from dataclasses import replace
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...brain import facts as brain_facts
from ...brain import lessons
from ...brain.scope import Viewer, for_person, sees_fact
from ...core.db import get_db
from ...core.security import can
from ...models import Agent, BrainFact, Skill, SkillProposal, SkillVersion, Workspace
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["learning"])

UNDO_DAYS = 7  # whoever taught a lesson may take it back for this long


async def _viewer(db: AsyncSession, principal: Principal) -> Viewer:
    """What this person may recall (brain.scope.for_person); staff keep to their own AI: they
    watch their colleagues' agents, but what people taught those is not theirs to read."""
    v = await for_person(db, principal.workspace_id, principal.scope)
    if principal.scope.kind != "own":
        return v
    own = (
        await db.scalars(
            select(Agent.id).where(
                Agent.workspace_id == principal.workspace_id,
                Agent.owner_user_id == principal.user.id,
            )
        )
    ).all()
    return replace(v, agent_ids=frozenset(own))


def _visible(v: Viewer, principal: Principal, include_ended: bool = True) -> ColumnElement[bool]:
    conds = [
        BrainFact.workspace_id == principal.workspace_id,
        BrainFact.source_kind == lessons.KIND,
        brain_facts.scope_filter(v, include_ended),
    ]
    if not principal.scope.everything:
        # Office roles and staff: only lessons taught to the agents they see.
        conds.append(BrainFact.meta["agent_id"].astext.in_(sorted(v.agent_ids or ())))
    return and_(*conds)


def _sees(v: Viewer, principal: Principal, f: BrainFact) -> bool:
    if f.workspace_id != principal.workspace_id or f.source_kind != lessons.KIND:
        return False
    if not sees_fact(v, f):
        return False
    return principal.scope.everything or (f.meta or {}).get("agent_id") in (v.agent_ids or ())


async def _names(db: AsyncSession, rows: list[BrainFact]) -> dict[str, str]:
    from .brain import _names as actor_names

    agent_ids = {
        str((f.meta or {}).get("agent_id")) for f in rows if (f.meta or {}).get("agent_id")
    }
    out = await actor_names(db, {f.created_by for f in rows})
    if agent_ids:
        for aid, name in (
            await db.execute(select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids)))
        ).all():
            out[f"agent:{aid}"] = name
    return out


def _out(f: BrainFact, names: dict[str, str], principal: Principal) -> dict[str, Any]:
    m = f.meta or {}
    topic = str(m.get("topic") or lessons.GENERAL)
    aid = m.get("agent_id")
    manage = can(principal.role, "brain.manage")
    fresh = f.valid_from >= lessons._now() - timedelta(days=UNDO_DAYS)
    return {
        "id": f.id,
        "text": f.text,
        "topic": topic,
        "topic_label": lessons.topic_label(topic),
        **{k: m.get(k) or None for k in lessons.FIELDS},
        "agent_id": aid,
        "agent_name": names.get(f"agent:{aid}") if aid else None,
        "private": f.agent_id is not None,
        "via": m.get("via"),
        "taught_by": f.created_by,
        "taught_by_name": names.get(f.created_by, "Unknown"),
        "taught_at": f.valid_from,
        "taught": int(m.get("taught") or 1),
        "uses": f.hits,
        "last_used_at": f.last_used_at,
        "task_id": m.get("task_id"),
        "folded_into": (m.get("folded") or {}).get("skill"),
        "state": "active" if f.valid_to is None else "ended",
        "end_reason": f.end_reason,
        "ended_at": f.valid_to,
        "superseded_by": f.superseded_by,
        "can_edit": manage and f.valid_to is None,
        "can_undo": f.valid_to is None and (manage or (f.created_by == principal.actor and fresh)),
    }


async def _lesson(
    db: AsyncSession, principal: Principal, lesson_id: str
) -> tuple[BrainFact, Viewer]:
    v = await _viewer(db, principal)
    f = await db.get(BrainFact, lesson_id)
    if f is None or not _sees(v, principal, f):
        raise api_error(status.HTTP_404_NOT_FOUND, "lesson_not_found", "That lesson is not here.")
    return f, v


@router.get("/lessons")
async def list_lessons(
    topic: str | None = Query(default=None, max_length=60),
    agent_id: str | None = Query(default=None, max_length=40),
    state: Literal["active", "ended", "all"] = "active",
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=300),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    v = await _viewer(db, principal)
    base = _visible(v, principal)
    conds = [base]
    if state == "active":
        conds.append(BrainFact.valid_to.is_(None))
    elif state == "ended":
        conds.append(BrainFact.valid_to.is_not(None))
    if topic:
        conds.append(BrainFact.meta["topic"].astext == topic)
    if agent_id:
        conds.append(BrainFact.meta["agent_id"].astext == agent_id)
    if q and q.strip():
        conds.append(BrainFact.text.ilike(f"%{q.strip()}%"))
    rows = list(
        (
            await db.scalars(
                select(BrainFact).where(*conds).order_by(BrainFact.valid_from.desc()).limit(limit)
            )
        ).all()
    )
    names = await _names(db, rows)
    # The filters: every topic and agent with an active lesson this person may see.
    topics = (
        await db.execute(
            select(BrainFact.meta["topic"].astext, func.count())
            .where(base, BrainFact.valid_to.is_(None))
            .group_by(text("1"))  # one expression, not two binds
        )
    ).all()
    agent_rows = (
        await db.execute(
            select(BrainFact.meta["agent_id"].astext, func.count())
            .where(base, BrainFact.valid_to.is_(None))
            .group_by(text("1"))
        )
    ).all()
    agent_names = dict(
        (
            await db.execute(
                select(Agent.id, Agent.name).where(Agent.id.in_([a for a, _ in agent_rows if a]))
            )
        ).all()
    )
    return {
        "items": [_out(f, names, principal) for f in rows],
        "topics": sorted(
            (
                {"key": t or lessons.GENERAL, "label": lessons.topic_label(t), "count": int(n)}
                for t, n in topics
            ),
            key=lambda x: (-x["count"], x["label"]),
        ),
        "agents": sorted(
            (
                {"id": a, "name": agent_names.get(a, "Agent"), "count": int(n)}
                for a, n in agent_rows
                if a
            ),
            key=lambda x: x["name"].lower(),
        ),
        "can_edit": can(principal.role, "brain.manage"),
    }


class LessonEditIn(BaseModel):
    text: str | None = Field(default=None, max_length=lessons.MAX_TEXT)
    when: str | None = Field(default=None, max_length=lessons.MAX_FIELD)
    do: str | None = Field(default=None, max_length=lessons.MAX_FIELD)
    dont: str | None = Field(default=None, max_length=lessons.MAX_FIELD)
    field: str | None = Field(default=None, max_length=lessons.MAX_FIELD)
    example: str | None = Field(default=None, max_length=lessons.MAX_FIELD)
    topic: str | None = Field(default=None, max_length=60)


@router.patch("/lessons/{lesson_id}")
async def edit_lesson(
    lesson_id: str,
    body: LessonEditIn,
    principal: Principal = Depends(require("brain.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A correction of a lesson is itself recorded: the edit is a new lesson that replaces
    the old one, which is kept (ended) with who changed it and when."""
    old, _ = await _lesson(db, principal, lesson_id)
    if old.valid_to is not None:
        raise api_error(status.HTTP_409_CONFLICT, "lesson_ended", "This lesson is not in use.")
    changes = body.model_dump(exclude_unset=True)
    try:
        new = await lessons.correct(db, old, changes, principal.actor)
    except ValueError as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_lesson",
            "Write the lesson as one short sentence, with no passwords, codes or other secrets.",
        ) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "lesson.edited",
        target=new.id,
        before={"id": old.id, "text": old.text},
        after={"id": new.id, "text": new.text},
    )
    await db.commit()
    return _out(new, await _names(db, [new]), principal)


@router.post("/lessons/{lesson_id}/forget")
async def forget_lesson(
    lesson_id: str,
    principal: Principal = Depends(require("brain.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    f, _ = await _lesson(db, principal, lesson_id)
    if f.valid_to is None:
        brain_facts.end(f, "forgotten")
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "lesson.forgotten",
            target=f.id,
            before={"text": f.text},
        )
        await db.commit()
    return _out(f, await _names(db, [f]), principal)


@router.post("/lessons/{lesson_id}/undo")
async def undo_lesson(
    lesson_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """ "Noted for next time ... Undo": the person who taught it takes it back (or an
    owner/admin). The lesson it replaced, if any, is used again."""
    f, _ = await _lesson(db, principal, lesson_id)
    names = await _names(db, [f])
    if not _out(f, names, principal)["can_undo"]:
        if f.valid_to is not None:
            raise api_error(status.HTTP_409_CONFLICT, "lesson_ended", "This lesson is not in use.")
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "not_your_lesson",
            "Only the person who taught this lesson, or an owner or admin, can undo it.",
        )
    back = await lessons.undo(db, f)
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "lesson.undone",
        target=f.id,
        before={"text": f.text},
        after={"restored": back.id} if back is not None else None,
    )
    await db.commit()
    rows = [f, *([back] if back is not None else [])]
    names = await _names(db, rows)
    return {
        "lesson": _out(f, names, principal),
        "restored": _out(back, names, principal) if back is not None else None,
    }


@router.get("/learning/digest")
async def digest(
    day: date | None = Query(default=None),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """ "Getting smarter every day": what one day taught (default today, workspace time).
    Built from what the office keeps, without a model call."""
    from ...crm.service import today

    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    day = day or await today(db, ws.id)
    start, end = lessons.day_bounds(day, ws.timezone)
    v = await _viewer(db, principal)
    base = _visible(v, principal)
    learned = list(
        (
            await db.scalars(
                select(BrainFact)
                .where(
                    base,
                    BrainFact.valid_from >= start,
                    BrainFact.valid_from < end,
                    or_(BrainFact.end_reason.is_(None), BrainFact.end_reason != "undone"),
                )
                .order_by(BrainFact.valid_from.desc())
                .limit(100)
            )
        ).all()
    )
    taught_again = BrainFact.meta["last_taught_at"].astext
    repeated = [
        f
        for f in (
            await db.scalars(
                select(BrainFact)
                .where(
                    base,
                    BrainFact.valid_to.is_(None),
                    taught_again >= start.isoformat(),
                    taught_again < end.isoformat(),
                )
                .limit(200)
            )
        ).all()
        if int((f.meta or {}).get("taught") or 1) >= 2
    ]
    repeated.sort(key=lambda f: -int((f.meta or {}).get("taught") or 1))
    skills: list[dict[str, Any]] = []
    folds: list[dict[str, Any]] = []
    if can(principal.role, "office.view"):
        for ver, name in (
            await db.execute(
                select(SkillVersion, Skill.name)
                .join(Skill, Skill.id == SkillVersion.skill_id)
                .where(
                    Skill.workspace_id == ws.id,
                    SkillVersion.created_at >= start,
                    SkillVersion.created_at < end,
                )
                .order_by(SkillVersion.created_at.desc())
                .limit(30)
            )
        ).all():
            skills.append(
                {
                    "skill_id": ver.skill_id,
                    "name": name,
                    "version": ver.version,
                    "note": ver.note,
                    "auto": ver.approved_by == "system:autopilot",
                    "at": ver.created_at,
                }
            )
        for p in (
            await db.scalars(
                select(SkillProposal).where(
                    SkillProposal.workspace_id == ws.id,
                    SkillProposal.proposed_by == lessons.FOLD_BY,
                    SkillProposal.created_at >= start,
                    SkillProposal.created_at < end,
                )
            )
        ).all():
            folds.append({"id": p.id, "name": p.name, "status": p.status, "note": p.decision_note})
    names = await _names(db, learned + repeated)
    return {
        "day": day.isoformat(),
        "previous": (day - timedelta(days=1)).isoformat(),
        "next": (day + timedelta(days=1)).isoformat() if day < await today(db, ws.id) else None,
        "lessons": [_out(f, names, principal) for f in learned],
        "repeated": [_out(f, names, principal) for f in repeated],
        "skills": skills,
        "folds": folds,
        "totals": {
            "lessons": len(learned),
            "replaced": sum(1 for f in learned if (f.meta or {}).get("replaced")),
            "repeated": len(repeated),
            "skills": len(skills),
        },
    }
