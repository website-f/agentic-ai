"""P109: tasks for people, Trello-like. Many assignees and watchers, a checklist, sub-tasks,
files, the start date and kind of work; every assignee hears of it in the office and by email
(when system mail is set up), never the giver; who sees a person's task (being on it, the
reporting line, never another company's); the AI task path unchanged."""

import pytest

from agentic.core.db import SessionLocal
from agentic.core.workspace_settings import SystemMail
from agentic.microsoft import sendmail
from agentic.services import task_mail
from agentic.teams import task_parts

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import member
from .test_p97_team_work import _as, _team, told  # noqa: F401


@pytest.fixture
def mails(monkeypatch):
    """The office's system mail is set up; emails are recorded, never sent."""
    sent: list[dict] = []

    async def sender(db, workspace_id):
        return SystemMail(enabled=True, address="noreply@example.com", from_name="No Reply")

    async def send(db, workspace_id, **kw):
        sent.append(kw)

    monkeypatch.setattr(task_mail, "sender", sender)
    monkeypatch.setattr(sendmail, "send", send)
    return sent


async def _report(client, manager_id: str, ids: list[str]) -> None:
    r = await client.put(
        f"/api/members/{manager_id}/team", json={"user_ids": ids}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text


async def test_people_task_many_assignees_told_in_app_and_by_email(client, told, mails):  # noqa: F811
    o, made, ids = await _team(client)
    await _report(client, ids["hana"], [ids["sara"], ids["tom"]])
    await _report(client, ids["bea"], [ids["hana"]])  # Hana reports to Bea
    hana, sara, tom, bea, omar = [
        await _as(made, n) for n in ("hana", "sara", "tom", "bea", "omar")
    ]
    try:
        body = {
            "title": "Prepare the audit pack",
            "brief": "**Bank** statements and *receipts*.",
            "assignee_user_ids": [ids["sara"], ids["tom"]],
            "watcher_user_ids": [ids["bea"]],
            "category": "Follow up",
            "start_at": "2026-11-18T01:00:00Z",
            "due_at": "2026-11-20T09:00:00Z",
            "checklist": ["Bank statements", "  ", "Receipts"],
            "subtasks": [{"title": "Scan the receipts", "assignee_user_id": ids["tom"]}],
            "labels": ["Audit"],
        }
        # Only people the giver may give work to; a watcher they may add.
        bad = {**body, "watcher_user_ids": [ids["omar"]]}
        r = await hana.post("/api/tasks", json=bad, headers=csrf(hana))
        assert r.status_code == 403 and r.json()["code"] == "cannot_watch", r.text
        bad = {**body, "assignee_user_ids": [ids["sara"], ids["omar"]]}
        r = await hana.post("/api/tasks", json=bad, headers=csrf(hana))
        assert r.status_code == 403 and r.json()["code"] == "cannot_assign"
        bad = {**body, "start_at": "2026-11-21T00:00:00Z"}
        r = await hana.post("/api/tasks", json=bad, headers=csrf(hana))
        assert r.status_code == 422 and r.json()["code"] == "start_after_due"
        assert told == [] and mails == []

        r = await hana.post("/api/tasks", json=body, headers=csrf(hana))
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["status"] == "triage" and t["assignee_user_id"] == ids["sara"]
        assert [a["name"] for a in t["assignees"]] == ["Sara", "Tom"]
        assert [w["name"] for w in t["watchers"]] == ["Bea"]
        assert t["category"] == "follow_up" and t["start_at"].startswith("2026-11-18")
        assert (t["checklist_done"], t["checklist_total"]) == (0, 2)
        assert (t["subtasks_done"], t["subtasks_total"]) == (0, 1)

        # Every assignee hears (the sub-task's person too), the giver never.
        kid = next(x for x in (await hana.get("/api/tasks", params={"q": "Scan"})).json())
        assert sorted((u, i) for u, _, i in told) == sorted(
            [(ids["sara"], t["id"]), (ids["tom"], t["id"]), (ids["tom"], kid["id"])]
        )
        await task_mail.drain()
        to = sorted(m["to"] for m in mails)
        assert to == ["sara@example.com", "tom@example.com", "tom@example.com"]
        first = next(m for m in mails if m["to"] == "sara@example.com")
        assert f"/tasks?task={t['id']}" in first["html"]
        assert "Prepare the audit pack" in first["subject"] and "Hana" in first["html"]
        assert "Bank** statements" not in first["html"]  # no description in the email

        # Who sees it: everyone on it and Hana's manager; not a colleague who is not.
        for c in (sara, tom, bea, hana):
            assert (await c.get(f"/api/tasks/{t['id']}")).status_code == 200
        assert (await omar.get(f"/api/tasks/{t['id']}")).status_code == 404
        detail = (await tom.get(f"/api/tasks/{t['id']}")).json()
        assert [i["text"] for i in detail["checklist"]] == ["Bank statements", "Receipts"]
        assert [c["title"] for c in detail["children"]] == ["Scan the receipts"]
        # Tom (the second assignee) has it in his list and in the bell.
        mine = (await tom.get("/api/tasks", params={"who": "assigned"})).json()
        assert {x["id"] for x in mine} == {t["id"], kid["id"]}
        needs = (await tom.get("/api/me/needs")).json()
        assert any(i["key"] == "assigned" for i in needs["items"])
        got = (await tom.get("/api/me/assigned-tasks")).json()
        assert t["id"] in {x["id"] for x in got["items"]}
        # Bea follows it: in her "watching" list, not in Omar's board.
        watching = (await bea.get("/api/tasks", params={"who": "watching"})).json()
        assert [x["id"] for x in watching] == [t["id"]]
        assert t["id"] not in {x["id"] for x in (await omar.get("/api/tasks")).json()}

        # Tom (not the first assignee) works it: done on someone else's task goes to a check.
        h = csrf(tom)
        r = await tom.patch(f"/api/tasks/{t['id']}", json={"status": "running"}, headers=h)
        assert r.status_code == 200, r.text
        r = await tom.patch(f"/api/tasks/{t['id']}", json={"status": "done"}, headers=h)
        assert r.json()["status"] == "review"

        # A comment reaches everyone on it but the writer.
        told.clear()
        r = await tom.post(f"/api/tasks/{t['id']}/comments", json={"text": "Half done"}, headers=h)
        assert r.status_code == 201
        assert sorted(u for u, _, _ in told) == sorted([ids["sara"], ids["bea"], ids["hana"]])

        # Someone on it may not take others off (only who gave it, or who may give them work).
        r = await tom.put(
            f"/api/tasks/{t['id']}/people", json={"assignee_user_ids": [ids["tom"]]}, headers=h
        )
        assert r.status_code == 403 and r.json()["code"] == "cannot_assign"

        # Adding someone: they hear (and get an email); the ones already on it do not.
        told.clear()
        mails.clear()
        r = await hana.put(
            f"/api/tasks/{t['id']}/people",
            json={"assignee_user_ids": [ids["sara"], ids["tom"]], "watcher_user_ids": []},
            headers=csrf(hana),
        )
        assert r.status_code == 200 and r.json()["watchers"] == []
        assert told == []
        r = await client.put(
            f"/api/tasks/{t['id']}/people",
            json={"assignee_user_ids": [ids["sara"], ids["tom"], ids["omar"]]},
            headers=csrf(client),
        )
        assert [a["name"] for a in r.json()["assignees"]] == ["Sara", "Tom", "Omar"]
        assert [u for u, _, _ in told] == [ids["omar"]]
        await task_mail.drain()
        assert [m["to"] for m in mails] == ["omar@example.com"]
        r = await hana.put(
            f"/api/tasks/{t['id']}/people", json={"assignee_user_ids": []}, headers=csrf(hana)
        )
        assert r.status_code == 422
    finally:
        for c in (hana, sara, tom, bea, omar):
            await c.aclose()


async def test_no_email_without_system_mail_and_none_to_myself(client, told, monkeypatch):  # noqa: F811
    o, made, ids = await _team(client)
    sent: list = []

    async def send(db, workspace_id, **kw):
        sent.append(kw)

    monkeypatch.setattr(sendmail, "send", send)
    await _report(client, ids["hana"], [ids["sara"]])
    hana = await _as(made, "hana")
    try:
        r = await hana.post(
            "/api/tasks",
            json={"title": "Call the bank", "assignee_user_ids": [ids["sara"]]},
            headers=csrf(hana),
        )
        assert r.status_code == 201
        assert [u for u, _, _ in told] == [ids["sara"]]  # in the office all the same
        await task_mail.drain()
        assert sent == []  # system mail is not set up
        told.clear()
        r = await hana.post(
            "/api/tasks",
            json={"title": "My own note", "assignee_user_ids": [ids["hana"]]},
            headers=csrf(hana),
        )
        assert r.json()["status"] == "ready" and told == []
    finally:
        await hana.aclose()


async def test_checklist_subtasks_and_files(client, told, mails):  # noqa: F811
    o, made, ids = await _team(client)
    await _report(client, ids["hana"], [ids["sara"], ids["tom"]])
    hana, sara, omar = [await _as(made, n) for n in ("hana", "sara", "omar")]
    try:
        t = (
            await hana.post(
                "/api/tasks",
                json={"title": "Month end", "assignee_user_ids": [ids["sara"]]},
                headers=csrf(hana),
            )
        ).json()
        h = csrf(sara)
        base = f"/api/tasks/{t['id']}/checklist"
        r = await sara.post(base, json={"text": "Payroll"}, headers=h)
        assert r.status_code == 201
        r = await sara.post(base, json={"text": "Bank"}, headers=h)
        items = r.json()
        assert [i["text"] for i in items] == ["Payroll", "Bank"]
        r = await sara.patch(f"{base}/{items[0]['id']}", json={"done": True}, headers=h)
        assert r.json()[0]["done"] is True and r.json()[0]["done_by_name"] == "Sara"
        r = await sara.patch(f"{base}/{items[1]['id']}", json={"text": "Bank rec"}, headers=h)
        assert r.json()[1]["text"] == "Bank rec"
        card = next(x for x in (await hana.get("/api/tasks")).json() if x["id"] == t["id"])
        assert (card["checklist_done"], card["checklist_total"]) == (1, 2)
        # Someone not on it reaches neither the task nor its items.
        assert (
            await omar.patch(f"{base}/{items[0]['id']}", json={"done": False}, headers=csrf(omar))
        ).status_code == 404
        r = await sara.delete(
            f"{base}/{items[1]['id']}", headers={**h, "content-type": "application/json"}
        )
        assert [i["text"] for i in r.json()] == ["Payroll"]
        detail = (await hana.get(f"/api/tasks/{t['id']}")).json()
        assert any(e["kind"] == "checklist" for e in detail["events"])

        # Sub-tasks: Sara (staff) may give one only to herself; Hana to her people.
        r = await sara.post(
            f"/api/tasks/{t['id']}/subtasks",
            json={"title": "Ask Tom", "assignee_user_id": ids["tom"]},
            headers=h,
        )
        assert r.status_code == 403
        r = await sara.post(f"/api/tasks/{t['id']}/subtasks", json={"title": "Payslips"}, headers=h)
        assert r.status_code == 201 and r.json()["assignee_user_id"] == ids["sara"]
        assert r.json()["parent_task_id"] == t["id"] and r.json()["status"] == "ready"
        r = await hana.post(
            f"/api/tasks/{t['id']}/subtasks", json={"title": "Check"}, headers=csrf(hana)
        )
        assert r.json()["assignee_user_id"] == ids["sara"]  # the parent's person by default
        card = next(x for x in (await hana.get("/api/tasks")).json() if x["id"] == t["id"])
        assert card["subtasks_total"] == 2
        top = (await hana.get("/api/tasks", params={"top": "true"})).json()
        assert {x["id"] for x in top} == {t["id"]}

        # Files: an upload on the task, then a Library file linked (it stays in the Library).
        up = await sara.post(
            f"/api/files?name=shot.png&task_id={t['id']}",
            content=b"\x89PNG\r\n\x1a\n" + b"0" * 64,
            headers={**h, "content-type": "application/octet-stream", "x-file-type": "image/png"},
        )
        assert up.status_code == 201, up.text
        lib = await client.post(
            "/api/files?name=policy.txt",
            content=b"Leave policy",
            headers={
                **csrf(client),
                "content-type": "application/octet-stream",
                "x-file-type": "text/plain",
            },
        )
        lid = lib.json()["id"]
        r = await client.patch(
            f"/api/files/{lid}/library",
            json={"library": True, "scope": "workspace"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        r = await sara.post(f"/api/tasks/{t['id']}/files", json={"file_ids": [lid]}, headers=h)
        assert r.status_code == 200, r.text
        files = (await hana.get(f"/api/tasks/{t['id']}/attachments")).json()
        assert sorted(f["name"] for f in files) == ["policy.txt", "shot.png"]
        async with SessionLocal() as db:
            from agentic.models import DocFile

            assert (await db.get(DocFile, lid)).task_id is None  # still the Library's
        card = next(x for x in (await hana.get("/api/tasks")).json() if x["id"] == t["id"])
        assert card["files_count"] == 2
        r = await sara.delete(
            f"/api/tasks/{t['id']}/attachments/{lid}",
            headers={**h, "content-type": "application/json"},
        )
        assert r.status_code == 204
        assert len((await hana.get(f"/api/tasks/{t['id']}/attachments")).json()) == 1
    finally:
        for c in (hana, sara, omar):
            await c.aclose()


async def test_reporting_line_sees_further_down_never_another_company(client, told):  # noqa: F811
    o, made, ids = await _team(client)
    # Hana (HOD) <- Sue (supervisor) <- Tom (staff); Sara reports to no one.
    await _report(client, ids["hana"], [ids["sue"]])
    await _report(client, ids["sue"], [ids["tom"]])
    hana, sue, sara = [await _as(made, n) for n in ("hana", "sue", "sara")]
    try:
        t = (
            await sue.post(
                "/api/tasks",
                json={"title": "Fix the shelves", "assignee_user_ids": [ids["tom"]]},
                headers=csrf(sue),
            )
        ).json()
        # Hana sees it down her line (Tom works in her company); Sara does not.
        assert (await hana.get(f"/api/tasks/{t['id']}")).status_code == 200
        assert t["id"] in {x["id"] for x in (await hana.get("/api/tasks")).json()}
        assert (await sara.get(f"/api/tasks/{t['id']}")).status_code == 404
        async with SessionLocal() as db:
            from sqlalchemy import select

            from agentic.models import Membership

            ws = await db.scalar(
                select(Membership.workspace_id).where(Membership.user_id == ids["hana"])
            )
            # Not in one of her companies: only her direct reports.
            assert await task_parts.chain_below(db, ws, ids["hana"], []) == {ids["sue"]}
            assert ids["tom"] in await task_parts.chain_below(
                db, ws, ids["hana"], [o["branch"]["id"]]
            )
        # A staff member gives work only to themselves, and may add the people they report to
        # as watchers; nobody else.
        await _report(client, ids["hana"], [ids["sue"], ids["sara"]])
        r = await sara.post(
            "/api/tasks",
            json={
                "title": "x",
                "assignee_user_ids": [ids["sara"]],
                "watcher_user_ids": [ids["hana"]],
            },
            headers=csrf(sara),
        )
        assert r.status_code == 201, r.text
        r = await sara.post(
            "/api/tasks",
            json={
                "title": "x",
                "assignee_user_ids": [ids["sara"]],
                "watcher_user_ids": [ids["omar"]],
            },
            headers=csrf(sara),
        )
        assert r.status_code == 403
        r = await sara.put(
            f"/api/tasks/{t['id']}/people",
            json={"assignee_user_ids": [ids["tom"], ids["sara"]]},
            headers=csrf(sara),
        )
        assert r.status_code == 404  # not hers to see
        w = (await sara.get("/api/team/watchable")).json()
        assert sorted(p["name"] for p in w) == ["Hana", "Sara"]
        assert all("email" not in p for p in w)
    finally:
        for c in (hana, sue, sara):
            await c.aclose()


async def test_filters_and_the_ai_path_unchanged(client, llm, temporal, told):  # noqa: F811
    o, made, ids = await _team(client)
    await _report(client, ids["hana"], [ids["sara"]])
    hana = await _as(made, "hana")
    try:
        h = csrf(hana)
        a = (
            await hana.post(
                "/api/tasks",
                json={
                    "title": "Audit A",
                    "assignee_user_ids": [ids["sara"]],
                    "labels": ["audit"],
                    "start_at": "2026-12-01T00:00:00Z",
                    "due_at": "2026-12-05T00:00:00Z",
                },
                headers=h,
            )
        ).json()
        b = (
            await hana.post(
                "/api/tasks",
                json={
                    "title": "Other B",
                    "assignee_user_ids": [ids["sara"]],
                    "due_at": "2027-01-10T00:00:00Z",
                },
                headers=h,
            )
        ).json()
        q = lambda **p: hana.get("/api/tasks", params=p)  # noqa: E731
        assert [x["id"] for x in (await q(label="audit")).json()] == [a["id"]]
        got = (await q(span_from="2026-12-04T00:00:00Z", span_to="2026-12-31T00:00:00Z")).json()
        assert [x["id"] for x in got] == [a["id"]]
        got = (await q(due_from="2027-01-01T00:00:00Z")).json()
        assert [x["id"] for x in got] == [b["id"]]
        assert {x["id"] for x in (await q(who="created")).json()} == {a["id"], b["id"]}
        assert {x["id"] for x in (await q(kind="people")).json()} == {a["id"], b["id"]}
        assert (await q(kind="ai")).json() == []

        # An agent's task: exactly as before (no people, no watchers allowed).
        fin = await new_agent(client, o, "Faiz")
        r = await client.post(
            "/api/tasks",
            json={
                "title": "Reconcile",
                "assignee_agent_id": fin["id"],
                "watcher_user_ids": [ids["sara"]],
            },
            headers=csrf(client),
        )
        assert r.status_code == 422 and r.json()["code"] == "people_only"
        r = await client.post(
            "/api/tasks",
            json={"title": "Reconcile", "assignee_agent_id": fin["id"], "checklist": ["One"]},
            headers=csrf(client),
        )
        assert r.status_code == 201
        ai = r.json()
        assert ai["assignees"] == [] and ai["status"] == "ready" and ai["checklist_total"] == 1
        assert (
            await client.put(
                f"/api/tasks/{ai['id']}/people",
                json={"assignee_user_ids": [ids["sara"]]},
                headers=csrf(client),
            )
        ).status_code == 409
        # Given to a person later, the agent is let go and the person is on it.
        r = await client.patch(
            f"/api/tasks/{ai['id']}", json={"assignee_user_id": ids["sara"]}, headers=csrf(client)
        )
        assert r.status_code == 200 and [x["name"] for x in r.json()["assignees"]] == ["Sara"]
        assert r.json()["assignee_agent_id"] is None
        # And back to an agent: no people left on it.
        r = await client.patch(
            f"/api/tasks/{ai['id']}", json={"assignee_agent_id": fin["id"]}, headers=csrf(client)
        )
        assert r.status_code == 200 and r.json()["assignees"] == []
    finally:
        await hana.aclose()


async def test_a_new_member_can_be_given_people_tasks(client, told):  # noqa: F811
    """The migration's copy: a P97 task (one assignee) reads as one assignee."""
    o = await office(client)
    m = await member(client, "lee@example.com", "staff", branch_id=o["branch"]["id"])
    uid = m["member"]["user_id"]
    r = await client.post(
        "/api/tasks", json={"title": "Old style", "assignee_user_id": uid}, headers=csrf(client)
    )
    assert r.status_code == 201
    assert [a["user_id"] for a in r.json()["assignees"]] == [uid]
