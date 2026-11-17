"""P111: the organization chart. Who reports to whom (anyone may have people under them on the
chart; what a manager may do still comes from their role), job titles, what each reader sees
of the chart, My workspace's own line of managers, and the plan command that sets reporting
lines from an org chart (names matched, never guessed). Synthetic people only."""

import argparse
import json
from types import SimpleNamespace

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, Workspace
from agentic.org import hierarchy, hierarchy_plan
from agentic.teams import people

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import member, signed_in


async def _org(client):
    """Owner; branch manager Bea; Finance HOD Hana; staff Sara, Tom (Finance), Omar (Ops)."""
    o = await office(client)
    bid, fin, ops = o["branch"]["id"], o["depts"]["Finance"], o["depts"]["Operations"]
    made = {}
    for email, role, where in [
        ("bea@example.com", "branch_manager", {"branch_id": bid}),
        ("hana@example.com", "hod", {"department_id": fin}),
        ("sara@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("tom@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("omar@example.com", "staff", {"branch_id": bid, "department_id": ops}),
    ]:
        made[email.split("@")[0]] = await member(client, email, role, **where)
    ids = {k: v["member"]["user_id"] for k, v in made.items()}
    return o, made, ids


async def _as(made, name):
    return await signed_in(f"{name}@example.com", made[name]["temp_password"])


async def _set(client, uid, boss, **extra):
    return await client.patch(
        f"/api/members/{uid}", json={"reports_to_user_id": boss, **extra}, headers=csrf(client)
    )


async def test_reporting_lines_rules_and_titles(client):
    o, made, ids = await _org(client)
    h = csrf(client)
    # P111: a staff member may have people under them on the chart (a store head) ...
    r = await _set(client, ids["tom"], ids["omar"])
    assert r.status_code == 200, r.text
    assert r.json()["reports_to_user_id"] == ids["omar"]
    # ... but their role still gives them no power over those people.
    async with SessionLocal() as db:
        ws = (await db.scalars(select(Workspace))).one().id
        omar = await db.get(Membership, (ws, ids["omar"]))
        actor = people.Actor(ws, ids["omar"], "staff", omar.branch_id)
        try:
            await people.may_assign(db, actor, ids["tom"])
            raise AssertionError("staff gave a task to the person under them")
        except people.PeopleError as e:
            assert e.status == 403

    # Nobody reports to themselves; no loops, however long the line.
    r = await _set(client, ids["sara"], ids["sara"])
    assert r.status_code == 400 and r.json()["code"] == "self_manager"
    assert (await _set(client, ids["hana"], ids["bea"])).status_code == 200
    assert (await _set(client, ids["sara"], ids["hana"])).status_code == 200
    r = await _set(client, ids["bea"], ids["sara"])  # Sara > Hana > Bea > Sara
    assert r.status_code == 409 and r.json()["code"] == "manager_loop"
    # The refusal is in Malay for a Malay reader.
    r = await client.patch(
        f"/api/members/{ids['sara']}",
        json={"reports_to_user_id": ids["sara"]},
        headers={**h, "X-Lang": "ms"},
    )
    assert r.json()["message"] == "Tiada sesiapa melapor kepada diri sendiri."

    # Nobody changes who they report to themselves (the owner included).
    me = (await client.get("/api/auth/me")).json()["user"]["id"]
    r = await _set(client, me, ids["bea"])
    assert r.status_code == 400 and r.json()["code"] == "self_change"
    r = await client.patch(
        f"/api/members/{me}", json={"reports_to_user_id": ids["bea"]}, headers={**h, "X-Lang": "ms"}
    )
    assert r.json()["message"].startswith("Anda tidak boleh menukar kepada siapa anda melapor")

    # Bulk: everyone ticked reports to Hana; one of them would make a loop and is skipped.
    r = await client.post(
        "/api/members/bulk",
        json={"user_ids": [ids["tom"], ids["bea"]], "action": "manager", "manager_id": ids["hana"]},
        headers=h,
    )
    assert r.json()["done"] == 1 and r.json()["skipped"] == 1, r.text

    # Job titles: set, tidied, audited, cleared.
    r = await client.patch(
        f"/api/members/{ids['hana']}", json={"job_title": "  Head of   Finance "}, headers=h
    )
    assert r.status_code == 200 and r.json()["job_title"] == "Head of Finance"
    async with SessionLocal() as db:
        row = (
            await db.scalars(
                select(AuditLog).where(
                    AuditLog.action == "member.title_changed", AuditLog.target == ids["hana"]
                )
            )
        ).one()
        assert row.after == {"job_title": "Head of Finance"}
        lines = (
            await db.scalars(
                select(AuditLog).where(
                    AuditLog.action == "member.manager_changed", AuditLog.target == ids["sara"]
                )
            )
        ).all()
        assert [a.after for a in lines] == [{"reports_to": ids["hana"]}]
    r = await client.patch(f"/api/members/{ids['hana']}", json={"job_title": ""}, headers=h)
    assert r.json()["job_title"] is None

    # Only owners, admins, management and HR set lines and titles: not an HOD, not staff.
    hana, sara = await _as(made, "hana"), await _as(made, "sara")
    try:
        r = await _set(hana, ids["sara"], ids["omar"])
        assert r.status_code == 403
        r = await hana.patch(
            f"/api/members/{ids['sara']}", json={"job_title": "Boss"}, headers=csrf(hana)
        )
        assert r.status_code == 403
        r = await _set(sara, ids["tom"], ids["sara"])
        assert r.status_code == 403
    finally:
        await hana.aclose()
        await sara.aclose()


async def test_who_sees_what_of_the_chart(client):
    o, made, ids = await _org(client)
    # Bea > Hana > Sara; Tom and Omar under Sara (a staff member with people under her).
    for uid, boss in [
        ("hana", "bea"),
        ("sara", "hana"),
        ("tom", "sara"),
        ("omar", "sara"),
    ]:
        assert (await _set(client, ids[uid], ids[boss])).status_code == 200
    await client.patch(
        f"/api/members/{ids['bea']}", json={"job_title": "Branch Head"}, headers=csrf(client)
    )

    # The owner sees everyone, with counts, and may change it.
    chart = (await client.get("/api/members/hierarchy")).json()
    assert chart["can_edit"] is True and chart["whole"] is True
    by = {p["user_id"]: p for p in chart["people"]}
    assert set(ids.values()) <= set(by)
    assert by[ids["sara"]]["direct_reports"] == 2 and by[ids["bea"]]["direct_reports"] == 1
    assert by[ids["bea"]]["job_title"] == "Branch Head"
    assert not any(p["limited"] for p in chart["people"])

    # Staff Tom: himself and his line up to the top; the managers he would not otherwise see
    # by name and title only (no role, no counts). Not his colleague Omar.
    tom = await _as(made, "tom")
    try:
        chart = (await tom.get("/api/members/hierarchy")).json()
        assert chart["can_edit"] is False and chart["whole"] is False
        by = {p["user_id"]: p for p in chart["people"]}
        assert set(by) == {ids["tom"], ids["sara"], ids["hana"], ids["bea"]}
        for k in ("sara", "hana", "bea"):
            p = by[ids[k]]
            assert p["limited"] is True and p["role"] is None and p["direct_reports"] is None
            assert p["branch_ids"] == []
        assert by[ids["bea"]]["job_title"] == "Branch Head"
        mine = (await tom.get("/api/members/hierarchy/mine")).json()
        assert [p["name"] for p in mine["chain"]] == ["Sara", "Hana", "Bea"]
        assert mine["reports"] == [] and mine["below"] == 0
        assert mine["me"]["user_id"] == ids["tom"]
        # Still no way to read a colleague's details or set the chart.
        r = await tom.get(f"/api/members/{ids['omar']}/team")
        assert r.status_code == 404
    finally:
        await tom.aclose()

    # Staff Sara: her line up, and the people under her (in full: they are hers).
    sara = await _as(made, "sara")
    try:
        mine = (await sara.get("/api/members/hierarchy/mine")).json()
        assert [p["name"] for p in mine["chain"]] == ["Hana", "Bea"]
        assert sorted(p["name"] for p in mine["reports"]) == ["Omar", "Tom"]
        assert all(not p["limited"] for p in mine["reports"]) and mine["below"] == 2
        chart = (await sara.get("/api/members/hierarchy")).json()
        names = sorted(p["name"] for p in chart["people"])
        assert names == ["Bea", "Hana", "Omar", "Sara", "Tom"]
    finally:
        await sara.aclose()

    # HOD Hana sees her department in full (Sara, Tom) and Bea above her by name only.
    hana = await _as(made, "hana")
    try:
        chart = (await hana.get("/api/members/hierarchy")).json()
        by = {p["user_id"]: p for p in chart["people"]}
        assert by[ids["bea"]]["limited"] is True
        assert by[ids["tom"]]["limited"] is False
        assert ids["omar"] not in by  # Operations: not hers
    finally:
        await hana.aclose()

    # The owner's own desk: nobody above, everyone below.
    mine = (await client.get("/api/members/hierarchy/mine")).json()
    assert mine["chain"] == [] and mine["below"] == 0


def test_chain_helpers_stop_at_loops():
    parent = {"a": "b", "b": "c", "c": "a", "d": None, "e": "d"}
    assert hierarchy.chain_up(parent, "a") == ["b", "c"]
    kids = hierarchy.children_of(parent)
    assert hierarchy.below(kids, "d") == {"e"}
    assert hierarchy.below(kids, "a") == {"b", "c"}
    full, limited = hierarchy.visible(parent, ["e"], "e")
    assert full == {"e"} and limited == {"d"}


def _people(*names: str, titles: dict[str, str] | None = None):
    titles = titles or {}
    return [
        SimpleNamespace(
            user=SimpleNamespace(name=n, is_active=True), job_title=titles.get(n), user_id=n
        )
        for n in names
    ]


def test_plan_name_matching_never_guesses():
    crowd = _people(
        "Ahmad Amjad B. Azahar",
        "Norisah Bt. Amrial",
        "Mohammad Hafiz B. Zulkifli",
        "Muhammad Hafiz Bin Mohamad Mahadzir",
        "Shahir",
        "Muhammad Shahir Bin Abd Ghani",
        "Siti Aminah Binti Ali",
        "Siti Aminah Binti Ali Hassan",
        "Mohd Murad Bin Nizam",
    )
    m = hierarchy_plan.match_name("AHMAD AMJAD BIN AZAHAR", crowd)
    assert m.how == "exact" and m.one.user.name == "Ahmad Amjad B. Azahar"
    assert hierarchy_plan.match_name("norisah  binti amrial", crowd).how == "exact"
    m = hierarchy_plan.match_name("Muhammad Hafiz bin Zulkifli", crowd)
    assert m.how == "spelling" and m.one.user.name == "Mohammad Hafiz B. Zulkifli"
    m = hierarchy_plan.match_name("Muhammad Shahir bin Abdul Ghani", crowd)
    assert m.how == "spelling" and m.one.user.name.startswith("Muhammad Shahir")
    # Exact first: the full name, not the one-word "Shahir".
    assert hierarchy_plan.match_name("Shahir", crowd).one.user.name == "Shahir"
    # Two people hold the same words: ambiguous, nobody picked.
    m = hierarchy_plan.match_name("Siti Aminah", crowd)
    assert m.how == "ambiguous" and m.one is None and len(m.found) == 2
    # Words held by one member only.
    m = hierarchy_plan.match_name("Amjad Azahar", crowd)
    assert m.how == "words" and m.one.user.name == "Ahmad Amjad B. Azahar"
    assert hierarchy_plan.match_name("Mohamad Khairol Nizam", crowd).how == "not found"
    # By job title: whole words only.
    staff = _people("A One", "B Two", titles={"A One": "Chief Operating Officer", "B Two": "Cook"})
    assert hierarchy_plan.match_title(["chief operating officer", "coo"], staff).one.user_id == (
        "A One"
    )
    assert hierarchy_plan.match_title(["coo"], _people("C", titles={"C": "Cook"})).one is None


async def test_plan_command_sets_sure_lines_only(client, tmp_path, capsys):
    o, made, ids = await _org(client)
    plan = {
        "people": [
            {"key": "top", "title": "Chief Operating Officer", "find_by_title": ["coo"]},
            {"key": "bea", "name": "BEA", "title": "Regional Head", "reports_to": "top"},
            {"key": "hana", "name": "hana", "title": "Finance Head", "reports_to": "bea"},
            {"key": "sara", "name": "Sara", "reports_to": "hana"},
            {"key": "ghost", "name": "Nobody Here", "reports_to": "hana"},
        ],
        "notes": ["Regional managers have no names yet."],
    }
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan), encoding="utf-8")
    people_, notes = hierarchy_plan.read_plan(path)
    args = argparse.Namespace(workspace=None, dry_run=True, overwrite_titles=False)

    assert await hierarchy_plan.run(args, people_, notes) == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "2 reporting lines would be set" in out
    assert "not found for sure" in out and "Regional managers have no names yet." in out
    rows = {r["user_id"]: r for r in (await client.get("/api/members")).json()}
    assert rows[ids["hana"]]["reports_to_user_id"] is None  # nothing saved
    assert rows[ids["hana"]]["job_title"] is None

    args.dry_run = False
    await hierarchy_plan.run(args, people_, notes)
    rows = {r["user_id"]: r for r in (await client.get("/api/members")).json()}
    assert rows[ids["hana"]]["reports_to_user_id"] == ids["bea"]
    assert rows[ids["sara"]]["reports_to_user_id"] == ids["hana"]
    assert rows[ids["bea"]]["reports_to_user_id"] is None  # the COO is not known
    assert rows[ids["hana"]]["job_title"] == "Finance Head"
    async with SessionLocal() as db:
        actors = {
            a.actor
            for a in (
                await db.scalars(select(AuditLog).where(AuditLog.action.like("member.%")))
            ).all()
            if a.action in ("member.manager_changed", "member.title_changed")
        }
        assert actors == {"system:hierarchy-cli"}

    # Again: nothing new.
    capsys.readouterr()
    await hierarchy_plan.run(args, people_, notes)
    out = capsys.readouterr().out
    assert "0 reporting lines were set, 2 already right" in out
    assert "0 job titles were set" in out
