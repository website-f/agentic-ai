"""P24: the AI turns how-to documents into draft SOPs and runnable workflows.

Every document here is synthetic (a leave procedure in Malay and in English, a made-up
tender flow); the model is scripted (test_agents.ScriptedLLM)."""

import json

import pytest
from sqlalchemy import select

from agentic.agents import dispatch, prompt, twin
from agentic.core.db import SessionLocal
from agentic.intake import builders
from agentic.knowledge import indexer
from agentic.knowledge import search as library
from agentic.models import (
    SOP,
    Agent,
    AuditLog,
    Branch,
    Department,
    DocFile,
    IntakeBatch,
    KnowledgeChunk,
    User,
    Workflow,
)
from agentic.teams.colleague import find_sops
from agentic.workflows import runs

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role

CUTI_MS = """TATACARA PERMOHONAN CUTI TAHUNAN KAKITANGAN

1. Kakitangan mengisi Borang Cuti (BC-01) sekurang-kurangnya 3 hari bekerja sebelum tarikh cuti.
2. Ketua Jabatan menyemak baki cuti dan meluluskan atau menolak permohonan dalam tempoh 2 hari.
3. Jika diluluskan, Eksekutif HR merekod cuti dalam Sistem HRMIS.
   Log masuk HRMIS: ID pengguna: hrexec01 / Kata laluan: Rahsia@2026 / PIN: 482913
4. Cuti tanpa gaji dipotong mengikut formula: Potongan = (Gaji bulanan / 26) x bilangan hari.
5. Pegawai Gaji memasukkan potongan sebelum 20hb setiap bulan.
"""

LEAVE_EN = """LEAVE APPLICATION PROCEDURE

1. The staff member submits the leave form at least 3 working days before the leave.
2. The HR executive checks the leave balance.
3. The head of department approves or rejects within 2 days.
4. If approved, HR enters the leave in the HR portal (HR portal password: Leave#2026).
5. Payroll calculates unpaid leave: deduction = monthly salary / 26 x days, before the 20th.
6. HR emails the staff member the decision.
"""


async def ws_of(o: dict) -> str:
    async with SessionLocal() as db:
        b = await db.get(Branch, o["branch"]["id"])
        assert b is not None
        return b.workspace_id


async def owner_actor() -> str:
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        assert u is not None
        return f"user:{u.id}"


async def add_file(
    ws: str,
    name: str,
    text: str,
    *,
    kind: str = "",
    folder: str = "",
    title: str = "",
    batch_id: str | None = None,
    branch_id: str | None = None,
    department_id: str | None = None,
    quarantined: bool = False,
    status: str = "ready",
) -> str:
    async with SessionLocal() as db:
        f = DocFile(
            workspace_id=ws,
            branch_id=branch_id,
            name=name,
            mime="text/plain",
            size=len(text),
            data=text.encode(),
            text=text,
            status=status,
            kind=kind,
            title=title or name.rsplit(".", 1)[0],
            folder=folder,
            batch_id=batch_id,
            department_id=department_id,
            quarantined=quarantined,
            created_by=await owner_actor(),
        )
        db.add(f)
        await db.commit()
        return f.id


async def add_dept(o: dict, name: str) -> str:
    async with SessionLocal() as db:
        b = await db.get(Branch, o["branch"]["id"])
        assert b is not None
        d = Department(
            workspace_id=b.workspace_id, branch_id=b.id, name=name, slug=name.lower(), position=9
        )
        db.add(d)
        await db.commit()
        o["depts"][name] = d.id
        return d.id


async def add_batch(o: dict, suggestions: list[dict] | None = None) -> str:
    async with SessionLocal() as db:
        b = IntakeBatch(
            workspace_id=await ws_of(o),
            branch_id=o["branch"]["id"],
            name="docs.zip",
            status="ready",
            report={"suggestions": suggestions or []},
            created_by=await owner_actor(),
        )
        db.add(b)
        await db.commit()
        return b.id


# ---------------------------------------------------------------- pure rules


def test_secrets_go_but_instructions_stay():
    text, kinds = builders.scrub("Kata laluan: Rahsia@2026 / PIN: 482913", "ms")
    assert text == "Kata laluan: [dibuang] / PIN: [dibuang]"
    assert {"password", "pin"} <= set(kinds)
    text, kinds = builders.scrub("ID pengguna: hrexec01, password is hunter2", "en")
    assert "hrexec01" not in text and "hunter2" not in text
    assert "login_id" in kinds and "password" in kinds
    assert builders.scrub("| Kata laluan | Abc12345 |", "ms")[0] == "| Kata laluan | [dibuang] |"
    for keep in (
        "PIN: masukkan PIN sijil digital anda",
        "Password: change it every 90 days.",
        "Log in with your own account.",
        "Masukkan kata laluan anda sendiri.",
    ):
        assert builders.scrub(keep)[0] == keep
    assert builders.scrub("No. K/P 900101-14-5678")[0] == "No. K/P [removed]"


def test_language_of_reads_the_document():
    assert builders.language_of(CUTI_MS) == "ms"
    assert builders.language_of(LEAVE_EN) == "en"


def test_work_only_a_person_can_do_becomes_an_input_step():
    g = {
        "nodes": [
            {"id": "a", "type": "step", "action": "task", "title": "Log in to ePerolehan"},
            {"id": "b", "type": "step", "action": "", "title": "Tandatangan borang"},
            {"id": "c", "type": "step", "action": "email", "title": "Draft email for signature"},
            {"id": "d", "type": "step", "action": "task", "title": "Check the documents"},
            {"id": "e", "type": "step", "title": "Submit the bid on the portal"},
        ],
        "edges": [],
    }
    assert builders.person_steps(g) == ["a", "b", "e"]
    assert [n["type"] for n in g["nodes"]] == ["input", "input", "step", "step", "input"]


@pytest.mark.parametrize(
    "graph",
    [
        {"nodes": [], "edges": []},
        {  # no start, no end, a one-branch approval, a branchless decision, dead ends
            "nodes": [
                {"id": "a", "type": "step", "title": "Fill form", "action": "write"},
                {"id": "b", "type": "decision", "title": "Approve?", "action": "approval"},
                {"id": "c", "type": "step", "title": "Pay", "action": "calculate"},
                {"id": "d", "type": "step", "title": "Orphan", "action": "check"},
                {"id": "e", "type": "decision", "title": "Nothing"},
            ],
            "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}],
        },
        {  # two starts, an edge into the start, an edge out of the end, duplicate labels
            "nodes": [
                {"id": "s", "type": "start"},
                {"id": "s2", "type": "start"},
                {"id": "x", "type": "step", "title": "Check"},
                {"id": "q", "type": "decision", "title": "OK?"},
                {"id": "y", "type": "step", "title": "Fix"},
                {"id": "z", "type": "end"},
            ],
            "edges": [
                {"from": "s", "to": "x"},
                {"from": "s2", "to": "y"},
                {"from": "x", "to": "q"},
                {"from": "q", "to": "y", "label": "yes"},
                {"from": "q", "to": "z", "label": "Yes"},
                {"from": "y", "to": "s"},
                {"from": "z", "to": "x"},
            ],
        },
        {  # only a loop: the end must still be reached
            "nodes": [
                {"id": "s", "type": "start"},
                {"id": "a", "type": "step", "title": "A"},
                {"id": "b", "type": "step", "title": "B"},
            ],
            "edges": [
                {"from": "s", "to": "a"},
                {"from": "a", "to": "b"},
                {"from": "b", "to": "a"},
            ],
        },
    ],
)
def test_repair_makes_any_draft_runnable(graph):
    fixed = builders.repair(graph, "ms")
    if not graph["nodes"]:
        assert fixed["nodes"] == []
        return
    assert builders.problems(graph) != []
    assert builders.problems(fixed) == [], builders.problems(fixed)


# ---------------------------------------------------------------- suggestions


async def test_suggestions_group_one_process_and_skip_what_exists(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    batch = await add_batch(o)
    fin = o["depts"]["Finance"]
    b = o["branch"]["id"]
    charts = [
        await add_file(
            ws,
            f"CARTA ALIR {i} - TENDER.png",
            f"Carta alir {i}: semak tender, kemas kini senarai",
            kind="flowchart",
            folder="TENDER/CARTA ALIR",
            batch_id=batch,
            branch_id=b,
        )
        for i in (1, 2, 3)
    ]
    guide = await add_file(
        ws,
        "TATACARA TENDER.pdf",
        "Tatacara sebelum penyediaan tender. Kata laluan: Tender#99",
        kind="guide",
        folder="TENDER",
        batch_id=batch,
        branch_id=b,
    )
    leave = await add_file(
        ws, "Polisi cuti.pdf", CUTI_MS, kind="policy", batch_id=batch, department_id=fin
    )
    claims = await add_file(
        ws,
        "Petty cash.pdf",
        "Tuntutan petty cash RM500.",
        kind="sop",
        title="Tuntutan petty cash",
        batch_id=batch,
    )
    await add_file(ws, "Borang cuti.docx", "Nama: ____", kind="form", batch_id=batch)
    await add_file(
        ws, "Login portal.pdf", "SOP log masuk", kind="sop", batch_id=batch, quarantined=True
    )
    await add_file(ws, "Other upload.pdf", "SOP lain", kind="sop")  # not in this batch
    r = await client.post(
        "/api/sops",
        json={"scope": "workspace", "title": "Tuntutan petty cash", "body": "x"},
        headers=csrf(client),
    )
    assert r.status_code == 201
    # The model's answer, in the files' order: f1-f3 charts (folder order), f4 the guide...
    async with SessionLocal() as db:
        order = [
            f.id
            for f in (
                await db.scalars(
                    select(DocFile)
                    .where(
                        DocFile.batch_id == batch,
                        DocFile.quarantined.is_(False),
                        DocFile.kind != "form",
                    )
                    .order_by(DocFile.folder, DocFile.name)
                )
            ).all()
        ]
    ref = {fid: f"f{i}" for i, fid in enumerate(order, 1)}
    llm.say(
        json.dumps(
            {
                "suggestions": [
                    {
                        "what": "workflow",
                        "title": "Penyediaan tender",
                        "files": [ref[c] for c in charts] + [ref[guide]],
                        "reason": "Tiga carta alir dan tatacara bagi satu proses tender.",
                    },
                    {
                        "what": "sop",
                        "title": "Permohonan cuti tahunan",
                        "files": [ref[leave]],
                        "reason": "Peraturan cuti, tempoh dan formula potongan.",
                    },
                    {
                        "what": "sop",
                        "title": "Tuntutan Petty Cash",  # the company has it already
                        "files": [ref[claims]],
                        "reason": "x",
                    },
                    {"what": "sop", "title": "Ghost", "files": ["f99"], "reason": "x"},
                    {"what": "memo", "title": "Bad kind", "files": ["f1"], "reason": "x"},
                ]
            }
        )
    )
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, batch)
        assert bt is not None
        out = await builders.suggest_for_batch(db, bt)
    sent = llm.requests[-1]["messages"]
    assert "Group files that describe ONE process" in sent[0]["content"]
    asked = sent[1]["content"]
    assert "Borang cuti" not in asked and "Login portal" not in asked
    assert "Other upload" not in asked and "Tender#99" not in asked
    assert "Tuntutan petty cash" in asked  # what the company has is listed
    assert [s["title"] for s in out] == ["Penyediaan tender", "Permohonan cuti tahunan"]
    wf, sop = out
    assert wf == {
        "id": "s1",
        "what": "workflow",
        "title": "Penyediaan tender",
        "file_ids": charts + [guide],
        "department_id": None,
        "reason": "Tiga carta alir dan tatacara bagi satu proses tender.",
        "status": "new",
        "built_id": None,
        "section": None,
    }
    assert sop["id"] == "s2" and sop["file_ids"] == [leave] and sop["department_id"] == fin

    # No usable answer from the model: folders and kinds still give the same shapes.
    llm.say("not json at all")
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, batch)
        assert bt is not None
        out = await builders.suggest_for_batch(db, bt)
    whats = [(s["what"], set(s["file_ids"])) for s in out]
    assert ("workflow", set(charts) | {guide}) in whats
    assert ("sop", {leave}) in whats
    assert all(s["file_ids"] != [claims] for s in out)  # its title exists already


# ---------------------------------------------------------------- SOP drafts

SOP_REPLY = """```markdown
# Permohonan cuti tahunan

Sumber: something the model made up

Prosedur ini menerangkan cara memohon cuti tahunan.

## Langkah
1. Kakitangan mengisi Borang Cuti (BC-01) sekurang-kurangnya 3 hari bekerja sebelum cuti.
2. Ketua Jabatan menyemak baki cuti dan membuat keputusan dalam tempoh 2 hari.
3. Eksekutif HR merekod cuti dalam Sistem HRMIS. Kata laluan: Rahsia@2026

## Formula potongan
| Perkara | Formula |
|---|---|
| Cuti tanpa gaji | (Gaji bulanan / 26) x bilangan hari |
```"""


async def test_an_sop_is_drafted_from_a_malay_document(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    hr = await add_dept(o, "HR")
    fid = await add_file(ws, "Tatacara cuti.pdf", CUTI_MS, kind="sop", branch_id=o["branch"]["id"])
    llm.say(SOP_REPLY)
    r = await client.post(
        "/api/builders/sop", json={"file_ids": [fid], "department_id": hr}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["status"] == "draft" and s["scope"] == "department" and s["scope_id"] == hr
    assert s["source_file_ids"] == [fid]
    assert s["source_files"] == [{"id": fid, "name": "Tatacara cuti.pdf"}]
    body = s["body"]
    assert body.startswith("# Permohonan cuti tahunan\n\nSumber: Tatacara cuti.pdf\n")
    assert "something the model made up" not in body and "```" not in body
    assert "(Gaji bulanan / 26) x bilangan hari" in body  # formulas kept exactly
    assert "Rahsia@2026" not in body and "Kata laluan: [dibuang]" in body
    assert "## Untuk ejen AI" in body  # the AI's role, added when the model left it out
    system, user = (m["content"] for m in llm.requests[-1]["messages"])
    assert "Bahasa Melayu" in system and "EXACTLY as written" in system
    assert "log masuk dengan akaun anda sendiri" in system
    # The model never saw the secrets in the source.
    assert "Rahsia@2026" not in user and "482913" not in user and "hrexec01" not in user
    assert "Tatacara cuti.pdf" in user and "Gaji bulanan / 26" in user
    async with SessionLocal() as db:
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "sop.drafted"))
        assert row is not None and "password" in row.after["secrets_removed"]
        # A draft is not in the library index.
        n = await db.scalar(
            select(KnowledgeChunk.id).where(KnowledgeChunk.source_id == s["id"]).limit(1)
        )
        assert n is None


async def test_files_that_cannot_be_used_are_refused(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    held = await add_file(ws, "Login.pdf", "Kata laluan: X1", kind="sop", quarantined=True)
    reading = await add_file(ws, "New.pdf", "", kind="sop", status="reading")
    r = await client.post("/api/builders/sop", json={"file_ids": [held]}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "file_held"
    r = await client.post(
        "/api/builders/sop",
        json={"file_ids": [held]},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.json()["message"].startswith("Login.pdf ditahan untuk semakan")
    r = await client.post(
        "/api/builders/workflow", json={"file_ids": [reading]}, headers=csrf(client)
    )
    assert r.status_code == 409 and r.json()["code"] == "file_not_ready"
    r = await client.post("/api/builders/sop", json={"file_ids": ["fl_nope"]}, headers=csrf(client))
    assert r.status_code == 404
    assert llm.requests == []  # nothing reached a model


# ---------------------------------------------------------------- workflow drafts

WF_REPLY = {
    "name": "Leave application",
    "description": "Staff apply, HR checks, the head approves, payroll deducts unpaid leave.",
    "nodes": [
        {"id": "n1", "type": "start", "title": "Leave form received"},
        {
            "id": "n2",
            "type": "step",
            "action": "check",
            "title": "Check leave balance",
            "body": "Check the balance and the 3 working days notice.",
            "role": "HR executive",
            "dept": "HR",
        },
        {
            "id": "n3",
            "type": "decision",
            "action": "approval",
            "title": "Head of department approves?",
            "role": "Head of department",
        },
        {
            "id": "n4",
            "type": "input",
            "title": "Confirm leave entered in the HR portal",
            "body": "HR enters the leave in the HR portal with their own account.",
        },
        {
            "id": "n5",
            "type": "step",
            "action": "calculate",
            "title": "Calculate unpaid leave deduction",
            "body": "Deduction = monthly salary / 26 x days, before the 20th.",
            "role": "Payroll",
            "dept": "Finance",
        },
        {
            "id": "n6",
            "type": "step",
            "action": "email",
            "review": True,
            "title": "Draft decision email",
            "role": "HR executive",
            "dept": "HR",
        },
        {"id": "n7", "type": "end", "title": "Leave recorded"},
        {
            "id": "n8",
            "type": "step",
            "action": "check",
            "title": "File the form",
            "role": "Operations clerk",
            "dept": "Operations",
        },
        {  # a person's work given to an agent: it becomes an input step
            "id": "n9",
            "type": "step",
            "action": "task",
            "title": "Sign the leave form",
            "body": "The head of department signs the approved form.",
            "dept": "Management",
        },
    ],
    "edges": [
        {"from": "n1", "to": "n2", "label": "next"},
        {"from": "n2", "to": "n3"},
        {"from": "n3", "to": "n4"},  # one branch only: the repair adds the rejection
        {"from": "n4", "to": "n9"},
        {"from": "n9", "to": "n5"},
        {"from": "n5", "to": "n6"},
        {"from": "n6", "to": "n7"},
        {"from": "n6", "to": "n8"},  # n8 is a dead end
    ],
}


async def test_a_runnable_workflow_is_drafted_and_staffed(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    await add_dept(o, "HR")
    aina = await new_agent(client, o, "Aina", "Finance")
    hana = await new_agent(client, o, "Hana", "HR")
    omar = await new_agent(client, o, "Omar", "Operations")
    fid = await add_file(
        ws, "Leave procedure.docx", LEAVE_EN, kind="procedure", branch_id=o["branch"]["id"]
    )
    llm.say(json.dumps(WF_REPLY))
    r = await client.post("/api/builders/workflow", json={"file_ids": [fid]}, headers=csrf(client))
    assert r.status_code == 201, r.text
    wf = r.json()
    assert wf["status"] == "draft" and wf["source"] == "analyst"
    assert wf["name"] == "Leave application" and wf["branch_id"] == o["branch"]["id"]
    assert wf["description"].startswith("Staff apply")
    assert wf["source_files"] == [{"id": fid, "name": "Leave procedure.docx"}]
    g = wf["graph"]
    assert builders.problems(g) == []
    nodes = {n["id"]: n for n in g["nodes"]}
    assert nodes["n2"]["agent_id"] == hana["id"] and nodes["n6"]["agent_id"] == hana["id"]
    assert nodes["n5"]["agent_id"] == aina["id"] and nodes["n8"]["agent_id"] == omar["id"]
    assert nodes["n4"]["type"] == "input" and nodes["n4"]["agent_id"] == ""
    assert nodes["n9"]["type"] == "input" and nodes["n9"]["agent_id"] == ""
    assert nodes["n6"]["review"] is True
    branches = {e["label"] for e in g["edges"] if e["from"] == "n3"}
    assert branches == {"Approved", "Rejected"}
    assert all(not e["label"] for e in g["edges"] if e["from"] != "n3")
    assert any(e["from"] == "n8" for e in g["edges"])  # the dead end now finishes
    assert set(wf["agent_ids"]) == {hana["id"], aina["id"], omar["id"]}
    system, user = (m["content"] for m in llm.requests[-1]["messages"])
    assert system.startswith("You design office procedures as a graph")
    assert "is type input: a person does it" in system and "English" in system
    assert "- HR: Hana (HR agent)" in user and "Leave procedure.docx" in user
    assert "Leave#2026" not in user  # the portal password never reached the model
    # It runs: every agent step has an agent, every decision has branches.
    async with SessionLocal() as db:
        row = await db.get(Workflow, wf["id"])
        assert row is not None
        assign = await runs.suggest(db, ws, row.graph, row.branch_id)
        run = await runs.start(
            db,
            workspace_id=ws,
            workflow=row,
            title="Ali, 3 days",
            job="Ali applies for 3 days of leave.",
            branch_id=row.branch_id,
            assign=assign,
            file_ids=[],
            created_by="user:test",
        )
        assert run.status == "running"
        await db.rollback()
    listed = (await client.get("/api/workflows")).json()
    assert listed[0]["source_files"][0]["name"] == "Leave procedure.docx"


# ---------------------------------------------------------------- long documents


async def test_long_documents_build_in_the_background(client, llm, temporal, monkeypatch):
    o = await office(client)
    ws = await ws_of(o)
    monkeypatch.setattr(builders, "SINGLE_PASS_CHARS", 300)
    monkeypatch.setattr(builders, "PART_CHARS", 250)
    started: list[str] = []

    async def start_build(job_id: str) -> None:
        started.append(job_id)

    monkeypatch.setattr(dispatch, "start_build", start_build)
    fid = await add_file(ws, "Handbook.pdf", CUTI_MS * 2, kind="handbook")
    sop_batch = await add_batch(
        o,
        [
            {
                "id": "s1",
                "what": "sop",
                "title": "Cuti",
                "file_ids": [fid],
                "department_id": None,
                "reason": "x",
                "status": "new",
                "built_id": None,
            }
        ],
    )
    r = await client.post(
        f"/api/intake/{sop_batch}/suggestions/s1/build", json={}, headers=csrf(client)
    )
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["status"] == "running" and started == [job["id"]]
    assert r.json()["suggestion"]["job_id"] == job["id"]
    # Asking again while it runs does not start a second build.
    again = await client.post(
        f"/api/intake/{sop_batch}/suggestions/s1/build", json={}, headers=csrf(client)
    )
    assert again.status_code == 202 and started == [job["id"]]
    async with SessionLocal() as db:
        files = await builders.load_files(db, [fid])
        parts = len(builders._parts(builders._source(files)[0]))
        # A suggestion's build is focused on its title ("Cuti"): only that section is read.
        fparts = len(builders._parts(builders._source(files, "Cuti")[0]))
    assert parts > 1 and fparts > 1
    for i in range(fparts):
        llm.say(f"- nota bahagian {i + 1}: Borang Cuti (BC-01), 3 hari bekerja")
    llm.say(SOP_REPLY)
    async with SessionLocal() as db:
        done = await builders.run_job(db, job["id"])
    assert done is not None and done["status"] == "done"
    assert len(llm.requests) == fparts + 1
    assert "Part 1 of" in llm.requests[0]["messages"][1]["content"]
    assert "Notes taken from the documents" in llm.requests[-1]["messages"][1]["content"]
    r = await client.get(f"/api/builders/jobs/{job['id']}", headers={"x-lang": "ms"})
    assert r.json()["status"] == "done" and r.json()["built_id"] == done["built_id"]
    sops = (await client.get("/api/sops")).json()
    assert [s["status"] for s in sops] == ["draft"] and sops[0]["id"] == done["built_id"]
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, sop_batch)
        assert bt is not None
        s1 = bt.report["suggestions"][0]
        assert s1["status"] == "built" and s1["built_id"] == done["built_id"]
    # Built already: asking again just shows it.
    r = await client.post(
        f"/api/intake/{sop_batch}/suggestions/s1/build", json={}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["sop"]["id"] == done["built_id"]

    # Temporal down: the build runs right here instead.
    async def down(job_id: str) -> None:
        raise RuntimeError("temporal is down")

    monkeypatch.setattr(dispatch, "start_build", down)
    for i in range(parts):
        llm.say(f"- nota {i + 1}")
    llm.say(SOP_REPLY)
    r = await client.post("/api/builders/sop", json={"file_ids": [fid]}, headers=csrf(client))
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "draft"


# ---------------------------------------------------------------- suggestions: build, dismiss


async def test_suggestions_are_built_and_dismissed(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    fin = o["depts"]["Finance"]
    fid = await add_file(ws, "Tatacara cuti.pdf", CUTI_MS, kind="sop", department_id=fin)
    item = {
        "file_ids": [fid],
        "department_id": fin,
        "reason": "x",
        "status": "new",
        "built_id": None,
    }
    batch = await add_batch(
        o,
        [
            {**item, "id": "s1", "what": "sop", "title": "Cuti"},
            {**item, "id": "s2", "what": "workflow", "title": "Cuti flow"},
        ],
    )
    llm.say(SOP_REPLY)
    r = await client.post(
        f"/api/intake/{batch}/suggestions/s1/build", json={}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["sop"]["status"] == "draft" and out["sop"]["scope_id"] == fin
    assert out["suggestion"]["status"] == "built"
    assert out["suggestion"]["built_id"] == out["sop"]["id"]
    r = await client.post(
        f"/api/intake/{batch}/suggestions/s1/dismiss", json={}, headers=csrf(client)
    )
    assert r.status_code == 409
    r = await client.post(
        f"/api/intake/{batch}/suggestions/s2/dismiss", json={}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["suggestion"]["status"] == "dismissed"
    r = await client.post(
        f"/api/intake/{batch}/suggestions/s9/build", json={}, headers=csrf(client)
    )
    assert r.status_code == 404
    r = await client.post("/api/intake/ib_nope/suggestions/s1/build", json={}, headers=csrf(client))
    assert r.status_code == 404
    async with SessionLocal() as db:
        bt = await db.get(IntakeBatch, batch)
        assert bt is not None
        assert [s["status"] for s in bt.report["suggestions"]] == ["built", "dismissed"]


# ---------------------------------------------------------------- drafts never reach agents


async def test_a_draft_sop_never_reaches_an_agent_until_approved(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    aina = await new_agent(client, o, "Aina", "Finance")
    fin = o["depts"]["Finance"]
    fid = await add_file(ws, "Tatacara cuti.pdf", CUTI_MS, kind="sop")
    llm.say(SOP_REPLY)
    r = await client.post(
        "/api/builders/sop", json={"file_ids": [fid], "department_id": fin}, headers=csrf(client)
    )
    draft = r.json()
    r = await client.post(
        "/api/sops",
        json={
            "scope": "department",
            "scope_id": fin,
            "title": "Petty cash",
            "body": "Tuntutan petty cash RM500 sebulan dengan resit.",
        },
        headers=csrf(client),
    )
    active = r.json()
    assert active["status"] == "active"  # SOPs people write are active at once

    async def seen() -> dict[str, bool]:
        async with SessionLocal() as db:
            agent = await db.get(Agent, aina["id"])
            assert agent is not None
            parts = [p.title for p in await prompt.build_parts(db, agent)]
            found = await find_sops(db, agent, "cuti tahunan borang potongan gaji")
            hits = await library.search(
                db, library.for_agent(agent), "cuti tahunan borang", kinds=("sop",)
            )
            owner = await db.scalar(select(User).where(User.email == "owner@example.com"))
            assert owner is not None
            dept = await db.get(Department, fin)
            home = twin.Home(owner, "owner", await db.get(Branch, o["branch"]["id"]), dept)
            auto = [s["id"] for s in await twin.auto_sops(db, ws, home)]
            return {
                "prompt": any("Permohonan cuti" in t for t in parts),
                "find_sop": "Permohonan cuti" in found,
                "search": any(h.source_id == draft["id"] for h in hits),
                "twin": draft["id"] in auto,
                "active_in_prompt": any("Petty cash" in t for t in parts),
            }

    before = await seen()
    assert before == {
        "prompt": False,
        "find_sop": False,
        "search": False,
        "twin": False,
        "active_in_prompt": True,
    }
    async with SessionLocal() as db:  # a reindex leaves drafts out too
        await indexer.reindex_workspace(db, ws)
        assert await indexer.index_sop(db, draft["id"]) == 0
    assert (await seen())["search"] is False

    # Approve: from now on every agent in scope follows it.
    r = await client.patch(
        f"/api/sops/{draft['id']}", json={"status": "active"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["status"] == "active"
    after = await seen()
    assert after == {k: True for k in after}
    async with SessionLocal() as db:
        row = await db.scalar(select(AuditLog).where(AuditLog.action == "sop.approved"))
        assert row is not None and row.target == draft["id"]
        assert row.before == {"status": "draft"}
    # Back to draft: gone again.
    r = await client.patch(
        f"/api/sops/{draft['id']}", json={"status": "draft"}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert (await seen())["prompt"] is False and (await seen())["search"] is False
    async with SessionLocal() as db:
        s = await db.get(SOP, draft["id"])
        assert s is not None and s.status == "draft"


# ---------------------------------------------------------------- permissions


async def test_who_may_build_and_approve(client, llm, temporal):
    o = await office(client)
    ws = await ws_of(o)
    b = o["branch"]["id"]
    fid = await add_file(ws, "Tatacara cuti.pdf", CUTI_MS, kind="sop", branch_id=b)
    llm.say(SOP_REPLY)
    draft = (
        await client.post("/api/builders/sop", json={"file_ids": [fid]}, headers=csrf(client))
    ).json()
    batch = await add_batch(
        o,
        [
            {
                "id": "s1",
                "what": "sop",
                "title": "Cuti",
                "file_ids": [fid],
                "department_id": None,
                "reason": "x",
                "status": "new",
                "built_id": None,
            }
        ],
    )
    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=b, department_id=o["depts"]["Finance"]
    )
    viewer = await as_role(client, "viewer@example.com", "viewer")
    try:
        r = await staff.post("/api/builders/sop", json={"file_ids": [fid]}, headers=csrf(staff))
        assert r.status_code == 403
        r = await staff.patch(
            f"/api/sops/{draft['id']}", json={"status": "active"}, headers=csrf(staff)
        )
        assert r.status_code == 403
        r = await staff.post(
            f"/api/intake/{batch}/suggestions/s1/build", json={}, headers=csrf(staff)
        )
        assert r.status_code in (403, 404)
        # Staff may draft workflows (like drawing one), but only from files they can see.
        r = await staff.post(
            "/api/builders/workflow", json={"file_ids": [fid]}, headers=csrf(staff)
        )
        assert r.status_code == 404
        r = await viewer.post(
            "/api/builders/workflow", json={"file_ids": [fid]}, headers=csrf(viewer)
        )
        assert r.status_code == 403
        assert (await viewer.get("/api/sops")).status_code == 200
    finally:
        await staff.aclose()
        await viewer.aclose()
    async with SessionLocal() as db:
        s = await db.get(SOP, draft["id"])
        assert s is not None and s.status == "draft"
