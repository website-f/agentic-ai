"""P97: heads of department, who reports to whom, and tasks for people (an HOD gives work to
the people they manage; the person gets it in their workspace)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from agentic.api.scope import Scope
from agentic.core.db import SessionLocal
from agentic.models import Agent, Membership, Task
from agentic.teams import people, reconcile

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import member, signed_in


@pytest.fixture
def told(monkeypatch):
    """Every notice a person would get (phone push, Telegram, WhatsApp)."""
    sent: list[tuple[str, str, str]] = []

    async def notify(db, t, user_id, title, body, dedupe):
        if user_id:
            sent.append((user_id, title.template, t.id))

    monkeypatch.setattr(people, "notify", notify)
    return sent


async def _team(client):
    """Owner; Finance HOD Hana (manages Sara), staff Sara and Tom (Finance), Ops staff Omar;
    a branch manager Bea; a supervisor Sue (Finance)."""
    o = await office(client)
    bid, fin, ops = o["branch"]["id"], o["depts"]["Finance"], o["depts"]["Operations"]
    made = {}
    for email, role, where in [
        ("hana@example.com", "hod", {"department_id": fin}),
        ("sara@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("tom@example.com", "staff", {"branch_id": bid, "department_id": fin}),
        ("omar@example.com", "staff", {"branch_id": bid, "department_id": ops}),
        ("bea@example.com", "branch_manager", {"branch_id": bid}),
        ("sue@example.com", "supervisor", {"department_id": fin}),
    ]:
        m = await member(client, email, role, **where)
        made[email.split("@")[0]] = m
    ids = {k: v["member"]["user_id"] for k, v in made.items()}
    return o, made, ids


async def _as(made, name):
    return await signed_in(f"{name}@example.com", made[name]["temp_password"])


async def test_who_reports_to_whom_and_heads(client):
    o, made, ids = await _team(client)
    h = csrf(client)
    # Nobody reports to anyone after being added (or imported): nothing is placed for them.
    rows = (await client.get("/api/members")).json()
    assert all(r["reports_to_user_id"] is None and r["manages"] == 0 for r in rows)

    r = await client.put(
        f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["sara"], ids["tom"]]}, headers=h
    )
    assert r.status_code == 200 and r.json()["done"] == 2, r.text
    r = await client.patch(
        f"/api/members/{ids['hana']}", json={"heads_department": True}, headers=h
    )
    assert r.status_code == 200 and r.json()["heads_department"] is True
    assert r.json()["manages"] == 2
    team = (await client.get(f"/api/members/{ids['hana']}/team")).json()
    assert sorted(m["name"] for m in team) == ["Sara", "Tom"]
    assert all(m["reports_to_name"] == "Hana" for m in team)
    page = (
        await client.get(
            "/api/members", params={"page": 1, "page_size": 25, "manager": ids["hana"]}
        )
    ).json()
    assert page["total"] == 2

    # The list replaces: Tom is let go, Omar comes in.
    r = await client.put(
        f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["sara"], ids["omar"]]}, headers=h
    )
    assert r.json()["done"] == 3
    team = {m["name"] for m in (await client.get(f"/api/members/{ids['hana']}/team")).json()}
    assert team == {"Sara", "Omar"}

    # A staff member manages no one; nobody reports to themselves; no loops.
    r = await client.patch(
        f"/api/members/{ids['tom']}", json={"reports_to_user_id": ids["omar"]}, headers=h
    )
    assert r.status_code == 400 and r.json()["code"] == "not_a_manager"
    r = await client.patch(
        f"/api/members/{ids['hana']}", json={"reports_to_user_id": ids["hana"]}, headers=h
    )
    assert r.json()["code"] == "self_manager"
    r = await client.patch(
        f"/api/members/{ids['sue']}", json={"reports_to_user_id": ids["hana"]}, headers=h
    )
    assert r.status_code == 200
    r = await client.patch(
        f"/api/members/{ids['hana']}", json={"reports_to_user_id": ids["sue"]}, headers=h
    )
    assert r.status_code == 409 and r.json()["code"] == "manager_loop"

    # Bulk: everyone ticked reports to Bea; then to no one.
    r = await client.post(
        "/api/members/bulk",
        json={"user_ids": [ids["tom"], ids["omar"]], "action": "manager", "manager_id": ids["bea"]},
        headers=h,
    )
    assert r.json()["done"] == 2
    bea = {m["name"] for m in (await client.get(f"/api/members/{ids['bea']}/team")).json()}
    assert bea == {"Tom", "Omar"}

    # Only owners, admins, management and HR set it: not an HOD, even for their own people.
    hana = await _as(made, "hana")
    try:
        r = await hana.put(
            f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["tom"]]}, headers=csrf(hana)
        )
        assert r.status_code == 403
        r = await hana.patch(
            f"/api/members/{ids['sara']}", json={"heads_department": True}, headers=csrf(hana)
        )
        assert r.status_code == 403
    finally:
        await hana.aclose()

    # A manager made staff manages no one any more; a removed one leaves no one under them.
    r = await client.patch(
        f"/api/members/{ids['bea']}",
        json={"role": "staff", "branch_id": o["branch"]["id"]},
        headers=h,
    )
    assert r.status_code == 200
    assert (await client.get(f"/api/members/{ids['bea']}/team")).json() == []
    jh = {"content-type": "application/json", **h}
    assert (await client.delete(f"/api/members/{ids['hana']}", headers=jh)).status_code == 204
    async with SessionLocal() as db:
        left = (
            await db.scalars(select(Membership).where(Membership.reports_to_user_id == ids["hana"]))
        ).all()
    assert left == []


async def test_who_may_give_whom_a_task(client, told):
    o, made, ids = await _team(client)
    h = csrf(client)
    await client.put(
        f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["sara"]]}, headers=h
    )
    hana, sara, bea, sue = [await _as(made, n) for n in ("hana", "sara", "bea", "sue")]
    try:

        async def give(c, who, title="Check the claims"):
            return await c.post(
                "/api/tasks",
                json={
                    "title": title,
                    "assignee_user_id": ids.get(who, who),
                    "requires_review": True,
                },
                headers=csrf(c),
            )

        # An HOD gives work to the people they manage; not to the rest of the department.
        r = await give(hana, "sara")
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["assignee_user_id"] == ids["sara"] and t["assignee_agent_id"] is None
        assert t["status"] == "triage" and t["assignee_user_name"] == "Sara"
        assert t["created_by_name"] == "Hana"
        assert told == [(ids["sara"], "New task for you: {title}", t["id"])]
        r = await give(hana, "tom")
        assert r.status_code == 403 and r.json()["code"] == "cannot_assign"
        # A supervisor with nobody under them: only themselves.
        assert (await give(sue, "sara")).status_code == 403
        assert (await give(sue, "sue")).status_code == 201
        # Staff give work only to themselves; theirs is on their list straight away.
        assert (await give(sara, "tom")).status_code == 403
        mine = await give(sara, "sara", "My own note")
        assert mine.status_code == 201 and mine.json()["status"] == "ready"
        # A branch manager: the people of their branch.
        assert (await give(bea, "omar")).status_code == 201
        # Owner (members.manage): anyone.
        assert (await give(client, "tom")).status_code == 201
        # A person or an agent, not both; not someone who is not a member.
        fin = await new_agent(client, o, "Faiz")
        r = await client.post(
            "/api/tasks",
            json={"title": "x", "assignee_user_id": ids["tom"], "assignee_agent_id": fin["id"]},
            headers=h,
        )
        assert r.status_code == 422
        assert (await give(client, "us_nobody")).status_code == 400

        # Reassigning follows the same rule.
        r = await hana.patch(
            f"/api/tasks/{t['id']}", json={"assignee_user_id": ids["tom"]}, headers=csrf(hana)
        )
        assert r.status_code == 403

        # The picker lists exactly who they may give work to: themselves and their people.
        names = [p["name"] for p in (await hana.get("/api/team/people")).json()]
        assert names == ["Hana", "Sara"]
        assert [p["name"] for p in (await sara.get("/api/team/people")).json()] == ["Sara"]
        assert len((await client.get("/api/team/people")).json()) == 7
    finally:
        for c in (hana, sara, bea, sue):
            await c.aclose()


async def test_scope_hod_sees_their_people_staff_only_their_own(client, told):
    o, made, ids = await _team(client)
    h = csrf(client)
    await client.put(
        f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["sara"]]}, headers=h
    )
    for who in ("sara", "tom"):
        r = await client.post(
            "/api/tasks",
            json={"title": f"For {who}", "assignee_user_id": ids[who]},
            headers=h,
        )
        assert r.status_code == 201
    by = {t["title"]: t for t in (await client.get("/api/tasks")).json()}
    hana, sara, tom, omar, bea = [
        await _as(made, n) for n in ("hana", "sara", "tom", "omar", "bea")
    ]
    try:
        # The HOD sees the work of the people they manage (Sara), not Tom's though Tom sits in
        # their department: a person's task is not seen by department alone.
        seen = {t["title"] for t in (await hana.get("/api/tasks")).json()}
        assert "For sara" in seen and "For tom" not in seen
        team = {t["title"] for t in (await hana.get("/api/tasks?who=team")).json()}
        assert team == {"For sara"}
        assert (await hana.get(f"/api/tasks/{by['For sara']['id']}")).status_code == 200
        assert (await hana.get(f"/api/tasks/{by['For tom']['id']}")).status_code == 404
        # Staff see only their own.
        assert {t["title"] for t in (await tom.get("/api/tasks")).json()} == {"For tom"}
        assert (await tom.get(f"/api/tasks/{by['For sara']['id']}")).status_code == 404
        assert (await omar.get("/api/tasks")).json() == []
        # A branch manager sees their branch's people's tasks.
        assert {t["title"] for t in (await bea.get("/api/tasks")).json()} >= {"For sara", "For tom"}
        # Filters: one person, people only.
        one = (await client.get(f"/api/tasks?assignee=user:{ids['tom']}")).json()
        assert [t["title"] for t in one] == ["For tom"]
        assert len((await client.get("/api/tasks?assignee=people")).json()) == 2
        assert (await client.get("/api/tasks?assignee=what")).status_code == 400
        assert [t["title"] for t in (await sara.get("/api/tasks?who=assigned")).json()] == [
            "For sara"
        ]
    finally:
        for c in (hana, sara, tom, omar, bea):
            await c.aclose()

    # Live events of a person's task reach them, their manager and whoever gave it.
    sc_hana = Scope.of("hod", ids["hana"], None, o["depts"]["Finance"], frozenset({ids["sara"]}))
    sc_tom = Scope.of("staff", ids["tom"], o["branch"]["id"], None)
    data = {"task_id": "tk_1", "assignee_user_id": ids["sara"], "by": "user:someone"}
    assert sc_hana.event_visible("task.updated", data, set())
    assert not sc_tom.event_visible("task.updated", data, set())
    assert Scope.of("staff", ids["sara"], None, None).event_visible("task.updated", data, set())


async def test_status_flow_comments_and_my_list(client, told, temporal):  # noqa: F811
    o, made, ids = await _team(client)
    h = csrf(client)
    await client.put(
        f"/api/members/{ids['hana']}/team", json={"user_ids": [ids["sara"]]}, headers=h
    )
    hana, sara = await _as(made, "hana"), await _as(made, "sara")
    try:
        due = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        t = (
            await hana.post(
                "/api/tasks",
                json={
                    "title": "Reconcile October",
                    "assignee_user_id": ids["sara"],
                    "requires_review": True,
                    "due_at": due,
                    "priority": "high",
                },
                headers=csrf(hana),
            )
        ).json()
        tid = t["id"]
        assert t["due_at"]

        # Sara's workspace: one new task, overdue; the bell says so too.
        mine = (await sara.get("/api/me/assigned-tasks")).json()
        assert [x["id"] for x in mine["items"]] == [tid]
        assert mine["counts"] == {"open": 1, "new": 1, "overdue": 1, "due_today": 0}
        needs = (await sara.get("/api/me/needs")).json()
        assert any(i["key"] == "assigned" for i in needs["items"])

        async def move(c, to):
            return await c.patch(f"/api/tasks/{tid}", json={"status": to}, headers=csrf(c))

        # Never an agent run: starting a person's task is refused; moves start nothing.
        assert (
            await sara.post(f"/api/tasks/{tid}/start", json={}, headers=csrf(sara))
        ).status_code == 400
        assert (await move(sara, "ready")).json()["status"] == "ready"  # accepted
        r = await move(sara, "running")
        assert r.json()["status"] == "running" and r.json()["started_at"]
        assert temporal["start"] == []

        # The reconciler leaves a person's running task alone (it has no run to lose).
        await reconcile.tick(datetime.now(UTC) + timedelta(days=2))
        async with SessionLocal() as db:
            assert (await db.get(Task, tid)).status == "running"

        r = await sara.post(
            f"/api/tasks/{tid}/comments", json={"text": "Bank file is late"}, headers=csrf(sara)
        )
        assert r.status_code == 201
        assert (ids["hana"], "New comment: {title}", tid) in told
        # Done by the person goes to the giver's check; the person cannot accept it themselves.
        assert (await move(sara, "done")).json()["status"] == "review"
        assert (ids["hana"], "Ready for your check: {title}", tid) in told
        r = await sara.post(f"/api/tasks/{tid}/accept", json={}, headers=csrf(sara))
        assert r.status_code == 403 and r.json()["code"] == "giver_accepts"
        assert (await move(sara, "done")).status_code == 403
        # The HOD follows it and sends it back, then accepts it.
        assert (await move(hana, "running")).json()["status"] == "running"
        assert (ids["sara"], "Sent back to you: {title}", tid) in told
        assert (await move(sara, "done")).json()["status"] == "review"
        r = await hana.post(f"/api/tasks/{tid}/accept", json={}, headers=csrf(hana))
        assert r.status_code == 200 and r.json()["status"] == "done"
        detail = (await hana.get(f"/api/tasks/{tid}")).json()
        kinds = [e["kind"] for e in detail["events"]]
        assert "comment" in kinds and kinds.count("status") >= 5
        # A move a person's task cannot make.
        assert (await move(sara, "triage")).status_code == 409
        mine = (await sara.get("/api/me/assigned-tasks")).json()
        assert mine["items"] == [] and [x["id"] for x in mine["done"]] == [tid]

        # Comments are for people's tasks.
        fin = await new_agent(client, o, "Faiz")
        at = (
            await client.post(
                "/api/tasks", json={"title": "x", "assignee_agent_id": fin["id"]}, headers=h
            )
        ).json()
        r = await client.post(f"/api/tasks/{at['id']}/comments", json={"text": "hi"}, headers=h)
        assert r.status_code == 409
        # Person <-> agent only from To do.
        r = await client.post(
            "/api/tasks", json={"title": "Swap", "assignee_user_id": ids["sara"]}, headers=h
        )
        sw = r.json()
        r = await client.patch(
            f"/api/tasks/{sw['id']}", json={"assignee_agent_id": fin["id"]}, headers=h
        )
        assert r.status_code == 200
        assert r.json()["assignee_agent_id"] == fin["id"] and r.json()["assignee_user_id"] is None
    finally:
        await hana.aclose()
        await sara.aclose()


async def test_a_person_hands_a_step_to_their_own_ai(client, told, temporal):  # noqa: F811
    o, made, ids = await _team(client)
    h = csrf(client)
    t = (
        await client.post(
            "/api/tasks",
            json={"title": "Prepare the tender list", "assignee_user_id": ids["sara"]},
            headers=h,
        )
    ).json()
    async with SessionLocal() as db:
        mine = Agent(
            workspace_id=(await db.get(Task, t["id"])).workspace_id,
            branch_id=o["branch"]["id"],
            department_id=o["depts"]["Finance"],
            name="Sara's twin",
            slug="sara-twin",
            role="Assistant",
            owner_user_id=ids["sara"],
            is_twin=True,
        )
        db.add(mine)
        await db.commit()
        agent_id = mine.id
    other = await new_agent(client, o, "Faiz")
    sara, hana = await _as(made, "sara"), await _as(made, "hana")
    try:
        r = await sara.post(
            f"/api/tasks/{t['id']}/hand-to-ai",
            json={"agent_id": other["id"], "brief": "x"},
            headers=csrf(sara),
        )
        assert r.status_code == 400  # not her own AI
        r = await hana.post(
            f"/api/tasks/{t['id']}/hand-to-ai", json={"agent_id": agent_id}, headers=csrf(hana)
        )
        assert r.status_code in (403, 404)  # only the person it is for
        r = await sara.post(
            f"/api/tasks/{t['id']}/hand-to-ai",
            json={"agent_id": agent_id, "brief": "List the open tenders"},
            headers=csrf(sara),
        )
        assert r.status_code == 201, r.text
        child = r.json()
        assert child["assignee_agent_id"] == agent_id and child["parent_task_id"] == t["id"]
        assert [s[0] for s in temporal["start"]] == [child["id"]]  # only the AI's step runs
        async with SessionLocal() as db:
            assert (await db.get(Task, t["id"])).workflow_id is None
    finally:
        await sara.aclose()
        await hana.aclose()
