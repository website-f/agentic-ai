"""The learning engine, made visible (P17): what the office learned, how, and at what cost.

- GET  /api/learning/overview          numbers, a daily series and the latest decisions
- PUT  /api/learning/settings          the skill autopilot mode (review | auto_safe | auto)
- POST /api/learning/learn-source      learn a skill from a link, a file or pasted notes
- POST /api/skills/{id}/revert         put an earlier skill version back live
- GET  /api/learning/trajectories.jsonl  finished work as ShareGPT-style training data
"""

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...brain.store import Author
from ...core.db import get_db
from ...core.redact import redact
from ...models import (
    Agent,
    AgentMessage,
    BrainFact,
    LLMCall,
    Skill,
    SkillProposal,
    SkillUse,
    SkillVersion,
    Task,
    Workspace,
)
from ...services import audit
from ...skills import autopilot
from ...skills.learn_source import SourceError, learn
from ...skills.store import SkillError
from ..deps import Principal, api_error, require
from .brain import _names

log = logging.getLogger("agentic.api.learning")

router = APIRouter(prefix="/api", tags=["learning"])

LEARNING_TASKS = ("skill.", "brain.", "colleague.memory")
MODE_LABELS = {
    "review": "A person reviews every skill change",
    "auto_safe": "Proven changes go live by themselves",
    "auto": "Clean changes go live, tested or not",
}


def _rate(ok: int, total: int) -> float | None:
    return round(ok / total, 3) if total else None


async def _uses(db: AsyncSession, ws_id: str, start: datetime, end: datetime) -> dict[str, int]:
    rows = (
        await db.execute(
            select(SkillUse.outcome, func.count())
            .where(
                SkillUse.workspace_id == ws_id,
                SkillUse.created_at >= start,
                SkillUse.created_at < end,
            )
            .group_by(SkillUse.outcome)
        )
    ).all()
    out = {str(o or "open"): int(n) for o, n in rows}
    out["total"] = sum(n for _, n in rows)
    return out


def _judged(u: dict[str, int]) -> int:
    return u.get("accepted", 0) + u.get("sent_back", 0) + u.get("failed", 0)


def _eval_brief(ev: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ev:
        return None
    new, old = ev.get("new") or {}, ev.get("old") or {}
    return {
        "new": [new.get("passed"), new.get("total")] if new.get("total") else None,
        "old": [old.get("passed"), old.get("total")] if old.get("total") else None,
        "error": new.get("error"),
    }


@router.get("/learning/overview")
async def overview(
    days: int = Query(30, ge=1, le=180),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    now = datetime.now(UTC)
    since, before = now - timedelta(days=days), now - timedelta(days=2 * days)
    wid = ws.id

    proposals = (
        await db.scalars(
            select(SkillProposal).where(
                SkillProposal.workspace_id == wid, SkillProposal.created_at >= since
            )
        )
    ).all()
    by_status: dict[str, int] = {}
    for p in proposals:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    decided = (
        await db.scalars(
            select(SkillProposal).where(
                SkillProposal.workspace_id == wid,
                SkillProposal.decided_at >= since,
                SkillProposal.status == "approved",
            )
        )
    ).all()
    auto = sum(1 for p in decided if p.decided_by == autopilot.AUTOPILOT.actor)
    waiting = int(
        await db.scalar(
            select(func.count())
            .select_from(SkillProposal)
            .where(SkillProposal.workspace_id == wid, SkillProposal.status == "pending")
        )
        or 0
    )
    rates = [
        ev["new"]["passed"] / ev["new"]["total"]
        for ev in (p.eval or {} for p in proposals)
        if (ev.get("new") or {}).get("total")
    ]
    eval_rate = round(sum(rates) / len(rates), 3) if rates else None

    now_uses, prev_uses = await _uses(db, wid, since, now), await _uses(db, wid, before, since)

    active = int(
        await db.scalar(
            select(func.count())
            .select_from(Skill)
            .where(Skill.workspace_id == wid, Skill.status == "active")
        )
        or 0
    )
    versions = int(
        await db.scalar(
            select(func.count())
            .select_from(SkillVersion)
            .join(Skill, Skill.id == SkillVersion.skill_id)
            .where(Skill.workspace_id == wid, SkillVersion.created_at >= since)
        )
        or 0
    )

    facts_rows = (
        await db.execute(
            select(BrainFact.source_kind, func.count())
            .where(BrainFact.workspace_id == wid, BrainFact.valid_from >= since)
            .group_by(BrainFact.source_kind)
        )
    ).all()
    facts = {str(k): int(n) for k, n in facts_rows}
    replaced = int(
        await db.scalar(
            select(func.count())
            .select_from(BrainFact)
            .where(
                BrainFact.workspace_id == wid,
                BrainFact.valid_to >= since,
                BrainFact.superseded_by.is_not(None),
            )
        )
        or 0
    )

    is_learning = or_(*(LLMCall.task.startswith(t) for t in LEARNING_TASKS))
    spend = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
            ).where(LLMCall.workspace_id == wid, LLMCall.ts >= since, is_learning)
        )
    ).one()

    day = cast(SkillProposal.created_at, Date)
    series_p = {
        str(d): int(n)
        for d, n in (
            await db.execute(
                select(day, func.count())
                .where(SkillProposal.workspace_id == wid, SkillProposal.created_at >= since)
                .group_by(day)
            )
        ).all()
    }
    fday = cast(BrainFact.valid_from, Date)
    series_f = {
        str(d): int(n)
        for d, n in (
            await db.execute(
                select(fday, func.count())
                .where(BrainFact.workspace_id == wid, BrainFact.valid_from >= since)
                .group_by(fday)
            )
        ).all()
    }
    aday = cast(SkillProposal.decided_at, Date)
    series_a = {
        str(d): int(n)
        for d, n in (
            await db.execute(
                select(aday, func.count())
                .where(
                    SkillProposal.workspace_id == wid,
                    SkillProposal.decided_at >= since,
                    SkillProposal.status == "approved",
                )
                .group_by(aday)
            )
        ).all()
    }
    series = []
    for i in range(days - 1, -1, -1):
        d = str((now - timedelta(days=i)).date())
        series.append(
            {
                "day": d,
                "proposed": series_p.get(d, 0),
                "approved": series_a.get(d, 0),
                "facts": series_f.get(d, 0),
            }
        )

    recent = (
        await db.scalars(
            select(SkillProposal)
            .where(SkillProposal.workspace_id == wid)
            .order_by(func.coalesce(SkillProposal.decided_at, SkillProposal.created_at).desc())
            .limit(15)
        )
    ).all()
    names = await _names(
        db,
        {p.decided_by for p in recent if p.decided_by} | {p.proposed_by for p in recent},
    )
    names[autopilot.AUTOPILOT.actor] = autopilot.AUTOPILOT.name
    names.setdefault("curator", "Nightly curator")

    top_rows = (
        await db.execute(
            select(
                Skill.id,
                Skill.name,
                Skill.version,
                func.count(SkillUse.id),
                func.count(SkillUse.id).filter(SkillUse.outcome == "accepted"),
                func.count(SkillUse.id).filter(
                    SkillUse.outcome.in_(("accepted", "sent_back", "failed"))
                ),
            )
            .join(SkillUse, SkillUse.skill_id == Skill.id)
            .where(Skill.workspace_id == wid, SkillUse.created_at >= since)
            .group_by(Skill.id)
            .order_by(func.count(SkillUse.id).desc())
            .limit(8)
        )
    ).all()

    return {
        "days": days,
        "mode": autopilot.mode(ws),
        "modes": [{"key": k, "label": v} for k, v in MODE_LABELS.items()],
        "can_configure": principal.role in ("owner", "admin"),
        "proposals": {
            "created": len(proposals),
            "by_status": by_status,
            "approved_auto": auto,
            "approved_human": len(decided) - auto,
            "waiting": waiting,
            "eval_pass_rate": eval_rate,
        },
        "skills": {"active": active, "new_versions": versions},
        "uses": {
            "total": now_uses["total"],
            "accepted": now_uses.get("accepted", 0),
            "sent_back": now_uses.get("sent_back", 0),
            "failed": now_uses.get("failed", 0),
            "success_rate": _rate(now_uses.get("accepted", 0), _judged(now_uses)),
            "prev_success_rate": _rate(prev_uses.get("accepted", 0), _judged(prev_uses)),
        },
        "facts": {"learned": sum(facts.values()), "by_source": facts, "replaced": replaced},
        "spend": {
            "calls": int(spend[0]),
            "tokens": int(spend[1]),
            "cost_usd": float(spend[2] or 0),
        },
        "series": series,
        "top_skills": [
            {
                "id": sid,
                "name": name,
                "version": ver,
                "uses": int(uses),
                "success_rate": _rate(int(ok), int(j)),
            }
            for sid, name, ver, uses, ok, j in top_rows
        ],
        "recent": [
            {
                "id": p.id,
                "skill_id": p.skill_id,
                "name": p.name,
                "kind": p.kind,
                "status": p.status,
                "reason": p.reason[:300],
                "proposed_by": names.get(p.proposed_by, p.proposed_by.split(":")[0]),
                "decided_by": names.get(p.decided_by or "", None) if p.decided_by else None,
                "auto": p.status == "approved" and p.decided_by == autopilot.AUTOPILOT.actor,
                "note": p.decision_note,
                "eval": _eval_brief(p.eval),
                "created_at": p.created_at.isoformat(),
                "decided_at": p.decided_at.isoformat() if p.decided_at else None,
            }
            for p in recent
        ],
    }


class LearningSettingsIn(BaseModel):
    mode: Literal["review", "auto_safe", "auto"]


@router.put("/learning/settings")
async def update_settings(
    body: LearningSettingsIn,
    principal: Principal = Depends(require("brain.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    before = autopilot.mode(ws)
    current = dict(ws.settings or {})
    current["skill_learning"] = {**(current.get("skill_learning") or {}), "mode": body.mode}
    ws.settings = current  # a new dict, so the JSONB change is saved
    await audit.record(
        db,
        ws.id,
        principal.actor,
        "learning.mode",
        target=ws.id,
        before={"mode": before},
        after={"mode": body.mode},
    )
    await db.commit()
    return {"mode": body.mode}


class LearnSourceIn(BaseModel):
    url: str | None = Field(default=None, max_length=2000)
    file_id: str | None = Field(default=None, max_length=40)
    text: str | None = Field(default=None, max_length=60_000)
    focus: str = Field(default="", max_length=300)
    agent_id: str | None = Field(default=None, max_length=40)


@router.post("/learning/learn-source", status_code=status.HTTP_201_CREATED)
async def learn_source(
    body: LearnSourceIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    agent = None
    if body.agent_id:
        agent = await db.get(Agent, body.agent_id)
        if agent is None or agent.workspace_id != ws.id or not principal.scope.sees_agent(agent):
            raise api_error(status.HTTP_404_NOT_FOUND, "agent_not_found", "That agent is not here.")
    url = (body.url or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    try:
        p = await learn(
            db,
            ws,
            proposed_by=principal.actor,
            url=url or None,
            file_id=(body.file_id or "").strip() or None,
            text=body.text,
            focus=body.focus,
            agent=agent,
        )
    except (SourceError, SkillError) as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "cannot_learn", str(e)) from e
    try:  # tests first; the autopilot (or a person) decides when they are in
        await dispatch.start_skill_eval("proposal", p.id)
    except Exception:  # noqa: BLE001 - the nightly tidy tests it if the worker is down
        log.warning("could not start evals for %s", p.id, exc_info=True)
    return {"id": p.id, "name": p.name, "kind": p.kind, "status": p.status, "reason": p.reason}


class RevertIn(BaseModel):
    version: int = Field(ge=1)


@router.post("/skills/{skill_id}/revert")
async def revert_skill(
    skill_id: str,
    body: RevertIn,
    principal: Principal = Depends(require("approvals.decide")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    skill = await db.get(Skill, skill_id)
    if ws is None or skill is None or skill.workspace_id != ws.id:
        raise api_error(status.HTTP_404_NOT_FOUND, "skill_not_found", "That skill is not here.")
    try:
        skill = await autopilot.revert(
            db, ws, skill, body.version, Author(principal.actor, principal.user.name)
        )
    except SkillError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_revert", str(e)) from e
    return {"id": skill.id, "name": skill.name, "version": skill.version}


@router.post("/skills/{skill_id}/optimize", status_code=status.HTTP_202_ACCEPTED)
async def optimize_skill(
    skill_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """P18: rewrite the skill from its failing tests, test the variants, propose the best."""
    skill = await db.get(Skill, skill_id)
    if skill is None or skill.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "skill_not_found", "That skill is not here.")
    if skill.status != "active":
        raise api_error(status.HTTP_409_CONFLICT, "not_active", "Only active skills are optimized.")
    try:
        wid = await dispatch.start_skill_eval("optimize", skill.id)
    except Exception as e:  # noqa: BLE001
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "worker_unavailable",
            "The background worker is not reachable, so the optimizer cannot run.",
        ) from e
    return {"workflow_id": wid}


ROLE_MAP = {"system": "system", "user": "human", "assistant": "gpt", "tool": "tool"}
EXPORT_LIMIT = 2000


@router.get("/learning/trajectories.jsonl")
async def trajectories(
    days: int = Query(90, ge=1, le=365),
    outcome: Literal["accepted", "all"] = "accepted",
    principal: Principal = Depends(require("brain.manage")),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Finished tasks as ShareGPT conversations (one JSON per line), for fine-tuning or
    offline evals. Private agents are never exported; secrets are redacted."""
    since = datetime.now(UTC) - timedelta(days=days)
    statuses = ("done",) if outcome == "accepted" else ("done", "failed", "review")
    q = (
        select(Task, Agent.name)
        .join(Agent, Agent.id == Task.assignee_agent_id)
        .where(
            Task.workspace_id == principal.workspace_id,
            Task.status.in_(statuses),
            Task.updated_at >= since,
            Agent.private.is_(False),
        )
        .order_by(Task.updated_at.desc())
        .limit(EXPORT_LIMIT)
    )
    rows = (await db.execute(q)).all()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "learning.export",
        after={"tasks": len(rows), "days": days, "outcome": outcome},
    )
    await db.commit()

    async def lines() -> AsyncIterator[bytes]:
        for task, agent_name in rows:
            msgs = (
                await db.scalars(
                    select(AgentMessage)
                    .where(AgentMessage.task_id == task.id)
                    .order_by(AgentMessage.id)
                )
            ).all()
            conv = []
            for m in msgs:
                value = m.content or ""
                if m.role == "assistant" and m.tool_calls:
                    calls = [
                        {
                            "name": (c.get("function") or {}).get("name"),
                            "arguments": (c.get("function") or {}).get("arguments"),
                        }
                        for c in m.tool_calls
                    ]
                    value = (
                        (value + "\n" if value else "")
                        + "<tool_call>"
                        + json.dumps(calls, ensure_ascii=False)
                        + "</tool_call>"
                    )
                if not value:
                    continue
                conv.append({"from": ROLE_MAP.get(m.role, m.role), "value": redact(value)})
            if len(conv) < 2:
                continue
            record = {
                "id": task.id,
                "conversations": conv,
                "meta": {
                    "agent": agent_name,
                    "title": redact(task.title),
                    "status": task.status,
                    "runs": task.run_count,
                },
            }
            yield (json.dumps(record, ensure_ascii=False) + "\n").encode()

    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="trajectories-{stamp}.jsonl"'},
    )
