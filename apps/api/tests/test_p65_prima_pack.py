"""P65: the Prima Secure knowledge pack: Prima's SOPs, workflows W1-W34, rules, record forms
and IT guides become Library SOPs agents find, follow and cite. Re-runs never duplicate."""

from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from agentic.agents.prompt import system_prompt
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.knowledge import prima_pack
from agentic.knowledge import search as library
from agentic.models import SOP, Agent, AuditLog, KnowledgeChunk, Workspace
from agentic.teams.colleague import find_sops

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role

PRIMA = Path(__file__).resolve().parents[2] / "prima"  # the repo's apps/prima
HAVE_PRIMA = (PRIMA / "docs" / "system" / "04-workflows.md").is_file()

WORKFLOWS = """# 4. Workflows

Each workflow below lists who does each step and where. Screen names are the menu labels in
the app. Steps marked candidate exist only in the combined candidate.

## People

### W12. Monthly staff payroll
1. HR prepares each employer's month on **Staff payroll** and submits it to the Chief of Staff.
2. The **Chief of Staff approves**, then the **COO approves**.
3. **Finance pays** through the bank's payroll service.

### W14. Staff claim *(candidate)*
1. Staff submit a claim with receipts.
2. The head of department approves; Finance pays.
"""

CATALOG = (
    "export type GuideFlow={id:string;title:string};\n"
    "export const workflows:GuideFlow[]=[\n"
    " {id:'help_requests',title:'Help requests',tab:'tickets',"
    "steps:['Record the real problem.','Resolve with evidence; the requester confirms.'],"
    "inputs:'Requester and issue.',checker:'IT Manager.',"
    "approver:'Actual requester confirms; the resolver can\\'t self-confirm.',overseer:'COO.'},\n"
    " {id:'power',title:'Power BI references',tab:null,steps:['Record the report.'],"
    "inputs:'Owner.',checker:'IT Manager.',approver:'Separate.',overseer:'None.',"
    "setup:'Deferred.'},\n"
    "];\n"
    "export function other(){return 1}\n"
)


@pytest.fixture(autouse=True)
async def wipe_chunks():
    # knowledge_chunks has no foreign keys, so the shared TRUNCATE ... CASCADE skips it.
    async with SessionLocal() as db:
        await db.execute(text("TRUNCATE knowledge_chunks RESTART IDENTITY"))
        await db.commit()


@pytest.fixture
def pack_dir(tmp_path, monkeypatch) -> Path:
    """A small synthetic pack folder laid out like apps/prima."""
    (tmp_path / "docs" / "system" / "screens").mkdir(parents=True)
    (tmp_path / "apps" / "web" / "src" / "it-guide").mkdir(parents=True)
    (tmp_path / "docs" / "system" / "04-workflows.md").write_text(WORKFLOWS, encoding="utf-8")
    (tmp_path / "docs" / "system" / "screens" / "finance.md").write_text(
        "# Screens: finance\n\nThe Finance screen lists payments to approve.\n", encoding="utf-8"
    )
    (tmp_path / "apps" / "web" / "src" / "it-guide" / "catalog.ts").write_text(
        CATALOG, encoding="utf-8"
    )
    monkeypatch.setattr(settings, "prima_pack_dir", str(tmp_path))
    return tmp_path


async def workspace_id() -> str:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        assert ws is not None
        return ws


async def pack_sops(ws: str) -> dict[str, SOP]:
    async with SessionLocal() as db:
        rows = (
            await db.scalars(select(SOP).where(SOP.workspace_id == ws, SOP.pack_key.is_not(None)))
        ).all()
        return {s.pack_key or "": s for s in rows}


async def sync(ws: str, **kw) -> prima_pack.SyncResult:
    pack = prima_pack.load_pack()
    assert pack is not None
    async with SessionLocal() as db:
        return await prima_pack.sync_workspace(db, ws, pack, **kw)


async def audits(ws: str) -> int:
    async with SessionLocal() as db:
        return (
            await db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.workspace_id == ws, AuditLog.action == "knowledge_pack.synced")
            )
        ) or 0


# ================================================================ reading the real pack


def test_the_bundled_pack_splits_workflows_rules_forms_and_it_guides():
    if not HAVE_PRIMA:
        pytest.skip("apps/prima is not in this checkout")
    root = PRIMA
    pack = prima_pack.load_pack(root)
    assert pack is not None
    keys = {d.key for d in pack.docs}
    titles = {d.title for d in pack.docs}
    assert len(keys) == len(pack.docs)  # one key per section
    for n in range(1, 35):  # every workflow W1-W34 is its own SOP
        assert f"prima:docs/system/04-workflows.md#w{n}" in keys
    assert "Prima · W12 Monthly staff payroll (PAY-1)" in titles
    assert "Prima · Rule register · Payroll (PAY)" in titles
    assert "Prima · Record form · Office staff member (officeStaff)" in titles
    assert "Prima · Business rules · 3.2 Approval chains (who approves what)" in titles
    assert "Prima · Workflow boundaries" in titles
    assert sum(1 for k in keys if k.startswith("prima:apps/web/src/it-guide/catalog.ts#")) == 19
    assert sum(1 for k in keys if k.startswith("prima:docs/system/screens/")) == 10
    assert all(len(d.title) <= 160 and len(d.body) <= 40_000 for d in pack.docs)
    payroll = next(d for d in pack.docs if d.key.endswith("#w12"))
    assert payroll.body.startswith("Prima Secure · Workflow W12 Monthly staff payroll (PAY-1) (People)")
    assert "Chief of Staff (or Deputy) approves" in payroll.body
    rules = next(d for d in pack.docs if d.title == "Prima · Rule register · Payroll (PAY)")
    assert "Unverified (a working assumption" in rules.body


def test_it_guide_catalog_is_read_from_the_typescript():
    guides = prima_pack.parse_it_guides(CATALOG)
    assert [g["id"] for g in guides] == ["help_requests", "power"]
    assert guides[0]["steps"][1] == "Resolve with evidence; the requester confirms."
    assert "can't self-confirm" in guides[0]["approver"]
    assert guides[1]["tab"] is None and guides[1]["setup"] == "Deferred."
    text_ = prima_pack.render_it_guide(guides[0])
    assert "## Who approves" in text_ and "1. Record the real problem." in text_


def test_no_pack_folder_means_nothing_to_import(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "prima_pack_dir", str(tmp_path / "missing"))
    assert prima_pack.load_pack() is None


def test_a_section_too_long_for_one_sop_is_cut_into_parts(monkeypatch):
    monkeypatch.setattr(prima_pack, "BODY_MAX", 1000)
    text_ = "\n\n".join(f"Paragraph {i}. " + "Words of the rule. " * 10 for i in range(20))
    docs = prima_pack._docs("prima:x.md#a", "Prima · Big rule", "Big rule", "x.md", text_)
    assert len(docs) > 1
    assert [d.key for d in docs[:2]] == ["prima:x.md#a~1", "prima:x.md#a~2"]
    assert docs[1].title == "Prima · Big rule · part 2"
    assert all(len(d.body) < 1200 for d in docs)
    assert "Paragraph 19." in docs[-1].body


# ================================================================ the Library side


async def test_import_once_rerun_is_a_noop_and_changes_update(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    pack_dir,
):
    await office(client)
    ws = await workspace_id()

    first = await sync(ws)
    assert first.created == 6  # intro, W12, W14, the finance screen, two IT guides
    sops = await pack_sops(ws)
    w12 = sops["prima:docs/system/04-workflows.md#w12"]
    assert w12.title == "Prima · W12 Monthly staff payroll"
    assert w12.scope == "library" and w12.status == "active" and w12.version == 1
    assert "prima:apps/web/src/it-guide/catalog.ts#help-requests" in sops
    assert first.indexed == 6
    assert await audits(ws) == 1

    again = await sync(ws)
    assert (again.created, again.updated, again.unchanged, again.indexed) == (0, 0, 6, 0)
    assert len(await pack_sops(ws)) == 6  # never duplicated
    assert await audits(ws) == 1  # nothing changed, nothing recorded

    # A changed source updates just that section and rebuilds its passages.
    (pack_dir / "docs" / "system" / "04-workflows.md").write_text(
        WORKFLOWS.replace("bank's payroll service", "bank's payroll service by the 7th"),
        encoding="utf-8",
    )
    changed = await sync(ws)
    assert (changed.updated, changed.unchanged) == (1, 5)
    w12 = (await pack_sops(ws))["prima:docs/system/04-workflows.md#w12"]
    assert w12.version == 2 and "by the 7th" in w12.body
    async with SessionLocal() as db:
        chunk = await db.scalar(
            select(KnowledgeChunk.text).where(KnowledgeChunk.source_id == w12.id).limit(1)
        )
    assert chunk is not None and "by the 7th" in chunk

    # A person's edit in the app is kept; an owner's forced run takes the pack's text back.
    r = await client.patch(
        f"/api/sops/{w12.id}", json={"body": "Our own payroll steps."}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert r.json()["pack"] == "prima"
    (pack_dir / "docs" / "system" / "04-workflows.md").write_text(WORKFLOWS, encoding="utf-8")
    kept = await sync(ws)
    assert kept.kept == 1 and kept.updated == 0
    assert (await pack_sops(ws))[w12.pack_key or ""].body == "Our own payroll steps."
    forced = await sync(ws, force=True)
    assert forced.updated == 1
    assert "Chief of Staff approves" in (await pack_sops(ws))[w12.pack_key or ""].body

    # A section gone from its file is removed; a missing file removes nothing.
    (pack_dir / "docs" / "system" / "04-workflows.md").write_text(
        WORKFLOWS.split("### W14")[0], encoding="utf-8"
    )
    (pack_dir / "docs" / "system" / "screens" / "finance.md").unlink()
    gone = await sync(ws)
    assert gone.removed == 1
    sops = await pack_sops(ws)
    assert "prima:docs/system/04-workflows.md#w14" not in sops
    assert "prima:docs/system/screens/finance.md" in sops


async def test_unpublished_section_stays_unpublished(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    pack_dir,
):
    await office(client)
    ws = await workspace_id()
    await sync(ws)
    sop = (await pack_sops(ws))["prima:docs/system/04-workflows.md#w14"]
    r = await client.patch(f"/api/sops/{sop.id}", json={"status": "draft"}, headers=csrf(client))
    assert r.status_code == 200, r.text
    (pack_dir / "docs" / "system" / "04-workflows.md").write_text(
        WORKFLOWS.replace("with receipts", "with original receipts"), encoding="utf-8"
    )
    out = await sync(ws)
    assert out.updated == 1
    sop = (await pack_sops(ws))[sop.pack_key or ""]
    assert sop.status == "draft" and "original receipts" in sop.body


async def test_agents_find_the_payroll_workflow_and_are_told_to_follow_it(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
):
    if not HAVE_PRIMA:
        pytest.skip("apps/prima is not in this checkout")
    root = PRIMA
    o = await office(client)
    a = await new_agent(client, o, "Hana", "Finance")
    ws = await workspace_id()

    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent is not None
        before = await system_prompt(db, agent, "task")
    assert "Prima Secure pack" not in before  # only where the pack is imported

    pack = prima_pack.load_pack(root)
    assert pack is not None
    async with SessionLocal() as db:
        out = await prima_pack.sync_workspace(db, ws, pack)
    assert out.created == len(pack.docs) and out.indexed == len(pack.docs)

    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent is not None
        hits = await library.search(db, library.for_agent(agent), "monthly staff payroll")
        # Among the first few: the test search (hash embeddings, keyword stats from whatever
        # earlier tests indexed) can tie it with the screens guide that names payroll too.
        assert "Prima · W12 Monthly staff payroll (PAY-1)" in [h.title for h in hits[:3]]
        found = await find_sops(db, agent, "monthly staff payroll approval")
        assert "Prima · W12 Monthly staff payroll (PAY-1)" in found
        prompt = await system_prompt(db, agent, "task")
    assert "## Company procedures" in prompt
    assert "Prima Secure pack" in prompt and "find_sop or search_library" in prompt
    assert "Never decide or approve pay, deductions, discipline, contracts" in prompt
    assert "Outlook" in prompt
    # Sections are looked up, not pushed whole into the prompt.
    assert "Chief of Staff (or Deputy) approves" not in prompt


async def test_owner_endpoint_runs_it_audited_and_others_cannot(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    pack_dir,
):
    await office(client)
    ws = await workspace_id()
    r = await client.post("/api/library/packs/prima", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pack"] == "prima" and body["sections"] == 6
    assert body["created"] == 6 and body["indexing"] == 6
    r = await client.post("/api/library/packs/prima", json={}, headers=csrf(client))
    assert r.json()["unchanged"] == 6 and r.json()["created"] == 0
    assert await audits(ws) == 2  # an owner's run is always recorded
    lib = (await client.get("/api/library")).json()
    titles = {s["title"] for s in lib["sources"] if s["kind"] == "sop"}
    assert "Prima · W12 Monthly staff payroll" in titles

    admin = await as_role(client, "admin1@example.com", "admin")
    r = await admin.post("/api/library/packs/prima", json={}, headers=csrf(admin))
    assert r.status_code == 403

    settings_dir = settings.prima_pack_dir
    try:
        settings.prima_pack_dir = str(pack_dir / "nowhere")
        r = await client.post("/api/library/packs/prima", json={}, headers=csrf(client))
        assert r.status_code == 404
        assert r.json()["code"] == "pack_not_found"
    finally:
        settings.prima_pack_dir = settings_dir


async def test_sync_all_covers_every_workspace_and_can_be_turned_off(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    pack_dir,
    monkeypatch,
):
    await office(client)
    ws = await workspace_id()
    monkeypatch.setattr(settings, "prima_pack", False)
    assert await prima_pack.sync_all() == {}
    assert await pack_sops(ws) == {}
    monkeypatch.setattr(settings, "prima_pack", True)
    out = await prima_pack.sync_all()
    assert out["workspaces"] == 1 and out["created"] == 6
    assert (await prima_pack.sync_all())["created"] == 0
