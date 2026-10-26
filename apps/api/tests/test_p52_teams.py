# ruff: noqa: E501
"""P52 Microsoft Teams through a person's own Microsoft 365 connection: their chats on the
Microsoft 365 page, and Teams tools only for their own AI (never a company agent, never for
someone else talking to their twin)."""

import httpx

from agentic.agents import runtime
from agentic.agents.tools import ToolContext
from agentic.core.db import SessionLocal
from agentic.microsoft import access, http
from agentic.models import MicrosoftAccount, Workspace

from .conftest import csrf  # noqa: F401
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import (  # noqa: F401
    TENANT,
    configure,
    connect,
    make_agent,
    ms,
    my_account,
    user_id,
)
from .test_office_roles import member

CHATS = {
    "value": [
        {
            "id": "19:chat-1",
            "topic": None,
            "chatType": "oneOnOne",
            "webUrl": "https://teams.microsoft.com/l/chat/19:chat-1",
            "members": [{"displayName": "Boss One"}, {"displayName": "Siti Aminah"}],
            "lastMessagePreview": {
                "createdDateTime": "2026-10-26T08:00:00Z",
                "from": {"user": {"displayName": "Siti Aminah"}},
                "body": {"content": "<p>Can you send the <b>tender</b> pack today?</p>"},
            },
        }
    ]
}
MESSAGES = {
    "value": [
        {"id": "2", "messageType": "message", "createdDateTime": "2026-10-26T08:00:00Z",
         "from": {"user": {"displayName": "Siti Aminah"}}, "body": {"content": "<p>Today please</p>"}},
        {"id": "1", "messageType": "message", "createdDateTime": "2026-10-26T07:55:00Z",
         "from": {"user": {"displayName": "Boss One"}}, "body": {"content": "Which pack?"}},
        {"id": "0", "messageType": "systemEventMessage", "createdDateTime": "2026-10-26T07:00:00Z",
         "body": {"content": ""}},
    ]
}  # fmt: skip


def teams_on(ms_fake, sent: list) -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        p = r.url.path.removeprefix("/v1.0/")
        if r.url.host == "graph.microsoft.com":
            if p == "me/chats":
                return httpx.Response(200, json=CHATS)
            if p == "me/chats/19:chat-1/messages":
                return httpx.Response(200, json=MESSAGES)
            if p == "chats/19:chat-1/messages" and r.method == "POST":
                sent.append(r.content)
                return httpx.Response(201, json={"id": "3"})
        return ms_fake.handler(r)

    http.transport = httpx.MockTransport(handler)


async def test_my_teams_chats_and_my_ai_only(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    sent: list = []
    teams_on(ms, sent)

    # A connection made before Teams was added: the page asks to reconnect once.
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["connected"] and acct["teams_ok"] is False
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        a.scopes = f"{a.scopes} https://graph.microsoft.com/Chat.Read"
        await db.commit()
    assert (await client.get("/api/integrations/microsoft/account")).json()["teams_ok"] is True

    chats = (await client.get("/api/integrations/microsoft/teams/chats")).json()
    assert (
        chats[0]["title"] == "Siti Aminah"
        and chats[0]["last_text"] == "Can you send the tender pack today?"
    )
    msgs = (await client.get("/api/integrations/microsoft/teams/chats/19:chat-1/messages")).json()
    assert [m["text"] for m in msgs] == [
        "Which pack?",
        "Today please",
    ]  # oldest first, no system events

    me, ws_id = await user_id("owner@example.com")
    manager = (await member(client, "mgr@example.com", "admin"))["member"]["user_id"]
    twin = await make_agent(o, ws_id, me, name="My Twin", is_twin=True)
    company = await make_agent(o, ws_id, None, name="Desk Agent")
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        assert await access.teams_ready(db, twin)
        assert not await access.teams_ready(db, company)
        offered = {t["function"]["name"] for t in runtime.offered_tools(twin, teams=True)}
        assert {"teams_chats", "teams_read_chat", "teams_send"} <= offered
        assert (
            not {t["function"]["name"] for t in runtime.offered_tools(company)} & access.TEAMS_TOOLS
        )
        # Its person asks: it reads their chats. Someone else asks: refused.
        mine = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=me)
        out = await runtime.run_tool(mine, "teams_read_chat", {"chat_id": "19:chat-1"})
        assert "Today please" in out and "<<<" in out  # fenced: other people's words
        theirs = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=manager)
        out = await runtime.run_tool(theirs, "teams_chats", {})
        assert out.startswith("Error: this is your person's own mail and computer")
        out = await runtime.run_tool(
            ToolContext(db=db, agent=company, workspace=ws, task=None, person=me), "teams_chats", {}
        )
        assert "no Microsoft 365 connection" in out
        # Sending is the twin's person's to approve (default mode ask); when run, it sends.
        assert (
            await runtime.run_tool(
                mine, "teams_send", {"chat_id": "19:chat-1", "text": "Sending now"}
            )
        ) == "Sent in Teams."
        assert sent and b"Sending now" in sent[0]
