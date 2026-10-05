"""P21 accountable work: task blockers, the liveness reconciler (relaunch once, then a person;
silent runs flagged, never stopped) and review stages (an agent reviewer before a person)."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from agentic.channels import deliver
from agentic.core.db import SessionLocal
from agentic.models import SOP, Task, TaskEvent
from agentic.teams import reconcile

from .conftest import csrf
from .test_agents import llm, messages, new_agent, office, temporal  # noqa: F401
from .test_skills import tool


async def _task(client, agent: dict | None, title: str, **extra) -> dict:
    body = {"title": title, "assignee_agent_id": agent["id"] if agent else None, **extra}
    r = await client.post("/api/tasks", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    return r.json()


async def _get(client, task_id: str) -> dict:
    r = await client.get(f"/api/tasks/{task_id}")
    assert r.status_code == 200, r.text
    return r.json()


async def _events(task_id: str, kind: str) -> list[TaskEvent]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(TaskEvent)
                    .where(TaskEvent.task_id == task_id, TaskEvent.kind == kind)
                    .order_by(TaskEvent.id)
                )
            ).all()
        )


def _started(temporal, task_id: str) -> list[int]:
    return [run for tid, run in temporal["start"] if tid == task_id]


@pytest.fixture
def notices(monkeypatch):
    """Record the owner notices (phone push / Telegram / WhatsApp) instead of queueing."""
    sent: list[dict] = []

    async def notify_user(db, ws, user_id, title, body, url, *, dedupe):
        sent.append({"user": user_id, "title": title, "body": body, "url": url})
        return []

    async def notify_people(db, ws, title, body, url, *, dedupe, perm="approvals.decide"):
        sent.append({"user": None, "title": title, "body": body, "url": url})
        return []

    monkeypatch.setattr(deliver, "notify_user", notify_user)
    monkeypatch.setattr(deliver, "notify_people", notify_people)
    return sent


# ---------------------------------------------------------------- blockers


async def test_blockers_launch_the_waiting_task_when_all_are_done(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    a = await _task(client, aina, "Clean the sales data", requires_review=False)
    c = await _task(client, aina, "Fetch the targets", requires_review=False)
    b = await _task(client, aina, "Write the report", blocked_by=[a["id"], c["id"]], start=True)
    assert b["status"] == "blocked" and b["run_count"] == 0
    assert (
        b["blocked_reason"].startswith("Waiting for ")
        and "Clean the sales data" in b["blocked_reason"]
    )
    assert {w["id"] for w in b["waiting_for"]} == {a["id"], c["id"]}
    assert b["restartable"] and not _started(temporal, b["id"])

    await runtime.finish(a["id"], "done", "Clean.")
    b2 = (await _get(client, b["id"]))["task"]
    assert b2["status"] == "blocked" and [w["id"] for w in b2["waiting_for"]] == [c["id"]]
    assert not _started(temporal, b["id"])

    await runtime.finish(c["id"], "done", "Targets.")
    detail = await _get(client, b["id"])
    assert detail["task"]["status"] == "ready" and _started(temporal, b["id"]) == [1]
    assert detail["task"]["waiting_for"] == [] and detail["task"]["blocked_reason"] is None
    assert {x["id"] for x in detail["blockers"]} == {a["id"], c["id"]}
    assert [x["id"] for x in (await _get(client, a["id"]))["blocking"]] == [b["id"]]


async def test_review_counts_as_not_done_until_a_person_accepts(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    a = await _task(client, aina, "Draft the tender")  # requires_review: a person accepts
    b = await _task(client, aina, "Submit the tender", blocked_by=[a["id"]], start=True)
    await runtime.finish(a["id"], "done", "Draft.")
    assert (await _get(client, b["id"]))["task"]["status"] == "blocked"
    r = await client.post(f"/api/tasks/{a['id']}/accept", json={}, headers=csrf(client))
    assert r.status_code == 200
    assert _started(temporal, b["id"]) == [1]


async def test_a_cancelled_blocker_routes_the_waiting_task_to_its_owner(
    client, llm, temporal, notices
):
    o = await office(client)
    me = (await client.get("/api/auth/me")).json()
    aina = await new_agent(client, o, "Aina")
    a = await _task(client, aina, "Book the venue")
    b = await _task(client, aina, "Send the invitations", blocked_by=[a["id"]], start=True)
    r = await client.post(f"/api/tasks/{a['id']}/cancel", json={}, headers=csrf(client))
    assert r.json()["status"] == "cancelled"
    t = (await _get(client, b["id"]))["task"]
    assert t["status"] == "blocked" and t["blocked_owner"] == f"user:{me['user']['id']}"
    assert t["blocked_action"] == "A task it waits for was cancelled: decide"
    assert t["blocked_owner_name"] == me["user"]["name"] and t["restartable"]
    assert len(notices) == 1 and notices[0]["user"] == me["user"]["id"]
    assert notices[0]["url"] == f"/tasks?task={b['id']}"
    # The owner decides: start it anyway.
    r = await client.post(f"/api/tasks/{b['id']}/start", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["blocked_owner"] is None and _started(temporal, b["id"]) == [1]


async def test_a_failed_blocker_routes_too_and_a_retry_releases_it(client, llm, temporal, notices):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    a = await _task(client, aina, "Pull the bank statement", requires_review=False)
    b = await _task(client, aina, "Reconcile", blocked_by=[a["id"]], start=True)
    await runtime.finish(a["id"], "failed", "The portal was down.")
    t = (await _get(client, b["id"]))["task"]
    assert t["blocked_action"] == "A task it waits for was failed: decide" and len(notices) == 1
    await runtime.finish(a["id"], "done", "Got it.")  # the retried blocker finishes
    assert _started(temporal, b["id"]) == [1]


async def test_blocker_cycles_and_self_waits_are_refused(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    a = await _task(client, aina, "A")
    b = await _task(client, aina, "B", blocked_by=[a["id"]])
    c = await _task(client, aina, "C", blocked_by=[b["id"]])
    loop = await client.post(
        f"/api/tasks/{a['id']}/blockers", json={"task_ids": [c["id"]]}, headers=csrf(client)
    )
    assert loop.status_code == 409 and loop.json()["code"] == "blocker_cycle"
    me = await client.post(
        f"/api/tasks/{a['id']}/blockers", json={"task_ids": [a["id"]]}, headers=csrf(client)
    )
    assert me.status_code == 400
    # Removing the only blocker of a parked task lets it start.
    r = await client.delete(
        f"/api/tasks/{b['id']}/blockers/{a['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 200 and r.json()["status"] == "ready"
    assert _started(temporal, b["id"]) == [1]


async def test_create_task_tool_lines_work_up_after_others(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    boss = await new_agent(client, o, "Olivia", "Management", role_kind="orchestrator")
    aina = await new_agent(client, o, "Aina")
    first = await _task(client, aina, "Collect the invoices", requires_review=False)
    out = await tool(
        boss["id"],
        "create_task",
        title="Summarise the invoices",
        brief="One line per supplier.",
        assignee="Aina",
        after=[first["id"]],
    )
    assert out.startswith("Created task ") and "starts by itself" in out
    async with SessionLocal() as db:
        made = await db.scalar(select(Task).where(Task.title == "Summarise the invoices"))
    assert made is not None and made.status == "blocked" and made.source == "agent"
    assert made.assignee_agent_id == aina["id"] and made.created_by == f"agent:{boss['id']}"
    # A leaf agent may only line work up for itself; unknown ids are refused.
    leaf = await tool(aina["id"], "create_task", title="X", brief="y", assignee="Olivia")
    assert leaf.startswith("Error: only orchestrators")
    bad = await tool(boss["id"], "create_task", title="X", brief="y", after=["tk_nope"])
    assert bad.startswith("Error: there is no task tk_nope")
    await runtime.finish(first["id"], "done", "12 invoices.")
    assert _started(temporal, made.id) == [1]


# ---------------------------------------------------------------- liveness reconciler


async def _running(task_id: str, ago: timedelta = timedelta(minutes=30)) -> None:
    """Pretend a run is underway and has been quiet for `ago`."""
    then = datetime.now(UTC) - ago
    async with SessionLocal() as db:
        await db.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(status="running", started_at=then, updated_at=then)
        )
        await db.execute(update(TaskEvent).where(TaskEvent.task_id == task_id).values(ts=then))
        await db.commit()


async def test_reconciler_relaunches_once_then_hands_it_to_the_owner(
    client, llm, temporal, notices, monkeypatch
):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Long job", start=True)
    assert _started(temporal, t["id"]) == [1]

    async def gone(_wid):
        return False

    monkeypatch.setattr(reconcile, "workflow_open", gone)
    await _running(t["id"])
    assert (await reconcile.tick())["relaunched"] == 1
    assert _started(temporal, t["id"]) == [1, 2]
    ev = await _events(t["id"], "reconcile")
    assert len(ev) == 1 and ev[0].data == {
        "run": 1,
        "action": "relaunched",
        "workflow_id": f"task-{t['id']}-1",
    }

    await _running(t["id"])  # the run the reconciler started stops the same way
    assert (await reconcile.tick())["blocked"] == 1
    row = (await _get(client, t["id"]))["task"]
    assert row["status"] == "blocked" and row["blocked_action"] == reconcile.STOPPED_TWICE
    assert row["blocked_owner"] == t["created_by"] and row["restartable"]
    assert _started(temporal, t["id"]) == [1, 2] and len(notices) == 1
    assert (await reconcile.tick())["checked"] == 0  # blocked: nothing more to do
    # A person retries it: a fresh run, and a fresh automatic relaunch allowance.
    r = await client.post(f"/api/tasks/{t['id']}/start", json={}, headers=csrf(client))
    assert r.status_code == 200 and _started(temporal, t["id"]) == [1, 2, 3]


async def test_silent_runs_are_flagged_once_and_never_stopped(client, llm, temporal, monkeypatch):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Slow research", start=True)

    async def alive(_wid):
        return True

    monkeypatch.setattr(reconcile, "workflow_open", alive)
    await _running(t["id"], timedelta(minutes=30))
    first = await reconcile.tick()
    assert first["silent"] == 1 and first["relaunched"] == 0
    assert (await reconcile.tick())["silent"] == 0  # same quiet spell: reported once
    ev = await _events(t["id"], "silent")
    assert len(ev) == 1 and ev[0].data["minutes"] >= 29
    detail = await _get(client, t["id"])
    assert detail["task"]["status"] == "running" and detail["task"]["quiet_minutes"] >= 29
    wall = (await client.get("/api/monitor/wall")).json()
    assert wall[0]["task"]["id"] == t["id"] and wall[0]["task"]["quiet_minutes"] >= 29
    assert _started(temporal, t["id"]) == [1]  # never stopped or relaunched

    # New activity, then a new quiet spell: reported again.
    async with SessionLocal() as db:
        db.add(
            TaskEvent(
                task_id=t["id"],
                ts=datetime.now(UTC) - timedelta(minutes=16),
                kind="tool",
                actor=f"agent:{aina['id']}",
                text="used Web search",
            )
        )
        await db.commit()
    assert (await reconcile.tick())["silent"] == 1
    assert len(await _events(t["id"], "silent")) == 2


# ---------------------------------------------------------------- review stages


async def _policy(client, o: dict, dept: str, stages: list[dict], rounds: int = 3) -> None:
    r = await client.put(
        f"/api/departments/{o['depts'][dept]}/review-policy",
        json={"review_policy": {"stages": stages, "max_rounds": rounds}},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text


async def _review_child(task_id: str) -> Task:
    async with SessionLocal() as db:
        kid = await db.scalar(
            select(Task)
            .where(Task.parent_task_id == task_id, Task.source == "review")
            .order_by(Task.created_at.desc())
        )
    assert kid is not None
    return kid


def _verdict(decision: str, notes: str) -> str:
    return json.dumps({"decision": decision, "notes": notes})


async def test_review_accept_moves_to_the_next_stage(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    rina = await new_agent(client, o, "Rina", "Management")
    ws_id = (await client.get("/api/auth/me")).json()["workspace"]["id"]
    async with SessionLocal() as db:
        db.add(
            SOP(
                workspace_id=ws_id,
                scope="department",
                scope_id=o["depts"]["Finance"],
                title="Always show the tax line",
                body="Every total shows SST separately.",
            )
        )
        await db.commit()
    await _policy(
        client, o, "Finance", [{"type": "agent", "agent_id": rina["id"]}, {"type": "human"}]
    )
    t = await _task(client, aina, "Quote for Acme", brief="10 chairs at RM 120.")
    await runtime.finish(t["id"], "done", "Total RM 1,200 + SST RM 96.")

    row = (await _get(client, t["id"]))["task"]
    assert row["status"] == "review" and row["blocked_owner"] == f"agent:{rina['id']}"
    assert row["blocked_owner_name"] == "Rina"
    kid = await _review_child(t["id"])
    assert kid.assignee_agent_id == rina["id"] and kid.output_schema is not None
    assert "10 chairs at RM 120." in kid.brief and "Total RM 1,200 + SST RM 96." in kid.brief
    assert "Always show the tax line" in kid.brief
    assert _started(temporal, kid.id) == [1]

    await runtime.finish(kid.id, "done", _verdict("accept", "Correct and complete."))
    detail = await _get(client, t["id"])
    assert detail["task"]["status"] == "review" and detail["task"]["blocked_owner"] is None
    assert [(r["decision"], r["round"], r["reviewer_name"]) for r in detail["reviews"]] == [
        ("accept", 1, "Rina")
    ]
    assert detail["review_policy"]["summary"] == "Rina then a person (up to 3 rounds)"
    assert (await _get(client, kid.id))["task"]["status"] == "done"

    # Without a human stage, an accepted review is done.
    await _policy(client, o, "Finance", [{"type": "agent", "agent_id": rina["id"]}])
    t2 = await _task(client, aina, "Second quote")
    await runtime.finish(t2["id"], "done", "RM 500.")
    await runtime.finish((await _review_child(t2["id"])).id, "done", _verdict("accept", "ok"))
    assert (await _get(client, t2["id"]))["task"]["status"] == "done"


async def test_review_changes_send_it_back_with_the_notes(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    rina = await new_agent(client, o, "Rina", "Management")
    await _policy(
        client, o, "Finance", [{"type": "agent", "agent_id": rina["id"]}, {"type": "human"}]
    )
    t = await _task(client, aina, "Quote for Acme")
    await runtime.finish(t["id"], "done", "Total RM 1,200.")
    kid = await _review_child(t["id"])
    await runtime.finish(kid.id, "done", _verdict("changes", "Add the SST line."))

    row = (await _get(client, t["id"]))["task"]
    assert row["review_round"] == 1 and row["status"] == "ready"
    assert _started(temporal, t["id"]) == [1]  # back to work through the send-back path
    last = [m.content for m in await messages(t["id"]) if m.role == "user"][-1]
    assert last == (
        "Feedback on your last answer: Rina reviewed your work and asked for changes "
        "(review round 1): Add the SST line."
    )
    fb = await _events(t["id"], "feedback")
    assert len(fb) == 1 and fb[0].actor == f"agent:{rina['id']}"


async def test_review_escalates_to_a_person_after_max_rounds(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    rina = await new_agent(client, o, "Rina", "Management")
    await _policy(client, o, "Finance", [{"type": "agent", "agent_id": rina["id"]}])
    t = await _task(client, aina, "Quote for Acme")
    for n in range(1, 4):
        await runtime.finish(t["id"], "done", f"Draft {n}.")
        kid = await _review_child(t["id"])
        assert (kid.review_policy or {})["round"] == n
        await runtime.finish(kid.id, "done", _verdict("changes", f"Still wrong ({n})."))
    row = (await _get(client, t["id"]))["task"]
    assert row["status"] == "review" and row["review_round"] == 3
    assert row["blocked_reason"] == "Reviewer asked for changes 3 times"
    assert _started(temporal, t["id"]) == [1, 2]  # sent back twice, then a person decides
    assert len((await _get(client, t["id"]))["reviews"]) == 3


async def test_no_self_review_and_task_level_off(client, llm, temporal):
    from agentic.agents import runtime

    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    await _policy(
        client, o, "Finance", [{"type": "agent", "agent_id": aina["id"]}, {"type": "human"}]
    )
    t = await _task(client, aina, "Quote for Acme")
    await runtime.finish(t["id"], "done", "RM 1,200.")
    row = (await _get(client, t["id"]))["task"]
    assert row["status"] == "review" and row["blocked_owner"] is None  # straight to a person
    async with SessionLocal() as db:
        kids = (await db.scalars(select(Task).where(Task.parent_task_id == t["id"]))).all()
    assert kids == []
    skipped = await _events(t["id"], "review")
    assert len(skipped) == 1 and "nobody reviews their own work" in skipped[0].text

    # A task can switch inherited review off; the requires_review switch then decides.
    rina = await new_agent(client, o, "Rina", "Management")
    await _policy(client, o, "Finance", [{"type": "agent", "agent_id": rina["id"]}])
    t2 = await _task(
        client, aina, "Quick check", requires_review=False, review_policy={"stages": []}
    )
    await runtime.finish(t2["id"], "done", "Fine.")
    assert (await _get(client, t2["id"]))["task"]["status"] == "done"


async def test_review_policy_validation(client, llm, temporal):
    o = await office(client)
    bad = await client.put(
        f"/api/departments/{o['depts']['Finance']}/review-policy",
        json={"review_policy": {"stages": [{"type": "agent", "agent_id": "ag_nope"}]}},
        headers=csrf(client),
    )
    assert bad.status_code == 400
    off = await client.put(
        f"/api/departments/{o['depts']['Finance']}/review-policy",
        json={"review_policy": None},
        headers=csrf(client),
    )
    assert off.status_code == 200 and off.json() == {"review_policy": None}
