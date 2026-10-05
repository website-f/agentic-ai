"""Impact (P19): what the AI office measurably did for each company, from real records only.

Counts come straight from tasks, model calls, approvals and skills, inside the viewer's scope
(the same rules as the company overview). Nothing here is estimated on the server except
where labelled: hours saved and staff-cost equivalents are computed on the page from
assumptions the owner can see and change (minutes a person would take, hourly rate).
"""

import statistics
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...i18n.labels import role_label
from ...models import (
    Agent,
    Approval,
    Branch,
    Department,
    LLMCall,
    Skill,
    SkillUse,
    Task,
    Workspace,
)
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/impact", tags=["impact"])

DEFAULT_MINUTES = 30  # what a person would take per task, until the owner says otherwise
DECIDED = ("approved", "denied", "answered")


def _allowed(principal: Principal) -> bool:
    """Owners, admins and managers (branch managers, HODs)."""
    return can(principal.role, "org.manage") or can(principal.role, "team.manage")


async def build(db: AsyncSession, principal: Principal, days: int) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    tz = ZoneInfo(ws.timezone)
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    sc = principal.scope

    agent_q = select(Agent).where(Agent.workspace_id == ws.id)
    if (cond := sc.agent_where()) is not None:
        agent_q = agent_q.where(cond)
    all_agents = list((await db.scalars(agent_q)).all())
    by_id = {a.id: a for a in all_agents}

    def home(aid: str | None) -> Agent | None:
        """The agent a piece of work counts for: helpers count for their original."""
        a = by_id.get(aid or "")
        if a is not None and a.clone_of and a.clone_of in by_id:
            return by_id[a.clone_of]
        return a

    staff = [a for a in all_agents if a.status != "retired" and not a.clone_of]

    task_q = select(Task).where(
        Task.workspace_id == ws.id,
        (Task.finished_at >= since) | (Task.updated_at >= since) | (Task.created_at >= since),
    )
    if (tcond := sc.task_where()) is not None:
        task_q = task_q.where(tcond)
    tasks = list((await db.scalars(task_q)).all())

    branches = list(
        (
            await db.scalars(
                select(Branch).where(Branch.workspace_id == ws.id).order_by(Branch.name)
            )
        ).all()
    )
    if not sc.everything:
        seen = {a.branch_id for a in all_agents} | {t.branch_id for t in tasks}
        branches = [b for b in branches if b.id in seen or b.id == sc.branch_id]
    branch_ids = {b.id for b in branches}
    depts = list(
        (
            await db.scalars(
                select(Department)
                .where(Department.branch_id.in_(branch_ids))
                .order_by(Department.position)
            )
        ).all()
        if branch_ids
        else []
    )
    if sc.kind == "department":
        depts = [d for d in depts if d.id == sc.department_id]

    days_list = [
        (now.astimezone(tz).date() - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)
    ]
    done_by_day = dict.fromkeys(days_list, 0)
    b_stats: dict[str, dict[str, Any]] = {
        b.id: {
            "id": b.id,
            "name": b.name,
            "color": b.color,
            "industry": b.industry or "",
            "agents": 0,
            "tasks_done": 0,
            "tasks_failed": 0,
            "usd": 0.0,
            "departments": [],
        }
        for b in branches
    }
    d_stats: dict[str, dict[str, Any]] = {
        d.id: {
            "id": d.id,
            "name": d.name,
            "branch_id": d.branch_id,
            "agents": 0,
            "agent_names": [],
            "tasks_done": 0,
            "tasks_failed": 0,
            "usd": 0.0,
            "labels": Counter(),
        }
        for d in depts
    }
    for a in staff:
        if a.branch_id in b_stats:
            b_stats[a.branch_id]["agents"] += 1
        if a.department_id in d_stats and a.status == "active":
            d_stats[a.department_id]["agents"] += 1
            d_stats[a.department_id]["agent_names"].append(a.name)

    labels: Counter[str] = Counter()
    work_types: Counter[str] = Counter()  # each task once, by its first label ("" = none)
    agent_done: Counter[str] = Counter()
    unassigned_done = 0
    done = failed = 0
    review_now = 0
    for t in tasks:
        a = home(t.assignee_agent_id)
        bid = a.branch_id if a else t.branch_id
        did = a.department_id if a else None
        if t.status == "review":
            review_now += 1
        finished = t.finished_at is not None and t.finished_at >= since
        if t.status == "done" and finished:
            done += 1
            assert t.finished_at is not None
            day = t.finished_at.astimezone(tz).date().isoformat()
            if day in done_by_day:
                done_by_day[day] += 1
            for lab in t.labels or []:
                labels[lab] += 1
            work_types[(t.labels or [""])[0]] += 1
            if a is not None:
                agent_done[a.id] += 1
            else:
                unassigned_done += 1
            if bid in b_stats:
                b_stats[bid]["tasks_done"] += 1
            if did in d_stats:
                d_stats[did]["tasks_done"] += 1
                for lab in t.labels or []:
                    d_stats[did]["labels"][lab] += 1
        elif t.status == "failed" and t.updated_at >= since:
            failed += 1
            if bid in b_stats:
                b_stats[bid]["tasks_failed"] += 1
            if did in d_stats:
                d_stats[did]["tasks_failed"] += 1

    # AI spend in the window, per agent (helpers count for their original).
    calls = (
        await db.execute(
            select(
                LLMCall.agent_id,
                func.count(),
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
                func.count().filter(LLMCall.cost_usd.is_(None)),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
            )
            .where(LLMCall.workspace_id == ws.id, LLMCall.ts >= since)
            .group_by(LLMCall.agent_id)
        )
    ).all()
    usd = 0.0
    n_calls = unpriced = tokens = 0
    for aid, n, cost, nulls, tok in calls:
        a = home(aid)
        if a is None and not (aid is None and sc.everything):
            continue  # someone else's agent, or housekeeping outside a full view
        usd += float(cost or 0)
        n_calls += int(n)
        unpriced += int(nulls)
        tokens += int(tok)
        if a is not None:
            if a.branch_id in b_stats:
                b_stats[a.branch_id]["usd"] += float(cost or 0)
            if a.department_id in d_stats:
                d_stats[a.department_id]["usd"] += float(cost or 0)

    # Approvals: how fast people decide what agents ask for.
    ap_q = select(Approval).where(
        Approval.workspace_id == ws.id,
        (Approval.decided_at >= since) | (Approval.status == "pending"),
    )
    if (acond := sc.approval_where()) is not None:
        ap_q = ap_q.where(acond)
    approvals = list((await db.scalars(ap_q)).all())
    waits = [
        (ap.decided_at - ap.created_at).total_seconds() / 60
        for ap in approvals
        if ap.status in DECIDED and ap.decided_at is not None
    ]
    by_status = Counter(ap.status for ap in approvals)

    # Skills: what the office has learned (people approved each one).
    skills = list(
        (
            await db.scalars(
                select(Skill).where(Skill.workspace_id == ws.id, Skill.status == "active")
            )
        ).all()
    )
    learned = [s for s in skills if s.trust != "builtin"]
    use_q = (
        select(func.count())
        .select_from(SkillUse)
        .where(SkillUse.workspace_id == ws.id, SkillUse.created_at >= since)
    )
    if not sc.everything:
        use_q = use_q.where(SkillUse.agent_id.in_(list(by_id) or [""]))
    skill_uses = int(await db.scalar(use_q) or 0)

    for b in b_stats.values():
        b["usd"] = round(b["usd"], 4)
    for d in d_stats.values():
        d["usd"] = round(d["usd"], 4)
        d["labels"] = [{"label": k, "count": v} for k, v in d["labels"].most_common(5)]
        d["coverage"] = "working" if d["tasks_done"] else ("ready" if d["agents"] else "none")
        if d["branch_id"] in b_stats:
            b_stats[d["branch_id"]]["departments"].append(d)
    covered = [d for d in d_stats.values() if d["agents"]]
    top = sorted((a for a in staff if agent_done[a.id]), key=lambda a: -agent_done[a.id])[:8]
    return {
        "days": days,
        "since": since,
        "generated_at": now,
        "scope": {"kind": sc.kind, "label": sc.label},
        "default_minutes": DEFAULT_MINUTES,
        "totals": {
            "tasks_done": done,
            "tasks_failed": failed,
            "in_review": review_now,
            "unassigned_done": unassigned_done,
            "success_rate": round(done / (done + failed), 4) if done + failed else None,
            "agents": len(staff),
            "usd": round(usd, 4),
            "calls": n_calls,
            "calls_unpriced": unpriced,
            "tokens": tokens,
        },
        "coverage": {
            "departments": len(d_stats),
            "with_agents": len(covered),
            "working": sum(1 for d in d_stats.values() if d["tasks_done"]),
        },
        "approvals": {
            "decided": len(waits),
            "approved": by_status.get("approved", 0),
            "denied": by_status.get("denied", 0),
            "answered": by_status.get("answered", 0),
            "pending": by_status.get("pending", 0),
            "median_minutes": round(statistics.median(waits), 1) if waits else None,
            "average_minutes": round(sum(waits) / len(waits), 1) if waits else None,
        },
        "skills": {
            "active": len(skills),
            "learned": len(learned),
            "learned_in_window": sum(1 for s in learned if s.created_at >= since),
            "uses_in_window": skill_uses,
        },
        "labels": [{"label": k, "count": v} for k, v in labels.most_common(12)],
        "work_types": [{"label": k, "count": v} for k, v in work_types.most_common()],
        "done_by_day": [{"day": d, "count": c} for d, c in done_by_day.items()],
        "branches": list(b_stats.values()),
        "top_agents": [
            {
                "id": a.id,
                "name": a.name,
                "role": a.role,
                "branch_id": a.branch_id,
                "department_id": a.department_id,
                "done": agent_done[a.id],
            }
            for a in top
        ],
    }


@router.get("")
async def impact(
    days: int = Query(default=30, ge=1, le=365),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not _allowed(principal):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Your role ({role}) cannot see the impact report.",
            role=role_label(principal.role),
        )
    out = await build(db, principal, days)
    # Busiest departments first inside each company.
    for b in out["branches"]:
        b["departments"].sort(key=lambda d: (-d["tasks_done"], d["name"]))
    return out
