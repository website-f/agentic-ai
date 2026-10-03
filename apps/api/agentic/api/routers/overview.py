"""The company overview (P9): every branch side by side, from the person's scope.

One request answers "which branch has the most tenders, the most work, the most trouble",
without opening branches one by one. The AI summary reads only these numbers (a few hundred
tokens), is cached for 15 minutes, and never sees task contents.
"""

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.valkey import valkey
from ...engine import gateway
from ...models import (
    Agent,
    AgentPing,
    Approval,
    Branch,
    Incident,
    LLMCall,
    Report,
    Task,
    Workspace,
)
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/overview", tags=["overview"])

OPEN = ("triage", "ready", "running", "blocked", "review")
DONE = ("done",)  # accepted work only; review is still open (counted as in_review)
STUCK_AFTER = timedelta(hours=2)
SUMMARY_TTL = 900


def _day(ts: datetime, tz: ZoneInfo) -> str:
    return ts.astimezone(tz).date().isoformat()


async def build(db: AsyncSession, principal: Principal, days: int) -> dict[str, Any]:
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    tz = ZoneInfo(ws.timezone)
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    sc = principal.scope

    agent_q = select(Agent).where(Agent.workspace_id == ws.id)
    cond = sc.agent_where()
    if cond is not None:
        agent_q = agent_q.where(cond)
    all_agents = list((await db.scalars(agent_q)).all())
    by_id = {a.id: a for a in all_agents}
    staff = [a for a in all_agents if a.status != "retired" and not a.clone_of]
    helpers = [a for a in all_agents if a.status == "active" and a.clone_of]

    task_q = select(Task).where(Task.workspace_id == ws.id)
    tcond = sc.task_where()
    if tcond is not None:
        task_q = task_q.where(tcond)
    recent = list(
        (
            await db.scalars(
                task_q.where(
                    (Task.created_at >= since)
                    | (Task.status.in_(OPEN))
                    | (Task.finished_at >= since)
                )
            )
        ).all()
    )

    branches = list(
        (
            await db.scalars(
                select(Branch).where(Branch.workspace_id == ws.id).order_by(Branch.name)
            )
        ).all()
    )
    seen_branches = {a.branch_id for a in all_agents} | {t.branch_id for t in recent}
    if not sc.everything:
        branches = [b for b in branches if b.id in seen_branches or b.id == sc.branch_id]

    def branch_of_task(t: Task) -> str | None:
        a = by_id.get(t.assignee_agent_id or "")
        return a.branch_id if a else t.branch_id

    pending = (
        await db.execute(
            select(Approval.agent_id, func.count())
            .where(Approval.workspace_id == ws.id, Approval.status == "pending")
            .group_by(Approval.agent_id)
        )
    ).all()
    calls = (
        await db.execute(
            select(
                LLMCall.agent_id,
                func.count(),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
                func.coalesce(func.sum(LLMCall.cached_tokens), 0),
            )
            .where(LLMCall.workspace_id == ws.id, LLMCall.ts >= since)
            .group_by(LLMCall.agent_id)
        )
    ).all()
    reports = (
        await db.execute(
            select(Report.branch_id, func.count())
            .where(Report.workspace_id == ws.id, Report.created_at >= since)
            .group_by(Report.branch_id)
        )
    ).all()

    days_list = [
        (now.astimezone(tz).date() - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)
    ]
    stats: dict[str, dict[str, Any]] = {}
    for b in branches:
        stats[b.id] = {
            "id": b.id,
            "name": b.name,
            "color": b.color,
            "agents": 0,
            "working": 0,
            "waiting": 0,
            "helpers": 0,
            "tasks_created": 0,
            "tasks_done": 0,
            "tasks_failed": 0,
            "open": dict.fromkeys(OPEN, 0),
            "approvals_pending": 0,
            "calls": 0,
            "tokens": 0,
            "cached_tokens": 0,
            "usd": 0.0,
            "reports": 0,
            "labels": Counter(),
            "done_by_day": dict.fromkeys(days_list, 0),
        }
    for a in staff:
        if a.branch_id in stats:
            stats[a.branch_id]["agents"] += 1
    for a in helpers:
        if a.branch_id in stats:
            stats[a.branch_id]["helpers"] += 1
    agent_done: Counter[str] = Counter()
    agent_failed: Counter[str] = Counter()
    issues: list[dict[str, Any]] = []
    for t in recent:
        bid = branch_of_task(t)
        s = stats.get(bid or "")
        if s is None:
            continue
        if t.created_at >= since:
            s["tasks_created"] += 1
            for lab in t.labels or []:
                s["labels"][lab] += 1
        if t.status in OPEN:
            s["open"][t.status] += 1
        if t.status in DONE and t.finished_at and t.finished_at >= since:
            s["tasks_done"] += 1
            d = _day(t.finished_at, tz)
            if d in s["done_by_day"]:
                s["done_by_day"][d] += 1
            if t.assignee_agent_id:
                agent_done[by_id[t.assignee_agent_id].clone_of or t.assignee_agent_id] += 1
        if t.status == "failed" and t.updated_at >= since:
            s["tasks_failed"] += 1
            if t.assignee_agent_id:
                agent_failed[t.assignee_agent_id] += 1
            issues.append(
                {
                    "kind": "failed",
                    "branch_id": bid,
                    "task_id": t.id,
                    "title": t.title,
                    "agent_id": t.assignee_agent_id,
                    "detail": (t.error or "")[:200],
                    "at": t.updated_at,
                }
            )
        if t.status == "blocked" and t.updated_at < now - STUCK_AFTER:
            issues.append(
                {
                    "kind": "waiting",
                    "branch_id": bid,
                    "task_id": t.id,
                    "title": t.title,
                    "agent_id": t.assignee_agent_id,
                    "detail": t.blocked_reason or "waiting on a person",
                    "at": t.updated_at,
                }
            )
    working = {t.assignee_agent_id for t in recent if t.status == "running"}
    waiting = {t.assignee_agent_id for t in recent if t.status == "blocked"}
    for a in staff + helpers:
        s = stats.get(a.branch_id)
        if s is None:
            continue
        if a.id in working:
            s["working"] += 1
        elif a.id in waiting:
            s["waiting"] += 1
    for aid, n in pending:
        a = by_id.get(aid)
        if a is not None and a.branch_id in stats:
            stats[a.branch_id]["approvals_pending"] += int(n)
    office = {"calls": 0, "tokens": 0, "usd": 0.0}
    agent_usd: Counter[str] = Counter()
    for aid, n, tok, usd, cached in calls:
        a = by_id.get(aid or "")
        if a is None:
            if aid is None and sc.everything:  # housekeeping: memory, digests, dreams
                office["calls"] += int(n)
                office["tokens"] += int(tok)
                office["usd"] += float(usd or 0)
            continue
        s = stats.get(a.branch_id)
        if s is None:
            continue
        s["calls"] += int(n)
        s["tokens"] += int(tok)
        s["cached_tokens"] += int(cached)
        s["usd"] += float(usd or 0)
        agent_usd[a.clone_of or a.id] += float(usd or 0)
    for bid, n in reports:
        if bid in stats:
            stats[bid]["reports"] += int(n)

    if sc.everything:
        for i in (
            await db.scalars(
                select(Incident)
                .where(Incident.workspace_id == ws.id, Incident.resolved_at.is_(None))
                .order_by(Incident.last_seen.desc())
                .limit(10)
            )
        ).all():
            issues.append(
                {
                    "kind": "incident",
                    "branch_id": None,
                    "title": i.title,
                    "detail": f"{i.count} time(s)",
                    "at": i.last_seen,
                }
            )
    for p in (
        await db.scalars(
            select(AgentPing).where(
                AgentPing.workspace_id == ws.id,
                AgentPing.resolved_at.is_(None),
                AgentPing.kind == "budget_alert",
            )
        )
    ).all():
        a = by_id.get(p.agent_id)
        if a is not None:
            issues.append(
                {
                    "kind": "budget",
                    "branch_id": a.branch_id,
                    "agent_id": a.id,
                    "title": f"{a.name} is near its budget",
                    "detail": p.message[:200],
                    "at": p.created_at,
                }
            )
    issues.sort(key=lambda x: x["at"], reverse=True)

    out_branches = []
    for s in stats.values():
        s["labels"] = [{"label": k, "count": v} for k, v in s["labels"].most_common(6)]
        s["done_by_day"] = [{"day": d, "count": c} for d, c in s["done_by_day"].items()]
        s["usd"] = round(s["usd"], 4)
        s["issues"] = sum(1 for i in issues if i.get("branch_id") == s["id"])
        out_branches.append(s)
    top = sorted(
        (a for a in staff if agent_done[a.id] or agent_usd[a.id]),
        key=lambda a: (-agent_done[a.id], -agent_usd[a.id]),
    )[:8]
    label_totals: Counter[str] = Counter()
    for s in out_branches:
        for x in s["labels"]:
            label_totals[x["label"]] += x["count"]
    return {
        "days": days,
        "scope": {"kind": sc.kind, "label": sc.label},
        "generated_at": now,
        "totals": {
            "branches": len(out_branches),
            "agents": sum(s["agents"] for s in out_branches),
            "helpers": sum(s["helpers"] for s in out_branches),
            "working": sum(s["working"] for s in out_branches),
            "tasks_created": sum(s["tasks_created"] for s in out_branches),
            "tasks_done": sum(s["tasks_done"] for s in out_branches),
            "in_review": sum(s["open"]["review"] for s in out_branches),
            "tasks_failed": sum(s["tasks_failed"] for s in out_branches),
            "open": sum(sum(s["open"].values()) for s in out_branches),
            "approvals_pending": sum(s["approvals_pending"] for s in out_branches),
            "usd": round(sum(s["usd"] for s in out_branches) + office["usd"], 4),
            "tokens": sum(s["tokens"] for s in out_branches) + office["tokens"],
            "reports": sum(s["reports"] for s in out_branches),
        },
        "office": office if sc.everything else None,
        "labels": [{"label": k, "count": v} for k, v in label_totals.most_common(10)],
        "branches": out_branches,
        "top_agents": [
            {
                "id": a.id,
                "name": a.name,
                "role": a.role,
                "color": a.color,
                "branch_id": a.branch_id,
                "done": agent_done[a.id],
                "failed": agent_failed[a.id],
                "usd": round(agent_usd[a.id], 4),
            }
            for a in top
        ],
        "issues": issues[:30],
    }


@router.get("")
async def overview(
    days: int = Query(default=7, ge=1, le=90),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await build(db, principal, days)


class SummaryOut(BaseModel):
    text: str
    model: str | None
    cached: bool
    generated_at: datetime


def _facts(o: dict[str, Any]) -> str:
    """The numbers the model may use, compact. No task contents, only titles of issues."""
    lines = [f"Window: last {o['days']} day(s). Scope: {o['scope']['label']}."]
    t = o["totals"]
    lines.append(
        f"Totals: {t['agents']} agents, {t['tasks_created']} tasks created, {t['tasks_done']} "
        f"done, {t['in_review']} waiting for review, {t['tasks_failed']} failed, "
        f"{t['open']} open, {t['approvals_pending']} approvals waiting, "
        f"{t['reports']} reports, US${t['usd']:.2f} AI spend."
    )
    if o["labels"]:
        lines.append("Work types: " + ", ".join(f"{x['label']} {x['count']}" for x in o["labels"]))
    for b in o["branches"]:
        labs = ", ".join(f"{x['label']} {x['count']}" for x in b["labels"]) or "none"
        lines.append(
            f"- {b['name']}: {b['agents']} agents ({b['working']} working, {b['waiting']} "
            f"waiting), created {b['tasks_created']}, done {b['tasks_done']}, failed "
            f"{b['tasks_failed']}, open {sum(b['open'].values())}, approvals "
            f"{b['approvals_pending']}, issues {b['issues']}, spend US${b['usd']:.2f}, "
            f"work types: {labs}"
        )
    names = {b["id"]: b["name"] for b in o["branches"]}
    for i in o["issues"][:10]:
        lines.append(
            f"Issue ({i['kind']}, {names.get(i.get('branch_id') or '', 'office')}): "
            f"{i['title'][:100]}"
        )
    for a in o["top_agents"][:5]:
        lines.append(f"Top agent: {a['name']} ({a['role']}) done {a['done']}, failed {a['failed']}")
    return "\n".join(lines)


@router.post("/summary")
async def summary(
    days: int = Query(default=7, ge=1, le=90),
    fresh: bool = False,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SummaryOut:
    o = await build(db, principal, days)
    facts = _facts(o)
    key = (
        "overview:summary:"
        + hashlib.sha256(f"{principal.workspace_id}|{facts}".encode()).hexdigest()[:32]
    )
    if not fresh:
        hit = await valkey().get(key)
        if hit:
            d = json.loads(hit)
            return SummaryOut(
                text=d["text"],
                model=d.get("model"),
                cached=True,
                generated_at=datetime.fromisoformat(d["at"]),
            )
    messages = [
        {
            "role": "system",
            "content": "You brief the head of a group of companies on their AI office. From the "
            "numbers given, write 4 to 6 short bullet points: which branch has the most work "
            "and of what type, where work is failing or waiting on people, where money goes, "
            "and the one or two things to do next. Use only the numbers given; name branches; "
            "no greetings.",
        },
        {"role": "user", "content": facts},
    ]
    try:
        r = await gateway.chat(
            db, principal.workspace_id, "smart", messages, task="overview.summary", max_tokens=400
        )
    except gateway.GatewayUnavailable:
        try:
            r = await gateway.chat(
                db,
                principal.workspace_id,
                "fast",
                messages,
                task="overview.summary",
                max_tokens=400,
            )
        except gateway.GatewayUnavailable as e:
            raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    now = datetime.now(UTC)
    await valkey().set(
        key,
        json.dumps({"text": r.content.strip(), "model": r.model, "at": now.isoformat()}),
        ex=SUMMARY_TTL,
    )
    return SummaryOut(text=r.content.strip(), model=r.model, cached=False, generated_at=now)
