"""P114 (Fitri, 18 Nov 2026): the developer's AI usage report shows what each call was about.

A chat call is matched to the person's message before it and the AI's reply after it (by person,
agent and time); a task call shows the task's brief and result. Their conversations and the tasks
their use paid for are listed, searchable and filterable, and reading them is audited. Only the
developer gets any of it. Synthetic rows only.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from agentic.core.db import SessionLocal
from agentic.models import (
    AgentMessage,
    AuditLog,
    ChatSession,
    Department,
    LLMCall,
    Membership,
    Task,
)

from .test_agents import new_agent, office
from .test_office_roles import as_role
from .test_p73_feedback import make_dev
from .test_p113_ai_usage_people import BASE, _call, _person, _ws


async def _msg(ws_id, agent_id, session_id, role, content, at, **extra) -> int:
    async with SessionLocal() as db:
        m = AgentMessage(
            workspace_id=ws_id,
            agent_id=agent_id,
            session_id=session_id,
            role=role,
            content=content,
            created_at=at,
            **extra,
        )
        db.add(m)
        await db.commit()
        return m.id


async def test_the_log_says_what_each_call_was_about(client):
    o = await office(client)
    ws = await _ws()
    agent = await new_agent(client, o, "Ana")
    other = await new_agent(client, o, "Budi")
    branch = o["branch"]["id"]
    async with SessionLocal() as db:
        d = Department(workspace_id=ws.id, branch_id=branch, name="Finance", slug="finance-p114")
        db.add(d)
        await db.commit()
        dept = d.id
    a = await _person("Aina", "staff", branch)
    async with SessionLocal() as db:
        m = await db.get(Membership, (ws.id, a))
        m.department_id = dept
        s = ChatSession(workspace_id=ws.id, agent_id=agent["id"], user_id=a, title="Payroll help")
        task = Task(
            workspace_id=ws.id,
            title="Aging report",
            brief="List overdue invoices by customer",
            result="Twelve customers are overdue; the largest is Kedai Maju.",
            created_by=f"user:{a}",
            assignee_agent_id=other["id"],
        )
        db.add_all([s, task])
        await db.commit()
        sid, task_id = s.id, task.id

    now = datetime.now(UTC)
    sec = timedelta(seconds=1)
    await _msg(ws.id, agent["id"], sid, "user", "How do I compute overtime pay?", now - 20 * sec)
    await _msg(
        ws.id,
        agent["id"],
        sid,
        "assistant",
        None,
        now - 15 * sec,
        tool_calls=[{"function": {"name": "search", "arguments": '{"secret": "x"}'}}],
    )
    await _msg(ws.id, agent["id"], sid, "tool", "tool output", now - 14 * sec, name="search")
    await _msg(
        ws.id, agent["id"], sid, "assistant", "Multiply the hourly rate by 1.5.", now - 5 * sec
    )
    await _call(a, "agent.chat", 800, 100, 0.01, now - 10 * sec, agent_id=agent["id"])
    await _call(
        a, "agent.task", 3000, 400, 0.04, now - 8 * sec, agent_id=other["id"], task_id=task_id
    )
    await _call(a, "document.write", 500, 50, None, now - 6 * sec)
    async with SessionLocal() as db:  # another model for this one
        await db.execute(
            update(LLMCall)
            .where(LLMCall.user_id == a, LLMCall.task == "document.write")
            .values(model="m2")
        )
        await db.commit()

    # Only the developer.
    staff = await as_role(client, "sam@example.com", "staff", branch_id=branch)
    urls = (
        f"{BASE}/{a}/conversations",
        f"{BASE}/{a}/conversations/{sid}",
        f"{BASE}/{a}/tasks",
        f"{BASE}/{a}/facets",
    )
    for url in urls:
        assert (await client.get(url)).status_code == 403, url
        assert (await staff.get(url)).status_code == 403, url
    await staff.aclose()
    await make_dev()

    # The people list: by department too.
    r = await client.get(BASE, params={"period": "7d", "department": dept})
    assert [p["user_id"] for p in r.json()["people"]] == [a]
    r = await client.get(BASE, params={"period": "7d", "department": "none"})
    assert a not in {p["user_id"] for p in r.json()["people"]}

    # Each call with what it was about.
    r = await client.get(f"{BASE}/{a}/events", params={"period": "7d", "page": 1})
    assert r.status_code == 200, r.text
    ev = {e["purpose"]: e for e in r.json()}
    chat = ev["agent.chat"]
    assert chat["source"] == "chat" and chat["session_id"] == sid
    assert chat["asked"] == "How do I compute overtime pay?"
    assert chat["answered"] == "Multiply the hourly rate by 1.5."
    assert chat["session_title"] == "Payroll help"
    t = ev["agent.task"]
    assert t["source"] == "task" and t["asked"] == "List overdue invoices by customer"
    assert t["answered"].startswith("Twelve customers") and t["task_title"] == "Aging report"
    assert ev["document.write"]["source"] is None and ev["document.write"]["asked"] is None
    assert "secret" not in r.text  # tool-call arguments never come back

    # Search in what they asked and what came back; filters by agent and model.
    async def count(**params) -> int:
        r = await client.get(f"{BASE}/{a}/events", params={"period": "7d", "page": 1, **params})
        assert r.status_code == 200, r.text
        return int(r.headers["X-Total-Count"])

    assert await count(q="overtime") == 1
    assert await count(q="kedai") == 1
    assert await count(q="nothing-like-this") == 0
    assert await count(agent=agent["id"]) == 1
    assert await count(agent="none") == 1
    assert await count(model="m2") == 1
    facets = (await client.get(f"{BASE}/{a}/facets", params={"period": "7d"})).json()
    assert {g["id"] for g in facets["agents"]} == {agent["id"], other["id"], None}
    assert {m["model"] for m in facets["models"]} == {"m1", "m2"}

    # One call in full, audited.
    r = await client.get(f"{BASE}/{a}/events/{chat['id']}")
    assert r.status_code == 200, r.text
    assert r.json()["asked"] == "How do I compute overtime pay?"
    assert (await client.get(f"{BASE}/{a}/events/999999999")).status_code == 404

    # Their conversations, and one in full (text only), audited.
    r = await client.get(f"{BASE}/{a}/conversations", params={"period": "7d", "page": 1})
    assert r.status_code == 200, r.text
    assert r.headers["X-Total-Count"] == "1"
    c = r.json()[0]
    assert (c["id"], c["agent_name"], c["messages"], c["asked"]) == (sid, "Ana", 2, 1)
    assert c["tokens"] == 900 and c["first_message"] == "How do I compute overtime pay?"
    r = await client.get(f"{BASE}/{a}/conversations", params={"period": "7d", "q": "hourly"})
    assert r.headers["X-Total-Count"] == "1"
    r = await client.get(f"{BASE}/{a}/conversations", params={"period": "7d", "q": "zebra"})
    assert r.headers["X-Total-Count"] == "0"
    r = await client.get(f"{BASE}/{a}/conversations/{sid}")
    assert r.status_code == 200, r.text
    lines = r.json()["lines"]
    assert [x["role"] for x in lines] == ["user", "assistant"]
    assert "tool output" not in r.text and "secret" not in r.text
    assert (await client.get(f"{BASE}/us_other/conversations/{sid}")).status_code == 404

    # The tasks their use paid for.
    r = await client.get(f"{BASE}/{a}/tasks", params={"period": "7d", "page": 1})
    assert r.status_code == 200, r.text
    assert [(x["task_id"], x["tokens"], x["agent_name"]) for x in r.json()] == [
        (task_id, 3400, "Budi")
    ]
    r = await client.get(f"{BASE}/{a}/tasks", params={"period": "7d", "q": "invoices"})
    assert r.headers["X-Total-Count"] == "1"

    # Reading it is in the audit log.
    await client.get(f"{BASE}/{a}", params={"period": "7d"})
    async with SessionLocal() as db:
        actions = set(
            (
                await db.scalars(
                    select(AuditLog.action).where(
                        AuditLog.workspace_id == ws.id, AuditLog.target == a
                    )
                )
            ).all()
        )
    assert {
        "ai_usage.report_viewed",
        "ai_usage.call_viewed",
        "ai_usage.conversation_viewed",
    } <= actions
