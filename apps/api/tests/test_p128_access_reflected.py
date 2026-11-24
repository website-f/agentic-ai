"""P128: what Members > Access sets is what the person gets in Prima, after a reload.

Fitri (24 Nov 2026): "same issue with riduan earlier where when we custom its access to prima
module then when refresh, at their sidebar it doesn't even show what has been given access to,
just basic ... whatever is set like roles, permissions, permissions on module, it doesn't
reflect correctly."

Root cause: Prima opens a screen by the person's Prima role, department and job; the modules
ticked in the office only narrowed that. A supervisor (central staff, no department) with the
Finance modules ticked kept the plain staff menu. Now (prima/screen_access.py):
- Prima's own menu rule (App.tsx, run by screen_access_build.cjs) says what each office
  account gets; Members > Access shows it, and what each ticked module still needs;
- a department is given by name only (never silently from ticks), reaches the person's own
  Prima account at once (and certainly on their next reload), and so does a role change;
- a department Prima refuses no longer closes Prima to the person.
A fake Prima stands in (test_p106_prima_opens_as.FakePrima)."""

import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, PrimaLink
from agentic.prima import autolink, modules, screen_access
from agentic.prima import client as prima

from .conftest import csrf
from .test_agents import office
from .test_office_roles import member, signed_in
from .test_p106_prima_opens_as import FakePrima, _ids
from .test_p106_prima_opens_as import fake as fake  # noqa: F401 - the fixture

# The Finance modules ticked for Riduan on the live office (24 Nov 2026).
RIDUAN = ["finance", "payreq", "credit", "purchasing", "requests", "branches", "insurance"]
APP = Path(__file__).resolve().parents[2] / "prima" / "apps" / "web" / "src" / "App.tsx"
# Data walls that hold pay, staff personal data, firearms, speak-up and HR cases.
SENSITIVE_WALLS = {
    "pay_read", "statutory_read", "staff_ids", "staff_accounts", "staff_company", "staff_faces",
    "hr_cases", "applicants", "fw_ids", "hr_legal", "staff_movements", "offboard", "arms",
    "speak_up_hr", "archive_hr", "staff_history", "fw_history",
}  # fmt: skip


# ---------------------------------------------------------------- Prima's own rule


def test_the_table_is_prima_menu_rule_as_it_is_now():
    """screen_access.json was made from App.tsx as it is (run screen_access_build.cjs again
    when this fails), and knows every screen the office offers."""
    if not APP.exists():
        pytest.skip("Prima's source is not next to the office here")
    assert screen_access.source(APP.read_text(encoding="utf-8")) == screen_access.table()["source"]
    t = screen_access.table()
    seen = set(t["leaders"])
    for p in t["profiles"].values():
        seen |= set(p["views"])
    for j in t["jobs"].values():
        seen |= set(j["views"])
    # A site device's own screen, the AI data preview (one named CEO record only) and, P129, HR / IT coordination:
    # upstream #169 took it off every menu (accounts approved in Accounts and access open the IT checklist instead).
    missing = [
        v for v in modules.ids() if v not in seen and v not in ("device", "it-extraction", "hr-it-intake")
    ]
    assert missing == [], f"screens no Prima account opens: {missing}"
    # Malay names of Prima's jobs come from Prima's own translations.
    assert t["jobs"]["finance_leader"]["label"] == {
        "en": "Finance team leader",
        "ms": "Ketua pasukan Kewangan",
    }


def test_riduans_finance_modules_explained():
    """The live case: central staff, no department, the Finance modules ticked. Prima gives
    them only their own things, and each ticked module says what it needs."""
    e = screen_access.explain("pwvsb_officer", None, RIDUAN)
    assert e.department is None and e.how == "none"
    assert set(e.screens) <= set(modules.ALWAYS)
    needs = {n.screen: n for n in e.needs}
    assert set(needs) == set(RIDUAN)
    # Finance is a Finance team job, given only in Prima (it opens the salary accounts wall).
    assert needs["finance"].kind == "job"
    assert any(j["en"].startswith("Finance team") for j in needs["finance"].jobs)
    assert needs["credit"].kind == "department" and "legal" in needs["credit"].departments
    assert needs["requests"].departments == ["chief_of_staff"]
    assert needs["insurance"].departments == ["chief_of_staff"]
    assert "procurement" in needs["purchasing"].departments
    assert needs["branches"].kind == "branch_manager"
    # The department that opens most of them is offered, flagged, never given.
    tip = e.suggestion
    assert tip is not None and tip.department == "chief_of_staff" and tip.sensitive
    assert tip.adds == ["requests", "insurance"]

    # With that department chosen by name, those screens open (and the rest still say why).
    e = screen_access.explain("pwvsb_officer", "chief_of_staff", RIDUAN)
    assert {"requests", "insurance"} <= set(e.screens)
    assert {n.screen for n in e.needs} == {"finance", "payreq", "credit", "purchasing", "branches"}
    e = screen_access.explain("pwvsb_officer", "legal", ["credit"])
    assert "credit" in e.screens and e.needs == []


def test_nabilas_many_modules_never_open_a_wall_by_themselves():
    """Ticking every module gives no department, so no data wall: a department is chosen by
    name. And no office account ever reaches the Finance team's salary accounts."""
    every = list(modules.ids())
    e = screen_access.explain("pwvsb_officer", None, every)
    assert e.department is None
    assert screen_access.walls("pwvsb_officer", e.department) & SENSITIVE_WALLS == set()
    assert len(e.needs) > 30 and e.suggestion is not None
    for role in ("pwvsb_officer", "admin_exec"):
        assert screen_access.department(role, None) is None
        for d in screen_access.ORDER:
            assert "finance" not in screen_access.views(role, d), (role, d)
    # A branch manager (admin_exec) is never in a central-only department.
    for d in screen_access.CENTRAL_ONLY:
        assert screen_access.department("admin_exec", d) is None
        assert screen_access.department("pwvsb_officer", d) == d


# ---------------------------------------------------------------- the office, end to end


async def _staff_office(client, fake, email="riduan@example.com", role="supervisor"):
    o = await office(client)
    bid = o["branch"]["id"]
    r = await client.put(
        "/api/prima/companies", json={"companies": {bid: "co-maju"}}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    where = {"department_id": next(iter(o["depts"].values()))} if role == "supervisor" else {}
    m = await member(client, email, role, branch_id=bid, **where)
    uid, ws = await _ids(email)
    return uid, ws, m, bid


async def _explain(client, uid: str, **q) -> dict:
    r = await client.get(f"/api/members/{uid}/prima", params=q)
    assert r.status_code == 200, r.text
    return r.json()


async def test_members_access_shows_what_they_really_get_and_previews_the_form(client, fake):
    uid, ws, _, _ = await _staff_office(client, fake)
    r = await client.put(
        f"/api/members/{uid}/prima-access", json={"prima_modules": RIDUAN}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    d = await _explain(client, uid)
    e = d["effective"]
    assert e["role"] == "pwvsb_officer" and e["department"] is None and e["how"] == "none"
    assert {n["id"]: n["kind"] for n in e["needs"]}["finance"] == "job"
    assert e["suggestion"]["department"] == "chief_of_staff" and e["suggestion"]["sensitive"]
    assert [s["title"] for s in e["suggestion"]["adds"]] == ["Requests", "Insurance"]
    # The form before Save: another department, other modules; nothing is saved.
    e = (await _explain(client, uid, modules="credit,purchasing", department="legal"))["effective"]
    assert e["department"] == "legal" and "credit" in [s["id"] for s in e["screens"]]
    assert [n["id"] for n in e["needs"]] == ["purchasing"]
    e = (await _explain(client, uid, modules="all", department="none"))["effective"]
    assert e["needs"] == [] and "claims" in [s["id"] for s in e["screens"]]
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        assert m.prima_department is None and m.prima_modules == RIDUAN
    r = await client.get(f"/api/members/{uid}/prima", params={"modules": "nope"})
    assert r.status_code == 422
    r = await client.get(f"/api/members/{uid}/prima", params={"department": "director_office"})
    assert r.status_code == 422
    # In Malay too.
    r = await client.get(f"/api/members/{uid}/prima", headers={"x-lang": "ms"})
    jobs = next(n for n in r.json()["effective"]["needs"] if n["id"] == "finance")["jobs"]
    assert "Ketua pasukan Kewangan" in jobs


async def test_a_department_given_by_name_reaches_their_prima_at_once(client, fake, monkeypatch):
    monkeypatch.setattr(autolink, "on", True)  # P128: brought up to date after the answer
    uid, ws, m, bid = await _staff_office(client, fake)
    c = await signed_in("riduan@example.com", m["temp_password"])
    try:
        # First open: their own account, central staff, no department.
        assert (await c.get("/api/prima/api/me")).status_code == 200
        assert fake.made[f"u-off-{uid}"].get("department") is None
        n = len(fake.accounts())
        # Members > Access: Finance-ish modules and the Chief of Staff office, by name.
        r = await client.put(
            f"/api/members/{uid}/prima-access",
            json={"prima_modules": RIDUAN, "prima_department": "chief_of_staff"},
            headers=csrf(client),
        )  # fmt: skip
        assert r.status_code == 200, r.text
        # Already in Prima when the answer came back (not only at their next open).
        assert len(fake.accounts()) == n + 1
        assert fake.made[f"u-off-{uid}"]["department"] == "chief_of_staff"
        # Their reload: Prima's "who am I" names the department and the modules picked; the
        # calls of a picked screen go through, the others are refused by the office.
        me = (await c.get("/api/prima/api/me")).json()
        assert me["user"]["department"] == "chief_of_staff"
        assert me["office"]["modules"] == RIDUAN
        assert len(fake.accounts()) == n + 1  # nothing asked again
        call = next(x for x in modules.catalog()["calls"]["requests"] if x.startswith("GET "))
        path = "api/" + call.split(" ", 1)[1].replace(":", "x")
        assert (await c.get(f"/api/prima/{path}")).status_code == 200
        r = await c.get("/api/prima/api/staff-directory")
        assert r.status_code == 403 and r.json()["code"] == "module_not_chosen"
        e = (await _explain(client, uid))["effective"]
        assert {"requests", "insurance"} <= {s["id"] for s in e["screens"]}

        # Their office role changes: a branch manager is a company's admin executive in Prima,
        # never in a central-only department; it too is in Prima at once.
        r = await client.patch(
            f"/api/members/{uid}",
            json={"role": "branch_manager", "branch_id": bid},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        made = fake.made[f"u-off-{uid}"]
        assert made["role"] == "admin_exec" and "department" not in made
        async with SessionLocal() as db:
            link = await db.get(PrimaLink, (ws, uid))
            assert link.linked_by == "auto:account:admin_exec" and link.department is None
        me = (await c.get("/api/prima/api/me")).json()
        assert me["user"]["role"] == "admin_exec"
        e = (await _explain(client, uid))["effective"]
        assert e["role"] == "admin_exec" and e["department"] is None
        assert "branches" in {s["id"] for s in e["screens"]}
    finally:
        await c.aclose()


class Refusing(FakePrima):
    """Prima's accounts service refusing a central-only department: their own staff record is
    in a licensed company (office-accounts.ts)."""

    refuse = "finance"

    def handler(self, req: httpx.Request) -> httpx.Response:
        if req.url.host == "prima-accounts":
            body = json.loads(req.content)
            if body.get("department") == self.refuse:
                self.seen.append(req)
                return httpx.Response(400, json={"message": "must be central staff"})
        return super().handler(req)


async def test_a_refused_department_never_closes_prima_and_is_shown(client, fake, monkeypatch):
    refusing = Refusing()
    monkeypatch.setattr(prima, "transport", httpx.MockTransport(refusing.handler))
    uid, ws, m, _ = await _staff_office(client, refusing, "nabila@example.com", "staff")
    r = await client.put(
        f"/api/members/{uid}/prima-access", json={"prima_department": "finance"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    c = await signed_in("nabila@example.com", m["temp_password"])
    try:
        # Before P128 this answered "Prima could not make your account" on every call.
        r = await c.get("/api/prima/api/me")
        assert r.status_code == 200 and r.json()["user"]["id"] == f"u-off-{uid}"
        assert "department" not in refusing.made[f"u-off-{uid}"]
        n = len(refusing.accounts())
        assert (await c.get("/api/prima/api/me")).status_code == 200
        assert len(refusing.accounts()) == n  # the refusal is remembered, not asked again
    finally:
        await c.aclose()
    async with SessionLocal() as db:
        link = await db.get(PrimaLink, (ws, uid))
        assert link.department is None and link.department_refused == "finance"
        made = await db.scalar(
            select(AuditLog).where(AuditLog.action == "prima.account", AuditLog.target == uid)
        )
        assert made.after["department_refused"] == "finance"
    e = (await _explain(client, uid))["effective"]
    assert e["how"] == "refused" and e["department"] is None
    # Another choice is asked again, and the refusal is let go of once Prima takes it.
    r = await client.put(
        f"/api/members/{uid}/prima-access", json={"prima_department": "procurement"},
        headers=csrf(client),
    )  # fmt: skip
    async with SessionLocal() as db:
        await prima.link_for(db, ws, uid)
        link = await db.get(PrimaLink, (ws, uid))
        assert link.department == "procurement" and link.department_refused is None
    assert refusing.made[f"u-off-{uid}"]["department"] == "procurement"


async def test_owners_and_admins_see_the_top_record_screens(client, fake):
    o = await office(client)
    await member(client, "ada@example.com", "admin", branch_id=o["branch"]["id"])
    owner, _ = await _ids("owner@example.com")
    ada, _ = await _ids("ada@example.com")
    e = (await _explain(client, owner))["effective"]
    assert e["how"] == "top" and "finance" in {s["id"] for s in e["screens"]}
    r = await client.put(
        f"/api/members/{ada}/prima-access", json={"prima_modules": ["finance"]},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 200, r.text
    e = (await _explain(client, ada))["effective"]
    ids = {s["id"] for s in e["screens"]}
    assert "finance" in ids and "staffpay" not in ids and e["needs"] == []
