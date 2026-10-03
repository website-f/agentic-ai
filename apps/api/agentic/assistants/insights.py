"""Company insight reports for personal assistants (P16).

Plain numbers from the office's own records (tasks, agents, people, approvals, runs, spend),
always inside the asking person's scope: an owner sees the company, a branch manager the
branch, staff their own work. The assistant explains them; it never invents figures.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.scope import Scope
from ..models import (
    Agent,
    Approval,
    Branch,
    LLMCall,
    Membership,
    Task,
    TaskEvent,
    User,
    WorkflowRun,
)

OPEN = ("triage", "ready", "running", "blocked", "review")


def _ago(t: datetime | None, now: datetime) -> str:
    if t is None:
        return "never"
    h = (now - t).total_seconds() / 3600
    if h < 1:
        return f"{max(1, int(h * 60))} min ago"
    if h < 48:
        return f"{h:.0f} h ago"
    return f"{h / 24:.0f} days ago"


def _hours(a: datetime | None, b: datetime | None) -> float | None:
    if a is None or b is None:
        return None
    return max(0.0, (b - a).total_seconds() / 3600)


async def _tasks(
    db: AsyncSession, ws: str, scope: Scope, since: datetime | None = None
) -> list[Task]:
    q = select(Task).where(Task.workspace_id == ws)
    cond = scope.task_where()
    if cond is not None:
        q = q.where(cond)
    if since is not None:
        q = q.where(
            (Task.created_at >= since) | Task.status.in_(OPEN) | (Task.finished_at >= since)
        )
    return list((await db.scalars(q)).all())


async def _agents(db: AsyncSession, ws: str, scope: Scope) -> dict[str, Agent]:
    rows = (
        await db.scalars(
            select(Agent).where(
                Agent.workspace_id == ws,
                Agent.status != "retired",
                Agent.clone_of.is_(None),
                scope.agent_where(),
            )
        )
    ).all()
    return {a.id: a for a in rows}


async def _people(db: AsyncSession, ws: str, scope: Scope) -> list[tuple[User, Membership]]:
    rows = (
        await db.execute(
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == ws, User.is_active.is_(True))
        )
    ).all()
    out = []
    for u, m in rows:
        if scope.everything or u.id == scope.user_id:
            out.append((u, m))
        elif scope.kind == "branch" and m.branch_id == scope.branch_id:
            out.append((u, m))
        elif scope.kind == "department" and m.department_id == scope.department_id:
            out.append((u, m))
    return out


def _user_id(actor: str) -> str | None:
    return actor[5:] if actor.startswith("user:") else None


async def company_pulse(db: AsyncSession, ws: str, scope: Scope, days: int = 7) -> str:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    tasks = await _tasks(db, ws, scope, since)
    agents = await _agents(db, ws, scope)
    created = [t for t in tasks if t.created_at >= since]
    done = [t for t in tasks if t.status == "done" and t.finished_at and t.finished_at >= since]
    failed = [t for t in tasks if t.status == "failed" and (t.finished_at or t.updated_at) >= since]
    open_by: dict[str, int] = defaultdict(int)
    for t in tasks:
        if t.status in OPEN:
            open_by[t.status] += 1
    working = sum(1 for t in tasks if t.status == "running")
    appr_q = select(Approval).where(Approval.workspace_id == ws, Approval.status == "pending")
    if (c := scope.approval_where()) is not None:
        appr_q = appr_q.where(c)
    approvals = list((await db.scalars(appr_q)).all())
    spend = await db.scalar(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0)).where(
            LLMCall.workspace_id == ws,
            LLMCall.ts >= since,
            LLMCall.agent_id.in_(list(agents) or [""]),
        )
    ) or Decimal(0)
    runs_waiting = await db.scalar(
        select(func.count())
        .select_from(WorkflowRun)
        .where(WorkflowRun.workspace_id == ws, WorkflowRun.status == "waiting")
    )
    by_branch: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for t in created:
        by_branch[t.branch_id or ""][0] += 1
    for t in done:
        by_branch[t.branch_id or ""][1] += 1
    for t in failed:
        by_branch[t.branch_id or ""][2] += 1
    names = {
        b.id: b.name
        for b in (await db.scalars(select(Branch).where(Branch.workspace_id == ws))).all()
    }
    top: dict[str, int] = defaultdict(int)
    for t in done:
        if t.assignee_agent_id in agents:
            top[t.assignee_agent_id] += 1
    lines = [
        f"# Company pulse, last {days} days ({scope.label})",
        f"- Agents: {len(agents)} ({sum(1 for a in agents.values() if a.status == 'active')} active, {working} working right now)",
        f"- Tasks: {len(created)} created, {len(done)} done, {len(failed)} failed",
        "- Open now: " + (", ".join(f"{k} {v}" for k, v in sorted(open_by.items())) or "none"),
        f"- Approvals waiting for a person: {len(approvals)}"
        + (f" (oldest {_ago(min(a.created_at for a in approvals), now)})" if approvals else ""),
        f"- Workflow runs waiting on people: {runs_waiting or 0}",
        f"- AI spend: USD {Decimal(spend):.2f}",
    ]
    if by_branch:
        lines += ["", "## By company", "| Company | Created | Done | Failed |", "|---|---|---|---|"]
        for bid, (c, d, f) in sorted(by_branch.items(), key=lambda x: -x[1][0]):
            lines.append(f"| {names.get(bid, 'Unassigned')} | {c} | {d} | {f} |")
    if top:
        lines += ["", "## Most work done"]
        for aid, n in sorted(top.items(), key=lambda x: -x[1])[:5]:
            lines.append(f"- {agents[aid].name} ({agents[aid].role}): {n} done")
    if failed:
        lines += ["", "## Recent failures"]
        for t in sorted(failed, key=lambda t: t.updated_at, reverse=True)[:5]:
            who = (
                agents[t.assignee_agent_id].name if t.assignee_agent_id in agents else "unassigned"
            )
            lines.append(f"- {t.title} ({who}): {(t.error or 'no reason given')[:140]}")
    return "\n".join(lines)


async def team_performance(db: AsyncSession, ws: str, scope: Scope, days: int = 14) -> str:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    tasks = await _tasks(db, ws, scope, since)
    agents = await _agents(db, ws, scope)
    ids = [t.id for t in tasks]
    sent_back: dict[str, int] = defaultdict(int)
    if ids:
        for tid, n in (
            await db.execute(
                select(TaskEvent.task_id, func.count())
                .where(
                    TaskEvent.task_id.in_(ids), TaskEvent.kind == "feedback", TaskEvent.ts >= since
                )
                .group_by(TaskEvent.task_id)
            )
        ).all():
            sent_back[tid] = n
    per: dict[str, dict[str, Any]] = {
        aid: {"done": 0, "failed": 0, "open": 0, "stuck": 0, "back": 0, "hours": [], "last": None}
        for aid in agents
    }
    for t in tasks:
        p = per.get(t.assignee_agent_id or "")
        if p is None:
            continue
        p["last"] = max(filter(None, [p["last"], t.updated_at]), default=None)
        if t.status == "done" and t.finished_at and t.finished_at >= since:
            p["done"] += 1
            if (h := _hours(t.created_at, t.finished_at)) is not None:
                p["hours"].append(h)
        elif t.status == "failed" and t.updated_at >= since:
            p["failed"] += 1
        if t.status in OPEN:
            p["open"] += 1
            if t.status in ("running", "blocked") and (now - t.updated_at) > timedelta(hours=6):
                p["stuck"] += 1
        p["back"] += sent_back.get(t.id, 0)
    lines = [
        f"# Team performance, last {days} days ({scope.label})",
        "",
        "## Agents",
        "| Agent | Role | Done | Failed | Sent back | Open | Stuck >6h | Avg hours to done | Last activity |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    flags: list[str] = []
    for aid, p in sorted(per.items(), key=lambda x: -(x[1]["done"])):
        a = agents[aid]
        avg = f"{sum(p['hours']) / len(p['hours']):.1f}" if p["hours"] else "-"
        lines.append(
            f"| {a.name} | {a.role} | {p['done']} | {p['failed']} | {p['back']} | {p['open']} | {p['stuck']} | {avg} | {_ago(p['last'], now)} |"
        )
        total = p["done"] + p["failed"]
        if p["failed"] >= 2 and total and p["failed"] / total >= 0.3:
            flags.append(f"{a.name} failed {p['failed']} of {total} finished tasks.")
        if p["stuck"]:
            flags.append(f"{a.name} has {p['stuck']} task(s) stuck for over 6 hours.")
        if p["back"] >= 2:
            flags.append(f"{a.name}'s work was sent back {p['back']} times.")
        if a.status == "active" and not p["done"] and not p["open"]:
            flags.append(f"{a.name} did no work in {days} days (idle).")
    people = await _people(db, ws, scope)
    owned: dict[str, list[str]] = defaultdict(list)
    for a in agents.values():
        if a.owner_user_id and not a.private:
            owned[a.owner_user_id].append(a.id)
    lines += [
        "",
        "## People",
        "| Person | Role | Tasks given | Their agents done | Reviews waiting on them | Oldest review | Last login |",
        "|---|---|---|---|---|---|---|",
    ]
    for u, m in sorted(people, key=lambda x: x[0].name):
        given = [t for t in tasks if _user_id(t.created_by) == u.id and t.created_at >= since]
        reviews = [t for t in tasks if t.status == "review" and _user_id(t.created_by) == u.id]
        theirs = sum(per[aid]["done"] for aid in owned.get(u.id, []) if aid in per)
        oldest = _ago(min(t.updated_at for t in reviews), now) if reviews else "-"
        lines.append(
            f"| {u.name} | {m.role} | {len(given)} | {theirs} | {len(reviews)} | {oldest} | {_ago(u.last_login_at, now)} |"
        )
        if len(reviews) >= 3 or (
            reviews and (now - min(t.updated_at for t in reviews)) > timedelta(days=2)
        ):
            flags.append(f"{u.name} has {len(reviews)} finished task(s) waiting for their review.")
        if m.role not in ("owner", "admin") and (
            u.last_login_at is None or (now - u.last_login_at) > timedelta(days=7)
        ):
            flags.append(f"{u.name} has not signed in for over a week.")
    lines += ["", "## Worth a look"] + ([f"- {f}" for f in flags] or ["- Nothing stands out."])
    return "\n".join(lines)


async def slacking_report(db: AsyncSession, ws: str, scope: Scope, days: int = 7) -> str:
    """Concrete things that are not moving, with who should move them."""
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    tasks = await _tasks(db, ws, scope, since)
    agents = await _agents(db, ws, scope)
    users = {u.id: u.name for u, _ in await _people(db, ws, scope)}
    who = lambda t: agents[t.assignee_agent_id].name if t.assignee_agent_id in agents else "nobody"  # noqa: E731
    asked = lambda t: users.get(_user_id(t.created_by) or "", t.created_by)  # noqa: E731
    sections: list[tuple[str, list[str]]] = []
    stuck = sorted(
        (
            t
            for t in tasks
            if t.status in ("running", "blocked") and now - t.updated_at > timedelta(hours=6)
        ),
        key=lambda t: t.updated_at,
    )
    sections.append(
        (
            "Stuck work (no progress for over 6 hours)",
            [
                f"{t.title}: {who(t)}, {t.status}{' (' + t.blocked_reason[:80] + ')' if t.blocked_reason else ''}, last moved {_ago(t.updated_at, now)}"
                for t in stuck[:10]
            ],
        )
    )
    waiting = sorted(
        (t for t in tasks if t.status == "ready" and now - t.created_at > timedelta(hours=24)),
        key=lambda t: t.created_at,
    )
    sections.append(
        (
            "Not started after a day",
            [
                f"{t.title}: {who(t)}, created {_ago(t.created_at, now)} by {asked(t)}"
                for t in waiting[:10]
            ],
        )
    )
    triage = [t for t in tasks if t.status == "triage" and now - t.created_at > timedelta(hours=24)]
    sections.append(
        (
            "Nobody assigned for over a day",
            [f"{t.title}: created {_ago(t.created_at, now)} by {asked(t)}" for t in triage[:10]],
        )
    )
    reviews = sorted(
        (t for t in tasks if t.status == "review" and now - t.updated_at > timedelta(hours=24)),
        key=lambda t: t.updated_at,
    )
    sections.append(
        (
            "Finished but not reviewed for over a day (people)",
            [
                f"{t.title}: done by {who(t)}, waiting on {asked(t)} since {_ago(t.updated_at, now)}"
                for t in reviews[:10]
            ],
        )
    )
    appr_q = select(Approval).where(
        Approval.workspace_id == ws,
        Approval.status == "pending",
        Approval.created_at < now - timedelta(hours=4),
    )
    if (c := scope.approval_where()) is not None:
        appr_q = appr_q.where(c)
    approvals = list((await db.scalars(appr_q.order_by(Approval.created_at))).all())
    sections.append(
        (
            "Decisions waiting over 4 hours",
            [
                f"{agents[a.agent_id].name if a.agent_id in agents else 'An agent'} asks: {(a.reason or a.tool_name or a.kind)[:100]} ({_ago(a.created_at, now)})"
                for a in approvals[:10]
            ],
        )
    )
    failed = [t for t in tasks if t.status == "failed" and t.updated_at >= since]
    sections.append(
        (
            "Failed and not retried",
            [f"{t.title}: {who(t)}: {(t.error or '')[:100]}" for t in failed[:10]],
        )
    )
    busy = {t.assignee_agent_id for t in tasks if t.created_at >= since or t.status in OPEN}
    idle = [
        a for a in agents.values() if a.status == "active" and a.id not in busy and not a.private
    ]
    sections.append(
        (f"Agents with no work in {days} days", [f"{a.name} ({a.role})" for a in idle[:15]])
    )
    runs_q = select(WorkflowRun).where(
        WorkflowRun.workspace_id == ws,
        WorkflowRun.status == "waiting",
        WorkflowRun.updated_at < now - timedelta(hours=24),
    )
    runs = list((await db.scalars(runs_q)).all())
    sections.append(
        (
            "Workflow runs waiting on people for over a day",
            [f"{r.title} ({r.name}), since {_ago(r.updated_at, now)}" for r in runs[:10]],
        )
    )
    lines = [f"# Where things are slipping ({scope.label}, last {days} days)"]
    total = 0
    for title, items in sections:
        if items:
            total += len(items)
            lines += ["", f"## {title}"] + [f"- {i}" for i in items]
    if not total:
        lines.append("\nNothing is stuck, waiting too long, or idle. Everything is moving.")
    return "\n".join(lines)
