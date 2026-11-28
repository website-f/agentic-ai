"""P147 (owner, 28 Nov 2026: "Copilot first: it costs us nothing for licensed users; our AI
engine only for big tasks Copilot can't handle; only for people connected via Microsoft who have
the subscription"): a person's own plain chat goes to Microsoft 365 Copilot (Chat API, as them)
when the owner switched it on and the person is ready; everything else, and every failure, goes
to our engine. Microsoft is faked (microsoft/http.py transport); synthetic people only."""

import json
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy import select

from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.microsoft import app, auth, copilot, http
from agentic.microsoft.domains import CONSUMER_TENANT
from agentic.models import AgentMessage, LLMCall, MicrosoftAccount, Workspace

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import (  # noqa: F401
    GRANTED,
    PUBLIC,
    TENANT,
    configure,
    connect,
    make_agent,
    ms,
    my_account,
    user_id,
)

ANSWER = "Selamat pagi. <Person>Ali</Person> says hello[^1^]."
COPILOT_SKUS = [
    {
        "skuPartNumber": "Microsoft_365_Copilot",
        "servicePlans": [
            {"servicePlanName": "M365_COPILOT_BUSINESS_CHAT", "provisioningStatus": "Success"},
        ],
    },
    {"skuPartNumber": "O365_BUSINESS_PREMIUM", "servicePlans": []},
]


class FakeCopilot:
    """The Copilot endpoints of Graph, in front of the usual fake Microsoft."""

    def __init__(self, ms_fake) -> None:
        self.ms = ms_fake
        self.chats: list[dict] = []
        self.created = 0
        self.searches: list[dict] = []
        self.chat_status = 200
        self.licences = COPILOT_SKUS
        self.answer = ANSWER
        http.transport = httpx.MockTransport(self.handler)

    def handler(self, r: httpx.Request) -> httpx.Response:
        if r.url.host != "graph.microsoft.com":
            return self.ms.handler(r)
        p = r.url.path
        body = json.loads(r.content) if r.content else None
        if p == "/v1.0/me/licenseDetails":
            return httpx.Response(200, json={"value": self.licences})
        if p == "/beta/copilot/conversations" and r.method == "POST":
            assert body == {}
            self.created += 1
            return httpx.Response(201, json={"id": f"conv-{self.created}", "turnCount": 0})
        if p.startswith("/beta/copilot/conversations/") and p.endswith("/chat"):
            assert r.headers["authorization"].startswith("Bearer at-")  # the person's own token
            self.chats.append(body)
            if self.chat_status != 200:
                return httpx.Response(
                    self.chat_status,
                    headers={"Retry-After": "120"} if self.chat_status == 429 else {},
                    json={"error": {"code": "x", "message": "no"}},
                )
            return httpx.Response(
                200,
                json={
                    "id": p.split("/")[-2],
                    "messages": [
                        {"text": body["message"]["text"], "attributions": []},
                        {
                            "text": self.answer,
                            "attributions": [
                                {
                                    "attributionType": "citation",
                                    "providerDisplayName": "Greeting guide",
                                    "seeMoreWebUrl": "https://maju.sharepoint.com/g.docx",
                                }
                            ],
                        },
                    ],
                },
            )
        if p == "/v1.0/copilot/retrieval":
            self.searches.append(body)
            return httpx.Response(
                200,
                json={
                    "retrievalHits": [
                        {
                            "webUrl": f"https://maju.sharepoint.com/{body['dataSource']}/vpn.docx",
                            "extracts": [
                                {"text": "Sign in with 2FA for the VPN.", "relevanceScore": 0.7},
                                {"text": "Pick Corporate VPN.", "relevanceScore": 0.9},
                            ],
                            "resourceType": "listItem",
                            "resourceMetadata": {"title": f"VPN ({body['dataSource']})"},
                        }
                    ]
                },
            )
        return self.ms.handler(r)


async def _setup(client, ms, *, scopes: str | None = None, on: bool = True) -> dict:
    """Owner with Microsoft 365 connected (Copilot allowed), their twin, Copilot first on."""
    o = await office(client)
    assert (await configure(client, tenant=TENANT)).status_code == 200
    await connect(client)
    acct = await my_account()
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, acct.id)
        a.scopes = app.with_copilot(GRANTED) if scopes is None else scopes
        await db.commit()
    uid, ws = await user_id("owner@example.com")
    twin = await make_agent(o, ws, uid, is_twin=True, name="Boss Twin")
    if on:
        r = await client.patch(
            "/api/ai/settings",
            json={"copilot_first": {"on": True, "max_prompt_chars": 6000, "use_retrieval": True}},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        assert r.json()["copilot_first"]["on"] is True
    return {**o, "twin": twin, "uid": uid, "ws": ws, "acct": acct.id}


async def _chat(client, agent_id: str, text: str) -> dict:
    r = await client.post(
        f"/api/agents/{agent_id}/chat", json={"message": text}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _calls(provider: str | None = None) -> list[LLMCall]:
    async with SessionLocal() as db:
        q = select(LLMCall).order_by(LLMCall.id)
        if provider:
            q = q.where(LLMCall.provider_name == provider)
        return list((await db.scalars(q)).all())


# ---------------------------------------------------------------- routing


async def test_switch_off_engine_answers(client, llm, temporal, ms):
    s = await _setup(client, ms, on=False)
    fake = FakeCopilot(ms)
    llm.say("Good morning in Malay is selamat pagi.")
    body = await _chat(client, s["twin"].id, "Translate to Malay: good morning")
    assert body["reply"] == "Good morning in Malay is selamat pagi."
    assert len(llm.requests) == 1 and fake.chats == [] and await _calls("copilot") == []


async def test_ready_person_plain_prompt_goes_to_copilot(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    body = await _chat(client, s["twin"].id, "Translate to Malay: good morning")
    # Copilot's answer, its entity tags and citation marks cleaned, its sources listed.
    assert body["reply"].startswith("Selamat pagi. Ali says hello.")
    assert "[Greeting guide](https://maju.sharepoint.com/g.docx)" in body["reply"]
    assert llm.requests == []  # no engine call at all
    sent = fake.chats[0]
    assert sent["message"]["text"].startswith("Translate to Malay: good morning")
    assert sent["locationHint"]["timeZone"]
    assert "instructions" in sent["additionalContext"][0]["text"]
    [row] = await _calls("copilot")
    assert row.status == "ok" and row.user_id == s["uid"] and float(row.cost_usd) == 0
    assert row.prompt_tokens == 0 and row.completion_tokens == 0 and row.saved_tokens > 50
    assert row.model == "m1"  # the engine model it stood in for
    async with SessionLocal() as db:
        last = await db.scalar(
            select(AgentMessage)
            .where(AgentMessage.role == "assistant")
            .order_by(AgentMessage.id.desc())
        )
        assert last.meta["provider"] == "copilot"
    # The same conversation is reused for the next turn of this chat.
    r = await client.post(
        f"/api/agents/{s['twin'].id}/chat",
        json={"message": "Rewrite that more formally", "session_id": body["session_id"]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert fake.created == 1 and len(fake.chats) == 2
    assert "conversation so far" in json.dumps(fake.chats[1]["additionalContext"])
    # The owner's usage report counts it as handled by Copilot, with the tokens saved.
    usage = (await client.get("/api/ai/people-usage?period=today")).json()
    assert usage["totals"]["copilot_calls"] == 2 and usage["totals"]["saved_tokens"] > 100
    assert usage["totals"]["tokens"] == 0  # nothing of our engine was used
    me = next(p for p in usage["people"] if p["user_id"] == s["uid"])
    assert me["copilot_calls"] == 2 and me["saved_tokens"] == usage["totals"]["saved_tokens"]
    status = (await client.get("/api/integrations/microsoft/copilot")).json()
    assert status["state"] == "ready" and status["on"] is True and status["licensed"] is True


async def test_tool_work_goes_to_the_engine(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    llm.say("I drafted it.")
    await _chat(client, s["twin"].id, "Send an email to ali@maju.example.com about the tender")
    assert fake.chats == [] and len(llm.requests) == 1 and llm.requests[0].get("tools")


async def test_forbidden_means_no_licence_and_the_engine_answers(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    fake.chat_status = 403
    llm.say("Selamat pagi (engine).")
    body = await _chat(client, s["twin"].id, "Translate to Malay: good morning")
    assert body["reply"] == "Selamat pagi (engine)." and len(fake.chats) == 1
    [row] = await _calls("copilot")
    assert row.status == "error" and row.error_class == "forbidden" and row.saved_tokens == 0
    status = (await client.get("/api/integrations/microsoft/copilot")).json()
    assert status["state"] == "no_licence"
    llm.say("Again the engine.")
    await _chat(client, s["twin"].id, "Explain what a quorum is")
    assert len(fake.chats) == 1  # not asked again while it has no licence


async def test_throttled_rests_and_the_engine_answers(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    fake.chat_status = 429
    llm.say("Engine answer.").say("Engine again.")
    body = await _chat(client, s["twin"].id, "Explain what a quorum is")
    assert body["reply"] == "Engine answer."
    status = (await client.get("/api/integrations/microsoft/copilot")).json()
    assert status["state"] == "throttled" and status["until"]
    await _chat(client, s["twin"].id, "Explain what a motion is")
    assert len(fake.chats) == 1  # resting: not asked during the back-off
    [row] = await _calls("copilot")
    assert row.error_class == "rate_limited"


async def test_a_personal_account_never_uses_copilot(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, s["acct"])
        a.tenant_id, a.email = CONSUMER_TENANT, "boss@outlook.com"
        await db.commit()
    llm.say("Engine.")
    await _chat(client, s["twin"].id, "Translate to Malay: good morning")
    assert fake.chats == [] and len(llm.requests) == 1
    status = (await client.get("/api/integrations/microsoft/copilot")).json()
    assert status["state"] == "no_microsoft"
    assert (await client.get("/api/integrations/microsoft/account")).json()["copilot_ok"] is False
    r = await client.post(
        "/api/integrations/microsoft/connect",
        json={"with_copilot": True},
        headers={**csrf(client), **PUBLIC},
    )
    assert r.status_code == 409  # a personal account is never asked for Copilot


async def test_an_agent_for_the_company_never_uses_copilot(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    team = await make_agent(s, s["ws"], None, name="Finance Desk")  # no person: a shared AI
    llm.say("Engine.")
    await _chat(client, team.id, "Translate to Malay: good morning")
    assert fake.chats == [] and len(llm.requests) == 1


async def test_no_scope_until_copilot_is_allowed(client, llm, temporal, ms):
    s = await _setup(client, ms, scopes=GRANTED)
    fake = FakeCopilot(ms)
    llm.say("Engine.")
    await _chat(client, s["twin"].id, "Translate to Malay: good morning")
    assert fake.chats == []
    assert (await client.get("/api/integrations/microsoft/copilot")).json()["state"] == "no_scope"


# ---------------------------------------------------------------- consent


def _scope_of(url: str) -> set[str]:
    return set(parse_qs(urlparse(url).query)["scope"][0].split())


async def test_copilot_scopes_only_through_allow_copilot(client, llm, temporal, ms):
    await office(client)
    await configure(client, tenant=TENANT)
    plain = await client.post(
        "/api/integrations/microsoft/connect", json={}, headers={**csrf(client), **PUBLIC}
    )
    assert not {"People.Read.All", "ExternalItem.Read.All", "OnlineMeetingTranscript.Read.All"} & (
        _scope_of(plain.json()["url"])
    )
    asked = await client.post(
        "/api/integrations/microsoft/connect",
        json={"with_copilot": True},
        headers={**csrf(client), **PUBLIC},
    )
    assert asked.status_code == 200, asked.text
    assert set(app.COPILOT_SCOPES) <= _scope_of(asked.json()["url"])
    # Microsoft refused it (no admin consent): the person is told what the admin must grant.
    state = parse_qs(urlparse(asked.json()["url"]).query)["state"][0]
    back = await client.get(
        "/api/integrations/microsoft/callback",
        params={"state": state, "error": "consent_required", "error_description": "AADSTS65001"},
    )
    assert back.status_code == 303 and "People.Read.All" in back.headers["location"].replace(
        "%2E", "."
    )
    # A refresh keeps Copilot only while every scope of it is granted.
    granted = app.with_copilot(GRANTED)
    assert set(app.COPILOT_SCOPES) <= set(
        auth.refresh_scopes(app.DELEGATED_SCOPES, granted).split()
    )
    assert "People.Read.All" not in auth.refresh_scopes(app.DELEGATED_SCOPES, GRANTED)
    assert auth.copilot_granted(granted) and not auth.copilot_granted(GRANTED)


def test_licence_detection():
    assert copilot.has_licence(COPILOT_SKUS) == (True, ["Microsoft_365_Copilot"])
    off = [{"skuPartNumber": "SPE_E3", "servicePlans": [
        {"servicePlanName": "M365_COPILOT_APPS", "provisioningStatus": "Disabled"}]}]  # fmt: skip
    assert copilot.has_licence(off) == (False, [])
    assert copilot.has_licence([]) == (False, [])


# ---------------------------------------------------------------- m365_search


async def test_m365_search_returns_passages(client, llm, temporal, ms):
    s = await _setup(client, ms)
    fake = FakeCopilot(ms)
    tool = TOOLS["m365_search"]
    async with SessionLocal() as db:
        ws = await db.get(Workspace, s["ws"])
        agent = await db.get(type(s["twin"]), s["twin"].id)
        assert await copilot.search_ready(db, agent)
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=None, person=s["uid"])
        out = await tool.handler(ctx, {"query": "How do I set up the VPN?"})
    assert [b["dataSource"] for b in fake.searches] == ["sharePoint", "oneDriveBusiness"]
    assert fake.searches[0]["queryString"] == "How do I set up the VPN?"
    assert "VPN (sharePoint)" in out and "https://maju.sharepoint.com/sharePoint/vpn.docx" in out
    assert out.index("Pick Corporate VPN.") < out.index("Sign in with 2FA")  # best passage first
    assert out.startswith("<<<")  # outside text, fenced
    # Not offered when the owner did not switch Microsoft 365 search on.
    async with SessionLocal() as db:
        ws = await db.get(Workspace, s["ws"])
        ws.settings = {**ws.settings, "copilot_first": {"on": True, "use_retrieval": False}}
        await db.commit()
        agent = await db.get(type(s["twin"]), s["twin"].id)
        assert not await copilot.search_ready(db, agent)
