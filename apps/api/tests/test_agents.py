"""P2 agent runtime: policy, tools, prompt layering, task steps, approvals, questions,
broadcasts, board moves, chat. The model is scripted through a fake OpenAI-compatible
transport, so every test controls exactly what the "LLM" answers."""

import json

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import dispatch, policy, runtime
from agentic.agents.tools import safe_eval
from agentic.engine import client as engine_client
from agentic.models import Agent, AgentMessage, Approval, Task

from .conftest import csrf, setup_owner

GOOD_KEY = "good-key-123"


class ScriptedLLM:
    """Each chat call pops the next scripted reply. Records every request."""

    def __init__(self) -> None:
        self.replies: list[dict] = []
        self.requests: list[dict] = []
        self.hosts: list[str] = []

    def say(self, text: str) -> "ScriptedLLM":
        self.replies.append({"content": text})
        return self

    def call(self, name: str, **args) -> "ScriptedLLM":
        n = len(self.replies) + 1
        self.replies.append(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": f"call_{n}",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(args)},
                    }
                ],
            }
        )
        return self

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.hosts.append(request.url.host)
        if request.url.host == "good.fake" and request.url.path.endswith("/chat/completions"):
            body = json.loads(request.content)
            self.requests.append(body)
            msg = self.replies.pop(0) if self.replies else {"content": "(script empty)"}
            return httpx.Response(
                200,
                json={
                    "model": body["model"],
                    "choices": [
                        {
                            "finish_reason": "tool_calls" if msg.get("tool_calls") else "stop",
                            "message": msg,
                        }
                    ],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 20},
                },
            )
        if request.url.host == "good.fake" and request.url.path == "/page":
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                text="<html><script>evil()</script><h1>Prices</h1><p>RM 4.50 per kg</p></html>",
            )
        return httpx.Response(404, json={"error": "no route"})


@pytest.fixture
def llm():
    s = ScriptedLLM()
    engine_client.use_transport(httpx.MockTransport(s.handler))
    yield s
    engine_client.use_transport(None)


@pytest.fixture
def temporal(monkeypatch):
    """Replace the Temporal doorway: record what the API asked for."""
    calls: dict[str, list] = {
        "start": [],
        "signal": [],
        "cancel": [],
        "replies": [],
        "learn_chat": [],
        "dream": [],
        "skill_eval": [],
        "deliveries": [],
    }

    async def start_task(task_id, run):
        calls["start"].append((task_id, run))
        return f"task-{task_id}-{run}"

    async def signal_decision(wid, aid):
        calls["signal"].append((wid, aid))

    async def cancel_task(wid):
        calls["cancel"].append(wid)

    async def start_broadcast_replies(bid, ids):
        calls["replies"].append((bid, ids))

    async def start_chat_learning(message_id):
        calls["learn_chat"].append(message_id)

    async def start_deliveries(ids):
        calls["deliveries"].extend(ids)

    async def start_skill_eval(kind, target):
        calls["skill_eval"].append((kind, target))
        return f"skill-eval-{target}"

    async def start_dream(ws_id):
        calls["dream"].append(ws_id)
        return f"dream-{ws_id}"

    for name, fn in [
        ("start_task", start_task),
        ("signal_decision", signal_decision),
        ("cancel_task", cancel_task),
        ("start_broadcast_replies", start_broadcast_replies),
        ("start_chat_learning", start_chat_learning),
        ("start_dream", start_dream),
        ("start_skill_eval", start_skill_eval),
        ("start_deliveries", start_deliveries),
    ]:
        monkeypatch.setattr(dispatch, name, fn)
    return calls


async def office(c: httpx.AsyncClient) -> dict:
    """Owner, one branch with standard departments, a provider and a smart group."""
    await setup_owner(c)
    branch = (await c.post("/api/branches", json={"name": "Maju Sdn Bhd"}, headers=csrf(c))).json()
    p = (
        await c.post(
            "/api/ai/providers",
            json={
                "name": "Good",
                "base_url": "https://good.fake/v1",
                "api_key": GOOD_KEY,
                "tier": "free",
            },
            headers=csrf(c),
        )
    ).json()
    await c.put(
        "/api/ai/groups/smart",
        json={"members": [{"provider_id": p["id"], "model_id": "m1"}]},
        headers=csrf(c),
    )
    depts = {d["name"]: d["id"] for d in branch["departments"]}
    return {"branch": branch, "depts": depts, "provider": p}


async def new_agent(
    c: httpx.AsyncClient, o: dict, name: str, dept: str = "Finance", **extra
) -> dict:
    body = {
        "branch_id": o["branch"]["id"],
        "department_id": o["depts"][dept],
        "name": name,
        "role": f"{dept} agent",
        "soul": f"I am {name}.",
        **extra,
    }
    r = await c.post("/api/agents", json=body, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


async def new_task(
    c: httpx.AsyncClient, agent: dict, title: str = "Do the thing", brief: str = ""
) -> dict:
    r = await c.post(
        "/api/tasks",
        json={"title": title, "brief": brief, "assignee_agent_id": agent["id"]},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def messages(task_id: str) -> list[AgentMessage]:
    from agentic.core.db import SessionLocal

    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(AgentMessage)
                    .where(AgentMessage.task_id == task_id)
                    .order_by(AgentMessage.id)
                )
            ).all()
        )


# ---------------------------------------------------------------- policy and tools


def test_calc_is_arithmetic_only():
    assert safe_eval("2 + 3 * 4") == 14
    assert safe_eval("(1,250.50 * 1.08) + 300") == pytest.approx(1650.54)
    assert safe_eval("round(10 / 3, 2)") == 3.33
    for bad in ("__import__('os').system('x')", "open('/etc/passwd')", "2 ** 1000", "a + 1"):
        with pytest.raises((ValueError, SyntaxError)):
            safe_eval(bad)


async def test_policy_order_hardline_beats_auto():
    a = Agent(name="Ana", tools={"web_fetch": "allow"}, autonomy="auto")
    blocked = await policy.evaluate(
        a, "web_fetch", {"url": "http://169.254.169.254/latest/meta-data"}
    )
    assert (
        blocked.effect == "deny"
        and blocked.hardline
        and blocked.rule == "hardline.internal_address"
    )
    assert (await policy.evaluate(a, "rm_rf", {})).rule == "hardline.unknown_tool"

    cautious = Agent(name="Ben", tools={}, autonomy="ask")
    assert (
        await policy.evaluate(cautious, "web_fetch", {"url": "https://good.fake/x"})
    ).effect == "ask"
    assert (await policy.evaluate(cautious, "calc", {"expression": "1+1"})).effect == "allow"
    auto = Agent(name="Cai", tools={}, autonomy="auto")
    assert (
        await policy.evaluate(auto, "web_fetch", {"url": "https://good.fake/x"})
    ).effect == "allow"
    denied = Agent(name="Dee", tools={"calc": "deny"}, autonomy="auto")
    assert (await policy.evaluate(denied, "calc", {"expression": "1"})).effect == "deny"


# ---------------------------------------------------------------- agents and prompt


async def test_sop_layering_in_prompt(client: httpx.AsyncClient, llm):
    o = await office(client)
    b, d = o["branch"]["id"], o["depts"]
    for scope, scope_id, title in [
        ("workspace", None, "Group code of conduct"),
        ("branch", b, "Maju invoicing rules"),
        ("department", d["Finance"], "Month-end close"),
        ("department", d["Research"], "Research only"),
        ("library", None, "Advanced accounting"),
    ]:
        r = await client.post(
            "/api/sops",
            json={
                "scope": scope,
                "scope_id": scope_id,
                "title": title,
                "body": f"Body of {title}.",
            },
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    library = next(s for s in (await client.get("/api/sops")).json() if s["scope"] == "library")

    r = await client.post(
        "/api/agents/preview-prompt",
        json={
            "branch_id": b,
            "department_id": d["Finance"],
            "name": "Aina",
            "role": "Senior Accountant",
            "soul": "Precise and calm.",
            "sop_ids": [library["id"]],
        },
        headers=csrf(client),
    )
    text = r.json()["prompt"]
    order = [
        "Workspace rules",
        "Group code of conduct",
        "Maju invoicing rules",
        "Month-end close",
        "Advanced accounting",
        "Your name is Aina. Your role is Senior Accountant in the Finance department",
    ]
    positions = [text.index(s) for s in order]
    assert positions == sorted(positions)
    assert "Research only" not in text


async def test_create_agent_validates_placement(client: httpx.AsyncClient, llm):
    o = await office(client)
    other = (
        await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    ).json()
    bad = await client.post(
        "/api/agents",
        json={
            "branch_id": o["branch"]["id"],
            "department_id": other["departments"][0]["id"],
            "name": "X",
            "role": "Y",
        },
        headers=csrf(client),
    )
    assert bad.status_code == 400 and bad.json()["code"] == "bad_department"
    unknown = await client.post(
        "/api/agents",
        json={
            "branch_id": o["branch"]["id"],
            "name": "X",
            "role": "Y",
            "tools": {"shell": "allow"},
        },
        headers=csrf(client),
    )
    assert unknown.status_code == 400 and unknown.json()["code"] == "unknown_tool"


# ---------------------------------------------------------------- task steps


async def test_task_uses_tool_then_answers(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Add the invoices", "Invoices: 1250.50 and 300")
    llm.call("calc", expression="1250.50 + 300").say("Total is RM 1550.50.")

    r = await runtime.run_task_step(task["id"])
    assert r.state == "done" and r.message == "Total is RM 1550.50."
    roles = [(m.role, m.content) for m in await messages(task["id"])]
    assert roles[0][0] == "user" and "Add the invoices" in roles[0][1]
    assert roles[2] == ("tool", "1550.5")
    # The second model call saw the tool result and the cache-stable system prompt first.
    second = llm.requests[1]["messages"]
    assert second[0]["role"] == "system" and second[0]["content"].startswith("## Workspace rules")
    assert second[-1] == {
        "role": "tool",
        "content": "1550.5",
        "tool_call_id": "call_1",
        "name": "calc",
    }

    detail = (await client.get(f"/api/tasks/{task['id']}")).json()
    assert any(e["kind"] == "tool" for e in detail["events"])


async def test_approval_pauses_then_resumes(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Rafi", "Research")
    task = await new_task(client, agent, "Check the price")
    started = await client.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(client))
    assert started.status_code == 200 and temporal["start"] == [(task["id"], 1)]

    llm.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval" and r.timeout_seconds > 86000
    pending = (await client.get("/api/approvals")).json()
    assert len(pending) == 1 and pending[0]["tool_label"] == "Read a web page"
    assert pending[0]["reason"] == "Need today's price"
    assert (await client.get(f"/api/tasks/{task['id']}")).json()["task"]["status"] == "blocked"
    assert "good.fake" not in [
        h for h in llm.hosts if h == "good.fake" and False
    ]  # not fetched yet

    decided = await client.post(
        f"/api/approvals/{r.approval_id}",
        json={"decision": "approve", "scope": "always"},
        headers=csrf(client),
    )
    assert decided.status_code == 200 and decided.json()["status"] == "approved"
    assert temporal["signal"] == [(f"task-{task['id']}-1", r.approval_id)]

    await runtime.apply_approval(r.approval_id)
    tool_msg = [m for m in await messages(task["id"]) if m.role == "tool"][-1]
    assert "RM 4.50 per kg" in tool_msg.content and "evil()" not in tool_msg.content
    assert tool_msg.content.count("<<<") == 1  # fenced as untrusted data

    llm.say("Price is RM 4.50/kg.")
    assert (await runtime.run_task_step(task["id"])).state == "done"
    # "Always" remembered: the agent no longer asks for web pages.
    a = (await client.get(f"/api/agents/{agent['id']}")).json()
    assert a["tools"]["web_fetch"] == "allow"


async def test_hardline_never_runs_the_tool(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(
        client, o, "Dara", "Data", autonomy="auto", tools={"web_fetch": "allow"}
    )
    task = await new_task(client, agent, "Read metadata")
    llm.call("web_fetch", url="http://169.254.169.254/latest/meta-data").say("I could not read it.")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    tool_msg = [m for m in await messages(task["id"]) if m.role == "tool"][0]
    assert tool_msg.content.startswith("Blocked by policy (hardline.internal_address)")
    assert "169.254.169.254" not in llm.hosts  # the request was never sent


async def test_agent_asks_a_human(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Prepare payroll")
    await client.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(client))
    llm.call("ask_human", question="Which month should I prepare?")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    q = (await client.get("/api/approvals")).json()[0]
    assert q["kind"] == "question" and q["reason"] == "Which month should I prepare?"

    empty = await client.post(
        f"/api/approvals/{q['id']}", json={"decision": "answer"}, headers=csrf(client)
    )
    assert empty.status_code == 422
    await client.post(
        f"/api/approvals/{q['id']}",
        json={"decision": "answer", "answer": "September"},
        headers=csrf(client),
    )
    await runtime.apply_approval(q["id"])
    tool_msg = [m for m in await messages(task["id"]) if m.role == "tool"][-1]
    assert tool_msg.content == "Answer from Owner One: September"


async def test_no_models_fails_with_reason(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    await client.put("/api/ai/groups/smart", json={"members": []}, headers=csrf(client))
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent)
    r = await runtime.run_task_step(task["id"])
    assert r.state == "failed" and "no models yet" in (r.message or "")


async def test_finish_puts_work_in_review_then_accept(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent)
    await runtime.finish(task["id"], "done", "All done.")
    t = (await client.get(f"/api/tasks/{task['id']}")).json()["task"]
    assert t["status"] == "review" and t["result"] == "All done."
    bad = await client.patch(
        f"/api/tasks/{task['id']}", json={"status": "ready"}, headers=csrf(client)
    )
    assert bad.status_code == 409
    ok = await client.post(f"/api/tasks/{task['id']}/accept", json={}, headers=csrf(client))
    assert ok.json()["status"] == "done"


async def test_revise_continues_same_conversation(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent)
    await runtime.finish(task["id"], "done", "Draft one.")
    r = await client.post(
        f"/api/tasks/{task['id']}/revise",
        json={"feedback": "Add the tax line."},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["run_count"] == 1
    assert [m.content for m in await messages(task["id"])][
        -1
    ] == "Feedback on your last answer: Add the tax line."


# ---------------------------------------------------------------- broadcasts


async def test_department_broadcast_reaches_exactly_that_department(
    client: httpx.AsyncClient, llm, temporal
):
    o = await office(client)
    fin1 = await new_agent(client, o, "Aina")
    fin2 = await new_agent(client, o, "Badrul")
    await new_agent(client, o, "Rafi", "Research")
    other = (
        await client.post("/api/branches", json={"name": "Other Co"}, headers=csrf(client))
    ).json()
    other_fin = next(d["id"] for d in other["departments"] if d["name"] == "Finance")
    r = await client.post(
        "/api/agents",
        json={
            "branch_id": other["id"],
            "department_id": other_fin,
            "name": "Zul",
            "role": "Accountant",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201

    sent = await client.post(
        "/api/broadcasts",
        json={
            "audience": {"department_ids": [o["depts"]["Finance"]]},
            "mode": "announcement",
            "body": "Month-end close moves to the 28th.",
        },
        headers=csrf(client),
    )
    assert sent.status_code == 201, sent.text
    b = sent.json()
    assert {x["agent_name"] for x in b["receipts"]} == {"Aina", "Badrul"}
    assert b["audience_label"] == "Finance (Maju Sdn Bhd)" and b["acked"] == 2

    # It now sits in their context, and only theirs.
    prompt = (
        await client.post(
            "/api/agents/preview-prompt",
            json={
                "branch_id": o["branch"]["id"],
                "department_id": o["depts"]["Finance"],
                "name": "Aina",
                "role": "x",
            },
            headers=csrf(client),
        )
    ).json()["prompt"]
    assert "Recent announcements" not in prompt  # preview has no agent id; real agents get it
    from agentic.agents.prompt import system_prompt
    from agentic.core.db import SessionLocal

    async with SessionLocal() as db:
        aina = await db.get(Agent, fin1["id"])
        rafi = await db.scalar(select(Agent).where(Agent.name == "Rafi"))
        assert "Month-end close moves to the 28th." in await system_prompt(db, aina)
        assert "Month-end close" not in await system_prompt(db, rafi)

    directive = (
        await client.post(
            "/api/broadcasts",
            json={
                "audience": {"agent_ids": [fin2["id"]]},
                "mode": "directive",
                "body": "Reconcile September bank statements\nUse the new template.",
            },
            headers=csrf(client),
        )
    ).json()
    task_id = directive["receipts"][0]["task_id"]
    t = (await client.get(f"/api/tasks/{task_id}")).json()["task"]
    assert t["status"] == "triage" and t["title"] == "Reconcile September bank statements"
    assert t["source"] == "broadcast" and t["assignee_name"] == "Badrul"


async def test_broadcast_reply_requests_start_workflow(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    b = (
        await client.post(
            "/api/broadcasts",
            json={"audience": {"all": True}, "body": "Hello team", "request_reply": True},
            headers=csrf(client),
        )
    ).json()
    assert b["acked"] == 0 and temporal["replies"] == [(b["id"], [a["id"]])]


# ---------------------------------------------------------------- chat


async def test_chat_with_agent(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.call("calc", expression="8 * 12").call("web_fetch", url="https://good.fake/page").say(
        "It is 96."
    )
    r = await client.post(
        f"/api/agents/{agent['id']}/chat", json={"message": "What is 8 x 12?"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == "It is 96." and body["tools_used"] == ["calc"]
    msgs = (await client.get(f"/api/chat/sessions/{body['session_id']}/messages")).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]

    from agentic.core.db import SessionLocal

    async with SessionLocal() as db:
        approvals = (await db.scalars(select(Approval))).all()
        assert approvals == []  # chat never creates approvals; ask-tools are declined


async def test_running_task_cannot_be_dragged_to_done(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent)
    await runtime.start_run(task["id"])
    r = await client.patch(
        f"/api/tasks/{task['id']}", json={"status": "done"}, headers=csrf(client)
    )
    assert r.status_code == 409
    from agentic.core.db import SessionLocal

    async with SessionLocal() as db:
        assert (await db.get(Task, task["id"])).status == "running"
