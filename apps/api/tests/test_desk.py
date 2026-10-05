"""P26: My workspace — each person's desk.

Pins (and who may pin what), the SOPs and workflows for the person's job, their AI workers,
the work they gave and what came back, what waits for them, their workspace files, asking
their AI worker from the desk (the answer and any document land on their desk), uploading to
their workspace, and whose desk work belongs to (provenance.desk_owner).
"""

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import SOP, Agent, BrainPage, DocFile, Document, Task, Workflow

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_twins import ANSWERS


async def _staff_with_twin(client, o, email="siti@example.com", dept="Finance"):
    staff = await as_role(
        client, email, "staff", branch_id=o["branch"]["id"], department_id=o["depts"][dept]
    )
    r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
    assert r.status_code == 201, r.text
    return staff, r.json()["twin"]


async def _procedures(o, twin_id):
    """A department SOP, a company SOP, an everyone SOP, a draft, another department's SOP;
    a workflow the twin follows and one it does not."""
    async with SessionLocal() as db:
        twin = await db.get(Agent, twin_id)
        assert twin is not None
        ws = twin.workspace_id
        rows = {
            "dept": SOP(
                workspace_id=ws,
                scope="department",
                scope_id=o["depts"]["Finance"],
                title="Claims checking",
                body="Check every claim against the policy.",
                updated_by="test",
            ),
            "company": SOP(
                workspace_id=ws,
                scope="branch",
                scope_id=o["branch"]["id"],
                title="Office hours",
                body="Open 9 to 6.",
                updated_by="test",
            ),
            "all": SOP(
                workspace_id=ws, scope="workspace", title="Code of conduct", body="Be kind."
            ),
            "draft": SOP(
                workspace_id=ws,
                scope="department",
                scope_id=o["depts"]["Finance"],
                title="Draft procedure",
                body="Not yet.",
                status="draft",
            ),
            "other": SOP(
                workspace_id=ws,
                scope="department",
                scope_id=o["depts"]["Operations"],
                title="Forklift safety",
                body="Wear a helmet.",
            ),
        }
        flows = {
            "mine": Workflow(
                workspace_id=ws,
                name="Monthly claims",
                description="From claim forms to payment.",
                graph={"nodes": [{"id": "s", "type": "start"}], "edges": []},
                status="active",
                agent_ids=[twin_id],
                created_by="test",
            ),
            "other": Workflow(
                workspace_id=ws,
                name="Audit prep",
                graph={"nodes": [], "edges": []},
                status="active",
                agent_ids=[],
                created_by="test",
            ),
        }
        db.add_all([*rows.values(), *flows.values()])
        await db.commit()
        return {k: v.id for k, v in rows.items()}, {k: v.id for k, v in flows.items()}, ws


async def test_staff_desk_procedures_agents_and_pins(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    sops, flows, _ = await _procedures(o, twin["id"])
    try:
        d = (await staff.get("/api/desk")).json()
        assert d["person"]["department"] == "Finance" and d["can_ask"]
        assert [a["id"] for a in d["agents"]] == [twin["id"]] and d["agents"][0]["is_twin"]
        titles = [s["title"] for s in d["procedures"]["sops"]]
        # Their department's SOP first, then their company's, then everyone's.
        assert titles.index("Claims checking") < titles.index("Office hours")
        assert titles.index("Office hours") < titles.index("Code of conduct")
        assert "Draft procedure" not in titles and "Forklift safety" not in titles
        wf = d["procedures"]["workflows"]
        assert wf[0]["name"] == "Monthly claims" and wf[0]["followed"] is True
        assert wf[0]["url"] == f"/workflows?w={flows['mine']}"
        assert d["pins"] == [] and d["files"] == [] and d["work"] == []

        # Pin an SOP, a workflow and a search; pinning twice keeps one.
        for body in (
            {"kind": "sop", "ref": sops["dept"]},
            {"kind": "workflow", "ref": flows["mine"]},
            {"kind": "search", "ref": "  kelayakan   advance "},
            {"kind": "sop", "ref": sops["dept"]},
        ):
            r = await staff.post("/api/desk/items", json=body, headers=csrf(staff))
            assert r.status_code == 201, r.text
        pins = (await staff.get("/api/desk")).json()["pins"]
        assert [(p["kind"], p["title"]) for p in pins] == [
            ("sop", "Claims checking"),
            ("workflow", "Monthly claims"),
            ("search", "kelayakan advance"),
        ]
        assert pins[2]["url"] == "/search?q=kelayakan%20advance"
        # A wiki page is pinned by its id and opens at its path.
        async with SessionLocal() as db:
            page = BrainPage(
                workspace_id=(await db.get(Agent, twin["id"])).workspace_id,  # type: ignore[union-attr]
                path="wiki/reports/claims-oktober.md",
                name="claims-oktober",
                kind="wiki",
                title="Claims Oktober",
                body="Ringkasan tuntutan.",
                hash="x",
                updated_by="test",
            )
            db.add(page)
            await db.commit()
        r = await staff.post(
            "/api/desk/items", json={"kind": "page", "ref": page.id}, headers=csrf(staff)
        )
        assert r.status_code == 201, r.text
        assert r.json()["url"] == "/brain?tab=pages&path=wiki%2Freports%2Fclaims-oktober.md"
        r = await staff.delete(
            f"/api/desk/items/{r.json()['id']}",
            headers={"content-type": "application/json", **csrf(staff)},
        )
        # Not someone else's department's SOP, not a made-up id.
        for body in ({"kind": "sop", "ref": sops["other"]}, {"kind": "file", "ref": "fl_nope"}):
            r = await staff.post("/api/desk/items", json=body, headers=csrf(staff))
            assert r.status_code == 404, body
        # Reorder, unpin; another person's pin cannot be removed.
        r = await staff.put(
            "/api/desk/items/order",
            json={"ids": [pins[2]["id"], pins[0]["id"], pins[1]["id"]]},
            headers=csrf(staff),
        )
        assert r.status_code == 204
        order = [p["kind"] for p in (await staff.get("/api/desk")).json()["pins"]]
        assert order == ["search", "sop", "workflow"]
        r = await client.delete(
            f"/api/desk/items/{pins[2]['id']}",
            headers={"content-type": "application/json", **csrf(client)},
        )
        assert r.status_code == 404
        r = await staff.delete(
            f"/api/desk/items/{pins[2]['id']}",
            headers={"content-type": "application/json", **csrf(staff)},
        )
        assert r.status_code == 204
        assert len((await staff.get("/api/desk")).json()["pins"]) == 2
        # A deleted SOP stays pinned, marked missing, until unpinned.
        async with SessionLocal() as db:
            await db.delete(await db.get(SOP, sops["dept"]))
            await db.commit()
        gone = [p for p in (await staff.get("/api/desk")).json()["pins"] if p["kind"] == "sop"]
        assert gone[0]["missing"] is True and gone[0]["title"] == "Claims checking"
        # Owners have a desk too (no twin: no agents of their own, still procedures).
        mine = (await client.get("/api/desk")).json()
        assert mine["agents"] == [] and mine["procedures"]["sop_total"] >= 3
        assert mine["pins"] == []
    finally:
        await staff.aclose()


async def test_asking_from_the_desk_lands_the_work_on_the_desk(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    try:
        r = await staff.post(
            "/api/desk/ask",
            json={"text": "Kelayakan advance untuk pengawal baharu?", "make": "document"},
            headers=csrf(staff),
        )
        assert r.status_code == 201, r.text
        asked = r.json()
        assert asked["agent"]["id"] == twin["id"] and temporal["start"]
        async with SessionLocal() as db:
            t = await db.get(Task, asked["task_id"])
            assert t is not None and t.source == "desk" and t.requires_review
            assert "Kelayakan advance untuk pengawal baharu?" in t.brief
            assert "search_documents" in t.brief and "draft_document" in t.brief
        llm.call(
            "draft_document",
            title="Kelayakan advance",
            body="Pengawal baharu layak selepas 3 bulan [Polisi p.2].",
        ).say("Jawapan: layak selepas 3 bulan [Polisi p.2]. Draf disediakan.")
        step = await runtime.run_task_step(asked["task_id"])
        assert step.state == "done", step
        await runtime.finish(asked["task_id"], "done", step.message)

        d = (await staff.get("/api/desk")).json()
        work = next(w for w in d["work"] if w["id"] == asked["task_id"])
        assert work["from_me"] and work["agent_name"] == twin["name"]
        assert [m["title"] for m in work["made"] if m["kind"] == "document"] == [
            "Kelayakan advance"
        ]
        # The document and its PDF are on the staff member's desk, waiting for review.
        assert [x["title"] for x in d["documents"]] == ["Kelayakan advance"]
        assert d["file_counts"]["agent"] == 1 and d["files"][0]["origin"] == "agent"
        assert [x["title"] for x in d["waiting"]["documents"]] == ["Kelayakan advance"]
        assert [x["id"] for x in d["waiting"]["reviews"]] == [asked["task_id"]]
        async with SessionLocal() as db:
            doc = await db.scalar(select(Document).where(Document.task_id == asked["task_id"]))
            assert doc is not None and doc.owner_user_id is not None
        # The owner gave nothing and owns no worker: none of it is on their desk.
        mine = (await client.get("/api/desk")).json()
        assert mine["documents"] == [] and mine["files"] == []

        # Asking another person's worker is refused; no worker at all says how to get one.
        other, _ = await _staff_with_twin(client, o, "amir@example.com")
        r = await other.post(
            "/api/desk/ask",
            json={"text": "Help me with this please", "agent_id": twin["id"]},
            headers=csrf(other),
        )
        assert r.status_code == 400 and r.json()["code"] == "bad_agent"
        await other.aclose()
        r = await client.post("/api/desk/ask", json={"text": "Find it"}, headers=csrf(client))
        assert r.status_code == 400 and r.json()["code"] == "no_ai_worker"
        targets = (await client.get("/api/desk/ask-targets")).json()
        # Company agents only: never someone else's personal AI worker.
        assert twin["id"] not in [a["id"] for a in targets]
    finally:
        await staff.aclose()


async def test_my_workspace_files_are_mine(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    other, _ = await _staff_with_twin(client, o, "amir@example.com")
    try:
        r = await staff.post(
            "/api/desk/files",
            params={"name": "nota-saya.txt"},
            content=b"Nota peribadi tentang tuntutan bulan ini.",
            headers={**csrf(staff), "content-type": "application/octet-stream"},
        )
        assert r.status_code == 201, r.text
        f = r.json()
        assert f["folder"] == "My workspace/Siti" and f["branch_id"] == o["branch"]["id"]
        d = (await staff.get("/api/desk")).json()
        assert [x["id"] for x in d["files"]] == [f["id"]]
        assert d["file_counts"] == {"total": 1, "agent": 0, "uploaded": 1}
        # Not on anyone else's desk, and another staff member cannot open it.
        assert (await other.get("/api/desk")).json()["files"] == []
        assert (await other.get(f"/api/files/{f['id']}")).status_code == 404
        r = await other.post(
            "/api/desk/items", json={"kind": "file", "ref": f["id"]}, headers=csrf(other)
        )
        assert r.status_code == 404
        # The owner (who manages everything) sees it in Company files, not on their desk.
        assert (await client.get(f"/api/files/{f['id']}")).status_code == 200
        assert (await client.get("/api/desk")).json()["files"] == []

        # Work a company agent did on the staff member's task is theirs; the twin's own
        # scheduled work is its owner's; work nobody asked for is the company's.
        agent = await new_agent(client, o, "Nadia")
        async with SessionLocal() as db:
            from agentic.documents import provenance

            row_agent = await db.get(Agent, agent["id"])
            assert row_agent is not None
            t = Task(
                workspace_id=row_agent.workspace_id,
                title="Given by Siti",
                assignee_agent_id=agent["id"],
                created_by=f"user:{(await staff.get('/api/auth/me')).json()['user']['id']}",
                status="running",
            )
            db.add(t)
            await db.flush()
            sub = Task(
                workspace_id=t.workspace_id,
                title="Helper part",
                assignee_agent_id=agent["id"],
                created_by=f"agent:{agent['id']}",
                parent_task_id=t.id,
                root_task_id=t.id,
                status="running",
            )
            db.add(sub)
            await db.flush()
            siti = t.created_by[5:]
            assert (
                await provenance.desk_owner(db, f"agent:{agent['id']}", sub.id, agent["id"]) == siti
            )
            assert await provenance.desk_owner(db, "schedule:x", None, twin["id"]) == siti
            assert await provenance.desk_owner(db, "schedule:x", None, agent["id"]) is None
            await db.rollback()
        async with SessionLocal() as db:
            row = await db.get(DocFile, f["id"])
            assert row is not None and row.owner_user_id == siti
    finally:
        await staff.aclose()
        await other.aclose()
