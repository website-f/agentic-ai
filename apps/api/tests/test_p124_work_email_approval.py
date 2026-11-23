"""P124 (the owner, 23 Nov 2026): "for work email, when someone who is not a HOD (or above)
connects one, it must request approval first, not connect immediately; another company might be
checking too. Right now I can add as many work emails as I want without approval."

- Below HOD, an extra WORK account (company domain / company tenant) waits: saved, unused,
  asked of the person's line manager (else department head, else branch manager, else the
  office's owners and admins) on the Approvals page.
- HOD and above connect at once; personal accounts never wait; the main account never waits.
- Approve: usable at once. Decline: deleted with its token or password, the reason told.
- Nobody approves their own; a waiting account is not usable by the mail endpoints or the AI.
"""

import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.mailbox.models import ExternalMailAccount
from agentic.microsoft import access, auth, domains, graph
from agentic.microsoft.errors import ReconnectNeeded
from agentic.models import AuditLog, DepartmentHead, MicrosoftAccount
from agentic.org import work_mail
from agentic.org.models import PersonRequest

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import connect, ms_query, user_id
from .test_office_roles import member, signed_in
from .test_p63_microsoft_signin import configure, sso  # noqa: F401
from .test_p109_mail_accounts import fake_imap  # noqa: F401
from .test_p118_more_accounts import connect_another

MS = "/api/integrations/microsoft"
SALES = {"id": "oid-sales", "mail": "sales@example.com", "userPrincipalName": "sales@example.com"}


def me(name: str) -> dict:
    e = f"{name}@example.com"
    return {"id": f"oid-{name}", "mail": e, "userPrincipalName": e}


async def _person(client, o, name, role="staff", dept="Finance"):
    m = await member(
        client,
        f"{name}@example.com",
        role,
        branch_id=o["branch"]["id"],
        department_id=o["depts"][dept],
    )
    return m, m["member"]["user_id"]


async def _under(client, boss, ids):
    r = await client.put(f"/api/members/{boss}/team", json={"user_ids": ids}, headers=csrf(client))
    assert r.status_code == 200, r.text


async def _decide(c, rid, decision, reason="Fine for the tender team"):
    return await c.post(
        f"/api/requests/{rid}/decide",
        json={"decision": decision, "reason": reason},
        headers=csrf(c),
    )


async def _mailboxes(c) -> dict:
    return {a["email"]: a for a in (await c.get(f"{MS}/my-mailboxes")).json()["accounts"]}


@pytest.fixture
def reads(monkeypatch):
    """The Microsoft 365 page's mail reading, recorded per account."""
    used: list[str] = []

    class G:
        async def folder_messages(self, *_a, **_k):
            return []

    async def for_account(_db, acct):
        used.append(acct.email)
        return G()

    monkeypatch.setattr(graph, "for_account", for_account)
    return used


async def test_staff_work_microsoft_account_waits_for_the_line_manager(
    client,
    llm,
    temporal,
    sso,
    reads,  # noqa: F811
):
    o = await office(client)
    await configure(client)
    sm, sam_id = await _person(client, o, "sam", "supervisor")  # below HOD
    mm, mia_id = await _person(client, o, "mia")
    km, _ = await _person(client, o, "kai")
    await _under(client, mia_id, [sam_id])
    sam = await signed_in("sam@example.com", sm["temp_password"])
    mia = await signed_in("mia@example.com", mm["temp_password"])
    kai = await signed_in("kai@example.com", km["temp_password"])
    try:
        # The main account (their own sign-in) never waits.
        sso.me = me("sam")
        assert ms_query(await connect(sam))["ms"] == "connected"
        # A personal account (free mail, Microsoft's consumer tenant) connects at once.
        sso.me = {
            "id": "oid-home",
            "mail": "sam@outlook.com",
            "userPrincipalName": "sam@outlook.com",
        }
        sso.claims = {"tid": domains.CONSUMER_TENANT}
        assert (await connect_another(sam))["ms"] == "connected"
        # A work account (the company's domain) waits for Mia, whom Sam reports to.
        sso.me, sso.claims = SALES, {}
        got = await connect_another(sam)
        assert got["ms"] == "pending" and got["msg"] == "sales@example.com"
        rows = await _mailboxes(sam)
        assert rows["sam@outlook.com"]["connected"] is True
        assert rows["sam@outlook.com"]["pending"] is False
        sales = rows["sales@example.com"]
        assert sales["pending"] is True and sales["connected"] is False
        assert sales["kind"] == "work" and sales["approval"]["approver_name"] == "Mia"
        rid = sales["approval"]["request_id"]

        # Not usable while it waits: no token, no reading on the page, not the AI's.
        async with SessionLocal() as db:
            acct = await db.get(MicrosoftAccount, sales["id"])
            assert acct.status == "pending" and acct.token_enc  # kept encrypted, unused
            with pytest.raises(ReconnectNeeded):
                await auth.access_token(db, acct)
            assert acct.status not in access.USABLE_ACCOUNT
        r = await sam.get("/api/m365/mail", headers={"X-M365-Account": sales["id"]})
        assert r.status_code == 409 and r.json()["code"] == "waiting_approval"
        assert reads == []
        # Connecting it again keeps it waiting, with the same one request.
        await connect_another(sam)
        assert (await _mailboxes(sam))["sales@example.com"]["pending"] is True

        # Mia sees it (with who, which address and company), and in her bell.
        box = (await mia.get("/api/requests")).json()
        assert [x["id"] for x in box["to_decide"]] == [rid]
        x = box["to_decide"][0]
        assert x["kind"] == "work_mail" and x["requested_by_name"] == "Sam"
        assert (
            x["detail"]["email"] == "sales@example.com" and x["detail"]["domain"] == "example.com"
        )
        assert x["detail"]["source"] == "microsoft" and x["branch_name"] == "MAJU SDN BHD"
        needs = (await mia.get("/api/me/needs")).json()
        assert any(i["key"] == "requests" for i in needs["items"])
        # Nobody approves their own; someone not above Sam may not; a reason is needed.
        r = await _decide(sam, rid, "approve")
        assert r.status_code == 403 and r.json()["code"] == "own_request"
        assert (await _decide(kai, rid, "approve")).status_code == 404
        r = await _decide(mia, rid, "approve", reason="")
        assert r.status_code == 422 and r.json()["code"] == "reason_needed"

        r = await _decide(mia, rid, "approve")
        assert r.status_code == 200 and r.json()["status"] == "approved", r.text
        rows = await _mailboxes(sam)
        assert rows["sales@example.com"]["connected"] is True
        assert rows["sales@example.com"]["pending"] is False
        r = await sam.get("/api/m365/mail", headers={"X-M365-Account": sales["id"]})
        assert r.status_code == 200, r.text
        assert reads == ["sales@example.com"]
        async with SessionLocal() as db:
            acts = set(
                (await db.scalars(select(AuditLog.action).where(AuditLog.target == rid))).all()
            )
        assert {"request.asked", "request.approved"} <= acts
    finally:
        for c in (sam, mia, kai):
            await c.aclose()


async def test_hod_connects_at_once_and_a_refusal_deletes_the_account(
    client,
    llm,
    temporal,
    sso,  # noqa: F811
):
    o = await office(client)
    await configure(client)
    hm, _ = await _person(client, o, "hana", "hod")
    sm, sam_id = await _person(client, o, "sam", "supervisor")
    mm, mia_id = await _person(client, o, "mia")
    await _under(client, mia_id, [sam_id])
    hana = await signed_in("hana@example.com", hm["temp_password"])
    sam = await signed_in("sam@example.com", sm["temp_password"])
    mia = await signed_in("mia@example.com", mm["temp_password"])
    try:
        # A HOD (and anyone above) connects a work account at once, as before.
        sso.me = SALES
        assert (await connect_another(hana))["ms"] == "connected"
        assert (await _mailboxes(hana))["sales@example.com"]["connected"] is True
        assert (await hana.get("/api/requests")).json()["mine"] == []

        # Sam's waits; Mia declines it with a reason: the account and its token are gone.
        sso.me = me("tender")
        assert (await connect_another(sam))["ms"] == "pending"
        acct_id = (await _mailboxes(sam))["tender@example.com"]["id"]
        rid = (await mia.get("/api/requests")).json()["to_decide"][0]["id"]
        r = await _decide(mia, rid, "decline", reason="Another company reads this one")
        assert r.status_code == 200 and r.json()["status"] == "declined"
        async with SessionLocal() as db:
            assert await db.get(MicrosoftAccount, acct_id) is None
        assert "tender@example.com" not in await _mailboxes(sam)
        mine = (await sam.get("/api/requests")).json()["mine"]
        assert mine[0]["status"] == "declined"
        assert mine[0]["decision_note"] == "Another company reads this one"

        # Cancelled by Sam: gone too. Removed from the page: its request is cancelled.
        sso.me = me("accounts")
        assert (await connect_another(sam))["ms"] == "pending"
        row = (await _mailboxes(sam))["accounts@example.com"]
        r = await sam.post(
            f"/api/requests/{row['approval']['request_id']}/cancel", json={}, headers=csrf(sam)
        )
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        assert "accounts@example.com" not in await _mailboxes(sam)
        sso.me = me("admin.desk")
        assert (await connect_another(sam))["ms"] == "pending"
        row = (await _mailboxes(sam))["admin.desk@example.com"]
        r = await sam.request("DELETE", f"{MS}/accounts/{row['id']}", json={}, headers=csrf(sam))
        assert r.status_code == 204
        async with SessionLocal() as db:
            req = await db.get(PersonRequest, row["approval"]["request_id"])
            assert req.status == "cancelled"
            acts = (await db.scalars(select(AuditLog.action).where(AuditLog.target == rid))).all()
            assert {"request.asked", "request.declined"} <= set(acts)
    finally:
        for c in (hana, sam, mia):
            await c.aclose()


async def test_imap_work_account_waits_and_who_is_asked(
    client,
    llm,
    temporal,
    fake_imap,  # noqa: F811
):
    o = await office(client)
    zm, _zed_id = await _person(client, o, "zed")  # reports to no one
    hm, hana_id = await _person(client, o, "hana", "hod")
    ws = (await user_id("zed@example.com"))[1]
    async with SessionLocal() as db:  # Hana heads Finance, Zed's department
        db.add(
            DepartmentHead(department_id=o["depts"]["Finance"], user_id=hana_id, workspace_id=ws)
        )
        await db.commit()
    zed = await signed_in("zed@example.com", zm["temp_password"])
    hana = await signed_in("hana@example.com", hm["temp_password"])
    try:
        # Free mail connects at once.
        r = await zed.post(
            "/api/mail-accounts",
            json={"email": "zed@gmail.com", "provider": "gmail", "password": "app-pw"},
            headers=csrf(zed),
        )
        assert r.status_code == 201 and r.json()["status"] == "ok" and r.json()["pending"] is False
        # A company address that does not sign in is not kept (and asks nobody).
        fake_imap["refuse"] = True
        work = {"email": "zed@example.com", "host": "mail.example.com", "password": "pw-1"}
        r = await zed.post("/api/mail-accounts", json=work, headers=csrf(zed))
        assert r.status_code == 400 and r.json()["code"] == "sign_in_failed"
        fake_imap["refuse"] = False
        listed = (await zed.get("/api/mail-accounts")).json()["accounts"]
        assert [a["email"] for a in listed] == ["zed@gmail.com"]
        # Signed in fine: it waits for the head of Zed's department.
        r = await zed.post("/api/mail-accounts", json=work, headers=csrf(zed))
        assert r.status_code == 201, r.text
        a = r.json()
        assert a["status"] == "pending" and a["pending"] is True
        assert a["approval"]["approver_name"] == "Hana"
        # Unused while it waits: no test, change or backup.
        for method, path in (
            ("POST", f"/api/mail-accounts/{a['id']}/test"),
            ("POST", f"/api/mail-accounts/{a['id']}/backup"),
            ("PATCH", f"/api/mail-accounts/{a['id']}"),
        ):
            r = await zed.request(method, path, json={}, headers=csrf(zed))
            assert r.status_code == 409 and r.json()["code"] == "waiting_approval", path
        async with SessionLocal() as db:
            req = (
                await db.scalars(select(PersonRequest).where(PersonRequest.kind == "work_mail"))
            ).one()
            assert req.approver_id == hana_id and req.data["source"] == "imap"
            row = await db.get(ExternalMailAccount, a["id"])
            assert row.secret_enc and "pw-1" not in row.secret_enc
        # Hana (asked first, though Zed does not report to her) approves: usable at once.
        box = (await hana.get("/api/requests")).json()
        assert [x["id"] for x in box["to_decide"]] == [req.id]
        r = await _decide(hana, req.id, "approve", reason="Zed handles HQ mail")
        assert r.status_code == 200 and r.json()["status"] == "approved", r.text
        listed = {x["email"]: x for x in (await zed.get("/api/mail-accounts")).json()["accounts"]}
        assert listed["zed@example.com"]["status"] == "ok"
        assert listed["zed@example.com"]["pending"] is False
        r = await zed.post(f"/api/mail-accounts/{a['id']}/test", json={}, headers=csrf(zed))
        assert r.status_code == 200 and r.json()["status"] == "ok"
    finally:
        await zed.aclose()
        await hana.aclose()


async def test_no_one_above_then_branch_manager_then_owners(client, llm, temporal):  # noqa: F811
    o = await office(client)
    _, ali = await _person(client, o, "ali")
    ws = (await user_id("ali@example.com"))[1]
    owner = (await user_id("owner@example.com"))[0]
    async with SessionLocal() as db:
        # Nobody above Ali, no head of his department, no branch manager: the office's owners.
        assert await work_mail.approver_for(db, ws, ali) is None
        assert await work_mail.office_admins(db, ws, ali) == [owner]
    _, bm = await _person(client, o, "bob", "branch_manager")
    async with SessionLocal() as db:
        assert await work_mail.approver_for(db, ws, ali) == bm
        assert work_mail.needs_approval("staff") and work_mail.needs_approval("supervisor")
        assert not any(
            work_mail.needs_approval(r)
            for r in ("owner", "admin", "management", "hr", "branch_manager", "hod", "group_hod")
        )


async def test_main_account_connects_at_once_only_as_their_own_identity(
    client,
    llm,
    temporal,
    sso,
    reads,  # noqa: F811
):
    o = await office(client)
    await configure(client)
    sm, sam_id = await _person(client, o, "sam", "supervisor")
    zm, _ = await _person(client, o, "zoe", "supervisor")
    hm, _ = await _person(client, o, "hana", "hod")
    mm, mia_id = await _person(client, o, "mia")
    await _under(client, mia_id, [sam_id])
    sam, zoe, hana, mia = [
        await signed_in(f"{n}@example.com", m["temp_password"])
        for n, m in (("sam", sm), ("zoe", zm), ("hana", hm), ("mia", mm))
    ]
    try:
        # Zoe's own identity (her sign-in email, no Microsoft id recorded yet): at once.
        sso.me = me("zoe")
        assert ms_query(await connect(zoe))["ms"] == "connected"
        assert (await zoe.get(f"{MS}/account")).json()["connected"] is True

        # Sam connects someone else's work mailbox as his main account: it waits for Mia.
        sso.me = SALES
        got = ms_query(await connect(sam))
        assert got["ms"] == "pending" and got["msg"] == "sales@example.com"
        main = (await sam.get(f"{MS}/account")).json()
        assert main["connected"] is False and main["pending"] is True
        assert main["email"] == "sales@example.com"
        assert main["approval"]["approver_name"] == "Mia"
        row = (await _mailboxes(sam))["sales@example.com"]
        assert row["primary"] is True and row["pending"] is True
        # Nothing uses it: no mail on the page, not the AI's or Prima's identity.
        r = await sam.get("/api/m365/mail")
        assert r.status_code == 409 and reads == []
        ws = (await user_id("sam@example.com"))[1]
        async with SessionLocal() as db:
            assert await access.personal_account_of(db, ws, sam_id) is None
            from agentic.models import Membership

            m = await db.get(Membership, (ws, sam_id))
            assert m.ms_oid is None
            assert "example.com" in await domains.company_domains(db, ws, "sam@example.com")

        rid = (await mia.get("/api/requests")).json()["to_decide"][0]["id"]
        r = await _decide(mia, rid, "approve", reason="Sam runs the sales mailbox")
        assert r.status_code == 200 and r.json()["status"] == "approved", r.text
        main = (await sam.get(f"{MS}/account")).json()
        assert main["connected"] is True and main["email"] == "sales@example.com"
        assert (await sam.get("/api/m365/mail")).status_code == 200
        assert reads == ["sales@example.com"]

        # A HOD connects another identity as main at once, as before.
        sso.me = me("tender")
        assert ms_query(await connect(hana))["ms"] == "connected"
        assert (await hana.get(f"{MS}/account")).json()["email"] == "tender@example.com"
    finally:
        for c in (sam, zoe, hana, mia):
            await c.aclose()


async def test_admin_only_permissions_only_for_the_approving_organisation(client, llm, temporal):  # noqa: F811
    """P124: sign-in and connect ask for the admin-only permissions (Teams channel messages,
    Teams Approvals) only from people of the organisation whose admin approved the office;
    anyone else would stop at Microsoft's "Need admin approval" over them."""
    from agentic.microsoft import app as ms_app
    from agentic.models import Membership

    o = await office(client)
    ws_id = (
        o["workspace"]["id"]
        if "workspace" in o
        else (await client.get("/api/auth/me")).json()["workspace"]["id"]
    )
    owner, _ = await user_id("owner@example.com")
    cfg = ms_app.AppConfig(
        client_id="c", client_secret="s", tenant="organizations", admin_tenant="tid-home",
        teams_channels=True, teams_approvals=True,
    )  # fmt: skip
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws_id, owner))
        m.ms_tenant_id = "tid-other"
        await db.commit()
        other = await auth.scopes_for(db, cfg, ws_id, owner, False)
        assert "ChannelMessage.Read.All" not in other and "ApprovalSolution.ReadWrite" not in other
        assert "Mail.ReadWrite" in other and "Chat.Read" in other
        m.ms_tenant_id = "TID-HOME"
        await db.commit()
        home = await auth.scopes_for(db, cfg, ws_id, owner, False)
        assert "ChannelMessage.Read.All" in home and "ApprovalSolution.ReadWrite" in home
        # Not known at all (a first sign-in by someone new): the light set.
        assert "ApprovalSolution.ReadWrite" not in await auth.scopes_for(
            db, cfg, ws_id, None, False
        )
