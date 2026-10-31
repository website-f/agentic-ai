"""P56: a stopped task's questions end with it, an agent never asks again for what a person
refused in the task, "Stop the whole task" from the approval; the bell lists each thing and
can be marked read; the brain graph shows facts around the agents that learned them; SOPs
fill a budget instead of every prompt; a private assistant's `remember` stays private."""

from sqlalchemy import func, select

from agentic.agents import runtime
from agentic.agents.prompt import build_parts
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.models import SOP, Agent, AgentMessage, Approval, BrainFact, Workspace

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_channels import blocked_task


async def _approvals(task_id: str) -> list[Approval]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(Approval)
                    .where(Approval.task_id == task_id)
                    .order_by(Approval.created_at)
                )
            ).all()
        )


async def test_no_is_not_asked_again_in_the_same_task(client, llm, temporal):
    o = await office(client)
    task, approval_id = await blocked_task(client, llm, o)
    r = await client.post(
        f"/api/approvals/{approval_id}", json={"decision": "deny"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    # The agent tries another page: nobody is asked again; it is told the answer was no.
    llm.call("web_fetch", url="https://good.fake/other", why="Need today's price")
    llm.replies[-1]["tool_calls"][0]["id"] = "call_again"  # the fake numbers by queue length
    llm.say("I could not read the price: reading web pages was declined.")
    for _ in range(3):
        step = await runtime.run_task_step(task["id"])
        if step.state != "continue":
            break
    rows = await _approvals(task["id"])
    assert len(rows) == 1 and rows[0].status == "denied"
    async with SessionLocal() as db:
        said = await db.scalar(
            select(AgentMessage.content).where(
                AgentMessage.task_id == task["id"], AgentMessage.content.like("Not asked:%")
            )
        )
    assert said and "already said no" in said


async def test_stopping_a_task_ends_its_questions(client, llm, temporal):
    o = await office(client)
    task, approval_id = await blocked_task(client, llm, o)
    r = await client.post(f"/api/approvals/{approval_id}/stop", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    # The run settles shortly (Temporal); its questions end at once.
    assert r.json()["status"] in ("cancelled", "blocked")
    assert [a.status for a in await _approvals(task["id"])] == ["cancelled"]
    # Not in Approvals any more, and cannot be answered.
    pending = (await client.get("/api/approvals")).json()
    assert approval_id not in {a["id"] for a in pending}
    late = await client.post(
        f"/api/approvals/{approval_id}", json={"decision": "approve"}, headers=csrf(client)
    )
    assert late.status_code == 409


async def test_cancelling_from_the_task_also_ends_its_questions(client, llm, temporal):
    o = await office(client)
    task, _ = await blocked_task(client, llm, o)
    r = await client.post(f"/api/tasks/{task['id']}/cancel", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    await runtime.finish(task["id"], "cancelled", None)  # the run settles (Temporal does)
    assert [a.status for a in await _approvals(task["id"])] == ["cancelled"]


async def test_the_bell_lists_each_thing_and_marks_read(client, llm, temporal):
    o = await office(client)
    task, approval_id = await blocked_task(client, llm, o)
    got = (await client.get("/api/me/needs")).json()
    mine = [e for e in got["entries"] if e["key"] == "approvals"]
    assert mine and mine[0]["id"] == approval_id and mine[0]["title"] == task["title"]
    assert mine[0]["new"] is True and got["unread"] >= 1
    r = await client.post("/api/me/needs/seen", json={}, headers=csrf(client))
    assert r.status_code == 200
    after = (await client.get("/api/me/needs")).json()
    assert after["unread"] == 0 and after["total"] == got["total"]  # still listed, not new


async def test_the_graph_shows_facts_around_the_agent_that_learned_them(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        ws = await db.get(Workspace, agent.workspace_id)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None)
        out = await TOOLS["remember"].handler(ctx, {"fact": "Maju Trading pays in 45 days."})
        assert out == "Saved."
    g = (await client.get("/api/brain/graph")).json()
    kinds = {n["kind"] for n in g["nodes"]}
    assert {"fact", "agent_node"} <= kinds
    fact = next(n for n in g["nodes"] if n["kind"] == "fact")
    assert {"source": fact["id"], "target": f"agent:{a['id']}"} in g["edges"]
    assert "page-name" not in g["unresolved"]  # the example link in AGENTS.md


async def test_a_private_assistants_memory_stays_private(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        agent.private, agent.owner_user_id = True, None
        ws = await db.get(Workspace, agent.workspace_id)
        await TOOLS["remember"].handler(
            ToolContext(db=db, agent=agent, workspace=ws, task=None),
            {"fact": "The boss prefers short replies.", "private": False},
        )
        f = await db.scalar(select(BrainFact).where(BrainFact.text.like("The boss%")))
        assert f is not None and f.agent_id == agent.id  # private, whatever it asked


async def test_sops_fill_a_budget_and_the_rest_are_listed(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
        for i in range(6):
            db.add(
                SOP(
                    workspace_id=agent.workspace_id,
                    scope="workspace",
                    title=f"Procedure {i}",
                    body=f"Step for procedure {i}.\n" * 900,  # ~20k characters each
                )
            )
        await db.commit()
        parts = await build_parts(db, agent, "task")
        sops = [p for p in parts if p.sop]
        total = sum(len(p.text) for p in sops)
        assert total < 30_000
        assert "find_sop" in sops[0].text  # the first is cut with a pointer
        listed = next(p for p in sops if p.title.startswith("More SOPs"))
        assert "Procedure 5" in listed.text
        n = await db.scalar(select(func.count()).select_from(SOP))
        assert n >= 6
