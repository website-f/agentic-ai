"""P109: every member of the office is linked to Prima, with no Microsoft step (Fitri, 17 Nov
2026: "whatever members are added in the Agentic Office, make them auto linked, and link all
existing ones now"; "Staff: own records only").

- A signed-in office member opens Prima with no Microsoft step: their own staff record when the
  match is sure, else their own Prima account (prima/client.py ensure).
- The office decides the level of their own account: staff, HODs and the like are central staff
  with no grant (pwvsb_officer, own records only), a branch manager the company's manager view
  (admin_exec); an account given an earlier level is brought to it on their next open.
- Admins (high management) open Prima as its top record, like owners, with no branch.
- Members are linked when they are added (prima/autolink.py), best effort.
- `python -m agentic.prima.link_all` links everyone already in the office: counts only,
  --dry-run writes nothing, a second run changes nothing.
A fake Prima stands in (test_p106_prima_opens_as.FakePrima)."""

import argparse

import pytest
from sqlalchemy import func, select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, PrimaLink, Workspace
from agentic.prima import autolink, link_all
from agentic.prima import client as prima

from . import test_p106_prima_opens_as as p106
from .conftest import csrf
from .test_agents import office
from .test_office_roles import member, signed_in
from .test_p106_prima_opens_as import _audits, _ids, _post, fake  # noqa: F401

OID = "0a0a0a0a-0000-4000-8000-0000000001a1"
# A record IT gave a Microsoft account, for the one person who connected it.
MS = {"id": "u-ms", "name": "Someone Else", "title": "Clerk", "role": "pwvsb_officer",
      "entraOid": OID, "canSignIn": True}  # fmt: skip


@pytest.fixture
def records(monkeypatch):
    monkeypatch.setattr(
        p106.FakePrima, "records", lambda self: [p106.CEO, p106.OTHER, MS, *self.made.values()]
    )


async def _map(client, branch_id: str, company: str = "co-maju") -> None:
    r = await client.put(
        "/api/prima/companies", json={"companies": {branch_id: company}}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text


async def _microsoft(email: str, oid: str) -> None:
    uid, ws = await _ids(email)
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws, uid))
        m.ms_oid, m.ms_tenant_id = oid, "11111111-2222-3333-4444-555555555555"
        await db.commit()


async def _link(ws: str, uid: str) -> PrimaLink:
    async with SessionLocal() as db:
        return await prima.link_for(db, ws, uid)


def _last_account(fake, uid: str) -> dict:  # noqa: F811
    return [a for a in fake.accounts() if a["officeUserId"] == uid][-1]


async def test_members_open_prima_without_microsoft_at_their_office_level(client, fake, records):  # noqa: F811
    o = await office(client)
    bid = o["branch"]["id"]
    await _map(client, bid)
    siti = await member(client, "siti@example.com", "staff", branch_id=bid)
    fin = o["depts"]["Finance"]
    await member(client, "hod@example.com", "hod", branch_id=bid, department_id=fin)
    await member(client, "boss@example.com", "branch_manager", branch_id=bid)
    await member(client, "hana.hr@example.com", "staff", branch_id=bid)
    await member(client, "clerk@example.com", "staff", branch_id=bid)
    await _microsoft("clerk@example.com", OID)
    siti_id, ws = await _ids("siti@example.com")
    hod_id, _ = await _ids("hod@example.com")
    boss_id, _ = await _ids("boss@example.com")
    hana_id, _ = await _ids("hana.hr@example.com")
    clerk_id, _ = await _ids("clerk@example.com")

    # Nobody connected Microsoft (but the clerk): a signed-in member is enough.
    c = await signed_in("siti@example.com", siti["temp_password"])
    try:
        s = (await c.get("/api/prima/status")).json()
        assert s["linked"] and not s["needs_microsoft"], s
        assert (await c.get("/api/prima/api/me")).json()["user"]["id"] == f"u-off-{siti_id}"
    finally:
        await c.aclose()
    for uid in (hod_id, boss_id, hana_id, clerk_id):
        await _link(ws, uid)

    # Their own Prima record when the match is sure: by Microsoft first, by a unique name.
    async with SessionLocal() as db:
        hana = await db.get(PrimaLink, (ws, hana_id))
        clerk = await db.get(PrimaLink, (ws, clerk_id))
        siti_link = await db.get(PrimaLink, (ws, siti_id))
    assert (hana.prima_user_id, hana.how) == ("u-hr", "name")
    assert (clerk.prima_user_id, clerk.how) == ("u-ms", "microsoft")
    assert siti_link.linked_by == "auto:account:pwvsb_officer"

    # "Staff: own records only": staff and HODs are central staff with no grant; a branch
    # manager has the company manager view, for the company of their branch.
    assert _last_account(fake, siti_id)["role"] == "pwvsb_officer"
    assert _last_account(fake, hod_id)["role"] == "pwvsb_officer"
    boss = _last_account(fake, boss_id)
    assert boss["role"] == "admin_exec" and boss["companyIds"] == ["co-maju"]
    assert {a["officeUserId"] for a in fake.accounts()} == {siti_id, hod_id, boss_id}

    # Opened again: nothing to do.
    n = len(fake.accounts())
    await _link(ws, siti_id)
    assert len(fake.accounts()) == n

    # The branch manager is made staff: their account is brought to that level on next open.
    r = await client.patch(
        f"/api/members/{boss_id}", json={"role": "staff", "branch_id": bid}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    await _link(ws, boss_id)
    assert _last_account(fake, boss_id)["role"] == "pwvsb_officer"
    assert fake.made[f"u-off-{boss_id}"]["role"] == "pwvsb_officer"

    # An account made before P109 (its level unknown to the office) is brought to the
    # office's level once, audited; then left alone.
    async with SessionLocal() as db:
        (await db.get(PrimaLink, (ws, siti_id))).linked_by = "auto:account"
        await db.commit()
    n = len(fake.accounts())
    link = await _link(ws, siti_id)
    assert link.linked_by == "auto:account:pwvsb_officer" and len(fake.accounts()) == n + 1
    assert _last_account(fake, siti_id)["role"] == "pwvsb_officer"
    rows = await _audits("prima.level")
    assert [r.target for r in rows] == [boss_id, siti_id]
    assert rows[-1].after["role"] == "pwvsb_officer"
    await _link(ws, siti_id)
    assert len(fake.accounts()) == n + 1


async def test_admins_open_prima_as_the_top_record(client, fake, records):  # noqa: F811
    """Admins (high management) open Prima as its top record like owners: no branch, no
    Microsoft, no link; what they record is in the office's log under their name; the
    two-person check holds for them; they are not the developer."""
    await office(client)
    await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    adm = await member(client, "adm@example.com", "admin")
    adm_id, ws = await _ids("adm@example.com")
    c = await signed_in("adm@example.com", adm["temp_password"])
    try:
        s = (await c.get("/api/prima/status")).json()
        assert s["linked"] and s["me"]["name"] == "Fauzan", s
        me = (await c.get("/api/prima/api/me")).json()
        assert me["office"]["asTop"] is True and me["office"]["name"] != "Fauzan"
        r = await _post(c, "api/claims", {"amount": 5})
        assert r.status_code == 200 and r.json()["as"] == "u-ceo"
        assert (await c.get("/api/prima/opens-as")).status_code == 403  # developer only
    finally:
        await c.aclose()
    rows = await _audits("prima.recorded")
    assert [(r.actor, r.target) for r in rows] == [(f"user:{adm_id}", "u-ceo")]
    async with SessionLocal() as db:
        assert await db.get(PrimaLink, (ws, adm_id)) is None
    assert fake.accounts() == []

    # The owner's Prima page: the admin opens it as the CEO; no record to link them to.
    d = (await client.get("/api/prima/people")).json()
    row = next(p for p in d["people"] if p["user_id"] == adm_id)
    assert row["opens_as"] == "ceo" and row["suggestion"] is None
    r = await client.post(
        "/api/prima/people/link", json={"user_id": adm_id, "prima_user_id": "u-hr"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 409
    w = (await client.get(f"/api/members/{adm_id}/prima")).json()
    assert w["role"] == "director" and w["where"].startswith("Admins open Prima")

    # Made admin from staff with their own Prima account: through the CEO record they never OK
    # what they loaded with it (P106), and their own account is kept.
    async with SessionLocal() as db:
        db.add(PrimaLink(workspace_id=ws, user_id=adm_id, prima_user_id=f"u-off-{adm_id}",
                         prima_name="Adm", how="auto",
                         linked_by="auto:account:pwvsb_officer"))  # fmt: skip
        await db.commit()
    fake.made[f"u-off-{adm_id}"] = {"id": f"u-off-{adm_id}", "name": "Adm", "title": "Staff",
                                    "role": "pwvsb_officer", "companyIds": ["co-maju"],
                                    "entraOid": None, "canSignIn": True}  # fmt: skip
    fake.loads = [{"id": "oimp-9", "byId": f"u-off-{adm_id}", "by": "Adm"}]
    c = await _login(client, "adm@example.com")
    try:
        r = await _post(c, "api/org/import-loads/oimp-9/ok", {"comment": "ok"})
        assert r.status_code == 403 and r.json()["code"] == "own_work"
    finally:
        await c.aclose()
    async with SessionLocal() as db:
        assert (await db.get(PrimaLink, (ws, adm_id))).prima_user_id == f"u-off-{adm_id}"


async def _login(client, email: str):
    import httpx

    from .test_office_roles import PW

    c = httpx.AsyncClient(transport=client._transport, base_url="http://test")
    r = await c.post("/api/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return c


async def test_members_are_linked_when_added(client, fake, records, monkeypatch):  # noqa: F811
    monkeypatch.setattr(autolink, "on", True)
    o = await office(client)
    bid = o["branch"]["id"]
    other = (
        await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    ).json()
    await _map(client, bid)

    # Members > Add: linked as soon as the add is answered, at their level.
    await member(client, "siti@example.com", "staff", branch_id=bid)
    await member(client, "boss@example.com", "branch_manager", branch_id=bid)
    await member(client, "adm@example.com", "admin")
    siti_id, ws = await _ids("siti@example.com")
    boss_id, _ = await _ids("boss@example.com")
    adm_id, _ = await _ids("adm@example.com")
    async with SessionLocal() as db:
        assert (await db.get(PrimaLink, (ws, siti_id))).prima_user_id == f"u-off-{siti_id}"
        assert (await db.get(PrimaLink, (ws, boss_id))).linked_by == "auto:account:admin_exec"
        assert await db.get(PrimaLink, (ws, adm_id)) is None  # opens as the CEO record
    assert _last_account(fake, siti_id)["role"] == "pwvsb_officer"
    assert _last_account(fake, boss_id)["role"] == "admin_exec"

    # A branch with no Prima company yet: added all the same, linked later.
    await member(client, "rina@example.com", "staff", branch_id=other["id"])
    rina_id, _ = await _ids("rina@example.com")
    async with SessionLocal() as db:
        assert await db.get(PrimaLink, (ws, rina_id)) is None

    # Import from Excel: everyone added is linked.
    sent = [
        {
            "row": 2,
            "name": "Hana HR",
            "email": "hana@example.com",
            "role": "staff",
            "branch_id": bid,
        },  # noqa: E501
        {
            "row": 3,
            "name": "Imran",
            "email": "imran@example.com",
            "role": "staff",
            "branch_id": bid,
        },  # noqa: E501
    ]
    r = await client.post("/api/members/import", json={"rows": sent}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["added"] == 2, r.text
    hana_id, _ = await _ids("hana@example.com")
    imran_id, _ = await _ids("imran@example.com")
    async with SessionLocal() as db:
        assert (await db.get(PrimaLink, (ws, hana_id))).how == "name"
        assert (await db.get(PrimaLink, (ws, imran_id))).prima_user_id == f"u-off-{imran_id}"

    # Prima's accounts service not answering: the add still works; their first open links them.
    monkeypatch.setattr(settings, "prima_accounts_url", "http://nowhere.test")
    zul = await member(client, "zul@example.com", "staff", branch_id=bid)
    zul_id, _ = await _ids("zul@example.com")
    async with SessionLocal() as db:
        assert await db.get(PrimaLink, (ws, zul_id)) is None
    monkeypatch.setattr(settings, "prima_accounts_url", "http://prima-accounts:3100")
    c = await signed_in("zul@example.com", zul["temp_password"])
    try:
        assert (await c.get("/api/prima/status")).json()["linked"]
    finally:
        await c.aclose()

    # Switched off (or Prima not set up): nothing is asked of Prima on add.
    monkeypatch.setattr(autolink, "on", False)
    n = len(fake.seen)
    await member(client, "late@example.com", "staff", branch_id=bid)
    assert len(fake.seen) == n


async def test_link_all_counts_writes_nothing_on_a_dry_run_and_is_idempotent(
    client,
    fake,  # noqa: F811
    records,
    capsys,
):
    o = await office(client)
    bid = o["branch"]["id"]
    other = (
        await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    ).json()
    await _map(client, bid)
    await member(client, "siti@example.com", "staff", branch_id=bid)  # own account
    await member(client, "hana.hr@example.com", "staff", branch_id=bid)  # by name
    await member(client, "clerk@example.com", "staff", branch_id=bid)  # by Microsoft
    await _microsoft("clerk@example.com", OID)
    await member(client, "rina@example.com", "staff", branch_id=other["id"])  # unmapped
    await member(client, "viewer@example.com", "viewer")  # no branch (two branches)
    await member(client, "adm@example.com", "admin")  # the CEO record
    await member(client, "old@example.com", "staff", branch_id=bid)  # made before P109
    await member(client, "set@example.com", "staff", branch_id=bid)  # linked by the owner
    owner_id, ws = await _ids("owner@example.com")
    old_id, _ = await _ids("old@example.com")
    set_id, _ = await _ids("set@example.com")
    async with SessionLocal() as db:
        db.add(PrimaLink(workspace_id=ws, user_id=old_id, prima_user_id=f"u-off-{old_id}",
                         prima_name="Old", how="auto", linked_by="auto:account"))  # fmt: skip
        db.add(PrimaLink(workspace_id=ws, user_id=set_id, prima_user_id="u-set",
                         prima_name="Set", how="owner", linked_by=f"user:{owner_id}"))  # fmt: skip
        await db.commit()

    async def state() -> tuple[int, int, int]:
        async with SessionLocal() as db:
            links = await db.scalar(select(func.count()).select_from(PrimaLink))
            audits = await db.scalar(select(func.count()).select_from(AuditLog))
        return links, audits, len(fake.accounts())

    want = {
        "top": 2, "already": 1, "refreshed": 1, "microsoft": 1, "name": 1, "account": 1,
        "refused:unmapped": 1, "refused:no_branch": 1,
    }  # fmt: skip
    before = await state()
    assert dict(await link_all.link_all(ws, dry=True)) == want
    assert await state() == before  # nothing written, nothing asked of the accounts service

    assert dict(await link_all.link_all(ws, dry=False)) == want
    links, _, accounts = await state()
    assert links == before[0] + 3 and accounts == 2  # siti made, old brought to its level
    async with SessionLocal() as db:
        assert (await db.get(PrimaLink, (ws, old_id))).linked_by == "auto:account:pwvsb_officer"
        assert (await db.get(PrimaLink, (ws, set_id))).prima_user_id == "u-set"  # kept

    again = await link_all.link_all(ws, dry=False)
    assert dict(again) == {
        "top": 2, "already": 5, "refused:unmapped": 1, "refused:no_branch": 1,
    }  # fmt: skip
    assert (await state())[2] == accounts

    # The command prints counts only: no names, no emails.
    async with SessionLocal() as db:
        slug = (await db.get(Workspace, ws)).slug
    capsys.readouterr()
    assert await link_all.run(argparse.Namespace(workspace=slug, dry_run=True)) == 0
    out = capsys.readouterr().out
    assert "Members: 9" in out and "refused: company needed (no branch)" in out
    assert "Dry run: nothing was changed." in out
    assert "@" not in out and "Siti" not in out and "Rina" not in out
