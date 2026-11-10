"""P95: a rest on ePerolehan (office hours, a break) can be ended by a person ("Carry on now").
Live, 10 Nov 2026 05:17: the browser opened on the person's PC, the site's office hours said
rest until 07:30, and the window sat blank while the screen said "starting"."""

import uuid
from datetime import timedelta

from sqlalchemy import select

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.models import Task, TaskEvent
from agentic.workflows.agent_workflows import AgentTaskWorkflow

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_workflow import FakeRun, env  # noqa: F401

EIGHT_HOURS = 8 * 3600


async def _timers(handle) -> list[str]:
    out = []
    async for e in handle.fetch_history_events():
        for kind in ("started", "fired", "canceled"):
            if e.HasField(f"timer_{kind}_event_attributes"):
                out.append(kind)
    return out


async def test_carry_on_now_ends_the_rest(env):  # noqa: F811
    from temporalio.worker import Worker

    fake = FakeRun(
        [
            {"state": "rest", "message": "Paused", "timeout_seconds": EIGHT_HOURS},
            {"state": "done", "message": "Read the tender."},
        ]
    )
    queue = f"q-{uuid.uuid4().hex[:8]}"
    async with Worker(
        env.client, task_queue=queue, workflows=[AgentTaskWorkflow], activities=fake.activities()
    ):
        handle = await env.client.start_workflow(
            AgentTaskWorkflow.run, "tk_1", id=f"wf-{uuid.uuid4().hex[:8]}", task_queue=queue
        )
        await env.sleep(timedelta(minutes=2))
        await handle.signal(AgentTaskWorkflow.wake)
        assert await handle.result() == "done"
        timers = await _timers(handle)
    assert timers == ["started", "canceled"]  # the eight-hour rest was ended, not slept out
    assert [x[0] for x in fake.log].count("step") == 2


async def test_a_wake_before_the_rest_does_not_skip_it(env):  # noqa: F811
    """A stray "carry on" from earlier never cuts a later rest short."""
    from temporalio.worker import Worker

    fake = FakeRun(
        [
            {"state": "continue"},
            {"state": "rest", "message": "Paused", "timeout_seconds": 600},
            {"state": "done", "message": "ok"},
        ]
    )
    queue = f"q-{uuid.uuid4().hex[:8]}"
    async with Worker(
        env.client, task_queue=queue, workflows=[AgentTaskWorkflow], activities=fake.activities()
    ):
        handle = await env.client.start_workflow(
            AgentTaskWorkflow.run, "tk_2", id=f"wf-{uuid.uuid4().hex[:8]}", task_queue=queue
        )
        await handle.signal(AgentTaskWorkflow.wake)
        assert await handle.result() == "done"
        timers = await _timers(handle)
    assert timers == ["started", "fired"]  # the rest ran its full length


async def _resting_task(client, llm, monkeypatch):  # noqa: F811
    from agentic.agents import runtime

    from .test_agents import new_agent, new_task

    o = await office(client)
    a = await new_agent(client, o, "Rina", tools={"browser_open": "allow"})
    t = await new_task(client, a, "Check tender QT123 on ePerolehan")
    await client.post(f"/api/tasks/{t['id']}/start", json={}, headers=csrf(client))

    async def resting(ctx, name, args, call_id):
        return "Error: SITE_REST 7800: outside office hours on the site"

    monkeypatch.setattr(runtime, "run_tool_once", resting)
    # Queued a few times: in the full suite a stray background call from an earlier test once
    # took the only scripted answer. The step rests at the first one; the rest go unused.
    for _ in range(3):
        llm.call("browser_open", url="https://www.eperolehan.gov.my/")
    r = await runtime.run_task_step(t["id"])
    assert r.state == "rest"
    async with SessionLocal() as db:  # as the live run is (the test doorway starts nothing)
        task = await db.get(Task, t["id"])
        task.status, task.workflow_id = "running", f"task-{t['id']}-1"
        await db.commit()
    return t


async def test_the_person_can_say_carry_on_now(client, llm, temporal, monkeypatch):  # noqa: F811
    t = await _resting_task(client, llm, monkeypatch)
    woken: list[str] = []

    async def wake_task(wid):
        woken.append(wid)

    monkeypatch.setattr(dispatch, "wake_task", wake_task)
    detail = (await client.get(f"/api/tasks/{t['id']}")).json()
    rest = [e for e in detail["events"] if e["kind"] == "rest"]
    assert rest and "Back at" in rest[-1]["text"] and "Resumed" not in rest[-1]["text"]

    r = await client.post(f"/api/tasks/{t['id']}/wake", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert woken == [f"task-{t['id']}-1"]
    async with SessionLocal() as db:
        kinds = (
            await db.scalars(
                select(TaskEvent.kind).where(TaskEvent.task_id == t["id"]).order_by(TaskEvent.id)
            )
        ).all()
    assert kinds[-1] == "wake"


async def test_carry_on_now_only_while_resting(client, llm, temporal, monkeypatch):  # noqa: F811
    from .test_agents import new_agent, new_task

    o = await office(client)
    a = await new_agent(client, o, "Rina")
    t = await new_task(client, a, "Write the weekly note")
    r = await client.post(f"/api/tasks/{t['id']}/wake", json={}, headers=csrf(client))
    assert r.status_code == 409 and r.json()["code"] == "not_resting"
