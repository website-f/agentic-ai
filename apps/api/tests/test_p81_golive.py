"""P81: start fresh for go-live (Settings > Data and privacy, `python -m agentic.golive`), the
bulk delete in the Library, Browse and SOPs, and importing the real staff after the reset.

Everything here is made up; the real staff list is never used in tests."""

import argparse
import io
import json

import httpx
from openpyxl import Workbook
from sqlalchemy import func, select

from agentic.api.main import app
from agentic.core.db import SessionLocal
from agentic.golive import __main__ as golive_cli
from agentic.knowledge import indexer
from agentic.models import (
    SOP,
    Agent,
    AuditLog,
    Branch,
    Department,
    DocFile,
    KnowledgeChunk,
    Membership,
    PrimaLink,
    User,
)
from agentic.search.models import SearchSource

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import PW, as_role, member

OWNER_PW = "correct-horse-battery"


async def _file(ws: str, branch_id: str | None, name: str, *, by: str, folder: str = "") -> str:
    async with SessionLocal() as db:
        f = DocFile(
            workspace_id=ws,
            branch_id=branch_id,
            name=name,
            mime="text/plain",
            status="ready",
            text=f"{name}: refunds are paid within seven days of the claim.",
            created_by=by,
            library=True,
            folder=folder,
        )
        db.add(f)
        await db.commit()
        await indexer.index_file(db, f.id)
        return f.id


async def _ws_id(c: httpx.AsyncClient) -> str:
    return (await c.get("/api/auth/me")).json()["workspace"]["id"]


async def sample_office(c: httpx.AsyncClient) -> dict:
    """A kept company (Maju), a sample one to remove with its departments, an agent, a file,
    SOPs and people in it, a second owner, an admin, and Prima links."""
    o = await office(c)
    ws = await _ws_id(c)
    owner_id = (await c.get("/api/auth/me")).json()["user"]["id"]
    sample = (
        await c.post("/api/branches", json={"name": "Sample Co (mock)"}, headers=csrf(c))
    ).json()
    sdepts = {d["name"]: d["id"] for d in sample["departments"]}
    kept_agent = await new_agent(c, o, "Kept Kamal")
    r = await c.post(
        "/api/agents",
        json={
            "branch_id": sample["id"],
            "department_id": sdepts["Finance"],
            "name": "Sample Sara",
            "role": "Finance agent",
        },
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    moved_agent = r.json()
    staff = await member(c, "staff1@example.com", "staff", branch_id=sample["id"])
    admin = await member(c, "admin1@example.com", "admin")
    owner2 = await member(c, "owner2@example.com", "owner")
    sops = {}
    for title, scope, sid in (
        ("Everyone SOP", "workspace", None),
        ("Sample company SOP", "branch", sample["id"]),
        ("Sample finance SOP", "department", sdepts["Finance"]),
        ("Maju SOP", "branch", o["branch"]["id"]),
    ):
        r = await c.post(
            "/api/sops",
            json={
                "title": title,
                "body": f"{title}: do it right.",
                "scope": scope,
                "scope_id": sid,
            },
            headers=csrf(c),
        )
        assert r.status_code == 201, r.text
        sops[title] = r.json()["id"]
    sample_file = await _file(
        ws, sample["id"], "sample-refunds.txt", by=f"user:{owner_id}", folder="HR"
    )
    maju_file = await _file(ws, o["branch"]["id"], "maju-refunds.txt", by=f"user:{owner_id}")
    async with SessionLocal() as db:
        for uid, rec in ((staff["member"]["user_id"], "prima-staff-1"), (owner_id, "u-owner")):
            db.add(
                PrimaLink(
                    workspace_id=ws, user_id=uid, prima_user_id=rec, how="owner", linked_by="test"
                )
            )
        # The staff member's own AI: retired (kept) when they leave.
        mine = await db.get(Agent, kept_agent["id"])
        assert mine is not None
        mine.owner_user_id = staff["member"]["user_id"]
        await db.commit()
    return {
        **o,
        "ws": ws,
        "owner_id": owner_id,
        "sample": sample,
        "sdepts": sdepts,
        "kept_agent": kept_agent,
        "moved_agent": moved_agent,
        "staff": staff,
        "admin": admin,
        "owner2": owner2,
        "sops": sops,
        "sample_file": sample_file,
        "maju_file": maju_file,
    }


def confirm(**extra) -> dict:
    return {"confirm_name": "Acme Group", "password": OWNER_PW, **extra}


# ---------------------------------------------------------------- the reset from Settings


async def test_overview_counts_and_reset_keeps_owners_and_moves_what_outlives_a_company(
    client, temporal
):
    s = await sample_office(client)
    staff_c = await as_role(client, "staff2@example.com", "staff", branch_id=s["sample"]["id"])
    r = await client.get("/api/workspace/data/golive")
    assert r.status_code == 200, r.text
    ov = r.json()
    assert ov["workspace"]["name"] == "Acme Group"
    assert ov["members"] == {"total": 5, "owners": 2, "to_remove": 3}
    by_name = {c["name"]: c for c in ov["companies"]}
    assert by_name["Sample Co (mock)"]["agents"] == 1
    assert by_name["Sample Co (mock)"]["files"] == 1
    assert by_name["Sample Co (mock)"]["departments"] == len(s["sdepts"]) > 0
    assert ov["sops"] == 4 and ov["files"] == 2
    assert ov["backup"]["last_success"] is None  # not mounted here: unknown, never invented
    assert "agentic-backup backup" in ov["backup"]["command"]
    assert "@" not in json.dumps(ov)  # counts only, no emails

    r = await client.post(
        "/api/workspace/data/golive",
        json=confirm(remove_branch_ids=[s["sample"]["id"]], move_to=s["branch"]["id"]),
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["members_removed"] == 3 and out["owners_kept"] == 2
    assert out["accounts_deactivated"] == 3
    assert out["companies_removed"] == 1 and out["companies_kept"] == 1
    assert out["departments_removed"] == len(s["sdepts"])
    assert out["agents_moved"] == 1 and out["personal_agents_retired"] == 1
    assert out["files_moved"] == 1 and out["sops_kept_as_library"] == 2
    assert out["prima_links_ended"] == 1

    # A removed person is signed out at once and cannot sign in again.
    assert (await staff_c.get("/api/auth/me")).status_code == 401
    await staff_c.aclose()
    r = await client.post("/api/auth/login", json={"email": "staff2@example.com", "password": PW})
    assert r.status_code in (401, 403)

    async with SessionLocal() as db:
        roles = dict(
            (
                await db.execute(
                    select(Membership.user_id, Membership.role).where(
                        Membership.workspace_id == s["ws"]
                    )
                )
            ).all()
        )
        assert set(roles.values()) == {"owner"} and len(roles) == 2
        assert s["owner_id"] in roles
        staff = await db.get(User, s["staff"]["member"]["user_id"])
        assert staff is not None and staff.is_active is False  # kept, not deleted
        assert await db.get(Branch, s["sample"]["id"]) is None
        assert not (
            await db.scalars(select(Department).where(Department.branch_id == s["sample"]["id"]))
        ).all()
        assert await db.get(Branch, s["branch"]["id"]) is not None
        # The agent moved home with its department cleared; the staff member's own AI retired.
        moved = await db.get(Agent, s["moved_agent"]["id"])
        assert moved is not None and moved.branch_id == s["branch"]["id"]
        assert moved.department_id is None and moved.status == "active"
        retired = await db.get(Agent, s["kept_agent"]["id"])
        assert retired is not None and retired.status == "retired"
        # SOPs: all kept; the removed company's became library SOPs attached to its agent.
        sops = {x.title: x for x in (await db.scalars(select(SOP))).all()}
        assert len(sops) == 4
        assert sops["Sample company SOP"].scope == "library"
        assert sops["Sample finance SOP"].scope == "library"
        assert sops["Maju SOP"].scope == "branch"
        assert set(moved.sop_ids) == {
            s["sops"]["Sample company SOP"],
            s["sops"]["Sample finance SOP"],
        }
        chunk_scopes = {
            b
            for (b,) in (
                await db.execute(
                    select(KnowledgeChunk.branch_id).where(
                        KnowledgeChunk.source_id == s["sops"]["Sample company SOP"]
                    )
                )
            ).all()
        }
        assert chunk_scopes == {None}
        # The file moved into a folder named after its old company; its passages followed.
        f = await db.get(DocFile, s["sample_file"])
        assert f is not None and f.branch_id == s["branch"]["id"]
        assert f.folder == "Sample Co (mock)/HR"
        fchunks = {
            b
            for (b,) in (
                await db.execute(
                    select(KnowledgeChunk.branch_id).where(
                        KnowledgeChunk.source_id == s["sample_file"]
                    )
                )
            ).all()
        }
        assert fchunks == {s["branch"]["id"]}
        # Prima: the removed person's link ended, the owner's stays.
        links = (await db.scalars(select(PrimaLink.user_id))).all()
        assert links == [s["owner_id"]]
        # Audited: the summary, each person and each company.
        actions = [
            a
            for (a,) in (
                await db.execute(select(AuditLog.action).where(AuditLog.workspace_id == s["ws"]))
            ).all()
        ]
        assert actions.count("workspace.golive_reset") == 1
        assert actions.count("member.removed") == 3
        assert "branch.deleted" in actions
        summary = await db.scalar(
            select(AuditLog).where(AuditLog.action == "workspace.golive_reset")
        )
        assert summary is not None and "backup" in (summary.note or "")
        assert summary.after and summary.after["members_removed"] == 3


async def test_the_wrong_confirmation_is_refused_and_nothing_changes(client, temporal):
    s = await sample_office(client)
    body = {"remove_branch_ids": [s["sample"]["id"]], "move_to": s["branch"]["id"]}
    r = await client.post(
        "/api/workspace/data/golive",
        json={**confirm(**body), "confirm_name": "Acme"},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "name_mismatch"
    r = await client.post(
        "/api/workspace/data/golive",
        json={**confirm(**body), "password": "wrong-password"},
        headers=csrf(client),
    )
    assert r.status_code == 403 and r.json()["code"] == "password_required"
    # Agents in a removed company need a home that is kept.
    r = await client.post(
        "/api/workspace/data/golive",
        json=confirm(remove_branch_ids=[s["sample"]["id"]]),
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "move_to_required"
    r = await client.post(
        "/api/workspace/data/golive",
        json=confirm(remove_branch_ids=[s["sample"]["id"]], move_to=s["sample"]["id"]),
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_move_to"
    async with SessionLocal() as db:
        n = await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.workspace_id == s["ws"])
        )
        assert n == 4
        assert await db.get(Branch, s["sample"]["id"]) is not None


async def test_only_an_owner_can_see_or_start_it(client, temporal):
    s = await sample_office(client)
    admin = await as_role(client, "admin2@example.com", "admin")
    try:
        assert (await admin.get("/api/workspace/data/golive")).status_code == 403
        r = await admin.post(
            "/api/workspace/data/golive",
            json={"confirm_name": "Acme Group", "password": PW, "remove_branch_ids": []},
            headers=csrf(admin),
        )
        assert r.status_code == 403 and r.json()["code"] == "owner_only"
    finally:
        await admin.aclose()
    async with SessionLocal() as db:
        assert await db.get(Branch, s["sample"]["id"]) is not None


async def test_members_only_reset_keeps_every_company(client, temporal):
    s = await sample_office(client)
    r = await client.post("/api/workspace/data/golive", json=confirm(), headers=csrf(client))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["members_removed"] == 2 and out["companies_removed"] == 0
    assert out["agents_moved"] == 0 and out["move_to"] is None
    async with SessionLocal() as db:
        assert await db.get(Branch, s["sample"]["id"]) is not None


# ---------------------------------------------------------------- the command


def _args(**kw) -> argparse.Namespace:
    base = {
        "dry_run": False,
        "yes": False,
        "keep_companies_from": None,
        "move_to": None,
        "workspace": None,
        "show_companies": False,
    }
    return argparse.Namespace(**{**base, **kw})


async def test_cli_dry_run_counts_without_changing_or_naming_anyone(
    client, temporal, tmp_path, capsys
):
    s = await sample_office(client)
    keep = tmp_path / "keep.json"
    keep.write_text(
        json.dumps([{"company": "MAJU SDN BHD", "name": "x", "email": "x@example.com"}]),
        encoding="utf-8",
    )
    assert await golive_cli.run(_args(dry_run=True, keep_companies_from=str(keep))) == 0
    printed = capsys.readouterr().out
    assert "Dry run" in printed and "members removed" in printed
    assert "@" not in printed and "Staff1" not in printed and "Sample Co" not in printed
    async with SessionLocal() as db:
        assert await db.get(Branch, s["sample"]["id"]) is not None
        n = await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.workspace_id == s["ws"])
        )
        assert n == 4
        assert not (
            await db.scalars(select(AuditLog).where(AuditLog.action == "workspace.golive_reset"))
        ).all()

    # The real run: the company the file names stays (Maju), the sample one goes, and what
    # it held moves to the kept company with the most AI workers.
    assert await golive_cli.run(_args(yes=True, keep_companies_from=str(keep))) == 0
    async with SessionLocal() as db:
        assert await db.get(Branch, s["sample"]["id"]) is None
        moved = await db.get(Agent, s["moved_agent"]["id"])
        assert moved is not None and moved.branch_id == s["branch"]["id"]
        actor = await db.scalar(
            select(AuditLog.actor).where(AuditLog.action == "workspace.golive_reset")
        )
        assert actor == "system:golive-cli"


async def test_cli_reads_the_company_column_of_a_members_sheet(tmp_path):
    p = tmp_path / "staff.xlsx"
    p.write_bytes(
        _xlsx(
            [
                ["Name", "Email", "Role", "Company", "Department", "Notes"],
                ["A Example", "a@example.com", "staff", "ALFA GUARD SDN BHD", "", ""],
                ["B Example", "b@example.com", "staff", "Alfa  Guard Sdn Bhd", "", ""],
                ["C Example", "c@example.com", "staff", "UNIT HR", "", ""],
            ]
        )
    )
    assert golive_cli.company_names(p) == ["ALFA GUARD SDN BHD", "UNIT HR"]
    remove, exact, close = golive_cli.plan_companies(
        {"b1": "Alfa Guard Sdn Bhd", "b2": "Group Company 01 (mock)", "b3": "Unit HR"},
        golive_cli.company_names(p),
    )
    assert remove == ["b2"] and exact == 2 and close == 0
    assert golive_cli.plan_companies({"b1": "X"}, None) == ([], 1, 0)


async def test_cli_move_to_makes_the_home_company_when_every_company_goes(
    client, temporal, tmp_path
):
    s = await sample_office(client)
    keep = tmp_path / "keep.json"
    keep.write_text(json.dumps({"companies": ["PW VENTURE SDN BHD"]}), encoding="utf-8")
    code = await golive_cli.run(
        _args(yes=True, keep_companies_from=str(keep), move_to="PW VENTURE SDN BHD")
    )
    assert code == 0
    async with SessionLocal() as db:
        names = (await db.scalars(select(Branch.name))).all()
        assert names == ["Pw Venture Sdn Bhd"]
        moved = await db.get(Agent, s["moved_agent"]["id"])
        home = await db.scalar(select(Branch.id))
        assert moved is not None and moved.branch_id == home


# ---------------------------------------------------------------- importing the real staff after


def _xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Members"
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_reset_then_import_the_staff_sheet_end_to_end(client, temporal):
    s = await sample_office(client)
    r = await client.post(
        "/api/workspace/data/golive",
        json=confirm(remove_branch_ids=[s["sample"]["id"]], move_to=s["branch"]["id"]),
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    # The office import's columns, with made-up people and companies. One of them was removed
    # by the reset (staff1): adding them back turns their account on again.
    sheet = _xlsx(
        [
            ["Name", "Email", "Role", "Company", "Department", "Notes"],
            ["Ali Example", "ali@example.com", "staff", "ALFA GUARD SDN BHD", "", "HQ"],
            [
                "Bala Example",
                "bala@example.com",
                "branch_manager",
                "ALFA GUARD SDN BHD",
                "Management",
                "",
            ],
            ["Chong Example", "chong@example.com", "staff", "UNIT HR", "", ""],
            ["Staff One", "staff1@example.com", "staff", "Maju Sdn Bhd", "", "back again"],
        ]
    )

    async def preview() -> dict:
        r = await client.post(
            "/api/members/import/preview",
            params={"name": "office-members-import.xlsx"},
            content=sheet,
            headers={**csrf(client), "content-type": "application/octet-stream"},
        )
        assert r.status_code == 200, r.text
        return r.json()

    p = await preview()
    assert p["can_add_companies"] is True
    assert sorted(p["missing_companies"]) == ["ALFA GUARD SDN BHD", "UNIT HR"]
    r = await client.post(
        "/api/members/import/companies",
        json={"names": p["missing_companies"]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert sorted(r.json()["created"]) == ["Alfa Guard Sdn Bhd", "Unit HR"]
    p = await preview()
    assert p["missing_companies"] == []
    assert p["counts"]["error"] == 0, p["rows"]
    rows = [
        {
            k: row[k]
            for k in (
                "row",
                "name",
                "email",
                "role",
                "branch_id",
                "department_id",
                "phone",
                "notes",
            )
        }
        for row in p["rows"]
    ]
    r = await client.post("/api/members/import", json={"rows": rows}, headers=csrf(client))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["added"] == 4 and out["skipped"] == 0
    back = next(x for x in out["results"] if x["email"] == "staff1@example.com")
    assert back["temp_password"] is None  # an existing account keeps its password
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "staff1@example.com"))
        assert u is not None and u.is_active is True
        n = await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.workspace_id == s["ws"])
        )
        assert n == 2 + 4


# ---------------------------------------------------------------- bulk delete


async def test_bulk_delete_files_and_sops_with_their_index(client, temporal):
    s = await sample_office(client)
    async with SessionLocal() as db:
        assert await db.scalar(
            select(func.count())
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.source_id.in_([s["sample_file"], s["maju_file"]]))
        )
    sop = s["sops"]["Maju SOP"]
    r = await client.post(
        "/api/library/delete",
        json={"files": [s["sample_file"], s["maju_file"], "fl_missing"], "sops": [sop]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["files"] == 2 and out["sops"] == 1
    assert out["skipped"] == [{"kind": "file", "id": "fl_missing", "reason": "not_found"}]
    async with SessionLocal() as db:
        ids = [s["sample_file"], s["maju_file"], sop]
        assert not (await db.scalars(select(DocFile.id).where(DocFile.id.in_(ids)))).all()
        assert await db.get(SOP, sop) is None
        n = await db.scalar(
            select(func.count())
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.source_id.in_(ids))
        )
        assert n == 0
        assert not (
            await db.scalars(select(SearchSource.source_id).where(SearchSource.source_id.in_(ids)))
        ).all()
        actions = (await db.scalars(select(AuditLog.action))).all()
        assert actions.count("file.deleted") == 2 and "sop.deleted" in actions
        assert "library.bulk_deleted" in actions


async def test_bulk_delete_checks_each_item_against_the_person(client, temporal):
    s = await sample_office(client)
    # A branch manager of Maju: Maju's files yes, the other company's no, SOPs no.
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=s["branch"]["id"])
    viewer = await as_role(client, "viewer@example.com", "viewer")
    try:
        r = await bm.post(
            "/api/library/delete",
            json={
                "files": [s["maju_file"], s["sample_file"]],
                "sops": [s["sops"]["Maju SOP"]],
            },
            headers=csrf(bm),
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["files"] == 1 and out["sops"] == 0
        assert {(x["id"], x["reason"]) for x in out["skipped"]} == {
            (s["sample_file"], "not_allowed"),
            (s["sops"]["Maju SOP"], "not_allowed"),
        }
        r = await viewer.post(
            "/api/library/delete", json={"files": [s["sample_file"]]}, headers=csrf(viewer)
        )
        assert r.status_code == 200
        assert r.json()["files"] == 0
        assert r.json()["skipped"][0]["reason"] == "not_allowed"
    finally:
        await bm.aclose()
        await viewer.aclose()
    async with SessionLocal() as db:
        assert await db.get(DocFile, s["maju_file"]) is None
        assert await db.get(DocFile, s["sample_file"]) is not None
        assert await db.scalar(
            select(func.count())
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.source_id == s["sample_file"])
        )


async def test_bulk_delete_caps_one_call():
    from agentic.api.routers.bulk_delete import MAX_ITEMS

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        from .conftest import setup_owner

        await setup_owner(c)
        r = await c.post(
            "/api/library/delete",
            json={"files": [f"fl_{i}" for i in range(MAX_ITEMS + 1)]},
            headers=csrf(c),
        )
        assert r.status_code == 422
