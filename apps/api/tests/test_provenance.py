"""P25: everything agents make is stored, labelled and reviewable.

An agent's document lands in Documents (origin agent, linked to its task and workflow run)
and as a PDF in the company's files under the AI folder (one file per format, replaced on
re-export). People filter by who made it, review it from a queue, approve it or send it back
(the agent revises it in its task, or in a small new task), and every decision is audited.
"""

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.i18n import MS
from agentic.models import Agent, AgentMessage, AuditLog, DocFile, Document, Task, WorkflowRun

from .conftest import csrf
from .test_agents import llm, messages, new_agent, office, temporal  # noqa: F401
from .test_documents import KIT, inline_reading, upload  # noqa: F401
from .test_office_roles import as_role

QUOTE = {
    "client_name": "Syarikat Contoh",
    "subject": "Guard services",
    "items": [{"description": "Night guard", "qty": 2, "unit_price": 3200}],
}


async def _run(task_id: str) -> None:
    """One run of the task to its end, as the worker does it (step, then finish)."""
    step = await runtime.run_task_step(task_id)
    assert step.state == "done", step
    await runtime.finish(task_id, "done", "Done.")


async def _agent_quote(client, llm, o, agent, title="Quotation for Contoh", run_id=None):
    """The agent drafts a quotation inside a task; the task ends in review."""
    r = await client.post(
        "/api/tasks",
        json={"title": "Quote Contoh", "assignee_agent_id": agent["id"]},
        headers=csrf(client),
    )
    task = r.json()
    if run_id:
        async with SessionLocal() as db:
            t = await db.get(Task, task["id"])
            assert t is not None
            t.workflow_run_id = run_id
            await db.commit()
    llm.call("draft_document", template="quotation", title=title, values=QUOTE).say(
        "Drafted the quotation."
    )
    await _run(task["id"])
    docs = (await client.get("/api/documents", params={"task_id": task["id"]})).json()
    assert len(docs) == 1
    return task, docs[0]


async def _actions(action: str) -> list[AuditLog]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(AuditLog).where(AuditLog.action == action))).all())


async def test_agent_document_lands_in_the_ai_folder_once_per_format(
    client, llm, temporal, inline_reading
):
    o = await office(client)
    bid = o["branch"]["id"]
    await client.put(f"/api/company-kits/{bid}", json={"data": KIT}, headers=csrf(client))
    agent = await new_agent(client, o, "Aina")
    up = (await upload(client, "enquiry.txt", b"They want two guards", branch_id=bid)).json()
    assert up["origin"] == "uploaded"
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        assert a is not None
        run = WorkflowRun(
            workspace_id=a.workspace_id, name="Quote", title="Quote for Contoh", created_by="system"
        )
        db.add(run)
        await db.commit()
        run_id = run.id
    task, doc = await _agent_quote(client, llm, o, agent, run_id=run_id)

    # The document: made by the agent, in its task and workflow run, waiting for a person.
    assert doc["origin"] == "agent" and doc["agent_name"] == "Aina"
    assert doc["task_id"] == task["id"] and doc["task_title"] == "Quote Contoh"
    assert doc["workflow_run_id"] == run_id and doc["workflow_run_title"] == "Quote for Contoh"
    assert doc["status"] == "review" and doc["review_status"] == "waiting"
    assert [f["format"] for f in doc["files"]] == ["pdf"]
    assert doc["files"][0]["folder"] == "AI documents/Quotations"

    # Its PDF in the company's files, labelled with where it came from.
    fid = doc["files"][0]["id"]
    f = (await client.get(f"/api/files/{fid}")).json()
    assert f["origin"] == "agent" and f["agent_name"] == "Aina" and f["source"] == "generated"
    assert f["document_id"] == doc["id"] and f["task_id"] == task["id"]
    assert f["workflow_run_id"] == run_id and f["review_status"] == "waiting"
    assert f["mime"] == "application/pdf" and f["pages"] >= 1
    assert "made by Aina (AI agent)" in f["summary"]

    # Drafting again (same title) and exporting again replace the file, never add one.
    llm.call(
        "draft_document",
        template="quotation",
        title="Quotation for Contoh",
        values={"subject": "Guards"},
    )
    llm.call("export_document", document_id=doc["id"], format="pdf")
    llm.call("export_document", document_id=doc["id"], format="word").say("Exported.")
    r = await client.post(
        f"/api/tasks/{task['id']}/revise", json={"feedback": "again"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    await _run(task["id"])
    async with SessionLocal() as db:
        files = list(
            (await db.scalars(select(DocFile).where(DocFile.document_id == doc["id"]))).all()
        )
    assert sorted(x.mime.split("/")[-1][:20] for x in files) == [
        "pdf",
        "vnd.openxmlformats-o",
    ]
    assert next(x for x in files if x.mime == "application/pdf").id == fid
    tool_out = [m.content for m in await messages(task["id"]) if m.role == "tool"]
    assert any("folder AI documents/Quotations" in (c or "") for c in tool_out)

    # Filters: who made it, which agent.
    ai = (await client.get("/api/files", params={"origin": "agent"})).json()
    assert {x["id"] for x in ai} == {x.id for x in files}
    assert [
        x["id"] for x in (await client.get("/api/files", params={"origin": "uploaded"})).json()
    ] == [up["id"]]
    assert (await client.get("/api/files", params={"origin": "person"})).json() == []
    by_agent = (await client.get("/api/files", params={"agent_id": agent["id"]})).json()
    assert {x["id"] for x in by_agent} == {x.id for x in files}
    stats = (await client.get("/api/files/stats")).json()
    assert (stats["agent"], stats["uploaded"], stats["person"]) == (2, 1, 0)
    folder = (await client.get("/api/files", params={"folder": "AI documents/Quotations"})).json()
    assert len(folder) == 2
    assert [
        d["id"] for d in (await client.get("/api/documents", params={"origin": "agent"})).json()
    ] == [doc["id"]]
    assert (await client.get("/api/documents", params={"origin": "person"})).json() == []


async def test_review_queue_approve_and_audit(client, llm, temporal):
    o = await office(client)
    await client.put(
        f"/api/company-kits/{o['branch']['id']}", json={"data": KIT}, headers=csrf(client)
    )
    agent = await new_agent(client, o, "Aina")
    _, doc = await _agent_quote(client, llm, o, agent)
    # A person's own document is not in the queue.
    mine = (
        await client.post(
            "/api/documents", json={"title": "My note", "body": "Hello."}, headers=csrf(client)
        )
    ).json()
    assert mine["origin"] == "person" and mine["created_by_name"] == "Owner One"

    queue = (await client.get("/api/documents/review-queue")).json()
    assert [d["id"] for d in queue] == [doc["id"]]
    count = (await client.get("/api/documents/review-queue/count")).json()
    assert count["waiting"] == 1 and count["made_week"] == 1
    status_counts = (await client.get("/api/system/status")).json()["counts"]
    assert status_counts["documents_review"] == 1
    stats = (await client.get("/api/documents/stats")).json()
    assert (stats["agent"], stats["person"], stats["ai_waiting"]) == (1, 1, 1)
    waiting = (await client.get("/api/documents", params={"review": "waiting"})).json()
    assert [d["id"] for d in waiting] == [doc["id"]]

    r = await client.post(
        f"/api/documents/{doc['id']}/approve", json={"note": "Looks right"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "approved" and out["review_status"] == "approved"
    assert out["reviewed_by_name"] == "Owner One" and out["review_note"] == "Looks right"
    assert (await client.get("/api/documents/review-queue")).json() == []
    f = (await client.get(f"/api/files/{out['files'][0]['id']}")).json()
    assert f["review_status"] == "approved"
    audits = await _actions("document.approved")
    assert len(audits) == 1 and audits[0].target == doc["id"] and audits[0].note == "Looks right"
    again = await client.post(f"/api/documents/{doc['id']}/approve", json={}, headers=csrf(client))
    assert again.status_code == 409


async def test_send_back_goes_through_the_task_and_the_agent_revises(client, llm, temporal):
    o = await office(client)
    await client.put(
        f"/api/company-kits/{o['branch']['id']}", json={"data": KIT}, headers=csrf(client)
    )
    agent = await new_agent(client, o, "Aina")
    task, doc = await _agent_quote(client, llm, o, agent)
    assert (await client.get(f"/api/tasks/{task['id']}")).json()["task"]["status"] == "review"
    starts = len(temporal["start"])

    r = await client.post(
        f"/api/documents/{doc['id']}/send-back",
        json={"note": "Use 3 guards, not 2"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "draft" and out["review_status"] == "sent_back"
    assert out["review_note"] == "Use 3 guards, not 2" and out["revision_task_id"] == task["id"]
    assert len(temporal["start"]) == starts + 1  # the same task runs again
    msgs = await messages(task["id"])
    feedback = [m.content for m in msgs if m.role == "user" and "sent back" in (m.content or "")]
    assert feedback and "Use 3 guards" in feedback[-1] and doc["id"] in feedback[-1]
    assert len(await _actions("document.sent_back")) == 1
    again = await client.post(
        f"/api/documents/{doc['id']}/send-back", json={"note": "And more"}, headers=csrf(client)
    )
    assert again.status_code == 409 and again.json()["code"] == "already_sent_back"

    # The agent revises it: back to review, the PDF follows.
    fid = doc["files"][0]["id"]
    async with SessionLocal() as db:
        before = (await db.get(DocFile, fid)).sha256  # type: ignore[union-attr]
    items = [{"description": "Night guard", "qty": 3, "unit_price": 3200}]
    llm.call("revise_document", document_id=doc["id"], values={"items": items}).say("Now 3 guards.")
    await _run(task["id"])
    d = (await client.get(f"/api/documents/{doc['id']}")).json()
    assert d["status"] == "review" and d["review_status"] == "waiting"
    assert d["review_note"] == "Use 3 guards, not 2"  # the note stays with it
    async with SessionLocal() as db:
        f = await db.get(DocFile, fid)
        assert (
            f is not None
            and f.sha256 != before
            and "9,600.00" in (await db.scalar(select(DocFile.text).where(DocFile.id == fid)) or "")
        )
    assert [x["id"] for x in (await client.get("/api/documents/review-queue")).json()] == [
        doc["id"]
    ]


async def test_send_back_without_a_waiting_task_makes_a_revision_task(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task, doc = await _agent_quote(client, llm, o, agent)
    # The person already accepted the task; the document still waits.
    assert (
        await client.post(f"/api/tasks/{task['id']}/accept", json={}, headers=csrf(client))
    ).status_code == 200
    async with SessionLocal() as db:  # a workflow step, so its task is not re-opened
        t = await db.get(Task, task["id"])
        assert t is not None
        t.workflow_run_id = "wr_test"
        await db.commit()
    r = await client.post(
        f"/api/documents/{doc['id']}/send-back",
        json={"note": "Wrong client name"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    rev_id = r.json()["revision_task_id"]
    assert rev_id and rev_id != task["id"]
    rev = (await client.get(f"/api/tasks/{rev_id}")).json()["task"]
    assert rev["assignee_agent_id"] == agent["id"] and "revision" in rev["labels"]
    assert rev["title"] == "Revise: Quotation for Contoh"
    assert any(s[0] == rev_id for s in temporal["start"])
    # The revision task lists the document as its own.
    assert [
        d["id"] for d in (await client.get("/api/documents", params={"task_id": rev_id})).json()
    ] == [doc["id"]]
    llm.call(
        "revise_document", document_id=doc["id"], values={"client_name": "Syarikat Betul"}
    ).say("Fixed.")
    await _run(rev_id)
    async with SessionLocal() as db:
        d = await db.get(Document, doc["id"])
        assert (
            d is not None and d.status == "review" and d.values["client_name"] == "Syarikat Betul"
        )


async def test_people_documents_and_uploads_keep_their_origin(
    client, llm, temporal, inline_reading
):
    o = await office(client)
    mine = (
        await client.post(
            "/api/documents", json={"title": "Memo", "body": "Hi."}, headers=csrf(client)
        )
    ).json()
    assert mine["origin"] == "person" and mine["files"] == []
    r = await client.post(
        f"/api/documents/{mine['id']}/send-back", json={"note": "fix it"}, headers=csrf(client)
    )
    assert r.status_code == 409 and r.json()["code"] == "not_from_agent"
    r = await client.post(
        f"/api/documents/{mine['id']}/send-back",
        json={"note": "fix it"},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.json()["message"] == MS["No agent made this document. Edit it yourself instead."]
    up = (await upload(client, "notes.txt", b"plain notes", branch_id=o["branch"]["id"])).json()
    assert up["origin"] == "uploaded" and up["agent_name"] is None and up["review_status"] is None
    # A person's edit is audited.
    r = await client.patch(
        f"/api/documents/{mine['id']}", json={"body": "Hello again."}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert [a.target for a in await _actions("document.edited")] == [mine["id"]]


async def test_other_company_staff_cannot_see_ai_work(client, llm, temporal):
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    agent = await new_agent(client, o, "Aina")
    _, doc = await _agent_quote(client, llm, o, agent)
    fid = doc["files"][0]["id"]
    other = await as_role(client, "bm2@example.com", "branch_manager", branch_id=b2["id"])
    assert (await other.get("/api/documents/review-queue")).json() == []
    assert (await other.get("/api/documents/review-queue/count")).json()["waiting"] == 0
    assert (await other.get(f"/api/documents/{doc['id']}")).status_code == 404
    assert (await other.get(f"/api/files/{fid}")).status_code == 404
    assert (await other.get("/api/files", params={"origin": "agent"})).json() == []
    assert (await other.get("/api/system/status")).json()["counts"]["documents_review"] == 0
    same = await as_role(client, "bm1@example.com", "branch_manager", branch_id=o["branch"]["id"])
    assert [d["id"] for d in (await same.get("/api/documents/review-queue")).json()] == [doc["id"]]


async def test_reports_and_malay_folders(client, llm, temporal):
    o = await office(client)
    r = await client.put("/api/me/prefs", json={"locale": {"language": "ms"}}, headers=csrf(client))
    assert r.status_code == 200, r.text
    agent = await new_agent(client, o, "Aina")
    task = (
        await client.post(
            "/api/tasks",
            json={"title": "Weekly", "assignee_agent_id": agent["id"]},
            headers=csrf(client),
        )
    ).json()
    report = {
        "title": "Weekly guard hours",
        "summary": "Hours per site.",
        "tables": [{"title": "Sites", "columns": ["Site", "Hours"], "rows": [["A", 40]]}],
    }
    llm.call("publish_report", **report).call(
        "publish_report", **{**report, "summary": "Updated."}
    ).say("Done.")
    await _run(task["id"])
    async with SessionLocal() as db:
        files = list(
            (await db.scalars(select(DocFile).where(DocFile.report_id.is_not(None)))).all()
        )
    assert len(files) == 1  # the second publish replaced it
    f = files[0]
    assert f.folder == "Dokumen AI/Laporan" and f.origin == "agent" and f.agent_id == agent["id"]
    assert f.mime == "application/pdf" and f.summary == "Updated."
    # A Malay office's quotation goes under Dokumen AI too.
    _, doc = await _agent_quote(client, llm, o, agent)
    assert doc["files"][0]["folder"] == "Dokumen AI/Sebut harga"
    tool_out = [m.content for m in await messages(task["id"]) if m.role == "tool"]
    assert "Dokumen AI/Laporan" in (tool_out[0] or "")


async def test_run_python_outputs_are_labelled(client, llm, temporal, monkeypatch):
    """run_python files keep the agent (they did not before) and go to the AI folder."""
    import httpx

    from agentic.agents import codetool
    from agentic.agents.tools import ToolContext
    from agentic.core.config import settings
    from agentic.models import Agent, Workspace

    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    monkeypatch.setattr(settings, "sandbox_url", "http://sandbox.fake")

    class Fake(httpx.AsyncClient):
        async def post(self, url, **kw):  # type: ignore[override]
            return httpx.Response(
                200,
                json={
                    "exit_code": 0,
                    "stdout": "",
                    "files": [{"name": "sum.csv", "b64": "YSwxCg=="}],
                },
            )

    monkeypatch.setattr(codetool.httpx, "AsyncClient", Fake)
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        assert a is not None
        ws = await db.get(Workspace, a.workspace_id)
        out = await codetool.run_python(
            ToolContext(db=db, agent=a, workspace=ws, task=None), {"code": "x"}
        )  # type: ignore[arg-type]
    assert "sum.csv" in out
    rows = (
        await client.get("/api/files", params={"origin": "agent", "agent_id": agent["id"]})
    ).json()
    assert len(rows) == 1 and rows[0]["folder"] == "AI documents/Other files"
    count = (await client.get("/api/documents/review-queue/count")).json()
    assert count["files_week"] == 1


async def test_feedback_message_mentions_the_document(client, llm, temporal):
    """Send-back reaches the agent's conversation exactly once."""
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task, doc = await _agent_quote(client, llm, o, agent)
    await client.post(
        f"/api/documents/{doc['id']}/send-back",
        json={"note": "Shorter please"},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        rows = list(
            (
                await db.scalars(
                    select(AgentMessage).where(
                        AgentMessage.task_id == task["id"], AgentMessage.role == "user"
                    )
                )
            ).all()
        )
    assert sum("Shorter please" in (m.content or "") for m in rows) == 1


async def test_a_malay_company_gets_malay_templates_and_folders(client, llm, temporal):
    """The owner works in English; one company's kit says Bahasa Melayu. Its agent asking
    for "quotation" gets the Malay starter, with Malay labels, table and amount in words,
    and the PDF goes under Dokumen AI. The English company keeps English."""
    o = await office(client)
    b = o["branch"]["id"]
    agent = await new_agent(client, o, "Aina")
    # Made before the company chose Malay: English folder, moved when the language changes.
    _, early = await _agent_quote(client, llm, o, agent, title="Early quotation")
    assert early["files"][0]["folder"] == "AI documents/Quotations"
    r = await client.put(
        f"/api/company-kits/{b}", json={"data": {**KIT, "language": "ms"}}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["language"] == "ms"
    async with SessionLocal() as db:
        moved = await db.get(DocFile, early["files"][0]["id"])
        assert moved is not None and moved.folder == "Dokumen AI/Sebut harga"
    names = {t["name"] for t in (await client.get("/api/doc-templates")).json()}
    assert {"Quotation", "Sebut harga", "Invois", "Surat rasmi", "Pesanan penghantaran"} <= names
    _, doc = await _agent_quote(client, llm, o, agent)
    assert doc["template_name"] == "Sebut harga"
    assert doc["files"][0]["folder"] == "Dokumen AI/Sebut harga"
    text = (await client.get(f"/api/documents/{doc['id']}")).json()["preview"]
    assert "# Sebut Harga" in text and "| Bil. | Perkara |" in text
    assert "Ringgit Malaysia Enam Ribu Sembilan Ratus Dua Belas Sahaja" in text

    # An English company in the same workspace keeps the English starter and folder.
    other = (
        await client.post("/api/branches", json={"name": "Acme Ltd"}, headers=csrf(client))
    ).json()
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        assert a is not None
        a.branch_id = other["id"]
        await db.commit()
    _, doc2 = await _agent_quote(client, llm, o, agent, title="Quotation for Acme")
    assert doc2["template_name"] == "Quotation"
    assert doc2["files"][0]["folder"] == "AI documents/Quotations"
    # Removing the language keeps the Malay starters (added once), never adds them twice.
    await client.put(f"/api/company-kits/{b}", json={"data": KIT}, headers=csrf(client))
    names = [t["name"] for t in (await client.get("/api/doc-templates")).json()]
    assert names.count("Sebut harga") == 1
