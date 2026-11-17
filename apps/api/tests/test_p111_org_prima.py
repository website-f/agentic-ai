"""P111 (Fitri, 17 Nov 2026): "the organization, make it all capital letter, standardize. and
then what organization added in agentic must exist in prima as well since its correlated".

Organization names are stored in capitals, trimmed, single spaces (org/names.py), on create,
rename and import; departments keep their case. A new organization is linked to its Prima
company of the same name, or added to Prima through Prima's own route (POST /api/companies,
CEO only, with SSM details) as the owner opened as the CEO record (prima/org_link.py). A rename
follows to Prima's company record only when it is this organization by name. Synthetic data."""

import hashlib
import hmac
import json

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Branch, Department, Membership, User, Workspace
from agentic.org.names import org_name, same_org, spaced
from agentic.org.upper_names import upper_names
from agentic.prima import autolink, org_link, org_link_all
from agentic.prima import client as prima

from .conftest import csrf, setup_owner
from .test_office_roles import member, signed_in

SECRET = "p" * 40
DETAILS = {
    "ssm_no": "202601009999 (1234567-X)",
    "state": "Selangor",
    "source_ref": "SSM profile 17 Nov (mock)",
    "reason": "New company joins the group (mock).",
}


def test_names_in_capitals_single_spaces():
    assert org_name("  arena   wirajaya sdn bhd ") == "ARENA WIRAJAYA SDN BHD"
    assert org_name("Xing Securitas (m) Sdn Bhd") == "XING SECURITAS (M) SDN BHD"
    assert org_name("   ") == ""
    assert same_org("Maju  Sdn Bhd", "MAJU SDN BHD") and not same_org("", "")
    assert spaced("  Legal   &  Risk ") == "Legal & Risk"
    assert org_link.company_code("Arena Wirajaya Sdn Bhd") == "AW"
    assert org_link.company_code("Eagle 999 Sdn Bhd") == "E999"
    assert org_link.company_code("PRISMA") == "PRISMA"


async def _ws_id() -> str:
    async with SessionLocal() as db:
        return await db.scalar(select(Workspace.id))


async def test_names_are_stored_in_capitals(client):
    await setup_owner(client)
    r = await client.post(
        "/api/branches", json={"name": "  arena   wirajaya sdn bhd "}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["name"] == "ARENA WIRAJAYA SDN BHD" and b["slug"] == "arena-wirajaya-sdn-bhd"
    blank = await client.post("/api/branches", json={"name": "   "}, headers=csrf(client))
    assert blank.status_code == 400
    r = await client.patch(
        f"/api/branches/{b['id']}", json={"name": "maju  jaya"}, headers=csrf(client)
    )
    assert r.json()["name"] == "MAJU JAYA" and r.json()["slug"] == b["slug"]
    # Departments keep their case; only the spacing is tidied.
    d = await client.post(
        f"/api/branches/{b['id']}/departments", json={"name": "  Legal   Team "},
        headers=csrf(client),
    )  # fmt: skip
    assert d.status_code == 201 and d.json()["name"] == "Legal Team"
    # The import's companies step: capitals, and a company the office has is never added again.
    r = await client.post(
        "/api/members/import/companies", json={"names": ["kilang  baru sdn bhd", "Maju Jaya"]},
        headers=csrf(client),
    )  # fmt: skip
    assert r.json() == {"created": ["KILANG BARU SDN BHD"], "existing": ["MAJU JAYA"]}


async def test_the_cli_brings_old_names_to_capitals(client):
    await setup_owner(client)
    ws = await _ws_id()
    async with SessionLocal() as db:
        db.add_all([
            Branch(workspace_id=ws, name="Arena Wirajaya Sdn Bhd", slug="arena"),
            Branch(workspace_id=ws, name="SAFE ZONE SECURITY", slug="sz1"),
            Branch(workspace_id=ws, name="Safe Zone  Security", slug="sz2"),
            Branch(workspace_id=ws, name="UNIT HR", slug="hr"),
        ])  # fmt: skip
        await db.flush()
        b = await db.scalar(select(Branch).where(Branch.slug == "arena"))
        db.add(Department(workspace_id=ws, branch_id=b.id, name=" Guard  Operations", slug="g"))
        await db.commit()
    dry = await upper_names(ws, dry=True)
    assert dry["branches"] == [("Arena Wirajaya Sdn Bhd", "ARENA WIRAJAYA SDN BHD")]
    assert dry["clashes"] == [("Safe Zone  Security", "SAFE ZONE SECURITY")]
    assert dry["departments"] == [(" Guard  Operations", "Guard Operations")]
    async with SessionLocal() as db:
        names = set((await db.scalars(select(Branch.name))).all())
        assert "Arena Wirajaya Sdn Bhd" in names  # dry: nothing changed
    await upper_names(ws, dry=False)
    async with SessionLocal() as db:
        names = set((await db.scalars(select(Branch.name))).all())
        assert {"ARENA WIRAJAYA SDN BHD", "SAFE ZONE SECURITY", "Safe Zone  Security"} <= names
        assert await db.scalar(select(Department.name).where(Department.slug == "g")) == (
            "Guard Operations"
        )
        rows = (
            await db.scalars(select(AuditLog).where(AuditLog.actor == "system:upper_names"))
        ).all()
        assert len(rows) == 2
    again = await upper_names(ws, dry=False)
    assert again["branches"] == [] and again["departments"] == []


# ---------------------------------------------------------------- organizations in Prima


@pytest.fixture
def fake_prima(monkeypatch):
    """A fake Prima: the office's signed system lists, Part N4 (only the CEO adds a company,
    a draft), and the company record (refused without a valid SSM number)."""
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(prima, "_TOP", {})
    monkeypatch.setattr(autolink, "on", False)
    monkeypatch.setattr(org_link, "on", True)
    state: dict = {
        "companies": [
            {"id": "co-maju", "name": "Maju Sdn Bhd", "aliases": []},
            {"id": "pwvsb", "name": "PWVSB", "aliases": ["UNIT HR"]},
        ],
        "records": {
            "co-maju": {"name": "Maju Sdn Bhd", "ssmNo": "", "state": "Johor", "sourceRef": "x"},
        },
        "calls": [],
    }

    def handler(req: httpx.Request) -> httpx.Response:
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != want:
            return httpx.Response(401, json={"message": "bad signature"})
        state["calls"].append((req.method, url, h["x-office-user"], req.content))
        if url == "/api/office/staff":
            return httpx.Response(200, json=[
                {"id": "u-ceo", "name": "Chief", "title": "CEO", "role": "director",
                 "entraOid": None, "canSignIn": True, "top": "ceo"},
            ])  # fmt: skip
        if url == "/api/office/companies":
            return httpx.Response(200, json=state["companies"])
        if h["x-office-user"] != "u-ceo":
            return httpx.Response(403, json={"message": "Only the CEO adds a company."})
        if url == "/api/companies" and req.method == "POST":
            b = json.loads(req.content)
            if b["ssmNo"] == "BAD-1":
                return httpx.Response(400, json={"message": "SSM number BAD-1 is already on X."})
            cid = f"co-{b['code'].lower()}"
            state["records"][cid] = {"name": b["name"], "ssmNo": b["ssmNo"], "state": b["state"]}
            # Like Prima: a new company has no grants yet, so the office's list does not show it.
            return httpx.Response(201, json={"id": cid, "name": b["name"], "code": b["code"]})
        if url.startswith("/api/records/company/form?companyId="):
            cid = url.split("=", 1)[1]
            return httpx.Response(200, json={"values": dict(state["records"][cid])})
        if url == "/api/records/company" and req.method == "POST":
            b = json.loads(req.content)
            if not b["values"].get("ssmNo"):
                return httpx.Response(
                    400, json={"message": "Give a valid formatted SSM registration reference."}
                )
            state["records"][b["companyId"]].update(b["values"])
            return httpx.Response(201, json={"ok": True})
        return httpx.Response(404, json={"message": "not here"})

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    return state


def _posts(state: dict, path: str) -> list:
    return [c for c in state["calls"] if c[0] == "POST" and c[1] == path]


async def _row(client, branch_id: str) -> dict:
    d = (await client.get("/api/prima/companies")).json()
    return next(b for b in d["branches"] if b["id"] == branch_id)


async def test_a_new_organization_links_to_its_prima_company(client, fake_prima):
    await setup_owner(client)
    r = await client.post("/api/branches", json={"name": "maju sdn  bhd"}, headers=csrf(client))
    bid = r.json()["id"]
    row = await _row(client, bid)
    assert row["company_id"] == "co-maju" and row["link"]["state"] == "linked"
    assert not _posts(fake_prima, "/api/companies")  # never added twice
    # By Prima's other name ("UNIT HR" is PWVSB): linked, and a rename never touches PWVSB.
    r = await client.post("/api/branches", json={"name": "Unit  HR"}, headers=csrf(client))
    unit = r.json()["id"]
    assert (await _row(client, unit))["company_id"] == "pwvsb"
    await client.patch(f"/api/branches/{unit}", json={"name": "Unit HR HQ"}, headers=csrf(client))
    assert not _posts(fake_prima, "/api/records/company"), fake_prima["calls"]
    assert (await _row(client, unit))["link"]["state"] == "linked"
    async with SessionLocal() as db:
        rows = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "prima.company.linked"))
        ).all()
        assert len(rows) == 2


async def test_a_company_prima_lacks_is_added_as_the_ceo_with_its_ssm_details(client, fake_prima):
    await setup_owner(client)
    r = await client.post("/api/branches", json={"name": "Baru Security"}, headers=csrf(client))
    bid = r.json()["id"]
    row = await _row(client, bid)
    assert row["company_id"] is None and row["link"]["state"] == "not_linked"
    assert row["link"]["code"] == "details_needed" and "SSM" in row["link"]["message"]
    assert row["code_hint"] == "BS"
    assert not _posts(fake_prima, "/api/companies")  # no SSM details, nothing invented
    # In Malay too.
    ms = (await client.get("/api/prima/companies", headers={"x-lang": "ms"})).json()
    assert (
        "Prima belum ada syarikat bernama BARU SECURITY"
        in next(b for b in ms["branches"] if b["id"] == bid)["link"]["message"]
    )
    # Prima refuses (its own rule): the reason is shown, nothing is linked.
    r = await client.post(
        f"/api/prima/companies/{bid}/sync", json={"details": {**DETAILS, "ssm_no": "BAD-1"}},
        headers=csrf(client),
    )  # fmt: skip
    assert r.json()["outcome"] == "refused" and r.json()["company_id"] is None
    assert r.json()["link"]["message"] == "SSM number BAD-1 is already on X."
    # Bad details never reach Prima.
    r = await client.post(
        f"/api/prima/companies/{bid}/sync", json={"details": {**DETAILS, "ssm_no": "1"}},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 422
    r = await client.post(
        f"/api/prima/companies/{bid}/sync", json={"details": DETAILS}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == "made" and r.json()["company_id"] == "co-bs"
    method, url, user, body = _posts(fake_prima, "/api/companies")[-1]
    sent = json.loads(body)
    assert user == "u-ceo" and sent["name"] == "BARU SECURITY" and sent["code"] == "BS"
    assert sent["ssmNo"] == DETAILS["ssm_no"] and sent["reason"] == DETAILS["reason"]
    # Linked although Prima's list for the office does not show it yet (no grants there).
    row = await _row(client, bid)
    assert row["company_id"] == "co-bs" and row["link"] == {
        "state": "linked", "code": "made", "message": "", "made": True,
    }  # fmt: skip
    again = await client.post(f"/api/prima/companies/{bid}/sync", json={}, headers=csrf(client))
    assert again.json()["outcome"] == "already"
    assert len(_posts(fake_prima, "/api/companies")) == 2  # the refused one and this one
    async with SessionLocal() as db:
        made = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "prima.company.made"))
        ).all()
        recorded = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "prima.recorded"))
        ).all()
        assert len(made) == 1 and made[0].after == {"company": "co-bs", "code": "BS"}
        assert len(recorded) == 2 and all(r.actor.startswith("user:") for r in recorded)
        ws = await db.get(Workspace, await _ws_id())
        assert prima.company_map(ws)[bid] == "co-bs"
    # A rename follows to Prima's company record (its own, SSM number given).
    r = await client.patch(
        f"/api/branches/{bid}", json={"name": "Baru Security Services"}, headers=csrf(client)
    )
    assert r.json()["name"] == "BARU SECURITY SERVICES"
    assert fake_prima["records"]["co-bs"]["name"] == "BARU SECURITY SERVICES"
    assert (await _row(client, bid))["link"]["state"] == "linked"


async def test_a_rename_prima_refuses_shows_and_can_be_retried(client, fake_prima):
    await setup_owner(client)
    r = await client.post("/api/branches", json={"name": "Maju Sdn Bhd"}, headers=csrf(client))
    bid = r.json()["id"]
    # A change of case only is not a rename: Prima is not asked.
    await client.patch(f"/api/branches/{bid}", json={"name": "maju sdn bhd"}, headers=csrf(client))
    assert not _posts(fake_prima, "/api/records/company"), fake_prima["calls"]
    await client.patch(
        f"/api/branches/{bid}", json={"name": "Maju Holdings Sdn Bhd"}, headers=csrf(client)
    )
    assert len(_posts(fake_prima, "/api/records/company")) == 1
    row = await _row(client, bid)
    assert row["company_id"] == "co-maju" and row["link"]["state"] == "name_differs"
    assert row["link"]["message"] == "Give a valid formatted SSM registration reference."
    assert fake_prima["records"]["co-maju"]["name"] == "Maju Sdn Bhd"
    # Prima's record gets its SSM number (in Prima); the retry then goes through.
    fake_prima["records"]["co-maju"]["ssmNo"] = "201901012345"
    r = await client.post(f"/api/prima/companies/{bid}/sync", json={}, headers=csrf(client))
    assert r.json()["outcome"] == "renamed" and r.json()["link"]["state"] == "linked"
    assert fake_prima["records"]["co-maju"]["name"] == "MAJU HOLDINGS SDN BHD"


async def test_only_who_manages_the_organization_adds_to_prima(client, fake_prima):
    o = await setup_owner(client)  # noqa: F841
    r = await client.post("/api/branches", json={"name": "Baru Security"}, headers=csrf(client))
    bid = r.json()["id"]
    m = await member(client, "staff1@example.com", "staff", branch_id=bid)
    c = await signed_in("staff1@example.com", m["temp_password"])
    try:
        r = await c.post(
            f"/api/prima/companies/{bid}/sync", json={"details": DETAILS}, headers=csrf(c)
        )
        assert r.status_code == 403
    finally:
        await c.aclose()
    # The office's own check: someone who does not open Prima as the CEO is refused before
    # Prima is asked (Prima refuses them too: only the CEO adds a company).
    ws = await _ws_id()
    async with SessionLocal() as db:
        staff = await db.scalar(select(User).where(User.email == "staff1@example.com"))
        assert (await db.get(Membership, (ws, staff.id))).role == "staff"
        b = await db.get(Branch, bid)
        out = await org_link.link(
            db, ws, b, actor="test", actor_user_id=staff.id, details=org_link.Details(
                ssm_no="202601001111", state="Johor", source_ref="SSM (mock)", reason="mock",
            ),
        )  # fmt: skip
        assert out == "not_ceo"
    assert not _posts(fake_prima, "/api/companies")
    row = await _row(client, bid)
    assert row["link"]["code"] == "not_ceo" and "owner or admin" in row["link"]["message"]
    # Another office's branch: refused.
    r = await client.post("/api/prima/companies/br_nowhere/sync", json={}, headers=csrf(client))
    assert r.status_code == 404


async def test_prima_down_never_holds_up_the_create(client, fake_prima, monkeypatch):
    await setup_owner(client)

    def down(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(down))
    r = await client.post("/api/branches", json={"name": "Baru Security"}, headers=csrf(client))
    assert r.status_code == 201 and r.json()["name"] == "BARU SECURITY"
    ws = await _ws_id()
    async with SessionLocal() as db:
        st = org_link.states(await db.get(Workspace, ws))[r.json()["id"]]
        assert st["state"] == "not_linked" and st["code"] == "prima_down"


async def test_the_backfill_links_by_name_and_lists_the_rest(client, fake_prima):
    await setup_owner(client)
    ws = await _ws_id()
    async with SessionLocal() as db:
        db.add_all([
            Branch(workspace_id=ws, name="Maju Sdn Bhd", slug="maju"),
            Branch(workspace_id=ws, name="JA GROUP", slug="ja"),
        ])  # fmt: skip
        await db.commit()
    dry = await org_link_all.link_all(ws, dry=True)
    assert dict(dry) == {"matched": ["Maju Sdn Bhd"], "details_needed": ["JA GROUP"]}
    async with SessionLocal() as db:
        assert prima.company_map(await db.get(Workspace, ws)) == {}
    out = await org_link_all.link_all(ws, dry=False)
    assert dict(out) == {"matched": ["Maju Sdn Bhd"], "details_needed": ["JA GROUP"]}
    again = await org_link_all.link_all(ws, dry=False)
    assert dict(again) == {"already": ["Maju Sdn Bhd"], "details_needed": ["JA GROUP"]}
    assert not _posts(fake_prima, "/api/companies")  # never adds without SSM details
