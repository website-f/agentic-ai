"""P82: the Members table (one page at a time, search, filters, sort, bulk changes) and the
server's members import command (python -m agentic.members_import)."""

import csv
import io
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select

from agentic import members_import
from agentic.core.db import SessionLocal
from agentic.core.security import hash_password
from agentic.i18n import use_lang
from agentic.models import AuditLog, Branch, Department, Membership, User, Workspace

from .conftest import csrf
from .test_agents import office
from .test_office_roles import member, signed_in

HASH = hash_password("not-used-in-these-tests")


async def _ws() -> Workspace:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace).order_by(Workspace.created_at))).first()


async def _people(n: int, branch_id: str | None, **extra) -> list[str]:
    """n members made straight in the database (the API hashes a password per person)."""
    ws = await _ws()
    ids = []
    async with SessionLocal() as db:
        for i in range(n):
            u = User(
                email=f"person{i:03d}@example.com",
                name=f"Person {i:03d}",
                password_hash=HASH,
                must_change_password=i % 3 == 0,
                is_active=i % 10 != 9,
            )
            db.add(u)
            await db.flush()
            db.add(
                Membership(
                    workspace_id=ws.id,
                    user_id=u.id,
                    role=extra.get("role", "staff"),
                    branch_id=branch_id,
                    ms_oid=f"0a0a0a0a-0000-4000-8000-{i:012d}" if i % 2 else None,
                )
            )
            ids.append(u.id)
        await db.commit()
    return ids


async def _page(c, **params) -> dict:
    r = await c.get("/api/members", params={"page": 1, "page_size": 25, **params})
    assert r.status_code == 200, r.text
    return r.json()


async def test_members_come_one_page_at_a_time(client):
    o = await office(client)
    bid = o["branch"]["id"]
    await _people(60, bid)

    # The old shape for everyone else (people pickers): a plain list of everyone.
    plain = (await client.get("/api/members")).json()
    assert isinstance(plain, list) and len(plain) == 61
    assert sum(1 for m in plain if m["microsoft"]) == 30

    first = await _page(client)
    assert first["total"] == 61 and first["page"] == 1 and len(first["items"]) == 25
    second = await _page(client, page=2)
    third = await _page(client, page=3)
    assert len(second["items"]) == 25 and len(third["items"]) == 11
    seen = [m["user_id"] for p in (first, second, third) for m in p["items"]]
    assert len(set(seen)) == 61  # no one twice, no one missed
    names = [m["name"] for p in (first, second, third) for m in p["items"]]
    assert names == sorted(names, key=str.lower)
    s = first["summary"]
    assert s["members"] == 61 and s["owners_admins"] == 1 and s["microsoft"] == 30
    assert s["temp_password"] == 20 and s["roles"] == {"owner": 1, "staff": 60}
    assert len((await _page(client, page_size=100))["items"]) == 61
    r = await client.get("/api/members", params={"page": 1, "page_size": 10})
    assert r.status_code == 422

    # Search by name or email (any part, any case); % and _ are plain characters.
    assert (await _page(client, q="PERSON 01"))["total"] == 10
    assert (await _page(client, q="person042@"))["total"] == 1
    assert (await _page(client, q="%"))["total"] == 0
    assert (await _page(client, q="owner@example"))["items"][0]["role"] == "owner"

    # Filters: company (or none), role, status; the summary stays the whole list.
    assert (await _page(client, company=bid))["total"] == 60
    none = await _page(client, company="none")
    assert none["total"] == 1 and none["summary"]["members"] == 61
    assert (await _page(client, role="owner"))["total"] == 1
    assert (await _page(client, status="disabled"))["total"] == 6
    pending = await _page(client, status="pending")
    assert all(m["must_change_password"] and m["is_active"] for m in pending["items"])
    assert pending["total"] == 18  # one in three, less the two of them switched off
    assert (await _page(client, status="active"))["total"] == 61 - 6 - 18
    assert (await _page(client, role="staff", status="pending", q="person00"))["total"] == 3

    # Sort: email backwards; company puts people with none last either way.
    e = await _page(client, sort="email", dir="desc")
    assert e["items"][0]["email"] == "person059@example.com"
    for d in ("asc", "desc"):
        last = (await _page(client, sort="company", dir=d, page=3))["items"][-1]
        assert last["branch_id"] is None
    seen_sorted = await _page(client, sort="last_seen")  # nobody signed in yet but the owner
    assert seen_sorted["items"][0]["email"] == "owner@example.com"


async def test_a_branch_manager_pages_only_their_branch(client):
    o = await office(client)
    bid = o["branch"]["id"]
    other = (await client.post("/api/branches", json={"name": "Lain"}, headers=csrf(client))).json()
    await _people(12, bid)
    async with SessionLocal() as db:
        u = User(email="far@example.com", name="Far Away", password_hash=HASH)
        db.add(u)
        await db.flush()
        db.add(
            Membership(
                workspace_id=(await _ws()).id, user_id=u.id, role="staff", branch_id=other["id"]
            )
        )
        await db.commit()
    bm = await member(client, "bm@example.com", "branch_manager", branch_id=bid)
    c = await signed_in("bm@example.com", bm["temp_password"])
    try:
        d = await _page(c)
        assert d["total"] == 13 and d["summary"]["members"] == 13  # 12 and themselves
        assert all(m["email"] != "far@example.com" for m in d["items"])
        assert (await _page(c, company=other["id"]))["total"] == 0
        assert len((await c.get("/api/members")).json()) == 13
    finally:
        await c.aclose()


async def test_bulk_remove_and_change_access(client):
    o = await office(client)
    bid = o["branch"]["id"]
    ids = await _people(4, bid)
    owner = next(m for m in (await client.get("/api/members")).json() if m["role"] == "owner")
    r = await client.post(
        "/api/members/bulk",
        json={"user_ids": [ids[0], ids[1], owner["user_id"]], "action": "remove"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["done"] == 2 and d["skipped"] == 1
    assert d["results"][2]["message"] == "You cannot remove yourself."
    left = {m["user_id"] for m in (await client.get("/api/members")).json()}
    assert ids[0] not in left and ids[2] in left

    hod = await client.post(
        "/api/members/bulk",
        json={"user_ids": [ids[2], ids[3]], "action": "access", "role": "hod"},
        headers=csrf(client),
    )
    assert hod.json()["done"] == 0  # a head of department needs a department: nobody changed
    r = await client.post(
        "/api/members/bulk",
        json={
            "user_ids": [ids[2], ids[3]],
            "action": "access",
            "role": "supervisor",
            "department_id": o["depts"]["Finance"],
        },
        headers=csrf(client),
    )
    assert r.json()["done"] == 2
    rows = {m["user_id"]: m for m in (await client.get("/api/members")).json()}
    assert rows[ids[2]]["role"] == "supervisor" and rows[ids[3]]["department_name"] == "Finance"
    r = await client.post(
        "/api/members/bulk", json={"user_ids": [ids[2]], "action": "access"}, headers=csrf(client)
    )
    assert r.status_code == 422

    staff = await member(client, "staff9@example.com", "staff", branch_id=bid)
    c = await signed_in("staff9@example.com", staff["temp_password"])
    try:
        r = await c.post(
            "/api/members/bulk", json={"user_ids": [ids[2]], "action": "remove"}, headers=csrf(c)
        )
        assert r.status_code == 403
    finally:
        await c.aclose()


# ---------------------------------------------------------------- the import command


def _sheet(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["Name", "Email", "Role", "Company", "Department"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SHEET = [
    ["Aminah Example", "aminah@example.com", "Staff", "Maju Sdn Bhd", "Finance"],  # row 2
    ["Badrul Example", "badrul@example.com", "Staf", "Majuu Sdn Bhd", ""],  # 3: close match
    ["Chong Example", "chong@example.com", "", "Maju Sdn Bhd", ""],  # 4
    ["Owner Again", "owner@example.com", "Staff", "Maju Sdn Bhd", ""],  # 5: a member already
    ["Elsewhere Person", "else@example.com", "Staff", "Maju Sdn Bhd", ""],  # 6: other workspace
    ["Aminah Twice", "AMINAH@example.com", "Staff", "Maju Sdn Bhd", ""],  # 7: same email
    ["Bad Email", "not-an-email", "Staff", "Maju Sdn Bhd", ""],  # 8
    ["New Co Person", "newco@example.com", "Staff", "Kilang Baru Sdn Bhd", ""],  # 9
    ["", "noname@example.com", "Staff", "Maju Sdn Bhd", ""],  # 10
]
SECRETS = ("aminah", "badrul", "chong", "else@", "newco", "noname", "Example", "Elsewhere")


async def _cli(tmp: Path, *argv: str) -> int:
    args = members_import.parser().parse_args([str(tmp / "staff.xlsx"), *argv])
    try:
        data, out = members_import.prepare(args)
        with use_lang("en"):
            return await members_import.run(args, data, out)
    except members_import.Stop as e:
        print(f"Stopped: {e}")
        return 2


async def _setup_import(client, tmp_path: Path) -> str:
    await office(client)
    ws = await _ws()
    async with SessionLocal() as db:
        other = Workspace(name="Other", slug="other-co")
        db.add(other)
        u = User(email="else@example.com", name="Elsewhere Person", password_hash=HASH)
        db.add(u)
        await db.flush()
        db.add(Membership(workspace_id=other.id, user_id=u.id, role="viewer"))
        await db.commit()
    (tmp_path / "staff.xlsx").write_bytes(_sheet(SHEET))
    return ws.slug


async def _count_members(slug: str) -> int:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace).where(Workspace.slug == slug))
        return await db.scalar(
            select(func.count()).select_from(Membership).where(Membership.workspace_id == ws.id)
        )


async def test_import_command_dry_run_prints_counts_only(client, tmp_path, capsys):
    slug = await _setup_import(client, tmp_path)
    assert await _cli(tmp_path, "--dry-run") == 2  # two workspaces: it asks which
    assert "--workspace" in capsys.readouterr().out

    assert await _cli(tmp_path, "--dry-run", "--workspace", slug) == 0
    out = capsys.readouterr().out
    assert not any(s.lower() in out.lower() for s in SECRETS), out
    assert "rows:" not in out  # row numbers only with --show-rows
    lines = {ln.split("  ")[1].strip(): ln.split()[-1] for ln in out.splitlines() if ln[:2] == "  "}
    assert lines["ok"] == "3" and lines["skipped"] == "5"
    assert lines["accounts from another workspace (own password)"] == "1"
    assert lines["new accounts (one-time password)"] == "3"
    assert lines["already a member"] == "1"
    assert lines["same email twice in the file (first row kept)"] == "1"
    assert lines["bad email"] == "1" and lines["name missing"] == "1"
    assert lines["company not in the office"] == "1"
    assert lines["company matched by a close name"] == "1"
    assert "Dry run: nothing was changed." in out
    assert await _count_members(slug) == 1

    # Row numbers per reason only when asked; still no names or emails.
    assert await _cli(tmp_path, "--dry-run", "--workspace", slug, "--show-rows") == 0
    out = capsys.readouterr().out
    assert "rows: 7" in out and "rows: 5" in out and "rows: 8" in out and "rows: 9" in out
    assert not any(s.lower() in out.lower() for s in SECRETS)

    # The missing company, added in the dry run's transaction only: exact counts, no change.
    assert await _cli(tmp_path, "--dry-run", "--workspace", slug, "--add-missing-companies") == 0
    out = capsys.readouterr().out
    assert "companies that would be added" in out and "company not in the office" not in out
    async with SessionLocal() as db:
        assert await db.scalar(select(Branch).where(Branch.name.ilike("kilang%"))) is None


async def test_import_command_adds_once_and_writes_the_sign_ins(client, tmp_path, capsys):
    slug = await _setup_import(client, tmp_path)
    out_csv = tmp_path / "signins.csv"
    assert await _cli(tmp_path, "--yes", "--workspace", slug) == 2  # where do passwords go?
    assert "--signins-out" in capsys.readouterr().out
    assert await _count_members(slug) == 1

    code = await _cli(
        tmp_path, "--yes", "--workspace", slug, "--signins-out", str(out_csv),
        "--add-missing-companies",
    )  # fmt: skip
    assert code == 0
    printed = capsys.readouterr().out
    assert not any(s.lower() in printed.lower() for s in SECRETS), printed
    assert await _count_members(slug) == 1 + 5  # 4 new accounts, 1 from another workspace

    with out_csv.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    assert rows[0] == list(members_import.SIGNIN_COLUMNS)
    by_email = {r[1]: r for r in rows[1:]}
    assert set(by_email) == {
        "aminah@example.com", "badrul@example.com", "chong@example.com", "else@example.com",
        "newco@example.com",
    }  # fmt: skip
    assert by_email["else@example.com"][2] == "Their own password"
    assert by_email["aminah@example.com"][4:6] == ["Maju Sdn Bhd", "Finance"]
    assert by_email["newco@example.com"][4] == "Kilang Baru Sdn Bhd"
    for email in ("aminah@example.com", "newco@example.com"):
        pw = by_email[email][2]
        assert len(pw) >= 10 and pw not in printed
    assert by_email["aminah@example.com"][6].endswith("/")

    async with SessionLocal() as db:
        # The account from another workspace keeps its own password.
        u = await db.scalar(select(User).where(User.email == "else@example.com"))
        assert u.password_hash == HASH and not u.must_change_password
        added = (await db.scalars(select(AuditLog).where(AuditLog.action == "member.added"))).all()
        assert {a.actor for a in added} == {members_import.ACTOR} and len(added) == 5
        made = (await db.scalars(select(AuditLog).where(AuditLog.action == "branch.created"))).all()
        assert [a.actor for a in made if a.after["name"] == "Kilang Baru Sdn Bhd"] == [
            members_import.ACTOR
        ]
        dept = await db.scalar(select(Department).where(Department.name == "Finance"))
        m = await db.scalar(
            select(Membership)
            .join(User, User.id == Membership.user_id)
            .where(User.email == "aminah@example.com")
        )
        assert m.department_id == dept.id

    # The same file again: everyone is already a member, nobody is added twice.
    again = tmp_path / "again.csv"
    assert await _cli(tmp_path, "--yes", "--workspace", slug, "--signins-out", str(again)) == 0
    printed = capsys.readouterr().out
    assert "Nobody to add." in printed
    assert await _count_members(slug) == 6
    assert not again.exists()
    # Never over an earlier file of passwords.
    assert await _cli(tmp_path, "--yes", "--workspace", slug, "--signins-out", str(out_csv)) == 2
    assert "already exists" in capsys.readouterr().out


@pytest.mark.parametrize("bad", ["--yes --dry-run", ""])
def test_import_command_needs_one_mode(bad):
    with pytest.raises(SystemExit):
        members_import.parser().parse_args(["x.xlsx", *bad.split()])
