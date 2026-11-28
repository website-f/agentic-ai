"""P149c: organizing the Library: keywords at upload (saved per file, filtered and searched),
uploads sorted into folders by what they are and their date (Unit HR: "Payroll/2026/11"),
a person's placement never overridden, and the AI's organize tools (plan, then apply after
the person agreed; another unit refused)."""

import asyncio
import json
import os

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, update

from agentic.agents import dispatch
from agentic.agents.tools import TOOLS, ToolContext, mode_of
from agentic.core.db import SessionLocal
from agentic.intake import pipeline
from agentic.knowledge import organize
from agentic.models import Agent, DocFile, Workspace

from .conftest import PG, TEST_DB, csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_p143_library_units import group, jh

TEXT = {"x-file-type": "text/plain", "content-type": "application/octet-stream"}


@pytest.fixture
def no_sorting(monkeypatch):
    """Uploads wait unread (the worker is called by hand where it matters)."""

    async def start_intake(batch_id):
        return None

    monkeypatch.setattr(dispatch, "start_intake", start_intake)


async def send(c, branch_id, dept, name, body=b"", **params):
    q = {"name": name, "branch_id": branch_id, "department_id": dept, **params}
    r = await c.post(
        "/api/intake",
        params=q,
        content=body or b"Dokumen pejabat untuk unit ini.\n" * 20,
        headers={**csrf(c), **TEXT},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def files_of(branch_id: str) -> dict[str, DocFile]:
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DocFile).where(DocFile.branch_id == branch_id))).all()
    return {f.name: f for f in rows}


# ---------------------------------------------------------------- dates and proposals


@pytest.mark.parametrize(
    ("text", "want"),
    [
        ("Slip Gaji Nov 2026.pdf", (2026, 11)),
        ("payroll_2026-11.pdf", (2026, 11)),
        ("Laporan 15.11.2026.pdf", (2026, 11)),
        ("Laporan 15/11/26", (2026, 11)),
        ("Report 20261115", (2026, 11)),
        ("2026_03_02 minit", (2026, 3)),
        ("Cuti Disember 2026", (2026, 12)),
        ("Minit Mesyuarat 2026 Mac", (2026, 3)),
        ("Invois 3 Ogos 2026", (2026, 8)),
        ("15hb Januari 2027", (2027, 1)),
        ("Gaji Mei '26", (2026, 5)),
        ("NOV2026 payslip", (2026, 11)),
        ("Statement October 2026", (2026, 10)),
        ("Penyata Okt 2026", (2026, 10)),
        ("Claims 11/2026", (2026, 11)),
        ("Slip-Gaji-11-2026", (2026, 11)),
        ("SOP Kawalan 2025", (2025, None)),
        ("tender v1.2.3", None),
        ("no date here", None),
    ],
)
def test_dates_in_names(text, want):
    d = organize.find_date(text)
    assert (None if d is None else (d.year, d.month)) == want


def test_proposals_follow_categories_keywords_and_existing_folders():
    hr = organize.Rules(unit="hr")

    def folder(name, keywords=(), rules=hr, existing=()):
        facts = organize.FileFacts(name=name, keywords=list(keywords))
        return organize.propose(facts, rules, organize.existing_tree(list(existing))).folder

    assert folder("Slip Gaji Nov 2026.pdf") == "Payroll/2026/11"
    assert folder("Surat cuti Ali 2026-03-02.pdf") == "Leave/2026/03"  # HR: leave beats letter
    assert folder("Invois 3 Ogos 2026.pdf") == "Invoices/2026/08"
    assert folder("Minit mesyuarat.docx") == "Minutes"
    assert folder("scan001.pdf", ["payroll", "nov 2026"]) == "Payroll/2026/11"
    assert folder("scan002.pdf", ["projek x"]) == "Projek x"
    assert folder("random.pdf") is None
    # The folder people already keep payslips in is followed ("GAJI"), so is its year.
    assert folder("Slip Gaji Nov 2026.pdf", existing=["GAJI/2026"]) == "GAJI/2026/11"
    year_only = organize.Rules(unit="hr", dates="year", folders={"payroll": "Gaji"})
    assert folder("Slip Gaji Nov 2026.pdf", rules=year_only) == "Gaji/2026"
    assert organize.clean_keywords(" Payroll, Nov  2026 ;HR,payroll, #Urgent") == [
        "payroll",
        "nov 2026",
        "hr",
        "urgent",
    ]


# ---------------------------------------------------------------- keywords


async def test_keywords_saved_for_the_batch_filtered_and_searched(client, no_sorting):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]
    b = await send(client, pw, hr, "Slip A.txt", keywords="Payroll, NOV 2026")
    await send(client, pw, hr, "Slip B.txt", keywords="Payroll, NOV 2026", batch=b["id"])
    await send(client, pw, hr, "Lain.txt")
    got = await files_of(pw)
    assert got["Slip A.txt"].keywords == got["Slip B.txt"].keywords == ["payroll", "nov 2026"]
    assert got["Lain.txt"].keywords == []

    base = {"branch_id": pw, "department_id": hr}
    r = await client.get("/api/files", params={**base, "keyword": "payroll"})
    assert sorted(f["name"] for f in r.json()) == ["Slip A.txt", "Slip B.txt"]
    assert r.json()[0]["keywords"] == ["payroll", "nov 2026"]
    r = await client.get(
        "/api/files", params=[*base.items(), ("keyword", "Payroll"), ("keyword", "x")]
    )
    assert r.json() == []
    r = await client.get("/api/files", params={"branch_id": pw, "q": "nov 2026"})
    assert sorted(f["name"] for f in r.json()) == ["Slip A.txt", "Slip B.txt"]
    counts = (await client.get("/api/files/keywords", params=base)).json()
    assert counts == [{"keyword": "nov 2026", "count": 2}, {"keyword": "payroll", "count": 2}]

    # Editable later: in bulk and per file.
    a, bb = got["Slip A.txt"].id, got["Slip B.txt"].id
    r = await client.post(
        "/api/files/keywords",
        json={"ids": [a, bb], "add": ["Urgent"], "remove": ["payroll"]},
        headers=jh(client),
    )
    assert r.status_code == 200 and r.json()["updated"] == 2
    r = await client.patch(
        f"/api/files/{a}", json={"keywords": ["Gaji", "gaji", " Q4 "]}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["keywords"] == ["gaji", "q4"]
    assert (await files_of(pw))["Slip B.txt"].keywords == ["nov 2026", "urgent"]

    # Staff of another department cannot change the unit's files' keywords.
    ops = await as_role(
        client, "ops@example.com", "staff", branch_id=pw, department_id=o["pw_depts"]["Operations"]
    )
    r = await ops.post("/api/files/keywords", json={"ids": [a], "add": ["x"]}, headers=jh(ops))
    assert r.status_code == 404


# ---------------------------------------------------------------- sorting on upload


async def test_uploads_into_unit_hr_are_sorted_into_folders(client):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]

    # The dialog's preview: from the names and the keywords, before anything is sent.
    r = await client.post(
        "/api/library/organize/preview",
        json={
            "branch_id": pw,
            "department_id": hr,
            "names": [
                "Slip Gaji Nov 2026.pdf",
                "Surat cuti 15.11.2026.pdf",
                "scan.pdf",
                "Lama/x.pdf",
            ],
        },
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["auto"] is True  # on by default in a unit
    assert [(i["name"], i["folder"], i["sorted"]) for i in p["items"]] == [
        ("Slip Gaji Nov 2026.pdf", "Payroll/2026/11", True),
        ("Surat cuti 15.11.2026.pdf", "Leave/2026/11", True),
        ("scan.pdf", "", False),
        ("Lama/x.pdf", "Lama", False),
    ]
    r = await client.post(
        "/api/library/organize/preview",
        json={
            "branch_id": pw,
            "department_id": hr,
            "names": ["scan.pdf"],
            "keywords": ["Gaji, Dis 2026"],
        },
        headers=jh(client),
    )
    assert r.json()["items"][0]["folder"] == "Payroll/2026/12"
    assert r.json()["keywords"] == ["gaji", "dis 2026"]

    # The uploads, read inline: by name, by content, by keyword; the rest stay at the top.
    b = await send(client, pw, hr, "Slip Gaji Nov 2026.txt", auto_sort="true")
    await send(
        client,
        pw,
        hr,
        "scan001.txt",
        b"SLIP GAJI PEKERJA\nBulan: Disember 2026\nNama: Ali\n" * 5,
        auto_sort="true",
        batch=b["id"],
    )
    await send(client, pw, hr, "scan002.txt", auto_sort="true", keywords="Projek X")
    await send(client, pw, hr, "nota.txt", auto_sort="true")
    await send(client, pw, hr, "Lama/Slip Gaji Okt 2026.txt", auto_sort="true")  # its own folder
    await send(client, pw, hr, "Minit Nov 2026.txt", auto_sort="true", folder="Mesyuarat")
    await send(client, pw, hr, "Invois Nov 2026.txt")  # not asked to sort
    got = await files_of(pw)
    assert {n: (f.folder, f.folder_by) for n, f in got.items()} == {
        "Slip Gaji Nov 2026.txt": ("Payroll/2026/11", "auto"),
        "scan001.txt": ("Payroll/2026/12", "auto"),
        "scan002.txt": ("Projek x", "auto"),
        "nota.txt": ("", ""),
        "Slip Gaji Okt 2026.txt": ("Lama", ""),
        "Minit Nov 2026.txt": ("Mesyuarat", ""),
        "Invois Nov 2026.txt": ("", ""),
    }
    assert all(f.department_id == hr and f.status == "ready" for f in got.values())
    tree = (
        await client.get("/api/files/tree", params={"branch_id": pw, "department_id": hr})
    ).json()
    assert "Payroll/2026/11" in [f["path"] for f in tree["folders"]]

    # Document search finds a file by its keywords.
    r = await client.get("/api/search", params={"q": "projek x"})
    assert r.status_code == 200, r.text
    assert "scan002.txt" in [h["title"] for h in r.json()["hits"]] or any(
        h["id"] == got["scan002.txt"].id for h in r.json()["hits"]
    )


async def test_a_file_a_person_placed_is_never_moved(client, no_sorting):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]
    b = await send(client, pw, hr, "Slip Gaji Nov 2026.txt", auto_sort="true")
    await send(client, pw, hr, "Slip Gaji Dis 2026.txt", auto_sort="true", batch=b["id"])
    got = await files_of(pw)
    assert {f.folder_by for f in got.values()} == {"sort"}
    # While it waits to be read, a person files one of them.
    nov = got["Slip Gaji Nov 2026.txt"].id
    r = await client.post(
        "/api/files/move", json={"ids": [nov], "folder": "Simpan"}, headers=jh(client)
    )
    assert r.status_code == 200
    assert await pipeline.run_inline(b["id"]) == "ready"
    got = await files_of(pw)
    assert (got["Slip Gaji Nov 2026.txt"].folder, got["Slip Gaji Nov 2026.txt"].folder_by) == (
        "Simpan",
        "person",
    )
    assert got["Slip Gaji Dis 2026.txt"].folder == "Payroll/2026/12"


# ---------------------------------------------------------------- the rules


async def test_unit_rules_are_editable_by_its_people_only(client):
    o = await group(client)
    pw, hr = o["pw"]["id"], o["hr"]
    r = await client.get("/api/library/organize/rules", params={"department_id": hr})
    assert r.status_code == 200 and r.json()["unit"] == "hr" and r.json()["auto"] is True
    assert r.json()["folders"]["payroll"] == "Payroll"
    r = await client.put(
        "/api/library/organize/rules",
        json={"department_id": hr, "folders": {"payroll": "Gaji / Slip"}, "dates": "year"},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["folders"]["payroll"] == "Gaji Slip" and r.json()["dates"] == "year"
    r = await client.post(
        "/api/library/organize/preview",
        json={"department_id": hr, "names": ["Slip Gaji Nov 2026.pdf"]},
        headers=jh(client),
    )
    assert r.json()["items"][0]["folder"] == "Gaji Slip/2026"
    r = await client.put(
        "/api/library/organize/rules",
        json={"department_id": hr, "folders": {"nope": "X"}},
        headers=jh(client),
    )
    assert r.status_code == 422
    ops = await as_role(
        client, "ops@example.com", "staff", branch_id=pw, department_id=o["pw_depts"]["Operations"]
    )
    r = await ops.put(
        "/api/library/organize/rules", json={"department_id": hr, "dates": "off"}, headers=jh(ops)
    )
    assert r.status_code == 403
    # A company (no unit): sorting starts off.
    r = await client.get("/api/library/organize/rules", params={"branch_id": o["branch"]["id"]})
    assert r.json()["auto"] is False and r.json()["unit"] is None


# ---------------------------------------------------------------- the AI's tools


async def run_tool(agent_id: str, tool_name: str, /, **args) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        ws = await db.get(Workspace, agent.workspace_id)
        return await TOOLS[tool_name].handler(ToolContext(db, agent, ws, None), args)


async def test_organize_tools_plan_then_apply_inside_their_unit_only(client):
    o = await group(client)
    pw, hr, audit = o["pw"]["id"], o["hr"], o["audit"]
    r = await client.post(
        "/api/agents",
        json={"branch_id": pw, "department_id": hr, "name": "Hana", "role": "HR clerk"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    hana = r.json()["id"]
    b = await send(client, pw, hr, "Slip Gaji Nov 2026.txt")
    await send(client, pw, hr, "Surat cuti 2026-03-02.txt", batch=b["id"])
    await send(client, pw, hr, "nota.txt", batch=b["id"])
    await send(client, pw, hr, "Polisi cuti.txt", batch=b["id"])
    await send(client, pw, audit, "Laporan Audit 2026.txt")
    got = await files_of(pw)
    # A person put the policy at the top on purpose.
    policy = got["Polisi cuti.txt"].id
    await client.post("/api/files/move", json={"ids": [policy], "folder": ""}, headers=jh(client))

    tree = await run_tool(hana, "list_folder_tree", unit="hr")
    assert "4 loose file(s)" in tree, tree
    assert (await run_tool(hana, "list_folder_tree", unit="audit")).startswith("Error:")
    assert (await run_tool(hana, "suggest_organization", unit="Unit Audit")).startswith("Error:")

    plan = await run_tool(hana, "suggest_organization", unit="hr")
    assert "Payroll/2026/11" in plan and "Leave/2026/03" in plan, plan
    assert "placed by a person" in plan and "nothing to go by" in plan
    moves = json.loads(plan.strip().splitlines()[-1])
    assert {m["folder"] for m in moves} == {"Payroll/2026/11", "Leave/2026/03"}

    out = await run_tool(hana, "apply_organization", moves=moves, confirmed=False)
    assert out.startswith("Error:") and (await files_of(pw))["Slip Gaji Nov 2026.txt"].folder == ""
    # A move smuggled into the plan for the policy a person placed is skipped.
    out = await run_tool(
        hana,
        "apply_organization",
        moves=[*moves, {"file_id": policy, "folder": "Policies"}],
        confirmed=True,
    )
    assert "moved 2 file(s)" in out, out
    got = await files_of(pw)
    assert (got["Slip Gaji Nov 2026.txt"].folder, got["Slip Gaji Nov 2026.txt"].folder_by) == (
        "Payroll/2026/11",
        "agent",
    )
    assert got["Polisi cuti.txt"].folder == ""
    assert "already in order" in await run_tool(hana, "suggest_organization", unit="hr") or (
        "Nothing to move" in await run_tool(hana, "suggest_organization", unit="hr")
    )

    # Another unit's file: not moved, not tagged, not renamed.
    rep = got["Laporan Audit 2026.txt"].id
    out = await run_tool(hana, "move_files", file_ids=[rep], folder="Mine")
    assert "left alone" in out and (await files_of(pw))["Laporan Audit 2026.txt"].folder == ""
    out = await run_tool(hana, "tag_files", file_ids=[rep, got["nota.txt"].id], add=["Penting"])
    assert "Keywords changed on 1 file(s)" in out
    assert (await files_of(pw))["nota.txt"].keywords == ["penting"]
    assert (await run_tool(hana, "rename_file", file_id=rep, name="X")).startswith("Error:")
    out = await run_tool(hana, "rename_file", file_id=got["nota.txt"].id, name="Nota HR")
    assert "Nota HR.txt" in out
    assert "Made the folder" in await run_tool(hana, "create_folder", unit="hr", path="Arkib/2025")
    assert "already exists" in await run_tool(hana, "create_folder", unit="hr", path="arkib/2025")
    assert (await run_tool(hana, "create_folder", unit="audit", path="X")).startswith("Error:")

    # A personal AI follows its owner: an HR staff member's AI organizes Unit HR, not Audit.
    staff = await as_role(client, "hr1@example.com", "staff", branch_id=pw, department_id=hr)
    me = (await staff.get("/api/auth/me")).json()
    uid = me.get("user", me).get("id")
    r = await client.post(
        "/api/agents",
        json={"branch_id": pw, "name": "Aina AI", "role": "Personal assistant"},
        headers=csrf(client),
    )
    own = r.json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Agent).where(Agent.id == own).values(owner_user_id=uid))
        await db.commit()
    assert "loose file(s)" in await run_tool(own, "list_folder_tree", unit="hr")
    assert (await run_tool(own, "list_folder_tree", unit="audit")).startswith("Error:")
    assert (await run_tool(own, "suggest_organization")).startswith("Error:")  # the company

    # Asking before changing documents covers applying a plan (and filing covers moves).
    assert mode_of({"revise_document": "ask"}, "apply_organization") == "ask"
    assert mode_of({"file_document": "deny"}, "move_files") == "deny"
    assert mode_of({}, "suggest_organization") == "allow"


async def test_the_organize_skill_is_built_in(client):
    await office(client)
    skills = {s["name"]: s for s in (await client.get("/api/skills")).json()}
    assert "organize-library" in skills
    from agentic.skills.office_pack import OFFICE_SKILLS

    body = next(b for n, _, b in OFFICE_SKILLS if n == "organize-library")
    for tool in ("list_folder_tree", "suggest_organization", "apply_organization", "tag_files"):
        assert tool in body and tool in TOOLS


# ---------------------------------------------------------------- the migration


def _alembic(url: str, action: str, rev: str) -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["database_url"] = url
    getattr(command, action)(cfg, rev)


async def test_the_migration_goes_up_down_and_up():
    name = f"{TEST_DB}_p149mig"
    admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {name}")
    finally:
        await admin.close()
    url = f"postgresql+asyncpg://{PG}/{name}"
    cols = (
        "SELECT count(*) FROM information_schema.columns WHERE table_name = 'files' "
        "AND column_name IN ('keywords', 'folder_by')"
    )
    index = "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_files_keywords'"
    try:
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert await conn.fetchval(cols) == 2
            assert "gin" in (await conn.fetchval(index)).lower()
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "downgrade", "0087")
        conn = await asyncpg.connect(f"postgresql://{PG}/{name}")
        try:
            assert await conn.fetchval(cols) == 0
            assert await conn.fetchval(index) is None
        finally:
            await conn.close()
        await asyncio.to_thread(_alembic, url, "upgrade", "head")
    finally:
        admin = await asyncpg.connect(f"postgresql://{PG}/postgres")
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        finally:
            await admin.close()
