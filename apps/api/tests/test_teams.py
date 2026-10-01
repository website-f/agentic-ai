"""P7 teams and governance: budgets with auto-pause, delegation trees with output schemas,
meetings with one decision summary, heartbeats, schedules and their ledger, the org chart."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from agentic.agents import dispatch, runtime
from agentic.core.db import SessionLocal
from agentic.models import (
    Agent,
    AgentPing,
    BrainPage,
    Incident,
    JobRun,
    LLMCall,
    Meeting,
    Task,
    TaskEvent,
)
from agentic.teams import delegation, heartbeat, meetings, schedules
from agentic.workflows import teams_activities

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401

PRICE = {"type": "object", "properties": {"price": {"type": "number"}}, "required": ["price"]}


@pytest.fixture
def team_temporal(temporal, monkeypatch):  # noqa: F811
    temporal.update({"meetings": [], "schedules": [], "deleted": [], "run_now": []})

    async def start_meeting(mid):
        temporal["meetings"].append(mid)
        return f"meeting-{mid}"

    async def upsert_schedule(sid, cron, tz, enabled, note):
        temporal["schedules"].append((sid, cron, tz, enabled))

    async def delete_schedule(sid):
        temporal["deleted"].append(sid)

    async def run_schedule_now(sid):
        temporal["run_now"].append(sid)
        return f"scheduled-{sid}-now"

    for name, fn in [
        ("start_meeting", start_meeting),
        ("upsert_schedule", upsert_schedule),
        ("delete_schedule", delete_schedule),
        ("run_schedule_now", run_schedule_now),
    ]:
        monkeypatch.setattr(dispatch, name, fn)
    return temporal


async def spent(agent_id: str, tokens: int) -> None:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        assert agent is not None
        db.add(
            LLMCall(
                workspace_id=agent.workspace_id,
                ts=datetime.now(UTC),
                task="agent.task",
                provider_name="Good",
                model="m1",
                agent_id=agent_id,
                prompt_tokens=tokens,
                completion_tokens=0,
                status="ok",
            )
        )
        await db.commit()


async def events_of(task_id: str, kind: str) -> list[TaskEvent]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(TaskEvent).where(TaskEvent.task_id == task_id, TaskEvent.kind == kind)
                )
            ).all()
        )


def tool_names(request: dict) -> set[str]:
    return {t["function"]["name"] for t in request.get("tools") or []}


# ---------------------------------------------------------------- budgets


async def test_over_budget_pauses_and_asks_then_continues(client, llm, team_temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina", budget_daily_tokens=1000)
    task = await new_task(client, agent, "Add things")
    await spent(agent["id"], 900)  # 90 %: warn once

    llm.call("calc", expression="1+1")  # this call costs 120 tokens: now over
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    pending = (await client.get("/api/approvals")).json()
    assert len(pending) == 1 and pending[0]["kind"] == "budget"
    assert (
        pending[0]["tool_label"] == "More budget" and "1,020 of its 1,000" in pending[0]["reason"]
    )
    detail = (await client.get(f"/api/tasks/{task['id']}")).json()
    assert detail["task"]["status"] == "blocked"
    pings = (await client.get("/api/pings")).json()
    assert [p["kind"] for p in pings] == ["budget_alert"]

    # A second step while waiting asks nothing new.
    again = await runtime.run_task_step(task["id"])
    assert again.state == "needs_approval" and again.approval_id == r.approval_id

    ok = await client.post(
        f"/api/approvals/{r.approval_id}", json={"decision": "approve"}, headers=csrf(client)
    )
    assert ok.status_code == 200
    await runtime.apply_approval(r.approval_id)
    await runtime.apply_approval(r.approval_id)  # a retried activity grants only once
    usage = (await client.get(f"/api/agents/{agent['id']}/budget")).json()
    assert usage["token_limit"] == 1500 and not usage["over"]

    llm.say("2.")
    assert (await runtime.run_task_step(task["id"])).state == "done"
    assert not [m for m in await messages(task["id"]) if m.name == "budget"]  # no tool message


async def test_denied_budget_fails_the_task(client, llm, team_temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina", budget_daily_tokens=1000)
    task = await new_task(client, agent)
    await spent(agent["id"], 1000)
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval" and llm.requests == []  # stopped before any call
    await client.post(
        f"/api/approvals/{r.approval_id}", json={"decision": "deny"}, headers=csrf(client)
    )
    await runtime.apply_approval(r.approval_id)
    r2 = await runtime.run_task_step(task["id"])
    assert r2.state == "failed" and "over budget" in (r2.message or "")


async def test_chat_over_budget_answers_without_a_model(client, llm, team_temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina", budget_daily_tokens=1000)
    await spent(agent["id"], 5000)
    r = await client.post(
        f"/api/agents/{agent['id']}/chat", json={"message": "hi"}, headers=csrf(client)
    )
    assert r.status_code == 200 and "budget" in r.json()["reply"] and llm.requests == []


# ---------------------------------------------------------------- delegation


async def test_orchestrator_splits_to_three_and_merges_validated_outputs(
    client, llm, team_temporal
):
    o = await office(client)
    boss = await new_agent(client, o, "Olivia", "Management", role_kind="orchestrator")
    for name in ("Ali", "Bob", "Chen"):
        await new_agent(client, o, name, "Operations")
    parent = await new_task(client, boss, "Get three quotes", "Flour, 50 kg")
    llm.call(
        "delegate",
        tasks=[
            {"agent": n, "title": f"Quote from supplier {n}", "output_schema": PRICE}
            for n in ("Ali", "Bob", "Chen")
        ],
        why="in parallel",
    )
    r = await runtime.run_task_step(parent["id"])
    assert r.state == "delegate" and len(r.children or []) == 3
    assert "delegate" in tool_names(llm.requests[0])
    kids = (await client.get(f"/api/tasks/{parent['id']}")).json()["children"]
    assert [k["depth"] for k in kids] == [1, 1, 1]
    assert all(k["has_output_schema"] and not k["requires_review"] for k in kids)
    assert {c["workflow_id"] for c in r.children or []} == {f"task-{k['id']}-1" for k in kids}

    # Ali answers right away; Bob needs the one correction; Chen never manages it.
    llm.say('{"price": 4.2}')
    a = await runtime.run_task_step(kids[0]["id"])
    assert a.state == "done" and json.loads(a.message or "") == {"price": 4.2}
    assert "delegate" not in tool_names(llm.requests[-1])  # leaves cannot delegate
    llm.say("About RM 4.50 per kg").say('```json\n{"price": 4.5}\n```')
    b = await runtime.run_task_step(kids[1]["id"])
    assert b.state == "done" and json.loads(b.message or "") == {"price": 4.5}
    assert len(await events_of(kids[1]["id"], "correction")) == 1
    llm.say("no idea").say("still no idea")
    c = await runtime.run_task_step(kids[2]["id"])
    assert c.state == "failed" and "required format" in (c.message or "")
    for kid, res in zip(kids, (a, b, c), strict=True):
        await runtime.finish(kid["id"], res.state, res.message)

    await teams_activities.task_collect_children(parent["id"], r.call_id)
    await teams_activities.task_collect_children(parent["id"], r.call_id)  # retry-safe
    tool = [m for m in await messages(parent["id"]) if m.role == "tool"]
    assert len(tool) == 1 and tool[0].content.startswith("2 of 3 delegated tasks finished")
    assert tool[0].content.count("<<<") == 2 and '{"price": 4.2}' in tool[0].content

    llm.say("Ali is cheapest at RM 4.20/kg; Chen did not quote.")
    done = await runtime.run_task_step(parent["id"])
    assert done.state == "done" and "Ali" in (done.message or "")


async def test_delegation_caps(client, llm, team_temporal):
    o = await office(client)
    boss = await new_agent(
        client, o, "Olivia", "Management", role_kind="orchestrator", max_spawn_depth=1
    )
    await new_agent(client, o, "Ali", "Operations")
    parent = await new_task(client, boss)
    too_many = [{"agent": "Ali", "title": f"Part {i}"} for i in range(6)]
    llm.call("delegate", tasks=too_many).call("delegate", tasks=[{"agent": "Nobody", "title": "x"}])
    llm.say("I did it myself.")
    assert (await runtime.run_task_step(parent["id"])).state == "done"
    errors = [m.content for m in await messages(parent["id"]) if m.role == "tool"]
    assert "at most 5" in errors[0] and "no active agent called 'Nobody'" in errors[1]

    async with SessionLocal() as db:
        a = await db.get(Agent, boss["id"])
        assert a is not None
        assert delegation.can_delegate(a, Task(depth=0))
        assert not delegation.can_delegate(a, Task(depth=1))  # max_spawn_depth=1
        assert not delegation.can_delegate(a, None)  # never in chat
        assert (await db.scalar(select(Task).where(Task.parent_task_id == parent["id"]))) is None


def test_output_check_reports_where_it_failed():
    assert delegation.check_output('{"price": 3}', PRICE) == ({"price": 3}, None)
    value, why = delegation.check_output('{"price": "cheap"}', PRICE)
    assert value is None and why and why.startswith("at price")
    assert delegation.check_output("RM 3", PRICE)[1] == "the answer is not valid JSON"
    with pytest.raises(delegation.DelegationError):
        delegation.check_schema({"type": "not-a-type"})


# ---------------------------------------------------------------- meetings

OUTCOME = json.dumps(
    {
        "decision": "Buy flour from supplier B.",
        "rationale": "RM 4.20/kg beats RM 4.50/kg.",
        "options": ["Supplier A", "Supplier B"],
        "dissent": ["Bina worries about delivery times"],
        "actions": [{"owner": "Operations", "action": "Confirm delivery dates with B"}],
    }
)


async def test_two_agents_meet_and_post_one_decision_to_the_task(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    b = await new_agent(client, o, "Bina", "Operations")
    task = await new_task(client, a, "Pick a flour supplier")
    r = await client.post(
        "/api/meetings",
        json={
            "topic": "Which flour supplier?",
            "participant_ids": [a["id"], b["id"]],
            "task_id": task["id"],
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert team_temporal["meetings"] == [mid]

    llm.say("Supplier B is RM 4.20/kg against A at RM 4.50.").say("Agreed, but check delivery.")
    assert (await meetings.take_turn(mid, 1, a["id"]))["passed"] is False
    assert (await meetings.take_turn(mid, 1, a["id"]))["passed"] is False  # retry: no repeat
    await client.post(
        f"/api/meetings/{mid}/interject",
        json={"text": "Delivery must be by Friday."},
        headers=csrf(client),
    )
    await meetings.take_turn(mid, 1, b["id"])
    assert "Delivery must be by Friday" in llm.requests[-1]["messages"][1]["content"]
    assert "recall" in tool_names(llm.requests[-1]) and len(tool_names(llm.requests[-1])) == 1
    llm.say("PASS").say("PASS")
    assert (await meetings.take_turn(mid, 2, a["id"]))["passed"] is True
    await meetings.take_turn(mid, 2, b["id"])
    llm.say(OUTCOME)
    out = await meetings.close(mid)
    assert out["decision"] == "Buy flour from supplier B."
    await meetings.close(mid)  # idempotent: still one summary

    decisions = await events_of(task["id"], "decision")
    assert len(decisions) == 1 and decisions[0].text.startswith("Decision: Buy flour")
    detail = (await client.get(f"/api/meetings/{mid}")).json()
    assert detail["status"] == "done" and detail["decision_path"].startswith("wiki/decisions/")
    assert [t["kind"] for t in detail["turns"]].count("outcome") == 1
    async with SessionLocal() as db:
        page = await db.scalar(select(BrainPage).where(BrainPage.path == detail["decision_path"]))
        assert page is not None and "Confirm delivery dates with B" in page.body


async def test_consult_tool_runs_a_meeting_inside_a_task(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    b = await new_agent(client, o, "Bina", "Operations")
    task = await new_task(client, a, "Pick a flour supplier")
    llm.call("consult", agents=["Bina"], topic="Which flour supplier?", rounds=1)
    r = await runtime.run_task_step(task["id"])
    assert r.state == "meeting" and r.meeting_id
    office_view = (await client.get(f"/api/office/{o['branch']['id']}")).json()
    assert {x["state"] for x in office_view["agents"]} == {"in_meeting"}

    llm.say("B is cheaper.").say("Agreed.").say(OUTCOME)
    await meetings.take_turn(r.meeting_id, 1, a["id"])
    await meetings.take_turn(r.meeting_id, 1, b["id"])
    await meetings.close(r.meeting_id)
    await teams_activities.task_meeting_result(task["id"], r.call_id, r.meeting_id)
    llm.say("Going with supplier B.")
    assert (await runtime.run_task_step(task["id"])).state == "done"
    tool = [m for m in await messages(task["id"]) if m.role == "tool"]
    assert len(tool) == 1 and "Decision: Buy flour from supplier B." in tool[0].content
    assert len(await events_of(task["id"], "decision")) == 1


async def test_meeting_limits(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    r = await client.post(
        "/api/meetings",
        json={"topic": "Alone?", "participant_ids": [a["id"], a["id"]]},
        headers=csrf(client),
    )
    assert r.status_code == 400 and "two agents" in r.json()["message"]
    assert meetings.parse_outcome("not json") is None
    assert meetings.parse_outcome('{"decision": ""}') is None


# ---------------------------------------------------------------- heartbeats

WED_10AM_KL = datetime(2026, 9, 30, 2, 0, tzinfo=UTC)
SAT_10AM_KL = datetime(2026, 10, 3, 2, 0, tzinfo=UTC)


async def test_heartbeat_picks_up_queued_work_or_asks_for_some(client, llm, team_temporal):
    o = await office(client)
    busy = await new_agent(client, o, "Aina", heartbeat=True)
    idle = await new_agent(client, o, "Bina", "Operations", heartbeat=True)
    await new_agent(client, o, "Chen", "Research")  # heartbeat off: never touched
    queued = await new_task(client, busy, "Queued work")

    assert (await heartbeat.tick(SAT_10AM_KL))["workspaces"] == 0  # weekend
    totals = await heartbeat.tick(WED_10AM_KL)
    assert totals == {"workspaces": 1, "started": 1, "pinged": 1}
    assert team_temporal["start"] == [(queued["id"], 1)]
    pings = (await client.get("/api/pings")).json()
    assert [(p["agent_name"], p["kind"]) for p in pings] == [("Bina", "idle")]
    assert pings[0]["message"] == heartbeat.IDLE_MESSAGE

    await heartbeat.tick(WED_10AM_KL)  # an hour later, same day: no second ping
    async with SessionLocal() as db:
        assert len((await db.scalars(select(AgentPing))).all()) == 1
        runs = (await db.scalars(select(JobRun).where(JobRun.job == "heartbeat"))).all()
        assert len(runs) == 2 and runs[0].detail == {"started": 1, "pinged": 1, "agents": 2}
    r = await client.post(f"/api/pings/{pings[0]['id']}/resolve", json={}, headers=csrf(client))
    assert r.status_code == 200 and (await client.get("/api/pings")).json() == []
    assert idle["id"]


# ---------------------------------------------------------------- schedules


async def test_schedules_crud_validates_cron(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    body = {
        "name": "Daily cash",
        "agent_id": a["id"],
        "title": "Cash report",
        "cron": "0 9 * * 1-5",
    }
    r = await client.post("/api/schedules", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    s = r.json()
    assert len(s["next_runs"]) == 3 and s["timezone"] == "Asia/Kuala_Lumpur"
    assert team_temporal["schedules"] == [(s["id"], "0 9 * * 1-5", "Asia/Kuala_Lumpur", True)]
    for bad in ("*/5 * * * *", "every day", "61 9 * * *"):
        r = await client.post("/api/schedules", json={**body, "cron": bad}, headers=csrf(client))
        assert r.status_code == 422, bad
    preview = (await client.get("/api/schedules/preview", params={"cron": "30 8 1 * *"})).json()
    assert preview["ok"] and len(preview["next"]) == 5

    r = await client.patch(
        f"/api/schedules/{s['id']}", json={"enabled": False}, headers=csrf(client)
    )
    assert r.json()["enabled"] is False and team_temporal["schedules"][-1][3] is False
    await client.post(f"/api/schedules/{s['id']}/run", json={}, headers=csrf(client))
    assert team_temporal["run_now"] == [s["id"]]
    r = await client.delete(
        f"/api/schedules/{s['id']}", headers={**csrf(client), "content-type": "application/json"}
    )
    assert r.status_code == 204 and team_temporal["deleted"] == [s["id"]]


async def test_ledger_and_incidents_group_failures(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    body = {"name": "Daily cash", "agent_id": a["id"], "title": "Cash report", "cron": "0 9 * * *"}
    s = (await client.post("/api/schedules", json=body, headers=csrf(client))).json()

    async def fire() -> dict:
        claimed = await schedules.claim(s["id"], False)
        assert claimed
        assert await schedules.attempt(claimed["run_id"], 1) == f"task-{claimed['task_id']}-1"
        await schedules.finish(claimed["run_id"], "failed")
        return claimed

    first = await fire()
    task = (await client.get(f"/api/tasks/{first['task_id']}")).json()["task"]
    assert task["schedule_id"] == s["id"] and task["source"] == "schedule"
    sent = len(team_temporal["deliveries"])
    await fire()
    incidents = (await client.get("/api/incidents")).json()
    assert len(incidents) == 1 and incidents[0]["count"] == 2  # grouped, not two alerts
    runs = (await client.get("/api/runs", params={"job": "schedule"})).json()
    assert [r["status"] for r in runs] == ["failed", "failed"]
    assert runs[0]["schedule_name"] == "Daily cash" and runs[0]["task_title"]

    await client.post(f"/api/incidents/{incidents[0]['id']}/resolve", json={}, headers=csrf(client))
    await fire()  # it came back: reopened
    async with SessionLocal() as db:
        inc = (await db.scalars(select(Incident))).one()
        assert inc.count == 3 and inc.resolved_at is None
    assert sent == 0 or len(team_temporal["deliveries"]) >= sent

    await client.patch(f"/api/schedules/{s['id']}", json={"enabled": False}, headers=csrf(client))
    assert await schedules.claim(s["id"], False) is None  # paused: the firing is skipped
    assert await schedules.claim(s["id"], True)  # "run now" still works


# ---------------------------------------------------------------- org chart


async def test_org_chart_cannot_loop(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    b = await new_agent(client, o, "Bina", reports_to=a["id"])
    c = await new_agent(client, o, "Chen", reports_to=b["id"])
    r = await client.patch(
        f"/api/agents/{a['id']}", json={"reports_to": c["id"]}, headers=csrf(client)
    )
    assert r.status_code == 400 and r.json()["code"] == "reporting_loop"
    r = await client.patch(
        f"/api/agents/{c['id']}", json={"reports_to": a["id"]}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["reports_to"] == a["id"]


async def test_meeting_cancel_with_task(client, llm, team_temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    b = await new_agent(client, o, "Bina", "Operations")
    task = await new_task(client, a)
    llm.call("consult", agents=["Bina"], topic="Anything?")
    r = await runtime.run_task_step(task["id"])
    await runtime.finish(task["id"], "cancelled", None)
    async with SessionLocal() as db:
        m = await db.get(Meeting, r.meeting_id)
        assert m is not None and m.status == "cancelled"
    assert (await meetings.take_turn(r.meeting_id or "", 1, b["id"]))["stop"] is True
