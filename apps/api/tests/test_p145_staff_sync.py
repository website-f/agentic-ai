"""P145c: the CSV staff sync (org/staff_sync.py) and the Prima mirror after a sign-in email moves
to a personal one. Synthetic people and companies only (example domains)."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from agentic.core.db import SessionLocal
from agentic.microsoft import auth as ms_auth
from agentic.models import (
    Agent,
    AuditLog,
    AuthSession,
    Branch,
    Department,
    Membership,
    MicrosoftAccount,
    OrgPosition,
    OrgUnit,
    User,
    Workspace,
)
from agentic.org import staff_sync as ss
from agentic.prima import client as prima
from agentic.prima import mirror
from agentic.teams.branches import set_branches

from .conftest import setup_owner
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import member
from .test_p63_microsoft_signin import anon, configure, sign_in, sso  # noqa: F401

COMPANY = "acme.example"
OWNER_EMAIL = "owner@example.com"


def cat(*extra: ss.Position) -> ss.Catalogue:
    return ss.Catalogue(
        [
            ss.Position("operations_manager", "Operations Manager", aliases=["OM"]),
            ss.Position("regional_operations_manager", "Regional Operations Manager"),
            ss.Position("operations_executive", "Operations Executive"),
            ss.Position("patrolling_officer", "Patrolling Officer"),
            ss.Position("head_of_company", "Head of Company"),
            ss.Position("local_company_administrator", "Local Company Administrator"),
            ss.Position(
                "admin_executive_third", "Admin Executive (third)", None, ["Admin Executive"]
            ),
            ss.Position("dept_cms_executive", "CMS Executive"),
            ss.Position("store_helper", "Store Helper"),
            *extra,
        ]
    )


ZONE = {"units": ["OPERASI JOHOR"], "places": [{"branch": "Goodwill Empire", "dept": "Johor"}]}
CO = {"companies": ["ACME SECURITY SDN BHD"], "places": [{"branch": "Acme Security"}]}


@pytest.mark.parametrize(
    ("jawatan", "tugasan", "where", "key"),
    [
        ("PENGURUS OPERASI", "OPERASI JOHOR", ZONE, "operations_manager"),
        ("OM", "PENGURUS OPERASI", ZONE, "operations_manager"),
        ("PENGURUS OPERASI WILAYAH", "OPERASI", ZONE, "regional_operations_manager"),
        ("PEGAWAI OPERASI", "OPERASI", ZONE, "operations_executive"),
        ("PEGAWAI OPERASI", "RONDAAN KAWASAN", ZONE, "patrolling_officer"),
        ("PENGURUS", "MENGURUS SYARIKAT", CO, "head_of_company"),
        ("PENGURUS SYARIKAT", "PENTADBIRAN", CO, "head_of_company"),
        ("KERANI PENTADBIRAN", "ADMIN", CO, "local_company_administrator"),
        ("EKSEKUTIF PENTADBIRAN", "ADMIN JOHOR", ZONE, "admin_executive_third"),
        (
            "CCTV CMS",
            "CHECK CLOCKING",
            {"units": ["CONTROL ROOM"], "places": []},
            "dept_cms_executive",
        ),
        (
            "STORE HELPER",
            "STOREKEEPER",
            {"units": ["UNIT PENGURUSAN SEKOLAH / PKK"]},
            "store_helper",
        ),
    ],
)
def test_position_rules(jawatan, tugasan, where, key):
    m = ss.match_position(
        cat(), jawatan, tugasan, where.get("companies", []), where.get("units", []),
        where.get("places", []),
    )  # fmt: skip
    assert m.key == key, m
    assert 0.6 <= m.confidence <= 0.95


def test_uncertain_titles_go_to_unsorted_and_a_later_position_is_found():
    unit = {"units": ["UNIT KEWANGAN (DE)"], "places": []}
    m = ss.match_position(cat(), "EKSEKUTIF KEWANGAN", "DATA ENTRY", [], unit["units"], [])
    assert m.key is None and "Finance Executive" in m.reason
    # The owner adds the position later, under a key of their own: found by its Malay title.
    added = ss.Position("custom_fin", "Finance Exec", "Eksekutif Kewangan", default_role="staff")
    m = ss.match_position(cat(added), "EKSEKUTIF KEWANGAN", "DATA ENTRY", [], unit["units"], [])
    assert m.key == "custom_fin"
    m = ss.match_position(cat(), "KETUA UNIT KEBAJIKAN", "URUS", [], ["UNIT KEBAJIKAN"], [])
    assert m.key is None and "head of a unit" in m.reason
    assert ss.match_position(cat(), None, None, [], [], []).key is None
    assert ss.title_case("EKSEKUTIF PENTADBIRAN/PEGAWAI OPERASI") == (
        "Eksekutif Pentadbiran / Pegawai Operasi"
    )
    assert ss.title_case("IT EKSEKUTIF") == "IT Eksekutif"
    assert ss.title_case("KETUA UNIT KBK & KENDERAAN") == "Ketua Unit KBK & Kenderaan"


# ---------------------------------------------------------------- plan and apply


async def _member(db, ws, email, name, role, branch_id, dept_id=None, **user) -> str:
    u = User(email=email, name=name, password_hash="x", **user)
    db.add(u)
    await db.flush()
    m = Membership(workspace_id=ws, user_id=u.id, role=role, department_id=dept_id)
    set_branches(m, branch_id, [branch_id] if branch_id else [])
    db.add(m)
    await db.flush()
    return u.id


async def _office(c) -> dict[str, str]:
    await setup_owner(c, OWNER_EMAIL)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        owner = await db.scalar(select(User.id).where(User.email == OWNER_EMAIL))
        acme = Branch(workspace_id=ws, name="Acme Security", slug="acme")
        gw = Branch(workspace_id=ws, name="Goodwill Empire", slug="goodwill")
        db.add_all([acme, gw])
        await db.flush()
        johor = Department(workspace_id=ws, branch_id=gw.id, name="Johor", slug="johor")
        db.add(johor)
        await db.flush()
        unit = OrgUnit(workspace_id=ws, key="regional_operations", name="Regional", kind="unit")
        db.add(unit)
        await db.flush()
        for key, title, role in (
            ("operations_manager", "Operations Manager", "supervisor"),
            ("head_of_company", "Head of Company", "branch_manager"),
            ("local_company_administrator", "Local Company Administrator", "staff"),
            ("ogm", "Operations General Manager", "hod"),
        ):
            db.add(
                OrgPosition(
                    workspace_id=ws, key=key, title=title, unit_id=unit.id, default_role=role
                )
            )
        ids = {"ws": ws, "owner": owner, "acme": acme.id, "gw": gw.id, "johor": johor.id}
        ids["ali"] = await _member(db, ws, f"ops.johor@{COMPANY}", "Ali", "staff", gw.id, johor.id)
        ids["ali_extra"] = await _member(db, ws, f"johor.hq@{COMPANY}", "Ali HQ", "staff", gw.id)
        ids["busy_extra"] = await _member(
            db, ws, f"acme.hq@{COMPANY}", "Old HQ", "staff", acme.id,
            last_login_at=datetime.now(UTC),
        )  # fmt: skip
        ids["siti"] = await _member(db, ws, f"siti@{COMPANY}", "Siti", "staff", acme.id)
        ids["taken"] = await _member(db, ws, "taken@mail.example", "Taken", "staff", acme.id)
        ids["bob"] = await _member(db, ws, f"bob@{COMPANY}", "Bob", "staff", acme.id)
        db.add(
            Agent(
                workspace_id=ws, branch_id=acme.id, slug="x", name="X", role="r",
                owner_user_id=ids["busy_extra"],
            )
        )  # fmt: skip
        await db.commit()
    return ids


def _input(ids: dict[str, str]) -> dict:
    zone = {"units": ["OPERASI JOHOR"], "places": [{"branch": "GOODWILL EMPIRE", "dept": "Johor"}]}
    co = {"companies": ["ACME SECURITY SDN BHD"], "places": [{"branch": "Acme Security"}]}
    return {
        "company_domains": [COMPANY],
        "people": [
            {  # a. b. c. d. f.: work login -> personal, work email kept, OM -> supervisor
                "ref": "p1", "name": "ALI BIN ABU", "action": "update", "confidence": 1.0,
                "office_user_id": ids["ali"], "login_email": "ali.abu@mail.example",
                "work_email": f"ops.johor@{COMPANY}", "jawatan": "PENGURUS OPERASI",
                "tugasan": "OPERASI JOHOR", "extra_accounts": [ids["ali_extra"]], **zone,
            },
            {  # a new person: staff, pending, never emailed
                "ref": "p2", "name": "NUR AINA BINTI ALI", "action": "add", "confidence": 0,
                "office_user_id": None, "login_email": "aina@mail.example",
                "work_email": f"admin@{COMPANY}", "jawatan": "KERANI PENTADBIRAN",
                "tugasan": "ADMIN", **co,
            },
            {  # the owner: never changed
                "ref": "p3", "name": "OWNER", "action": "update", "confidence": 1.0,
                "office_user_id": ids["owner"], "login_email": "owner.personal@mail.example",
                "work_email": f"boss@{COMPANY}", "jawatan": "PENGURUS", "tugasan": "MENGURUS",
                **co,
            },
            {  # Head of Company: the one position raised to branch manager (their company)
                "ref": "p4", "name": "SITI", "action": "update", "confidence": 1.0,
                "office_user_id": ids["siti"], "login_email": None, "work_email": None,
                "jawatan": "PENGURUS", "tugasan": "MENGURUS SYARIKAT",
                "extra_accounts": [ids["busy_extra"]], **co,
            },
            {  # their personal email is someone else's sign-in: left, listed
                "ref": "p5", "name": "BOB", "action": "update", "confidence": 1.0,
                "office_user_id": ids["bob"], "login_email": "taken@mail.example",
                "work_email": None, "jawatan": "KERANI PENTADBIRAN", "tugasan": "ADMIN", **co,
            },
            {"ref": "p6", "name": "UNSURE", "action": "review", "confidence": 0,
             "office_user_id": None, "login_email": None, "work_email": None,
             "jawatan": "TRAINER", "tugasan": "MELATIH"},
        ],
        "mailboxes": [
            {"address": f"admin@{COMPANY}", "label": "Acme admin", "places": co["places"]}
        ],
    }  # fmt: skip


async def _run(ws: str, inp: dict, *, mailboxes: bool = False) -> tuple[dict, ss.Applied]:
    async with SessionLocal() as db:
        plan = ss.compute(inp, await ss.snapshot(db, ws))
        res = await ss.apply(db, await ss._principal(db, ws), plan, mailboxes=mailboxes)
    return plan, res


async def test_plan_then_apply_then_nothing_more(client):
    ids = await _office(client)
    ws = ids["ws"]
    inp = _input(ids)
    async with SessionLocal() as db:
        plan = ss.compute(inp, await ss.snapshot(db, ws))
    by = {p["ref"]: p for p in plan["people"]}
    kinds = {p: [c["kind"] for c in by[p]["changes"]] for p in by}
    assert kinds["p1"] == ["work_email", "job_title", "position", "role", "login_email"]
    assert kinds["p2"][0] == "add" and "position" in kinds["p2"]
    assert kinds["p3"] == ["work_email", "job_title", "position"]  # no move, role or sign-in
    assert any("sign-in email of an owner" in r for r in by["p3"]["review"])
    assert [c for c in by["p4"]["changes"] if c["kind"] == "role"] == [
        {"kind": "role", "from": "staff", "to": "branch_manager"}
    ]
    assert not by["p4"]["review"]
    assert "login_email" not in kinds["p5"] and by["p5"]["email_taken"] == ids["taken"]
    assert kinds["p6"] == [] and by["p6"]["unsorted"]
    extras = {x["user_id"]: x["action"] for x in plan["extra_accounts"]}
    assert extras == {ids["ali_extra"]: "switch_off", ids["busy_extra"]: "review"}
    assert plan["mailboxes"][0]["action"] == "register"
    assert plan["mailboxes"][0]["used_by"] == ["ref:p2"]

    _, res = await _run(ws, inp, mailboxes=True)
    assert not res.skipped, res.skipped
    assert res.done["login_email"] == 1 and res.done["add"] == 1
    async with SessionLocal() as db:
        ali = await db.get(Membership, (ws, ids["ali"]))
        assert ali.user.email == "ali.abu@mail.example"
        assert ali.work_email == f"ops.johor@{COMPANY}"
        assert ali.job_title == "Pengurus Operasi" and ali.role == "supervisor"
        om = await db.scalar(select(OrgPosition.id).where(OrgPosition.key == "operations_manager"))
        assert ali.position_id == om and ali.department_id == ids["johor"]
        aina = await db.scalar(select(User).where(User.email == "aina@mail.example"))
        am = await db.get(Membership, (ws, aina.id))
        assert am.role == "staff" and am.branch_id == ids["acme"]
        assert aina.must_change_password  # pending
        assert aina.name == "Nur Aina Binti Ali" and am.work_email == f"admin@{COMPANY}"
        owner = await db.get(Membership, (ws, ids["owner"]))
        assert owner.role == "owner" and owner.user.email == OWNER_EMAIL
        assert owner.branch_id is None
        siti = await db.get(Membership, (ws, ids["siti"]))
        assert siti.role == "branch_manager" and siti.branch_id == ids["acme"]
        assert siti.job_title == "Pengurus"
        bob = await db.get(Membership, (ws, ids["bob"]))
        assert bob.user.email == f"bob@{COMPANY}"
        assert not (await db.get(User, ids["ali_extra"])).is_active
        assert (await db.get(User, ids["busy_extra"])).is_active
        rows = (await db.scalars(select(AuditLog).where(AuditLog.actor == ss.ACTOR))).all()
        assert rows and all(r.note for r in rows)
        assert {r.note for r in rows if r.action != "member.microsoft_reset"} == {ss.NOTE}
        audits = await db.scalar(select(func.count()).select_from(AuditLog))

    plan2, res2 = await _run(ws, inp, mailboxes=True)
    assert plan2["summary"]["with_changes"] == 0, plan2["summary"]
    assert not res2.done and not res2.skipped
    assert plan2["mailboxes"][0]["action"] == "exists"
    assert plan2["mailboxes"][0]["used_by"] == [aina.id]
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == audits


async def test_role_is_raised_only_up_to_hod(client):
    ids = await _office(client)
    inp = {
        "company_domains": [COMPANY],
        "people": [
            {"ref": "o1", "name": "OGM", "action": "update", "confidence": 1.0,
             "office_user_id": ids["bob"], "login_email": None, "work_email": None,
             "jawatan": "KETUA UNIT PENGURUSAN SEKOLAH", "tugasan": "OPERATION GENERAL MANAGER",
             "units": ["UNIT PENGURUSAN SEKOLAH / PENGURUSAN PKK"],
             "places": [{"branch": "Goodwill Empire", "dept": "Johor"}]},
        ],
    }  # fmt: skip
    plan, res = await _run(ids["ws"], inp)
    assert [c for c in plan["people"][0]["changes"] if c["kind"] == "role"] == [
        {"kind": "role", "from": "staff", "to": "hod"}
    ]
    async with SessionLocal() as db:
        bob = await db.get(Membership, (ids["ws"], ids["bob"]))
        # moved to the listed company and department (sure match), then head of department
        assert (bob.role, bob.branch_id, bob.department_id) == ("hod", ids["gw"], ids["johor"])
    assert ss._role_change("staff", "management", "d")[0] is None
    assert ss._role_change("staff", "branch_manager", "d")[1]  # only for Head of Company
    assert ss._role_change("staff", "branch_manager", None, "head_of_company")[0]
    assert ss._role_change("staff", "management", None, "head_of_company")[1]
    assert ss._role_change("owner", "branch_manager", None, "head_of_company") == (None, None)
    assert ss._role_change("staff", "group_hod", "d")[1]
    assert ss._role_change("hod", "staff", "d") == (None, None)  # never lowered
    assert ss._role_change("admin", "hod", "d") == (None, None)


# ---------------------------------------------------------------- the mirror after a switch


async def test_mirror_does_not_duplicate_after_an_email_switch(client, monkeypatch):
    ids = await _office(client)
    ws = ids["ws"]
    await _run(ws, _input(ids))
    async with SessionLocal() as db:
        w = await db.get(Workspace, ws)
        w.settings = {**(w.settings or {}), "prima_companies": {ids["gw"]: "c-gw"}}
        await db.commit()
        before = await db.scalar(select(func.count()).select_from(Membership))
    old = f"ops.johor@{COMPANY}"

    async def companies():
        return [client_company]

    async def staff():
        return [
            prima.StaffRecord(
                id="pr-acct-1", name="Ali", title="", role="admin_exec", entra_oid=None,
                can_sign_in=True, email=old, company_ids=("c-gw",),
            )
        ]  # fmt: skip

    async def people():
        return [prima.StaffPerson(id="pr-rec-1", company_id="c-gw", name="Ali", email=old)]

    async def top_record():
        return None

    client_company = prima.Company(id="c-gw", name="Goodwill Empire")
    monkeypatch.setattr(prima, "companies", companies)
    monkeypatch.setattr(prima, "staff", staff)
    monkeypatch.setattr(prima, "people", people)
    monkeypatch.setattr(prima, "top_record", top_record)
    async with SessionLocal() as db:
        rep = await mirror.run(db, ws)
    assert rep.added == [] and rep.added_from_records == [], rep.summary()
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Membership)) == before
        assert await db.scalar(select(User.id).where(User.email == old)) is None


# ---------------------------------------------------------------- a connected work account


def _switch(uid: str, personal: str, work: str) -> dict:
    return {
        "company_domains": [COMPANY],
        "people": [
            {"ref": "m1", "name": "ALI", "action": "update", "confidence": 1.0,
             "office_user_id": uid, "login_email": personal, "work_email": work,
             "jawatan": None, "tugasan": None, "places": []},
        ],
    }  # fmt: skip


async def _accounts(db, uid: str) -> list[MicrosoftAccount]:
    q = select(MicrosoftAccount).where(MicrosoftAccount.user_id == uid)
    return list((await db.scalars(q)).all())


async def test_a_connected_work_account_stays_as_an_extra_account(client, llm, temporal, sso):
    await office(client)
    await configure(client)
    work = f"ops@{COMPANY}"
    await member(client, work, "hr")
    async with SessionLocal() as db:
        uid = await db.scalar(select(User.id).where(User.email == work))
        ws = await db.scalar(select(Workspace.id))
    ali = anon(client)
    try:
        sso.nonce = ""
        sso.me = {"id": "oid-work", "mail": work, "userPrincipalName": work}
        assert (await sign_in(ali, sso))["sso"] == "done"
        async with SessionLocal() as db:
            assert (await db.get(Membership, (ws, uid))).ms_oid == "oid-work"
            plan = ss.compute(_switch(uid, "ali@mail.example", work), await ss.snapshot(db, ws))
            login = [c for c in plan["people"][0]["changes"] if c["kind"] == "login_email"]
            assert login[0]["microsoft"] == "kept_as_extra"
            res = await ss.apply(db, await ss._principal(db, ws), plan)
        assert res.done["login_email"] == 1, res.skipped
        assert (await ali.get("/api/auth/me")).status_code == 401  # signed out everywhere
    finally:
        await ali.aclose()
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        assert m.user.email == "ali@mail.example" and m.work_email == work
        assert m.ms_oid is None and m.ms_tenant_id is None
        accts = await _accounts(db, uid)
        assert [(a.ms_user_id, a.is_primary, a.status, a.label) for a in accts] == [
            ("oid-work", False, "connected", "Work")
        ]
        assert accts[0].token_enc  # still connected: nothing was disconnected
        kept = select(AuditLog.id).where(AuditLog.action == "member.microsoft_kept_as_extra")
        assert await db.scalar(kept)
        reset = select(AuditLog.id).where(AuditLog.action == "member.microsoft_reset")
        assert not await db.scalar(reset)
        assert not await db.scalar(select(AuthSession.id).where(AuthSession.user_id == uid))
    # The work account still opens their office, but never becomes who they are again.
    again = anon(client)
    try:
        sso.nonce = ""
        assert (await sign_in(again, sso))["sso"] == "done"
        assert (await again.get("/api/auth/me")).json()["user"]["id"] == uid
    finally:
        await again.aclose()
    async with SessionLocal() as db:
        assert (await db.get(Membership, (ws, uid))).ms_oid is None
        assert [(a.ms_user_id, a.is_primary) for a in await _accounts(db, uid)] == [
            ("oid-work", False)
        ]
    # Their own Microsoft account (the personal email) links as the main one.
    own = anon(client)
    try:
        sso.nonce = ""
        mine = "ali@mail.example"
        sso.me = {"id": "oid-own", "mail": mine, "userPrincipalName": mine}
        assert (await sign_in(own, sso))["sso"] == "done"
    finally:
        await own.aclose()
    async with SessionLocal() as db:
        assert (await db.get(Membership, (ws, uid))).ms_oid == "oid-own"
        assert sorted((a.ms_user_id, a.is_primary) for a in await _accounts(db, uid)) == [
            ("oid-own", True),
            ("oid-work", False),
        ]


async def test_no_room_for_another_extra_account_lets_go_as_before(client):
    ids = await _office(client)
    ws, uid = ids["ws"], ids["bob"]
    assert ss.MAX_EXTRA_ACCOUNTS == ms_auth.MAX_EXTRA_ACCOUNTS
    async with SessionLocal() as db:
        db.add(MicrosoftAccount(workspace_id=ws, user_id=uid, ms_user_id="oid-main"))
        for i in range(ss.MAX_EXTRA_ACCOUNTS):
            db.add(
                MicrosoftAccount(
                    workspace_id=ws, user_id=uid, ms_user_id=f"oid-x{i}", is_primary=False
                )
            )
        await db.commit()
        inp = _switch(uid, "bob.own@mail.example", f"bob@{COMPANY}")
        plan = ss.compute(inp, await ss.snapshot(db, ws))
        item = plan["people"][0]
        assert [c["microsoft"] for c in item["changes"] if c["kind"] == "login_email"] == ["let_go"]
        assert any("too many extra Microsoft accounts" in n for n in item["notes"])
        assert plan["summary"]["login_microsoft"] == {"let_go": 1}
        res = await ss.apply(db, await ss._principal(db, ws), plan)
    assert res.done["login_email"] == 1, res.skipped
    async with SessionLocal() as db:
        main = [a for a in await _accounts(db, uid) if a.is_primary]
        assert [(a.status, a.ms_user_id) for a in main] == [("disconnected", "")]  # let go
        reset = select(AuditLog.id).where(AuditLog.action == "member.microsoft_reset")
        assert await db.scalar(reset)
