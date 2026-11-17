"""P109: heads of several departments and who reports to whom (Members), the Library by
department, files uploaded for other companies, and feedback for high management with comments
and @mentions."""

import pytest
from sqlalchemy import select, text, update

from agentic.core.db import SessionLocal
from agentic.documents import service
from agentic.feedback.models import Feedback, FeedbackComment
from agentic.knowledge import search as library
from agentic.models import Agent, AuditLog, DepartmentHead, DocFile, FileHandoff, Workspace
from agentic.services import notices, signin_mail

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_documents import inline_reading, upload  # noqa: F401
from .test_library import guideline, indexing  # noqa: F401
from .test_office_roles import as_role, member


@pytest.fixture(autouse=True)
async def wipe_chunks():
    async with SessionLocal() as db:
        await db.execute(text("TRUNCATE knowledge_chunks RESTART IDENTITY"))
        await db.commit()


@pytest.fixture
def mail(monkeypatch):
    """No real email ever: every notice email lands here."""
    sent: list[dict] = []

    async def send(db, workspace_id, **kw):
        sent.append(kw)

    monkeypatch.setattr(notices.sendmail, "send", send)
    return sent


async def mail_on(client) -> None:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        ws.settings = {
            **(ws.settings or {}),
            "system_mail": {"enabled": True, "address": "office@example.com"},
        }
        await db.commit()


def jh(c) -> dict[str, str]:
    return {**csrf(c), "content-type": "application/json"}


async def audit_actions() -> list[str]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(AuditLog.action))).all())


async def two_companies(client) -> dict:
    o = await office(client)
    b2 = (await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=jh(client))).json()
    o["b2"] = b2
    o["b2_depts"] = {d["name"]: d["id"] for d in b2["departments"]}
    return o


# ================================================================ A. hierarchy


async def test_head_of_several_departments_team_and_filters(client):
    o = await two_companies(client)
    fin, ops = o["depts"]["Finance"], o["depts"]["Operations"]
    far_fin = o["b2_depts"]["Finance"]
    hod = (await member(client, "hod@example.com", "hod", department_id=fin))["member"]
    s1 = (await member(client, "s1@example.com", "staff", department_id=fin))["member"]
    s2 = (await member(client, "s2@example.com", "staff", department_id=ops))["member"]
    uid = hod["user_id"]

    r = await client.patch(
        f"/api/members/{uid}", json={"head_of": [fin, far_fin]}, headers=jh(client)
    )
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["heads_department"] is True
    assert {d["id"] for d in m["head_of"]} == {fin, far_fin}
    assert {d["branch_name"] for d in m["head_of"]} == {"Maju Sdn Bhd", "Jaya Bhd"}

    # People under them: searchable multi-select sets their "reports to".
    r = await client.put(
        f"/api/members/{uid}/team",
        json={"user_ids": [s1["user_id"], s2["user_id"]]},
        headers=jh(client),
    )
    assert r.status_code == 200 and r.json()["done"] == 2, r.text
    team = (await client.get(f"/api/members/{uid}/team")).json()
    assert {t["user_id"] for t in team} == {s1["user_id"], s2["user_id"]}

    page = (await client.get("/api/members", params={"page": 1, "team": "heads"})).json()
    assert [x["user_id"] for x in page["items"]] == [uid]
    assert page["items"][0]["manages"] == 2
    page = (await client.get("/api/members", params={"page": 1, "team": "managers"})).json()
    assert [x["user_id"] for x in page["items"]] == [uid]
    page = (await client.get("/api/members", params={"page": 1, "team": uid})).json()
    assert {x["user_id"] for x in page["items"]} == {s1["user_id"], s2["user_id"]}
    page = (await client.get("/api/members", params={"page": 1, "team": "unplaced"})).json()
    assert uid in {x["user_id"] for x in page["items"]}
    assert s1["user_id"] not in {x["user_id"] for x in page["items"]}

    # Reports to (single picker) on one person.
    r = await client.patch(
        f"/api/members/{s1['user_id']}", json={"reports_to_user_id": None}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["reports_to_user_id"] is None

    # The old switch keeps the other departments they head.
    r = await client.patch(
        f"/api/members/{uid}", json={"heads_department": False}, headers=jh(client)
    )
    assert [d["id"] for d in r.json()["head_of"]] == [far_fin]
    r = await client.patch(f"/api/members/{uid}", json={"head_of": []}, headers=jh(client))
    assert r.json()["head_of"] == [] and r.json()["heads_department"] is False

    bad = await client.patch(
        f"/api/members/{uid}", json={"head_of": ["dp_nope"]}, headers=jh(client)
    )
    assert bad.status_code == 400

    acts = await audit_actions()
    assert acts.count("member.head_changed") == 3
    assert "member.manager_changed" in acts


async def test_only_people_managers_change_heads(client):
    o = await two_companies(client)
    fin = o["depts"]["Finance"]
    target = (await member(client, "t@example.com", "staff", department_id=fin))["member"]
    staff = await as_role(client, "st@example.com", "staff", department_id=fin)
    r = await staff.patch(
        f"/api/members/{target['user_id']}", json={"head_of": [fin]}, headers=jh(staff)
    )
    assert r.status_code == 403
    hod = await as_role(client, "hod2@example.com", "hod", department_id=fin)
    r = await hod.patch(
        f"/api/members/{target['user_id']}", json={"head_of": [fin]}, headers=jh(hod)
    )
    assert r.status_code == 403  # only owners, admins, management, HR set the organisation
    async with SessionLocal() as db:
        assert (await db.scalar(select(DepartmentHead))) is None
    await staff.aclose()
    await hod.aclose()


async def test_moving_department_drops_only_that_headship(client):
    o = await two_companies(client)
    fin, ops = o["depts"]["Finance"], o["depts"]["Operations"]
    far = o["b2_depts"]["Finance"]
    hod = (await member(client, "h3@example.com", "hod", department_id=fin))["member"]
    uid = hod["user_id"]
    await client.patch(f"/api/members/{uid}", json={"head_of": [fin, far]}, headers=jh(client))
    r = await client.patch(
        f"/api/members/{uid}",
        json={"role": "hod", "department_id": ops},
        headers=jh(client),
    )
    assert r.status_code == 200, r.text
    assert [d["id"] for d in r.json()["head_of"]] == [far]
    r = await client.delete(f"/api/members/{uid}", headers=jh(client))
    assert r.status_code == 204
    async with SessionLocal() as db:
        assert (await db.scalar(select(DepartmentHead))) is None


# ================================================================ B. Library by department


async def test_library_own_department_only(client, llm, temporal, inline_reading, indexing):  # noqa: F811
    o = await two_companies(client)
    fin, ops = o["depts"]["Finance"], o["depts"]["Operations"]
    company = await guideline(
        client, "c.txt", "Uniform policy: everyone wears green.", branch_id=o["branch"]["id"]
    )
    finance = await guideline(
        client, "f.txt", "Uniform policy: Finance wears a tie.", department_id=fin
    )
    opsdoc = await guideline(
        client, "o.txt", "Uniform policy: Operations wear boots.", department_id=ops
    )

    email = "lim@example.com"
    staff = await as_role(client, email, "staff", department_id=fin)
    me = (await staff.get("/api/auth/me")).json()["user"]["id"]

    def ids(rows):
        return {x["id"] for x in rows}

    before = ids((await staff.get("/api/library")).json()["sources"])
    assert {company["id"], finance["id"], opsdoc["id"]} <= before

    # Staff may not change it for themselves; an owner sets it.
    r = await staff.put(
        f"/api/members/{me}/library", json={"library_scope": "department"}, headers=jh(staff)
    )
    assert r.status_code == 403
    r = await client.put(
        f"/api/members/{me}/library", json={"library_scope": "department"}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["library_scope"] == "department", r.text
    assert "member.library_access_changed" in await audit_actions()

    listed = ids((await staff.get("/api/library")).json()["sources"])
    assert finance["id"] in listed and not ({company["id"], opsdoc["id"]} & listed)
    got = {
        h["source_id"]
        for h in (await staff.get("/api/library/search", params={"q": "uniform policy"})).json()
    }
    assert got == {finance["id"]}
    files = (await staff.get("/api/files")).json()
    file_ids = {f["id"] for f in (files["items"] if isinstance(files, dict) else files)}
    assert finance["id"] in file_ids and opsdoc["id"] not in file_ids
    assert company["id"] not in file_ids
    assert (await staff.get(f"/api/files/{opsdoc['id']}")).status_code == 404
    assert (await staff.get(f"/api/files/{finance['id']}")).status_code == 200

    # Their own uploads stay theirs.
    own = (await upload(staff, "mine.txt", b"Uniform policy notes of mine.")).json()
    assert (await staff.get(f"/api/files/{own['id']}")).status_code == 200

    # Their AI (an agent they own) reads only the same: library search, recall and files.
    twin = await new_agent(client, o, "Lim helper", "Finance")
    company_agent = await new_agent(client, o, "Company helper", "Finance")
    async with SessionLocal() as db:
        await db.execute(update(Agent).where(Agent.id == twin["id"]).values(owner_user_id=me))
        await db.commit()
        a = await db.get(Agent, twin["id"])
        hits = {
            h.source_id
            for h in await library.search(db, library.for_agent(a), "uniform policy", limit=10)
        }
        assert hits == {finance["id"]}
        readable = set(
            (
                await db.scalars(
                    select(DocFile.id).where(DocFile.library.is_(True), service.agent_files(a))
                )
            ).all()
        )
        assert readable == {finance["id"]}
        # A company agent (no owner) reads the company as before.
        c = await db.get(Agent, company_agent["id"])
        hits = {
            h.source_id
            for h in await library.search(db, library.for_agent(c), "uniform policy", limit=10)
        }
        assert {company["id"], finance["id"], opsdoc["id"]} <= hits

    # Back to the whole company: everything returns, for them and their AI.
    r = await client.put(
        f"/api/members/{me}/library", json={"library_scope": "company"}, headers=jh(client)
    )
    assert r.status_code == 200
    staff2 = await as_role(client, "other@example.com", "staff", department_id=fin)
    await staff2.aclose()
    back = ids((await staff.get("/api/library")).json()["sources"])
    assert {company["id"], finance["id"], opsdoc["id"]} <= back
    async with SessionLocal() as db:
        a = await db.get(Agent, twin["id"])
        hits = {
            h.source_id
            for h in await library.search(db, library.for_agent(a), "uniform policy", limit=10)
        }
        assert {company["id"], finance["id"], opsdoc["id"]} <= hits
    await staff.aclose()


async def test_owners_see_everything_whatever_the_setting(client, inline_reading, indexing):  # noqa: F811
    o = await two_companies(client)
    ops = await guideline(
        client, "o.txt", "Boots policy for operations.", department_id=o["depts"]["Operations"]
    )
    adm = (await member(client, "adm@example.com", "admin"))["member"]
    r = await client.put(
        f"/api/members/{adm['user_id']}/library",
        json={"library_scope": "department"},
        headers=jh(client),
    )
    assert r.status_code == 200
    admin = await as_role(client, "adm2@example.com", "admin")
    assert ops["id"] in {x["id"] for x in (await admin.get("/api/library")).json()["sources"]}
    await admin.aclose()


# ================================================================ C. files for other companies


async def test_upload_for_other_companies_check_and_hand_over(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    inline_reading,  # noqa: F811
    indexing,  # noqa: F811
    mail,
):
    o = await two_companies(client)
    await mail_on(client)
    fin = o["depts"]["Finance"]
    far_fin = o["b2_depts"]["Finance"]
    far_hod = (await member(client, "jaya.hod@example.com", "hod", department_id=far_fin))["member"]
    await client.patch(
        f"/api/members/{far_hod['user_id']}", json={"head_of": [far_fin]}, headers=jh(client)
    )
    email = "aina@example.com"
    staff = await as_role(client, email, "staff", department_id=fin)
    me = (await staff.get("/api/auth/me")).json()["user"]["id"]

    # Not allowed until switched on (a task alone is not enough).
    t = (await staff.get("/api/handoffs/targets")).json()
    assert t == {"allowed": False, "companies": []}
    params = {"name": "jaya-ssm.txt", "companies": o["b2"]["id"]}
    r = await staff.post(
        "/api/handoffs",
        params=params,
        content=b"Jaya Bhd SSM certificate 2026.",
        headers={**csrf(staff), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 403
    r = await client.put(
        f"/api/members/{me}/library", json={"uploads_for_others": True}, headers=jh(client)
    )
    assert r.status_code == 200 and r.json()["uploads_for_others"] is True
    t = (await staff.get("/api/handoffs/targets")).json()
    assert t["allowed"] and {c["name"] for c in t["companies"]} == {"Maju Sdn Bhd", "Jaya Bhd"}

    # One file for both companies, with a typed title; one for Jaya with the AI's.
    r = await staff.post(
        "/api/handoffs",
        params={
            "name": "ssm.txt",
            "companies": f"{o['b2']['id']},{o['branch']['id']}",
            "title": "SSM certificates",
        },
        content=b"Company registration certificate, valid until 2027.",
        headers={**csrf(staff), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    both = r.json()
    assert len(both) == 2 and {h["title"] for h in both} == {"SSM certificates"}
    r = await staff.post(
        "/api/handoffs",
        params={"name": "bank.txt", "companies": o["b2"]["id"]},
        content=b"Bank statement October for Jaya Bhd.",
        headers={**csrf(staff), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    [bank] = r.json()
    assert not bank["typed_title"]
    await signin_mail.drain()

    # The Jaya head was told in the app and by email (with the link, who and what).
    assert any(m["to"] == "jaya.hod@example.com" for m in mail)
    jmail = [m for m in mail if m["to"] == "jaya.hod@example.com"]
    assert "Aina" in jmail[0]["html"] and "/handoffs?tab=received" in jmail[0]["html"]
    assert "office@example.com" == jmail[0]["sender"]
    jaya_hod = await _signed_in_as(client, "jaya.hod@example.com")
    needs = (await jaya_hod.get("/api/me/needs")).json()
    assert {i["key"] for i in needs["items"]} >= {"handoffs_in"}
    incoming = (await jaya_hod.get("/api/handoffs/incoming")).json()
    jaya_id = o["b2"]["id"]
    assert {h["company_id"] for h in incoming} == {jaya_id}
    assert len(incoming) == 2 and all(h["new"] for h in incoming)
    needs = (await jaya_hod.get("/api/me/needs")).json()
    assert "handoffs_in" not in {i["key"] for i in needs["items"]}  # opened: seen
    # The head reads the waiting file itself, but it is not in their Library yet.
    first = next(h for h in incoming if h["title"] == "SSM certificates")
    assert (await jaya_hod.get(f"/api/handoffs/{first['id']}/file")).status_code == 200
    assert first["file_id"] not in {
        x["id"] for x in (await jaya_hod.get("/api/library")).json()["sources"]
    }

    # The uploader sees what waits for their check, may fix it, then approves.
    mine = (await staff.get("/api/handoffs/mine")).json()
    assert len(mine["pending"]) == 3 and mine["approved"] == []
    needs = (await staff.get("/api/me/needs")).json()
    assert {"handoffs_check"} <= {i["key"] for i in needs["items"]}
    r = await staff.patch(
        f"/api/handoffs/{bank['id']}",
        json={"title": "Jaya bank statement Oct"},
        headers=jh(staff),
    )
    assert r.status_code == 200 and r.json()["title"] == "Jaya bank statement Oct"
    async with SessionLocal() as db:
        f = await db.get(DocFile, bank["file_id"])
        assert f.title == "Jaya bank statement Oct" and f.branch_id == jaya_id
        assert f.library is False and f.owner_user_id is None
    assert (await staff.get(f"/api/files/{bank['file_id']}")).status_code == 200

    r = await staff.post(f"/api/handoffs/{bank['id']}/approve", headers=jh(staff))
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    assert r.json()["file_id"] is None  # only the line stays with them
    # It left the uploader's view; the company has it in its Library.
    assert (await staff.get(f"/api/files/{bank['file_id']}")).status_code == 404
    assert (await staff.get(f"/api/handoffs/{bank['id']}/file")).status_code == 404
    mine = (await staff.get("/api/handoffs/mine")).json()
    assert len(mine["pending"]) == 2 and [h["id"] for h in mine["approved"]] == [bank["id"]]
    async with SessionLocal() as db:
        f = await db.get(DocFile, bank["file_id"])
        assert f.library is True  # bank statements read as confidential: restricted too
    jaya_staff = await as_role(client, "j.staff@example.com", "staff", branch_id=jaya_id)
    owner_lib = {x["id"] for x in (await client.get("/api/library")).json()["sources"]}
    assert bank["file_id"] in owner_lib
    await jaya_staff.aclose()

    # Taking back a waiting one removes it; an approved one cannot be taken back.
    other = next(h for h in mine["pending"] if h["company_id"] == o["branch"]["id"])
    r = await staff.delete(f"/api/handoffs/{other['id']}", headers=jh(staff))
    assert r.status_code == 204
    r = await staff.delete(f"/api/handoffs/{bank['id']}", headers=jh(staff))
    assert r.status_code == 409
    acts = await audit_actions()
    for a in ("file.handoff_uploaded", "file.handoff_changed", "file.handoff_approved"):
        assert a in acts
    assert "file.handoff_withdrawn" in acts

    # Someone else's upload is not theirs to see or approve.
    nosy = await as_role(client, "nosy@example.com", "staff", department_id=fin)
    left = next(h for h in mine["pending"] if h["id"] != other["id"])
    assert (
        await nosy.post(f"/api/handoffs/{left['id']}/approve", headers=jh(nosy))
    ).status_code == 404
    assert (await nosy.get(f"/api/handoffs/{left['id']}/file")).status_code == 404
    assert (await nosy.get("/api/handoffs/incoming")).json() == []
    for c in (staff, jaya_hod, nosy):
        await c.aclose()


async def test_handoff_falls_back_to_managers_without_heads(
    client,
    inline_reading,  # noqa: F811
    mail,
):
    o = await two_companies(client)
    await mail_on(client)
    bm = (await member(client, "bm.jaya@example.com", "branch_manager", branch_id=o["b2"]["id"]))[
        "member"
    ]
    r = await client.post(
        "/api/handoffs",
        params={"name": "x.txt", "companies": o["b2"]["id"]},
        content=b"Some file for Jaya.",
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    await signin_mail.drain()
    async with SessionLocal() as db:
        h = await db.scalar(select(FileHandoff))
        assert h.notified == [bm["user_id"]]
    assert [m["to"] for m in mail] == ["bm.jaya@example.com"]


async def test_no_email_without_system_mail(client, inline_reading, mail):  # noqa: F811
    o = await two_companies(client)
    await member(client, "bm2@example.com", "branch_manager", branch_id=o["b2"]["id"])
    r = await client.post(
        "/api/handoffs",
        params={"name": "x.txt", "companies": o["b2"]["id"]},
        content=b"Some file.",
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201
    await signin_mail.drain()
    assert mail == []


# ================================================================ D. feedback


async def _signed_in_as(owner, email: str):
    """Sign in as a member made by `member` earlier (a fresh temporary password)."""
    from .test_office_roles import signed_in

    async with SessionLocal() as db:
        from agentic.models import User

        u = await db.scalar(select(User).where(User.email == email))
        uid = u.id
    r = await owner.post(f"/api/members/{uid}/reset-password", headers=jh(owner))
    assert r.status_code == 200, r.text
    return await signed_in(email, r.json()["temp_password"])


async def _feedback(client, note: str = "The Members page is slow") -> str:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        fb = Feedback(
            workspace_id=ws.id,
            author_name="Someone",
            author_role="staff",
            kind="general",
            category="bug",
            note=note,
            page_path="/settings/members",
            context={},
        )
        db.add(fb)
        await db.commit()
        return fb.id


async def test_feedback_for_owners_and_management_with_mentions(client, mail):
    await office(client)
    await mail_on(client)
    fid = await _feedback(client)
    mgmt = await as_role(client, "ceo.office@example.com", "management")
    mgmt2 = await as_role(client, "coo@example.com", "management")
    admin = await as_role(client, "hr.person@example.com", "hr")

    me = (await mgmt.get("/api/auth/me")).json()
    assert "feedback.read" in me["permissions"] and "feedback.manage" not in me["permissions"]
    owner_me = (await client.get("/api/auth/me")).json()
    assert "feedback.read" in owner_me["permissions"]
    assert "feedback.read" not in (await admin.get("/api/auth/me")).json()["permissions"]

    # Management, admins and owners read the inbox; HR (not high management) does not.
    r = await mgmt.get("/api/feedback")
    assert r.status_code == 200 and [x["id"] for x in r.json()["items"]] == [fid]
    assert (await client.get("/api/feedback")).status_code == 200
    assert (await admin.get("/api/feedback")).status_code == 403
    # Still the developer's: moving it along, answering, deleting, the switch.
    r = await mgmt.patch(f"/api/feedback/{fid}", json={"status": "done"}, headers=jh(mgmt))
    assert r.status_code == 403

    readers = (await mgmt.get("/api/feedback/readers")).json()
    names = {x["name"] for x in readers}
    assert names == {"Owner One", "Ceo.Office", "Coo"}
    assert (await admin.get("/api/feedback/readers")).status_code == 403
    coo = next(x for x in readers if x["name"] == "Coo")

    # A comment mentioning the COO: they are told in the app and by email, with the link.
    r = await mgmt.post(
        f"/api/feedback/{fid}/comments",
        json={"body": "@Coo can you look at this?", "mentions": [coo["user_id"]]},
        headers=jh(mgmt),
    )
    assert r.status_code == 201, r.text
    assert [m["name"] for m in r.json()["mentions"]] == ["Coo"]
    await signin_mail.drain()
    assert [m["to"] for m in mail] == ["coo@example.com"]
    assert f"/feedbacks?f={fid}" in mail[0]["html"]
    needs = (await mgmt2.get("/api/me/needs")).json()
    [entry] = [e for e in needs["entries"] if e["key"] == "mentions"]
    assert entry["search"] == {"f": fid}
    comments = (await mgmt2.get(f"/api/feedback/{fid}/comments")).json()
    assert [c["body"] for c in comments] == ["@Coo can you look at this?"]
    needs = (await mgmt2.get("/api/me/needs")).json()
    assert "mentions" not in {i["key"] for i in needs["items"]}
    r = await client.get("/api/feedback")
    assert r.json()["items"][0]["comments"] == 1

    # Mentioning someone who does not read feedback is refused; HR cannot comment.
    adm_id = (await admin.get("/api/auth/me")).json()["user"]["id"]
    r = await mgmt.post(
        f"/api/feedback/{fid}/comments",
        json={"body": "fyi", "mentions": [adm_id]},
        headers=jh(mgmt),
    )
    assert r.status_code == 400
    r = await admin.post(f"/api/feedback/{fid}/comments", json={"body": "hi"}, headers=jh(admin))
    assert r.status_code == 403
    assert (await admin.get(f"/api/feedback/{fid}/comments")).status_code == 403
    assert "feedback.comment" in await audit_actions()
    async with SessionLocal() as db:
        assert (await db.scalar(select(FeedbackComment))).mentions == [coo["user_id"]]
    # Fitri, 17 Nov 2026: admins are high management too: they read and comment.
    adm = await as_role(client, "it.admin@example.com", "admin")
    assert "feedback.read" in (await adm.get("/api/auth/me")).json()["permissions"]
    assert (await adm.get("/api/feedback")).status_code == 200
    r = await adm.post(f"/api/feedback/{fid}/comments", json={"body": "noted"}, headers=jh(adm))
    assert r.status_code == 201, r.text
    for c in (mgmt, mgmt2, admin, adm):
        await c.aclose()


async def test_staff_never_read_feedback(client):
    o = await office(client)
    fid = await _feedback(client)
    staff = await as_role(client, "s.fb@example.com", "staff", department_id=o["depts"]["Finance"])
    hod = await as_role(client, "h.fb@example.com", "hod", department_id=o["depts"]["Finance"])
    for c in (staff, hod):
        assert (await c.get("/api/feedback")).status_code == 403
        assert (await c.get("/api/feedback/readers")).status_code == 403
        assert (await c.get(f"/api/feedback/{fid}/comments")).status_code == 403
        assert (await c.get(f"/api/feedback/{fid}/screenshot")).status_code == 404
        assert "feedback.read" not in (await c.get("/api/auth/me")).json()["permissions"]
        await c.aclose()
