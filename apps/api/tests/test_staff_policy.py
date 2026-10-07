"""P30: staff have one personal AI (their twin); private assistants are for people who manage
others (assistants.use). Plus the staff visibility rules, scoped dreams, the HNSW scan tuning
for brain vector queries and the embedding dimension check."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from agentic.agents import launch
from agentic.assistants import access
from agentic.brain import embed
from agentic.brain.scope import Viewer
from agentic.brain.search import search_facts
from agentic.core.db import SessionLocal
from agentic.core.security import PERMISSIONS, ROLES, can
from agentic.knowledge import indexer
from agentic.models import Agent, AuditLog, BrainDream, BrainFact, BrainPage, Task

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_teams import team_temporal  # noqa: F401
from .test_twins import ANSWERS, staff_in

MANAGERS = {"owner", "admin", "branch_manager", "hod", "supervisor"}


def test_assistants_are_for_people_who_manage_others():
    assert {r for r in ROLES if can(r, "assistants.use")} == MANAGERS
    # Staff keep their one agent (the twin) and nothing more.
    assert PERMISSIONS["staff"] == frozenset(
        {"read", "work.write", "approvals.decide", "agents.own", "vault.own"}
    )


async def test_staff_have_no_assistants_and_get_a_plain_answer(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    sup = await as_role(
        client,
        "sup@example.com",
        "supervisor",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Finance"],
    )
    try:
        me = (await staff.get("/api/auth/me")).json()
        assert "assistants.use" not in me["permissions"]
        home = await staff.get("/api/assistants")
        assert home.status_code == 200, home.text
        body = home.json()
        assert body["available"] is False and body["assistants"] == [] and body["reason"]
        h = csrf(staff)
        for method, path in (
            ("post", "/api/assistants"),
            ("post", "/api/integrations/google/connect"),
            ("post", "/api/email-drafts/ed_nope/send"),
            ("post", "/api/email-drafts/ed_nope/discard"),
            ("post", "/api/calendar-drafts/cp_nope/confirm"),
            ("post", "/api/calendar-drafts/cp_nope/discard"),
        ):
            kw = {"json": {"preset": "chief_of_staff"} if path == "/api/assistants" else {}}
            r = await getattr(staff, method)(path, headers=h, **kw)
            assert r.status_code == 403, (path, r.text)
            assert r.json()["code"] == "assistants_not_for_role", path
        # A supervisor manages people: they may have one.
        r = await sup.post("/api/assistants", json={"preset": "analyst"}, headers=csrf(sup))
        assert r.status_code == 201, r.text
        assert (await sup.get("/api/assistants")).json()["available"] is True
    finally:
        await staff.aclose()
        await sup.aclose()


async def test_an_assistant_of_someone_who_loses_the_role_is_kept_but_paused(client, llm, temporal):
    o = await office(client)
    where = {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}
    sup = await as_role(client, "sup@example.com", "supervisor", **where)
    try:
        a = (
            await sup.post("/api/assistants", json={"preset": "analyst"}, headers=csrf(sup))
        ).json()
        uid = a["owner_user_id"]
        r = await client.patch(
            f"/api/members/{uid}", json={"role": "staff", **where}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text
        async with SessionLocal() as db:
            row = await db.get(Agent, a["id"])
            assert row is not None and row.status == "paused"  # kept, not deleted
            note = await db.scalar(
                select(AuditLog.note)
                .where(AuditLog.target == a["id"])
                .order_by(AuditLog.id.desc())
                .limit(1)
            )
            assert note == access.PAUSED_NOTE
            # Even switched back on behind the API's back, it stays dormant everywhere.
            row.status = "active"
            await db.commit()
        got = (await sup.get(f"/api/agents/{a['id']}")).json()
        assert got["status"] == "paused"
        r = await sup.post(f"/api/agents/{a['id']}/chat", json={"message": "hi"}, headers=csrf(sup))
        assert r.status_code == 409 and r.json()["code"] == "assistant_dormant"
        r = await sup.patch(f"/api/agents/{a['id']}", json={"status": "active"}, headers=csrf(sup))
        assert r.status_code in (403, 409)
        async with SessionLocal() as db:
            t = Task(
                workspace_id=row.workspace_id,
                branch_id=row.branch_id,
                title="Pulse",
                assignee_agent_id=a["id"],
                created_by=f"user:{uid}",
                status="triage",
            )
            db.add(t)
            await db.commit()
            with pytest.raises(launch.LaunchError) as e:
                await launch.launch(db, t, f"user:{uid}")
            assert e.value.code == "assistant_dormant"
            row = await db.get(Agent, a["id"])
            row.status = "paused"
            await db.commit()
        # Back to a managing role: the assistants the role change paused come back.
        r = await client.patch(
            f"/api/members/{uid}", json={"role": "supervisor", **where}, headers=csrf(client)
        )
        assert r.status_code == 200, r.text
        async with SessionLocal() as db:
            assert (await db.get(Agent, a["id"])).status == "active"
    finally:
        await sup.aclose()


async def test_assistants_made_before_the_rule_are_paused_at_worker_start(client, llm, temporal):
    o = await office(client)
    where = {"branch_id": o["branch"]["id"], "department_id": o["depts"]["Finance"]}
    sup = await as_role(client, "sup2@example.com", "supervisor", **where)
    try:
        a = (
            await sup.post("/api/assistants", json={"preset": "analyst"}, headers=csrf(sup))
        ).json()
    finally:
        await sup.aclose()
    async with SessionLocal() as db:
        # The owner became staff without follow_role (before the rule existed): still active.
        from agentic.models import Membership

        row = await db.get(Agent, a["id"])
        m = await db.get(Membership, (row.workspace_id, a["owner_user_id"]))
        m.role = "staff"
        await db.commit()
        assert (await db.get(Agent, a["id"])).status == "active"
        assert await access.settle_existing(db) == 1
        await db.commit()
        assert (await db.get(Agent, a["id"])).status == "paused"
        assert await access.settle_existing(db) == 0  # nothing left to settle


async def test_staff_schedule_and_chat_only_their_own_twin(client, llm, team_temporal):
    o = await office(client)
    office_agent = await new_agent(client, o, "Faiz", "Finance")
    staff = await staff_in(client, o)
    try:
        twin = (await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))).json()["twin"]
        async with SessionLocal() as db:
            me = await db.get(Agent, twin["id"])
            old = Agent(
                workspace_id=me.workspace_id,
                branch_id=me.branch_id,
                slug="old-helper",
                name="Old helper",
                role="Helper",
                template="custom",
                soul="",
                tools={},
                owner_user_id=me.owner_user_id,
                status="active",
            )
            db.add(old)
            await db.commit()
            old_id = old.id
        sched = {"name": "Daily", "title": "Morning summary", "cron": "0 9 * * 1-5"}
        r = await staff.post(
            "/api/schedules", json={**sched, "agent_id": twin["id"]}, headers=csrf(staff)
        )
        assert r.status_code == 201, r.text
        r = await staff.post(
            "/api/schedules", json={**sched, "agent_id": old_id}, headers=csrf(staff)
        )
        assert r.status_code == 403 and r.json()["code"] == "twin_only"
        r = await staff.post(
            "/api/schedules", json={**sched, "agent_id": office_agent["id"]}, headers=csrf(staff)
        )
        assert r.status_code == 404
        # Staff watch their office's agents (view only) but never chat with them.
        listed = {a["id"]: a for a in (await staff.get("/api/agents")).json()}
        assert listed[office_agent["id"]]["view_only"] is True
        r = await staff.post(
            f"/api/agents/{office_agent['id']}/chat", json={"message": "hi"}, headers=csrf(staff)
        )
        assert r.status_code == 404
        # Staff see only their own agents' approvals and tasks.
        assert (await staff.get("/api/approvals")).status_code == 200
    finally:
        await staff.aclose()


async def test_the_twin_wizard_never_loosens_what_a_manager_set(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        twin = r.json()["twin"]
        assert twin["tools"].get("web_search") != "deny"
        # The manager (here the owner) denies a tool, stops it picking up work, and pauses it.
        tools = {**twin["tools"], "web_search": "deny"}
        r = await client.patch(
            f"/api/agents/{twin['id']}",
            json={"tools": tools, "heartbeat": False, "status": "paused"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        # The person even rewrites the profile page so the wizard thinks the deny was theirs.
        async with SessionLocal() as db:
            page = await db.scalar(
                select(BrainPage).where(BrainPage.path == f"agents/{twin['slug']}/TWIN.md")
            )
            assert page is not None
            page.body = page.body.replace('"web_search": "allow"', '"web_search": "deny"')
            await db.commit()
        r = await staff.patch(
            "/api/me/twin", json={**ANSWERS, "heartbeat": True}, headers=csrf(staff)
        )
        assert r.status_code == 200, r.text
        after = r.json()["twin"]
        assert after["tools"]["web_search"] == "deny"
        assert after["heartbeat"] is False and after["status"] == "paused"
        assert after["autonomy"] == "ask"
        # Retired by the manager: no fresh twin to get round it.
        r = await client.patch(
            f"/api/agents/{twin['id']}", json={"status": "retired"}, headers=csrf(client)
        )
        assert r.status_code == 200
        r = await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))
        assert r.status_code == 409 and r.json()["code"] == "twin_retired"
    finally:
        await staff.aclose()


async def test_dreams_show_office_roles_only_their_share(client, llm, temporal):
    o = await office(client)
    office_agent = await new_agent(client, o, "Faiz", "Finance")
    staff = await staff_in(client, o)
    try:
        twin = (await staff.post("/api/me/twin", json=ANSWERS, headers=csrf(staff))).json()["twin"]
        now = datetime.now(UTC)
        async with SessionLocal() as db:
            ws = (await db.get(Agent, twin["id"])).workspace_id

            def fact(text: str, agent_id: str | None) -> BrainFact:
                f = BrainFact(
                    workspace_id=ws,
                    branch_id=o["branch"]["id"],
                    agent_id=agent_id,
                    text=text,
                    source_kind="person",
                    created_by="system",
                    valid_from=now,
                    created_at=now,
                )
                db.add(f)
                return f

            mine = [fact("Siti files claims on Friday", twin["id"]) for _ in range(2)]
            theirs = [fact("Faiz's secret client list", office_agent["id"]) for _ in range(2)]
            await db.flush()

            def merge(a: BrainFact, b: BrainFact) -> dict:
                return {
                    "kind": "merge",
                    "ended": a.id,
                    "ended_text": a.text,
                    "kept": b.id,
                    "kept_text": b.text,
                    "similarity": 0.99,
                    "undone": False,
                }

            d = BrainDream(
                workspace_id=ws,
                day=date(2026, 10, 1),
                status="done",
                stats={"facts_learned": 42, "pages_changed": 7},
                changes=[merge(*mine), merge(*theirs), {"kind": "skill", "name": "x"}],
                diary_path="DREAMS/2026-10-01.md",
                started_at=now,
                finished_at=now,
            )
            db.add(d)
            db.add(
                BrainPage(
                    workspace_id=ws,
                    path="DREAMS/2026-10-01.md",
                    name="2026-10-01",
                    title="Dream diary",
                    kind="dream",
                    body="Faiz's secret client list merged",
                    hash="0" * 64,
                    updated_by="system",
                )
            )
            await db.commit()
            dream_id = d.id
        listed = (await staff.get("/api/brain/dreams")).json()
        assert len(listed) == 1
        texts = {c.get("kept_text") for c in listed[0]["changes"]}
        assert "Siti files claims on Friday" in texts and "Faiz's secret client list" not in texts
        assert "facts_learned" not in listed[0]["stats"]
        one = (await staff.get(f"/api/brain/dreams/{dream_id}")).json()
        assert "Faiz" not in (one["diary"] or "") and "Siti files claims" in one["diary"]
        r = await staff.get("/api/brain/page", params={"path": "DREAMS/2026-10-01.md"})
        assert r.status_code == 404
        # The owner sees the whole dream.
        full = (await client.get(f"/api/brain/dreams/{dream_id}")).json()
        assert len(full["changes"]) == 3 and full["stats"]["facts_learned"] == 42
    finally:
        await staff.aclose()


async def test_brain_vector_queries_widen_the_hnsw_scan(client, monkeypatch):
    from agentic.knowledge import search as ksearch

    calls: list[int] = []

    async def tune(db):
        calls.append(1)

    monkeypatch.setattr(ksearch, "tune_vector_scan", tune)
    async with SessionLocal() as db:
        await search_facts(db, Viewer("ws_none"), "claims", embed.hash_vector("claims"))
    assert calls


def test_a_model_of_the_wrong_size_is_switched_off_once(monkeypatch):
    class Vec(list):
        def tolist(self):
            return list(self)

    class Wrong:
        def embed(self, texts, batch_size=1):
            return [Vec([0.1] * 7) for _ in texts]

    monkeypatch.setattr(embed, "_model", Wrong())
    monkeypatch.setattr(embed, "_failed", False)
    monkeypatch.setattr(indexer, "_dims_logged", False)
    said: list[str] = []
    monkeypatch.setattr(indexer.log, "error", lambda msg, *a: said.append(msg % a))
    embed._check_dims(embed._model)
    assert embed._model is None and embed._failed is True
    assert len(said) == 1 and "7-dimension" in said[0]
