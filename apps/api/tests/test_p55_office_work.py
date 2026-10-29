"""P55: staff see only their own company; the Chief of Staff hands a job to the best-suited
agent; agents file and compile documents; premade roles and office skills; importing an
open Agent Skills SKILL.md."""

from agentic.agents.tools import TOOLS, ToolContext
from agentic.api.scope import Scope, watch_view
from agentic.core.db import SessionLocal
from agentic.models import Agent, DocFile, Workspace
from agentic.teams import routing

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_documents import inline_reading, upload  # noqa: F401
from .test_office_roles import as_role, two_branches

# ---------------------------------------------------------------- one company only


async def test_staff_see_their_own_company_only(client, llm, temporal):
    o, fin, ops, far = await two_branches(client)
    a, b = o["branch"]["id"], o["b2"]["id"]
    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=a, department_id=o["depts"]["Operations"]
    )
    # The company list holds theirs only (not the other company's name or departments).
    assert [x["id"] for x in (await staff.get("/api/branches")).json()] == [a]
    assert (await staff.get(f"/api/office/{b}")).status_code == 404
    floor = (await staff.get(f"/api/office/{a}")).json()
    watched = next(x for x in floor["agents"] if x["id"] == fin["id"])
    # A colleague's agent: that it works, not on what.
    assert watched["view_only"] is True and watched["task"] is None and watched["last"] is None
    # The owner still sees every company.
    assert {x["id"] for x in (await client.get("/api/branches")).json()} == {a, b}


def test_no_company_watches_no_office_and_watchers_get_no_content():
    lost = Scope("own", "u1", None, None)
    other = Agent(id="ag1", branch_id="b1", private=False, owner_user_id="u2")
    assert not lost.observes_agent(other)  # was: every company's agents
    ev = {
        "agent_id": "ag1",
        "agent_name": "Faiz",
        "kind": "think",
        "task_title": "Payroll for Aina",
        "text": "Aina's salary is ...",
    }
    assert watch_view("agent.activity", ev, set()) == {
        "agent_id": "ag1",
        "agent_name": "Faiz",
        "kind": "think",
    }
    assert watch_view("agent.activity", ev, {"ag1"}) is ev  # their own: in full
    st = {"agent_id": "ag1", "status": "working", "task": {"id": "t1", "title": "Payroll"}}
    assert watch_view("agent.status", st, set()) == {"agent_id": "ag1", "status": "working"}


# ---------------------------------------------------------------- the right agent for a job


async def test_the_best_suited_agent_gets_the_job(client, llm, temporal):
    o = await office(client)
    admin = await new_agent(
        client,
        o,
        "Rina",
        "Operations",
        role="Admin and filing clerk",
        soul="I file documents into folders, compile packs and keep records tidy.",
    )
    finance = await new_agent(
        client,
        o,
        "Faiz",
        "Finance",
        role="Finance clerk",
        soul="I prepare invoices, chase overdue payments and reconcile statements.",
    )
    async with SessionLocal() as db:
        rows = [await db.get(Agent, admin["id"]), await db.get(Agent, finance["id"])]
        pick = await routing.rank(db, rows, "Please file these scanned documents into folders")
        assert pick[0].agent.id == admin["id"] and "file" in pick[0].why
        pick = await routing.rank(db, rows, "Chase the overdue invoices from last month")
        assert pick[0].agent.id == finance["id"]


# ---------------------------------------------------------------- filing and compiling


async def test_an_agent_files_and_compiles_documents(client, llm, temporal, inline_reading):
    o = await office(client)
    ag = await new_agent(client, o, "Rina", "Operations")
    one = (await upload(client, "receipt-1.txt", b"Grab ride RM 23.50 on 3 Oct 2026")).json()
    two = (await upload(client, "receipt-2.txt", b"Parking RM 8.00 on 4 Oct 2026")).json()
    async with SessionLocal() as db:
        agent = await db.get(Agent, ag["id"])
        ws = await db.get(Workspace, agent.workspace_id)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
        out = await TOOLS["file_document"].handler(
            ctx, {"file_ids": [one["id"], two["id"]], "folder": "Finance/Claims/../2026-10"}
        )
        assert "Filed 2 file(s) into Finance/Claims/2026-10" in out
        assert "Finance/Claims/2026-10: 2" in await TOOLS["list_folders"].handler(ctx, {})
        out = await TOOLS["compile_documents"].handler(
            ctx, {"title": "Claim October 2026", "file_ids": [one["id"], two["id"]]}
        )
        assert "Compiled 2 item(s)" in out, out
        made = (
            await db.execute(DocFile.__table__.select().where(DocFile.kind == "compiled"))
        ).first()
        assert made is not None and made.pages >= 3  # contents + one page each
    log = (await client.get("/api/audit")).json()
    moved = [e for e in log["items"] if e["action"] == "file.filed"]
    assert len(moved) == 2  # each move logged, with where it was


# ---------------------------------------------------------------- roles and skills


async def test_premade_roles_and_office_skills(client, llm, temporal):
    o = await office(client)
    bps = {b["name"]: b for b in (await client.get("/api/blueprints")).json()}
    assert {"Admin & filing clerk", "Finance clerk", "HR officer"} <= set(bps)
    assert bps["Finance clerk"]["skill_ids"]  # leans on the built-in office skills
    names = {s["name"] for s in (await client.get("/api/skills")).json()}
    assert {"write-business-letter", "file-documents", "compile-document-pack"} <= names
    # A twin's onboarding suggests the role for the person's department.
    staff = await as_role(
        client, "aina@example.com", "staff", branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )  # fmt: skip
    st = (await staff.get("/api/me/staff")).json()
    assert st["suggested_blueprint_id"] == bps["Finance clerk"]["id"]


async def test_import_an_open_agent_skill(client, llm, temporal):
    await office(client)
    md = (
        "---\nname: Polite Follow Up\ndescription: Write a short, polite follow-up message "
        "when someone has not replied.\n---\n# Polite follow up\n1. Read the thread.\n"
        "2. Remind them kindly.\n"
    )
    r = await client.post("/api/skills/import", json={"text": md}, headers=csrf(client))
    assert r.status_code == 201, r.text
    p = r.json()["proposal"]
    assert p["name"] == "polite-follow-up" and "Imported" in (p.get("reason") or "")
    assert r.json()["skill"] is None  # an outside skill is always reviewed first
    bad = await client.post(
        "/api/skills/import", json={"text": "just some text"}, headers=csrf(client)
    )
    assert bad.status_code == 422
