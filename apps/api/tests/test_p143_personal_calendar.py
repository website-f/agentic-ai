"""P143a (owner, 27 Nov 2026: "Outlook personal accounts can't be found in Microsoft 365 in their
Calendar tab"): the Calendar tab shows a personal Microsoft account's calendar (Outlook.com,
Hotmail: Microsoft's consumer tenant) the same as a work one, whether it is the person's main
account (P142) or an extra one beside it (P118). Such a mailbox has no Teams: it is read without
`onlineMeeting` and a new event there never asks for a Teams meeting. Only the person's own
accounts, never a waiting one. Microsoft is faked like a personal mailbox; synthetic people only."""

import json

import httpx

from agentic.core.db import SessionLocal
from agentic.microsoft import auth, http
from agentic.microsoft.domains import CONSUMER_TENANT
from agentic.models import MicrosoftAccount

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, configure, connect, ms, my_account, user_id  # noqa: F401
from .test_office_roles import member

WEEK = {"start": "2026-11-16T00:00:00Z", "end": "2026-11-23T00:00:00Z"}


def _ev(eid: str, subject: str, day: int, **extra) -> dict:
    return {
        "id": eid,
        "subject": subject,
        "start": {"dateTime": f"2026-11-{day}T02:00:00.0000000", "timeZone": "UTC"},
        "end": {"dateTime": f"2026-11-{day}T03:00:00.0000000", "timeZone": "UTC"},
        "organizer": {"emailAddress": {"name": "Me", "address": "me@outlook.com"}},
        **extra,
    }


def _refused(what: str) -> httpx.Response:
    # What Outlook.com's mailbox answers for a question it does not take.
    return httpx.Response(
        400,
        json={"error": {"code": "RequestBroker--ParseUri",
                        "message": f"Could not find a property named '{what}' on type "
                                   "'Microsoft.OutlookServices.Event'."}},
    )  # fmt: skip


def fake_graph(ms_fake, seen: list, *, no_orderby: bool = False) -> None:
    """Graph for two mailboxes, told apart by their token: the work one (Teams, onlineMeeting)
    and a personal one that refuses `onlineMeeting` and Teams meetings (and, with `no_orderby`,
    $orderby too)."""

    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.host != "graph.microsoft.com":
            return ms_fake.handler(r)
        p = r.url.path.removeprefix("/v1.0/")
        personal = r.headers["authorization"].endswith("@outlook.com")
        body = json.loads(r.content) if r.content else None
        seen.append((personal, r.method, p, dict(r.url.params), body))
        sel = r.url.params.get("$select", "")
        if personal and "onlineMeeting" in sel.split(","):
            return _refused("onlineMeeting")
        if personal and no_orderby and "$orderby" in r.url.params:
            return _refused("start/dateTime")
        if p == "me/calendarView":
            if personal:  # out of order on purpose: the answer is put in time order
                return httpx.Response(
                    200, json={"value": [_ev("p2", "Gym", 19), _ev("p1", "Family dinner", 17)]}
                )
            join = {"joinUrl": "https://teams.microsoft.com/l/meetup-join/x"}
            return httpx.Response(
                200, json={"value": [_ev("w1", "Tender review", 18, onlineMeeting=join)]}
            )
        if p == "me/events/p1" and r.method == "GET":
            return httpx.Response(
                200,
                json=_ev("p1", "Family dinner", 17, isOrganizer=True,
                         body={"content": "<p>At home</p>"}),
            )  # fmt: skip
        if p == "me/events" and r.method == "POST":
            if personal and (body.get("isOnlineMeeting") or body.get("onlineMeetingProvider")):
                return _refused("isOnlineMeeting")
            return httpx.Response(201, json={"id": "new1", "webLink": "https://outlook/new1"})
        return ms_fake.handler(r)

    http.transport = httpx.MockTransport(handler)


def fake_tokens(monkeypatch) -> None:
    """Each mailbox's token names its address (the fake Graph tells them apart by it)."""

    async def access_token(_db, acct, force: bool = False) -> str:
        assert acct.status != "pending"  # a waiting account is never used
        return f"tok-{acct.email}"

    monkeypatch.setattr(auth, "access_token", access_token)


async def _main_becomes_personal() -> None:
    """The main account is a personal Microsoft account (P142's "Use a personal account")."""
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        a.tenant_id, a.email = CONSUMER_TENANT, "me@outlook.com"
        await db.commit()


async def _extra(email: str, *, tenant: str = CONSUMER_TENANT, user: str = "owner@example.com",
                 status: str = "connected") -> str:  # fmt: skip
    uid, ws = await user_id(user)
    async with SessionLocal() as db:
        a = MicrosoftAccount(
            workspace_id=ws, user_id=uid, ms_user_id=f"oid-{email}", tenant_id=tenant,
            email=email, status=status, is_primary=False,
        )  # fmt: skip
        db.add(a)
        await db.commit()
        return a.id


async def test_a_personal_main_account_shows_its_calendar(client, llm, temporal, ms, monkeypatch):
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    await _main_becomes_personal()
    fake_tokens(monkeypatch)
    seen: list = []
    fake_graph(ms, seen)

    r = await client.get("/api/m365/calendar", params=WEEK)
    assert r.status_code == 200, r.text
    assert [e["subject"] for e in r.json()] == ["Family dinner", "Gym"]
    assert r.json()[0]["start"] == "2026-11-17T02:00:00Z" and r.json()[0]["join_url"] is None
    # Asked straight away without onlineMeeting (no refused round first), still in time order.
    asked = [q for pers, m, p, q, _ in seen if p == "me/calendarView"]
    assert len(asked) == 1 and "onlineMeeting" not in asked[0]["$select"]
    assert asked[0]["$orderby"] == "start/dateTime"

    ev = (await client.get("/api/m365/calendar/p1")).json()
    assert ev["subject"] == "Family dinner" and "At home" in ev["body_html"]

    # A new event: never a Teams meeting in a personal account, even when asked for.
    r = await client.post(
        "/api/m365/calendar",
        json={"subject": "Dentist", "start": "2026-11-20T01:00:00Z",
              "end": "2026-11-20T02:00:00Z", "online": True},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 201, r.text
    assert r.json() == {"id": "new1", "web_link": "https://outlook/new1", "online": False}
    made = next(b for pers, m, p, _, b in seen if m == "POST" and p == "me/events")
    assert "isOnlineMeeting" not in made and "onlineMeetingProvider" not in made

    # The page knows it is a personal Microsoft account (no Teams offered for it).
    rows = (await client.get("/api/integrations/microsoft/my-mailboxes")).json()["accounts"]
    assert rows[0]["primary"] is True and rows[0]["consumer"] is True
    assert (await client.get("/api/integrations/microsoft/account")).json()["personal"] is True


async def test_a_personal_extra_account_shows_its_calendar_and_only_mine(
    client, llm, temporal, ms, monkeypatch
):
    o = await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)  # the main one: work, with Teams
    extra = await _extra("me@outlook.com")
    fake_tokens(monkeypatch)
    seen: list = []
    fake_graph(ms, seen, no_orderby=True)

    # The main (work) account: as before, with its Teams link and a Teams meeting.
    work = (await client.get("/api/m365/calendar", params=WEEK)).json()
    assert [e["subject"] for e in work] == ["Tender review"] and work[0]["join_url"]
    r = await client.post(
        "/api/m365/calendar",
        json={"subject": "Kick-off", "start": "2026-11-20T01:00:00Z",
              "end": "2026-11-20T02:00:00Z", "online": True},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 201 and r.json()["online"] is True
    made = [b for pers, m, p, _, b in seen if m == "POST" and p == "me/events"]
    assert made[-1]["onlineMeetingProvider"] == "teamsForBusiness"

    # The personal extra account picked: its own calendar. Its mailbox refuses $orderby too:
    # asked once more in the plainest form, then put in time order here.
    r = await client.get("/api/m365/calendar", params=WEEK, headers={"X-M365-Account": extra})
    assert r.status_code == 200, r.text
    assert [e["subject"] for e in r.json()] == ["Family dinner", "Gym"]
    tries = [q for pers, m, p, q, _ in seen if pers and p == "me/calendarView"]
    assert len(tries) == 2 and "$orderby" not in tries[1]
    assert all("onlineMeeting" not in q["$select"] for q in tries)
    r = await client.post(
        "/api/m365/calendar",
        json={"subject": "Dentist", "start": "2026-11-20T01:00:00Z",
              "end": "2026-11-20T02:00:00Z", "online": True},
        headers={"X-M365-Account": extra, **csrf(client)},
    )  # fmt: skip
    assert r.status_code == 201 and r.json()["online"] is False

    rows = (await client.get("/api/integrations/microsoft/my-mailboxes")).json()["accounts"]
    mine = {a["email"]: a for a in rows}
    assert (
        mine["me@outlook.com"]["consumer"] is True and mine["me@outlook.com"]["kind"] == "personal"
    )
    assert next(a for a in rows if a["primary"])["consumer"] is False

    # Never anyone else's personal account, and never a waiting one.
    await member(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    theirs = await _extra("aina@outlook.com", user="aina@example.com")
    r = await client.get("/api/m365/calendar", params=WEEK, headers={"X-M365-Account": theirs})
    assert r.status_code == 404
    waiting = await _extra("later@outlook.com", status="pending")
    r = await client.get("/api/m365/calendar", params=WEEK, headers={"X-M365-Account": waiting})
    assert r.status_code == 409 and r.json()["code"] == "waiting_approval"
