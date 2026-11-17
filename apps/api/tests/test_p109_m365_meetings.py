# ruff: noqa: E501
"""P109b: the Microsoft 365 tile on My workspace, and a Teams meeting made with AI.

The AI only fills the form (title, people matched to addresses, when in Kuala Lumpur time, how
long, agenda, kind); nothing reaches Microsoft until the person presses Create. Create makes a
Teams meeting in their own Outlook (Outlook sends the invitations) and records it in Prima's
Meetings as them (Prima's own rules decide; a refusal is kept with "Add to Prima" to retry). A
change or cancel made here reaches Prima's record through Prima's own routes.

Microsoft, Prima and the AI are faked (httpx MockTransport); nothing real is called."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from agentic.api.deps import Principal
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.microsoft import http, meetings
from agentic.models import AuditLog, Membership, TeamsMeeting, User
from agentic.prima import client as prima

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, configure, connect, ms  # noqa: F401
from .test_office_roles import as_role

ME = "oid-boss"
JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0"
SECRET = "p" * 40
SOON = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0)
MAIL = {
    "id": "m1",
    "subject": "D WAY roster",
    "from": {"emailAddress": {"name": "Siti Aminah", "address": "Siti@Client.example.com"}},
    "toRecipients": [{"emailAddress": {"name": "Boss One", "address": "boss@maju.example.com"}}],
    "ccRecipients": [
        {"emailAddress": {"name": "Nabilah Omar", "address": "nabilah@maju.example.com"}}
    ],
    "receivedDateTime": "2026-11-16T02:00:00Z",
    "body": {"contentType": "text", "content": "Can we fix the D WAY roster for December?"},
}


def fake_graph(ms_fake, seen: list) -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.host != "graph.microsoft.com":
            return ms_fake.handler(r)
        p = r.url.path.removeprefix("/v1.0/")
        body = json.loads(r.content) if r.content else None
        seen.append((r.method, p, body))
        if p == "me/mailFolders/inbox" and "unreadItemCount" in str(r.url):
            return httpx.Response(200, json={"unreadItemCount": 7})
        if p == "me/calendarView":
            start = SOON.strftime("%Y-%m-%dT%H:%M:%S.0000000")
            end = (SOON + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.0000000")
            return httpx.Response(200, json={"value": [
                {"id": "gone", "subject": "Old", "isCancelled": True, "start": {"dateTime": start}, "end": {"dateTime": end}},
                {"id": "e1", "subject": "Roster check", "start": {"dateTime": start}, "end": {"dateTime": end},
                 "onlineMeeting": {"joinUrl": JOIN}},
            ]})  # fmt: skip
        if p == "me/chats":
            return httpx.Response(200, json={"value": [
                {"id": "c1", "lastMessagePreview": {"createdDateTime": "2026-11-17T03:00:00Z", "from": {"user": {"id": "u-siti"}}},
                 "viewpoint": {"lastMessageReadDateTime": "2026-11-17T01:00:00Z"}},
                {"id": "c2", "lastMessagePreview": {"createdDateTime": "2026-11-17T03:00:00Z", "from": {"user": {"id": ME}}},
                 "viewpoint": {"lastMessageReadDateTime": "2026-11-17T01:00:00Z"}},
                {"id": "c3", "lastMessagePreview": {"createdDateTime": "2026-11-17T03:00:00Z", "from": {"user": {"id": "u-x"}}},
                 "viewpoint": {"lastMessageReadDateTime": "2026-11-17T04:00:00Z"}},
            ]})  # fmt: skip
        if p == "me/messages" and r.method == "GET":  # people in the person's own mail
            return httpx.Response(200, json={"value": [MAIL]})
        if p == "me/messages/m1":
            return httpx.Response(200, json=MAIL)
        if p == "me/chats/19:c/messages":
            return httpx.Response(200, json={"value": [
                {"id": "1", "messageType": "message", "createdDateTime": "2026-11-17T02:00:00Z",
                 "from": {"user": {"id": "u-siti", "displayName": "Siti Aminah"}},
                 "body": {"contentType": "html", "content": "<p>Can we meet on the tender price?</p>"}},
            ]})  # fmt: skip
        if p == "me/chats/19:c":
            return httpx.Response(200, json={"id": "19:c", "members": [
                {"userId": ME, "displayName": "Boss One", "email": "boss@maju.example.com"},
                {"userId": "u-siti", "displayName": "Siti Aminah", "email": "Siti.A@maju.example.com"},
            ]})  # fmt: skip
        if p == "me/events" and r.method == "POST":
            return httpx.Response(
                201,
                json={
                    "id": "ev1",
                    "webLink": "https://outlook/ev1",
                    "onlineMeeting": {"joinUrl": JOIN},
                },
            )
        if p == "me/events/ev1" and r.method == "PATCH":
            return httpx.Response(200, json={"id": "ev1"})
        if p == "me/events/ev1/cancel":
            return httpx.Response(202)
        return ms_fake.handler(r)

    http.transport = httpx.MockTransport(handler)


@pytest.fixture
def prima_fake(monkeypatch):
    """Prima: the CEO record (the owner opens Prima as it), its meetings routes."""
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    state: dict = {"refuse": None, "seen": []}

    def handler(req: httpx.Request) -> httpx.Response:
        url = req.url.raw_path.decode()
        body = json.loads(req.content) if req.content else None
        state["seen"].append((req.method, url, req.headers.get("x-office-user"), body))
        if url == "/api/office/staff":
            return httpx.Response(200, json=[{"id": "u-ceo", "name": "Chief", "title": "CEO", "role": "director", "top": "ceo", "canSignIn": True}])  # fmt: skip
        if url == "/api/me":
            return httpx.Response(200, json={"user": {"id": "u-ceo", "role": "director", "companyIds": []}})  # fmt: skip
        if url == "/api/meetings" and req.method == "POST":
            if state["refuse"]:
                return httpx.Response(403, json={"message": state["refuse"], "statusCode": 403})
            return httpx.Response(201, json={"id": "mt-k1-1", "title": body["title"]})
        if url in ("/api/meetings/mt-k1-1/change", "/api/meetings/mt-k1-1/cancel"):
            return httpx.Response(200, json={"id": "mt-k1-1"})
        return httpx.Response(404, json={"message": "not here"})

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    monkeypatch.setattr(prima, "_TOP", {})
    return state


WHERE: dict = {}


async def _office(client, ms) -> list:
    o = await office(client)
    WHERE.clear()
    WHERE["branch_id"] = o["branch"]["id"]
    await configure(client, tenant=TENANT)
    await connect(client)
    r = await client.post(
        "/api/members",
        json={"email": "faiz@maju.example.com", "name": "Faiz Rahman", "role": "staff", **WHERE},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    seen: list = []
    fake_graph(ms, seen)
    return seen


async def test_tile_says_what_waits(client, llm, temporal, ms, prima_fake):
    await office(client)
    r = await client.get("/api/m365/summary")
    assert r.status_code == 200 and r.json()["configured"] is False
    await configure(client, tenant=TENANT)
    got = (await client.get("/api/m365/summary")).json()
    assert got["configured"] and not got["connected"]  # the tile offers Connect
    await connect(client)
    seen: list = []
    fake_graph(ms, seen)
    got = (await client.get("/api/m365/summary?fresh=true")).json()
    assert got["connected"] and got["unread_mail"] == 7 and got["unread_chats"] == 1
    assert (
        got["next_meeting"]["subject"] == "Roster check" and got["next_meeting"]["join_url"] == JOIN
    )
    assert got["approvals_pending"] is None  # not allowed yet: no number rather than a wrong one
    assert got["prima"] is True
    # Kept a minute: a second look does not ask Microsoft again.
    seen.clear()
    assert (await client.get("/api/m365/summary")).json()["unread_mail"] == 7
    assert not seen


async def test_ai_fills_the_form_and_nothing_is_sent(client, llm, temporal, ms, prima_fake):
    seen = await _office(client, ms)
    llm.say(
        '{"title": "D WAY roster", "date": "2026-11-18", "time": "15:00", "minutes": 45, '
        '"attendees": [{"name": "Faiz"}, {"name": "Nabilah"}, {"name": "Nobody Known"}, '
        '{"email": "Ali@Maju.example.com"}, {"email": "made-up"}], '
        '"agenda": "December roster\\nStandby guards", "kind": "operations"}'
    )
    r = await client.post(
        "/api/m365/meetings/draft",
        json={
            "instructions": "Meeting with Faiz and Nabilah tomorrow 3pm about the D WAY roster, 45 min, send agenda",
            "message_id": "m1",
        },
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert (
        d["start"] == "2026-11-18T07:00:00Z" and d["end"] == "2026-11-18T07:45:00Z"
    )  # 15:00 in KL
    assert (
        d["minutes"] == 45 and d["kind"] == "operations" and d["time_zone"] == "Asia/Kuala_Lumpur"
    )
    people = {p["name"]: p for p in d["attendees"]}
    assert people["Faiz Rahman"]["email"] == "faiz@maju.example.com"  # an office member
    assert people["Nabilah Omar"]["email"] == "nabilah@maju.example.com"  # in the email
    assert people["Nobody Known"]["status"] == "unknown" and people["Nobody Known"]["email"] == ""
    assert people["ali@maju.example.com"]["status"] == "ok"
    assert "made-up" not in json.dumps(d)
    prompt = llm.requests[-1]["messages"][-1]["content"]
    assert (
        "Asia/Kuala_Lumpur" in prompt and "<<<" in prompt and "D WAY roster for December" in prompt
    )
    assert not [p for m, p, _ in seen if m in ("POST", "PATCH")]  # nothing made or sent
    assert not [s for s in prima_fake["seen"] if s[0] == "POST"]

    # The people picker: office members this person may see, then their Outlook.
    found = (await client.get("/api/m365/people", params={"q": "faiz"})).json()
    assert found[0] == {"name": "Faiz Rahman", "email": "faiz@maju.example.com", "source": "office"}


async def test_create_sends_invitations_and_records_in_prima(client, llm, temporal, ms, prima_fake):
    seen = await _office(client, ms)
    body = {
        "title": "D WAY roster",
        "start": "2026-11-18T07:00:00Z",
        "end": "2026-11-18T07:45:00Z",
        "attendees": [
            {"name": "Faiz Rahman", "email": "faiz@maju.example.com"},
            {"name": "Nabilah Omar", "email": "Nabilah@maju.example.com"},
            {"name": "Me", "email": "boss@maju.example.com"},  # the organiser is not invited
        ],
        "agenda": "December roster\nStandby guards",
        "kind": "operations",
    }
    r = await client.post("/api/m365/meetings", json=body, headers=csrf(client))
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["join_url"] == JOIN and out["event_id"] == "ev1"
    assert out["prima"] == {"status": "added", "meeting_id": "mt-k1-1", "reason": None}
    ev = next(b for m, p, b in seen if m == "POST" and p == "me/events")
    assert ev["isOnlineMeeting"] is True and ev["onlineMeetingProvider"] == "teamsForBusiness"
    assert [a["emailAddress"] for a in ev["attendees"]] == [
        {"address": "faiz@maju.example.com", "name": "Faiz Rahman"},
        {"address": "nabilah@maju.example.com", "name": "Nabilah Omar"},
    ]
    assert "December roster<br>Standby guards" in ev["body"]["content"]
    made = next(s for s in prima_fake["seen"] if s[0] == "POST" and s[1] == "/api/meetings")
    assert made[2] == "u-ceo"  # as the person (the owner opens Prima as its top record)
    pb = made[3]
    assert pb["title"] == "D WAY roster" and pb["kind"] == "operations" and pb["companyId"] is None
    assert pb["start"] == "2026-11-18T07:00:00.000Z" and pb["end"] == "2026-11-18T07:45:00.000Z"
    assert pb["attendees"] == ["Faiz Rahman", "Nabilah Omar"] and pb["repeat"] is None
    assert pb["agenda"].splitlines() == [
        "December roster",
        "Standby guards",
        f"Microsoft Teams: {JOIN}",
    ]
    link = (await client.get("/api/m365/meetings/link", params={"event_id": "ev1"})).json()
    assert link["linked"] and link["prima"]["status"] == "added"

    # A change made here: Outlook updates the people invited; Prima's record changes too.
    r = await client.post(
        "/api/m365/meetings/change",
        json={"event_id": "ev1", "start": "2026-11-18T08:00:00Z", "end": "2026-11-18T08:45:00Z"},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["prima_warning"] is None
    patch = next(b for m, p, b in seen if m == "PATCH" and p == "me/events/ev1")
    assert patch["start"]["dateTime"].startswith("2026-11-18T08:00:00")
    ch = next(s for s in prima_fake["seen"] if s[1] == "/api/meetings/mt-k1-1/change")
    assert ch[3]["start"] == "2026-11-18T08:00:00.000Z" and len(ch[3]["reason"]) >= 5
    r = await client.post(
        "/api/m365/meetings/change", json={"event_id": "ev1"}, headers=csrf(client)
    )
    assert r.status_code == 400  # nothing changed

    # Cancel: Outlook tells the people; Prima's record is cancelled with the reason.
    r = await client.post(
        "/api/m365/meetings/cancel",
        json={"event_id": "ev1", "reason": "Roster already agreed"},
        headers=csrf(client),
    )
    assert (
        r.status_code == 200
        and r.json()["cancelled"]
        and r.json()["prima"]["status"] == "cancelled"
    )
    assert ("POST", "me/events/ev1/cancel", {"comment": "Roster already agreed"}) in seen
    cancel = next(s for s in prima_fake["seen"] if s[1] == "/api/meetings/mt-k1-1/cancel")
    assert cancel[3] == {"reason": "Roster already agreed"}

    async with SessionLocal() as db:
        actions = set((await db.scalars(select(AuditLog.action))).all())
    assert {"m365.meeting_created", "m365.meeting_changed", "m365.meeting_cancelled"} <= actions


async def test_prima_refusal_is_kept_and_add_to_prima_retries(
    client, llm, temporal, ms, prima_fake, monkeypatch
):
    await _office(client, ms)
    prima_fake["refuse"] = "You may not view (meeting)"
    body = {
        "title": "Sync",
        "start": "2026-11-18T07:00:00Z",
        "end": "2026-11-18T07:30:00Z",
        "attendees": [],
    }
    out = (await client.post("/api/m365/meetings", json=body, headers=csrf(client))).json()
    assert out["join_url"] == JOIN  # the Teams meeting is made either way
    assert (
        out["prima"]["status"] == "failed"
        and out["prima"]["reason"] == "You may not view (meeting)"
    )
    made = next(s for s in prima_fake["seen"] if s[1] == "/api/meetings")
    assert made[3]["agenda"].splitlines()[0] == "Sync"  # Prima needs one agenda item

    prima_fake["refuse"] = None
    r = await client.post(
        "/api/m365/meetings/prima",
        json={"event_id": "ev1", "kind": "department"},
        headers=csrf(client),
    )
    assert (
        r.status_code == 200
        and r.json()["prima"]["status"] == "added"
        and r.json()["kind"] == "department"
    )

    # Not asked to add it: nothing goes to Prima; Prima not set up here: said so.
    prima_fake["seen"].clear()
    async with SessionLocal() as db:
        await db.execute(TeamsMeeting.__table__.delete())
        await db.commit()
    out = (
        await client.post("/api/m365/meetings", json={**body, "prima": False}, headers=csrf(client))
    ).json()
    assert out["prima"]["status"] == "none" and not prima_fake["seen"]
    async with SessionLocal() as db:
        await db.execute(TeamsMeeting.__table__.delete())
        await db.commit()
    monkeypatch.setattr(settings, "prima_url", "")
    out = (await client.post("/api/m365/meetings", json=body, headers=csrf(client))).json()
    assert out["prima"]["status"] == "skipped" and "not set up" in out["prima"]["reason"]


async def test_only_the_person_reaches_their_meetings(client, llm, temporal, ms, prima_fake):
    await _office(client, ms)
    body = {"title": "Sync", "start": "2026-11-18T07:00:00Z", "end": "2026-11-18T07:30:00Z"}
    assert (
        await client.post("/api/m365/meetings", json=body, headers=csrf(client))
    ).status_code == 201
    bad = {**body, "end": "2026-11-18T06:00:00Z"}
    assert (
        await client.post("/api/m365/meetings", json=bad, headers=csrf(client))
    ).status_code == 400

    admin = await as_role(client, "admin.p109b@example.com", "admin")
    assert (await admin.get("/api/m365/meetings/link", params={"event_id": "ev1"})).json() == {
        "linked": False
    }
    r = await admin.post("/api/m365/meetings/cancel", json={"event_id": "ev1"}, headers=csrf(admin))
    assert r.status_code == 404
    r = await admin.post("/api/m365/meetings", json=body, headers=csrf(admin))
    assert r.status_code == 409 and r.json()["code"] == "microsoft_not_connected"
    r = await admin.post(
        "/api/m365/meetings/draft", json={"instructions": "meet ali"}, headers=csrf(admin)
    )
    assert r.status_code == 409
    got = (await admin.get("/api/m365/summary")).json()
    assert got["configured"] and not got["connected"] and got["unread_mail"] is None
    await admin.aclose()


async def test_staff_see_only_themselves_in_office_people(client, llm, temporal, ms, prima_fake):
    await _office(client, ms)
    staff = await as_role(client, "staff.p109b@example.com", "staff", **WHERE)
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == "staff.p109b@example.com"))
        ws = await db.scalar(select(Membership.workspace_id).where(Membership.user_id == user.id))
        principal = Principal(user=user, workspace_id=ws, role="staff", session_id="s")
        got = await meetings.office_people(db, principal, "")
    assert [p["email"] for p in got] == ["staff.p109b@example.com"]  # never wider than tasks
    r = await staff.get("/api/m365/people", params={"q": "faiz"})
    assert r.status_code == 409  # no Microsoft connection of their own
    await staff.aclose()


def test_parse_draft_defaults_and_matching():
    now = datetime(2026, 11, 20, 2, 0, tzinfo=UTC)  # a Friday, 10:00 in Kuala Lumpur
    d = meetings.parse_draft(
        {"title": "x", "minutes": "999", "kind": "party"}, "Asia/Kuala_Lumpur", now
    )
    assert d["start"] == datetime(2026, 11, 23, 2, 0, tzinfo=UTC)  # next working day 10:00
    assert d["minutes"] == 480 and d["kind"] == "management"
    assert meetings.matches("Faiz", {"name": "Mohd Faiz bin Ali", "email": "f@x.my"})
    assert not meetings.matches("Faiz", {"name": "Nabilah", "email": "n@x.my"})
    assert meetings.prima_agenda("", "Title", None) == "Title"
    long = meetings.prima_agenda("a" * 3000, "T", JOIN)
    assert len(long) <= 2000 and long.endswith(JOIN)


async def test_meeting_about_a_chat_invites_its_people(client, llm, temporal, ms, prima_fake):
    seen = await _office(client, ms)
    llm.say('{"title": "Tender price", "attendees": [{"name": "Siti"}], "agenda": "Price"}')
    r = await client.post(
        "/api/m365/meetings/draft",
        json={
            "instructions": "Set up a meeting about this chat with the people in it",
            "chat_id": "19:c",
        },
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["attendees"] == [
        {"name": "Siti Aminah", "email": "siti.a@maju.example.com", "status": "ok", "options": []}
    ]
    assert "tender price" in llm.requests[-1]["messages"][-1]["content"]
    assert not [p for m, p, _ in seen if m in ("POST", "PATCH")]
