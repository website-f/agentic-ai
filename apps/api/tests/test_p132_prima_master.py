"""P132: Prima keeps the organization and the people; the office takes its shape once (adopt) and
then follows it (mirror). Synthetic companies and people only (example.com)."""

import hashlib
import hmac

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import (
    Branch,
    Department,
    Membership,
    MembershipBranch,
    PrimaLink,
    User,
    Workspace,
)
from agentic.prima import adopt, autolink, client, mirror, org_link, org_sync

from .conftest import csrf, setup_owner
from .test_office_roles import member

SECRET = "p132-test-secret-0123456789abcdef"


@pytest.fixture
def fake_prima(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(client, "_TOP", {})
    monkeypatch.setattr(autolink, "on", False)
    monkeypatch.setattr(org_link, "on", False)
    monkeypatch.setattr(org_sync, "on", False)
    state: dict = {
        "companies": [
            {"id": "pwvsb", "name": "PW Venture Sdn Bhd (PWVSB)", "aliases": ["Unit HR"]},
            {"id": "goodwill", "name": "Goodwill Empire Sdn Bhd", "aliases": ["Operasi Johor"]},
            {"id": "co-safe", "name": "Safe Zone Security Sdn Bhd", "aliases": []},
            {"id": "co-new", "name": "Brand New Guards Sdn Bhd", "aliases": []},
        ],
        "staff": [
            {
                "id": "u-ceo",
                "name": "Chief",
                "title": "CEO",
                "role": "director",
                "canSignIn": True,
                "top": "ceo",
            }
        ],  # fmt: skip
        "heads": {},
    }

    def handler(req: httpx.Request) -> httpx.Response:
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        if (
            h["x-office-signature"]
            != hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        ):
            return httpx.Response(401)
        if url == "/api/office/companies":
            return httpx.Response(200, json=state["companies"])
        if url == "/api/office/staff":
            return httpx.Response(200, json=state["staff"])
        if url == "/api/org/chart" and h["x-office-user"] == "u-ceo":
            people = [
                {"id": s["id"], "heads": state["heads"].get(s["id"], [])} for s in state["staff"]
            ]
            return httpx.Response(200, json={"installed": True, "people": people})
        return httpx.Response(404)

    monkeypatch.setattr(client, "transport", httpx.MockTransport(handler))
    return state


async def _branch(c, name: str) -> str:
    r = await c.post("/api/branches", json={"name": name}, headers=csrf(c))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _office(c) -> tuple[str, dict[str, str], dict[str, str]]:
    await setup_owner(c)
    b = {
        "pw": await _branch(c, "PW VENTURE SDN BHD"),
        "hr": await _branch(c, "UNIT HR"),
        "johor": await _branch(c, "OPERASI JOHOR"),
        "safe": await _branch(c, "SAFE ZONE SECURITY SDN BHD"),
        "pic": await _branch(c, "SAFE ZONE SECURITY SDN BHD (PIC-SASA PROTECTION)"),
        "ja": await _branch(c, "JA GROUP"),
    }
    u = {
        "hana": (await member(c, "hana@example.com", "staff", branch_id=b["hr"]))["member"][
            "user_id"
        ],
        "omar": (await member(c, "omar@example.com", "branch_manager", branch_id=b["johor"]))[
            "member"
        ]["user_id"],
        "pia": (await member(c, "pia@example.com", "staff", branch_id=b["pic"]))["member"][
            "user_id"
        ],
    }
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        w = await db.get(Workspace, ws)
        w.settings = {
            **(w.settings or {}),
            "prima_companies": {
                b["pw"]: "pwvsb",
                b["hr"]: "pwvsb",
                b["johor"]: "goodwill",
                b["safe"]: "co-safe",
                b["pic"]: "co-safe",
            },  # fmt: skip
        }
        await db.commit()
    return ws, b, u


async def test_adopt_takes_primas_shape_and_keeps_everything(client, fake_prima):
    ws, b, u = await _office(client)
    names = {c["id"]: c["name"] for c in fake_prima["companies"]}
    async with SessionLocal() as db:
        plan = await adopt.build(db, names)
        assert [n for _, n in plan.unmapped] == ["JA GROUP"]
        counts = await adopt.apply(db, plan, dry=True)
        assert counts["companies folded"] == 3
    async with SessionLocal() as db:
        assert len((await db.scalars(select(Branch))).all()) == 6  # the dry run changed nothing
        plan = await adopt.build(db, names)
        await adopt.apply(db, plan, dry=False)
    async with SessionLocal() as db:
        got = {x.name: x for x in (await db.scalars(select(Branch))).all()}
        assert set(got) == {
            "PW Venture Sdn Bhd (PWVSB)", "Goodwill Empire Sdn Bhd",
            "Safe Zone Security Sdn Bhd", "JA GROUP",
        }  # fmt: skip
        assert got["PW Venture Sdn Bhd (PWVSB)"].id == b["pw"]  # kept, renamed
        hana = await db.get(Membership, (ws, u["hana"]))
        hr = await db.get(Department, hana.department_id)
        assert hana.branch_id == b["pw"] and hr.name == "Human Resources"
        omar = await db.get(Membership, (ws, u["omar"]))
        dept = await db.get(Department, omar.department_id)
        assert omar.branch_id == got["Goodwill Empire Sdn Bhd"].id and dept.name == "Operasi Johor"
        assert omar.role == "hod" and omar.heads_department  # no wider view than before
        pia = await db.get(Membership, (ws, u["pia"]))
        assert pia.branch_id == b["safe"]
        w = await db.get(Workspace, ws)
        assert set(w.settings["prima_companies"].values()) == {"pwvsb", "goodwill", "co-safe"}
        assert b["hr"] not in w.settings["prima_companies"]


async def test_mirror_follows_prima_and_holds_what_takes_access_away(client, fake_prima):
    ws, b, u = await _office(client)
    async with SessionLocal() as db:
        await adopt.apply(
            db,
            await adopt.build(db, {c["id"]: c["name"] for c in fake_prima["companies"]}),
            dry=False,
        )
    hod = await member(client, "hadi@example.com", "branch_manager", branch_id=b["safe"])
    hadi = hod["member"]["user_id"]
    fake_prima["staff"] += [
        # Hana's own office account: Prima says she is the HR unit's head.
        {"id": f"u-off-{u['hana']}", "name": "Hana", "title": "HR exec", "role": "pwvsb_officer",
         "companyIds": ["pwvsb"], "department": "hr", "email": "hana@example.com"},
        # A person added in Prima (Accounts and access), with an email on their staff record.
        {"id": "u-acc-1", "name": "Nadia", "title": "Company Manager", "role": "company_manager",
         "companyIds": ["co-new"], "email": "nadia@example.com"},
        {"id": "u-acc-2", "name": "No Mail", "title": "Clerk", "role": "pwvsb_officer",
         "companyIds": ["pwvsb"]},
        # Hadi manages a company in the office; Prima has him as a plain officer: held, not lowered.
        {"id": "u-acc-3", "name": "Hadi", "title": "Officer", "role": "pwvsb_officer",
         "companyIds": ["co-safe"], "email": "hadi@example.com"},
        # Pia's access was closed in Prima: held for the owner.
        {"id": "u-acc-4", "name": "Pia", "title": "", "role": "pwvsb_officer",
         "companyIds": ["co-safe"], "email": "pia@example.com", "closed": True},
        # The office owner's own email in Prima as a plain officer: the owner keeps owner.
        {"id": "u-acc-5", "name": "Owner One", "title": "", "role": "pwvsb_officer",
         "companyIds": ["pwvsb"], "email": "owner@example.com"},
        {"id": "u-g", "name": "Guard", "title": "", "role": "guard", "companyIds": ["co-safe"],
         "email": "guard@example.com"},
    ]  # fmt: skip
    fake_prima["heads"][f"u-off-{u['hana']}"] = ["d_hr"]
    async with SessionLocal() as db:
        dry = await mirror.run(db, ws, dry=True)
    assert dry.added == ["Nadia (branch_manager)"]
    async with SessionLocal() as db:
        assert await db.scalar(select(User).where(User.email == "nadia@example.com")) is None
        rep = await mirror.run(db, ws)
    assert rep.companies_made == ["Brand New Guards Sdn Bhd"]
    assert rep.added == ["Nadia (branch_manager)"] and rep.no_email == ["No Mail"]
    assert "Hana: staff -> hod" in rep.raised
    assert {(h["name"], h["kind"]) for h in rep.held} == {("Hadi", "down"), ("Pia", "close")}
    async with SessionLocal() as db:
        nadia = await db.scalar(select(User).where(User.email == "nadia@example.com"))
        m = await db.get(Membership, (ws, nadia.id))
        co = await db.get(Branch, m.branch_id)
        assert m.role == "branch_manager" and co.name == "Brand New Guards Sdn Bhd"
        link = await db.scalar(select(PrimaLink).where(PrimaLink.user_id == nadia.id))
        assert link.prima_user_id == "u-acc-1"
        assert (await db.get(Membership, (ws, hadi))).role == "branch_manager"  # held
        assert (await db.get(User, u["pia"])).is_active  # held
        owner = await db.scalar(select(User).where(User.email == "owner@example.com"))
        assert (await db.get(Membership, (ws, owner.id))).role == "owner"
        assert await db.scalar(select(User).where(User.email == "guard@example.com")) is None
    # A second run changes nothing more; the owner then applies what was held.
    async with SessionLocal() as db:
        again = await mirror.run(db, ws)
    assert not again.added and not again.raised and not again.companies_made
    async with SessionLocal() as db:
        await mirror.run(db, ws, held_too=True)
    async with SessionLocal() as db:
        assert (await db.get(Membership, (ws, hadi))).role == "staff"
        assert not (await db.get(User, u["pia"])).is_active


async def test_office_edits_close_once_prima_keeps_the_people(client, fake_prima):
    ws, b, u = await _office(client)
    # Before the mirror is on, the office edits as before.
    r = await client.post("/api/branches", json={"name": "Before"}, headers=csrf(client))
    assert r.status_code in (200, 201)
    async with SessionLocal() as db:
        await mirror.run(db, ws)  # the first real run switches it on
    r = await client.post("/api/branches", json={"name": "After"}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "managed_in_prima"
    r = await client.patch(
        f"/api/branches/{b['pw']}", json={"name": "Renamed"}, headers=csrf(client)
    )
    assert r.status_code == 409
    r = await client.patch(
        f"/api/branches/{b['pw']}", json={"color": "#336699"}, headers=csrf(client)
    )
    assert r.status_code == 200  # the office's own setting
    r = await client.post(
        "/api/members", json={"email": "x@example.com", "name": "X", "role": "staff",
                              "branch_id": b["pw"]}, headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 409
    hana = u["hana"]
    r = await client.patch(f"/api/members/{hana}", json={"role": "hod", "branch_id": b["hr"]},
                           headers=csrf(client))  # fmt: skip
    assert r.status_code == 409
    r = await client.patch(f"/api/members/{hana}", json={"role": "admin"}, headers=csrf(client))
    assert r.status_code == 200, r.text  # global admin: the office's own list
    r = await client.request("DELETE", f"/api/members/{u['pia']}", json={}, headers=csrf(client))
    assert r.status_code == 409
    r = await client.post(
        "/api/members/bulk", json={"user_ids": [u["pia"]], "action": "remove"}, headers=csrf(client)
    )
    assert r.status_code == 409


async def test_mirror_keeps_several_companies_and_the_owners_place(client, fake_prima):
    ws, b, u = await _office(client)
    async with SessionLocal() as db:
        names = {c["id"]: c["name"] for c in fake_prima["companies"]}
        await adopt.apply(db, await adopt.build(db, names), dry=False)
    # Omar heads Operasi Johor (Goodwill) and also works in Safe Zone; Prima has him at Safe Zone.
    async with SessionLocal() as db:
        db.add(MembershipBranch(workspace_id=ws, user_id=u["omar"], branch_id=b["safe"]))
        await db.commit()
    owner = await setup_owner_id(ws)
    fake_prima["staff"] += [
        {"id": f"u-off-{u['omar']}", "name": "Omar", "title": "", "role": "pwvsb_officer",
         "companyIds": ["co-safe"], "email": "omar@example.com"},
        {"id": f"u-off-{owner}", "name": "Owner One", "title": "", "role": "pwvsb_officer",
         "companyIds": ["co-safe"], "department": "procurement", "email": "owner@example.com"},
    ]  # fmt: skip
    async with SessionLocal() as db:
        rep = await mirror.run(db, ws)
    assert not rep.moved, rep.moved
    async with SessionLocal() as db:
        omar = await db.get(Membership, (ws, u["omar"]))
        assert omar.department_id is not None and b["safe"] in omar.branch_ids
        o = await db.get(Membership, (ws, owner))
        assert o.branch_id != b["safe"] and o.role == "owner"


async def setup_owner_id(ws: str) -> str:
    async with SessionLocal() as db:
        return (await db.scalar(select(User.id).where(User.email == "owner@example.com"))) or ""
