"""P14: agents help each other and learn once. A stuck agent asks a colleague by expertise
(kind=help); the helper's fix is saved as a lesson; next time the lesson is quoted from memory
by the cheap local model and nobody is disturbed. Plus the local backup model: registration,
thinking off, side jobs first, and chat backup mode."""

import json

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.engine import gateway, store
from agentic.models import Agent, AIProvider, BrainPage, ChatSession, ModelGroup, Task, TaskEvent
from agentic.teams import colleague
from agentic.workflows import teams_activities

from .conftest import csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401

ERROR = "ValueError: could not convert string to float: 'RM 1,200.50'"


async def _set_group(client, o, name, model="m1"):
    r = await client.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": o["provider"]["id"], "model_id": model}]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text


async def test_colleagues_are_found_by_expertise(client, llm, temporal):
    o = await office(client)
    maya = await new_agent(client, o, "Maya", "Operations", role="Marketing Executive")
    eko = await new_agent(client, o, "Eko", "Data", role="Software Engineer")
    async with SessionLocal() as db:
        ws = (await db.get(Agent, maya["id"])).workspace_id
        found = await colleague.find_agent(db, ws, "software engineer", maya["id"])
        assert found is not None and found.id == eko["id"]
        assert (await colleague.find_agent(db, ws, "Eko")).id == eko["id"]  # by name still works
        assert await colleague.find_agent(db, ws, "astronaut", maya["id"]) is None


async def test_help_is_solved_saved_as_a_lesson_then_reused(client, llm, temporal):
    o = await office(client)
    maya = await new_agent(client, o, "Maya", "Operations", role="Marketing Executive")
    await new_agent(client, o, "Eko", "Data", role="Software Engineer")
    q = "My ROAS script fails on the ad spend CSV. How do I parse the spend column?"

    # 1. Maya is stuck: she asks whoever is the software engineer for help.
    t1 = await new_task(client, maya, "Weekly ad report")
    llm.call(
        "ask_colleague",
        agent="software engineer",
        kind="help",
        question=q,
        context=f"I ran float(row['spend']) and got: {ERROR}",
    )
    r = await runtime.run_task_step(t1["id"])
    assert r.state == "delegate"
    child_id = r.children[0]["task_id"]
    async with SessionLocal() as db:
        child = await db.get(Task, child_id)
        assert child.title.startswith("Help for Maya") and "ROOT CAUSE:" in child.brief
        assert ERROR in child.brief  # the helper sees the exact error
    fix = (
        "ROOT CAUSE: money is text like 'RM 1,200.50'.\n"
        "FIX: float(x.replace('RM','').replace(',','').strip())\n"
        "LESSON: strip currency symbols and thousands separators before converting money."
    )
    llm.say(fix)
    c = await runtime.run_task_step(child_id)
    await runtime.finish(child_id, "done", c.message)
    await teams_activities.task_collect_children(t1["id"], r.call_id)
    tool = [m for m in await messages(t1["id"]) if m.role == "tool"]
    assert "ROOT CAUSE" in tool[0].content and "wiki/lessons/" in tool[0].content
    async with SessionLocal() as db:
        page = await db.scalar(select(BrainPage).where(BrainPage.path.like("wiki/lessons/%")))
        assert page is not None and "type: lesson" in page.body and "solved_by: Eko" in page.body
        assert ERROR in page.body and "replace('RM'" in page.body

    # 2. Next time, the lesson is quoted from memory: Eko is not woken up.
    await _set_group(client, o, "fast")
    t2 = await new_task(client, maya, "Weekly ad report, next week")
    llm.call("ask_colleague", agent="software engineer", kind="help", question=q)
    llm.say(json.dumps({"note": 1}))
    llm.say("Report done using the saved fix.")
    assert (await runtime.run_task_step(t2["id"])).state == "done"
    tool2 = [m for m in await messages(t2["id"]) if m.role == "tool"]
    assert "From the office memory" in tool2[0].content and "replace('RM'" in tool2[0].content
    async with SessionLocal() as db:
        assert (await db.scalars(select(Task).where(Task.parent_task_id == t2["id"]))).all() == []


async def test_a_stuck_agent_gets_one_tip_to_ask_for_help(client, llm, temporal):
    o = await office(client)
    maya = await new_agent(client, o, "Maya", "Operations")
    t = await new_task(client, maya)
    llm.call("calc", expression="1/0").call("calc", expression="2/0").say("Gave up.")
    await runtime.run_task_step(t["id"])
    results = [m.content for m in await messages(t["id"]) if m.role == "tool"]
    assert "Error: division by zero" in results[0] and "kind='help'" in results[0]
    assert "kind='help'" not in results[1]  # once per task, to save tokens
    async with SessionLocal() as db:
        hints = (
            await db.scalars(
                select(TaskEvent).where(TaskEvent.task_id == t["id"], TaskEvent.kind == "hint")
            )
        ).all()
        assert len(hints) == 1
    assert not runtime._stuck("ask_colleague", "Error: x")  # never hint about asking itself
    assert runtime._stuck(
        "run_python", "Exit code: 1\n\nErrors:\nTraceback (most recent call last)"
    )
    assert not runtime._stuck("run_python", "Exit code: 0\n\nOutput:\nok")


async def test_the_local_model_is_registered_once(client, llm, temporal, monkeypatch):
    o = await office(client)
    await _set_group(client, o, "fast")
    monkeypatch.setattr(settings, "local_llm_url", "http://ollama.test:11434/v1")
    async with SessionLocal() as db:
        ws = await db.scalar(select(AIProvider.workspace_id))
        for _ in range(2):  # idempotent
            await store.ensure_default_groups(db, ws)
        locals_ = (
            await db.scalars(select(AIProvider).where(AIProvider.name == store.LOCAL_PROVIDER))
        ).all()
        assert len(locals_) == 1 and locals_[0].tier == "local"
        groups = {
            g.name: g.members
            for g in (
                await db.scalars(select(ModelGroup).where(ModelGroup.workspace_id == ws))
            ).all()
        }
        member = {"provider_id": locals_[0].id, "model_id": "qwen3:0.6b"}
        assert groups["local"] == [member]
        assert groups["fast"][-1] == member and len(groups["fast"]) == 2  # backup, after cloud


async def test_local_side_jobs_and_chat_backup(client, llm, temporal):
    o = await office(client)
    # The office's provider plays the local model here (tier local, a qwen3 model).
    r = await client.post(
        "/api/ai/providers",
        json={
            "name": "Tiny",
            "base_url": "https://good.fake/v1",
            "api_key": "local-model",
            "tier": "local",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    tiny = r.json()
    await client.put(
        "/api/ai/groups/local",
        json={"members": [{"provider_id": tiny["id"], "model_id": "qwen3:0.6b"}]},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        ws = (await db.get(AIProvider, tiny["id"])).workspace_id
        llm.say("ok")
        reply = await gateway.chat_first(
            db, ws, ("local", "fast"), [{"role": "user", "content": "hi"}], task="t"
        )
        assert reply.provider_name == "Tiny"
        assert llm.requests[-1].get("reasoning_effort") == "none"  # qwen3 thinking off
    # A prompt longer than the local model's window skips it instead of being cut.
    assert gateway.cheap_groups("x" * 2000) == ("local", "fast")
    assert gateway.cheap_groups("x" * 6000, "y" * 6000) == ("fast",)

    # Chat backup mode: the agent's own group has no models, so the local model answers.
    agent = await new_agent(client, o, "Maya", "Operations", model_group="reasoning")
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        s = ChatSession(
            workspace_id=a.workspace_id, agent_id=a.id, user_id=(await _owner_id(db)), title="t"
        )
        db.add(s)
        await db.commit()
        llm.say("Hello! I can help with simple questions for now.")
        out = await runtime.chat_turn(db, a, s, "Hi Maya")
        assert out.content.startswith(runtime.BACKUP_NOTE)
        assert "tools" not in llm.requests[-1]  # the tiny model never drives tools


async def test_small_servers_without_a_browser_offer_no_browser_tools(
    client, llm, temporal, monkeypatch
):
    o = await office(client)
    maya = await new_agent(client, o, "Maya", "Operations")
    async with SessionLocal() as db:
        a = await db.get(Agent, maya["id"])
        a.tools = {**(a.tools or {}), "browser_open": "allow", "browser_read": "allow"}
        names = {t["function"]["name"] for t in runtime.offered_tools(a)}
        assert {"browser_open", "browser_read"} <= names
        monkeypatch.setattr(settings, "browser_url", "")
        names = {t["function"]["name"] for t in runtime.offered_tools(a)}
        assert not any(n.startswith("browser_") for n in names)
        assert "calc" in names  # every other tool stays


async def _owner_id(db):
    from agentic.models import User

    return await db.scalar(select(User.id))
