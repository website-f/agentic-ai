"""P64: "check my inbox" in one call (outlook_inbox: live from Outlook with what the AI already
understood of each mail, the stored copy when Outlook does not answer), and a chat turn that
keeps running when the page's request ends early, with its progress readable meanwhile."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select

from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.microsoft import http
from agentic.models import Agent, AgentMessage, MailItem, MicrosoftAccount, Workspace

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import configure, connect, make_agent, ms, user_id  # noqa: F401

NOW = datetime.now(UTC)
INBOX = TOOLS["outlook_inbox"].handler


async def _ctx(db, agent_id: str, person: str) -> ToolContext:
    a = await db.get(Agent, agent_id)
    ws = await db.get(Workspace, a.workspace_id)
    return ToolContext(db=db, agent=a, workspace=ws, task=None, person=person)


async def _stored(owner_id: str, ws_id: str) -> MicrosoftAccount:
    async with SessionLocal() as db:
        acct = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == owner_id))
        db.add_all(
            [
                MailItem(
                    workspace_id=ws_id, mailbox_kind="personal", mailbox_ref=acct.id,
                    account_id=acct.id, graph_message_id="g-1", received_at=NOW - timedelta(hours=1),  # noqa: E501
                    from_address="ahmad@client.example.com", from_name="Ahmad",
                    subject="Invoice INV-77 overdue", is_read=False, category="invoice",
                    summary="Ahmad says INV-77 is 30 days overdue.", needs_person=True,
                ),
                MailItem(
                    workspace_id=ws_id, mailbox_kind="personal", mailbox_ref=acct.id,
                    account_id=acct.id, graph_message_id="g-2", received_at=NOW - timedelta(hours=3),  # noqa: E501
                    from_address="news@shop.example.com", subject="Weekly deals", is_read=True,
                    category="newsletter",
                ),
                MailItem(  # older than the window
                    workspace_id=ws_id, mailbox_kind="personal", mailbox_ref=acct.id,
                    account_id=acct.id, graph_message_id="g-old", received_at=NOW - timedelta(days=20),  # noqa: E501
                    from_address="x@example.com", subject="Ancient", is_read=False,
                ),
            ]
        )  # fmt: skip
        await db.commit()
        return acct


async def test_the_inbox_in_one_call(client, llm, temporal, ms):
    o = await office(client)
    await configure(client)
    await connect(client)
    owner_id, ws_id = await user_id("owner@example.com")
    twin = await make_agent(o, ws_id, owner_id, is_twin=True, name="My AI")
    await _stored(owner_id, ws_id)

    # Outlook does not list the inbox (the fake answers 404): the stored copy answers, with
    # what the AI understood, newest first, and nothing older than the window.
    async with SessionLocal() as db:
        out = await INBOX(await _ctx(db, twin.id, owner_id), {})
    assert "stored copy" in out and "untrusted" in out
    assert out.index("Invoice INV-77") < out.index("Weekly deals") and "Ancient" not in out
    assert "AI summary: Ahmad says INV-77 is 30 days overdue." in out and "needs you" in out
    async with SessionLocal() as db:
        unread = await INBOX(await _ctx(db, twin.id, owner_id), {"unread_only": True})
    assert "Invoice INV-77" in unread and "Weekly deals" not in unread

    # Outlook answers: live rows (with the preview), joined to the stored understanding.
    seen: list[dict] = []
    old = http.transport

    def live(r: httpx.Request) -> httpx.Response:
        if r.url.path.endswith("/me/mailFolders/inbox/messages"):
            seen.append(dict(r.url.params))
            return httpx.Response(
                200,
                json={"value": [{
                    "id": "g-1", "receivedDateTime": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "from": {"emailAddress": {"name": "Ahmad", "address": "ahmad@client.example.com"}},  # noqa: E501
                    "subject": "Invoice INV-77 overdue", "isRead": False, "hasAttachments": True,
                    "bodyPreview": "Please settle INV-77 this week.",
                }]},
            )  # fmt: skip
        return ms.handler(r)

    http.transport = httpx.MockTransport(live)
    try:
        async with SessionLocal() as db:
            out = await INBOX(await _ctx(db, twin.id, owner_id), {"unread_only": True, "days": 3})
    finally:
        http.transport = old
    assert "live from Outlook" in out and "Please settle INV-77" in out and "(attachments)" in out
    assert "AI summary: Ahmad says" in out and "id: mi_" in out  # the stored id, for outlook_read
    q = seen[0]
    assert "isRead eq false" in q["$filter"] and q["$filter"].startswith("receivedDateTime ge ")
    assert q["$orderby"] == "receivedDateTime desc"


async def test_chat_progress_and_a_turn_that_survives(client, llm, temporal):
    o = await office(client)
    owner_id, ws_id = await user_id("owner@example.com")
    a = await make_agent(o, ws_id, owner_id, is_twin=True, name="My AI")
    llm.say("Hello! Nothing new in your inbox.")
    r = await client.post(f"/api/agents/{a.id}/chat", json={"message": "hi"}, headers=csrf(client))
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    assert r.json()["reply"].startswith("Hello!")
    got = (await client.get(f"/api/chat/sessions/{sid}/progress")).json()
    assert got == {"busy": False, "tools": []}  # finished: the busy mark is gone

    # While a turn runs: busy, with the tools used so far for the last message.
    await valkey().set(f"chat:busy:{sid}", "1", ex=60)
    async with SessionLocal() as db:
        db.add(
            AgentMessage(
                workspace_id=ws_id,
                agent_id=a.id,
                session_id=sid,
                role="user",
                content="inbox?",
                created_at=NOW,
            )
        )
        await db.commit()
        db.add(AgentMessage(workspace_id=ws_id, agent_id=a.id, session_id=sid, role="tool",
                            name="outlook_inbox", content="...", created_at=NOW))  # fmt: skip
        await db.commit()
    got = (await client.get(f"/api/chat/sessions/{sid}/progress")).json()
    assert got == {"busy": True, "tools": ["outlook_inbox"]}
    await valkey().delete(f"chat:busy:{sid}")
