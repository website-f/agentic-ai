"""P113: the organization chart for everyone. Fitri (18 Nov 2026): "make it available for all
staff like hq, hr, branch manager, hod ... for hq, branch manager, admins, HOD they can edit,
only lower than that just view only". Every member sees the whole organization (their own
part in full, everyone else by name, job title, company and department only); owners, admins,
management (HQ) and HR change any line and job title; branch managers and HODs only the people
of their branch or department, never their own line; supervisors and staff only look.
Synthetic people only."""

import httpx
from sqlalchemy import update

from agentic.core.db import SessionLocal
from agentic.models import User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import PW, member, signed_in


async def _org(client):
    """Owner; HQ: management Mia, HR Hani, admin Adi, and Unit HR staff Hq (another company);
    branch 1: branch manager Bea, Finance HOD Hana, supervisor Sue (Finance), staff Sara and
    Tom (Finance), Omar (Operations). Lines: Bea > Mia, Hana > Bea, Sara > Hana, Tom > Sara."""
    o = await office(client)
    bid, fin, ops = o["branch"]["id"], o["depts"]["Finance"], o["depts"]["Operations"]
    unit = (
        await client.post("/api/branches", json={"name": "Unit HR"}, headers=csrf(client))
    ).json()
    made = {}
    for email, role, where in [
        ("mia@example.com", "management", {}),
        ("hani@example.com", "hr", {}),
        ("adi@example.com", "admin", {}),
        ("hq@example.com", "staff", {"branch_id": unit["id"]}),
        ("bea@example.com", "branch_manager", {"branch_id": bid}),
        ("hana@example.com", "hod", {"department_id": fin}),
        ("sue@example.com", "supervisor", {"department_id": fin}),
        ("sara@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("tom@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("omar@example.com", "staff", {"branch_id": bid, "department_id": ops}),
    ]:
        made[email.split("@")[0]] = await member(client, email, role, **where)
    ids = {k: v["member"]["user_id"] for k, v in made.items()}
    for who, boss in [("bea", "mia"), ("hana", "bea"), ("sara", "hana"), ("tom", "sara")]:
        assert (await _set(client, ids[who], ids[boss])).status_code == 200
    return made, ids


async def _as(made, name):
    """Signed in as them (the first time with their one-time password, then with PW)."""
    email = f"{name}@example.com"
    if made[name].get("signed_in"):
        from agentic.api.main import app

        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        r = await c.post("/api/auth/login", json={"email": email, "password": PW})
        assert r.status_code == 200, r.text
        return c
    made[name]["signed_in"] = True
    return await signed_in(email, made[name]["temp_password"])


async def _set(c, uid, boss):
    return await c.patch(f"/api/members/{uid}", json={"reports_to_user_id": boss}, headers=csrf(c))


async def _title(c, uid, title):
    return await c.patch(f"/api/members/{uid}", json={"job_title": title}, headers=csrf(c))


async def test_everyone_sees_the_whole_chart(client):
    made, ids = await _org(client)
    owner = (await client.get("/api/auth/me")).json()["user"]["id"]
    everyone = {*ids.values(), owner}
    # A switched-off account shows only to those who see its person in full (or above them).
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == ids["hq"]).values(is_active=False))
        await db.commit()

    owner_chart = (await client.get("/api/members/hierarchy")).json()
    assert {p["user_id"] for p in owner_chart["people"]} == everyone
    assert owner_chart["edit_scope"] == "all" and owner_chart["can_edit"] is True

    for name in ("tom", "sue", "hana", "bea"):
        c = await _as(made, name)
        try:
            chart = (await c.get("/api/members/hierarchy")).json()
            by = {p["user_id"]: p for p in chart["people"]}
            assert set(by) == everyone - {ids["hq"]}, name  # the HQ side too (its active people)
            # Their own part in full; the rest by name, title, company and department only.
            me = by[ids[name]]
            assert me["limited"] is False and me["role"] is not None
            far = by[owner]
            assert far["limited"] is True and far["role"] is None and far["direct_reports"] is None
            assert far["name"] and "email" not in far
            if name in ("tom", "sue"):  # below HOD: view only
                assert chart["can_edit"] is False and chart["edit_scope"] is None, name
                assert not any(p["editable"] for p in chart["people"]), name
        finally:
            await c.aclose()

    # Staff see the HQ units' active people (by name and company only).
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == ids["hq"]).values(is_active=True))
        await db.commit()
    tom = await _as(made, "tom")
    try:
        chart = (await tom.get("/api/members/hierarchy")).json()
        hq = next(p for p in chart["people"] if p["user_id"] == ids["hq"])
        assert hq["limited"] is True and hq["branch_name"] == "UNIT HR"
        mine = (await tom.get("/api/members/hierarchy/mine")).json()
        assert [p["name"] for p in mine["chain"]] == ["Sara", "Hana", "Bea", "Mia"]
    finally:
        await tom.aclose()


async def test_hq_hr_and_admins_edit_the_whole_workspace(client):
    made, ids = await _org(client)
    for name, target, boss in [
        ("mia", "hq", "hani"),
        ("hani", "omar", "hana"),
        ("adi", "hq", "adi"),
    ]:
        c = await _as(made, name)
        try:
            chart = (await c.get("/api/members/hierarchy")).json()
            assert chart["edit_scope"] == "all" and chart["whole"] is True
            assert not any(p["limited"] for p in chart["people"])
            r = await _set(c, ids[target], ids[boss])
            assert r.status_code == 200, (name, r.text)
            r = await _title(c, ids[target], "Executive")
            assert r.status_code == 200 and r.json()["job_title"] == "Executive"
            # Never their own line.
            r = await _set(c, ids[name], ids["bea"])
            assert r.status_code == 400 and r.json()["code"] == "self_change"
        finally:
            await c.aclose()


async def test_branch_managers_and_hods_edit_their_own_people(client):
    made, ids = await _org(client)
    bea = await _as(made, "bea")
    try:
        chart = (await bea.get("/api/members/hierarchy")).json()
        assert chart["can_edit"] is True and chart["edit_scope"] == "branch"
        editable = {p["user_id"] for p in chart["people"] if p["editable"]}
        assert editable == {ids[k] for k in ("hana", "sue", "sara", "tom", "omar")}
        # Their branch's people, under someone of the branch, themselves or their own manager.
        assert (await _set(bea, ids["omar"], ids["hana"])).status_code == 200
        assert (await _set(bea, ids["omar"], ids["mia"])).status_code == 200  # above Bea
        assert (await _set(bea, ids["sue"], ids["bea"])).status_code == 200
        r = await _title(bea, ids["hana"], "Head of Finance")
        assert r.status_code == 200 and r.json()["job_title"] == "Head of Finance"
        # Not someone of another company, nor under someone outside their part of the chart.
        r = await _set(bea, ids["hq"], ids["bea"])
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        r = await _title(bea, ids["hq"], "Clerk")
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        r = await _set(bea, ids["sara"], ids["hq"])
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        r = await bea.patch(
            f"/api/members/{ids['sara']}",
            json={"reports_to_user_id": ids["hq"]},
            headers={**csrf(bea), "X-Lang": "ms"},
        )
        assert r.json()["message"].startswith("Pilih pengurus daripada cawangan anda")
        # Never their own line: themselves (line or title) or the managers above them.
        r = await _set(bea, ids["bea"], ids["hani"])
        assert r.status_code == 400 and r.json()["code"] == "self_change"
        r = await _title(bea, ids["bea"], "Chief")
        assert r.status_code == 403 and r.json()["code"] == "own_line"
        r = await _title(bea, ids["mia"], "Chief")
        assert r.status_code in (403, 404)
        # Who heads a department stays with owners, admins, management and HR.
        r = await bea.patch(
            f"/api/members/{ids['sara']}", json={"heads_department": True}, headers=csrf(bea)
        )
        assert r.status_code == 403
        # Many at once: the branch's people move, the other company's are skipped.
        r = await bea.post(
            "/api/members/bulk",
            json={
                "user_ids": [ids["omar"], ids["hq"]],
                "action": "manager",
                "manager_id": ids["bea"],
            },
            headers=csrf(bea),
        )
        assert r.status_code == 200 and r.json()["done"] == 1 and r.json()["skipped"] == 1
    finally:
        await bea.aclose()

    hana = await _as(made, "hana")
    try:
        chart = (await hana.get("/api/members/hierarchy")).json()
        assert chart["edit_scope"] == "department"
        editable = {p["user_id"] for p in chart["people"] if p["editable"]}
        assert editable == {ids["sue"], ids["sara"], ids["tom"]}  # Finance, below HOD
        assert (await _set(hana, ids["tom"], ids["hana"])).status_code == 200
        assert (await _title(hana, ids["sara"], "Accounts Executive")).status_code == 200
        # Operations is not hers; Bea is above her (and a branch manager).
        r = await _set(hana, ids["omar"], ids["hana"])
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        r = await _title(hana, ids["bea"], "Boss")
        assert r.status_code == 403
        r = await _set(hana, ids["hana"], ids["mia"])
        assert r.status_code == 400 and r.json()["code"] == "self_change"
        # Loops are still refused: Tom reports to Hana, Sara cannot go under Tom's line...
        assert (await _set(hana, ids["tom"], ids["sara"])).status_code == 200
        r = await _set(hana, ids["sara"], ids["tom"])
        assert r.status_code == 409 and r.json()["code"] == "manager_loop"
        # ... and nobody reports to themselves.
        r = await _set(hana, ids["sara"], ids["sara"])
        assert r.status_code == 400 and r.json()["code"] == "self_manager"
        # "People under me": her department's people; Omar (Operations) is skipped.
        r = await hana.put(
            f"/api/members/{ids['hana']}/team",
            json={"user_ids": [ids["sara"], ids["tom"], ids["omar"]]},
            headers=csrf(hana),
        )
        assert r.status_code == 200 and r.json()["skipped"] == 1, r.text
    finally:
        await hana.aclose()


async def test_supervisors_and_staff_only_look(client):
    made, ids = await _org(client)
    for name in ("sue", "sara"):
        c = await _as(made, name)
        try:
            h = csrf(c)
            for r in [
                await _set(c, ids["tom"], ids[name]),
                await _title(c, ids["tom"], "Clerk"),
                await c.put(
                    f"/api/members/{ids[name]}/team", json={"user_ids": [ids["tom"]]}, headers=h
                ),
                await c.post(
                    "/api/members/bulk",
                    json={"user_ids": [ids["tom"]], "action": "manager", "manager_id": ids[name]},
                    headers=h,
                ),
            ]:
                assert r.status_code == 403, (name, r.text)
            chart = (await c.get("/api/members/hierarchy")).json()
            assert chart["can_edit"] is False
        finally:
            await c.aclose()
