"""P5 office snapshot: agent state is derived from real tasks, never simulated."""

import httpx
from sqlalchemy import select, update

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Event, Task

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401


async def set_status(task_id: str, status: str) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Task).where(Task.id == task_id).values(status=status))
        await db.commit()


async def test_snapshot_states(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    worker = await new_agent(client, o, "Aina")
    waiter = await new_agent(client, o, "Badrul")
    broken = await new_agent(client, o, "Chen", "Research")
    sleeper = await new_agent(client, o, "Dara", "Data")
    idle = await new_agent(client, o, "Esah", "Writing")
    for agent, status in ((worker, "running"), (waiter, "blocked"), (broken, "failed")):
        t = await new_task(client, agent, f"Task for {agent['name']}")
        await set_status(t["id"], status)
    await client.patch(
        f"/api/agents/{sleeper['id']}", json={"status": "paused"}, headers=csrf(client)
    )

    snap = (await client.get(f"/api/office/{o['branch']['id']}")).json()
    assert snap["branch"]["name"] == "Maju Sdn Bhd"
    assert [d["name"] for d in snap["departments"]][:2] == ["Management", "Finance"]
    states = {a["name"]: a["state"] for a in snap["agents"]}
    assert states == {
        "Aina": "working",
        "Badrul": "waiting_approval",
        "Chen": "error",
        "Dara": "paused",
        "Esah": "idle",
    }
    aina = next(a for a in snap["agents"] if a["name"] == "Aina")
    assert (
        aina["task"]["title"] == "Task for Aina" and aina["department_id"] == o["depts"]["Finance"]
    )
    assert idle["id"] in {a["id"] for a in snap["agents"]}

    other = await client.get("/api/office/br_nope")
    assert other.status_code == 404


async def test_live_signals_for_the_office(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Look it up")
    llm.call("recall", query="supplier terms").say("Nothing on file.")
    await runtime.run_task_step(task["id"])
    await runtime.finish(task["id"], "failed", "No model")
    async with SessionLocal() as db:
        evs = (await db.scalars(select(Event).order_by(Event.seq))).all()
    thinking = [e.data["on"] for e in evs if e.type == "agent.thinking"]
    assert thinking[:2] == [True, False] and len(thinking) == 4  # one pair per model call
    tools = [
        e.data.get("tool") for e in evs if e.type == "task.event" and e.data.get("kind") == "tool"
    ]
    assert tools == ["recall"]  # the office walks the agent to the library
    last = [e.data["status"] for e in evs if e.type == "agent.status"][-1]
    assert last == "error"
