# ruff: noqa: E501
"""P111: a new Teams conversation with several people.

Fitri (17 Nov 2026): "in teams, i create new conversation, but make it i can search for the
names that are existed or new email as well". The Teams tab's picker sends several addresses;
the AI's teams_send drafts ONE group chat message (to = "a, b"), which still waits for the
person; only their Send starts the group chat (Graph POST /chats, chatType "group", the person
plus everyone named) and posts the message. A group chat always needs "Allow new Teams chats".

The people search behind the picker (/api/m365/people) shows each office member's company and
department, and is never wider than the rule for giving a task (staff: only themselves).

Microsoft is faked (httpx MockTransport): nothing real is called."""

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.microsoft import approvals
from agentic.models import EmailDraft, MicrosoftAccount

from .conftest import csrf
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
from .test_p102_microsoft import CHAT_CREATE, FakeTeams, _ctx_run, _drafts


def test_teams_addresses_split_lower_and_once():
    assert approvals.teams_addresses("Ali@Maju.example.com") == ["ali@maju.example.com"]
    assert approvals.teams_addresses(" a@x.my, <B@x.my>; a@x.my  c@x.my ") == [
        "a@x.my",
        "b@x.my",
        "c@x.my",
    ]
    assert approvals.teams_addresses("") == []


async def test_group_chat_waits_for_the_person_then_starts_with_everyone(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    teams = FakeTeams(ms)
    me, ws_id = await user_id("owner@example.com")
    twin = await make_agent(o, ws_id, me, name="Boss Twin", is_twin=True)

    # Without "Allow new Teams chats": no draft, a plain answer.
    out = await _ctx_run(
        twin.id,
        me,
        "teams_send",
        {"to": "siti@maju.example.com, ali@maju.example.com", "text": "Hi both"},
    )
    assert out.startswith("Error:") and "Allow new Teams chats" in out
    assert await _drafts() == []
    # One bad address stops it, naming it.
    out = await _ctx_run(
        twin.id, me, "teams_send", {"to": "siti@maju.example.com, ali", "text": "Hi"}
    )
    assert out.startswith("Error:") and "'ali'" in out

    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        a.scopes = f"{a.scopes} {CHAT_CREATE}"
        await db.commit()
    # A group even when one of them already has a one-to-one chat with the person (Siti).
    out = await _ctx_run(
        twin.id, me, "teams_send",
        {"to": "Siti@maju.example.com; ali@maju.example.com, siti@maju.example.com", "text": "Tender pack at 3pm"},
    )  # fmt: skip
    assert "a new group chat with siti@maju.example.com, ali@maju.example.com" in out
    d = (await _drafts())[-1]
    assert (
        d.thread_id == ""
        and d.in_reply_to == ""
        and d.to == "siti@maju.example.com, ali@maju.example.com"
    )
    assert teams.created == [] and teams.sent == []  # nothing until the person approves

    r = await client.post(f"/api/email-drafts/{d.id}/send", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    made = teams.created[0]
    assert made["chatType"] == "group"
    assert [m["user@odata.bind"] for m in made["members"]] == [
        "https://graph.microsoft.com/v1.0/users('oid-boss')",
        "https://graph.microsoft.com/v1.0/users('siti@maju.example.com')",
        "https://graph.microsoft.com/v1.0/users('ali@maju.example.com')",
    ]
    assert teams.sent == [("19:new-chat", teams.sent[0][1], "Tender pack at 3pm")]
    async with SessionLocal() as db:
        row = await db.scalar(select(EmailDraft).where(EmailDraft.id == d.id))
        assert row.status == "sent" and row.thread_id == "19:new-chat"


async def test_one_address_still_uses_the_one_to_one_chat(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    FakeTeams(ms)
    me, ws_id = await user_id("owner@example.com")
    twin = await make_agent(o, ws_id, me, name="Boss Twin", is_twin=True)
    # One address they already chat with: that one-to-one chat, as before (no Chat.Create).
    out = await _ctx_run(
        twin.id, me, "teams_send", {"to": "siti@maju.example.com", "text": "Also the BQ."}
    )
    assert "NOTHING is sent" in out
    assert (await _drafts())[-1].thread_id == "19:chat-1"
