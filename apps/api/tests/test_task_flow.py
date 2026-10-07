"""Task flow: a task into a workflow draft or a schedule, and the person's recent chats."""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import Agent, AgentMessage, ChatSession, Schedule, TaskEvent

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_teams import team_temporal  # noqa: F401

DRAFT = {
    "nodes": [
        {"id": "n1", "type": "start", "title": "Request in"},
        {"id": "n2", "type": "step", "title": "Search the web", "action": "research"},
        {"id": "n3", "type": "step", "title": "Write it up"},
        {"id": "n4", "type": "end", "title": "Done"},
    ],
    "edges": [
        {"from": "n1", "to": "n2"},
        {"from": "n2", "to": "n3"},
        {"from": "n3", "to": "n4"},
    ],
}


async def _ran(task: dict, agent: dict) -> None:
    """What an agent did on the task: two tool calls (one typed a password), an update."""
    now = datetime.now(UTC)
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        assert a is not None
        call = lambda n, name, args: {  # noqa: E731
            "id": f"c{n}",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }
        db.add_all(
            [
                AgentMessage(
                    workspace_id=a.workspace_id,
                    agent_id=a.id,
                    task_id=task["id"],
                    role="assistant",
                    content=None,
                    tool_calls=[call(1, "web_search", {"query": "durian prices Pahang"})],
                    created_at=now,
                ),
                AgentMessage(
                    workspace_id=a.workspace_id,
                    agent_id=a.id,
                    task_id=task["id"],
                    role="tool",
                    content="RESULT PAGE TEXT that should never reach the analyst",
                    created_at=now + timedelta(seconds=1),
                ),
                AgentMessage(
                    workspace_id=a.workspace_id,
                    agent_id=a.id,
                    task_id=task["id"],
                    role="assistant",
                    content=None,
                    tool_calls=[
                        call(2, "browser_login", {"password": "hunter2-secret"}),
                        call(3, "web_fetch", {"url": "https://good.fake/page", "api_key": "x1"}),
                    ],
                    created_at=now + timedelta(seconds=2),
                ),
                TaskEvent(
                    task_id=task["id"],
                    ts=now + timedelta(seconds=3),
                    kind="progress",
                    actor=f"agent:{a.id}",
                    text="Found three suppliers",
                ),
            ]
        )
        await db.commit()


async def test_a_task_becomes_a_workflow_draft(client, llm, temporal):  # noqa: F811
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    task = await new_task(client, aina, "Price check on durian", "Weekly prices, cited.")
    await _ran(task, aina)
    llm.say(json.dumps(DRAFT))
    r = await client.post(f"/api/tasks/{task['id']}/to-workflow", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Price check on durian"
    nodes = {n["id"]: n for n in body["graph"]["nodes"]}
    assert set(nodes) == {"n1", "n2", "n3", "n4"}
    # Its steps go to the agent that did the job; the layout reads top to bottom.
    assert nodes["n2"]["agent_id"] == aina["id"] and nodes["n3"]["agent_id"] == aina["id"]
    assert nodes["n1"]["y"] < nodes["n2"]["y"] < nodes["n4"]["y"]
    sent = llm.requests[-1]["messages"]
    assert sent[0]["role"] == "system" and "procedure" in sent[0]["content"]
    ask = sent[-1]["content"]
    assert "used web_search" in ask and "durian prices Pahang" in ask
    assert "Found three suppliers" in ask and "Weekly prices, cited." in ask
    assert "used browser_login" in ask and "used web_fetch" in ask
    # Never the secrets it typed, never what pages said, and the record is fenced as data.
    assert "hunter2" not in ask and "x1" not in ask and "RESULT PAGE TEXT" not in ask
    assert "<<<" in ask and ">>>" in ask

    # A reply that is not a graph is a clear error, not a crash.
    llm.say("no idea")
    r = await client.post(f"/api/tasks/{task['id']}/to-workflow", json={}, headers=csrf(client))
    assert r.status_code == 502 and r.json()["code"] == "bad_draft"


async def test_a_task_repeats_on_a_schedule(client, llm, team_temporal):  # noqa: F811
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    task = await new_task(client, aina, "Monday sales summary", "Totals by branch.")
    r = await client.post(
        f"/api/tasks/{task['id']}/repeat",
        json={"cron": "0 9 * * 1", "requires_review": False},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["agent_id"] == aina["id"] and s["title"] == "Monday sales summary"
    assert s["brief"] == "Totals by branch." and s["name"] == "Monday sales summary"
    assert s["cron"] == "0 9 * * 1" and s["requires_review"] is False and s["next_runs"]
    assert team_temporal["schedules"][-1][0] == s["id"]  # synced to the worker

    r = await client.post(
        f"/api/tasks/{task['id']}/repeat",
        json={"cron": "61 9 * * 1", "name": "Bad"},
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "bad_cron"

    loose = (
        await client.post("/api/tasks", json={"title": "Nobody yet"}, headers=csrf(client))
    ).json()
    r = await client.post(
        f"/api/tasks/{loose['id']}/repeat", json={"cron": "0 9 * * 1"}, headers=csrf(client)
    )
    assert r.status_code == 400 and r.json()["code"] == "no_assignee"
    r = await client.post(
        f"/api/tasks/{loose['id']}/repeat",
        json={"cron": "0 9 * * 1"},
        headers={**csrf(client), "x-lang": "ms"},
    )
    assert r.json()["message"] == "Tugaskan ejen sebelum menetapkannya berulang."
    async with SessionLocal() as db:
        assert len((await db.scalars(select(Schedule))).all()) == 1


async def test_only_people_who_see_the_task_can_repeat_or_convert_it(
    client,
    llm,  # noqa: F811
    team_temporal,  # noqa: F811
):
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    task = await new_task(client, aina, "Owner's private job", "Secret plans.")
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    viewer = await as_role(client, "viewer@example.com", "viewer")
    try:
        # Staff may draft workflows (their own agents) but cannot reach this task: not here.
        r = await staff.post(f"/api/tasks/{task['id']}/to-workflow", json={}, headers=csrf(staff))
        assert r.status_code == 404
        r = await staff.post(
            f"/api/tasks/{task['id']}/repeat", json={"cron": "0 9 * * 1"}, headers=csrf(staff)
        )
        assert r.status_code == 404
        # A viewer sees the task but may neither draft workflows nor make schedules.
        r = await viewer.post(f"/api/tasks/{task['id']}/to-workflow", json={}, headers=csrf(viewer))
        assert r.status_code == 403
        r = await viewer.post(
            f"/api/tasks/{task['id']}/repeat", json={"cron": "0 9 * * 1"}, headers=csrf(viewer)
        )
        assert r.status_code == 403
    finally:
        await staff.aclose()
        await viewer.aclose()
    assert not llm.requests  # nothing was sent to a model
    async with SessionLocal() as db:
        assert (await db.scalars(select(Schedule))).all() == []


async def test_recent_chats_are_only_your_own(client, llm, temporal):  # noqa: F811
    o = await office(client)
    aina = await new_agent(client, o, "Aina")
    r = await client.post(
        "/api/assistants", json={"preset": "chief_of_staff"}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    mine = r.json()
    llm.say("Hello from Aina.").say("Hello from your assistant.")
    for a in (aina, mine):
        r = await client.post(
            f"/api/agents/{a['id']}/chat", json={"message": "hi"}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text

    admin = await as_role(client, "admin@example.com", "admin")
    try:
        admin_id = (await admin.get("/api/auth/me")).json()["user"]["id"]
        # A stray conversation row on the owner's assistant must never surface for the admin.
        async with SessionLocal() as db:
            a = await db.get(Agent, mine["id"])
            assert a is not None
            db.add(ChatSession(workspace_id=a.workspace_id, agent_id=a.id, user_id=admin_id))
            await db.commit()

        rows = (await client.get("/api/chat/recent")).json()
        assert {x["agent"]["id"] for x in rows} == {aina["id"], mine["id"]}
        assert rows[0]["updated_at"] >= rows[-1]["updated_at"]
        assert {"id", "title", "updated_at"} <= set(rows[0])
        assert (await client.get("/api/chat/recent", params={"limit": 1})).json()[0] == rows[0]

        assert (await admin.get("/api/chat/recent")).json() == []
        llm.say("Hi admin.")
        r = await admin.post(
            f"/api/agents/{aina['id']}/chat", json={"message": "hi"}, headers=csrf(admin)
        )
        assert r.status_code == 200, r.text
        theirs = (await admin.get("/api/chat/recent")).json()
        assert [x["agent"]["id"] for x in theirs] == [aina["id"]]
        assert theirs[0]["id"] not in {x["id"] for x in rows}
    finally:
        await admin.aclose()
