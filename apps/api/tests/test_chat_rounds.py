"""Chat that needs many tool rounds (search the inbox, open several emails) ends with a real
answer: the last round offers no tools and asks the agent to answer from what it found."""

from agentic.agents import runtime

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401


async def test_a_long_tool_chain_still_gets_an_answer(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    for i in range(runtime.CHAT_ROUNDS - 1):
        llm.call("calc", expression=f"{i} + 1")
    llm.say("Nothing urgent: 2 newsletters and a login alert you can ignore.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "check my inbox and tell me if anything is urgent"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reply"].startswith("Nothing urgent")
    last = llm.requests[-1]
    assert not last.get("tools")  # the final round could only answer
    assert "you have used your tools" in last["messages"][-1]["content"]


async def test_a_short_chat_is_unchanged(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.call("calc", expression="2 + 2").say("It is 4.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat", json={"message": "what is 2+2"}, headers=csrf(client)
    )
    assert r.json()["reply"] == "It is 4." and llm.requests[-1].get("tools")
