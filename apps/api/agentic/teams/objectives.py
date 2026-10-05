"""P21 objectives (ported from Paperclip's goal ancestry and billing codes).

Agents get one line on why a task matters, and owners see what a project or one whole
delegated request cost, not only what each agent spent.

- A task carries `objective_id` (the objective it serves) and `root_task_id` (the first task
  of its request tree; NULL means the task is its own root). Children made by delegate,
  split_work, ask_colleague, workflow steps and assistants' messages inherit both
  (`lineage`); a schedule's runs keep the objective a person gave an earlier run.
- A task belongs to its own objective, or else to its root's (`_member`): cost and progress
  roll up through the request tree even for parts made before the link.
- Budgets reuse the agent-budget pattern (teams/budget.py): the creator is told at 80 %; at
  100 % a new request under the objective waits for a person's approval (kind "budget")
  before its first model call. Work already under way, and the parts it hands out, go on.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..models import Agent, AuditLog, LLMCall, Objective, Task, Workspace
from ..services import events

if TYPE_CHECKING:
    from ..agents.runtime import StepResult

ALERT_AT = 0.8
OPEN = ("triage", "ready", "running", "blocked", "review")
STATUSES = ("active", "done", "dropped")
MAX_DEPTH = 4  # objective nesting: company goal > department goal > project > milestone


# ---------------------------------------------------------------- inheritance


def lineage(parent: Task | None) -> dict[str, Any]:
    """What a child task inherits from the task that made it: the objective, and the root
    of the request tree (the parent's root, or the parent itself)."""
    if parent is None:
        return {}
    return {"objective_id": parent.objective_id, "root_task_id": parent.root_task_id or parent.id}


async def run_lineage(db: AsyncSession, run_id: str) -> dict[str, Any]:
    """A workflow run's steps form one request: rooted at its first step task, under the
    objective that step has (a person may link it)."""
    first = await db.scalar(
        select(Task)
        .where(Task.workflow_run_id == run_id)
        .order_by(Task.created_at, Task.id)
        .limit(1)
    )
    return lineage(first)


async def schedule_lineage(db: AsyncSession, schedule_id: str) -> dict[str, Any]:
    """A schedule's next run serves the objective a person gave its latest linked run. Each
    run is its own request (its own root)."""
    oid = await db.scalar(
        select(Task.objective_id)
        .where(Task.schedule_id == schedule_id, Task.objective_id.is_not(None))
        .order_by(Task.created_at.desc())
        .limit(1)
    )
    return {"objective_id": oid} if oid else {}


# ---------------------------------------------------------------- scope


def visible_where(scope: Any) -> ColumnElement[bool] | None:
    """Objectives a person sees: workspace roles all; office roles every-company objectives
    plus their company's (a HOD or supervisor: their company's that are not another
    department's). Staff read them, so they can link their work."""
    if scope.everything:
        return None
    parts: list[ColumnElement[bool]] = [Objective.branch_id.is_(None)]
    if scope.branch_id:
        mine = Objective.branch_id == scope.branch_id
        if scope.kind == "department":
            mine = and_(
                mine,
                or_(
                    Objective.department_id.is_(None),
                    Objective.department_id == scope.department_id,
                ),
            )
        parts.append(mine)
    elif scope.kind == "department" and scope.department_id:
        parts.append(Objective.department_id == scope.department_id)
    return or_(*parts)


def sees(scope: Any, ob: Objective) -> bool:
    if scope.everything or ob.branch_id is None:
        return True
    if scope.kind == "department":
        if ob.department_id is not None:
            return ob.department_id == scope.department_id
        return bool(scope.branch_id) and ob.branch_id == scope.branch_id
    return bool(scope.branch_id) and ob.branch_id == scope.branch_id


def may_edit(
    scope: Any, perms: frozenset[str] | set[str], ob_branch: str | None, ob_dept: str | None
) -> bool:
    """Owners and admins any objective; a branch manager their company's; a HOD their
    department's. Everyone else reads."""
    if "org.manage" in perms:
        return True
    if "team.manage" not in perms:
        return False
    if scope.kind == "branch":
        return ob_branch is not None and ob_branch == scope.branch_id
    if scope.kind == "department":
        return ob_dept is not None and ob_dept == scope.department_id
    return False


async def linkable(
    db: AsyncSession, workspace_id: str, scope: Any, objective_id: str, branch_id: str | None
) -> Objective | str:
    """The objective a task may be linked to, or why not (a sentence for the person)."""
    ob = await db.get(Objective, objective_id)
    if ob is None or ob.workspace_id != workspace_id or not sees(scope, ob):
        return "Pick an objective you can see."
    if ob.status != "active":
        return f'"{ob.title}" is {ob.status}: pick an active objective.'
    if ob.branch_id and branch_id and ob.branch_id != branch_id:
        return f'"{ob.title}" belongs to another company than this task.'
    return ob


async def titles(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict(
        (await db.execute(select(Objective.id, Objective.title).where(Objective.id.in_(ids)))).all()
    )


async def relink_tree(db: AsyncSession, task: Task, old: str | None, new: str | None) -> int:
    """A root task moved to another objective: the parts of its request that served the old
    one follow it. Returns how many moved."""
    if (task.root_task_id or task.id) != task.id:
        return 0
    moved = 0
    for child in (
        await db.scalars(
            select(Task).where(
                Task.root_task_id == task.id,
                Task.id != task.id,
                Task.objective_id.is_(None) if old is None else Task.objective_id == old,
            )
        )
    ).all():
        child.objective_id = new
        moved += 1
    return moved


# ---------------------------------------------------------------- the prompt line


async def why_line(db: AsyncSession, task: Task) -> str:
    """One short line for the task's first user message (never the system prompt, so the
    cached prefix stays the same for every task): why this work matters."""
    if not task.objective_id:
        return ""
    ob = await db.get(Objective, task.objective_id)
    if ob is None or ob.workspace_id != task.workspace_id:
        return ""
    line = f"Why this matters: {ob.title.strip()[:200]}"
    if ob.target.strip():
        line += f" — {ob.target.strip()[:300]}"
    parent = await db.get(Objective, ob.parent_id) if ob.parent_id else None
    if parent is not None and parent.workspace_id == ob.workspace_id:
        line += f" (part of {parent.title.strip()[:200]})"
    return f"\n\n{line}"


# ---------------------------------------------------------------- cost and progress


def _member() -> tuple[Any, ColumnElement[Any]]:
    """The root alias and the objective a task counts toward: its own, else its root's."""
    root = aliased(Task)
    return root, func.coalesce(Task.objective_id, root.objective_id)


@dataclass
class Stats:
    total: int = 0
    done: int = 0
    failed: int = 0
    open: int = 0
    cancelled: int = 0
    requests: int = 0  # tasks that started a request (not parts of another)
    usd: float = 0.0
    tokens: int = 0
    last_activity: datetime | None = None
    by_status: dict[str, int] = field(default_factory=dict)

    def dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "done": self.done,
            "failed": self.failed,
            "open": self.open,
            "cancelled": self.cancelled,
            "requests": self.requests,
            "usd": round(self.usd, 6),
            "tokens": self.tokens,
            "last_activity": self.last_activity,
        }


def _later(a: datetime | None, b: datetime | None) -> datetime | None:
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


async def stats(
    db: AsyncSession, workspace_id: str, ids: list[str] | None = None
) -> dict[str, Stats]:
    """Progress and cost per objective (its own tasks and their request trees, not its child
    objectives). Two grouped queries whatever the number of objectives."""
    out: dict[str, Stats] = {}
    if ids is not None and not ids:
        return out
    root, ob = _member()

    def scoped(q: Any) -> Any:
        q = q.outerjoin(root, root.id == Task.root_task_id).where(Task.workspace_id == workspace_id)
        if ids is None:
            return q.where(ob.is_not(None))
        return q.where(or_(Task.objective_id.in_(ids), root.objective_id.in_(ids)), ob.in_(ids))

    started = or_(Task.root_task_id.is_(None), Task.root_task_id == Task.id)
    rows = (
        await db.execute(
            scoped(
                select(
                    ob,
                    Task.status,
                    func.count(),
                    func.count().filter(started),
                    func.max(Task.updated_at),
                ).select_from(Task)
            ).group_by(ob, Task.status)
        )
    ).all()
    for row in rows:
        oid, status_, n, roots, last = tuple(row)
        s = out.setdefault(oid, Stats())
        n = int(n)
        s.total += n
        s.requests += int(roots)
        s.by_status[status_] = n
        if status_ == "done":
            s.done += n
        elif status_ == "failed":
            s.failed += n
        elif status_ == "cancelled":
            s.cancelled += n
        elif status_ in OPEN:
            s.open += n
        s.last_activity = _later(s.last_activity, last)
    spend = (
        await db.execute(
            scoped(
                select(
                    ob,
                    func.coalesce(func.sum(LLMCall.cost_usd), 0),
                    func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                    func.max(LLMCall.ts),
                )
                .select_from(LLMCall)
                .join(Task, Task.id == LLMCall.task_id)
            ).group_by(ob)
        )
    ).all()
    for row in spend:
        oid, usd, tokens, last = tuple(row)
        s = out.setdefault(oid, Stats())
        s.usd += float(usd or 0)
        s.tokens += int(tokens or 0)
        s.last_activity = _later(s.last_activity, last)
    return out


def subtree(all_obs: list[Objective], top: str) -> set[str]:
    """An objective and every objective nested under it."""
    kids: dict[str, list[str]] = {}
    for o in all_obs:
        if o.parent_id:
            kids.setdefault(o.parent_id, []).append(o.id)
    seen, frontier = {top}, [top]
    while frontier:
        nxt = [k for p in frontier for k in kids.get(p, []) if k not in seen]
        seen.update(nxt)
        frontier = nxt
    return seen


def rollup(all_obs: list[Objective], own: dict[str, Stats], top: str) -> float:
    return sum(own[i].usd for i in subtree(all_obs, top) if i in own)


async def request_cost(db: AsyncSession, task: Task) -> dict[str, Any]:
    """What the whole request this task is part of cost: every task under the same root
    (delegated parts, helpers, colleague questions; meetings bill to the task that called
    them)."""
    rid = task.root_task_id or task.id
    tree = or_(Task.id == rid, Task.root_task_id == rid)
    n = await db.scalar(select(func.count()).select_from(Task).where(tree)) or 0
    usd, tokens = (
        await db.execute(
            select(
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
            )
            .select_from(LLMCall)
            .join(Task, Task.id == LLMCall.task_id)
            .where(tree)
        )
    ).one()
    return {
        "root_task_id": rid,
        "tasks": int(n),
        "usd": round(float(usd or 0), 6),
        "tokens": int(tokens or 0),
    }


async def cost_by_day(
    db: AsyncSession, workspace_id: str, ids: set[str], tz: str, days: int = 30
) -> list[dict[str, Any]]:
    """Daily spend (workspace local days) of these objectives' work, oldest first."""
    zone = ZoneInfo(tz)
    today = datetime.now(UTC).astimezone(zone).date()
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time(), zone)
    root, ob = _member()
    day = func.date(func.timezone(tz, LLMCall.ts))
    rows = (
        await db.execute(
            select(day, func.coalesce(func.sum(LLMCall.cost_usd), 0), func.count())
            .select_from(LLMCall)
            .join(Task, Task.id == LLMCall.task_id)
            .outerjoin(root, root.id == Task.root_task_id)
            .where(
                LLMCall.workspace_id == workspace_id,
                LLMCall.ts >= since,
                or_(Task.objective_id.in_(ids), root.objective_id.in_(ids)),
                ob.in_(ids),
            )
            .group_by(day)
        )
    ).all()
    found = {d.isoformat(): (float(u or 0), int(c)) for d, u, c in rows}
    out = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        usd, calls = found.get(d, (0.0, 0))
        out.append({"day": d, "usd": round(usd, 6), "calls": calls})
    return out


async def cost_by_objective(
    db: AsyncSession, workspace_id: str, scope: Any, since: datetime, limit: int = 8
) -> list[dict[str, Any]]:
    """The company overview's "Cost by objective": spend in the window, highest first."""
    root, ob = _member()
    rows = (
        await db.execute(
            select(
                ob,
                func.coalesce(func.sum(LLMCall.cost_usd), 0),
                func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0),
                func.count(func.distinct(Task.id)),
            )
            .select_from(LLMCall)
            .join(Task, Task.id == LLMCall.task_id)
            .outerjoin(root, root.id == Task.root_task_id)
            .where(LLMCall.workspace_id == workspace_id, LLMCall.ts >= since, ob.is_not(None))
            .group_by(ob)
        )
    ).all()
    if not rows:
        return []
    q = select(Objective).where(
        Objective.workspace_id == workspace_id, Objective.id.in_([r[0] for r in rows])
    )
    cond = visible_where(scope)
    if cond is not None:
        q = q.where(cond)
    obs = {o.id: o for o in (await db.scalars(q)).all()}
    out = [
        {
            "id": oid,
            "title": obs[oid].title,
            "status": obs[oid].status,
            "branch_id": obs[oid].branch_id,
            "budget_usd": _money(obs[oid].budget_usd),
            "usd": round(float(usd or 0), 6),
            "tokens": int(tokens or 0),
            "tasks": int(n),
        }
        for oid, usd, tokens, n in rows
        if oid in obs
    ]
    out.sort(key=lambda x: (-x["usd"], x["title"]))
    return out[:limit]


# ---------------------------------------------------------------- budgets


def _money(v: Any) -> float | None:
    return None if v is None else float(v)


def budget_state(spent: float, budget: float | None) -> str:
    if budget is None:
        return "none"
    if budget <= 0 or spent >= budget:
        return "over"
    return "near" if spent >= budget * ALERT_AT else "ok"


async def _chain(db: AsyncSession, ob: Objective) -> list[Objective]:
    """The objective and the objectives above it (each may carry a budget)."""
    out, seen = [ob], {ob.id}
    cur = ob
    while cur.parent_id and cur.parent_id not in seen and len(out) <= MAX_DEPTH:
        nxt = await db.get(Objective, cur.parent_id)
        if nxt is None or nxt.workspace_id != ob.workspace_id:
            break
        out.append(nxt)
        seen.add(nxt.id)
        cur = nxt
    return out


async def budget_status(db: AsyncSession, ob: Objective) -> list[tuple[Objective, float, float]]:
    """(objective, spent, budget) for every budgeted objective in this one's chain; spend
    counts nested objectives too."""
    budgeted = [o for o in await _chain(db, ob) if o.budget_usd is not None]
    if not budgeted:
        return []
    all_obs = list(
        (await db.scalars(select(Objective).where(Objective.workspace_id == ob.workspace_id))).all()
    )
    trees = {o.id: subtree(all_obs, o.id) for o in budgeted}
    own = await stats(db, ob.workspace_id, sorted(set().union(*trees.values())))
    return [
        (o, sum(own[i].usd for i in trees[o.id] if i in own), float(o.budget_usd or 0))
        for o in budgeted
    ]


async def _alert_once(db: AsyncSession, ob: Objective, spent: float, budget: float) -> None:
    """Tell the objective's creator once per budget level (80 %, then 100 %)."""
    level = 100 if spent >= budget else 80
    key = f"{budget:.4f}:{level}"
    seen = await db.scalar(
        select(AuditLog.id).where(
            AuditLog.workspace_id == ob.workspace_id,
            AuditLog.action == "objective.budget_alert",
            AuditLog.target == ob.id,
            AuditLog.after["key"].astext == key,
        )
    )
    if seen is not None:
        return
    from ..services import audit

    pct = round(spent / budget * 100) if budget > 0 else 100
    await audit.record(
        db,
        ob.workspace_id,
        "system",
        "objective.budget_alert",
        target=ob.id,
        after={"key": key, "pct": pct, "spent_usd": round(spent, 4), "budget_usd": budget},
    )
    await db.commit()
    msg = f'"{ob.title}" has spent US${spent:,.2f} of its US${budget:,.2f} budget ({pct}%).' + (
        " New work under it now waits for an approval." if level == 100 else ""
    )
    await events.publish(
        ob.workspace_id,
        "objective.budget",
        {"objective_id": ob.id, "pct": pct, "level": level, "message": msg},
    )
    if not ob.created_by.startswith("user:"):
        return
    from ..channels import deliver  # late: channels import the agents package

    try:
        await deliver.start(
            await deliver.notify_user(
                db,
                ob.workspace_id,
                ob.created_by.removeprefix("user:"),
                f"Objective budget at {pct}%",
                msg,
                f"/objectives?o={ob.id}",
                dedupe=f"objective:{ob.id}:{key}",
            )
        )
    except Exception:  # noqa: BLE001 - a notice must never stop the work
        return


async def gate(db: AsyncSession, task: Task, agent: Agent, ws: Workspace) -> "StepResult | None":
    """Before a model call (from runtime._budget_gate): alert at 80 %, and at 100 % hold a new
    request under an over-budget objective for a person's approval."""
    if not task.objective_id:
        return None
    ob = await db.get(Objective, task.objective_id)
    if ob is None or ob.workspace_id != task.workspace_id:
        return None
    chain = await budget_status(db, ob)
    over: tuple[Objective, float, float] | None = None
    for o, spent, budget in chain:
        if budget_state(spent, budget) in ("near", "over"):
            await _alert_once(db, o, spent, budget)
        if over is None and budget_state(spent, budget) == "over":
            over = (o, spent, budget)
    if over is None:
        return None
    # Only new requests wait: a part of a request already under way, or a task that already
    # thought once, carries on (stopping mid-way wastes what was spent).
    if (task.root_task_id or task.id) != task.id or task.steps_used > 0:
        return None
    from ..agents import runtime  # late: runtime imports this module
    from ..models import Approval

    o, spent, budget = over
    call_id = f"objective:{o.id}:{budget:.4f}"
    prior = await db.scalar(
        select(Approval)
        .where(Approval.task_id == task.id, Approval.tool_call_id == call_id)
        .order_by(Approval.created_at.desc())
    )
    if prior is not None and prior.status == "approved":
        return None
    if prior is not None and prior.status == "pending":
        return runtime._waiting(prior)
    if prior is not None:
        why = "no one approved it" if prior.status == "expired" else "starting it was denied"
        return runtime.StepResult(
            "failed", f'Stopped: the objective "{o.title}" is over its budget and {why}.'
        )
    ratio = spent / budget if budget > 0 else 1.0
    return runtime._waiting(
        await runtime._create_approval(
            db,
            task,
            agent,
            "budget",
            "budget",
            call_id,
            {
                "objective_id": o.id,
                "objective_title": o.title,
                "usd_month": round(spent, 4),
                "usd_limit": budget,
                "usd_ratio": round(ratio, 3),
                "token_limit": None,
                "over": True,
            },
            f'The objective "{o.title}" has spent US${spent:,.2f} of its US${budget:,.2f} '
            "budget. Approve to start this task anyway, or raise the budget on the objective.",
            "medium",
            "objective.budget",
        )
    )
