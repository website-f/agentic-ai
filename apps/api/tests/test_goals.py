"""P13 goal loop: a task with a goal keeps working until a judge says it is met, bounded by a
cap; every continuation still counts against the model-call limit and budget."""

from agentic.agents import goals, runtime
from agentic.core.db import SessionLocal
from agentic.models import AgentMessage, Task

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401


def _verdicts(monkeypatch, seq):
    """Feed the judge a fixed list of (met, missing) verdicts."""
    calls = {"n": 0}

    async def fake(db, task, agent, result):
        v = seq[min(calls["n"], len(seq) - 1)]
        calls["n"] += 1
        return v

    monkeypatch.setattr(goals, "judge", fake)
    return calls


async def test_a_task_continues_until_the_goal_is_met(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    r = await client.post(
        "/api/tasks",
        json={
            "title": "Draft three taglines",
            "brief": "Write taglines.",
            "assignee_agent_id": agent["id"],
            "requires_review": False,
            "goal": "There are at least three distinct taglines.",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201 and r.json()["goal"]
    task_id = r.json()["id"]
    # First pass falls short; second pass meets the goal.
    _verdicts(monkeypatch, [(False, "only one tagline so far"), (True, "")])
    llm.say("Tagline: Clean and fresh.")  # pass 1 answer
    assert (await runtime.run_task_step(task_id)).state == "done"
    await runtime.finish(task_id, "done", "Tagline: Clean and fresh.")

    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        assert t.status == "ready" and t.goal_tries == 1  # nudged and relaunched
        nudges = [
            m.content
            for m in (await db.scalars(select_messages(task_id))).all()
            if m.role == "user" and "goal is not met" in (m.content or "")
        ]
        assert nudges and "only one tagline" in nudges[0]

    llm.say("Three taglines: A, B, C.")  # pass 2 answer
    assert (await runtime.run_task_step(task_id)).state == "done"
    await runtime.finish(task_id, "done", "Three taglines: A, B, C.")
    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        assert t.status == "done" and t.goal_tries == 1  # met on the second pass


async def test_the_goal_loop_stops_at_the_cap(client, llm, temporal, monkeypatch):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Keep trying", "x")
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        t.goal = "Impossible to satisfy."
        t.requires_review = False
        await db.commit()
    _verdicts(monkeypatch, [(False, "nope")])  # never met
    for _ in range(goals.MAX_GOAL_TRIES + 2):
        async with SessionLocal() as db:
            t = await db.get(Task, task["id"])
            if t.status in ("done", "failed"):
                break
        llm.say("attempt")
        await runtime.run_task_step(task["id"])
        await runtime.finish(task["id"], "done", "attempt")
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        assert t.goal_tries == goals.MAX_GOAL_TRIES  # stopped at the cap
        assert t.status == "done"  # finished (not met, but no longer looping)


def select_messages(task_id):
    from sqlalchemy import select

    return select(AgentMessage).where(AgentMessage.task_id == task_id).order_by(AgentMessage.id)
