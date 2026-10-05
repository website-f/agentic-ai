"""Workflow runs (P11): carry a job through a workflow, one agent task per step, with people
taking the decisions and reviewing the steps marked for review."""

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch, runtime
from ...core.db import get_db
from ...core.security import can
from ...models import Agent, Branch, DocFile, Objective, Task, Workflow, WorkflowRun
from ...services import audit, events
from ...teams import objectives
from ...workflows import runs
from ...workflows.procedure import clean_graph, wait_text
from .. import paging
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["workflow-runs"])
log = logging.getLogger("agentic.api.runs")


class StepOut(BaseModel):
    id: str
    type: str
    title: str
    role: str
    body: str
    review: bool
    decider: str
    status: str
    agent_id: str | None
    agent_name: str | None
    task_id: str | None
    task_status: str | None
    output: str | None
    error: str | None
    choice: str | None
    options: list[dict[str, str]]
    by: str | None
    started_at: str | None
    finished_at: str | None
    action: str = ""
    until: str | None = None
    wait: str = ""


class RunSummary(BaseModel):
    id: str
    workflow_id: str | None
    name: str
    title: str
    status: str
    error: str | None
    branch_id: str | None
    branch_name: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None
    done: int
    total: int
    needs_you: int
    # P23: the objective the run serves (its step tasks count toward it)
    objective_id: str | None = None
    objective_title: str | None = None


class RunOut(RunSummary):
    input: str
    graph: dict[str, Any]
    steps: list[StepOut]
    files: list[dict[str, str]]


def _counts(run: WorkflowRun) -> tuple[int, int, int]:
    nodes = run.graph.get("nodes") or []
    st = run.state or {}
    work = [n for n in nodes if n["type"] not in ("start", "end")]
    done = sum(1 for n in work if st.get(n["id"], {}).get("status") == "done")
    needs = sum(1 for s in st.values() if s.get("status") in ("waiting", "review"))
    return done, len(work), needs


async def _summary(db: AsyncSession, run: WorkflowRun) -> dict[str, Any]:
    b = await db.get(Branch, run.branch_id) if run.branch_id else None
    ob = await db.get(Objective, run.objective_id) if run.objective_id else None
    done, total, needs = _counts(run)
    return {
        "id": run.id,
        "workflow_id": run.workflow_id,
        "name": run.name,
        "title": run.title,
        "status": run.status,
        "error": run.error,
        "branch_id": run.branch_id,
        "branch_name": b.name if b else None,
        "created_by": run.created_by,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "finished_at": run.finished_at,
        "done": done,
        "total": total,
        "needs_you": needs,
        "objective_id": ob.id if ob else None,
        "objective_title": ob.title if ob else None,
    }


async def run_out(db: AsyncSession, run: WorkflowRun) -> RunOut:
    steps = []
    for n in run.graph.get("nodes") or []:
        s = (run.state or {}).get(n["id"], {})
        aid = run.assign.get(n["id"])
        a = await db.get(Agent, aid) if aid else None
        t = await db.get(Task, s["task_id"]) if s.get("task_id") else None
        steps.append(
            StepOut(
                id=n["id"],
                type=n["type"],
                title=n.get("title", ""),
                role=n.get("role", ""),
                body=n.get("body", ""),
                review=bool(n.get("review")),
                decider=n.get("decider", "person"),
                status=s.get("status", "pending"),
                agent_id=aid,
                agent_name=a.name if a else None,
                task_id=s.get("task_id"),
                task_status=t.status if t else None,
                output=s.get("output"),
                error=s.get("error"),
                choice=s.get("choice"),
                options=runs.options(run.graph, n["id"]) if n["type"] == "decision" else [],
                by=s.get("by"),
                started_at=s.get("started_at"),
                finished_at=s.get("finished_at"),
                action=n.get("action", ""),
                until=s.get("until"),
                wait=wait_text(n) if n["type"] == "wait" else "",
            )
        )
    files = []
    if run.file_ids:
        for f in (await db.scalars(select(DocFile).where(DocFile.id.in_(run.file_ids)))).all():
            files.append({"id": f.id, "name": f.name})
    return RunOut(
        **await _summary(db, run), input=run.input, graph=run.graph, steps=steps, files=files
    )


def _scoped(q: Any, principal: Principal) -> Any:
    sc = principal.scope
    if sc.everything:
        return q
    parts = [WorkflowRun.created_by == principal.actor]
    if sc.kind == "branch" and sc.branch_id:
        parts.append(WorkflowRun.branch_id == sc.branch_id)
    return q.where(or_(*parts))


async def _get(db: AsyncSession, principal: Principal, run_id: str) -> WorkflowRun:
    run = await db.scalar(
        _scoped(
            select(WorkflowRun).where(
                WorkflowRun.id == run_id, WorkflowRun.workspace_id == principal.workspace_id
            ),
            principal,
        )
    )
    if run is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "run_not_found", "That run is not here.")
    return run


async def _workflow(db: AsyncSession, principal: Principal, wf_id: str) -> Workflow:
    wf = await db.get(Workflow, wf_id)
    if wf is None or wf.workspace_id != principal.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "workflow_not_found", "That workflow is not here."
        )
    return wf


async def _drive(db: AsyncSession, run: WorkflowRun) -> None:
    """Hand the run to the worker (or wake it). If the worker is down, say so on the run."""
    try:
        run.temporal_id = await dispatch.start_run(run.id)
    except Exception as e:  # noqa: BLE001 - surfaced on the run, not as a 500
        log.warning("could not start run %s: %s", run.id, e)
        run.status = "failed"
        run.error = (
            f"The worker service is not reachable ({e.__class__.__name__}). Retry when it is up."
        )
    await db.commit()


# ---------------------------------------------------------------- starting


class AssignOut(BaseModel):
    suggested: dict[str, str]
    needs: list[dict[str, str]]


@router.get("/workflows/{workflow_id}/assignments")
async def assignments(
    workflow_id: str,
    branch_id: str | None = None,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> AssignOut:
    """Which steps need an agent, and the best guess for each."""
    wf = await _workflow(db, principal, workflow_id)
    graph = clean_graph(wf.graph or {})
    suggested = await runs.suggest(db, principal.workspace_id, graph, branch_id)
    visible = {}
    for nid, aid in suggested.items():
        a = await db.get(Agent, aid)
        if principal.scope.sees_agent(a):
            visible[nid] = aid
    needs = [
        {
            "node_id": n["id"],
            "title": n["title"] or n["type"],
            "type": n["type"],
            "role": n.get("role", ""),
        }
        for n in graph["nodes"]
        if runs.needs_agent(n)
    ]
    return AssignOut(suggested=visible, needs=needs)


class RunIn(BaseModel):
    title: str = Field(default="", max_length=200)
    input: str = Field(default="", max_length=20_000)
    branch_id: str | None = None
    assign: dict[str, str] = Field(default_factory=dict)
    file_ids: list[str] = Field(default_factory=list, max_length=20)
    objective_id: str | None = Field(default=None, max_length=40)  # P23


async def _run_objective(
    db: AsyncSession,
    principal: Principal,
    objective_id: str | None,
    branch_id: str | None,
    assign: dict[str, str],
) -> str | None:
    """P23: an objective the person may link this run to, by the rules for a task (active,
    one they see, for every company or the run's). A run for any company checks the companies
    of the agents that do its steps."""
    if not objective_id:
        return None
    agent_ids = {a for a in assign.values() if a}
    branches = (
        set((await db.scalars(select(Agent.branch_id).where(Agent.id.in_(agent_ids)))).all())
        if agent_ids and not branch_id
        else set()
    )
    ob = await objectives.linkable(
        db,
        principal.workspace_id,
        principal.scope,
        objective_id,
        branch_id,
        what="run",
        branch_ids={b for b in branches if b},
    )
    if isinstance(ob, str):
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_objective", ob)
    return ob.id


@router.post("/workflows/{workflow_id}/runs", status_code=status.HTTP_201_CREATED)
async def start_run(
    workflow_id: str,
    body: RunIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    wf = await _workflow(db, principal, workflow_id)
    if body.branch_id:
        b = await db.get(Branch, body.branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a company.")
    for aid in body.assign.values():
        a = await db.get(Agent, aid)
        if (
            a is None
            or a.workspace_id != principal.workspace_id
            or not principal.scope.sees_agent(a)
        ):
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_agent", "Pick agents you can see.")
        if a.status != "active":
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "agent_inactive", "{name} is not active.", name=a.name
            )
    for fid in body.file_ids:
        f = await db.get(DocFile, fid)
        if f is None or f.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_file", "Pick files you can see.")
    objective_id = await _run_objective(
        db, principal, body.objective_id, body.branch_id, body.assign
    )
    try:
        run = await runs.start(
            db,
            workspace_id=principal.workspace_id,
            workflow=wf,
            title=body.title or f"{wf.name} — {datetime.now():%d %b %H:%M}",
            job=body.input,
            branch_id=body.branch_id,
            assign=body.assign,
            file_ids=list(dict.fromkeys(body.file_ids)),
            created_by=principal.actor,
            objective_id=objective_id,
        )
    except runs.RunError as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "cannot_run", str(e)) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.run_started",
        target=run.id,
        after={"workflow": wf.id, "title": run.title, "objective_id": objective_id},
    )
    await db.commit()
    await _drive(db, run)
    await db.refresh(run)
    return await run_out(db, run)


# ---------------------------------------------------------------- following and acting


@router.get("/workflow-runs")
async def list_runs(
    response: Response,
    workflow_id: str | None = None,
    objective_id: str | None = Query(default=None, max_length=40),
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=paging.MAX_LIMIT),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[RunSummary]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count); `status`
    takes one status or a comma list; `objective_id` keeps the runs that serve it."""
    q = select(WorkflowRun).where(WorkflowRun.workspace_id == principal.workspace_id)
    if workflow_id:
        q = q.where(WorkflowRun.workflow_id == workflow_id)
    if objective_id:
        q = q.where(WorkflowRun.objective_id == objective_id)
    if status_:
        q = q.where(WorkflowRun.status.in_(status_.split(",")))
    rows = await paging.paginate(
        db,
        _scoped(q, principal),
        ((WorkflowRun.created_at, True), (WorkflowRun.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return [RunSummary(**await _summary(db, r)) for r in rows]


@router.get("/workflow-runs/{run_id}")
async def read_run(
    run_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    return await run_out(db, await _get(db, principal, run_id))


class RunUpdateIn(BaseModel):
    objective_id: str | None = Field(default=None, max_length=40)


@router.patch("/workflow-runs/{run_id}")
async def update_run(
    run_id: str,
    body: RunUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    """P23: link the run to an objective (or unlink it with null). Its step tasks, and the
    parts they handed out, that served the old objective move with it; steps that start
    later get the new one."""
    run = await _get(db, principal, run_id)
    changes = body.model_dump(exclude_unset=True)
    if "objective_id" in changes and changes["objective_id"] != run.objective_id:
        old = run.objective_id
        new = await _run_objective(
            db, principal, changes["objective_id"], run.branch_id, run.assign or {}
        )
        if old is None and new is not None:
            # A run linked for the first time: its steps may already serve the objective the
            # first step was given by hand; those move too.
            first = await objectives.run_lineage(db, run.id)
            old = first.get("objective_id")
        run.objective_id = new
        moved = await objectives.relink_run(db, run, old, new)
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "workflow.run_objective",
            target=run.id,
            before={"objective_id": old},
            after={"objective_id": new, "tasks_moved": moved},
        )
        await db.commit()
        await events.publish(
            principal.workspace_id,
            "workflow_run.updated",
            {"run_id": run.id, "status": run.status},
        )
        for oid in {old, new} - {None}:
            await events.publish(
                principal.workspace_id, "objective.updated", {"objective_id": oid, "change": "run"}
            )
    await db.refresh(run)
    return await run_out(db, run)


class DecideIn(BaseModel):
    node_id: str
    edge_id: str
    note: str = Field(default="", max_length=1000)


@router.post("/workflow-runs/{run_id}/decide")
async def decide(
    run_id: str,
    body: DecideIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    if not (can(principal.role, "work.write") or can(principal.role, "approvals.decide")):
        raise api_error(status.HTTP_403_FORBIDDEN, "forbidden", "Your role cannot take decisions.")
    run = await _get(db, principal, run_id)
    try:
        await runs.decide(db, run, body.node_id, body.edge_id, principal.user.name, body.note)
    except runs.RunError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_decide", str(e)) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.run_decided",
        target=run.id,
        after={"node": body.node_id, "edge": body.edge_id},
    )
    await db.commit()
    await _poke(run.id)
    await db.refresh(run)
    return await run_out(db, run)


class NodeIn(BaseModel):
    node_id: str


class AnswerIn(BaseModel):
    node_id: str
    text: str = Field(min_length=1, max_length=6000)


@router.post("/workflow-runs/{run_id}/answer")
async def answer(
    run_id: str,
    body: AnswerIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    """A person supplies what an "ask a person" step needs; the run carries on."""
    run = await _get(db, principal, run_id)
    try:
        await runs.answer(db, run, body.node_id, body.text, principal.user.name)
    except runs.RunError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_answer", str(e)) from e
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "workflow.run_answered",
        target=run.id,
        after={"node": body.node_id},
    )
    await db.commit()
    await _poke(run.id)
    await db.refresh(run)
    return await run_out(db, run)


@router.post("/workflow-runs/{run_id}/skip-wait")
async def skip_wait(
    run_id: str,
    body: NodeIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await _get(db, principal, run_id)
    try:
        await runs.skip_wait(db, run, body.node_id, principal.user.name)
    except runs.RunError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_skip", str(e)) from e
    await _poke(run.id)
    await db.refresh(run)
    return await run_out(db, run)


@router.post("/workflow-runs/{run_id}/retry")
async def retry(
    run_id: str,
    body: NodeIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await _get(db, principal, run_id)
    try:
        await runs.retry(db, run, body.node_id, principal.actor)
    except runs.RunError as e:
        raise api_error(status.HTTP_409_CONFLICT, "cannot_retry", str(e)) from e
    await _drive(db, run)  # the driver stopped when the run failed: start it again
    await db.refresh(run)
    return await run_out(db, run)


@router.post("/workflow-runs/{run_id}/cancel")
async def cancel(
    run_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> RunOut:
    run = await _get(db, principal, run_id)
    if run.status in runs.TERMINAL:
        raise api_error(status.HTTP_409_CONFLICT, "run_finished", "This run has already finished.")
    for t in await runs.cancel(db, run, principal.user.name):
        if t.workflow_id and t.status in ("running", "blocked"):
            try:
                await dispatch.cancel_task(t.workflow_id)
                continue
            except Exception:  # noqa: BLE001 - its workflow is gone: close the task here
                log.info("task %s had no live workflow to cancel", t.id)
        if t.status not in ("done", "cancelled", "failed"):
            await runtime.set_task_status(
                db, t, "cancelled", actor=principal.actor, note="the workflow run was cancelled"
            )
    await _poke(run.id)
    await audit.record(
        db, principal.workspace_id, principal.actor, "workflow.run_cancelled", target=run.id
    )
    await db.commit()
    await db.refresh(run)
    return await run_out(db, run)


async def _poke(run_id: str) -> None:
    try:
        await dispatch.poke_run(run_id)
    except Exception:  # noqa: BLE001 - the run's own tick catches up within seconds
        log.info("could not poke run %s", run_id)
