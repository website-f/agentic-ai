"""P97: the desk as each person's virtual desk.

Pin anything (a screen of the app or Prima, a web link, a report) with the server
checking what may be pinned; rename pins, keep them in folders, reorder and move them; the
desk's sections shown, hidden and reordered per person; pins that are no longer the person's
to see show as unavailable without saying what the thing is now; finding tasks, agents,
people and reports by name within what the person may open; today's meetings.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import SOP, Agent, GoogleAccount, Report, Task, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_desk import _staff_with_twin

JSON = {"content-type": "application/json"}


async def _pin(c, kind, ref, title="", **extra):
    return await c.post(
        "/api/desk/items", json={"kind": kind, "ref": ref, "title": title, **extra}, headers=csrf(c)
    )


async def test_screens_links_and_what_may_not_be_pinned(client, llm, temporal):
    o = await office(client)
    staff, _ = await _staff_with_twin(client, o)
    try:
        ok = [
            ("route", "/tasks?task=tk_1", "My board"),
            ("route", "/prima/#clock", "Clock in"),
            ("link", "https://www.eperolehan.gov.my/", "ePerolehan"),
        ]
        for kind, ref, title in ok:
            r = await _pin(staff, kind, ref, title)
            assert r.status_code == 201, r.text
            p = r.json()
            assert p["url"] == ref and p["title"] == title and not p["missing"]
        assert p["sub"] == "www.eperolehan.gov.my"
        bad = [
            ("route", "//evil.example/x"),
            ("route", "/api/desk"),
            ("route", "https://evil.example/"),
            ("route", "/tasks\\..\\x"),
            ("route", "/tasks onload=x"),
            ("link", "javascript:alert(1)"),
            ("link", "https://user:secret@evil.example/"),
            ("link", "ftp://files.example/"),
            ("link", "/tasks"),
        ]
        for kind, ref in bad:
            r = await _pin(staff, kind, ref, "x")
            assert r.status_code == 422 and r.json()["code"] == "bad_pin", (kind, ref)
        r = await _pin(staff, "route", "/x", "x", folder="F" * 61)
        assert r.status_code == 422
        # Pinning the same screen twice keeps one.
        r = await _pin(staff, "route", "/prima/#clock", "Again")
        assert r.status_code == 201 and r.json()["title"] == "Clock in"
        assert len((await staff.get("/api/desk/items")).json()) == 3
    finally:
        await staff.aclose()


async def test_reports_only_when_the_person_sees_them(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    owner = await client.get("/api/auth/me")
    owner_id = owner.json()["user"]["id"]
    async with SessionLocal() as db:
        ws = (await db.get(Agent, twin["id"])).workspace_id  # type: ignore[union-attr]
        now = datetime.now(UTC)
        mine = Report(
            workspace_id=ws,
            agent_id=twin["id"],
            title="Aging October",
            summary="RM 4,210 overdue",
            created_at=now,
        )
        private = Report(
            workspace_id=ws, owner_user_id=owner_id, title="Owner mail digest", created_at=now
        )
        db.add_all([mine, private])
        await db.commit()
        ids = {"mine": mine.id, "private": private.id}
    try:
        r = await _pin(staff, "report", ids["mine"])
        assert r.status_code == 201, r.text
        assert (
            r.json()["title"] == "Aging October" and r.json()["url"] == f"/reports?r={ids['mine']}"
        )
        assert (await _pin(staff, "report", ids["private"])).status_code == 404
        # P102: contacts went with the Customers and money module.
        assert (await _pin(staff, "contact", "pt_any")).status_code == 422
        # The client's title is not trusted for things with an id: the real name is kept.
        r = await _pin(staff, "task", "tk_nope", "Anything")
        assert r.status_code == 404
    finally:
        await staff.aclose()


async def test_rename_folders_order_and_unavailable_pins(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    other, _ = await _staff_with_twin(client, o, "amir@example.com")
    async with SessionLocal() as db:
        ws = (await db.get(Agent, twin["id"])).workspace_id  # type: ignore[union-attr]
        sop = SOP(
            workspace_id=ws,
            scope="department",
            scope_id=o["depts"]["Finance"],
            title="Claims checking",
            body="Check every claim.",
            updated_by="test",
        )
        db.add(sop)
        await db.commit()
        sop_id = sop.id
    try:
        a = (await _pin(staff, "sop", sop_id, "ignored")).json()
        assert a["title"] == "Claims checking" and a["label"] is None and a["folder"] is None
        b = (await _pin(staff, "route", "/forms", "Forms", folder="  Monthly   work ")).json()
        assert b["folder"] == "Monthly work"
        c = (await _pin(staff, "search", "kelayakan advance")).json()

        # Rename (the person's own name); the thing's own name stays known.
        r = await staff.patch(
            f"/api/desk/items/{a['id']}", json={"label": "Claims SOP"}, headers=csrf(staff)
        )
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Claims SOP" and r.json()["name"] == "Claims checking"
        # Moving it to a folder leaves the label alone; "" clears a label.
        r = await staff.patch(
            f"/api/desk/items/{a['id']}", json={"folder": "Monthly work"}, headers=csrf(staff)
        )
        assert r.json()["folder"] == "Monthly work" and r.json()["label"] == "Claims SOP"
        r = await staff.patch(f"/api/desk/items/{c['id']}", json={"label": ""}, headers=csrf(staff))
        assert r.json()["label"] is None and r.json()["title"] == "kelayakan advance"
        # Someone else's pin: not theirs to change or remove.
        r = await other.patch(
            f"/api/desk/items/{a['id']}", json={"label": "Mine now"}, headers=csrf(other)
        )
        assert r.status_code == 404
        r = await other.delete(f"/api/desk/items/{a['id']}", headers={**JSON, **csrf(other)})
        assert r.status_code == 404

        # Drag: a new order, and the search moves into the folder.
        r = await staff.put(
            "/api/desk/items/order",
            json={"ids": [b["id"], c["id"], a["id"]], "folders": {c["id"]: "Monthly work"}},
            headers=csrf(staff),
        )
        assert r.status_code == 204
        d = (await staff.get("/api/desk")).json()
        assert [p["id"] for p in d["pins"]] == [b["id"], c["id"], a["id"]]
        assert {p["folder"] for p in d["pins"]} == {"Monthly work"}
        assert d["layout"]["folders"] == ["Monthly work"]

        # Folders: add one, order them, rename one, remove one (its pins stay, unfiled).
        r = await staff.put(
            "/api/desk/layout",
            json={"folders": ["Tenders", "Monthly work", "Tenders"]},
            headers=csrf(staff),
        )
        assert r.status_code == 200 and r.json()["folders"] == ["Tenders", "Monthly work"]
        r = await staff.post(
            "/api/desk/folders/rename",
            json={"name": "Monthly work", "to": "Every month"},
            headers=csrf(staff),
        )
        assert r.json()["folders"] == ["Tenders", "Every month"]
        d = (await staff.get("/api/desk")).json()
        assert {p["folder"] for p in d["pins"]} == {"Every month"}
        r = await staff.post(
            "/api/desk/folders/rename",
            json={"name": "Every month", "to": None},
            headers=csrf(staff),
        )
        assert r.json()["folders"] == ["Tenders"]
        d = (await staff.get("/api/desk")).json()
        assert {p["folder"] for p in d["pins"]} == {None}

        # The SOP moves to another department: the pin stays, unavailable, with only the name
        # the person gave it or saw, and nothing about it now.
        async with SessionLocal() as db:
            s = await db.get(SOP, sop_id)
            s.scope_id = o["depts"]["Operations"]  # type: ignore[union-attr]
            s.title = "Secret new title"  # type: ignore[union-attr]
            await db.commit()
        gone = next(p for p in (await staff.get("/api/desk")).json()["pins"] if p["id"] == a["id"])
        assert gone["missing"] is True and gone["sub"] == "" and gone["status"] is None
        assert "Secret" not in gone["title"] and "Secret" not in gone["name"]
    finally:
        await staff.aclose()
        await other.aclose()


async def test_desk_sections_per_person(client, llm, temporal):
    o = await office(client)
    staff, _ = await _staff_with_twin(client, o)
    try:
        lay = (await staff.get("/api/desk")).json()["layout"]
        assert [s["id"] for s in lay["sections"]] == [
            "today",
            "pinned",
            "recent",
            "ai",
            "howto",
            "goto",
        ]
        assert not any(s["hidden"] for s in lay["sections"]) and lay["folders"] == []
        r = await staff.put(
            "/api/desk/layout",
            json={"sections": [{"id": "pinned"}, {"id": "today"}, {"id": "goto", "hidden": True}]},
            headers=csrf(staff),
        )
        assert r.status_code == 200, r.text
        got = r.json()["sections"]
        # The ones left out keep showing, after the person's order.
        assert [s["id"] for s in got] == ["pinned", "today", "goto", "recent", "ai", "howto"]
        assert [s["id"] for s in got if s["hidden"]] == ["goto"]
        assert (await staff.get("/api/desk")).json()["layout"]["sections"] == got
        # Each section once; only known sections.
        for bad in ([{"id": "today"}, {"id": "today"}], [{"id": "salary"}]):
            r = await staff.put("/api/desk/layout", json={"sections": bad}, headers=csrf(staff))
            assert r.status_code == 422
        # The owner's desk is their own.
        assert not any(
            s["hidden"] for s in (await client.get("/api/desk")).json()["layout"]["sections"]
        )
        # Other settings in prefs are untouched by the desk's layout.
        r = await staff.put(
            "/api/me/prefs", json={"tutorial": {"dismissed": True}}, headers=csrf(staff)
        )
        assert r.status_code == 200
        async with SessionLocal() as db:
            u = await db.scalar(select(User).where(User.email == "siti@example.com"))
            assert (
                u.prefs["tutorial"]["dismissed"] is True
                and u.prefs["desk"]["sections"][0]["id"] == "pinned"
            )  # type: ignore[union-attr]
    finally:
        await staff.aclose()


async def test_find_only_what_the_person_may_open(client, llm, temporal):
    o = await office(client)
    staff, twin = await _staff_with_twin(client, o)
    other, other_twin = await _staff_with_twin(client, o, "amir@example.com")
    async with SessionLocal() as db:
        ws = (await db.get(Agent, twin["id"])).workspace_id  # type: ignore[union-attr]
        for agent, title in (
            (twin["id"], "Aging report October"),
            (other_twin["id"], "Aging report for Amir"),
        ):
            db.add(
                Task(
                    workspace_id=ws,
                    branch_id=o["branch"]["id"],
                    title=title,
                    brief=title,
                    status="ready",
                    priority="normal",
                    labels=[],
                    assignee_agent_id=agent,
                    created_by="test",
                    source="desk",
                )
            )
        await db.commit()
    try:
        r = await staff.get("/api/desk/find", params={"q": "aging"})
        assert r.status_code == 200, r.text
        f = r.json()
        assert [t["title"] for t in f["tasks"]] == ["Aging report October"]
        assert "contacts" not in f  # P102: the Customers and money module is gone
        assert f["people"] == []  # staff do not look after members
        f = (await staff.get("/api/desk/find", params={"q": "twin"})).json()
        assert [a["id"] for a in f["agents"]] == [twin["id"]]  # never someone else's own AI
        # The owner finds people (and every task but other people's assistants' work).
        f = (await client.get("/api/desk/find", params={"q": "amir"})).json()
        assert [(p["title"], p["sub"], p["url"]) for p in f["people"]] == [
            ("Amir", "staff", "/settings/members")
        ]
        f = (await staff.get("/api/desk/find", params={"q": "100%_"})).json()
        assert all(not v for v in f.values())
        assert (await staff.get("/api/desk/find", params={"q": "a"})).status_code == 422
    finally:
        await staff.aclose()
        await other.aclose()


async def test_todays_meetings_from_the_persons_own_calendar(client, llm, temporal, monkeypatch):
    from agentic.assistants import calendar

    o = await office(client)
    staff, _ = await _staff_with_twin(client, o)
    try:
        # Staff have no assistants: no calendar on their desk.
        assert (await staff.get("/api/desk/meetings")).json() == {"connected": False, "events": []}
        assert (await client.get("/api/desk/meetings")).json()["connected"] is False
        me = (await client.get("/api/auth/me")).json()
        async with SessionLocal() as db:
            db.add(
                GoogleAccount(
                    workspace_id=me["workspace"]["id"],
                    user_id=me["user"]["id"],
                    email="me@x.example",
                    token_enc="t",
                    scopes=" ".join(calendar.SCOPES),
                )
            )
            await db.commit()
        start = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=1)
        calls = []

        async def fake_events(db, acct, a, b, tz):
            calls.append(tz)
            return [
                calendar.Event(
                    id="e1",
                    title="Tender briefing",
                    start=start,
                    end=start + timedelta(hours=1),
                    all_day=False,
                    location="Bilik 2",
                ),
                calendar.Event(
                    id="e2",
                    title="Declined one",
                    start=start,
                    end=start,
                    all_day=False,
                    my_response="declined",
                ),
            ]

        monkeypatch.setattr(calendar, "events", fake_events)
        got = (await client.get("/api/desk/meetings")).json()
        assert got["connected"] is True and [e["title"] for e in got["events"]] == [
            "Tender briefing"
        ]
        assert got["events"][0]["location"] == "Bilik 2"
        # Kept a few minutes: the desk refreshes often, Google is asked once.
        assert (await client.get("/api/desk/meetings")).json() == got and len(calls) == 1
    finally:
        await staff.aclose()
