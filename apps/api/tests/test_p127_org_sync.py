"""P127 (Fitri, 23 Nov 2026): "make sure the organization and hierarchy things sync with agentic
side, because agentic and prima is one so all things must be sync. and then give me the
pdf/excel for this hierarchy so I can view".

The office's reporting lines and Prima's org chart kept in step both ways (prima/org_sync.py),
and the chart downloaded as Excel and PDF (api/routers/org_chart_files.py). A fake Prima answers
its staff list, its org chart (as the CEO record) and its line route. Synthetic people only."""

import hashlib
import hmac
import io
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Membership, PrimaLink, Workspace
from agentic.prima import autolink, org_link, org_sync
from agentic.prima import client as prima
from agentic.prima.org_sync_models import PrimaOrgSync

from .conftest import csrf, setup_owner
from .test_office_roles import member, signed_in

SECRET = "q" * 40
MISSING = "The org chart settings are not installed in this database yet (module org-lines-v1)."


def _at(hours: float) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat().replace("+00:00", "Z")


@pytest.fixture
def fake_prima(monkeypatch):
    """Prima's staff list, its org chart as the CEO sees it, and POST /api/org/line (refused in
    words until the module is installed; one person refused by Prima's own rule)."""
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(prima, "_TOP", {})
    monkeypatch.setattr(autolink, "on", False)
    monkeypatch.setattr(org_link, "on", False)
    monkeypatch.setattr(org_sync, "on", False)
    state: dict = {
        "installed": False,
        # Prima user id -> [name, manager id, how, set at]
        "people": {
            "u-ceo": ["Chief", None, "top", None],
            "p-a": ["Alice", "p-b", "standard", None],
            "p-b": ["Bob", None, "standard", None],
            "p-c": ["Cara", "p-cos", "assumed", None],
            "p-e": ["Evan", "p-b", "set", _at(-48)],
            "p-cos": ["Cos", "u-ceo", "standard", None],
        },
        "job": {},  # what a person goes back to when a line is cleared
        "refuse": set(),
        "calls": [],
    }

    def handler(req: httpx.Request) -> httpx.Response:
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        want = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != want:
            return httpx.Response(401, json={"message": "bad signature"})
        state["calls"].append((req.method, url, h["x-office-user"], req.content))
        if url == "/api/office/staff":
            return httpx.Response(200, json=[
                {"id": "u-ceo", "name": "Chief", "title": "CEO", "role": "director",
                 "entraOid": None, "canSignIn": True, "top": "ceo"},
            ])  # fmt: skip
        if h["x-office-user"] != "u-ceo":
            return httpx.Response(403, json={"message": "office staff only"})
        if url == "/api/org/chart" and req.method == "GET":
            people = [
                {"id": pid, "name": n, "title": "", "managerId": mgr, "how": how,
                 "setBy": {"by": "x", "at": at, "reason": "r"} if how == "set" else None}
                for pid, (n, mgr, how, at) in state["people"].items()
            ]  # fmt: skip
            return httpx.Response(200, json={"installed": state["installed"], "people": people})
        if url == "/api/org/line" and req.method == "POST":
            if not state["installed"]:
                return httpx.Response(400, json={"message": MISSING})
            b = json.loads(req.content)
            if b["userId"] in state["refuse"]:
                return httpx.Response(403, json={"message": "Ask the HR Director."})
            row = state["people"][b["userId"]]
            if b["managerId"]:
                row[1:] = [b["managerId"], "set", _at(0)]
            else:
                row[1:] = state["job"].get(b["userId"], [None, "standard", None])
            return httpx.Response(201, json={"ok": True})
        return httpx.Response(404, json={"message": "not here"})

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    return state


async def _office(client) -> tuple[str, dict[str, str], dict[str, dict]]:
    """Owner; staff Alice, Bob, Cara, Evan (linked to Prima) and Dan (not linked)."""
    await setup_owner(client)
    bid = (await client.post("/api/branches", json={"name": "Maju"}, headers=csrf(client))).json()[
        "id"
    ]
    made = {}
    for name in ("alice", "bob", "cara", "evan", "dan"):
        made[name] = await member(client, f"{name}@example.com", "staff", branch_id=bid)
    ids = {k: v["member"]["user_id"] for k, v in made.items()}
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace.id))
        for name, pid in (("alice", "p-a"), ("bob", "p-b"), ("cara", "p-c"), ("evan", "p-e")):
            db.add(
                PrimaLink(
                    workspace_id=ws, user_id=ids[name], prima_user_id=pid, prima_name=name,
                    how="owner", linked_by="test",
                )
            )  # fmt: skip
        await db.commit()
    return ws, ids, made


async def _set(client, uid: str, boss: str | None, **extra):
    r = await client.patch(
        f"/api/members/{uid}", json={"reports_to_user_id": boss, **extra}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text


async def _lines(ws: str) -> dict[str, str | None]:
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Membership).where(Membership.workspace_id == ws))).all()
        return {m.user_id: m.reports_to_user_id for m in rows}


async def _state(ws: str, uid: str) -> PrimaOrgSync:
    async with SessionLocal() as db:
        st = await db.get(PrimaOrgSync, (ws, uid))
        assert st is not None
        return st


async def _sync(ws: str):
    async with SessionLocal() as db:
        return await org_sync.sync(db, ws)


def _posts(state: dict) -> list[dict]:
    return [json.loads(c[3]) for c in state["calls"] if c[0] == "POST" and c[1] == "/api/org/line"]


async def test_prima_fills_the_office_never_assumed_never_wiping_hr(client, fake_prima):
    ws, ids, _ = await _office(client)
    await _set(client, ids["evan"], ids["alice"])  # HR set Evan's line before the sync existed
    async with SessionLocal() as db:  # ... so it is no office change waiting for Prima
        await db.execute(PrimaOrgSync.__table__.delete())
        await db.commit()
    run = await _sync(ws)
    assert run is not None and run.ok and not run.installed
    lines = await _lines(ws)
    assert lines[ids["alice"]] == ids["bob"]  # no office line: Prima's is copied in
    assert lines[ids["cara"]] is None  # an assumed line (Chief of Staff) is never copied
    assert lines[ids["evan"]] == ids["alice"]  # HR's line stays; the difference is shown
    evan = await _state(ws, ids["evan"])
    assert (evan.state, evan.why, evan.winner) == ("differs", "unsure_office_keeps", "office")
    assert run.counts["unlinked"] == 2  # the owner (no Prima record) and Dan
    assert run.counts["from_prima"] == 1 and run.counts["differs"] == 1
    # Prima was asked twice (staff list, whole chart), not once per person; nothing was sent.
    assert [c[1] for c in fake_prima["calls"]] == ["/api/office/staff", "/api/org/chart"]
    async with SessionLocal() as db:
        row = await db.scalar(
            select(AuditLog).where(
                AuditLog.action == "member.manager_changed", AuditLog.actor == "system:prima"
            )
        )
        assert row is not None and row.target == ids["alice"]

    # Again: nothing new. Then Prima moves Evan (a head set it): Prima changed, the office follows.
    run = await _sync(ws)
    assert run.counts["from_prima"] == 0
    fake_prima["people"]["p-e"][1:] = ["p-c", "set", _at(0)]
    await _sync(ws)
    assert (await _lines(ws))[ids["evan"]] == ids["cara"]
    assert (await _state(ws, ids["evan"])).state == "in_step"

    # The status for the chart page (members.manage only).
    r = await client.get("/api/org-chart/prima-sync")
    assert r.status_code == 200 and r.json()["last_run"]["counts"]["in_step"] >= 3


async def test_no_loops_and_never_oneself(client, fake_prima):
    ws, ids, _ = await _office(client)
    await _sync(ws)  # Alice -> Bob from Prima
    assert (await _lines(ws))[ids["alice"]] == ids["bob"]
    # Prima now puts Bob under Alice: copying it would make a loop in the office.
    fake_prima["people"]["p-b"][1:] = ["p-a", "set", _at(0)]
    # And Cara under herself (bad data): never followed.
    fake_prima["people"]["p-c"][1:] = ["p-c", "set", _at(0)]
    await _sync(ws)
    lines = await _lines(ws)
    assert lines[ids["bob"]] is None and lines[ids["cara"]] is None
    bob = await _state(ws, ids["bob"])
    assert (bob.state, bob.why) == ("differs", "would_loop")


async def test_an_assumed_prima_line_takes_hr_s_office_line(client, fake_prima):
    """P128 (live, 24 Nov 2026): 18 people had a line set by HR in the office while Prima only had
    its assumed Chief of Staff for them; once Prima's chart takes lines, HR's line goes there."""
    ws, ids, _ = await _office(client)
    await _set(client, ids["cara"], ids["bob"])  # HR set Cara's line before the sync existed
    async with SessionLocal() as db:
        await db.execute(PrimaOrgSync.__table__.delete())
        await db.commit()
    fake_prima["installed"] = True
    await _sync(ws)
    sent = [p for p in _posts(fake_prima) if p["userId"] == "p-c"]
    assert sent and sent[-1]["managerId"] == "p-b"
    assert fake_prima["people"]["p-c"][1:3] == ["p-b", "set"]
    assert (await _lines(ws))[ids["cara"]] == ids["bob"]  # the office keeps HR's line
    cara = await _state(ws, ids["cara"])
    assert (cara.state, cara.winner) == ("in_step", "office")


async def test_office_lines_go_to_prima_or_wait_for_it(client, fake_prima):
    ws, ids, _ = await _office(client)
    await _sync(ws)
    # Not installed in Prima yet: the office saves, the line waits for Prima.
    await _set(client, ids["cara"], ids["alice"], line_reason="New team")
    run = await _sync(ws)
    cara = await _state(ws, ids["cara"])
    assert (cara.state, cara.why, cara.pending) == ("waiting", "not_installed", True)
    assert run.counts["waiting"] == 1 and not run.installed
    assert not _posts(fake_prima)  # Prima's chart said so: no call per person
    assert (await _lines(ws))[ids["cara"]] == ids["alice"]  # never undone
    await _sync(ws)
    assert (await _state(ws, ids["cara"])).state == "waiting"  # still, until installed
    # Installed: the next run sends it, as the CEO record, with who and why.
    fake_prima["installed"] = True
    await _sync(ws)
    sent = _posts(fake_prima)[-1]
    assert sent == {
        "userId": "p-c",
        "managerId": "p-a",
        "reason": "Set in Agentic Office by Owner One: New team",
    }
    assert fake_prima["people"]["p-c"][1:3] == ["p-a", "set"]
    cara = await _state(ws, ids["cara"])
    assert (cara.state, cara.pending, cara.winner) == ("in_step", False, "office")
    # A refusal by Prima's own rules: waiting, with Prima's words; the office keeps its line.
    fake_prima["refuse"].add("p-e")
    await _set(client, ids["evan"], ids["alice"])
    await _sync(ws)
    evan = await _state(ws, ids["evan"])
    assert (evan.state, evan.message) == ("waiting", "Ask the HR Director.")
    assert _posts(fake_prima)[-1]["reason"] == "Set in Agentic Office by Owner One: no reason given"
    # Someone not linked to Prima is skipped (Dan), and a line to him cannot reach Prima.
    await _set(client, ids["dan"], ids["alice"])
    await _set(client, ids["cara"], ids["dan"])
    n = len(_posts(fake_prima))
    run = await _sync(ws)
    assert all(p["userId"] != "p-c" for p in _posts(fake_prima)[n:])
    assert (await _state(ws, ids["cara"])).why == "office_manager_not_linked"
    assert run.counts["unlinked"] == 2
    # The button on the chart page runs it and answers the status; staff cannot.
    r = await client.post("/api/org-chart/prima-sync", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    people = {p["user_id"]: p for p in r.json()["people"]}
    assert people[ids["evan"]]["state"] == "waiting"
    assert people[ids["evan"]]["office_line"] == "Alice"


async def test_the_side_changed_last_wins(client, fake_prima):
    ws, ids, _ = await _office(client)
    fake_prima["installed"] = True
    await _sync(ws)  # Alice -> Bob from Prima, in step
    # Both change Alice: the office now, Prima a head an hour from now: Prima wins.
    await _set(client, ids["alice"], ids["cara"])
    fake_prima["people"]["p-a"][1:] = ["p-e", "set", _at(1)]
    await _sync(ws)
    assert (await _lines(ws))[ids["alice"]] == ids["evan"]
    alice = await _state(ws, ids["alice"])
    assert (alice.state, alice.winner, alice.why) == ("in_step", "prima", "prima_newer")
    # Both change again: Prima yesterday (an older line), the office now: the office wins.
    await _set(client, ids["alice"], ids["cara"])
    fake_prima["people"]["p-a"][1:] = ["p-b", "set", _at(-24)]
    await _sync(ws)
    assert (await _lines(ws))[ids["alice"]] == ids["cara"]
    assert fake_prima["people"]["p-a"][1] == "p-c"
    alice = await _state(ws, ids["alice"])
    assert (alice.state, alice.winner, alice.why) == ("in_step", "office", "office_newer")


async def test_downloads_show_only_what_the_reader_may_see(client, fake_prima):
    ws, ids, made = await _office(client)
    await _sync(ws)  # Alice -> Bob from Prima
    await _set(client, ids["cara"], ids["alice"])
    # The owner sees everyone in full.
    r = await client.get("/api/org-chart/export.xlsx")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "attachment" in r.headers["content-disposition"]
    sheet = load_workbook(io.BytesIO(r.content)).active
    rows = [list(x) for x in sheet.iter_rows(values_only=True)]
    assert rows[0][0] == "Name" and rows[0][-1] == "Where Prima's line comes from"
    by = {x[0]: x for x in rows[1:]}
    assert by["Alice"][5] == "Bob" and by["Alice"][8] == "yes"
    assert by["Alice"][9] == "Bob" and by["Alice"][10] == "From the job in Prima"
    assert by["Cara"][6] == 3  # Bob > Alice > Cara
    assert by["Dan"][8] == "no"
    names = [x[0] for x in rows[1:]]
    assert names.index("Bob") < names.index("Alice") < names.index("Cara")
    # Dan (staff) sees himself in full; the others by name, title, company and department only.
    dan = await signed_in("dan@example.com", made["dan"]["temp_password"])
    r = await dan.get("/api/org-chart/export.xlsx")
    assert r.status_code == 200
    rows = [
        list(x) for x in load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True)
    ]
    by = {x[0]: x for x in rows[1:]}
    assert by["Alice"][2] == "MAJU"  # company shown
    assert all(v in (None, "") for v in by["Alice"][5:])  # no line, counts or Prima details
    assert by["Dan"][8] == "no"
    # The PDF: a real PDF, landscape, attached; Malay headings for a Malay reader.
    r = await dan.get("/api/org-chart/export.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert r.headers["content-type"] == "application/pdf"
    r = await dan.get("/api/org-chart/export.xlsx", headers={"x-lang": "ms"})
    assert load_workbook(io.BytesIO(r.content)).active["A1"].value == "Nama"
    # Staff cannot see or run the sync.
    assert (await dan.get("/api/org-chart/prima-sync")).status_code == 403
    assert (
        await dan.post("/api/org-chart/prima-sync", json={}, headers=csrf(dan))
    ).status_code == 403
    async with SessionLocal() as db:
        n = len(
            (
                await db.scalars(select(AuditLog).where(AuditLog.action == "org.chart_downloaded"))
            ).all()
        )
        assert n == 4
    await dan.aclose()
