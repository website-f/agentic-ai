# ruff: noqa: E501
"""P63 Teams channel posts, read only, through a person's own Microsoft 365 connection: only
once an admin granted ChannelMessage.Read.All and the person reconnected; only for their own
AI, only when they are the one asking; what it reads is fenced outside text."""

import httpx

from agentic.agents import runtime
from agentic.agents.teams_tools import CHANNELS_OFF
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

GRAPH = "https://graph.microsoft.com/v1.0"
CHAN = "19:general@thread.tacv2"
TEAMS_P1 = {
    "value": [{"id": "team-1", "displayName": "Tender Team", "description": "Bids"}],
    "@odata.nextLink": f"{GRAPH}/me/joinedTeams?$skiptoken=2",
}
TEAMS_P2 = {"value": [{"id": "team-2", "displayName": "Ops"}]}
CHANNELS = {
    "team-1": {
        "value": [
            {
                "id": CHAN,
                "displayName": "General",
                "membershipType": "standard",
                "webUrl": "https://teams.microsoft.com/l/channel/general",
            },
            {"id": "19:secret@thread.tacv2", "displayName": "Pricing", "membershipType": "private"},
        ]
    },
    "team-2": {"value": []},
}
POSTS = {
    "value": [  # newest first, as Graph answers
        {
            "id": "p3",
            "messageType": "message",
            "createdDateTime": "2026-11-03T09:00:00Z",
            "from": {"application": {"displayName": "Planner"}},
            "subject": None,
            "body": {"content": "<p>Task <b>due</b> Friday</p>"},
        },  # no "replies": fetched
        {
            "id": "p2",
            "messageType": "message",
            "createdDateTime": "2026-11-02T08:00:00Z",
            "from": {"user": {"displayName": "Siti Aminah"}},
            "subject": "Tender JKR-12",
            "body": {"content": "<div>Who prices the <i>cabling</i>?</div>"},
            "replies": [
                {
                    "id": "r2",
                    "messageType": "message",
                    "createdDateTime": "2026-11-02T10:00:00Z",
                    "from": {"user": {"displayName": "Boss One"}},
                    "body": {"content": "Me, by Thursday"},
                },
                {
                    "id": "r1",
                    "messageType": "message",
                    "createdDateTime": "2026-11-02T09:00:00Z",
                    "from": {"user": {"displayName": "Ali"}},
                    "body": {"content": "Not me"},
                },
                {
                    "id": "r0",
                    "messageType": "message",
                    "createdDateTime": "2026-11-02T08:30:00Z",
                    "deletedDateTime": "2026-11-02T08:31:00Z",
                    "body": {"content": ""},
                },
            ],
        },
        {
            "id": "p1",
            "messageType": "systemEventMessage",
            "createdDateTime": "2026-11-01T00:00:00Z",
            "body": {"content": ""},
            "replies": [],
        },
    ]
}
REPLIES_P3 = {"value": [
    {"id": "r9", "messageType": "message", "createdDateTime": "2026-11-03T09:05:00Z",
     "from": {"user": {"displayName": "Ali"}}, "body": {"content": "Noted"}},
]}  # fmt: skip


def channels_on(ms_fake, seen: list, *, forbid: bool = False) -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        p = r.url.path.removeprefix("/v1.0/")
        if r.url.host == "graph.microsoft.com" and p.startswith(("me/joinedTeams", "teams/")):
            seen.append((r.method, p, dict(r.url.params)))
            assert r.method == "GET"  # read only: nothing is ever posted
            if forbid:
                return httpx.Response(
                    403, json={"error": {"code": "Forbidden", "message": "Missing scope"}}
                )
            if p == "me/joinedTeams":
                return httpx.Response(
                    200, json=TEAMS_P2 if "$skiptoken" in r.url.params else TEAMS_P1
                )
            if p.startswith("teams/") and p.endswith("/channels"):
                return httpx.Response(200, json=CHANNELS[p.split("/")[1]])
            if p == f"teams/team-1/channels/{CHAN}/messages":
                return httpx.Response(200, json=POSTS)
            if p == f"teams/team-1/channels/{CHAN}/messages/p3/replies":
                return httpx.Response(200, json=REPLIES_P3)
            return httpx.Response(404, json={"error": {"code": "NotFound", "message": "No team"}})
        return ms_fake.handler(r)

    http.transport = httpx.MockTransport(handler)


async def grant_channels() -> None:
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        a.scopes = f"{a.scopes} https://graph.microsoft.com/Chat.Read https://graph.microsoft.com/ChannelMessage.Read.All"
        await db.commit()


async def test_channel_posts_need_the_admin_scope(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    seen: list = []
    channels_on(ms, seen)

    # Not granted yet: the page and the AI say plainly what to do; Graph is never called.
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["channels_ok"] is False
    r = await client.get("/api/integrations/microsoft/teams/channels")
    assert r.status_code == 409 and r.json()["code"] == "teams_channels_off"
    assert r.json()["message"] == CHANNELS_OFF
    r = await client.get(
        f"/api/integrations/microsoft/teams/teams/team-1/channels/{CHAN}/messages",
        headers={"x-lang": "ms"},
    )
    assert r.status_code == 409 and r.json()["message"].startswith("Membaca mesej saluran Teams")
    me, ws_id = await user_id("owner@example.com")
    twin = await make_agent(o, ws_id, me, name="My Twin", is_twin=True)
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        mine = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=me)
        assert await runtime.run_tool(mine, "teams_channels", {}) == CHANNELS_OFF
        assert (
            await runtime.run_tool(
                mine, "teams_read_channel", {"team_id": "team-1", "channel_id": CHAN}
            )
            == CHANNELS_OFF
        )
    assert seen == []

    # Granted, but Microsoft still refuses (consent withdrawn): the same plain note.
    await grant_channels()
    assert (await client.get("/api/integrations/microsoft/account")).json()["channels_ok"] is True
    channels_on(ms, seen, forbid=True)
    r = await client.get("/api/integrations/microsoft/teams/channels")
    assert r.status_code == 409 and r.json()["code"] == "teams_channels_off"
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        mine = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=me)
        assert await runtime.run_tool(mine, "teams_channels", {}) == CHANNELS_OFF


async def test_my_channel_posts_and_my_ai_only(client, llm, temporal, ms):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    await grant_channels()
    seen: list = []
    channels_on(ms, seen)

    teams = (await client.get("/api/integrations/microsoft/teams/channels")).json()
    assert [t["name"] for t in teams] == ["Tender Team", "Ops"]  # both pages
    assert [(c["name"], c["kind"]) for c in teams[0]["channels"]] == [
        ("General", "standard"),
        ("Pricing", "private"),
    ]
    assert teams[1]["channels"] == []

    posts = (
        await client.get(f"/api/integrations/microsoft/teams/teams/team-1/channels/{CHAN}/messages")
    ).json()
    assert [p["id"] for p in posts] == ["p2", "p3"]  # oldest first, no system events
    assert posts[0]["subject"] == "Tender JKR-12" and posts[0]["text"] == "Who prices the cabling ?"
    assert [r["text"] for r in posts[0]["replies"]] == ["Not me", "Me, by Thursday"]  # no deleted
    assert posts[1]["from"] == "Planner" and posts[1]["text"] == "Task due Friday"
    assert [r["text"] for r in posts[1]["replies"]] == ["Noted"]  # fetched on its own
    first = next(s for s in seen if s[1].endswith(f"{CHAN}/messages"))
    assert first[2]["$expand"] == "replies" and first[2]["$top"] == "30"

    r = await client.get("/api/integrations/microsoft/teams/teams/nope/channels/x/messages")
    assert r.status_code == 404 and r.json()["code"] == "teams_channel_not_found"

    me, ws_id = await user_id("owner@example.com")
    manager = (await member(client, "mgr@example.com", "admin"))["member"]["user_id"]
    twin = await make_agent(o, ws_id, me, name="My Twin", is_twin=True)
    company = await make_agent(o, ws_id, None, name="Desk Agent")
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        offered = {t["function"]["name"] for t in runtime.offered_tools(twin, teams=True)}
        assert {"teams_channels", "teams_read_channel"} <= offered
        assert (
            not {t["function"]["name"] for t in runtime.offered_tools(company)} & access.TEAMS_TOOLS
        )

        mine = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=me)
        out = await runtime.run_tool(mine, "teams_channels", {})
        assert "<<<" in out and f"channel [{CHAN}] General" in out and "Pricing (private)" in out
        out = await runtime.run_tool(
            mine, "teams_read_channel", {"team_id": "team-1", "channel_id": CHAN}
        )
        assert "<<<" in out  # fenced: other people's words
        assert (
            out.index("Tender JKR-12")
            < out.index("Not me")
            < out.index("Me, by Thursday")
            < out.index("Task due Friday")
        )
        assert "Noted" in out and "Planner" in out
        out = await runtime.run_tool(
            mine,
            "teams_read_channel",
            {"team_id": "team-1", "channel_id": CHAN, "since": "2026-11-03"},
        )
        assert "Task due Friday" in out and "Tender JKR-12" not in out
        out = await runtime.run_tool(
            mine,
            "teams_read_channel",
            {"team_id": "team-1", "channel_id": CHAN, "since": "2026-12-01"},
        )
        assert out == "No posts in that channel since then."
        out = await runtime.run_tool(
            mine, "teams_read_channel", {"team_id": "nope", "channel_id": "x"}
        )
        assert out.startswith("Error: that team or channel was not found")

        # Someone else asks the twin, or a company agent: refused.
        theirs = ToolContext(db=db, agent=twin, workspace=ws, task=None, person=manager)
        out = await runtime.run_tool(
            theirs, "teams_read_channel", {"team_id": "team-1", "channel_id": CHAN}
        )
        assert out.startswith("Error: this is your person's own mail and computer")
        out = await runtime.run_tool(
            ToolContext(db=db, agent=company, workspace=ws, task=None, person=me),
            "teams_channels",
            {},
        )
        assert "no Microsoft 365 connection" in out
    assert all(m == "GET" for m, _, _ in seen)
