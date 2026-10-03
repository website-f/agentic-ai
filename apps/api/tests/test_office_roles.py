"""P9: office roles and scopes, personal agents, saved logins, helpers, reports, overview."""

import csv
import io
import json

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import browser_tools, runtime
from agentic.api.scope import KNOWLEDGE_EVENTS, Scope
from agentic.channels import deliver
from agentic.core.db import SessionLocal
from agentic.models import Agent, Approval, Credential, Task
from agentic.workflows import teams_activities

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401
from .test_colleague_browser import FakeBrowser

PW = "a-long-new-password-2026"


async def member(owner: httpx.AsyncClient, email: str, role: str, **where) -> dict:
    r = await owner.post(
        "/api/members",
        json={"email": email, "name": email.split("@")[0].title(), "role": role, **where},
        headers=csrf(owner),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def signed_in(email: str, temp: str):
    from agentic.api.main import app

    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    r = await c.post("/api/auth/login", json={"email": email, "password": temp})
    assert r.status_code == 200, r.text
    r = await c.post(
        "/api/auth/change-password",
        json={"current_password": temp, "new_password": PW},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text
    return c


async def as_role(owner, email, role, **where):
    m = await member(owner, email, role, **where)
    return await signed_in(email, m["temp_password"])


async def two_branches(client):
    o = await office(client)
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    o["b2"] = b2
    o["b2_depts"] = {d["name"]: d["id"] for d in b2["departments"]}
    fin = await new_agent(client, o, "Faiz", "Finance")
    ops = await new_agent(client, o, "Ops One", "Operations")
    far = (
        await client.post(
            "/api/agents",
            json={
                "branch_id": b2["id"],
                "department_id": o["b2_depts"]["Finance"],
                "name": "Far Away",
                "role": "Finance agent",
            },
            headers=csrf(client),
        )
    ).json()
    return o, fin, ops, far


def names(rows):
    return sorted(a["name"] for a in rows)


# ---------------------------------------------------------------- scopes


async def test_each_role_sees_only_its_slice(client, llm, temporal):
    o, fin, ops, far = await two_branches(client)
    a = o["branch"]["id"]
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=a)
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    sup = await as_role(
        client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"]
    )
    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=a, department_id=o["depts"]["Operations"]
    )
    try:
        assert names((await client.get("/api/agents")).json()) == ["Faiz", "Far Away", "Ops One"]
        assert names((await bm.get("/api/agents")).json()) == ["Faiz", "Ops One"]
        assert names((await hod.get("/api/agents")).json()) == ["Faiz"]
        assert names((await sup.get("/api/agents")).json()) == ["Faiz"]
        # Staff watch their branch's office (P16), view only, but act on none of it.
        watched = (await staff.get("/api/agents")).json()
        assert names(watched) == ["Faiz", "Ops One"] and all(x["view_only"] for x in watched)
        assert not any(x["can_manage"] for x in watched)
        assert (await staff.get(f"/api/agents/{fin['id']}")).status_code == 200
        assert (await staff.get(f"/api/agents/{fin['id']}/activity")).status_code == 200
        assert (await staff.get(f"/api/agents/{far['id']}")).status_code == 404  # other branch
        r = await staff.post(
            f"/api/agents/{fin['id']}/chat", json={"message": "hi"}, headers=csrf(staff)
        )
        assert r.status_code == 404  # watching is not chatting
        r = await staff.post(
            "/api/tasks",
            json={"title": "x", "assignee_agent_id": fin["id"]},
            headers=csrf(staff),
        )
        assert r.status_code in (400, 404)
        # Outside the scope is "not here", not "forbidden": nothing to probe.
        assert (await hod.get(f"/api/agents/{far['id']}")).status_code == 404
        assert (await hod.get(f"/api/agents/{ops['id']}/activity")).status_code == 404

        me = (await hod.get("/api/auth/me")).json()
        assert me["role"] == "hod" and me["scope"]["kind"] == "department"
        assert me["scope"]["department_name"] == "Finance"
        assert "agents.manage" in me["permissions"] and "org.read" not in me["permissions"]

        # Placing agents: HOD in the department only; supervisors do not change agents.
        body = {"branch_id": a, "department_id": o["depts"]["Finance"], "name": "N", "role": "R"}
        assert (await hod.post("/api/agents", json=body, headers=csrf(hod))).status_code == 201
        far_body = {**body, "branch_id": o["b2"]["id"], "department_id": o["b2_depts"]["Finance"]}
        r = await hod.post("/api/agents", json=far_body, headers=csrf(hod))
        assert r.status_code == 403 and r.json()["code"] == "outside_scope"
        assert (await sup.post("/api/agents", json=body, headers=csrf(sup))).status_code == 403
        r = await sup.patch(f"/api/agents/{fin['id']}", json={"role": "x"}, headers=csrf(sup))
        assert r.status_code == 403

        # Workspace plumbing stays with the workspace roles.
        assert (await hod.get("/api/ai/providers")).status_code == 403
        assert (await hod.get("/api/incidents")).status_code == 403
        assert (await client.get("/api/ai/providers")).status_code == 200
    finally:
        for c in (bm, hod, sup, staff):
            await c.aclose()


async def test_staff_own_their_agents(client, llm, temporal):
    o, fin, ops, far = await two_branches(client)
    a = o["branch"]["id"]
    staff = await as_role(
        client, "staff@example.com", "staff", branch_id=a, department_id=o["depts"]["Operations"]
    )
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=a)
    try:
        r = await staff.post(
            "/api/agents",
            json={
                "branch_id": a,
                "department_id": o["depts"]["Operations"],
                "name": "My Helper",
                "role": "Assistant",
                "role_kind": "orchestrator",
                "heartbeat": True,
            },
            headers=csrf(staff),
        )
        assert r.status_code == 201, r.text
        mine = r.json()
        me = (await staff.get("/api/auth/me")).json()
        assert mine["owner_user_id"] == me["user"]["id"] and mine["can_manage"]
        assert mine["role_kind"] == "leaf" and mine["heartbeat"] is False  # no org powers
        listed = {x["name"]: x for x in (await staff.get("/api/agents")).json()}
        assert set(listed) == {"My Helper", "Faiz", "Ops One"}  # own + watched office
        assert not listed["My Helper"]["view_only"] and listed["Faiz"]["view_only"]
        # The branch manager sees it; the Finance HOD does not (it sits in Operations).
        assert "My Helper" in names((await bm.get("/api/agents")).json())
        assert "My Helper" not in names((await hod.get("/api/agents")).json())

        # Staff manage their own agent and nobody else's.
        r = await staff.patch(f"/api/agents/{mine['id']}", json={"role": "PA"}, headers=csrf(staff))
        assert r.status_code == 200 and r.json()["role"] == "PA"
        r = await staff.patch(f"/api/agents/{fin['id']}", json={"role": "x"}, headers=csrf(staff))
        assert r.status_code == 404

        # Work: staff give their own agent tasks, cannot hand work to others' agents.
        r = await staff.post(
            "/api/tasks",
            json={"title": "Sort my inbox", "assignee_agent_id": mine["id"]},
            headers=csrf(staff),
        )
        assert r.status_code == 201
        r = await staff.post(
            "/api/tasks",
            json={"title": "Sneak", "assignee_agent_id": fin["id"]},
            headers=csrf(staff),
        )
        assert r.status_code == 400
        owner_task = await new_task(client, fin, "Finance close")
        assert [t["title"] for t in (await staff.get("/api/tasks")).json()] == ["Sort my inbox"]
        assert (await staff.get(f"/api/tasks/{owner_task['id']}")).status_code == 404
        assert {t["title"] for t in (await hod.get("/api/tasks")).json()} == {"Finance close"}
    finally:
        for c in (staff, hod, bm):
            await c.aclose()


async def test_approvals_and_notifications_follow_the_agent(client, llm, temporal):
    o, fin, ops, far = await two_branches(client)
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    try:
        t1 = await new_task(client, fin, "Pay supplier")
        t2 = await new_task(client, far, "Far away job")
        llm.call("ask_human", question="Which account?", options=["Maybank", "CIMB"])
        assert (await runtime.run_task_step(t1["id"])).state == "needs_approval"
        llm.call("ask_human", question="Far question?")
        assert (await runtime.run_task_step(t2["id"])).state == "needs_approval"
        mine = (await hod.get("/api/approvals")).json()
        assert [x["task_title"] for x in mine] == ["Pay supplier"]
        assert mine[0]["args"]["options"] == ["Maybank", "CIMB"]  # buttons for the person
        assert len((await client.get("/api/approvals")).json()) == 2
        async with SessionLocal() as db:
            far_q = await db.scalar(select(Approval).where(Approval.task_id == t2["id"]))
            r = await hod.post(
                f"/api/approvals/{far_q.id}",
                json={"decision": "answer", "answer": "x"},
                headers=csrf(hod),
            )
            assert r.status_code == 404
            # Phone pushes go only to people whose scope covers the asking agent.
            far_agent = await db.get(Agent, far["id"])
            fin_agent = await db.get(Agent, fin["id"])
            to_far = {
                u.email for u in await deliver.deciders(db, far_agent.workspace_id, far_agent)
            }
            to_fin = {
                u.email for u in await deliver.deciders(db, fin_agent.workspace_id, fin_agent)
            }
        assert to_far == {"owner@example.com"}
        assert to_fin == {"owner@example.com", "hod@example.com"}
        r = await hod.post(
            f"/api/approvals/{mine[0]['id']}",
            json={"decision": "answer", "answer": "Maybank"},
            headers=csrf(hod),
        )
        assert r.status_code == 200 and r.json()["status"] == "answered"
    finally:
        await hod.aclose()


async def test_branch_manager_manages_their_people(client, llm, temporal):
    o, *_ = await two_branches(client)
    a = o["branch"]["id"]
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=a)
    try:
        r = await bm.post(
            "/api/members",
            json={"email": "s1@example.com", "name": "S1", "role": "staff", "branch_id": a},
            headers=csrf(bm),
        )
        assert r.status_code == 201 and r.json()["member"]["branch_name"] == "Maju Sdn Bhd"
        r = await bm.post(
            "/api/members",
            json={
                "email": "s2@example.com",
                "name": "S2",
                "role": "staff",
                "branch_id": o["b2"]["id"],
            },
            headers=csrf(bm),
        )
        assert r.status_code == 403
        r = await bm.post(
            "/api/members",
            json={"email": "x@example.com", "name": "X", "role": "admin"},
            headers=csrf(bm),
        )
        assert r.status_code == 403
        r = await client.post(
            "/api/members",
            json={"email": "h@example.com", "name": "H", "role": "hod", "branch_id": a},
            headers=csrf(client),
        )
        assert r.status_code == 422 and r.json()["code"] == "department_required"
        seen = {m["email"] for m in (await bm.get("/api/members")).json()}
        assert seen == {"bm@example.com", "s1@example.com"}  # not the owner, not other branches
    finally:
        await bm.aclose()


def test_live_events_are_filtered_by_scope():
    sc = Scope.of("hod", "us_1", "br_1", "dp_1")
    assert sc.event_visible("agent.activity", {"agent_id": "ag_mine"}, {"ag_mine"})
    assert not sc.event_visible("agent.activity", {"agent_id": "ag_other"}, {"ag_mine"})
    assert not sc.event_visible("task.updated", {"task_id": "tk_1"}, {"ag_mine"})
    assert not sc.event_visible("incident.updated", {"id": 3}, {"ag_mine"})
    assert sc.event_visible("meeting.updated", {"participants": ["ag_mine", "x"]}, {"ag_mine"})
    assert all(sc.event_visible(t, {}, set()) for t in KNOWLEDGE_EVENTS)
    assert Scope.of("owner", "us_1", None, None).event_visible("incident.updated", {}, set())


# ---------------------------------------------------------------- saved logins


@pytest.fixture
def browser(monkeypatch):
    fb = FakeBrowser()
    monkeypatch.setattr(browser_tools, "transport", httpx.MockTransport(fb.handler))
    return fb


async def test_saved_login_is_typed_but_never_seen(client, llm, temporal, browser):
    o = await office(client)
    wira = await new_agent(client, o, "Wira", "Operations", template="web_operator")
    secret_user, secret_pw = "PORTALUSER77", "S3cret-Pass-word!"
    r = await client.post(
        "/api/vault/logins",
        json={
            "name": "supplier-portal",
            "hosts": ["https://good.fake/login"],
            "username": secret_user,
            "password": secret_pw,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["hosts"] == ["good.fake"] and secret_pw not in json.dumps(out)
    assert secret_user not in json.dumps(out)
    t = await new_task(client, wira, "Check the portal inbox")
    llm.call("browser_open", url="https://good.fake/login")
    llm.call(
        "browser_login",
        login="supplier-portal",
        username_element=1,
        password_element=1,
        submit_element=3,
    )
    llm.call("browser_login", login="nope", username_element=1, password_element=1)
    llm.say("Signed in.")
    assert (await runtime.run_task_step(t["id"])).state == "done"
    typed = [b for m, p, b in browser.calls if b.get("secret")]
    assert [b["text"] for b in typed] == [secret_user, secret_pw]
    assert [b["secret_kind"] for b in typed] == ["username", "password"]
    assert all(b["hosts"] == ["good.fake"] for b in typed)
    # The saved login signs in by itself (no approval): only the login form's own button.
    sign_in = [b for m, p, b in browser.calls if b.get("action") == "login_submit"]
    assert len(sign_in) == 1 and sign_in[0]["element"] == 3 and sign_in[0]["hosts"] == ["good.fake"]
    assert (await client.get("/api/approvals")).json() == []
    # Not in anything the model saw, nor in what was stored for people to read.
    everything = json.dumps(llm.requests) + "".join(
        m.content or "" for m in await messages(t["id"])
    )
    feed = json.dumps((await client.get(f"/api/agents/{wira['id']}/activity")).json())
    for leak in (secret_pw, secret_user):
        assert leak not in everything and leak not in feed
    tools = [m.content for m in await messages(t["id"]) if m.role == "tool"]
    assert "Signed in with the saved login" in tools[1] and "hidden from you" in tools[1]
    assert "no saved login called 'nope'" in tools[2] and "supplier-portal" in tools[2]
    audit = (await client.get("/api/audit")).json()
    assert any(e["action"] == "credential.used" for e in audit["items"])


async def test_saved_login_refuses_other_sites_and_other_people(client, llm, temporal, browser):
    o = await office(client)
    wira = await new_agent(client, o, "Wira", "Operations", template="web_operator")
    await client.post(
        "/api/vault/logins",
        json={"name": "bank", "hosts": ["bank.fake"], "username": "u", "password": "p"},
        headers=csrf(client),
    )
    t = await new_task(client, wira)
    llm.call("browser_open", url="https://good.fake/form")  # the fake page is on good.fake
    llm.call("browser_login", login="bank", username_element=1, password_element=1)
    llm.say("Could not.")
    await runtime.run_task_step(t["id"])
    tools = [m.content for m in await messages(t["id"]) if m.role == "tool"]
    assert "only for bank.fake" in tools[1]
    assert not [b for m, p, b in browser.calls if b.get("secret")]

    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        assert (await staff.get("/api/vault/logins")).json() == []  # not the office's logins
        r = await staff.post(
            "/api/vault/logins",
            json={"name": "my-mail", "hosts": ["mail.fake"], "username": "me", "password": "pw"},
            headers=csrf(staff),
        )
        assert r.status_code == 201 and r.json()["owner_user_id"]
        async with SessionLocal() as db:
            mine = await db.scalar(select(Credential).where(Credential.name == "my-mail"))
            owner_agent = await db.get(Agent, wira["id"])
            from agentic.agents import vault

            assert not vault.usable_by(mine, owner_agent)  # only the staff's own agents
    finally:
        await staff.aclose()


# ---------------------------------------------------------------- helpers (split_work)


async def test_split_work_calls_in_helpers_and_sends_them_home(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    t = await new_task(client, rafi, "Summarise 40 inbox messages")
    llm.call(
        "split_work",
        parts=[
            {"title": "Messages 1-20", "brief": "Read messages 1 to 20, one line each."},
            {"title": "Messages 21-40", "brief": "Read messages 21 to 40, one line each."},
        ],
        why="40 messages",
    )
    r = await runtime.run_task_step(t["id"])
    assert r.state == "delegate" and len(r.children or []) == 2
    async with SessionLocal() as db:
        kids = [await db.get(Task, c["task_id"]) for c in r.children]
        helpers = [await db.get(Agent, k.assignee_agent_id) for k in kids]
        parent = await db.get(Task, t["id"])
        assert [h.name for h in helpers] == ["Rafi #1", "Rafi #2"]
        assert all(h.clone_of == rafi["id"] and h.tools["split_work"] == "deny" for h in helpers)
        assert all(
            h.soul == rafi["soul"] and h.department_id == rafi["department_id"] for h in helpers
        )
        assert all(
            k.source == "helper" and k.memory_snapshot == parent.memory_snapshot for k in kids
        )
        assert "copy of Rafi" in kids[0].brief and "Messages 1-20" == kids[0].title
    # Helpers do their part (and cannot split again).
    for i, c in enumerate(r.children):
        llm.say(f"Part {i + 1}: all invitations to quote.")
        res = await runtime.run_task_step(c["task_id"])
        assert res.state == "done"
        await runtime.finish(c["task_id"], "done", res.message)
    offered = {x["function"]["name"] for x in llm.requests[-1]["tools"]}
    assert "split_work" not in offered and "browser_open" in offered
    await teams_activities.task_collect_children(t["id"], r.call_id)
    tool = [m for m in await messages(t["id"]) if m.role == "tool"][0]
    assert "2 of 2 parts finished" in tool.content and "Part 2" in tool.content
    async with SessionLocal() as db:
        back = [await db.get(Agent, h.id, populate_existing=True) for h in helpers]
        assert all(h.status == "retired" for h in back)
    roster = names((await client.get("/api/agents")).json())
    assert roster == ["Rafi"]  # helpers went home

    # Next big job: the same helpers come back (no pile of new agents).
    t2 = await new_task(client, rafi, "Another big job")
    llm.call(
        "split_work",
        parts=[{"title": "A", "brief": "a"}, {"title": "B", "brief": "b"}],
    )
    r2 = await runtime.run_task_step(t2["id"])
    async with SessionLocal() as db:
        again = {(await db.get(Task, c["task_id"])).assignee_agent_id for c in r2.children}
    assert again == {h.id for h in helpers}


async def test_split_work_limits(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    t = await new_task(client, rafi)
    llm.call("split_work", parts=[{"title": "only", "brief": "x"}])
    llm.call("split_work", parts=[{"title": str(i), "brief": "x"} for i in range(6)])
    llm.say("Did it alone.")
    assert (await runtime.run_task_step(t["id"])).state == "done"
    errs = [m.content for m in await messages(t["id"]) if m.role == "tool"]
    assert "at least 2 parts" in errs[0] and "at most 4 helpers" in errs[1]
    plain = await new_agent(client, o, "Plain", "Finance")
    t2 = await new_task(client, plain)
    llm.say("ok")
    await runtime.run_task_step(t2["id"])
    assert "split_work" not in {x["function"]["name"] for x in llm.requests[-1]["tools"]}


# ---------------------------------------------------------------- reports and overview


async def test_reports_and_the_company_overview(client, llm, temporal):
    o, fin, ops, far = await two_branches(client)
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Tender QT1",
            "assignee_agent_id": fin["id"],
            "labels": ["Tender", "tender"],
        },
        headers=csrf(client),
    )
    assert r.json()["labels"] == ["tender"]
    t = r.json()
    llm.call(
        "publish_report",
        title="Inbox report",
        summary="12 messages, 3 invitations to quote.",
        body="## Notes\nAll from the last week.",
        tables=[
            {
                "title": "Messages",
                "columns": ["Date", "Subject", "Amount"],
                "rows": [["2026-10-01", "=HYPERLINK(evil)", 1200], ["2026-10-02", "QT2", 50]],
            }
        ],
        labels=["tender"],
    )
    llm.say("Report published.")
    assert (await runtime.run_task_step(t["id"])).state == "done"
    await runtime.finish(t["id"], "done", "Report published.")
    lst = (await client.get("/api/reports")).json()
    assert len(lst) == 1 and lst[0]["row_count"] == 2 and lst[0]["agent_name"] == "Faiz"
    full = (await client.get(f"/api/reports/{lst[0]['id']}")).json()
    assert (
        full["tables"][0]["columns"] == ["Date", "Subject", "Amount"] and "## Notes" in full["body"]
    )
    raw = (await client.get(f"/api/reports/{lst[0]['id']}/table/0.csv")).text
    rows = list(csv.reader(io.StringIO(raw.lstrip("﻿"))))
    assert rows[1][1] == "'=HYPERLINK(evil)"  # spreadsheet formulas are defused

    hod2 = await as_role(client, "hod2@example.com", "hod", department_id=o["b2_depts"]["Finance"])
    try:
        assert (await hod2.get("/api/reports")).json() == []  # another branch's report
        ov2 = (await hod2.get("/api/overview?days=7")).json()
        assert [b["name"] for b in ov2["branches"]] == ["Jaya Bhd"]
    finally:
        await hod2.aclose()

    ov = (await client.get("/api/overview?days=7")).json()
    maju = next(b for b in ov["branches"] if b["name"] == "Maju Sdn Bhd")
    assert maju["tasks_created"] == 1 and maju["tasks_done"] == 1 and maju["reports"] == 1
    assert maju["labels"] == [{"label": "tender", "count": 1}]
    assert ov["labels"] == [{"label": "tender", "count": 1}] and ov["totals"]["agents"] == 3
    assert maju["calls"] >= 2 and len(maju["done_by_day"]) == 7
    assert ov["top_agents"][0]["name"] == "Faiz"

    llm.say("- Maju Sdn Bhd has the only tender work.\n- Nothing is failing.")
    s = (await client.post("/api/overview/summary?days=7", json={}, headers=csrf(client))).json()
    assert "Maju" in s["text"] and s["cached"] is False
    prompt = llm.requests[-1]["messages"][1]["content"]
    assert "Maju Sdn Bhd" in prompt and "tender 1" in prompt and "HYPERLINK" not in prompt
    again = (
        await client.post("/api/overview/summary?days=7", json={}, headers=csrf(client))
    ).json()
    assert again["cached"] is True  # no second model call for the same numbers


async def test_an_agent_that_ends_on_a_question_is_told_to_ask(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Research")
    t = await new_task(client, rafi, "Check the inbox, then ask me what to do")
    llm.say("There are 34 messages, 16 unread.\n\nWhat would you like me to do with them?")
    llm.call(
        "ask_human",
        question="34 messages, 16 unread. What should I do with them?",
        options=["Summarise all", "Only invitations to quote"],
    )
    r = await runtime.run_task_step(t["id"])
    assert r.state == "needs_approval"  # it asked properly instead of closing the task
    pending = (await client.get("/api/approvals")).json()
    assert pending[0]["args"]["options"] == ["Summarise all", "Only invitations to quote"]
    users = [m.content for m in await messages(t["id"]) if m.role == "user"]
    assert "nobody will reply" in users[-1]
    # Only once per task: a second question-shaped answer is accepted as the answer.
    t2 = await new_task(client, rafi, "Another")
    llm.say("Done. Anything else?")
    llm.say("Done. Anything else?")
    assert (await runtime.run_task_step(t2["id"])).state == "done"
    assert runtime.ends_with_question("**Shall I continue?**") and not runtime.ends_with_question(
        "Is it done? Yes, it is done."
    )


def test_report_cells_keep_numbers_as_numbers():
    from agentic.agents.reports import clean_tables

    t = clean_tables(
        [
            {
                "columns": ["Ref", "Value", "Code"],
                "rows": [["PQ1", "132,000.00", "0123"], ["PQ2", "50"]],
            }
        ]
    )[0]
    assert t["rows"] == [["PQ1", 132000.0, "0123"], ["PQ2", 50, ""]]


async def test_busy_browsers_are_explained_not_crashed(client, llm, temporal, monkeypatch):
    calls = []

    def busy(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(503, json={"detail": "All browsers are busy."})

    monkeypatch.setattr(browser_tools, "transport", httpx.MockTransport(busy))
    monkeypatch.setattr(browser_tools, "BUSY_WAIT", 0)
    o = await office(client)
    wira = await new_agent(client, o, "Wira", "Operations", template="web_operator")
    t = await new_task(client, wira)
    llm.call("browser_open", url="https://good.fake/form").say("Will try later.")
    assert (await runtime.run_task_step(t["id"])).state == "done"
    tool = [m.content for m in await messages(t["id"]) if m.role == "tool"][0]
    assert "in use by other agents" in tool
    assert calls.count("/sessions") == browser_tools.BUSY_RETRIES  # it waited and retried


def test_reasoning_goes_back_only_to_models_that_want_it():
    from agentic.engine import client

    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": None, "tool_calls": [], "reasoning_content": "thought"},
        {"role": "assistant", "content": "written by another model"},
    ]
    plain = client.shape_messages(msgs, frozenset())
    assert all("reasoning_content" not in m for m in plain)  # Groq/OpenAI reject the field
    echo = client.shape_messages(msgs, frozenset({"echo_reasoning"}))
    assert [m.get("reasoning_content") for m in echo] == [None, "thought", ""]
    assert msgs[1]["reasoning_content"] == "thought"  # the stored history is not changed
    err = "The `reasoning_content` in the thinking mode must be passed back to the API."
    assert client._quirk_for(err) == "echo_reasoning"


async def test_an_agent_that_promises_work_is_told_to_do_it(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Research")
    t = await new_task(client, rafi, "Open all 34 messages and report")
    llm.say("Inbox checked: 34 messages; I'm now opening all 34 messages and will report them.")
    llm.say("Opened all 34 messages: 14 invitations to quote.")
    r = await runtime.run_task_step(t["id"])
    assert r.state == "done" and r.message.startswith("Opened all 34")
    users = [m.content for m in await messages(t["id"]) if m.role == "user"]
    assert "nothing happens after it" in users[-1]


async def test_browse_for_me_writes_the_brief_and_gives_the_browser(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Research")  # no browser tools yet
    r = await client.post(
        f"/api/agents/{rafi['id']}/web-task",
        json={
            "url": "good.fake/profile",
            "instructions": "Update our company profile",
            "mode": "interact",
            "values": "Company: Qbot Studio\nPhone: +60 3-2710 4455",
            "output": "report",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["labels"] == ["web"] and t["assignee_agent_id"] == rafi["id"]
    assert temporal["start"]  # started at once
    async with SessionLocal() as db:
        task = await db.get(Task, t["id"])
        agent = await db.get(Agent, rafi["id"])
    assert "Open this page in your browser: https://good.fake/profile" in task.brief
    assert "Use exactly these values" in task.brief and "Qbot Studio" in task.brief
    assert "browser_submit" in task.brief and "publish_report" in task.brief
    assert agent.tools["browser_fill"] == "allow" and agent.tools["browser_submit"] == "ask"

    # Read only: no form tools needed or promised; internal addresses refused.
    r = await client.post(
        f"/api/agents/{rafi['id']}/web-task",
        json={"url": "https://good.fake/news", "instructions": "List today's headlines"},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        brief = (await db.get(Task, r.json()["id"])).brief
    assert "Only read: do not fill in or send any form" in brief
    r = await client.post(
        f"/api/agents/{rafi['id']}/web-task",
        json={"url": "http://127.0.0.1:8501/api", "instructions": "Look inside"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_url"
    r = await client.post(
        f"/api/agents/{rafi['id']}/web-task",
        json={"url": "https://good.fake", "instructions": "Sign in", "login": "nope"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_login"

    # A supervisor may give work but not change agents: told to ask, nothing changed.
    other = await new_agent(client, o, "Fina", "Finance")
    sup = await as_role(
        client, "sup@example.com", "supervisor", department_id=o["depts"]["Finance"]
    )
    try:
        r = await sup.post(
            f"/api/agents/{other['id']}/web-task",
            json={"url": "https://good.fake", "instructions": "Read the page"},
            headers=csrf(sup),
        )
        assert r.status_code == 409 and r.json()["code"] == "no_browser"
    finally:
        await sup.aclose()


async def test_send_form_approval_shows_the_filled_form(client, llm, temporal, browser):
    o = await office(client)
    wira = await new_agent(client, o, "Wira", "Operations", template="web_operator")
    t = await new_task(client, wira, "Order lunch")
    llm.call("browser_open", url="https://good.fake/form")
    llm.call("browser_submit", element=3, why="send the order")
    assert (await runtime.run_task_step(t["id"])).state == "needs_approval"
    a = (await client.get("/api/approvals")).json()[0]
    assert a["args"]["element"] == 3 and a["args"]["page"] == "https://good.fake/form"
    assert {"label": "Customer name", "value": ""} in a["args"]["form"]
    assert all(f["label"] != "Submit order" for f in a["args"]["form"])  # buttons are not fields


async def test_blueprint_applies_a_role_to_an_agent(client, llm, temporal):
    o = await office(client)
    sop = (
        await client.post(
            "/api/sops",
            json={"scope": "library", "title": "Inbox SOP", "body": "x"},
            headers=csrf(client),
        )
    ).json()
    r = await client.post(
        "/api/blueprints",
        json={
            "name": "Inbox Reader",
            "description": "Reads and summarises inboxes.",
            "role": "Inbox Analyst",
            "soul": "You read inboxes and summarise them. You never fill or send forms.",
            "model_group": "smart",
            "tools": {"browser_open": "allow", "browser_read": "allow", "browser_submit": "deny"},
            "autonomy": "ask",
            "sop_ids": [sop["id"]],
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    bp = r.json()
    assert bp["tools"]["browser_submit"] == "deny" and bp["used_by"] == 0

    a = await new_agent(client, o, "Rafi", "Research")
    applied = await client.post(
        f"/api/blueprints/{bp['id']}/apply", json={"agent_id": a["id"]}, headers=csrf(client)
    )
    assert applied.status_code == 200 and applied.json()["used_by"] == 1
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        assert agent.role == "Inbox Analyst" and agent.template == "Inbox Reader"
        assert agent.tools["browser_submit"] == "deny" and agent.tools["browser_read"] == "allow"
        assert agent.sop_ids == [sop["id"]] and "never fill or send forms" in agent.soul

    # Bad tool / bad sop are rejected; staff without agents.manage cannot create one.
    bad = await client.post(
        "/api/blueprints", json={"name": "X", "tools": {"nope": "allow"}}, headers=csrf(client)
    )
    assert bad.status_code == 400 and bad.json()["code"] == "unknown_tool"
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        r = await staff.post(
            "/api/blueprints", json={"name": "Y", "role": "Z"}, headers=csrf(staff)
        )
        assert r.status_code == 201  # staff manage their own agents, so may define blueprints
    finally:
        await staff.aclose()


def test_workflow_compiles_to_a_numbered_procedure():
    from agentic.workflows.procedure import clean_graph, compile_text

    graph = {
        "nodes": [
            {"id": "n1", "type": "start", "title": "New invitation arrives", "role": "Operations"},
            {"id": "n2", "type": "decision", "title": "Relevant to us?"},
            {
                "id": "n3",
                "type": "step",
                "title": "Research it",
                "body": "Check requirements.",
                "role": "Research",
            },
            {"id": "n4", "type": "end", "title": "Archive"},
            {"id": "x9", "type": "step", "title": "Orphan"},  # disconnected, still listed
        ],
        "edges": [
            {"from": "n1", "to": "n2"},
            {"from": "n2", "to": "n3", "label": "yes"},
            {"from": "n2", "to": "n4", "label": "no"},
        ],
    }
    cleaned = clean_graph(graph)
    assert len(cleaned["nodes"]) == 5 and len(cleaned["edges"]) == 3
    text = compile_text("Invitation triage", graph)
    assert "Procedure: Invitation triage" in text
    assert "1. [Operations] New invitation arrives" in text
    assert "if yes: go to" in text and "if no: go to" in text
    assert "Check requirements." in text and "Orphan" in text  # body + disconnected node kept


async def test_workflow_crud_and_attaches_to_the_agent_prompt(client, llm, temporal):
    from agentic.agents.prompt import system_prompt

    o = await office(client)
    a = await new_agent(client, o, "Rafi", "Operations")
    r = await client.post(
        "/api/workflows",
        json={
            "name": "Invitation triage",
            "description": "How we handle a new invitation.",
            "status": "active",
            "agent_ids": [a["id"]],
            "graph": {
                "nodes": [
                    {"id": "n1", "type": "start", "title": "Invitation arrives"},
                    {
                        "id": "n2",
                        "type": "step",
                        "title": "Summarise it",
                        "body": "Note the deadline.",
                    },
                    {"id": "n3", "type": "end", "title": "Report to owner"},
                ],
                "edges": [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}],
            },
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    wf = r.json()
    assert wf["steps"] == 3 and "Note the deadline." in wf["procedure"]

    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        prompt = await system_prompt(db, agent, "task")
    assert (
        "Invitation triage" in prompt and "Note the deadline." in prompt
    )  # layered in like an SOP

    # A draft-only (not active) or unattached workflow does not reach the prompt.
    await client.patch(
        f"/api/workflows/{wf['id']}", json={**wf, "status": "draft"}, headers=csrf(client)
    )
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        prompt = await system_prompt(db, agent, "task")
    assert "Note the deadline." not in prompt
