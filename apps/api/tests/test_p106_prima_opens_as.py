"""P106: the developer opens Prima as the CEO record (the default) or as their own Prima account
(migration 0066), so they can prepare loads someone else OKs; a Prima department per member
(transport, procurement, hr) for their own Prima account; and the two-person check the office
keeps across the switch (nobody OKs through the shared record what they made themselves).

Fitri (owner and developer, 16 Nov 2026): "give it to me first developer and make it I can custom
add it as well. and then me and fauzan give you permission to load the data inside."
A fake Prima stands in (as test_p66_prima.py), with load receipts and staff directory batches."""

import hashlib
import hmac
import json

import httpx
import pytest
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, PrimaLink, User
from agentic.prima import autolink, org_link
from agentic.prima import client as prima
from agentic.prima import client as prima_client

from .conftest import csrf
from .test_agents import office
from .test_office_roles import member, signed_in

SECRET = "o" * 40
COMPANIES = [{"id": "co-maju", "name": "Maju Sdn Bhd"}]
CEO = {"id": "u-ceo", "name": "Fauzan", "title": "CEO", "role": "director",
       "entraOid": None, "canSignIn": True, "top": "ceo"}  # fmt: skip
OTHER = {"id": "u-hr", "name": "Hana HR", "title": "HR", "role": "pwvsb_officer",
         "entraOid": None, "canSignIn": True, "department": "hr"}  # fmt: skip


class FakePrima:
    """Prima as the office sees it: staff, companies, the accounts service, /api/me, the bulk
    load receipts (a person sees their own; the CEO all, by name only) and the staff directory
    board (HR and the CEO see it; batches say ownBatch for their preparer)."""

    def __init__(self) -> None:
        self.seen: list[httpx.Request] = []
        self.made: dict[str, dict] = {}
        self.loads: list[dict] = []  # {"id", "byId", "by"}
        self.batches: list[dict] = []  # {"id", "preparedById", "preparedBy"}
        self.down = False

    def accounts(self) -> list[dict]:
        return [json.loads(r.content) for r in self.seen if r.url.host == "prima-accounts"]

    def records(self) -> list[dict]:
        return [CEO, OTHER, *self.made.values()]

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.seen.append(req)
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != want:
            return httpx.Response(401, json={"message": "bad signature"})
        if req.url.host == "prima-accounts":
            assert url == "/accounts" and h["x-office-via"] == "system"
            body = json.loads(req.content)
            if body.get("department") == "hr" and body["role"] != "pwvsb_officer":
                return httpx.Response(400, json={"message": "hr must be central staff"})
            rid = "u-off-" + body["officeUserId"]
            self.made[rid] = {"id": rid, "name": body["name"], "title": body["title"],
                              "role": body["role"], "companyIds": body["companyIds"],
                              "entraOid": None, "canSignIn": True,
                              **({"department": body["department"]}
                                 if body.get("department") else {})}  # fmt: skip
            return httpx.Response(200, json={**self.made[rid], "created": True, "closed": False})
        if url == "/api/office/staff":
            return httpx.Response(200, json=self.records())
        if url == "/api/office/companies":
            return httpx.Response(200, json=COMPANIES)
        who = next((s for s in self.records() if s["id"] == h["x-office-user"]), None)
        if who is None:
            return httpx.Response(403, json={"message": "no such record"})
        ceo = who["id"] == "u-ceo"
        if self.down and req.method == "GET" and url != "/api/me":
            return httpx.Response(503, json={"message": "down"})
        if url == "/api/me":
            return httpx.Response(200, json={"user": who})
        if url == "/api/org/import-loads" and req.method == "GET":
            rows = [x for x in self.loads if ceo or x["byId"] == who["id"]]
            return httpx.Response(
                200, json={"gate": True, "canOk": ceo, "loads": [
                    {"id": x["id"], "by": x["by"], "mayOk": ceo and x["byId"] != who["id"]}
                    for x in rows
                ]},
            )  # fmt: skip
        if url == "/api/staff-directory" and req.method == "GET":
            if not ceo and who.get("department") != "hr":
                return httpx.Response(403, json={"message": "Only HR sees the directory."})
            return httpx.Response(
                200, json={"batches": [
                    {"id": b["id"], "preparedBy": b["preparedBy"],
                     "ownBatch": b["preparedById"] == who["id"]}
                    for b in self.batches
                ]},
            )  # fmt: skip
        return httpx.Response(
            200, json={"ok": True, "as": who["id"], "url": url, "body": req.content.decode()}
        )


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(settings, "prima_accounts_url", "http://prima-accounts:3100")
    f = FakePrima()
    monkeypatch.setattr(prima, "transport", httpx.MockTransport(f.handler))
    monkeypatch.setattr(prima, "_TOP", {})
    monkeypatch.setattr(autolink, "on", False)  # P109: these check the link made on first open
    monkeypatch.setattr(org_link, "on", False)  # P111: these set the company map by hand
    return f


async def _ids(email: str) -> tuple[str, str]:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        return user.id, m.workspace_id


async def _developer(client) -> tuple[str, str, dict]:
    """The owner of a one-branch office, marked developer, the branch mapped to co-maju."""
    o = await office(client)
    r = await client.put(
        "/api/prima/companies", json={"companies": {o["branch"]["id"]: "co-maju"}},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        u.is_developer = True  # what python -m agentic.admin make-developer sets
        await db.commit()
    uid, ws = await _ids("owner@example.com")
    return uid, ws, o


async def _put(c, **body):
    return await c.put("/api/prima/opens-as", json=body, headers=csrf(c))


async def _audits(action: str) -> list[AuditLog]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
                )
            ).all()
        )


async def _post(c, path: str, body: dict):
    return await c.post(
        f"/api/prima/{path}", content=json.dumps(body).encode(),
        headers={**csrf(c), "content-type": "application/json"},
    )  # fmt: skip


# ---------------------------------------------------------------- the switch


async def test_the_developer_switches_between_the_ceo_record_and_their_own_account(client, fake):
    uid, ws, _ = await _developer(client)
    own = f"u-off-{uid}"

    # Today's behaviour is the default: the CEO record, which Prima's web shows as such.
    d = (await client.get("/api/prima/opens-as")).json()
    assert d["can_choose"] and d["opens_as"] == "top" and d["account"] is None
    assert d["departments"] == list(prima_client.PRIMA_DEPARTMENTS)  # P125: every office department
    me = (await client.get("/api/prima/api/me")).json()
    assert me["user"]["id"] == "u-ceo" and me["office"]["asTop"] is True
    assert fake.accounts() == []

    # Own account, in procurement (the Goodwill item import): made at once, central staff.
    r = await _put(client, opens_as="own", department="procurement")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["opens_as"] == "own" and d["department"] == "procurement"
    assert d["account"] == {"id": own, "name": "Owner One", "department": "procurement"}
    acc = fake.accounts()
    assert len(acc) == 1 and acc[0]["role"] == "pwvsb_officer"
    assert acc[0]["department"] == "procurement" and acc[0]["companyIds"] == ["co-maju"]
    me = (await client.get("/api/prima/api/me")).json()
    assert me["user"]["id"] == own
    # P101: she is herself in Prima now: not the shared record, and her own name.
    assert me["office"]["asTop"] is False and me["office"]["name"] == "Owner One"
    assert (await client.get("/api/prima/api/items")).json()["as"] == own
    async with SessionLocal() as db:
        assert (await prima.link_for(db, ws, uid)).prima_user_id == own

    # Saying the same again changes nothing: no new account call, no new audit row.
    r = await _put(client, opens_as="own", department="procurement")
    assert r.status_code == 200 and len(fake.accounts()) == 1
    assert len(await _audits("prima.opens_as")) == 1

    # The staff directory needs HR: the same account, now in hr.
    r = await _put(client, opens_as="own", department="hr")
    assert r.json()["account"]["department"] == "hr"
    assert fake.accounts()[-1]["department"] == "hr" and fake.made[own]["department"] == "hr"

    # Back to the CEO record: her own account is kept (for next time and the two-person check).
    r = await _put(client, opens_as="top", department="hr")
    assert r.json()["opens_as"] == "top" and r.json()["account"]["id"] == own
    me = (await client.get("/api/prima/api/me")).json()
    assert me["user"]["id"] == "u-ceo" and me["office"]["asTop"] is True
    async with SessionLocal() as db:
        assert (await prima.link_for(db, ws, uid)).prima_user_id == "u-ceo"
        assert (await db.get(PrimaLink, (ws, uid))).prima_user_id == own
    n = len(fake.accounts())
    assert (await _put(client, opens_as="top", department="hr")).status_code == 200
    # And to her own account again: the account is there, nothing to remake.
    assert (await _put(client, opens_as="own", department="hr")).json()["opens_as"] == "own"
    assert len(fake.accounts()) == n

    # Every switch is in the office's audit log: who, from, to.
    rows = await _audits("prima.opens_as")
    assert [(r.before, r.after) for r in rows] == [
        ({"opens_as": "top", "department": None}, {"opens_as": "own", "department": "procurement"}),
        ({"opens_as": "own", "department": "procurement"}, {"opens_as": "own", "department": "hr"}),
        ({"opens_as": "own", "department": "hr"}, {"opens_as": "top", "department": "hr"}),
        ({"opens_as": "top", "department": "hr"}, {"opens_as": "own", "department": "hr"}),
    ]  # fmt: skip
    assert {r.actor for r in rows} == {f"user:{uid}"} and {r.target for r in rows} == {uid}

    # The Members > Access line for her says how she opens Prima.
    w = (await client.get(f"/api/members/{uid}/prima")).json()
    assert "own account" in w["where"]


async def test_only_the_developer_chooses(client, fake):
    o = await office(client)
    await client.put(
        "/api/prima/companies", json={"companies": {o["branch"]["id"]: "co-maju"}},
        headers=csrf(client),
    )  # fmt: skip
    # An owner who is not the developer: neither reads nor sets it.
    assert (await client.get("/api/prima/opens-as")).status_code == 403
    r = await _put(client, opens_as="own", department="procurement")
    assert r.status_code == 403
    staff = await member(client, "siti@example.com", "staff", branch_id=o["branch"]["id"])
    c = await signed_in("siti@example.com", staff["temp_password"])
    try:
        assert (await _put(c, opens_as="own")).status_code == 403
        assert (await c.get("/api/prima/opens-as")).status_code == 403
    finally:
        await c.aclose()
    # Someone who was set "own" and is no longer the developer opens the CEO record again.
    uid, ws = await _ids("owner@example.com")
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        m.prima_opens_as = "own"
        await db.commit()
    async with SessionLocal() as db:
        assert (await prima.link_for(db, ws, uid)).prima_user_id == "u-ceo"
    assert fake.accounts() == [] and await _audits("prima.opens_as") == []

    # The developer: a department outside the list is refused, before anything is made.
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        u.is_developer = True
        await db.commit()
    r = await _put(client, opens_as="own", department="director_office")  # P125: never offered
    assert r.status_code == 422 and fake.accounts() == []


async def test_a_problem_making_the_account_keeps_the_ceo_record(client, fake):
    """No company for her branch: the switch is refused with the plain reason, nothing saved."""
    await office(client)
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        u.is_developer = True
        await db.commit()
    r = await _put(client, opens_as="own", department="procurement")
    assert r.status_code == 403 and r.json()["code"] == "company_needed"
    d = (await client.get("/api/prima/opens-as")).json()
    assert d["opens_as"] == "top" and d["department"] is None
    assert await _audits("prima.opens_as") == []


# ---------------------------------------------------------------- a Prima department per member


async def test_members_access_gives_a_prima_department_hr_included(client, fake):
    o = await office(client)
    bid = o["branch"]["id"]
    await client.put(
        "/api/prima/companies", json={"companies": {bid: "co-maju"}}, headers=csrf(client)
    )
    siti = await member(client, "siti@example.com", "staff", branch_id=bid)
    await member(client, "boss@example.com", "branch_manager", branch_id=bid)
    siti_id, ws = await _ids("siti@example.com")
    boss_id, _ = await _ids("boss@example.com")
    owner_id, _ = await _ids("owner@example.com")

    r = await client.put(
        f"/api/members/{siti_id}/prima-access", json={"prima_department": "hr"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    assert r.json()["prima_department"] == "hr"
    rows = await _audits("member.prima_access")
    assert rows[-1].before["prima_department"] is None
    assert rows[-1].after["prima_department"] == "hr"
    # HR is central staff only: never a branch manager (admin_exec in Prima).
    r = await client.put(
        f"/api/members/{boss_id}/prima-access", json={"prima_department": "hr"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 400 and r.json()["code"] == "prima_hr_central_only"
    r = await client.put(
        f"/api/members/{boss_id}/prima-access", json={"prima_department": "transport"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200 and r.json()["prima_department"] == "transport"
    r = await client.put(
        f"/api/members/{boss_id}/prima-access", json={"prima_department": "director_office"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 422
    # Owners (the developer is one) set their own on the Prima page, never here.
    r = await client.put(
        f"/api/members/{owner_id}/prima-access", json={"prima_department": "hr"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 400

    # Siti opens Prima: her own account is made in hr.
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, siti_id))
        m.ms_oid = "0a0a0a0a-0000-4000-8000-0000000001b1"
        await db.commit()
    c = await signed_in("siti@example.com", siti["temp_password"])
    try:
        assert (await c.get("/api/prima/api/leave")).json()["as"] == f"u-off-{siti_id}"
    finally:
        await c.aclose()
    assert fake.accounts()[-1]["department"] == "hr"
    assert fake.accounts()[-1]["role"] == "pwvsb_officer"

    # A change in Members > Access reaches her account the next time she opens Prima, once.
    r = await client.patch(
        f"/api/members/{siti_id}", json={"prima_department": "procurement"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["prima_department"] == "procurement"
    async with SessionLocal() as db:
        await prima.link_for(db, ws, siti_id)
        await prima.link_for(db, ws, siti_id)
        assert (await db.get(PrimaLink, (ws, siti_id))).department == "procurement"
    assert [a.get("department") for a in fake.accounts()] == ["hr", "procurement"]
    rows = await _audits("prima.department")
    assert len(rows) == 1 and rows[0].before["department"] == "hr"
    assert rows[0].after["department"] == "procurement"
    # None: the account leaves the department.
    await client.put(
        f"/api/members/{siti_id}/prima-access", json={"prima_department": None},
        headers=csrf(client),
    )  # fmt: skip
    async with SessionLocal() as db:
        await prima.link_for(db, ws, siti_id)
    assert "department" not in fake.accounts()[-1]

    # Added with a department from the start.
    r = await client.post(
        "/api/members",
        json={"email": "rina@example.com", "name": "Rina", "role": "staff", "branch_id": bid,
              "prima_department": "transport"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 201 and r.json()["member"]["prima_department"] == "transport"


# ---------------------------------------------------------------- two people, across the switch


async def test_nobody_oks_through_the_ceo_record_what_they_loaded_themselves(client, fake):
    uid, ws, o = await _developer(client)
    own = f"u-off-{uid}"
    assert (await _put(client, opens_as="own", department="hr")).status_code == 200
    # What she loaded and prepared with her own account, and what others did.
    fake.loads = [
        {"id": "oimp-1", "byId": own, "by": "Owner One"},
        {"id": "oimp-2", "byId": "u-hr", "by": "Hana HR"},
    ]
    fake.batches = [
        {"id": "sdb-1", "preparedById": own, "preparedBy": "Owner One"},
        {"id": "sdb-2", "preparedById": "u-hr", "preparedBy": "Hana HR"},
    ]
    assert (await _put(client, opens_as="top", department="hr")).status_code == 200

    # Through the CEO record she cannot OK her own load nor approve her own batch...
    r = await _post(client, "api/org/import-loads/oimp-1/ok", {"comment": "fine"})
    assert r.status_code == 403 and r.json()["code"] == "own_work"
    assert r.json()["message"].startswith("Someone else must OK what you loaded.")
    r = await _post(client, "api/staff-directory/decide", {"batchId": "sdb-1", "approve": True})
    assert r.status_code == 403 and r.json()["code"] == "own_work"
    assert not any(q.method == "POST" and q.url.path.endswith("/ok") for q in fake.seen)
    # ...but she may for someone else's.
    r = await _post(client, "api/org/import-loads/oimp-2/ok", {"comment": "fine"})
    assert r.status_code == 200 and r.json()["as"] == "u-ceo"
    r = await _post(client, "api/staff-directory/decide", {"batchId": "sdb-2", "approve": True})
    assert r.status_code == 200 and r.json()["as"] == "u-ceo"

    # Her account out of HR cannot read the board: who prepared it is found by name instead.
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        await prima.set_opens_as(db, m, "top", "procurement", f"user:{uid}")
        m = await db.get(Membership, (ws, uid))
        await prima.set_opens_as(db, m, "own", "procurement", f"user:{uid}")
        await prima.set_opens_as(db, m, "top", "procurement", f"user:{uid}")
    assert fake.made[own]["department"] == "procurement"
    r = await _post(client, "api/staff-directory/decide", {"batchId": "sdb-1", "approve": True})
    assert r.status_code == 403 and r.json()["code"] == "own_work"

    # Fauzan (another owner, never had an own account) OKs her load: two people.
    fauzan = await member(client, "fauzan@example.com", "owner")
    c = await signed_in("fauzan@example.com", fauzan["temp_password"])
    try:
        r = await _post(c, "api/org/import-loads/oimp-1/ok", {"comment": "Reviewed, OK"})
        assert r.status_code == 200 and r.json()["as"] == "u-ceo"
        r = await _post(c, "api/staff-directory/decide", {"batchId": "sdb-1", "approve": True})
        assert r.status_code == 200
    finally:
        await c.aclose()

    # Prima not answering the check is a refusal, never a yes.
    fake.down = True
    r = await _post(client, "api/org/import-loads/oimp-2/ok", {"comment": "fine"})
    assert r.status_code == 503
    fake.down = False

    # In her own account mode the calls go as her own account: Prima's own rules refuse there.
    assert (await _put(client, opens_as="own", department="procurement")).status_code == 200
    r = await _post(client, "api/org/import-loads/oimp-1/ok", {"comment": "fine"})
    assert r.status_code == 200 and r.json()["as"] == own
