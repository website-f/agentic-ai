"""Files given to work after it started: attached to a task from its sheet, and attached to
a person's answer in a workflow run (later steps' agents get them like a task's files)."""

from datetime import UTC, datetime

from agentic.agents.tools import ToolContext
from agentic.core.db import SessionLocal
from agentic.models import Agent, AgentMessage, DocFile, Task, Workspace

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401
from .test_documents import inline_reading, upload  # noqa: F401
from .test_office_roles import as_role
from .test_workflow_runs import driver, step, tick  # noqa: F401

GRAPH = {
    "nodes": [
        {"id": "s", "type": "start", "title": "Order in"},
        {"id": "po", "type": "input", "title": "Signed PO", "body": "Attach the signed PO."},
        {"id": "mail", "type": "step", "title": "Confirm the order", "role": "Finance"},
        {"id": "e", "type": "end", "title": "Done"},
    ],
    "edges": [
        {"id": "e1", "from": "s", "to": "po"},
        {"id": "e2", "from": "po", "to": "mail"},
        {"id": "e3", "from": "mail", "to": "e"},
    ],
}


async def attach(c, task_id: str, ids: list[str]):
    return await c.post(f"/api/tasks/{task_id}/files", json={"file_ids": ids}, headers=csrf(c))


# ---------------------------------------------------------------- tasks


async def test_files_attached_to_a_task_reach_its_agent(client, llm, temporal, inline_reading):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    t = await new_task(client, fin, "Check the invoice")
    f1 = (await upload(client, "invoice-77.txt", b"Invoice 77: RM 1,250.00")).json()

    r = await attach(client, t["id"], [f1["id"], f1["id"]])
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()] == [f1["id"]] and r.json()[0]["task_id"] == t["id"]
    listed = (await client.get("/api/files", params={"task_id": t["id"]})).json()
    assert [x["id"] for x in listed] == [f1["id"]]
    detail = (await client.get(f"/api/tasks/{t['id']}")).json()
    ev = [e for e in detail["events"] if e["kind"] == "files"]
    assert ev and "invoice-77.txt" in ev[0]["text"]
    assert await messages(t["id"]) == []  # not started: its first message will list them

    # Finished work: a note at the end of the conversation, for the next run.
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        task.status = "done"
        db.add(
            AgentMessage(
                workspace_id=task.workspace_id,
                agent_id=fin["id"],
                task_id=task.id,
                role="assistant",
                content="Checked: all fine.",
                created_at=datetime.now(UTC),
            )
        )
        await db.commit()
    f2 = (await upload(client, "po-12.txt", b"PO 12")).json()
    assert (await attach(client, t["id"], [f2["id"]])).status_code == 200
    last = (await messages(t["id"]))[-1]
    assert last.role == "user" and "Files added to this task" in last.content
    assert f2["id"] in last.content and f1["id"] not in last.content

    # Mid-run: nothing is pushed into the conversation (the agent can list them).
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        task.status = "running"
        await db.commit()
    f3 = (await upload(client, "extra.txt", b"more")).json()
    n = len(await messages(t["id"]))
    assert (await attach(client, t["id"], [f3["id"]])).status_code == 200
    assert len(await messages(t["id"])) == n

    assert (await attach(client, t["id"], ["fl_nope"])).status_code == 400
    assert (await attach(client, "tk_nope", [f3["id"]])).status_code == 404


async def test_only_people_who_may_write_attach(client, llm, temporal, inline_reading):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    t = await new_task(client, fin)
    f = (await upload(client, "a.txt", b"a")).json()
    viewer = await as_role(client, "v@example.com", "viewer")
    try:
        r = await attach(viewer, t["id"], [f["id"]])
        assert r.status_code == 403
    finally:
        await viewer.aclose()


# ---------------------------------------------------------------- workflow answers


async def test_files_on_an_answer_reach_later_steps(client, llm, temporal, driver, inline_reading):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    wf = (
        await client.post(
            "/api/workflows", json={"name": "Orders", "graph": GRAPH}, headers=csrf(client)
        )
    ).json()
    r = await client.post(
        f"/api/workflows/{wf['id']}/runs",
        json={
            "title": "Acme order",
            "input": "Acme ordered 3 sites.",
            "branch_id": o["branch"]["id"],
            "assign": {"mail": fin["id"]},
        },
        headers=csrf(client),
    )
    run = r.json()
    await tick(run["id"])
    # A file filed under another company: the step's agent could not open it on its own.
    po = (await upload(client, "signed-po.txt", b"PO 2026-118 signed", branch_id=b2["id"])).json()

    # A branch manager of the run's company may answer, but not with files they cannot see.
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=o["branch"]["id"])
    try:
        r = await bm.post(
            f"/api/workflow-runs/{run['id']}/answer",
            json={"node_id": "po", "file_ids": [po["id"]]},
            headers=csrf(bm),
        )
        assert r.status_code == 400 and r.json()["code"] == "bad_file"
    finally:
        await bm.aclose()
    r = await client.post(
        f"/api/workflow-runs/{run['id']}/answer",
        json={"node_id": "po", "text": "", "file_ids": []},
        headers=csrf(client),
    )
    assert r.status_code == 409  # neither words nor files

    r = await client.post(
        f"/api/workflow-runs/{run['id']}/answer",
        json={"node_id": "po", "file_ids": [po["id"]]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    run = r.json()
    s = step(run, "po")
    assert s["status"] == "done" and s["files"] == [{"id": po["id"], "name": "signed-po.txt"}]
    assert "signed-po.txt" in s["output"]
    assert {"id": po["id"], "name": "signed-po.txt"} in run["files"]

    from agentic.agents import doc_tools  # after tools (which loads it at its end)

    await tick(run["id"])
    run = (await client.get(f"/api/workflow-runs/{run['id']}")).json()
    mail = step(run, "mail")
    assert mail["status"] == "running"
    async with SessionLocal() as db:
        t = await db.get(Task, mail["task_id"])
        assert po["id"] in t.brief and "Files: signed-po.txt" in t.brief
        agent = await db.get(Agent, fin["id"])
        ws = await db.get(Workspace, t.workspace_id)
        f = await doc_tools._file(ToolContext(db=db, agent=agent, workspace=ws, task=t), po["id"])
        assert f is not None and f.id == po["id"]  # the step's agent may read it
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
        assert await doc_tools._file(ctx, po["id"]) is None  # outside the run: still closed
        assert (await db.get(DocFile, po["id"])).task_id is None  # not moved to one step
