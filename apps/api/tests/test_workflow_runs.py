"""P11 workflow runs: each step a task for its agent, decisions by people (or an agent),
review steps that wait for a person, failure and retry, cancel."""

import json

import pytest
from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.models import Task
from agentic.workflows import runs

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_workflow import env  # noqa: F401 - the shared time-skipping server


@pytest.fixture
def driver(monkeypatch):
    calls = {"start": [], "poke": []}

    async def start_run(run_id):
        calls["start"].append(run_id)
        return f"wfrun-{run_id}"

    async def poke_run(run_id):
        calls["poke"].append(run_id)

    monkeypatch.setattr(dispatch, "start_run", start_run)
    monkeypatch.setattr(dispatch, "poke_run", poke_run)
    return calls


def graph(decider: str = "person") -> dict:
    return {
        "nodes": [
            {"id": "s", "type": "start", "title": "Enquiry in"},
            {
                "id": "a",
                "type": "step",
                "title": "Qualify",
                "role": "Finance",
                "body": "Check budget.",
            },
            {
                "id": "d",
                "type": "decision",
                "title": "Good fit?",
                "role": "Operations",
                "decider": decider,
            },
            {
                "id": "b",
                "type": "step",
                "title": "Prepare quote",
                "role": "Operations",
                "review": True,
            },
            {"id": "x", "type": "step", "title": "Send decline", "role": "Finance"},
            {"id": "e", "type": "end", "title": "Closed"},
        ],
        "edges": [
            {"id": "e1", "from": "s", "to": "a"},
            {"id": "e2", "from": "a", "to": "d"},
            {"id": "yes", "from": "d", "to": "b", "label": "yes"},
            {"id": "no", "from": "d", "to": "x", "label": "no"},
            {"id": "e3", "from": "b", "to": "e"},
            {"id": "e4", "from": "x", "to": "e"},
        ],
    }


async def setup(client, decider: str = "person"):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    ops = await new_agent(client, o, "Ops One", "Operations")
    r = await client.post(
        "/api/workflows", json={"name": "Enquiry", "graph": graph(decider)}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    return o, fin, ops, r.json()


async def finish_task(
    task_id: str, status: str = "done", result: str = "ok", error: str | None = None
):
    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        t.status, t.result, t.error = status, result, error
        await db.commit()


async def tick(run_id: str) -> bool:
    async with SessionLocal() as db:
        return await runs.tick(db, run_id)


def step(run: dict, node: str) -> dict:
    return next(s for s in run["steps"] if s["id"] == node)


async def test_a_run_moves_step_by_step_with_people_deciding_and_reviewing(
    client, llm, temporal, driver
):
    o, fin, ops, wf = await setup(client)
    sug = (
        await client.get(
            f"/api/workflows/{wf['id']}/assignments", params={"branch_id": o["branch"]["id"]}
        )
    ).json()
    assert sug["suggested"] == {"a": fin["id"], "b": ops["id"], "x": fin["id"]}
    assert [n["node_id"] for n in sug["needs"]] == ["a", "b", "x"]  # a person takes the decision

    r = await client.post(
        f"/api/workflows/{wf['id']}/runs",
        json={
            "title": "Bina enquiry",
            "input": "Bina wants monthly cleaning.",
            "branch_id": o["branch"]["id"],
            "assign": sug["suggested"],
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    run = r.json()
    assert driver["start"] == [run["id"]] and run["status"] == "running"
    assert step(run, "s")["status"] == "done"

    assert await tick(run["id"]) is False
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    a = step(run, "a")
    assert a["status"] == "running" and a["agent_name"] == "Faiz"
    assert temporal["start"][-1][0] == a["task_id"]  # the step's task was launched
    async with SessionLocal() as db:
        t = await db.get(Task, a["task_id"])
        assert "Bina wants monthly cleaning." in t.brief and "Your step: Qualify" in t.brief
        assert t.workflow_run_id == run["id"] and t.labels == ["workflow"] and not t.requires_review

    await finish_task(a["task_id"], result="Budget RM2k a month, 3 sites.")
    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert step(run, "a")["output"] == "Budget RM2k a month, 3 sites."
    d = step(run, "d")
    assert d["status"] == "waiting" and run["status"] == "waiting" and run["needs_you"] == 1
    assert [o_["label"] for o_ in d["options"]] == ["yes", "no"]

    bad = await client.post(
        f"/api/workflow-runs/{run['id']}/decide",
        json={"node_id": "d", "edge_id": "nope"},
        headers=csrf(client),
    )
    assert bad.status_code == 409
    r = await client.post(
        f"/api/workflow-runs/{run['id']}/decide",
        json={"node_id": "d", "edge_id": "yes", "note": "They pay on time."},
        headers=csrf(client),
    )
    assert r.status_code == 200 and run["id"] in driver["poke"]
    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    b = step(run, "b")
    assert b["status"] == "running" and step(run, "x")["status"] == "pending"
    async with SessionLocal() as db:
        t = await db.get(Task, b["task_id"])
        assert t.requires_review and "Budget RM2k a month" in t.brief and "Chose: yes" in t.brief

    await finish_task(b["task_id"], status="review", result="Quote QT-1 drafted.")
    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert step(run, "b")["status"] == "review" and run["status"] == "waiting"
    assert step(run, "b")["output"] == "Quote QT-1 drafted."  # the reviewer sees what they accept
    r = await client.post(f"/api/tasks/{b['task_id']}/accept", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text

    assert await tick(run["id"]) is True
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert run["status"] == "done" and run["finished_at"]
    assert step(run, "e")["status"] == "done" and step(run, "x")["status"] == "skipped"
    assert (run["done"], run["total"]) == (3, 4)
    listed = (await client.get("/api/workflow-runs", params={"workflow_id": wf["id"]})).json()
    assert [x["id"] for x in listed] == [run["id"]]


async def test_an_agent_can_take_the_decision(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client, decider="agent")
    sug = (await client.get(f"/api/workflows/{wf['id']}/assignments")).json()
    assert "d" in sug["suggested"]
    run = (
        await client.post(
            f"/api/workflows/{wf['id']}/runs",
            json={"input": "x", "assign": sug["suggested"]},
            headers=csrf(client),
        )
    ).json()
    await tick(run["id"])
    a = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "a")
    await finish_task(a["task_id"], result="Too small.")
    await tick(run["id"])
    d = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "d")
    async with SessionLocal() as db:
        t = await db.get(Task, d["task_id"])
        assert t.output_schema["properties"]["choice"]["enum"] == ["yes", "no"]
        assert "Decide which way the job goes" in t.brief
    await finish_task(d["task_id"], result=json.dumps({"choice": "no", "reason": "Too small"}))
    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert step(run, "d")["choice"] == "no" and step(run, "x")["status"] == "running"
    assert step(run, "b")["status"] == "pending"


async def test_a_failed_step_fails_the_run_until_retried(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    sug = (await client.get(f"/api/workflows/{wf['id']}/assignments")).json()
    run = (
        await client.post(
            f"/api/workflows/{wf['id']}/runs",
            json={"input": "x", "assign": sug["suggested"]},
            headers=csrf(client),
        )
    ).json()
    await tick(run["id"])
    a = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "a")
    await finish_task(a["task_id"], status="failed", error="Stopped after 30 model calls.")
    assert await tick(run["id"]) is True
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert run["status"] == "failed" and "30 model calls" in run["error"]

    starts = len(temporal["start"])
    r = await client.post(
        f"/api/workflow-runs/{run['id']}/retry", json={"node_id": "a"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["status"] == "running" and step(run, "a")["status"] == "running"
    assert len(temporal["start"]) == starts + 1 and driver["start"].count(run["id"]) == 2


async def test_runs_need_every_step_assigned_and_can_be_cancelled(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    r = await client.post(
        f"/api/workflows/{wf['id']}/runs", json={"assign": {"a": fin["id"]}}, headers=csrf(client)
    )
    assert r.status_code == 400 and "Prepare quote" in r.json()["message"]
    sug = (await client.get(f"/api/workflows/{wf['id']}/assignments")).json()
    run = (
        await client.post(
            f"/api/workflows/{wf['id']}/runs",
            json={"assign": sug["suggested"]},
            headers=csrf(client),
        )
    ).json()
    await tick(run["id"])
    r = await client.post(f"/api/workflow-runs/{run['id']}/cancel", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    async with SessionLocal() as db:  # the step's open task was closed too
        t = await db.get(Task, step(r.json(), "a")["task_id"])
        assert t.status == "cancelled"
    assert step(r.json(), "b")["status"] == "skipped"
    assert await tick(run["id"]) is True
    again = await client.post(
        f"/api/workflow-runs/{run['id']}/cancel", json={}, headers=csrf(client)
    )
    assert again.status_code == 409


async def test_a_crashed_tick_does_not_start_a_step_twice(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    sug = (await client.get(f"/api/workflows/{wf['id']}/assignments")).json()
    run = (
        await client.post(
            f"/api/workflows/{wf['id']}/runs",
            json={"assign": sug["suggested"]},
            headers=csrf(client),
        )
    ).json()
    await tick(run["id"])
    # Pretend the state was lost after the task was made: the next tick reuses that task.
    async with SessionLocal() as db:
        from agentic.models import WorkflowRun

        r = await db.get(WorkflowRun, run["id"])
        r.state = {**r.state, "a": {"status": "ready"}}
        await db.commit()
    await tick(run["id"])
    async with SessionLocal() as db:
        tasks = (await db.scalars(select(Task).where(Task.workflow_run_id == run["id"]))).all()
        assert len(tasks) == 1


# ---------------------------------------------------------------- the driver on Temporal


async def test_the_driver_ticks_until_finished_and_wakes_on_a_poke(env):  # noqa: F811
    import uuid
    from datetime import timedelta

    from temporalio import activity
    from temporalio.worker import Worker

    from agentic.workflows.document_workflows import WorkflowRunWorkflow

    ticks: list[str] = []

    @activity.defn(name="workflow_run_tick")
    async def fake_tick(run_id: str) -> bool:
        ticks.append(run_id)
        return len(ticks) >= 3

    queue = f"q-{uuid.uuid4().hex[:8]}"
    async with Worker(
        env.client, task_queue=queue, workflows=[WorkflowRunWorkflow], activities=[fake_tick]
    ):
        handle = await env.client.start_workflow(
            WorkflowRunWorkflow.run, "wr_1", id=f"wfrun-{uuid.uuid4().hex[:8]}", task_queue=queue
        )
        await handle.signal(WorkflowRunWorkflow.poke)  # a person decided: tick now
        await env.sleep(timedelta(minutes=2))  # ...and the timer keeps it going
        assert await handle.result() == "finished"
    assert ticks == ["wr_1", "wr_1", "wr_1"]
