"""Carry a job through a workflow (P11).

A run copies the workflow's graph, then moves forward one tick at a time (the worker ticks
every few seconds, and immediately when poked):

- start nodes are done at once; the job description is their output.
- a step or hand-off becomes a task for its agent, briefed with the job, the step, and what
  the earlier steps produced. A step marked "review" waits in review until a person accepts it
  (sending it back re-runs it).
- a decision waits for a person to pick a branch, unless the workflow says an agent decides:
  then the agent answers with one of the branch labels (checked against a JSON schema).
- an end node finishes the run once nothing else is still in progress.

A node starts when any connection into it comes from a finished node (for a decision, only
the branch it chose), and runs at most once. Nothing here acts outside the office: steps are
ordinary agent tasks under the agents' usual tool rules and approvals.
"""

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents import launch
from ..models import Agent, DocFile, Task, WorkflowRun
from ..services import events
from .procedure import clean_graph

log = logging.getLogger("agentic.runs")

MAX_STEPS = 40
OUTPUT_CHARS = 6000
BRIEF_PRIOR = 6  # earlier steps quoted in a step's brief
TERMINAL = ("done", "failed", "cancelled")
ACTIVE = ("running", "review", "blocked", "waiting")
WORK_TYPES = ("step", "handoff")


class RunError(ValueError):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


def needs_agent(n: dict[str, Any]) -> bool:
    return n["type"] in WORK_TYPES or (n["type"] == "decision" and n.get("decider") == "agent")


def options(graph: dict[str, Any], node_id: str) -> list[dict[str, str]]:
    """A decision's branches: the label people see (or the target's title) per edge."""
    nodes = {n["id"]: n for n in graph["nodes"]}
    out = []
    for e in graph["edges"]:
        if e["from"] == node_id:
            target = nodes.get(e["to"], {})
            out.append(
                {
                    "edge_id": e["id"],
                    "label": (e.get("label") or target.get("title") or "next").strip()[:60],
                    "to": e["to"],
                    "to_title": target.get("title", ""),
                }
            )
    return out


async def suggest(
    db: AsyncSession, workspace_id: str, graph: dict[str, Any], branch_id: str | None
) -> dict[str, str]:
    """Best guess at who does each step: the agent set on the step, else one whose role,
    name or department matches the step's "who does it"."""
    from ..models import Department

    q = select(Agent).where(
        Agent.workspace_id == workspace_id, Agent.status == "active", Agent.clone_of.is_(None)
    )
    if branch_id:
        q = q.where(Agent.branch_id == branch_id)
    agents = (await db.scalars(q)).all()
    depts = {
        d.id: d.name.lower()
        for d in (
            await db.scalars(select(Department).where(Department.workspace_id == workspace_id))
        ).all()
    }
    out: dict[str, str] = {}
    for n in clean_graph(graph)["nodes"]:
        if not needs_agent(n):
            continue
        if n.get("agent_id") and any(a.id == n["agent_id"] for a in agents):
            out[n["id"]] = n["agent_id"]
            continue
        role = (n.get("role") or "").lower().strip()
        if not role:
            continue
        words = [w for w in re.findall(r"[a-z]+", role) if len(w) > 2 and w != "agent"]
        best = None
        for a in agents:
            hay = f"{a.role} {a.name} {depts.get(a.department_id or '', '')}".lower()
            if role in hay or (words and all(w in hay for w in words)):
                best = a
                break
            if words and any(w in hay for w in words) and best is None:
                best = a
        if best is not None:
            out[n["id"]] = best.id
    return out


# ---------------------------------------------------------------- start


async def start(
    db: AsyncSession,
    *,
    workspace_id: str,
    workflow: Any,
    title: str,
    job: str,
    branch_id: str | None,
    assign: dict[str, str],
    file_ids: list[str],
    created_by: str,
) -> WorkflowRun:
    graph = clean_graph(workflow.graph or {})
    nodes = graph["nodes"]
    if not nodes:
        raise RunError("This workflow has no steps yet.")
    if len(nodes) > MAX_STEPS:
        raise RunError(f"A workflow can run at most {MAX_STEPS} steps.")
    incoming = {e["to"] for e in graph["edges"]}
    starts = [n for n in nodes if n["type"] == "start"] or [
        n for n in nodes if n["id"] not in incoming
    ]
    if not starts:
        raise RunError(
            "Add a Start step (or a step nothing leads into) so the run knows where to begin."
        )
    missing = [n["title"] or n["type"] for n in nodes if needs_agent(n) and not assign.get(n["id"])]
    if missing:
        raise RunError("Choose who does: " + ", ".join(missing[:6]) + ".")
    for n in nodes:
        if n["type"] == "decision" and not options(graph, n["id"]):
            raise RunError(f'The decision "{n["title"]}" has no branches to choose from.')
    state: dict[str, Any] = {n["id"]: {"status": "pending"} for n in nodes}
    for n in starts:
        if n["type"] == "start":
            state[n["id"]] = {
                "status": "done",
                "output": job,
                "started_at": _now(),
                "finished_at": _now(),
            }
        else:
            state[n["id"]] = {"status": "ready"}
    run = WorkflowRun(
        workspace_id=workspace_id,
        workflow_id=workflow.id,
        branch_id=branch_id,
        name=workflow.name,
        title=title.strip()[:200] or workflow.name,
        input=job,
        file_ids=file_ids,
        graph=graph,
        assign={k: v for k, v in assign.items() if k in state},
        state=state,
        status="running",
        created_by=created_by,
    )
    db.add(run)
    await db.flush()
    return run


# ---------------------------------------------------------------- briefing


async def _brief(
    db: AsyncSession, run: WorkflowRun, node: dict[str, Any], decide: list[dict[str, str]] | None
) -> str:
    nodes = {n["id"]: n for n in run.graph["nodes"]}
    lines = [
        f'This is one step of the workflow "{run.name}". The job: "{run.title}".',
        "",
        "## The job",
        run.input.strip() or "(no description given)",
        "",
        f"## Your step: {node['title'] or node['type']}",
    ]
    if node.get("body"):
        lines.append(node["body"])
    done = sorted(
        (
            (s.get("finished_at") or "", nid, s)
            for nid, s in run.state.items()
            if s.get("status") == "done"
            and nodes.get(nid, {}).get("type") != "start"
            and s.get("output")
        ),
    )[-BRIEF_PRIOR:]
    if done:
        lines += ["", "## What the earlier steps produced"]
        for _, nid, s in done:
            who = f" — {s['by']}" if s.get("by") else ""
            lines += [f"### {nodes[nid]['title']}{who}", str(s["output"])[:1500], ""]
    if run.file_ids:
        files = (await db.scalars(select(DocFile).where(DocFile.id.in_(run.file_ids)))).all()
        if files:
            lines += ["", "## Files for this job (open them with read_file)"]
            for f in files:
                lines.append(f"- [{f.id}] {f.name}" + (f" — {f.summary}" if f.summary else ""))
    lines.append("")
    if decide:
        lines.append("## Decide which way the job goes")
        for o in decide:
            lines.append(f'- "{o["label"]}": leads to {o["to_title"] or "the next step"}')
        lines.append(
            "Look at the job and what the earlier steps found, then answer with the branch "
            "label and a one-line reason."
        )
    else:
        lines.append(
            "Do only your step. Finish with what the next step needs: the facts, figures and "
            "decisions you reached, and the id of anything you drafted. Do not do later steps. "
            "If some information is missing, say so in your result (the workflow has its own "
            "decision points for people); ask a person (ask_human) only when you cannot do your "
            "step at all without them."
        )
    return "\n".join(lines)


async def _launch(db: AsyncSession, run: WorkflowRun, node: dict[str, Any]) -> dict[str, Any]:
    agent = await db.get(Agent, run.assign.get(node["id"], ""))
    if agent is None or agent.status != "active":
        return {"status": "failed", "error": "The agent for this step is missing or paused."}
    decide = options(run.graph, node["id"]) if node["type"] == "decision" else None
    schema = None
    if decide:
        labels = list(dict.fromkeys(o["label"] for o in decide))
        schema = {
            "type": "object",
            "properties": {
                "choice": {"type": "string", "enum": labels},
                "reason": {"type": "string"},
            },
            "required": ["choice", "reason"],
            "additionalProperties": False,
        }
    title = f"{run.title[:90]} · {node['title'] or node['type']}"[:200]
    # A tick that crashed after starting this step already made its task: reuse it.
    prior = await db.scalar(select(Task).where(Task.workflow_run_id == run.id, Task.title == title))
    if prior is not None and prior.status not in ("failed", "cancelled"):
        return {"status": "running", "task_id": prior.id, "started_at": _now(), "by": agent.name}
    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == run.workspace_id)
        )
        or 0
    )
    t = Task(
        workspace_id=run.workspace_id,
        branch_id=agent.branch_id,
        title=title,
        brief=await _brief(db, run, node, decide),
        priority="normal",
        assignee_agent_id=agent.id,
        requires_review=bool(node.get("review")) and not decide,
        labels=["workflow"],
        created_by=run.created_by,
        status="ready",
        position=float(lowest) - 1,
        output_schema=schema,
        workflow_run_id=run.id,
    )
    db.add(t)
    await db.flush()
    try:
        await launch.launch(db, t, f"workflow:{run.id}")
    except launch.LaunchError as e:
        return {"status": "failed", "task_id": t.id, "error": e.message, "by": agent.name}
    return {"status": "running", "task_id": t.id, "started_at": _now(), "by": agent.name}


# ---------------------------------------------------------------- the tick


def _choice(text: str, opts: list[dict[str, str]]) -> str | None:
    try:
        value = json.loads(text)
    except ValueError:
        value = {"choice": text}
    pick = str((value or {}).get("choice") or "").strip().lower()
    return next((o["edge_id"] for o in opts if o["label"].lower() == pick), None)


async def tick(db: AsyncSession, run_id: str) -> bool:
    """Move the run forward. True when it has finished (or is gone)."""
    run = await db.get(WorkflowRun, run_id)
    if run is None:
        return True
    if run.status in TERMINAL:
        return True
    graph = run.graph
    nodes = {n["id"]: n for n in graph["nodes"]}
    base = {k: dict(v) for k, v in (run.state or {}).items()}
    state = {k: dict(v) for k, v in base.items()}
    before = json.dumps(state, sort_keys=True) + run.status

    # 1. What did the steps' tasks do since the last tick?
    for nid, s in state.items():
        if s["status"] not in ("running", "review", "blocked") or not s.get("task_id"):
            continue
        t = await db.get(Task, s["task_id"])
        if t is None:
            s.update(status="failed", error="The step's task was deleted.")
        elif t.status == "done":
            s.update(status="done", output=(t.result or "")[:OUTPUT_CHARS], finished_at=_now())
            if nodes[nid]["type"] == "decision":
                edge = _choice(t.result or "", options(graph, nid))
                if edge is None:
                    s.update(status="failed", error="The agent's choice matches no branch.")
                else:
                    s["choice"] = edge
        elif t.status == "review":  # the reviewer needs to see what they are accepting
            s.update(status="review", output=(t.result or "")[:OUTPUT_CHARS])
        elif t.status == "blocked":
            s["status"] = "blocked"
        elif t.status in ("failed", "cancelled"):
            s.update(status="failed", error=(t.error or f"The step was {t.status}.")[:400])
        else:
            s["status"] = "running"

    # 2. Which steps can start now?
    def passes(e: dict[str, Any]) -> bool:
        u = state.get(e["from"], {})
        if u.get("status") != "done":
            return False
        if nodes[e["from"]]["type"] == "decision":
            return u.get("choice") == e["id"]
        return True

    for n in graph["nodes"]:
        s = state[n["id"]]
        if s["status"] == "pending" and any(
            passes(e) for e in graph["edges"] if e["to"] == n["id"]
        ):
            s["status"] = "ready"
    for n in graph["nodes"]:
        s = state[n["id"]]
        if s["status"] != "ready":
            continue
        if n["type"] in ("start", "end"):
            s.update(status="done", started_at=_now(), finished_at=_now())
        elif n["type"] == "decision" and n.get("decider") != "agent":
            s.update(status="waiting", started_at=_now())
        else:
            s.update(await _launch(db, run, n))

    # Starting tasks committed along the way, so a person may have acted on the run since we
    # read it. Lock it, re-read, and keep their changes: ours apply only to untouched nodes.
    await db.refresh(run, attribute_names=["state", "status"], with_for_update=True)
    if run.status in TERMINAL:
        await db.commit()
        return True
    fresh = {k: dict(v) for k, v in (run.state or {}).items()}
    for nid, mine in state.items():
        if fresh.get(nid) == base.get(nid):
            fresh[nid] = mine
    state = fresh

    # 3. Is the run finished?
    active = any(s["status"] in ACTIVE for s in state.values())
    failed = [s for s in state.values() if s["status"] == "failed"]
    if not active:
        run.status = "failed" if failed else "done"
        run.error = failed[0].get("error") if failed else None
        run.finished_at = datetime.now(UTC)
        for s in state.values():
            if s["status"] in ("pending", "ready"):
                s["status"] = "skipped"
    else:
        waiting = any(s["status"] in ("waiting", "review", "blocked") for s in state.values())
        run.status = "waiting" if waiting else "running"
    run.state = state
    await db.commit()
    if json.dumps(state, sort_keys=True) + run.status != before:
        await events.publish(
            run.workspace_id, "workflow_run.updated", {"run_id": run.id, "status": run.status}
        )
    return run.status in TERMINAL


# ---------------------------------------------------------------- people acting on a run


async def decide(
    db: AsyncSession, run: WorkflowRun, node_id: str, edge_id: str, by: str, note: str = ""
) -> None:
    await db.refresh(run, attribute_names=["state", "status"], with_for_update=True)
    s = dict((run.state or {}).get(node_id) or {})
    if s.get("status") != "waiting":
        raise RunError("That decision is not waiting.")
    opt = next((o for o in options(run.graph, node_id) if o["edge_id"] == edge_id), None)
    if opt is None:
        raise RunError("Pick one of the decision's branches.")
    s.update(
        status="done",
        choice=edge_id,
        output=f"Chose: {opt['label']}" + (f" — {note.strip()}" if note.strip() else ""),
        finished_at=_now(),
        by=by,
    )
    run.state = {**run.state, node_id: s}
    run.status = "running"
    await db.commit()


async def retry(db: AsyncSession, run: WorkflowRun, node_id: str, actor: str) -> None:
    await db.refresh(run, attribute_names=["state", "status"], with_for_update=True)
    s = dict((run.state or {}).get(node_id) or {})
    if s.get("status") != "failed":
        raise RunError("Only a failed step can be retried.")
    t = await db.get(Task, s.get("task_id") or "")
    if t is not None:
        try:
            await launch.launch(db, t, actor)
        except launch.LaunchError as e:
            raise RunError(e.message) from e
        s.update(status="running", error=None, started_at=_now())
    else:
        s = {"status": "ready"}
    run.state = {**run.state, node_id: s}
    run.status, run.error, run.finished_at = "running", None, None
    await db.commit()


async def cancel(db: AsyncSession, run: WorkflowRun, actor: str) -> list[Task]:
    """Stop the run; returns the steps' tasks still in progress (the caller cancels them)."""
    await db.refresh(run, attribute_names=["state", "status"], with_for_update=True)
    open_tasks = []
    for s in (run.state or {}).values():
        if s.get("status") in ("running", "review", "blocked") and s.get("task_id"):
            t = await db.get(Task, s["task_id"])
            if t is not None:
                open_tasks.append(t)
    run.state = {
        k: ({**v, "status": "skipped"} if v.get("status") not in ("done", "failed") else v)
        for k, v in (run.state or {}).items()
    }
    run.status, run.finished_at = "cancelled", datetime.now(UTC)
    run.error = f"Cancelled by {actor}"[:500]
    await db.commit()
    return open_tasks
