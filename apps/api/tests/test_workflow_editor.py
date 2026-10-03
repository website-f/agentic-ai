"""P15 workflow editor: office actions on steps, "ask a person" input steps, waits, sticky
notes that runs ignore, AI improving an existing workflow, layered layout, and tasks that
follow a workflow."""

import json
from datetime import UTC, datetime, timedelta

from agentic.core.db import SessionLocal
from agentic.models import Task, WorkflowRun
from agentic.workflows import procedure

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_workflow_runs import driver, step, tick  # noqa: F401

GRAPH = {
    "nodes": [
        {"id": "s", "type": "start", "title": "Invoice arrives"},
        {"id": "note", "type": "note", "title": "Remember", "body": "Finance closes on the 25th."},
        {"id": "po", "type": "input", "title": "PO number", "body": "Which PO is this for?"},
        {
            "id": "mail",
            "type": "step",
            "action": "email",
            "title": "Tell the supplier",
            "role": "Finance",
        },
        {
            "id": "w",
            "type": "wait",
            "title": "Give them time",
            "wait_amount": 2,
            "wait_unit": "hours",
        },
        {"id": "e", "type": "end", "title": "Done"},
    ],
    "edges": [
        {"id": "e1", "from": "s", "to": "po"},
        {"id": "e2", "from": "po", "to": "mail"},
        {"id": "e3", "from": "mail", "to": "w"},
        {"id": "e4", "from": "w", "to": "e"},
        {"id": "e5", "from": "note", "to": "s"},  # notes may point at things; runs ignore them
    ],
}


def test_procedure_reads_the_new_step_kinds():
    text = procedure.compile_text("Invoices", GRAPH)
    assert "PO number (ask a person)" in text
    assert "Tell the supplier (draft email)" in text
    assert "Give them time (wait 2 hours)" in text
    assert "Finance closes" not in text  # a note is for people reading the canvas
    g = procedure.clean_graph(
        {"nodes": [{"id": "a", "type": "step", "action": "hack", "wait_amount": "x"}]}
    )
    assert g["nodes"][0]["action"] == "" and g["nodes"][0]["wait_amount"] == 1


def test_layout_reads_top_to_bottom():
    g = procedure.layout(procedure.runnable(procedure.clean_graph(GRAPH)))
    y = {n["id"]: n["y"] for n in g["nodes"]}
    assert y["s"] < y["po"] < y["mail"] < y["w"] < y["e"]


async def test_input_and_wait_steps_in_a_run(client, llm, temporal, driver):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    wf = (
        await client.post(
            "/api/workflows", json={"name": "Invoices", "graph": GRAPH}, headers=csrf(client)
        )
    ).json()
    r = await client.post(
        f"/api/workflows/{wf['id']}/runs",
        json={
            "title": "Acme invoice",
            "input": "Invoice 77 from Acme.",
            "assign": {"mail": fin["id"]},
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    run = r.json()
    assert "note" not in {s["id"] for s in run["steps"]}  # never part of a run

    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert step(run, "po")["status"] == "waiting" and run["status"] == "waiting"
    assert run["needs_you"] == 1

    r = await client.post(
        f"/api/workflow-runs/{run['id']}/answer",
        json={"node_id": "po", "text": "PO-2026-118"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    mail = step(run, "mail")
    assert step(run, "po")["output"] == "PO-2026-118" and mail["status"] == "running"
    async with SessionLocal() as db:
        t = await db.get(Task, mail["task_id"])
        assert "PO-2026-118" in t.brief  # the answer feeds later steps
        assert "How: Draft the email" in t.brief and "Do not send it" in t.brief
        t.status, t.result = "done", "Draft: Dear Acme..."
        await db.commit()

    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    w = step(run, "w")
    assert w["status"] == "scheduled" and w["wait"] == "2 hours" and w["until"]
    assert run["status"] == "running" and run["needs_you"] == 0  # a pause is not "needs you"

    async with SessionLocal() as db:  # two hours pass
        r = await db.get(WorkflowRun, run["id"])
        past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        r.state = {**r.state, "w": {**r.state["w"], "until": past}}
        await db.commit()
    assert await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    assert run["status"] == "done" and step(run, "w")["output"] == "Waited 2 hours."


async def test_a_wait_can_be_skipped(client, llm, temporal, driver):
    o = await office(client)
    g = {
        "nodes": [
            {"id": "s", "type": "start"},
            {"id": "w", "type": "wait", "wait_amount": 3, "wait_unit": "days"},
            {"id": "e", "type": "end"},
        ],
        "edges": [{"from": "s", "to": "w"}, {"from": "w", "to": "e"}],
    }
    wf = (
        await client.post(
            "/api/workflows", json={"name": "Pause", "graph": g}, headers=csrf(client)
        )
    ).json()
    run = (
        await client.post(
            f"/api/workflows/{wf['id']}/runs",
            json={"branch_id": o["branch"]["id"]},
            headers=csrf(client),
        )
    ).json()
    await tick(run["id"])
    r = await client.post(
        f"/api/workflow-runs/{run['id']}/skip-wait", json={"node_id": "w"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert await tick(run["id"])
    bad = await client.post(
        f"/api/workflow-runs/{run['id']}/answer",
        json={"node_id": "w", "text": "x"},
        headers=csrf(client),
    )
    assert bad.status_code == 409


async def test_ai_improves_a_workflow_and_keeps_peoples_settings(client, llm, temporal):
    await office(client)
    current = {
        "nodes": [
            {"id": "n1", "type": "start", "title": "Request"},
            {"id": "n2", "type": "step", "title": "Do it", "agent_id": "ag_keep", "review": True},
            {"id": "tip", "type": "note", "title": "Tip", "x": 900, "y": 40},
        ],
        "edges": [{"from": "n1", "to": "n2"}],
    }
    improved = {
        "nodes": [
            {"id": "n1", "type": "start", "title": "Request"},
            {"id": "n2", "type": "step", "action": "write", "title": "Write it"},
            {"id": "n3", "type": "decision", "action": "approval", "title": "Approve?"},
            {"id": "n4", "type": "end", "title": "Done"},
        ],
        "edges": [
            {"from": "n1", "to": "n2"},
            {"from": "n2", "to": "n3"},
            {"from": "n3", "to": "n4", "label": "approved"},
            {"from": "n3", "to": "n2", "label": "rejected"},
        ],
    }
    llm.say(json.dumps(improved))
    r = await client.post(
        "/api/workflows/draft",
        json={"description": "add an approval", "graph": current},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    g = r.json()["graph"]
    nodes = {n["id"]: n for n in g["nodes"]}
    assert nodes["n2"]["agent_id"] == "ag_keep" and nodes["n2"]["review"] is True
    assert nodes["n2"]["action"] == "write" and nodes["n3"]["action"] == "approval"
    assert nodes["tip"]["x"] == 900  # notes stay where people put them
    assert nodes["n1"]["y"] < nodes["n2"]["y"] < nodes["n3"]["y"] < nodes["n4"]["y"]
    assert "current procedure graph" in llm.requests[-1]["messages"][-1]["content"]
    short = await client.post(
        "/api/workflows/draft", json={"description": "x"}, headers=csrf(client)
    )
    assert short.status_code == 400


async def test_a_task_can_follow_a_workflow(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina", "Finance")
    wf = (
        await client.post(
            "/api/workflows", json={"name": "Invoices", "graph": GRAPH}, headers=csrf(client)
        )
    ).json()
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Acme invoice",
            "brief": "Invoice 77 came in.",
            "assignee_agent_id": a["id"],
            "workflow_id": wf["id"],
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["brief"].startswith("Invoice 77 came in.")
    assert 'Follow the workflow "Invoices"' in t["brief"] and "(ask a person)" in t["brief"]
    assert "workflow" in t["labels"]
    bad = await client.post(
        "/api/tasks", json={"title": "x", "workflow_id": "wf_nope"}, headers=csrf(client)
    )
    assert bad.status_code == 400


def test_actions_only_stay_on_steps_that_use_them():
    g = procedure.clean_graph(
        {
            "nodes": [
                {"id": "a", "type": "input", "action": "form"},
                {"id": "b", "type": "decision", "action": "email"},
                {"id": "c", "type": "decision", "action": "approval"},
                {"id": "d", "type": "step", "action": "approval"},
                {"id": "e", "type": "handoff", "action": "message"},
            ]
        }
    )
    assert [n["action"] for n in g["nodes"]] == ["", "", "approval", "", "message"]


async def test_a_draft_cut_off_before_its_connections_is_linked_in_order(client, llm, temporal):
    await office(client)
    llm.say(
        json.dumps(
            {
                "nodes": [
                    {"id": "n1", "type": "start", "title": "In"},
                    {"id": "n2", "type": "step", "title": "Do"},
                    {"id": "n3", "type": "end", "title": "Out"},
                ]
            }
        )
    )
    r = await client.post(
        "/api/workflows/draft",
        json={"description": "A simple three step job for testing."},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert [(e["from"], e["to"]) for e in r.json()["graph"]["edges"]] == [
        ("n1", "n2"),
        ("n2", "n3"),
    ]
