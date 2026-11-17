"""P112: a Prima person and the office's members (Fitri, 17 Nov 2026: "...and then can't see link
to the members, and if not match then add them into the members in agentic ai with correct
designation, email and so on").

- Prima's person details ask which member the person is: by their Prima link, else their work
  email, else the only member of that name (bin / binti / b. / bt. set aside); two of that name:
  no guess.
- Not a member: the form comes filled in from Prima (name, email, job title, the branch of their
  Prima company, a department of that name, staff); adding them is Members > Add member's path
  (rules, one-time password, audit), with their job title, linked to Prima afterwards.
- No duplicate: a member who is that person is opened instead; a member of the same name only
  after "not the same person". The name and email saved are Prima's, read again on the add.
- Whoever may add members asks (staff are refused; a branch manager only in their branches),
  and the person is read from Prima as the asker: Prima's refusal comes back as it is.
A fake Prima stands in (test_p106_prima_opens_as.FakePrima), with its people."""

import hashlib
import hmac

import httpx
import pytest
from sqlalchemy import select

from agentic.api.main import app
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import PrimaLink, User
from agentic.prima import autolink, org_link
from agentic.prima import client as prima
from agentic.prima.person_member import name_key

from . import test_p106_prima_opens_as as p106
from .conftest import csrf
from .test_agents import office
from .test_office_roles import PW, signed_in
from .test_p106_prima_opens_as import _audits, _ids

COMPANIES = [{"id": "co-maju", "name": "Maju Sdn Bhd"}, {"id": "co-lain", "name": "Lain Bhd"}]
# A Prima staff account that belongs to the person p-hana (Prima's staff list says so).
HANA_ACCOUNT = {**p106.OTHER, "personId": "p-hana"}


def _person(pid: str, name: str, email: str | None = None, **more) -> dict:
    return {"id": pid, "companyId": "co-maju", "branchId": "b-1", "staffNo": pid.upper(),
            "name": name, **({"email": email} if email else {}), **more}  # fmt: skip


PEOPLE = {
    p["id"]: p
    for p in (
        _person("p-hana", "Hana binti Ahmad", "hana.work@example.com"),
        _person("p-siti", "Siti Aminah", "Siti.Aminah@Example.com"),
        _person("p-ali", "Ali B. Abu"),
        _person("p-twin", "Ahmad bin Ali", "ahmad.twin@example.com"),
        _person(
            "p-new",
            "Nurul Izzah binti Kamal",
            "nurul@example.com",
            otherEmails=["nurul.izzah@example.com"],
            jobTitle="Admin Executive",
            department="Finance",
        ),  # fmt: skip
        _person("p-noemail", "Zul Kifli", jobTitle="Storekeeper"),
    )
}


class FakePrima(p106.FakePrima):
    """p106's Prima, with its people: GET /api/people/:id answers whoever Prima lets see them
    (everyone but the records in `walls`)."""

    def __init__(self) -> None:
        super().__init__()
        self.walls: set[str] = set()

    def records(self) -> list[dict]:
        return [p106.CEO, HANA_ACCOUNT, *self.made.values()]

    def handler(self, req: httpx.Request) -> httpx.Response:
        url = req.url.raw_path.decode()
        if url == "/api/office/companies":
            self.seen.append(req)
            return httpx.Response(200, json=COMPANIES)
        if not url.startswith("/api/people/"):
            return super().handler(req)
        self.seen.append(req)
        h = req.headers
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(p106.SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        assert h["x-office-signature"] == want and h["x-office-via"] == "person"
        if h["x-office-user"] in self.walls:
            return httpx.Response(403, json={"message": "You may not see this person."})
        person = PEOPLE.get(url.removeprefix("/api/people/"))
        if person is None:
            return httpx.Response(404, json={"message": "Person not found"})
        return httpx.Response(200, json={"person": person, "branch": None, "credentials": []})


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", p106.SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(settings, "prima_accounts_url", "http://prima-accounts:3100")
    f = FakePrima()
    monkeypatch.setattr(prima, "transport", httpx.MockTransport(f.handler))
    monkeypatch.setattr(prima, "_TOP", {})
    monkeypatch.setattr(org_link, "on", False)
    linked: list[list[str]] = []
    monkeypatch.setattr(autolink, "later", lambda _bg, _ws, ids: linked.append(list(ids)))
    f.linked = linked  # type: ignore[attr-defined]
    return f


async def _add(c, email: str, name: str, role: str = "staff", **where) -> dict:
    r = await c.post(
        "/api/members", json={"email": email, "name": name, "role": role, **where},
        headers=csrf(c),
    )  # fmt: skip
    assert r.status_code == 201, r.text
    return r.json()


async def _setup(client) -> dict:
    """An office of two companies: Maju (co-maju in Prima) and Lain (co-lain)."""
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Lain Bhd"}, headers=csrf(client))
    ).json()
    o["b2"] = b2
    r = await client.put(
        "/api/prima/companies",
        json={"companies": {o["branch"]["id"]: "co-maju", b2["id"]: "co-lain"}},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    return o


def _post(c, pid: str, **body):
    return c.post(f"/api/prima-members/{pid}", json=body, headers=csrf(c))


def test_names_compare_without_bin_binti_and_dots():
    assert name_key("Ali B. Abu") == name_key("ali bin abu") == "ali abu"
    assert name_key("Siti Aminah Bt. Ahmad") == name_key("SITI AMINAH BINTI AHMAD")
    assert name_key("Nurul binti Kamal") != name_key("Nurul Kamala")


async def test_which_member_a_prima_person_is(client, fake):
    o = await _setup(client)
    bid = o["branch"]["id"]
    linked = await _add(client, "linked@example.com", "Someone Linked", branch_id=bid)
    await _add(client, "siti.aminah@example.com", "S. Aminah", branch_id=bid)
    await _add(client, "ali@example.com", "ali bin abu", branch_id=bid)
    await _add(client, "ahmad1@example.com", "Ahmad Ali", branch_id=bid)
    await _add(client, "ahmad2@example.com", "AHMAD B. ALI", branch_id=bid)
    uid, ws = await _ids("linked@example.com")
    async with SessionLocal() as db:
        db.add(PrimaLink(workspace_id=ws, user_id=uid, prima_user_id="u-hr", prima_name="Hana HR",
                         how="name", linked_by="auto:name"))  # fmt: skip
        await db.commit()

    # 1. By their Prima link: the account Prima says is this person's.
    d = (await client.get("/api/prima-members/p-hana")).json()
    assert d["status"] == "member" and d["how"] == "linked", d
    assert d["member"]["user_id"] == linked["member"]["user_id"]
    assert d["member"]["email"] == "linked@example.com" and d["draft"] is None
    # The person was read from Prima as the asker (the owner opens it as the CEO record).
    asked = [r for r in fake.seen if r.url.raw_path.decode() == "/api/people/p-hana"]
    assert asked and asked[-1].headers["x-office-user"] == "u-ceo"

    # 2. By work email, whatever its case.
    d = (await client.get("/api/prima-members/p-siti")).json()
    assert (d["status"], d["how"], d["member"]["email"]) == (
        "member", "email", "siti.aminah@example.com"
    )  # fmt: skip
    # 3. By the only member of that name, bin and dots set aside.
    d = (await client.get("/api/prima-members/p-ali")).json()
    assert (d["status"], d["how"], d["member"]["email"]) == ("member", "name", "ali@example.com")
    # A name alone may be someone else: the form comes too ("not the same person").
    assert d["draft"]["name"] == "Ali B. Abu" and d["draft"]["email"] is None
    # Two members of that name: no guess.
    d = (await client.get("/api/prima-members/p-twin")).json()
    assert d["status"] == "none" and d["same_name"] == 2 and d["member"] is None

    # Not a member: the form filled in from Prima.
    d = (await client.get("/api/prima-members/p-new")).json()
    assert d["status"] == "none" and d["same_name"] == 0
    f = d["draft"]
    assert f["name"] == "Nurul Izzah binti Kamal" and f["email"] == "nurul@example.com"
    assert f["emails"] == ["nurul@example.com", "nurul.izzah@example.com"]
    assert f["job_title"] == "Admin Executive" and f["role"] == "staff"
    assert f["company_mapped"] and [b["id"] for b in f["branches"]] == [bid]
    assert f["branch_id"] == bid and f["department_id"] == o["depts"]["Finance"]
    assert {r["id"] for r in f["roles"]} >= {"staff", "admin"}
    assert d["person"]["staff_no"] == "P-NEW"


async def test_add_a_prima_person_as_a_member(client, fake):
    o = await _setup(client)
    bid = o["branch"]["id"]
    fin = o["depts"]["Finance"]

    # An email Prima does not have for them is refused (theirs come from Prima).
    r = await _post(client, "p-new", email="someone.else@example.com", branch_id=bid)
    assert r.status_code == 422 and r.json()["code"] == "email_not_prima", r.text
    # A branch that is not their Prima company.
    r = await _post(client, "p-new", branch_id=o["b2"]["id"])
    assert r.status_code == 422 and r.json()["code"] == "branch_not_company", r.text

    # Added: Prima's name (a name sent along is not used), their other work email as chosen,
    # their job title and department, staff by default; a one-time password; linked to Prima.
    body = {"email": "Nurul.Izzah@example.com", "branch_id": bid, "department_id": fin,
            "job_title": "Admin Executive", "name": "Someone Else"}  # fmt: skip
    r = await _post(client, "p-new", **body)
    assert r.status_code == 201, r.text
    out = r.json()
    m = out["member"]
    assert out["temp_password"] and r.headers["cache-control"] == "no-store"
    assert (m["name"], m["email"], m["role"]) == (
        "Nurul Izzah binti Kamal", "nurul.izzah@example.com", "staff"
    )  # fmt: skip
    assert (m["branch_id"], m["department_id"], m["job_title"]) == (bid, fin, "Admin Executive")
    assert fake.linked == [[m["user_id"]]]
    added = [a for a in await _audits("member.added") if a.target == m["user_id"]]
    assert len(added) == 1 and added[0].after["via"] == "prima"
    from_prima = await _audits("member.added_from_prima")
    assert from_prima[-1].target == m["user_id"]
    assert from_prima[-1].after == {"prima_person_id": "p-new", "job_title": "Admin Executive"}

    # Now a member (by email): shown, and never added twice.
    d = (await client.get("/api/prima-members/p-new")).json()
    assert d["status"] == "member" and d["how"] == "email"
    assert d["member"]["job_title"] == "Admin Executive"
    r = await _post(client, "p-new", branch_id=bid)
    assert r.status_code == 409 and r.json()["code"] == "already_member", r.text

    # Prima has no email: the form asks for one.
    r = await _post(client, "p-noemail", branch_id=bid)
    assert r.status_code == 422 and r.json()["code"] == "email_required", r.text
    r = await _post(client, "p-noemail", email="zul@example.com", branch_id=bid)
    assert r.status_code == 201, r.text
    assert r.json()["member"]["job_title"] == "Storekeeper"  # Prima's, when none is sent

    # A member of the same name: no silent merge, and no add until "not the same person".
    await _add(client, "ali@example.com", "Ali bin Abu", branch_id=bid)
    r = await _post(client, "p-ali", email="ali.other@example.com", branch_id=bid)
    assert r.status_code == 409 and r.json()["code"] == "same_name", r.text
    r = await _post(client, "p-ali", email="ali.other@example.com", branch_id=bid,
                    not_the_same=True)  # fmt: skip
    assert r.status_code == 201, r.text
    ali_id, _ = await _ids("ali@example.com")
    assert (await _audits("member.added_from_prima"))[-1].after["not_the_same_as"] == ali_id
    # An email that already has a member is refused by the add itself.
    async with SessionLocal() as db:
        n = len((await db.scalars(select(User).where(User.email == "ali@example.com"))).all())
    assert n == 1


async def test_who_may_ask_and_add(client, fake, monkeypatch):
    o = await _setup(client)
    bid, b2 = o["branch"]["id"], o["b2"]["id"]
    staff = await _add(client, "staff@example.com", "Staff One", branch_id=bid)
    boss = await _add(client, "boss@example.com", "Boss Lain", "branch_manager", branch_id=b2)

    # Staff: refused, and Prima is never asked.
    c = await signed_in("staff@example.com", staff["temp_password"])
    try:
        n = len(fake.seen)
        assert (await c.get("/api/prima-members/p-new")).status_code == 403
        assert (await _post(c, "p-new", branch_id=bid)).status_code == 403
        assert len(fake.seen) == n
    finally:
        await c.aclose()

    # A branch manager of another company: no branch of the person's company to offer, and the
    # add into it is refused.
    c = await signed_in("boss@example.com", boss["temp_password"])
    try:
        d = (await c.get("/api/prima-members/p-new")).json()
        assert d["status"] == "none" and d["draft"]["branches"] == [], d
        roles = [r["id"] for r in d["draft"]["roles"]]
        assert "staff" in roles and "admin" not in roles and d["draft"]["role"] == "staff"
        r = await _post(c, "p-new", branch_id=bid)
        assert r.status_code == 403 and r.json()["code"] == "outside_scope", r.text
        # A member of their company they may not see: said, not shown.
        await _add(client, "siti.aminah@example.com", "Siti Aminah", branch_id=bid)
        d = (await c.get("/api/prima-members/p-siti")).json()
        assert d["status"] == "elsewhere" and d["member"] is None
    finally:
        await c.aclose()

    # Prima's own refusal comes back as it is (its walls decide who sees the person).
    boss_id, _ = await _ids("boss@example.com")
    fake.walls.add(f"u-off-{boss_id}")
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    try:
        r = await c.post("/api/auth/login", json={"email": "boss@example.com", "password": PW})
        assert r.status_code == 200, r.text
        r = await c.get("/api/prima-members/p-new")
        assert r.status_code == 403 and r.json()["code"] == "prima_refused", r.text
        assert "You may not see this person." in r.json()["message"]
        r = await _post(c, "p-new", branch_id=b2)
        assert r.status_code == 403 and r.json()["code"] == "prima_refused", r.text
    finally:
        await c.aclose()

    # Nobody Prima knows, and an address that is no Prima person.
    r = await client.get("/api/prima-members/p-nobody")
    assert r.status_code == 404 and r.json()["code"] == "person_not_found"
    r = await client.get("/api/prima-members/p%20x")
    assert r.status_code == 400, r.text

    # Prima not set up here: nothing to show.
    monkeypatch.setattr(settings, "prima_url", "")
    r = await client.get("/api/prima-members/p-new")
    assert r.status_code == 404 and r.json()["code"] == "prima_off"
