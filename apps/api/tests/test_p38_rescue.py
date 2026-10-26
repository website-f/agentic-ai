"""P38: no task is ever left hanging: automatic failover to another AI group, stuck runs
restarted, the owner told when their task fails, and a person's way out of any task (stop
now, finish it myself, retry on another AI or agent)."""

from datetime import timedelta

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Task
from agentic.teams import reconcile

from .conftest import csrf
from .test_accountable_work import _events, _get, _running, _started, _task, notices  # noqa: F401
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role


async def _group(client, o: dict, name: str, model: str) -> None:
    r = await client.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": o["provider"]["id"], "model_id": model}]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text


async def test_a_task_carries_on_with_another_group_when_its_own_is_down(client, llm, temporal):
    o = await office(client)
    await _group(client, o, "fast", "m-fast")
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Sum it", start=False)
    # The agent's group (smart) has no usable model: its only provider is switched off for it.
    r = await client.put("/api/ai/groups/smart", json={"members": []}, headers=csrf(client))
    assert r.status_code == 200, r.text
    llm.say("Done on the fast group.")
    step = await runtime.run_task_step(t["id"])
    assert step.state == "done" and step.message == "Done on the fast group."
    assert llm.requests[-1]["model"] == "m-fast"
    ev = await _events(t["id"], "failover")
    assert len(ev) == 1 and ev[0].data["from"] == "smart" and ev[0].data["to"] == "fast"


async def test_stop_finish_by_hand_and_retry_on_another_ai(client, llm, temporal):
    o = await office(client)
    await _group(client, o, "fast", "m-fast")
    aina = await new_agent(client, o, "Aina")
    faiz = await new_agent(client, o, "Faiz")
    t = await _task(client, aina, "Long job", start=True)
    await _running(t["id"])
    # Stop now: the run is terminated, not just asked to cancel between steps.
    r = await client.post(f"/api/tasks/{t['id']}/stop", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "failed" and "Stopped by" in r.json()["error"]
    assert temporal["terminate"] and temporal["terminate"][-1][0] == f"task-{t['id']}-1"
    # Retry on another AI and agent.
    r = await client.post(
        f"/api/tasks/{t['id']}/retry-with",
        json={"model_group": "fast", "agent_id": faiz["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["assignee_agent_id"] == faiz["id"] and _started(temporal, t["id"]) == [1, 2]
    async with SessionLocal() as db:
        assert (await db.get(Task, t["id"])).model_group == "fast"
    llm.say("Answer from the fast AI.")
    await runtime.run_task_step(t["id"])
    assert llm.requests[-1]["model"] == "m-fast"
    bad = await client.post(
        f"/api/tasks/{t['id']}/retry-with", json={"model_group": "image"}, headers=csrf(client)
    )
    assert bad.status_code == 422
    # Finish it by hand: done with the person's own result; work waiting on it goes ahead.
    r = await client.post(
        f"/api/tasks/{t['id']}/finish",
        json={"result": "I phoned the supplier myself: delivery on Friday."},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["result"].startswith("I phoned")
    assert await _events(t["id"], "by_hand")


async def test_only_the_giver_or_a_manager_may_rescue_a_task(client, llm, temporal):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Owner's job", start=True)
    op = await as_role(client, "op@example.com", "operator")
    try:
        r = await op.post(f"/api/tasks/{t['id']}/stop", json={}, headers=csrf(op))
        assert r.status_code == 403 and r.json()["code"] == "not_yours"
    finally:
        await op.aclose()


async def test_the_owner_hears_when_their_task_fails(client, llm, temporal, notices):  # noqa: F811
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Reconcile the bank", start=True)
    await runtime.finish(t["id"], "failed", "The bank portal was down.")
    assert len(notices) == 1 and notices[0]["user"] is not None
    assert "Reconcile the bank" in str(notices[0]["title"])
    assert notices[0]["url"] == f"/tasks?task={t['id']}"


async def test_a_run_with_no_life_for_45_minutes_is_restarted_then_handed_over(
    client,
    llm,
    temporal,
    notices,
    monkeypatch,  # noqa: F811
):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    t = await _task(client, aina, "Hung job", start=True)

    async def alive(_wid):
        return True

    monkeypatch.setattr(reconcile, "workflow_open", alive)
    await _running(t["id"], timedelta(minutes=50))
    out = await reconcile.tick()
    assert out.get("restarted") == 1 and _started(temporal, t["id"]) == [1, 2]
    assert temporal["terminate"][-1][0] == f"task-{t['id']}-1"
    await _running(t["id"], timedelta(minutes=50))
    await reconcile.tick()
    row = (await _get(client, t["id"]))["task"]
    assert row["status"] == "blocked" and row["restartable"]
    assert len(notices) == 1  # its owner decides now
