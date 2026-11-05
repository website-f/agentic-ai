"""P66/P67: Prima Secure inside the office. Its screens call /api/prima/... with the office
session, and its AI works in it for the person who asked (in chat, or who gave the task), both
signed for that person's linked Prima staff record (agentic/prima) and checked by Prima
(apps/prima/apps/api/src/office.ts). People link themselves by their Microsoft account, or the
owner links them in one click; nobody runs a script."""

import hashlib
import hmac
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import policy
from agentic.agents.runtime import offered_tools
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import Agent, Membership, PrimaLink, Task, User, Workspace
from agentic.prima import client as prima
from agentic.prima import routes
from agentic.prima.client import PrimaError, StaffRecord
from agentic.prima.people import Person, name_key, suggestions

from .conftest import csrf
from .test_agents import new_agent, new_task, office
from .test_office_roles import member

SECRET = "o" * 40
OID = "0a0a0a0a-0000-4000-8000-000000000001"
OWNER_OID = "0a0a0a0a-0000-4000-8000-0000000000aa"  # recorded on no Prima record
COMPANIES = [{"id": "co-maju", "name": "Maju Sdn Bhd"}, {"id": "co-lain", "name": "Lain Security"}]
PRIMA_SRC = Path(__file__).resolve().parents[2] / "prima" / "apps" / "api" / "src"
STAFF = [
    {
        "id": "u-owner",
        "name": "Owner One",
        "title": "CEO",
        "role": "director",
        "entraOid": None,
        "canSignIn": True,
    },  # noqa: E501
    {
        "id": "u-aina",
        "name": "Aina Binti Ali",
        "title": "HR",
        "role": "company_hr",
        "entraOid": OID,
        "canSignIn": True,
    },  # noqa: E501
    {
        "id": "u-ahmad-1",
        "name": "Ahmad",
        "title": "Guard",
        "role": "guard",
        "entraOid": None,
        "canSignIn": False,
    },  # noqa: E501
    {
        "id": "u-ahmad-2",
        "name": "Ahmad",
        "title": "Driver",
        "role": "staff",
        "entraOid": None,
        "canSignIn": True,
    },  # noqa: E501
]


@pytest.fixture
def prima_on(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(settings, "prima_accounts_url", "http://prima-accounts:3100")
    seen: list[httpx.Request] = []
    made: dict[str, dict] = {}  # P75: accounts the accounts service made

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != want:
            return httpx.Response(401, json={"message": "bad signature"})
        if req.url.host == "prima-accounts":
            # P75: Prima's accounts service takes only the office's own system call.
            assert url == "/accounts" and req.method == "POST"
            assert h["x-office-via"] == "system" and h["x-office-user"] == ""
            body = json.loads(req.content)
            rid = "u-off-" + body["officeUserId"]
            made[rid] = {"id": rid, "name": body["name"], "title": body["title"],
                         "role": body["role"], "companyIds": body["companyIds"],
                         "entraOid": None, "canSignIn": True}  # fmt: skip
            return httpx.Response(200, json={**made[rid], "created": True, "closed": False})
        if url == "/api/office/staff":
            assert h["x-office-via"] == "system" and h["x-office-user"] == ""
            return httpx.Response(200, json=[*STAFF, *made.values()])
        if url == "/api/office/companies":
            assert h["x-office-via"] == "system" and h["x-office-user"] == ""
            return httpx.Response(200, json=COMPANIES)
        who = next((s for s in [*STAFF, *made.values()] if s["id"] == h["x-office-user"]), None)
        if who is None:
            return httpx.Response(403, json={"message": "no such record"})
        if url == "/api/me":
            return httpx.Response(200, json={"user": who, "companies": [{"id": "co-1"}]})
        if url.startswith("/api/staff-pay") and who["role"] != "company_hr":
            return httpx.Response(403, json={"message": "Only HR runs payroll."})
        return httpx.Response(
            200, json={"ok": True, "as": who["id"], "url": url, "body": req.content.decode()}
        )

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    return seen


async def _ids(email: str) -> tuple[str, str]:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        return user.id, m.workspace_id


async def _microsoft(email: str, oid: str = OID) -> None:
    """What Sign in with Microsoft records (P66)."""
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))
        m = await db.scalar(select(Membership).where(Membership.user_id == user.id))
        m.ms_oid, m.ms_tenant_id = oid, "11111111-2222-3333-4444-555555555555"
        await db.commit()


def test_signs_as_prima_checks():
    """The same test vector as apps/prima/apps/api/test/office.test.ts."""
    old = settings.prima_secret
    settings.prima_secret = SECRET
    try:
        sig = prima.sign(
            "2026-11-06T01:00:00.000Z", "post", "/api/leave?x=1", "u-it-lead",
            "agent:Chief of Staff", b'{"a":1}',
        )  # fmt: skip
    finally:
        settings.prima_secret = old
    assert sig == "14c37adaea8d43fab8a6148b0e1dc0d7b9d30d778830b813ac1421e39c621b60"


@pytest.mark.skipif(not PRIMA_SRC.is_dir(), reason="apps/prima not in this checkout")
def test_the_catalog_is_prima_s_api():
    built = routes.build(PRIMA_SRC)
    kept = json.loads((Path(routes.__file__).with_name("routes.json")).read_text(encoding="utf-8"))
    assert built == kept, (
        "Run: python -m agentic.prima.routes ../prima/apps/api/src > agentic/prima/routes.json"
    )  # noqa: E501
    paths = {(r["method"], r["path"]) for r in kept}
    assert ("GET", "api/leave") in paths and ("POST", "api/claims") in paths
    assert ("GET", "api/staff-pay") in paths and ("GET", "api/companies/:id/attendance") in paths
    # The signed feeds, the office's own staff list and development sign-in are never offered.
    assert not any(
        str(p).startswith(("api/integrations", "api/auth/dev-login", "api/office/"))
        for _, p in paths
    )
    assert routes.find("apply leave")[0]["path"].startswith("api/leave")


def test_only_prima_s_own_addresses():
    assert prima.clean_path("api/leave", "x=1&y=a%20b") == "/api/leave?x=1&y=a%20b"
    for bad in ("api/../x", "etc/passwd", "api//x", "api/leave?x=1", "api/x y"):
        with pytest.raises(PrimaError):
            prima.clean_path(bad)
    for closed in ("api/integrations/ja/v1/staff", "api/auth/dev-login", "api/office/staff"):
        with pytest.raises(PrimaError) as e:
            prima.clean_path(closed)
        assert e.value.status == 403
    with pytest.raises(PrimaError):
        prima.clean_path("api/leave", "x=<script>")


def test_suggestions_pick_only_a_sure_match():
    rec = [
        StaffRecord(s["id"], s["name"], s["title"], s["role"], s["entraOid"], s["canSignIn"])
        for s in STAFF
    ]
    people = [
        Person("us-1", "Owner  One", "o@x", "owner", None, None),  # same name, other spacing
        Person("us-2", "Someone Else", "a@x", "staff", OID, None),  # IT recorded it on Aina
        Person("us-3", "Ahmad", "h@x", "staff", None, None),  # two Prima records named Ahmad
    ]
    assert suggestions(people, rec) == {"us-1": "u-owner", "us-2": "u-aina"}
    # P74: the office's owner opens Prima as its top record (the CEO's), whatever their name;
    # a second owner gets the COO's; nobody else ever gets them.
    ceo = StaffRecord("u-ceo", "Fauzan", "CEO", "director", None, True, top="ceo")
    coo = StaffRecord("u-coo", "Ahmad Faisal", "COO", "director", None, True, top="coo")
    owners = [
        Person("us-o1", "Fitri", "f@x", "owner", None, None),
        Person("us-o2", "Siti", "s@x", "owner", None, None),
        Person("us-s", "Staff One", "x@x", "staff", None, None),
    ]
    got = suggestions(owners, [*rec, ceo, coo])
    assert got["us-o1"] == "u-ceo" and got["us-o2"] == "u-coo" and "us-s" not in got
    assert name_key("Mohd. Fauzan  bin Ali") == name_key("mohd fauzan bin ali")


async def test_people_link_themselves_by_microsoft_or_the_owner_links_them(client, prima_on):
    o = await office(client)
    aina = await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    assert aina
    owner_id, ws = await _ids("owner@example.com")
    aina_id, _ = await _ids("aina@example.com")

    # The owner's page before anyone opened Prima: everyone, Prima's records, the sure picks.
    d = (await client.get("/api/prima/people")).json()
    rows = {p["user_id"]: p for p in d["people"]}
    assert rows[owner_id]["suggestion"] == "u-owner" and rows[aina_id]["suggestion"] is None
    assert {r["id"] for r in d["staff"]} == {s["id"] for s in STAFF}

    # P70: Prima and the office are one: not connected to Microsoft yet, Prima asks for that
    # first, and nothing is sent as anyone.
    n = len(prima_on)
    s = (await client.get("/api/prima/status")).json()
    assert s["needs_microsoft"] and not s["linked"] and "Connect your Microsoft" in s["problem"]
    r = await client.get("/api/prima/api/me")
    assert r.status_code == 403 and r.json()["code"] == "microsoft_needed"
    assert len(prima_on) == n

    # Connected (another Microsoft account than any IT recorded in Prima): the only record with
    # their exact name is theirs, so they are in at once, with no click and no second sign-in.
    await _microsoft("owner@example.com", OWNER_OID)
    s = (await client.get("/api/prima/status")).json()
    assert s["linked"] and s["me"]["name"] == "Owner One"
    async with SessionLocal() as db:
        assert (await db.get(PrimaLink, (ws, owner_id))).how == "name"
    r = await client.get("/api/prima/api/leave?status=waiting")
    assert r.json()["as"] == "u-owner" and r.json()["url"] == "/api/leave?status=waiting"
    assert prima_on[-1].headers["x-office-via"] == "person"
    assert prima_on[-1].headers["x-forwarded-for"]

    # Aina has not connected Microsoft: asked to, before anything else.
    async with SessionLocal() as db:
        with pytest.raises(PrimaError) as e:
            await prima.link_for(db, ws, aina_id)
        assert e.value.code == "microsoft_needed"
    r = await client.post("/api/prima/people/link-suggested", json={}, headers=csrf(client))
    assert r.json() == {"linked": 0}

    # Aina signs in with Microsoft and IT recorded that account in Prima: linked by itself.
    await _microsoft("aina@example.com")
    async with SessionLocal() as db:
        link = await prima.link_for(db, ws, aina_id)
        assert (link.prima_user_id, link.how) == ("u-aina", "microsoft")

    # The owner can change or clear any link; one record is never two people.
    bad = await client.post(
        "/api/prima/people/link", json={"user_id": owner_id, "prima_user_id": "u-aina"},
        headers=csrf(client),
    )  # fmt: skip
    assert bad.status_code == 409
    r = await client.post(
        "/api/prima/people/link", json={"user_id": aina_id, "prima_user_id": None},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200
    async with SessionLocal() as db:
        assert await db.get(PrimaLink, (ws, aina_id)) is None


async def test_only_the_owner_links_people(client, prima_on):
    o = await office(client)
    m = await member(client, "staff1@example.com", "staff", branch_id=o["branch"]["id"])
    from .test_office_roles import signed_in

    c = await signed_in("staff1@example.com", m["temp_password"])
    try:
        assert (await c.get("/api/prima/people")).status_code == 403
        r = await c.post("/api/prima/people/link-suggested", json={}, headers=csrf(c))
        assert r.status_code == 403
    finally:
        await c.aclose()


async def test_prima_screens_through_the_office(client, prima_on):
    await office(client)
    await _microsoft("owner@example.com", OWNER_OID)
    await client.post("/api/prima/people/link-suggested", json={}, headers=csrf(client))

    # Writes carry the office's CSRF token, like every other screen, and the exact body.
    r = await client.post("/api/prima/api/leave", json={"days": 2})
    assert r.status_code == 403
    r = await client.post(
        "/api/prima/api/leave",
        content=b'{"days":2}',
        headers={**csrf(client), "content-type": "application/json"},
    )  # noqa: E501
    assert r.status_code == 200 and r.json()["body"] == '{"days":2}'

    # Prima's own refusal comes back as it is; closed parts never reach it.
    r = await client.get("/api/prima/api/staff-pay")
    assert r.status_code == 403 and r.json()["message"] == "Only HR runs payroll."
    n = len(prima_on)
    for closed in ("/api/prima/api/integrations/ja/v1/staff", "/api/prima/api/office/staff"):
        r = await client.get(closed)
        assert r.status_code == 403
    assert len(prima_on) == n

    client.cookies.clear()
    assert (await client.get("/api/prima/api/me")).status_code == 401


async def test_not_set_up_means_no_prima(client, monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "")
    await office(client)
    s = (await client.get("/api/prima/status")).json()
    assert s == {
        "enabled": False, "running": False, "linked": False, "me": None, "problem": "",
        "needs_microsoft": False,
    }  # fmt: skip
    assert (await client.get("/api/prima/api/me")).status_code == 404


async def _ctx(db, agent_id: str, person: str | None, task: Task | None = None) -> ToolContext:
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, task=task, person=person)


async def test_the_ai_works_in_prima_as_the_person_who_asked(client, prima_on):
    o = await office(client)
    agent = await new_agent(client, o, "Chief of Staff", dept="Finance")
    await _microsoft("owner@example.com", OWNER_OID)
    await client.post("/api/prima/people/link-suggested", json={}, headers=csrf(client))
    owner_id, _ = await _ids("owner@example.com")

    async with SessionLocal() as db:
        ctx = await _ctx(db, agent["id"], owner_id)
        found = await TOOLS["prima_find"].handler(ctx, {"query": "attendance"})
        assert "api/companies/:id/attendance" in found
        out = await TOOLS["prima_read"].handler(ctx, {"path": "/leave", "query": {"x": "1"}})
        assert '"url": "/api/leave?x=1"' in out and '"as": "u-owner"' in out
        assert prima_on[-1].headers["x-office-via"] == "agent:Chief of Staff"
        out = await TOOLS["prima_record"].handler(
            ctx, {"path": "api/claims", "body": {"amount": 12}, "why": "taxi claim"}
        )
        assert '"body": "{\\"amount\\":12}"' in out
        refused = await TOOLS["prima_read"].handler(ctx, {"path": "api/staff-pay"})
        assert refused.startswith("Error: Prima refused (403)") and "Only HR" in refused

        # Nobody asked (the office's own work): never as anyone.
        n = len(prima_on)
        nobody = await TOOLS["prima_read"].handler(
            await _ctx(db, agent["id"], None), {"path": "api/me"}
        )  # noqa: E501
        assert nobody.startswith("Error:") and len(prima_on) == n

        # Recording waits for a person, even on autonomy "auto"; reading does not.
        a = await db.get(Agent, agent["id"])
        assert (await policy.evaluate(a, "prima_read", {"path": "api/me"})).effect == "allow"
        assert (
            await policy.evaluate(a, "prima_record", {"path": "api/claims", "body": {}, "why": "x"})
        ).effect == "ask"  # noqa: E501
        a.autonomy = "auto"
        assert (
            await policy.evaluate(a, "prima_record", {"path": "api/claims", "body": {}, "why": "x"})
        ).effect == "ask"  # noqa: E501
        names = {t["function"]["name"] for t in offered_tools(a)}
        assert {"prima_find", "prima_read", "prima_record"} <= names


async def test_a_task_given_in_the_office_reads_prima_as_whoever_gave_it(client, prima_on):
    """ "Summarise this week's attendance and the leave waiting": the agent's task reads
    Prima with the rights of the person who gave it."""
    o = await office(client)
    agent = await new_agent(client, o, "Ops Analyst", dept="Finance")
    await _microsoft("owner@example.com", OWNER_OID)
    await client.post("/api/prima/people/link-suggested", json={}, headers=csrf(client))
    t = await new_task(client, agent, "Attendance and leave summary", "This week, for co-1.")
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        ctx = await _ctx(db, agent["id"], None, task)
        me = await TOOLS["prima_read"].handler(ctx, {"path": "api/me"})
        assert '"name": "Owner One"' in me and '"co-1"' in me
        att = await TOOLS["prima_read"].handler(
            ctx, {"path": "api/companies/co-1/attendance", "query": {"date": "2026-11-06"}}
        )
        assert '"as": "u-owner"' in att and "/api/companies/co-1/attendance?date=2026-11-06" in att
        assert prima_on[-1].headers["x-office-via"] == "agent:Ops Analyst"


async def test_no_prima_tools_without_prima(client, monkeypatch):
    monkeypatch.setattr(settings, "prima_secret", "")
    o = await office(client)
    agent = await new_agent(client, o, "Chief of Staff", dept="Finance")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        names = {t["function"]["name"] for t in offered_tools(a)}
        assert not names & {"prima_find", "prima_read", "prima_record"}
        assert (await policy.evaluate(a, "prima_read", {"path": "api/me"})).effect == "deny"


# ---------------------------------------------------------------- P75 automatic Prima accounts


def _accounts(seen: list[httpx.Request]) -> list[dict]:
    return [json.loads(r.content) for r in seen if r.url.host == "prima-accounts"]


async def _map_branch(client, branch_id: str) -> None:
    d = (await client.get("/api/prima/companies")).json()
    row = next(b for b in d["branches"] if b["id"] == branch_id)
    assert row["company_id"] is None and row["suggestion"] == "co-maju"
    assert d["companies"] == COMPANIES
    r = await client.put(
        "/api/prima/companies", json={"companies": {branch_id: row["suggestion"]}},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    d = (await client.get("/api/prima/companies")).json()
    row = next(b for b in d["branches"] if b["id"] == branch_id)
    assert row["company_id"] == "co-maju" and row["suggestion"] is None


async def test_staff_open_prima_with_their_own_account(client, prima_on):
    from .test_office_roles import signed_in

    o = await office(client)
    bid = o["branch"]["id"]
    await _map_branch(client, bid)
    siti = await member(client, "siti@example.com", "staff", branch_id=bid)
    await member(client, "boss@example.com", "branch_manager", branch_id=bid)
    await _microsoft("siti@example.com", "0a0a0a0a-0000-4000-8000-0000000000b1")
    await _microsoft("boss@example.com", "0a0a0a0a-0000-4000-8000-0000000000b2")
    siti_id, ws = await _ids("siti@example.com")
    boss_id, _ = await _ids("boss@example.com")

    # Siti has no Prima record: opening Prima makes her own account, in her branch's company,
    # as central staff (self-service), and links it. Nobody links anything.
    c = await signed_in("siti@example.com", siti["temp_password"])
    try:
        s = (await c.get("/api/prima/status")).json()
        assert s["linked"] and s["me"]["name"] == "Siti", s
        r = await c.get("/api/prima/api/leave")
        assert r.json()["as"] == f"u-off-{siti_id}"
    finally:
        await c.aclose()
    assert _accounts(prima_on) == [
        {"officeUserId": siti_id, "name": "Siti", "title": "Staff", "role": "pwvsb_officer",
         "companyIds": ["co-maju"]},
    ]  # fmt: skip
    async with SessionLocal() as db:
        link = await db.get(PrimaLink, (ws, siti_id))
        assert (link.prima_user_id, link.how) == (f"u-off-{siti_id}", "auto")
        # A branch manager gets the company's manager view (admin_exec), once.
        link = await prima.link_for(db, ws, boss_id)
        assert (link.prima_user_id, link.how) == (f"u-off-{boss_id}", "auto")
        await prima.link_for(db, ws, boss_id)
    acc = _accounts(prima_on)
    assert len(acc) == 2 and acc[1]["role"] == "admin_exec"
    assert acc[1]["title"] == "Branch manager" and acc[1]["companyIds"] == ["co-maju"]
    # An office account is never suggested to anyone else by name.
    d = (await client.get("/api/prima/people")).json()
    assert all(not (p["suggestion"] or "").startswith("u-off-") for p in d["people"])


async def test_an_unmapped_branch_asks_the_owner_for_its_company(client, prima_on):
    from .test_office_roles import signed_in

    o = await office(client)
    m = await member(
        client, "rina@example.com", "supervisor",
        branch_id=o["branch"]["id"], department_id=o["depts"]["Finance"],
    )  # fmt: skip
    await _microsoft("rina@example.com", "0a0a0a0a-0000-4000-8000-0000000000b3")
    c = await signed_in("rina@example.com", m["temp_password"])
    try:
        s = (await c.get("/api/prima/status")).json()
        assert not s["linked"] and s["code"] == "company_needed"
        assert "which Prima company Maju Sdn Bhd is" in s["problem"]
        r = await c.get("/api/prima/api/me")
        assert r.status_code == 403 and r.json()["code"] == "company_needed"
    finally:
        await c.aclose()
    assert _accounts(prima_on) == []
    rina_id, ws = await _ids("rina@example.com")
    async with SessionLocal() as db:
        assert await db.get(PrimaLink, (ws, rina_id)) is None


async def test_only_the_owner_sets_the_branch_companies(client, prima_on):
    from agentic.models import AuditLog

    from .test_office_roles import signed_in

    o = await office(client)
    bid = o["branch"]["id"]
    m = await member(client, "staff2@example.com", "staff", branch_id=bid)
    bad = await client.put(
        "/api/prima/companies", json={"companies": {bid: "co-nowhere"}}, headers=csrf(client)
    )
    assert bad.status_code == 400
    bad = await client.put(
        "/api/prima/companies", json={"companies": {"br_other": "co-maju"}}, headers=csrf(client)
    )
    assert bad.status_code == 400
    _, ws = await _ids("owner@example.com")
    async with SessionLocal() as db:
        assert "prima_companies" not in ((await db.get(Workspace, ws)).settings or {})
    c = await signed_in("staff2@example.com", m["temp_password"])
    try:
        assert (await c.get("/api/prima/companies")).status_code == 403
        r = await c.put(
            "/api/prima/companies", json={"companies": {bid: "co-maju"}}, headers=csrf(c)
        )
        assert r.status_code == 403
    finally:
        await c.aclose()
    r = await client.put(
        "/api/prima/companies", json={"companies": {bid: "co-lain"}}, headers=csrf(client)
    )
    assert r.json() == {"ok": True, "companies": {bid: "co-lain"}}
    async with SessionLocal() as db:
        rows = (
            await db.scalars(select(AuditLog).where(AuditLog.action == "prima.companies"))
        ).all()
        assert len(rows) == 1 and rows[0].after == {bid: "co-lain"}
