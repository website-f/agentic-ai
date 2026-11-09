"""P96: the agents page, agent create, task start and the skills list stay fast in a big
workspace: ~250 members, ~100 agents (team agents, staff twins, private assistants), thousands
of tasks and a full skill library. Synthetic data only.

Each call is timed and its SQL statements counted: a list must not cost a query per row.
"""

import random
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from sqlalchemy import event, insert, select, text

from agentic.core.db import SessionLocal, engine
from agentic.models import Agent, Membership, Skill, SkillUse, Task, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_office_roles import as_role

MEMBERS, TEAM_AGENTS, TWINS, ASSISTANTS, TASKS = 250, 30, 60, 10, 6000


@contextmanager
def counted():
    """How many SQL statements ran inside the block."""
    n = {"q": 0, "log": []}

    def on(_c, _cur, stmt, *_a, **_k):  # noqa: ANN001, ANN002, ANN003
        n["q"] += 1
        n["t"] = time.perf_counter()
        n["s"] = stmt

    def off(*_a, **_k):  # noqa: ANN002, ANN003
        n["log"].append((round((time.perf_counter() - n["t"]) * 1000), n["s"][:90]))

    event.listen(engine.sync_engine, "before_cursor_execute", on)
    event.listen(engine.sync_engine, "after_cursor_execute", off)
    try:
        yield n
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", on)
        event.remove(engine.sync_engine, "after_cursor_execute", off)


def _id(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex[:20]}"


async def _big_office(o: dict) -> dict:
    rnd = random.Random(96)  # noqa: S311 - synthetic data
    ws = o["branch"]["workspace_id"] if "workspace_id" in o["branch"] else None
    async with SessionLocal() as db:
        if ws is None:
            ws = (await db.scalar(select(Membership.workspace_id).limit(1))) or ""
        depts = list(o["depts"].values())
        branch = o["branch"]["id"]
        now = datetime.now(UTC)
        users, members = [], []
        roles = ["staff"] * 170 + ["supervisor"] * 30 + ["hod"] * 20 + ["branch_manager"] * 5
        roles += ["management"] * 5 + ["hr"] * 5 + ["viewer"] * 10 + ["operator"] * 5
        for i in range(MEMBERS):
            uid = _id("us")
            users.append(
                {"id": uid, "email": f"p{i}@example.com", "name": f"Person {i:03d}",
                 "password_hash": "x", "created_at": now, "updated_at": now}
            )  # fmt: skip
            members.append(
                {"workspace_id": ws, "user_id": uid, "role": roles[i % len(roles)],
                 "branch_id": branch, "department_id": rnd.choice(depts),
                 "created_at": now, "updated_at": now}
            )  # fmt: skip
        await db.execute(insert(User), users)
        await db.execute(insert(Membership), members)
        agents = []
        staff = [m for m in members if m["role"] == "staff"]
        leaders = [m for m in members if m["role"] in ("hod", "supervisor", "management")]
        for i in range(TEAM_AGENTS + TWINS + ASSISTANTS):
            kind = "team" if i < TEAM_AGENTS else "twin" if i < TEAM_AGENTS + TWINS else "pa"
            owner = (
                staff[i]["user_id"] if kind == "twin" else
                leaders[i % len(leaders)]["user_id"] if kind == "pa" else None
            )  # fmt: skip
            agents.append(
                {"id": _id("ag"), "workspace_id": ws, "branch_id": branch,
                 "department_id": rnd.choice(depts), "slug": f"a-{i}", "name": f"Agent {i:03d}",
                 "role": "Clerk", "owner_user_id": owner, "is_twin": kind == "twin",
                 "private": kind == "pa", "tools": {}, "sop_ids": [], "created_at": now,
                 "updated_at": now}
            )  # fmt: skip
        await db.execute(insert(Agent), agents)
        tasks = []
        statuses = ["done"] * 8 + ["failed", "cancelled", "ready", "running", "blocked", "review"]
        for i in range(TASKS):
            a = rnd.choice(agents)
            tasks.append(
                {"id": _id("tk"), "workspace_id": ws, "branch_id": branch,
                 "title": f"Job {i}", "brief": "", "status": rnd.choice(statuses),
                 "created_by": "user:x", "assignee_agent_id": a["id"],
                 "created_at": now - timedelta(minutes=i), "updated_at": now}
            )  # fmt: skip
        await db.execute(insert(Task), tasks)
        await db.commit()
        return {"ws": ws, "agents": agents, "tasks": tasks}


async def _learned_skills(ws: str, agents: list[dict], tasks: list[dict]) -> None:
    from agentic.brain import embed

    rnd = random.Random(7)  # noqa: S311 - synthetic data
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        rows = []
        for i in range(40):
            name = f"learned-procedure-{i}"
            desc = f"A procedure learned from repeated work number {i}, with its steps."
            rows.append(
                {"id": _id("sk"), "workspace_id": ws, "name": name, "description": desc,
                 "body": "## When to use\nRepeated work.\n\n## Steps\n1. read_file.\n" * 40,
                 "version": 1, "trust": "trusted", "status": "active", "agent_ids": [],
                 "created_by": f"agent:{agents[i]['id']}", "embedding":
                 await embed.embed_one(f"{name}: {desc}"), "created_at": now, "updated_at": now}
            )  # fmt: skip
        await db.execute(insert(Skill), rows)
        uses = [
            {"workspace_id": ws, "skill_id": rnd.choice(rows)["id"], "version": 1,
             "agent_id": rnd.choice(agents)["id"], "task_id": rnd.choice(tasks)["id"],
             "outcome": rnd.choice(["accepted", "sent_back", None]), "tokens": 1000,
             "created_at": now}
            for _ in range(3000)
        ]  # fmt: skip
        await db.execute(insert(SkillUse), uses)
        await db.commit()


async def _timed(label: str, call, results: dict):  # noqa: ANN001
    with counted() as n:
        t0 = time.perf_counter()
        r = await call()
        ms = (time.perf_counter() - t0) * 1000
    results[label] = (round(ms), n["q"])
    slow = sorted(n["log"], reverse=True)[:4]
    sql = sum(x[0] for x in n["log"])
    print(f"\n{label}: {round(ms)} ms, {n['q']} statements, SQL {sql} ms; slowest {slow}")
    return r


async def test_agents_page_create_task_and_skills_stay_fast_in_a_big_office(client, llm, temporal):
    o = await office(client)
    big = await _big_office(o)
    await client.get("/api/skills")  # built-ins seeded (once per workspace)
    await _learned_skills(big["ws"], big["agents"], big["tasks"])
    mg = await as_role(client, "mg@example.com", "management")
    res: dict[str, tuple[int, int]] = {}
    try:
        await mg.get("/api/agents")  # warm the process (imports, first connections)
        r = await _timed("agents page", lambda: mg.get("/api/agents"), res)
        assert r.status_code == 200
        listed = r.json()
        # Management sees every agent but other people's private assistants.
        assert len(listed) == TEAM_AGENTS + TWINS
        assert all(not a["private"] for a in listed)
        body = {
            "branch_id": o["branch"]["id"],
            "department_id": o["depts"]["Finance"],
            "role": "Clerk",
        }
        # The first write of a process pays one-off costs (statement caches, the event bus
        # connection); the server is warm, so each call is measured after one of its kind.
        for i, label in ((0, None), (1, "agent create")):
            go = {**body, "name": f"Fast Agent {i}"}
            r = await (
                _timed(label, lambda go=go: mg.post("/api/agents", json=go, headers=csrf(mg)), res)
                if label
                else mg.post("/api/agents", json=go, headers=csrf(mg))
            )
            assert r.status_code == 201, r.text
        agent = r.json()
        task = {
            "title": "Onboard our new hire",
            "brief": "Prepare the staff onboarding file for our new hire.",
            "assignee_agent_id": agent["id"],
            "start": True,
        }
        await mg.post("/api/tasks", json={**task, "title": "Warm up"}, headers=csrf(mg))
        r = await _timed(
            "task start", lambda: mg.post("/api/tasks", json=task, headers=csrf(mg)), res
        )
        assert r.status_code == 201, r.text
        r = await _timed("skills list", lambda: mg.get("/api/skills"), res)
        assert r.status_code == 200 and len(r.json()) >= 60
        r = await _timed("agent page", lambda: mg.get(f"/api/agents/{agent['id']}"), res)
        assert r.status_code == 200
    finally:
        await mg.aclose()
    print("\nP96 timings (ms, SQL statements):", res)
    # A list never costs a query per row: these stay flat however many agents there are.
    assert res["agents page"][1] <= 12, res
    assert res["skills list"][1] <= 12, res
    assert res["agent create"][1] <= 30, res
    assert res["task start"][1] <= 45, res
    # Wall time on a shared test machine is noisy; this only catches a call gone slow.
    for label, (ms, _) in res.items():
        assert ms < 3000, (label, res)
    # The agents' tasks are found by index (0058), not by reading the whole table.
    async with SessionLocal() as db:
        await db.execute(text("ANALYZE tasks"))
        ids = ", ".join(f"'{a['id']}'" for a in big["agents"][:90])
        sql = (
            f"EXPLAIN SELECT * FROM tasks WHERE assignee_agent_id IN ({ids}) "  # noqa: S608
            "AND status IN ('running', 'blocked')"
        )
        plan = "\n".join(r[0] for r in (await db.execute(text(sql))).all())
    assert "ix_tasks_assignee_status" in plan, plan
