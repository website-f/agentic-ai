# ruff: noqa: E501
"""P148a: the Microsoft 365 page is fast (Fitri, 28 Nov 2026: "all loads, calendar, Teams, inbox
and all - must be super fast").

Microsoft is faked with a delay per call (httpx MockTransport with an async handler), so these
tests measure what a person waits for: the first look asks Microsoft (its calls at once, the tile
never longer than COLD_WAIT), every next look is served from Valkey without asking Microsoft, a
stale answer is shown at once and read again behind, the person's own writes forget what they
changed, and one person's answers are never another's."""

import asyncio
import json
import time

import httpx
import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.core.valkey import valkey
from agentic.microsoft import http, swr
from agentic.models import MicrosoftAccount, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, configure, connect, ms  # noqa: F401
from .test_office_roles import as_role

ME = "oid-boss"
# A look served from Valkey: the whole request through the test app (sign-in, access checks),
# no Microsoft; generous for a busy test machine (the live server answers it in a few ms).
WARM = 0.3
# Microsoft's answer times here (seconds): close to what the live server measured.
DELAY = {
    "chats": 0.30,
    "chat": 0.20,
    "chat_messages": 0.20,
    "unread": 0.10,
    "calendar": 0.20,
    "mail": 0.15,
    "approvals": 1.60,  # Teams Approvals (beta) is the slow one
    "licence": 0.20,
}


class Fake:
    """Microsoft Graph with delays: counts calls, the most at once, and whose token asked."""

    def __init__(self, ms_fake) -> None:
        self.ms = ms_fake
        self.calls: list[tuple[str, str, str]] = []  # (method, path, token)
        self.now = 0
        self.most = 0
        self.chat_title = "Tender"
        self.subject = "Roster"

    def of(self, what: str) -> int:
        return sum(1 for _m, p, _t in self.calls if _kind(p) == what)

    async def handler(self, r: httpx.Request) -> httpx.Response:
        if r.url.host != "graph.microsoft.com":
            return self.ms.handler(r)
        p = r.url.path
        token = r.headers.get("authorization", "").removeprefix("Bearer ")
        self.calls.append((r.method, p, token))
        kind = _kind(p)
        self.now += 1
        self.most = max(self.most, self.now)
        try:
            await asyncio.sleep(DELAY.get(kind, 0.0) if r.method == "GET" else 0.05)
        finally:
            self.now -= 1
        who = "B" if token == "tok-B" else "A"
        if kind == "chats":
            return httpx.Response(200, json={"value": [
                {"id": f"19:{who}", "topic": f"{self.chat_title} {who}", "chatType": "group",
                 "members": [{"userId": ME, "displayName": "Boss One"}],
                 "lastMessagePreview": {"createdDateTime": "2026-11-28T03:00:00Z", "from": {"user": {"id": "u-siti"}},
                                        "body": {"content": "hello"}},
                 "viewpoint": {"lastMessageReadDateTime": "2026-11-28T01:00:00Z"}},
            ]})  # fmt: skip
        if p.startswith("/v1.0/chats/") and r.method == "POST":  # a message sent
            return httpx.Response(201, json={"id": "9", "messageType": "message", "createdDateTime": "2026-11-28T04:00:00Z",
                                             "from": {"user": {"id": ME, "displayName": "Boss One"}},
                                             "body": {"contentType": "html", "content": "<p>ok</p>"}})  # fmt: skip
        if kind == "chat_messages":
            return httpx.Response(200, json={"value": [
                {"id": "1", "messageType": "message", "createdDateTime": "2026-11-28T03:00:00Z",
                 "from": {"user": {"id": "u-siti", "displayName": "Siti"}},
                 "body": {"contentType": "html", "content": f"<p>{who} {self.subject}</p>"}},
            ]})  # fmt: skip
        if kind == "chat":
            return httpx.Response(200, json={"id": "19:c", "chatType": "oneOnOne",
                                             "members": [{"userId": ME, "displayName": "Boss One"}, {"userId": "u-siti", "displayName": "Siti"}]})  # fmt: skip
        if kind == "unread":
            return httpx.Response(200, json={"unreadItemCount": 7 if who == "A" else 2})
        if kind == "calendar":
            return httpx.Response(200, json={"value": [
                {"id": f"e-{who}", "subject": f"{self.subject} {who}",
                 "start": {"dateTime": "2099-01-01T01:00:00.0000000"}, "end": {"dateTime": "2099-01-01T02:00:00.0000000"}},
            ]})  # fmt: skip
        if kind == "events" and r.method == "POST":
            return httpx.Response(201, json={"id": "ev-new", "webLink": "https://outlook/ev"})
        if kind == "mail":
            return httpx.Response(200, json={"value": [
                {"id": f"m-{who}", "subject": f"{self.subject} {who}", "isRead": False,
                 "from": {"emailAddress": {"name": "Siti", "address": "siti@client.example.com"}},
                 "receivedDateTime": "2026-11-28T02:00:00Z"},
            ]})  # fmt: skip
        if kind == "read":
            return httpx.Response(200, json={"id": "m-A", "isRead": True})
        if kind == "approvals":
            return httpx.Response(200, json={"value": [
                {"id": "ap1", "displayName": "Buy chairs", "state": "pending", "viewPoint": {"roles": ["approver"]},
                 "createdDateTime": "2026-11-27T01:00:00Z"},
            ]})  # fmt: skip
        if kind == "licence":
            return httpx.Response(200, json={"value": []})
        return self.ms.handler(r)


def _kind(p: str) -> str:
    if p == "/v1.0/me/chats":
        return "chats"
    if p.startswith("/v1.0/me/chats/") and p.endswith("/messages"):
        return "chat_messages"
    if p.startswith("/v1.0/me/chats/"):
        return "chat"
    if p == "/v1.0/me/mailFolders/inbox":
        return "unread"
    if p == "/v1.0/me/calendarView":
        return "calendar"
    if p == "/v1.0/me/events":
        return "events"
    if p.startswith("/v1.0/me/mailFolders/") and p.endswith("/messages"):
        return "mail"
    if p.startswith("/v1.0/me/messages/"):
        return "read"
    if p == "/beta/solutions/approval/approvalItems":
        return "approvals"
    if p == "/v1.0/me/licenseDetails":
        return "licence"
    return p


@pytest.fixture
async def graph(ms):
    fake = Fake(ms)
    yield fake
    await swr.settle()  # nothing refreshing behind outlives the test


async def _ready(client, ms, graph) -> MicrosoftAccount:
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "owner@example.com"))
        a = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == u.id))
        a.scopes = f"{a.scopes} https://graph.microsoft.com/Chat.Read https://graph.microsoft.com/ApprovalSolution.ReadWrite"
        await db.commit()
    await valkey().set(f"mstok:{a.id}", "tok-A", ex=3000)
    http.transport = httpx.MockTransport(graph.handler)
    return a


async def _timed(coro) -> tuple[float, httpx.Response]:
    t = time.perf_counter()
    r = await coro
    return time.perf_counter() - t, r


async def test_tile_cold_is_capped_warm_is_instant_and_fills_the_teams_tab(
    client, llm, temporal, ms, graph
):
    await _ready(client, ms, graph)
    # Cold: the four numbers asked at once; the slow approvals do not hold the tile up.
    cold, r = await _timed(client.get("/api/m365/summary"))
    got = r.json()
    assert r.status_code == 200 and got["connected"]
    assert (
        got["unread_mail"] == 7
        and got["unread_chats"] == 1
        and got["next_meeting"]["subject"] == "Roster A"
    )
    assert got["approvals_pending"] is None and got["refreshing"] is True  # still on its way
    assert cold < 1.5, cold  # before P148a: every number waited for the slowest (approvals)
    assert graph.most >= 3  # unread, calendar, chats and approvals were asked at once

    await swr.settle()  # the approvals arrive and are kept
    graph.calls.clear()
    warm, r = await _timed(client.get("/api/m365/summary"))
    got = r.json()
    assert got["approvals_pending"] == 1 and got["refreshing"] is False
    assert not graph.calls and warm < WARM, warm  # Valkey only

    # The chat list read for the tile is the Teams tab's: it opens without asking Microsoft.
    tab, r = await _timed(client.get("/api/m365/teams/chats"))
    assert r.json()[0]["title"] == "Tender A" and not graph.calls and tab < WARM
    print(
        f"\nP148a summary: cold {cold:.2f}s (slowest call {DELAY['approvals']}s), warm {warm * 1000:.0f}ms; chats tab {tab * 1000:.0f}ms"
    )


async def test_second_look_is_cached_and_a_stale_one_refreshes_behind(
    client, llm, temporal, ms, graph, monkeypatch
):
    from agentic.api.routers import m365

    await _ready(client, ms, graph)
    start, end = "2026-11-23T00:00:00Z", "2026-11-30T00:00:00Z"
    paths = (
        "/api/m365/teams/chats",
        f"/api/m365/calendar?start={start}&end={end}",
        "/api/m365/mail?folder=inbox&top=30",
        "/api/m365/teams/chats/19:c/messages",
    )
    firsts = {}
    for p in paths:
        firsts[p], r = await _timed(client.get(p))
        assert r.status_code == 200, (p, r.text)
    n = len(graph.calls)
    for p in paths:  # the second look: no Microsoft at all
        t, r = await _timed(client.get(p))
        assert r.status_code == 200 and t < WARM, (p, t)
    assert len(graph.calls) == n
    # The chat's messages and its people were asked at once, not one after the other.
    assert firsts[paths[3]] < DELAY["chat"] + DELAY["chat_messages"], firsts[paths[3]]

    # Stale: shown at once, read again behind, the new answer shown next time.
    monkeypatch.setattr(m365, "CHATS_FRESH", 0)
    graph.chat_title = "Payroll"
    before = graph.of("chats")
    t, r = await _timed(client.get("/api/m365/teams/chats"))
    assert r.json()[0]["title"] == "Tender A" and t < WARM  # the kept list, at once
    await swr.settle()
    assert graph.of("chats") == before + 1  # read again behind
    # Many stale looks at once: still one refresh behind (one per key, across workers too).
    graph.chat_title = "Payroll"
    looks = await asyncio.gather(*(client.get("/api/m365/teams/chats") for _ in range(5)))
    assert all(x.status_code == 200 for x in looks)
    await swr.settle()
    assert graph.of("chats") == before + 2
    monkeypatch.setattr(m365, "CHATS_FRESH", 30)
    assert (await client.get("/api/m365/teams/chats")).json()[0]["title"] == "Payroll A"

    # A stale mail page says so, and the page asks again shortly.
    monkeypatch.setattr(m365, "MAIL_FRESH", 0)
    r = await client.get("/api/m365/mail?folder=inbox&top=30")
    assert r.json()["refreshing"] is True
    print(
        "\nP148a first/second look (s): "
        + ", ".join(f"{p.split('?')[0].rsplit('/', 1)[-1]} {firsts[p]:.2f}/warm" for p in paths)
    )


async def test_own_writes_forget_what_they_changed(client, llm, temporal, ms, graph):
    await _ready(client, ms, graph)
    start, end = "2026-11-23T00:00:00Z", "2026-11-30T00:00:00Z"
    cal = f"/api/m365/calendar?start={start}&end={end}"
    for p in (
        cal,
        "/api/m365/mail?folder=inbox&top=30",
        "/api/m365/teams/chats/19:c/messages",
        "/api/m365/summary",
    ):
        assert (await client.get(p)).status_code == 200
    await swr.settle()
    graph.subject = "Changed"

    # A new event: the calendar is read again.
    r = await client.post(
        "/api/m365/calendar",
        json={
            "subject": "Site visit",
            "start": "2026-11-25T01:00:00Z",
            "end": "2026-11-25T02:00:00Z",
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert (await client.get(cal)).json()[0]["subject"] == "Changed A"

    # Mark read: the mail list is read again; the tab counts show at once and refresh behind.
    r = await client.post("/api/m365/mail/m-A/read", json={"read": True}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert (await client.get("/api/m365/mail?folder=inbox&top=30")).json()["items"][0][
        "subject"
    ] == "Changed A"
    t, r = await _timed(client.get("/api/m365/summary"))
    assert r.json()["refreshing"] is True and t < WARM

    # A Teams message sent: that chat is read again.
    r = await client.post(
        "/api/m365/teams/chats/19:c/messages", json={"text": "ok"}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    page = (await client.get("/api/m365/teams/chats/19:c/messages")).json()
    assert page["messages"][0]["text"].startswith("A Changed")

    # Refresh: everything of the person is read again from Microsoft.
    n = graph.of("chat_messages")
    assert (
        await client.post("/api/m365/refresh", json={}, headers=csrf(client))
    ).status_code == 204
    await client.get("/api/m365/teams/chats/19:c/messages")
    assert graph.of("chat_messages") == n + 1

    # New mail arriving (the webhook's delta round) forgets the kept inbox too.
    from agentic.microsoft import sync

    await client.get("/api/m365/mail?folder=inbox&top=30")  # read again after Refresh
    n = graph.of("mail")
    await client.get("/api/m365/mail?folder=inbox&top=30")
    assert graph.of("mail") == n  # kept
    async with SessionLocal() as db:
        a = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.is_primary.is_(True)))
    await sync._mail_arrived(a)
    await client.get("/api/m365/mail?folder=inbox&top=30")
    assert graph.of("mail") == n + 1


async def test_no_answer_is_ever_another_persons(client, llm, temporal, ms, graph):
    a = await _ready(client, ms, graph)
    paths = ("/api/m365/teams/chats", "/api/m365/mail?folder=inbox&top=30", "/api/m365/summary")
    mine = {p: (await client.get(p)).json() for p in paths}
    await swr.settle()

    # Someone without their own connection is refused BEFORE anything kept is looked at.
    admin = await as_role(client, "admin.p148@example.com", "admin")
    for p in paths[:2]:
        r = await admin.get(p)
        assert r.status_code == 409 and r.json()["code"] == "microsoft_not_connected", p
    assert (await admin.get("/api/m365/summary")).json()["connected"] is False

    # They connect their own: they get their own answers, never the owner's kept ones.
    await connect(admin)
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "admin.p148@example.com"))
        b = await db.scalar(select(MicrosoftAccount).where(MicrosoftAccount.user_id == u.id))
        b.scopes = f"{b.scopes} https://graph.microsoft.com/Chat.Read"
        await db.commit()
    assert b.id != a.id
    await valkey().set(f"mstok:{b.id}", "tok-B", ex=3000)
    theirs = {p: (await admin.get(p)).json() for p in paths}
    assert theirs[paths[0]][0]["title"] == "Tender B" and mine[paths[0]][0]["title"] == "Tender A"
    assert theirs[paths[1]]["items"][0]["id"] == "m-B"
    assert theirs[paths[2]]["unread_mail"] == 2 and mine[paths[2]]["unread_mail"] == 7
    await swr.settle()
    assert all(t == "tok-B" for _m, _p, t in graph.calls[-3:])
    # The owner still gets their own.
    assert (await client.get("/api/m365/teams/chats")).json()[0]["title"] == "Tender A"
    # Every kept key is the person's own (workspace, user, account).
    keys = [k async for k in valkey().scan_iter("m365:c:*")]
    assert keys and all(a.id in k or b.id in k or ":-:" in k for k in keys)
    assert not [k for k in keys if a.id in k and u.id in k]
    await admin.aclose()


async def test_my_mailboxes_account_and_copilot_are_kept(client, llm, temporal, ms, graph):
    await _ready(client, ms, graph)
    first = (await client.get("/api/integrations/microsoft/my-mailboxes")).json()
    acct = first["accounts"][0]
    t, r = await _timed(client.get("/api/integrations/microsoft/my-mailboxes"))
    assert r.json() == first and t < WARM
    # Naming the account forgets it: the new name shows at once.
    r = await client.patch(
        f"/api/integrations/microsoft/accounts/{acct['id']}",
        json={"label": "Office"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    again = (await client.get("/api/integrations/microsoft/my-mailboxes")).json()
    assert again["accounts"][0]["label"] == "Office"

    one = (await client.get("/api/integrations/microsoft/account")).json()
    assert one["connected"] is True and isinstance(one["last_sync_at"], str | None)
    assert (await client.get("/api/integrations/microsoft/account")).json() == json.loads(
        json.dumps(one)
    )

    # Copilot: the state is kept a minute (no licence call on the second look).
    await client.get("/api/integrations/microsoft/copilot")
    n = graph.of("licence")
    await client.get("/api/integrations/microsoft/copilot")
    assert graph.of("licence") == n
    # Disconnecting forgets everything of the person.
    assert (
        await client.delete(
            "/api/integrations/microsoft/account",
            headers={**csrf(client), "content-type": "application/json"},
        )
    ).status_code == 204
    assert (await client.get("/api/integrations/microsoft/account")).json()["connected"] is False
