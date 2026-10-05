"""P21 objectives: CRUD and scope, inheritance through delegate / split_work / ask_colleague,
the request-tree cost roll-up, the "why this matters" line in the first task message only,
and objective budgets (alert at 80 %, approval for new work at 100 %)."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Approval, AuditLog, LLMCall, Task, Workspace
from agentic.teams import objectives

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role, two_branches


async def objective(c, **body) -> dict:
    r = await c.post("/api/objectives", json=body, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


async def spend(task_id: str, usd: float, tokens: int = 100) -> None:
    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        assert t is not None
        db.add(
            LLMCall(
                workspace_id=t.workspace_id,
                ts=datetime.now(UTC),
                task="agent.task",
                provider_name="Good",
                model="m1",
                agent_id=t.assignee_agent_id,
                task_id=task_id,
                prompt_tokens=tokens,
                completion_tokens=0,
                cost_usd=usd,
                status="ok",
            )
        )
        await db.commit()


async def linked_task(c, agent: dict, objective_id: str, title: str = "Do it") -> dict:
    r = await c.post(
        "/api/tasks",
        json={"title": title, "assignee_agent_id": agent["id"], "objective_id": objective_id},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


def by_id(rows: list[dict]) -> dict[str, dict]:
    return {r["id"]: r for r in rows}


# ---------------------------------------------------------------- CRUD and progress


async def test_crud_nesting_progress_and_delete(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    top = await objective(client, title="Win 5 government tenders", target="5 awarded by Dec")
    assert top["branch_id"] is None and top["can_edit"] and top["budget_state"] == "none"
    child = await objective(
        client,
        title="JKR tender pack",
        target="Submitted by Friday",
        branch_id=o["branch"]["id"],
        parent_id=top["id"],
        due_on="2026-12-31",
        budget_usd=10,
    )
    assert child["branch_name"] == "Maju Sdn Bhd" and child["parent_id"] == top["id"]

    t1 = await linked_task(client, aina, child["id"], "Draft the pack")
    assert t1["objective_id"] == child["id"] and t1["root_task_id"] == t1["id"]
    t2 = await new_task(client, aina, "Check the pack")
    r = await client.patch(
        f"/api/tasks/{t2['id']}", json={"objective_id": child["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["objective_id"] == child["id"]
    async with SessionLocal() as db:
        t = await db.get(Task, t2["id"])
        assert t is not None
        t.status = "done"
        await db.commit()
    await spend(t1["id"], 0.25)
    await spend(t2["id"], 0.5, tokens=300)

    rows = by_id((await client.get("/api/objectives")).json())
    c = rows[child["id"]]
    assert c["progress"] == {
        "total": 2,
        "done": 1,
        "failed": 0,
        "open": 1,
        "cancelled": 0,
        "requests": 2,
    }
    assert c["usd"] == pytest.approx(0.75) and c["tokens"] == 400 and c["last_activity"]
    assert c["budget_state"] == "ok"
    # The parent's own work is empty; its roll-up counts the nested objective.
    assert rows[top["id"]]["usd"] == 0 and rows[top["id"]]["rollup_usd"] == pytest.approx(0.75)

    board = by_id((await client.get("/api/tasks")).json())
    assert board[t1["id"]]["objective_title"] == "JKR tender pack"

    # No cycles; done objectives take no new work.
    r = await client.patch(
        f"/api/objectives/{top['id']}", json={"parent_id": child["id"]}, headers=csrf(client)
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_parent"
    r = await client.patch(
        f"/api/objectives/{child['id']}", json={"status": "done"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["status"] == "done"
    r = await client.post(
        "/api/tasks",
        json={"title": "More", "assignee_agent_id": aina["id"], "objective_id": child["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_objective"

    d = (await client.get(f"/api/objectives/{top['id']}")).json()
    assert [k["id"] for k in d["children"]] == [child["id"]] and d["parent"] is None
    assert len(d["cost_by_day"]) == 30
    assert sum(x["usd"] for x in d["cost_by_day"]) == pytest.approx(0.75)

    page = await client.get(f"/api/objectives/{child['id']}/tasks?limit=1")
    assert page.headers["X-Total-Count"] == "2" and "X-Next-Cursor" in page.headers
    nxt = await client.get(
        f"/api/objectives/{child['id']}/tasks?limit=1&cursor={page.headers['X-Next-Cursor']}"
    )
    assert {page.json()[0]["id"], nxt.json()[0]["id"]} == {t1["id"], t2["id"]}

    ov = (await client.get("/api/overview?days=7")).json()
    assert [x["title"] for x in ov["objectives"]] == ["JKR tender pack"]
    assert ov["objectives"][0]["usd"] == pytest.approx(0.75)

    # Deleting keeps the work (unlinked) and lifts nested objectives to the parent.
    grand = await objective(client, title="Cover letter", parent_id=child["id"])
    r = await client.delete(
        f"/api/objectives/{child['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204
    rows = by_id((await client.get("/api/objectives")).json())
    assert child["id"] not in rows and rows[grand["id"]]["parent_id"] == top["id"]
    detail = (await client.get(f"/api/tasks/{t1['id']}")).json()
    assert detail["task"]["objective_id"] is None and detail["objective"] is None


async def test_scope_managers_heads_and_staff(client, llm, temporal):
    o, fin, _ops, _far = await two_branches(client)
    a, b = o["branch"]["id"], o["b2"]["id"]
    ob_a = await objective(client, title="A goal", branch_id=a)
    ob_b = await objective(client, title="B goal", branch_id=b)
    await objective(client, title="Group goal")
    await objective(client, title="Ops goal", department_id=o["depts"]["Operations"])

    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=a)
    hod = await as_role(client, "hod@example.com", "hod", department_id=o["depts"]["Finance"])
    st = await as_role(client, "st@example.com", "staff", branch_id=a)
    try:
        seen = {x["title"]: x for x in (await bm.get("/api/objectives")).json()}
        assert set(seen) == {"A goal", "Group goal", "Ops goal"}
        assert seen["A goal"]["can_edit"] and not seen["Group goal"]["can_edit"]
        assert (await bm.get(f"/api/objectives/{ob_b['id']}")).status_code == 404
        mine = await objective(bm, title="BM goal")  # lands in the manager's company
        assert mine["branch_id"] == a and mine["can_edit"]
        r = await bm.post("/api/objectives", json={"title": "x", "branch_id": b}, headers=csrf(bm))
        assert r.status_code == 403
        r = await bm.patch(
            f"/api/objectives/{ob_a['id']}", json={"target": "Ten bids"}, headers=csrf(bm)
        )
        assert r.status_code == 200 and r.json()["target"] == "Ten bids"

        seen = {x["title"] for x in (await hod.get("/api/objectives")).json()}
        assert seen == {"A goal", "Group goal", "BM goal"}  # not the Operations one
        dept = await objective(hod, title="Close the books")
        assert dept["department_id"] == o["depts"]["Finance"] and dept["branch_id"] == a
        r = await hod.patch(
            f"/api/objectives/{ob_a['id']}", json={"title": "Mine now"}, headers=csrf(hod)
        )
        assert r.status_code == 403

        seen = {x["title"] for x in (await st.get("/api/objectives")).json()}
        assert "A goal" in seen and "B goal" not in seen
        r = await st.post("/api/objectives", json={"title": "Nope"}, headers=csrf(st))
        assert r.status_code == 403
    finally:
        for c in (bm, hod, st):
            await c.aclose()

    # A task in company A cannot serve company B's objective.
    r = await client.post(
        "/api/tasks",
        json={"title": "x", "assignee_agent_id": fin["id"], "objective_id": ob_b["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 400 and "another company" in r.json()["message"]


# ---------------------------------------------------------------- inheritance and cost


async def test_children_inherit_through_delegate_and_colleague(client, llm, temporal):
    o = await office(client)
    boss = await new_agent(client, o, "Olivia", "Management", role_kind="orchestrator")
    ali = await new_agent(client, o, "Ali", "Operations")
    await new_agent(client, o, "Rafi", "Research")
    ob = await objective(client, title="Lower flour cost")
    parent = await linked_task(client, boss, ob["id"], "Get quotes")
    llm.call("delegate", tasks=[{"agent": "Ali", "title": "Quote A"}])
    r = await runtime.run_task_step(parent["id"])
    assert r.state == "delegate"
    kid_id = (r.children or [])[0]["task_id"]
    # Ali asks a colleague from inside the delegated task: the grandchild joins the request.
    llm.call("ask_colleague", agent="Rafi", question="Who sells flour cheapest?")
    r2 = await runtime.run_task_step(kid_id)
    assert r2.state == "delegate"
    grand_id = (r2.children or [])[0]["task_id"]
    async with SessionLocal() as db:
        kid = await db.get(Task, kid_id)
        grand = await db.get(Task, grand_id)
        assert kid is not None and grand is not None
        assert kid.assignee_agent_id == ali["id"]
        assert (kid.objective_id, kid.root_task_id) == (ob["id"], parent["id"])
        assert (grand.objective_id, grand.root_task_id) == (ob["id"], parent["id"])
        assert grand.parent_task_id == kid_id and grand.source == "question"

    # Request cost: the whole tree, from any task in it; other work is not counted.
    other = await new_task(client, ali, "Unrelated")
    await spend(parent["id"], 0.10)
    await spend(kid_id, 0.20)
    await spend(grand_id, 0.15)
    await spend(other["id"], 9.99)
    for tid in (parent["id"], kid_id, grand_id):
        req = (await client.get(f"/api/tasks/{tid}")).json()["request"]
        assert req["root_task_id"] == parent["id"] and req["tasks"] == 3
        assert req["usd"] == pytest.approx(0.45)
    alone = (await client.get(f"/api/tasks/{other['id']}")).json()["request"]
    assert alone == {
        "root_task_id": other["id"],
        "tasks": 1,
        "usd": pytest.approx(9.99),
        "tokens": 100,
    }

    # A part with no objective of its own still counts toward its root's objective.
    async with SessionLocal() as db:
        k = await db.get(Task, kid_id)
        assert k is not None
        k.objective_id = None
        await db.commit()
    row = by_id((await client.get("/api/objectives")).json())[ob["id"]]
    assert row["usd"] == pytest.approx(0.45) and row["progress"]["total"] == 3
    assert row["progress"]["requests"] == 1

    # Moving the root to another objective takes its parts along.
    ob2 = await objective(client, title="Second objective")
    r = await client.patch(
        f"/api/tasks/{parent['id']}", json={"objective_id": ob2["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200
    async with SessionLocal() as db:
        g = await db.get(Task, grand_id)
        assert g is not None and g.objective_id == ob2["id"]


async def test_split_work_helpers_inherit(client, llm, temporal):
    o = await office(client)
    rafi = await new_agent(client, o, "Rafi", "Operations", template="web_operator")
    ob = await objective(client, title="Clear the inbox")
    t = await linked_task(client, rafi, ob["id"], "Summarise 40 messages")
    llm.call(
        "split_work",
        parts=[{"title": "1-20", "brief": "first half"}, {"title": "21-40", "brief": "rest"}],
    )
    r = await runtime.run_task_step(t["id"])
    assert r.state == "delegate" and len(r.children or []) == 2
    async with SessionLocal() as db:
        for c in r.children or []:
            kid = await db.get(Task, c["task_id"])
            assert kid is not None and kid.source == "helper"
            assert (kid.objective_id, kid.root_task_id) == (ob["id"], t["id"])


async def test_workflow_steps_and_schedule_runs_keep_the_objective(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    ob = await objective(client, title="Monthly close")
    async with SessionLocal() as db:
        ws_id = await db.scalar(select(Workspace.id))
        first = Task(
            workspace_id=ws_id,
            title="Step 1",
            created_by="workflow:wr_x",
            workflow_run_id="wr_x",
            objective_id=ob["id"],
            assignee_agent_id=aina["id"],
        )
        db.add(first)
        await db.flush()
        assert await objectives.run_lineage(db, "wr_x") == {
            "objective_id": ob["id"],
            "root_task_id": first.id,
        }
        assert await objectives.run_lineage(db, "wr_none") == {}
        db.add(
            Task(
                workspace_id=first.workspace_id,
                title="Last month's run",
                created_by="schedule:sc_x",
                schedule_id="sc_x",
                objective_id=ob["id"],
            )
        )
        await db.flush()
        assert await objectives.schedule_lineage(db, "sc_x") == {"objective_id": ob["id"]}
        assert await objectives.schedule_lineage(db, "sc_other") == {}
        await db.rollback()


# ---------------------------------------------------------------- the prompt line


async def test_why_line_only_in_the_first_task_message(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    top = await objective(client, title="Win 5 government tenders")
    ob = await objective(
        client, title="JKR tender pack", target="3 bids by Friday", parent_id=top["id"]
    )
    t = await linked_task(client, aina, ob["id"], "Draft the cover letter")
    llm.say("Drafted.")
    assert (await runtime.run_task_step(t["id"])).state == "done"
    first = llm.requests[0]["messages"]
    assert "Why this matters" not in first[0]["content"]  # the cached system prompt is untouched
    line = "Why this matters: JKR tender pack — 3 bids by Friday (part of Win 5 government tenders)"
    assert line in first[1]["content"] and first[1]["role"] == "user"

    # The next run of the same task (sent back) does not repeat it.
    await runtime.finish(t["id"], "done", "Drafted.")
    r = await client.post(
        f"/api/tasks/{t['id']}/revise", json={"feedback": "Shorter"}, headers=csrf(client)
    )
    assert r.status_code == 200
    llm.say("Shorter now.")
    await runtime.run_task_step(t["id"])
    again = llm.requests[-1]["messages"]
    assert again[0]["content"] == first[0]["content"]
    assert sum("Why this matters" in str(m.get("content") or "") for m in again) == 1
    users = [m for m in await messages(t["id"]) if m.role == "user"]
    assert "Why this matters" in (users[0].content or "")
    assert all("Why this matters" not in (m.content or "") for m in users[1:])

    plain = await new_task(client, aina, "No objective here")
    llm.say("Done.")
    await runtime.run_task_step(plain["id"])
    assert "Why this matters" not in str(llm.requests[-1]["messages"])


# ---------------------------------------------------------------- budgets


async def _alerts(objective_id: str) -> list[int]:
    async with SessionLocal() as db:
        rows = (
            await db.scalars(
                select(AuditLog)
                .where(AuditLog.action == "objective.budget_alert", AuditLog.target == objective_id)
                .order_by(AuditLog.id)
            )
        ).all()
        return [int((r.after or {})["pct"]) for r in rows]


async def test_budget_alerts_at_80_and_holds_new_work_at_100(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    ob = await objective(client, title="Tender season", budget_usd=1.0)
    t0 = await linked_task(client, aina, ob["id"], "First")
    await spend(t0["id"], 0.85)
    assert by_id((await client.get("/api/objectives")).json())[ob["id"]]["budget_state"] == "near"

    # 85 %: the work runs and the creator is told once.
    t1 = await linked_task(client, aina, ob["id"], "Second")
    llm.say("ok").say("ok")
    assert (await runtime.run_task_step(t1["id"])).state == "done"
    t1b = await linked_task(client, aina, ob["id"], "Second b")
    assert (await runtime.run_task_step(t1b["id"])).state == "done"
    assert await _alerts(ob["id"]) == [85]

    # 105 %: a new request waits for a person.
    await spend(t0["id"], 0.20)
    t2 = await linked_task(client, aina, ob["id"], "Third")
    r = await runtime.run_task_step(t2["id"])
    assert r.state == "needs_approval" and len(llm.requests) == 2  # no model call
    assert await _alerts(ob["id"]) == [85, 105]
    pending = (await client.get("/api/approvals")).json()
    assert len(pending) == 1 and pending[0]["kind"] == "budget"
    assert pending[0]["args"]["objective_title"] == "Tender season"
    assert "Tender season" in pending[0]["reason"]
    again = await runtime.run_task_step(t2["id"])  # still waiting: no second approval
    assert again.approval_id == r.approval_id
    ok = await client.post(
        f"/api/approvals/{r.approval_id}", json={"decision": "approve"}, headers=csrf(client)
    )
    assert ok.status_code == 200
    await runtime.apply_approval(r.approval_id)
    llm.say("Done anyway.")
    assert (await runtime.run_task_step(t2["id"])).state == "done"

    # A part of a request already under way carries on without asking.
    async with SessionLocal() as db:
        root = await db.get(Task, t2["id"])
        assert root is not None
        part = Task(
            workspace_id=root.workspace_id,
            title="A part",
            status="ready",
            assignee_agent_id=aina["id"],
            created_by=f"agent:{aina['id']}",
            parent_task_id=root.id,
            depth=1,
            **objectives.lineage(root),
        )
        db.add(part)
        await db.commit()
        part_id = part.id
    llm.say("Part done.")
    assert (await runtime.run_task_step(part_id)).state == "done"

    # Denied: the new task stops.
    t3 = await linked_task(client, aina, ob["id"], "Fourth")
    r3 = await runtime.run_task_step(t3["id"])
    assert r3.state == "needs_approval"
    await client.post(
        f"/api/approvals/{r3.approval_id}", json={"decision": "deny"}, headers=csrf(client)
    )
    await runtime.apply_approval(r3.approval_id)
    stop = await runtime.run_task_step(t3["id"])
    assert stop.state == "failed" and "over its budget" in (stop.message or "")

    # Raising the budget lets new work start again.
    r = await client.patch(
        f"/api/objectives/{ob['id']}", json={"budget_usd": 5}, headers=csrf(client)
    )
    assert r.json()["budget_state"] == "ok"
    t4 = await linked_task(client, aina, ob["id"], "Fifth")
    llm.say("Fine.")
    assert (await runtime.run_task_step(t4["id"])).state == "done"
    async with SessionLocal() as db:
        n = len((await db.scalars(select(Approval).where(Approval.task_id == t4["id"]))).all())
        assert n == 0


async def test_parent_budget_counts_nested_objectives(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    top = await objective(client, title="Group budget", budget_usd=0.5)
    sub = await objective(client, title="Unbudgeted part", parent_id=top["id"])
    t0 = await linked_task(client, aina, sub["id"], "Spend")
    await spend(t0["id"], 0.6)
    rows = by_id((await client.get("/api/objectives")).json())
    assert rows[top["id"]]["budget_state"] == "over" and rows[sub["id"]]["budget_state"] == "none"
    t1 = await linked_task(client, aina, sub["id"], "New under the part")
    r = await runtime.run_task_step(t1["id"])
    assert r.state == "needs_approval"
    pending = (await client.get("/api/approvals")).json()
    assert pending[0]["args"]["objective_id"] == top["id"]
