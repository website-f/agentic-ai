"""P23: a workflow run linked to an objective. Its step tasks serve it, progress and cost roll
up to it, the link is checked like a task's, and it can be changed while the run goes on."""

import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Task, WorkflowRun
from agentic.teams import objectives

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_objectives import by_id, objective, spend
from .test_workflow_runs import driver, finish_task, setup, step, tick  # noqa: F401


async def start(client, wf: dict, **body) -> dict:
    sug = (await client.get(f"/api/workflows/{wf['id']}/assignments")).json()
    r = await client.post(
        f"/api/workflows/{wf['id']}/runs",
        json={"input": "Bina wants monthly cleaning.", "assign": sug["suggested"], **body},
        headers=csrf(client),
    )
    return r.json() if r.status_code == 201 else {"_status": r.status_code, **r.json()}


async def task(task_id: str) -> Task:
    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        assert t is not None
        return t


async def test_a_run_started_for_an_objective_links_every_step(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    ob = await objective(client, title="Win 5 cleaning contracts", target="5 signed by Dec")

    run = await start(client, wf, objective_id=ob["id"], title="Bina enquiry")
    assert (run["objective_id"], run["objective_title"]) == (ob["id"], ob["title"])
    await tick(run["id"])
    a = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "a")
    first = await task(a["task_id"])
    assert first.objective_id == ob["id"] and first.root_task_id is None  # the request's root
    await spend(a["task_id"], 0.5)

    await finish_task(a["task_id"], result="Budget RM2k.")
    await tick(run["id"])
    await client.post(
        f"/api/workflow-runs/{run['id']}/decide",
        json={"node_id": "d", "edge_id": "yes"},
        headers=csrf(client),
    )
    await tick(run["id"])
    b = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "b")
    second = await task(b["task_id"])
    assert (second.objective_id, second.root_task_id) == (ob["id"], first.id)
    await spend(b["task_id"], 0.25)

    # Progress and cost count the run's tasks, through task.objective_id.
    row = by_id((await client.get("/api/objectives")).json())[ob["id"]]
    assert row["progress"]["total"] == 2 and row["progress"]["done"] == 1
    assert row["progress"]["requests"] == 1  # one run, one request
    assert row["usd"] == pytest.approx(0.75)
    work = (await client.get(f"/api/objectives/{ob['id']}/tasks")).json()
    assert {x["id"] for x in work} == {first.id, second.id}

    # The objective's runs (the objective sheet lists them), and the run lists show the link.
    listed = await client.get("/api/workflow-runs", params={"objective_id": ob["id"]})
    assert [x["id"] for x in listed.json()] == [run["id"]]
    assert listed.headers.get("X-Total-Count") in (None, "1")
    assert listed.json()[0]["objective_title"] == ob["title"]
    assert (await client.get("/api/workflow-runs", params={"objective_id": "ob_none"})).json() == []
    async with SessionLocal() as db:
        audit = await db.scalar(select(AuditLog).where(AuditLog.action == "workflow.run_started"))
        assert audit is not None and audit.after["objective_id"] == ob["id"]


async def test_the_link_is_checked_like_a_tasks(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    done = await objective(client, title="Old goal", status="done")
    r = await start(client, wf, objective_id=done["id"])
    assert r["_status"] == 400 and r["code"] == "bad_objective" and "done" in r["message"]

    r = await start(client, wf, objective_id="ob_missing")
    assert r["_status"] == 400 and r["message"] == "Pick an objective you can see."

    other = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    theirs = await objective(client, title="Jaya goal", branch_id=other["id"])
    # The run is for Maju (its own company, or the company of every agent doing its steps).
    r = await start(client, wf, objective_id=theirs["id"], branch_id=o["branch"]["id"])
    assert r["_status"] == 400 and "another company than this run" in r["message"]
    r = await start(client, wf, objective_id=theirs["id"])
    assert r["_status"] == 400 and "another company" in r["message"]

    mine = await objective(client, title="Maju goal", branch_id=o["branch"]["id"])
    everyone = await objective(client, title="Group goal")
    assert (await start(client, wf, objective_id=mine["id"]))["objective_id"] == mine["id"]
    assert (await start(client, wf, objective_id=everyone["id"]))["objective_id"] == everyone["id"]


async def test_relinking_a_run_moves_its_tasks_and_later_steps_follow(
    client, llm, temporal, driver
):
    o, fin, ops, wf = await setup(client)
    first_ob = await objective(client, title="First")
    second_ob = await objective(client, title="Second")

    run = await start(client, wf)  # no objective yet
    assert run["objective_id"] is None and run["objective_title"] is None
    await tick(run["id"])
    a = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "a")
    assert (await task(a["task_id"])).objective_id is None

    r = await client.patch(
        f"/api/workflow-runs/{run['id']}",
        json={"objective_id": first_ob["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["objective_title"] == "First"
    assert (await task(a["task_id"])).objective_id == first_ob["id"]  # the open step moved

    await finish_task(a["task_id"], result="ok")
    await tick(run["id"])
    await client.post(
        f"/api/workflow-runs/{run['id']}/decide",
        json={"node_id": "d", "edge_id": "yes"},
        headers=csrf(client),
    )
    await tick(run["id"])
    b = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "b")
    assert (await task(b["task_id"])).objective_id == first_ob["id"]

    # Moving it again takes the whole run along (the done step too), so cost follows.
    await spend(a["task_id"], 0.4)
    r = await client.patch(
        f"/api/workflow-runs/{run['id']}",
        json={"objective_id": second_ob["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 200
    assert {(await task(x)).objective_id for x in (a["task_id"], b["task_id"])} == {second_ob["id"]}
    rows = by_id((await client.get("/api/objectives")).json())
    assert rows[first_ob["id"]]["progress"]["total"] == 0
    assert rows[second_ob["id"]]["usd"] == pytest.approx(0.4)

    # A bad objective is refused and changes nothing; null unlinks.
    dropped = await objective(client, title="Dropped", status="dropped")
    r = await client.patch(
        f"/api/workflow-runs/{run['id']}",
        json={"objective_id": dropped["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_objective"
    r = await client.patch(
        f"/api/workflow-runs/{run['id']}", json={"objective_id": None}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["objective_id"] is None
    assert (await task(b["task_id"])).objective_id is None
    async with SessionLocal() as db:
        moves = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "workflow.run_objective"))
        ).all()
        assert [m.after["objective_id"] for m in moves] == [first_ob["id"], second_ob["id"], None]


async def test_a_run_without_objective_keeps_the_first_steps(client, llm, temporal, driver):
    """The old rule still holds: no run objective, the steps follow the first step's."""
    o, fin, ops, wf = await setup(client)
    ob = await objective(client, title="By hand")
    run = await start(client, wf)
    await tick(run["id"])
    a = step((await client.get(f"/api/workflow-runs/{run['id']}")).json(), "a")
    r = await client.patch(
        f"/api/tasks/{a['task_id']}", json={"objective_id": ob["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200
    async with SessionLocal() as db:
        assert (await objectives.run_lineage(db, run["id"]))["objective_id"] == ob["id"]
        other = await objective(client, title="Run's own")
        assert (await objectives.run_lineage(db, run["id"], other["id"]))["objective_id"] == (
            other["id"]
        )
        r_ = await db.get(WorkflowRun, run["id"])
        assert r_ is not None and r_.objective_id is None
    # Linking the run later moves the hand-linked steps to the run's objective.
    run_ob = await objective(client, title="Run goal")
    r = await client.patch(
        f"/api/workflow-runs/{run['id']}", json={"objective_id": run_ob["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert (await task(a["task_id"])).objective_id == run_ob["id"]


async def test_deleting_the_objective_unlinks_the_run(client, llm, temporal, driver):
    o, fin, ops, wf = await setup(client)
    ob = await objective(client, title="Short-lived")
    run = await start(client, wf, objective_id=ob["id"])
    r = await client.delete(
        f"/api/objectives/{ob['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    after = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert after["objective_id"] is None and after["objective_title"] is None
