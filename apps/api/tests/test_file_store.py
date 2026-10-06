"""The file store: every file a piece of work made, fetched or was given, found in one place
(files grouped by task, a sub-task's files under the task they belong to), and the
"downloaded from websites" and library views."""

from agentic.core.db import SessionLocal
from agentic.models import Agent, DocFile, Task

from .test_agents import new_agent, office


async def _task(agent: Agent, title: str, parent: str | None = None) -> str:
    async with SessionLocal() as db:
        t = Task(
            workspace_id=agent.workspace_id,
            title=title,
            brief="b",
            assignee_agent_id=agent.id,
            branch_id=agent.branch_id,
            created_by="user:x",
            status="review",
            labels=[],
            parent_task_id=parent,
        )
        db.add(t)
        await db.commit()
        return t.id


async def _file(agent: Agent, task_id: str | None, name: str, source: str, origin: str) -> str:
    async with SessionLocal() as db:
        f = DocFile(
            workspace_id=agent.workspace_id,
            branch_id=agent.branch_id,
            task_id=task_id,
            agent_id=agent.id if origin == "agent" or source == "download" else None,
            name=name,
            mime="application/pdf",
            size=10,
            sha256="x",
            data=b"%PDF-1.4",
            status="ready",
            text="",
            source=source,
            created_by=f"agent:{agent.id}"
            if origin != "uploaded" or source == "download"
            else "user:x",
            fields={},
            sensitive={},
            quarantined=False,
            origin=origin,
            library=name.startswith("Guide"),
        )
        db.add(f)
        await db.commit()
        return f.id


async def test_files_grouped_by_task_with_sub_tasks_rolled_up(client):
    o = await office(client)
    a = await new_agent(client, o, "Rashid")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent is not None
        db.expunge(agent)
    tender = await _task(agent, "Prepare tender QT1")
    helper = await _task(agent, "Read the specification", parent=tender)
    other = await _task(agent, "Monthly report")
    await _file(agent, tender, "Spesifikasi.pdf", "download", "uploaded")
    await _file(agent, helper, "Cadangan Teknikal.pdf", "generated", "agent")
    await _file(agent, tender, "Brief from the manager.pdf", "upload", "uploaded")
    await _file(agent, other, "Report.pdf", "generated", "agent")
    await _file(agent, None, "Guide to tenders.pdf", "upload", "uploaded")

    r = await client.get("/api/files/by-task")
    assert r.status_code == 200, r.text
    groups = {g["title"]: g for g in r.json()}
    assert set(groups) == {"Prepare tender QT1", "Monthly report"}  # the helper's is rolled up
    t = groups["Prepare tender QT1"]
    assert t["task_id"] == tender and t["count"] == 3 and t["agent_name"] == "Rashid"
    assert {f["name"] for f in t["files"]} == {
        "Spesifikasi.pdf",
        "Cadangan Teknikal.pdf",
        "Brief from the manager.pdf",
    }
    one = (await client.get("/api/files/by-task", params={"task_id": tender})).json()
    assert [g["task_id"] for g in one] == [tender] and one[0]["count"] == 3

    downloads = (await client.get("/api/files", params={"source": "download"})).json()
    assert [f["name"] for f in downloads] == ["Spesifikasi.pdf"]
    lib = (await client.get("/api/files", params={"library": "true"})).json()
    assert [f["name"] for f in lib] == ["Guide to tenders.pdf"]
    stats = (await client.get("/api/files/stats")).json()
    assert stats["download"] == 1 and stats["library"] == 1 and stats["in_tasks"] == 4


def test_text_with_nul_bytes_is_made_storable():
    from agentic.agents.runtime import pg_safe

    nul = chr(0)
    assert pg_safe(f"page{nul}text") == "pagetext"
    assert pg_safe({"a": [f"x{nul}"], "n": 1}) == {"a": ["x"], "n": 1}
    assert pg_safe(None) is None
