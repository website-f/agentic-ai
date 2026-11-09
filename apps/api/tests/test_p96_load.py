"""P96: 50 people run their AI on ePerolehan at the same moment (the load harness is
scripts/load/run.py). What these pin down:

- a task step hands its database connection back while it waits for the model or for a
  browser action (seconds each), so 50 running steps do not hold 50-100 connections;
  outside a task step nothing changes, and a session with unsaved work is never committed;
- the worker never runs more steps than its database pool can serve;
- the follow-up frames after a browser action are only taken while someone watches that
  screen (the Monitor's frame request marks it), and stop when the next action starts;
- many first steps at once seed the built-in skills once, without failing a step or losing
  a workspace setting written meanwhile;
- a provider's rate limit (50 people at once can hit one) rests the task and it tries again,
  five times at most, instead of failing it at once;
- two Telegram pollers in two worker replicas never share one lock owner name.
"""

import asyncio
import json

import httpx
from sqlalchemy import select, text

from agentic.agents import browser_tools, runtime
from agentic.core import db as core_db
from agentic.core.config import Settings
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.engine import client as engine_client
from agentic.engine import gateway
from agentic.models import Skill, TaskEvent, Workspace

from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401


async def test_release_idle_only_inside_a_step_and_only_when_clean(client):
    await office(client)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        await core_db.release_idle(db)
        assert db.in_transaction()  # outside a task step: untouched
        with core_db.release_while_waiting():
            await core_db.release_idle(db)
            assert not db.in_transaction()  # connection back in the pool
            assert ws.name  # objects stay loaded (expire_on_commit=False)
            await db.scalar(select(Workspace.id))
            ws.name = ws.name + " "  # unsaved work: never committed early
            await core_db.release_idle(db)
            assert db.in_transaction() and db.dirty
        await db.rollback()
    async with SessionLocal() as db:
        assert not (await db.scalar(select(Workspace.name))).endswith(" ")


async def test_the_model_call_waits_without_a_connection(client):
    await office(client)
    seen: list[bool] = []
    box: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(box["db"].in_transaction())
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "model": body["model"],
                "choices": [{"finish_reason": "stop", "message": {"content": "ok"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            },
        )

    engine_client.use_transport(httpx.MockTransport(handler))
    try:
        for inside in (False, True):
            async with SessionLocal() as db:
                box["db"] = db
                ws_id = await db.scalar(select(Workspace.id))  # a transaction is open
                hi = [{"role": "user", "content": "hi"}]
                if inside:
                    with core_db.release_while_waiting():
                        await gateway.chat(db, ws_id, "smart", hi, task="agent.task")
                else:
                    await gateway.chat(db, ws_id, "smart", hi, task="agent.task")
    finally:
        engine_client.use_transport(None)
    assert seen == [True, False]


def test_worker_slots_never_outgrow_the_pool():
    s = Settings(worker_max_activities=32, db_pool_size=32, db_max_overflow=32)
    assert s.worker_slots == 32
    s = Settings(worker_max_activities=32, db_pool_size=10, db_max_overflow=10)
    assert s.worker_slots == 10  # two connections per running step at most
    s = Settings(worker_max_activities=4, db_pool_size=1, db_max_overflow=0)
    assert s.worker_slots == 1


async def test_follow_frames_only_while_someone_watches(monkeypatch):
    shots: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        shots.append(request.url.path)
        return httpx.Response(200, content=b"\xff\xd8jpeg\xff\xd9")

    monkeypatch.setattr(browser_tools, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(browser_tools, "FOLLOW_GAP", 0.01)
    sid = "bs_p96follow"
    await valkey().delete(f"browser:watch:{sid}", f"browser:act:{sid}")
    await browser_tools._follow(sid, 1)
    assert shots == []  # nobody is looking at this screen: no extra frames
    await valkey().set(f"browser:watch:{sid}", "1", ex=10)
    await valkey().set(f"browser:act:{sid}", "1", ex=60)
    await browser_tools._follow(sid, 1)
    assert len(shots) == browser_tools.FOLLOW_FRAMES
    shots.clear()
    await valkey().set(f"browser:act:{sid}", "2", ex=60)  # the next action started
    await browser_tools._follow(sid, 1)
    assert shots == []


async def test_monitor_frame_request_marks_the_screen_watched(client, llm, temporal):  # noqa: F811
    o = await office(client)
    a = await new_agent(client, o, "Ana")
    sid = "bs_p96watch"
    async with SessionLocal() as db:
        ws_id = await db.scalar(select(Workspace.id))
    meta = {"workspace_id": ws_id, "agent_id": a["id"], "task_id": "t"}
    await valkey().set(f"browser:session:{sid}", json.dumps(meta), ex=60)
    await valkey().delete(f"browser:watch:{sid}")
    r = await client.get(f"/api/browser/{sid}/frame.jpg")
    assert r.status_code == 404  # nothing on screen yet, but someone is looking
    assert await valkey().exists(f"browser:watch:{sid}")


async def test_many_first_steps_seed_builtin_skills_once(client):
    await office(client)
    from agentic.skills import store

    async with SessionLocal() as db:
        ws_id = await db.scalar(select(Workspace.id))
        await db.execute(text("DELETE FROM skills WHERE workspace_id = :w"), {"w": ws_id})
        ws = await db.get(Workspace, ws_id)
        ws.settings = {k: v for k, v in (ws.settings or {}).items() if k != "builtin_skills"}
        await db.commit()

    async def first_step(i: int) -> None:
        async with SessionLocal() as db:
            ws = await db.get(Workspace, ws_id)
            await store.ensure_builtin(db, ws)

    async def someone_saves_a_setting() -> None:
        async with SessionLocal() as db:
            await db.execute(
                text(
                    "UPDATE workspaces SET settings = settings || '{\"p96_marker\": 1}'::jsonb "
                    "WHERE id = :w"
                ),
                {"w": ws_id},
            )
            await db.commit()

    await asyncio.gather(*(first_step(i) for i in range(8)), someone_saves_a_setting())
    async with SessionLocal() as db:
        names = (await db.scalars(select(Skill.name).where(Skill.workspace_id == ws_id))).all()
        ws = await db.get(Workspace, ws_id)
        assert len(names) == len(set(names)) == len(store.BUILTIN)
        assert ws.settings.get("p96_marker") == 1  # not written over by a seeding step
        assert set(ws.settings["builtin_skills"]) == {b[0] for b in store.BUILTIN}


def test_telegram_lock_owner_differs_per_process():
    from agentic.channels import poller

    assert len(poller.ME.split("-")) >= 3 and poller.ME != poller._owner_name()


async def test_a_rate_limited_ai_rests_the_task_instead_of_failing(client, temporal, monkeypatch):  # noqa: F811
    o = await office(client)
    a = await new_agent(client, o, "Ana")
    t = await new_task(client, a, "Sum the invoices")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, json={"error": {"message": "slow down"}}, headers={"retry-after": "90"}
        )

    monkeypatch.setattr(gateway, "MAX_WAIT", 0)  # no waiting inside the call itself
    engine_client.use_transport(httpx.MockTransport(handler))
    try:
        for _ in range(runtime.AI_RESTS):
            r = await runtime.run_task_step(t["id"])
            assert r.state == "rest" and 60 <= r.timeout_seconds <= 600
            assert "AI service is busy" in (r.message or "")
        r = await runtime.run_task_step(t["id"])
        assert r.state == "failed"  # five rests, then it fails as before
    finally:
        engine_client.use_transport(None)
    async with SessionLocal() as db:
        kinds = (await db.scalars(select(TaskEvent.kind).where(TaskEvent.task_id == t["id"]))).all()
    assert kinds.count("rest") == runtime.AI_RESTS


def test_http_clients_share_one_tls_context_and_skip_the_missing_sniffio():
    import sys

    from agentic.core import http
    from agentic.engine import client as eng

    assert http.tls() is http.tls()  # made once, not read from disk per call
    c = eng._client(5)
    assert c._transport._pool._ssl_context is http.tls()  # noqa: SLF001
    assert "sniffio" in sys.modules  # present, or recorded as absent: no path search
