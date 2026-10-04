"""P19: the self-check before hand-in (one fix, then a person), it teaches skills, and the
visible plan (update_plan)."""

import json

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import AgentMessage, Task, TaskEvent, Workspace
from agentic.skills import reflect

from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_skills import tool


async def _worked(client, llm, title="Reconcile the September statement", agent=None):
    if agent is None:
        agent = await new_agent(client, await office(client), "Aina")
    task = await new_task(client, agent, title, "Statement lines: 100, 250, 75.")
    llm.call("calc", expression="100 + 250").call("calc", expression="350 + 75")
    llm.say("Total is 425.")
    r = await runtime.run_task_step(task["id"])
    while r.state == "continue":
        r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    return agent, task, r.message


async def _events(task_id: str, kind: str) -> list[TaskEvent]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(TaskEvent).where(TaskEvent.task_id == task_id, TaskEvent.kind == kind)
                )
            ).all()
        )


async def test_a_found_problem_gets_one_fix_before_hand_in(client, llm, temporal):
    agent, task, answer = await _worked(client, llm)
    starts = len(temporal["start"])
    llm.say(json.dumps({"ok": False, "issues": ["The unmatched lines are not listed."]}))
    await runtime.finish(task["id"], "done", answer)
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        nudge = await db.scalar(
            select(AgentMessage.content)
            .where(AgentMessage.task_id == task["id"], AgentMessage.role == "user")
            .order_by(AgentMessage.id.desc())
        )
    assert t is not None and t.status not in ("done", "review")  # back to work, not handed in
    assert nudge and nudge.startswith("Self-check before handing in:")
    assert "unmatched lines" in nudge
    assert len(temporal["start"]) == starts + 1  # relaunched once
    ev = await _events(task["id"], "selfcheck")
    assert len(ev) == 1 and ev[0].data["issues"] == ["The unmatched lines are not listed."]
    # The review went to a different group than the worker's own (smart -> fast first).
    review = next(
        r for r in llm.requests if "You review an AI office worker" in r["messages"][0]["content"]
    )
    assert "ANSWER:" in review["messages"][1]["content"]

    # Second hand-in: no second check; it goes to the person.
    calls = len(llm.requests)
    await runtime.finish(task["id"], "done", "Total is 425. Unmatched: 75.")
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        msgs = (
            await db.scalars(select(AgentMessage).where(AgentMessage.task_id == task["id"]))
        ).all()
    assert t is not None and t.status == "review" and len(llm.requests) == calls
    # The near-miss is a learning signal for skills.
    assert reflect._trigger(t, list(msgs)) == "the self-check caught a mistake before hand-in"


async def test_a_clean_answer_passes(client, llm, temporal):
    _, task, answer = await _worked(client, llm)
    llm.say(json.dumps({"ok": True, "issues": []}))
    await runtime.finish(task["id"], "done", answer)
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
    assert t is not None and t.status == "review"
    assert [e.text for e in await _events(task["id"], "selfcheck")] == ["self-check passed"]


async def test_short_work_is_not_checked_and_a_silent_reviewer_never_blocks(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Say hello")
    llm.say("Hello.")
    await runtime.run_task_step(task["id"])
    calls = len(llm.requests)
    await runtime.finish(task["id"], "done", "Hello.")
    assert len(llm.requests) == calls and not await _events(task["id"], "selfcheck")

    _, worked, answer = await _worked(client, llm, "Second job", agent=agent)
    llm.say("not json at all")  # the reviewer's reply is unusable
    await runtime.finish(worked["id"], "done", answer)
    async with SessionLocal() as db:
        t = await db.get(Task, worked["id"])
    assert t is not None and t.status == "review"
    assert [e.text for e in await _events(worked["id"], "selfcheck")] == [
        "self-check could not run"
    ]


async def test_the_workspace_can_turn_it_off(client, llm, temporal):
    _, task, answer = await _worked(client, llm)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        ws.settings = {**(ws.settings or {}), "quality": {"self_check": False}}
        await db.commit()
    calls = len(llm.requests)
    await runtime.finish(task["id"], "done", answer)
    assert len(llm.requests) == calls and not await _events(task["id"], "selfcheck")


async def test_update_plan_is_a_live_checklist(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Prepare the monthly report")
    out = await tool(
        agent["id"],
        "update_plan",
        task["id"],
        steps=[
            {"text": "Collect sales figures", "status": "done"},
            {"text": "Compare with budget", "status": "doing"},
            "Write the summary",
        ],
    )
    assert out == "Plan saved (1/3 done). Next: Compare with budget."
    ev = await _events(task["id"], "plan")
    assert ev[0].data["steps"][2] == {"text": "Write the summary", "status": "todo"}
    bad = await tool(
        agent["id"],
        "update_plan",
        task["id"],
        steps=[{"text": "a", "status": "doing"}, {"text": "b", "status": "doing"}],
    )
    assert bad.startswith("Error: only one step")
    assert (await tool(agent["id"], "update_plan", None, steps=["x"])).startswith("Plans are for")
    detail = (await client.get(f"/api/tasks/{task['id']}")).json()
    assert any(e["kind"] == "plan" for e in detail["events"])


async def test_the_switch_is_on_the_learning_page(client, llm, temporal):
    from .conftest import csrf

    await office(client)
    assert (await client.get("/api/learning/overview")).json()["self_check"] is True
    r = await client.put("/api/learning/settings", json={"self_check": False}, headers=csrf(client))
    assert r.json() == {"mode": "auto_safe", "self_check": False}
    assert (await client.get("/api/learning/overview")).json()["self_check"] is False
