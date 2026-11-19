"""P114 (Fitri, 18 Nov 2026): every person (staff to owner) sets how the office tells them
(email, the app, Telegram, WhatsApp) and about what; email is a delivery channel like the others;
the person whose AI ran out of allowance or waits for a manager hears of it."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from agentic.agents import runtime
from agentic.channels import deliver
from agentic.core.db import SessionLocal
from agentic.models import Approval, Delivery, LLMCall, User, Workspace
from agentic.services import notify_prefs

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_p36 import chat, twin_of, ws_of
from .test_twins import staff_in


@pytest.fixture
def sent(monkeypatch):
    out: list[dict] = []

    async def fake(db, workspace_id, **kw):
        out.append(kw)

    monkeypatch.setattr(deliver, "send_mail", fake)
    return out


async def _mail_on(ws_id: str) -> None:
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        ws.settings = {
            **(ws.settings or {}),
            "system_mail": {"enabled": True, "address": "noreply@example.com"},
        }
        flag_modified(ws, "settings")
        await db.commit()


async def _rows(user_id: str, channel: str = "email") -> list[Delivery]:
    async with SessionLocal() as db:
        return list(
            (
                await db.scalars(
                    select(Delivery)
                    .where(Delivery.target == user_id, Delivery.channel == channel)
                    .order_by(Delivery.created_at)
                )
            ).all()
        )


def test_defaults_and_what_email_carries():
    u = User(id="u1", email="a@example.com", name="A", prefs={})
    assert notify_prefs.wants(u, "my_ai", "email") and notify_prefs.wants(u, "limit", "app")
    assert not notify_prefs.wants(u, "other", "email")  # small notices: email only when asked
    assert notify_prefs.wants(u, "other", "telegram")
    u.prefs = {"notify": {"channels": {"email": False}, "events": {"done": False}}}
    assert not notify_prefs.wants(u, "my_ai", "email")
    assert not notify_prefs.wants(u, "done", "app") and notify_prefs.wants(u, "limit", "app")
    u.prefs = {"notify": {"email_other": True}}
    assert notify_prefs.wants(u, "other", "email")


async def test_each_person_sets_their_notifications(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        r = await staff.get("/api/me/notifications")
        assert r.status_code == 200, r.text
        body = r.json()
        assert all(body["channels"].values()) and all(body["events"].values())
        assert body["email_other"] is False and body["email_ready"] is False
        r = await staff.put(
            "/api/me/notifications",
            json={"channels": {"email": False}, "events": {"done": False}, "email_other": True},
            headers=csrf(staff),
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["channels"]["email"] is False and out["channels"]["app"] is True
        assert out["events"]["done"] is False and out["email_other"] is True
        r = await staff.put(
            "/api/me/notifications", json={"channels": {"fax": True}}, headers=csrf(staff)
        )
        assert r.status_code == 422
        # The owner (and every other role) has the same page.
        assert (await client.get("/api/me/notifications")).status_code == 200
    finally:
        await staff.aclose()


async def test_email_is_a_delivery_and_follows_the_switches(client, llm, temporal, sent):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        twin = await twin_of(staff)
        ws_id = await ws_of(twin)
        me = (await staff.get("/api/auth/me")).json()["user"]
        await _mail_on(ws_id)
        assert (await staff.get("/api/me/notifications")).json()["email_ready"] is True
        r = await staff.post("/api/me/notifications/test", json={}, headers=csrf(staff))
        assert r.status_code == 200 and r.json()["queued"] >= 1
        rows = await _rows(me["id"])
        assert len(rows) == 1 and rows[0].payload["subject"] == "Test notification"
        async with SessionLocal() as db:
            assert await deliver.deliver(db, rows[0].id) == "sent"
        assert sent and sent[0]["to"] == me["email"] and sent[0]["sender"] == "noreply@example.com"
        assert "Test notification" in sent[0]["html"]
        async with SessionLocal() as db:
            d = await db.get(Delivery, rows[0].id)
            assert d.payload == {"subject": "Test notification"}  # the page is not kept
        # Email off: nothing by email.
        await staff.put(
            "/api/me/notifications", json={"channels": {"email": False}}, headers=csrf(staff)
        )
        await staff.post("/api/me/notifications/test", json={}, headers=csrf(staff))
        assert len(await _rows(me["id"])) == 1
    finally:
        await staff.aclose()


async def test_running_out_tells_the_person_and_their_managers(client, llm, temporal, sent):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        twin = await twin_of(staff)
        ws_id = await ws_of(twin)
        me = (await staff.get("/api/auth/me")).json()["user"]
        owner = (await client.get("/api/auth/me")).json()["user"]
        await _mail_on(ws_id)
        await client.put(
            "/api/allowances/policy",
            json={"daily_tokens": 100, "roles": ["staff"]},
            headers=csrf(client),
        )
        async with SessionLocal() as db:
            db.add(
                LLMCall(
                    workspace_id=ws_id,
                    ts=datetime.now(UTC),
                    task="agent.chat",
                    provider_name="Good",
                    model="m1",
                    prompt_tokens=150,
                    completion_tokens=0,
                    status="ok",
                    user_id=me["id"],
                )
            )
            await db.commit()
        # Chat refused: they hear it once a day, and the owner (who may give more) too.
        await chat(staff, twin["id"], "Draft the weekly report")
        await chat(staff, twin["id"], "Again please")
        mine = [d.payload["subject"] for d in await _rows(me["id"])]
        assert mine == ["Your AI allowance for today is used up"]
        theirs = [d.payload["subject"] for d in await _rows(owner["id"])]
        assert theirs == [f"{me['name']} used today's AI allowance"]

        # A task that runs out: the staff member (who may not decide it) hears it is paused.
        r = await staff.post(
            "/api/tasks",
            json={
                "title": "Aging report",
                "brief": "By customer.",
                "assignee_agent_id": twin["id"],
            },
            headers=csrf(staff),
        )
        task_id = r.json()["id"]
        step = await runtime.run_task_step(task_id)
        assert step.state == "needs_approval"
        mine = [d.payload["subject"] for d in await _rows(me["id"])]
        assert mine.count("Your AI allowance for today is used up") == 2
        # P116: the owner may decide it, but is not emailed about someone else's AI: it waits on
        # Approvals (and "used today's AI allowance" already told them).
        owner_rows = await _rows(owner["id"])
        assert not any(twin["name"] in (d.payload.get("subject") or "") for d in owner_rows)
        async with SessionLocal() as db:
            waiting = await db.scalar(
                select(Approval).where(Approval.task_id == task_id, Approval.status == "pending")
            )
            assert waiting is not None

        # More given: they hear how much and that the task carries on.
        r = await client.post(
            f"/api/allowances/{me['id']}/give",
            json={"tokens": 5000, "span": "week"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        mine = [d.payload["subject"] for d in await _rows(me["id"])]
        assert f"{owner['name']} gave you 5,000 more AI tokens a day until Sunday" in mine
    finally:
        await staff.aclose()
