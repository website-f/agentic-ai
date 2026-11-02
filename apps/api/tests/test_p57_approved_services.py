"""P57: the approved-services lock. Off: as before. On: an AI provider, web tools or a channel
the company has not approved is not used, the attempt waits as a request (Approved services
and the bell), and an owner's approval lets it through."""

from agentic.agents import policy
from agentic.core.db import SessionLocal
from agentic.models import Agent

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role


async def _chat(client, agent_id: str, text: str = "Hello"):
    return await client.post(
        f"/api/agents/{agent_id}/chat", json={"message": text}, headers=csrf(client)
    )


async def test_off_changes_nothing_and_on_uses_only_approved(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    llm.say("Hi there.")
    assert (await _chat(client, a["id"])).status_code == 200  # off: as before

    ov = (await client.get("/api/compliance")).json()
    assert ov["lock"] is False
    ai = next(s for s in ov["services"] if s["kind"] == "AI provider")
    assert ai["name"] == "Good" and ai["approval"] is None

    r = await client.put("/api/compliance/lock", json={"on": True}, headers=csrf(client))
    assert r.status_code == 200
    blocked = await _chat(client, a["id"])
    assert blocked.status_code == 502  # no approved AI provider: nothing is sent
    ov = (await client.get("/api/compliance")).json()
    ai = next(s for s in ov["services"] if s["key"] == ai["key"])
    assert ai["request"]["count"] >= 1 and ov["waiting"] >= 1
    needs = (await client.get("/api/me/needs")).json()
    assert any(i["key"] == "services" for i in needs["items"])

    r = await client.post(
        "/api/compliance/approve",
        json={"key": ai["key"], "location": "Singapore", "data": "Task text, masked"},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["approval"]["location"] == "Singapore"
    llm.say("Hi again.")
    assert (await _chat(client, a["id"])).status_code == 200  # approved: works again
    ov = (await client.get("/api/compliance")).json()
    assert next(s for s in ov["services"] if s["key"] == ai["key"])["request"] is None

    log = (await client.get("/api/audit")).json()["items"]
    assert {"compliance.lock", "compliance.approved"} <= {e["action"] for e in log}


async def test_web_tools_wait_for_approval_when_locked(client, llm, temporal):
    o = await office(client)
    a = await new_agent(client, o, "Aina")
    async with SessionLocal() as db:
        agent = await db.get(Agent, a["id"])
    d = await policy.evaluate(agent, "web_search", {"query": "cement prices"})
    assert d.effect != "deny" or not d.rule.startswith("compliance")
    await client.put("/api/compliance/lock", json={"on": True}, headers=csrf(client))
    d = await policy.evaluate(agent, "web_search", {"query": "cement prices"})
    assert d.effect == "deny" and d.rule == "compliance.web" and "Approved services" in d.reason
    await client.post("/api/compliance/approve", json={"key": "web"}, headers=csrf(client))
    d = await policy.evaluate(agent, "web_search", {"query": "cement prices"})
    assert d.rule != "compliance.web"


async def test_only_the_owner_sets_the_lock(client, llm, temporal):
    o = await office(client)
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=o["branch"]["id"])
    r = await bm.put("/api/compliance/lock", json={"on": True}, headers=csrf(bm))
    assert r.status_code in (403, 404)
    assert (await client.get("/api/compliance")).json()["lock"] is False
