"""P92: agents learn from people's corrections on the spot, use the lessons every time, fold
them into the ePerolehan skill at night, and show a daily "getting smarter" digest.

The model is scripted (test_agents.ScriptedLLM). The lesson writer uses the small models
("local", then "fast"), so these tests give the office a fast group; without one a lesson is
the person's own words (or nothing, for answers and denials).
"""

import json
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select

from agentic.agents import runtime
from agentic.brain import facts as brain_facts
from agentic.brain import lessons, weekly
from agentic.brain.scope import for_agent
from agentic.core.db import SessionLocal
from agentic.models import AgentMessage, AuditLog, BrainFact, Skill, SkillProposal, Task, Workspace
from agentic.skills import autopilot, curator, eperolehan
from agentic.skills import store as skills_store
from agentic.skills.store import SkillError

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role

SECRET_PW = "Sutera@2026x"


def lesson(text: str, *, same_as=None, replaces=None, **parts) -> str:
    return json.dumps(
        {
            "lesson": {"text": text, **{k: parts.get(k, "") for k in lessons.FIELDS}},
            "same_as": same_as,
            "replaces": replaces,
        }
    )


async def with_fast(client: httpx.AsyncClient) -> dict:
    o = await office(client)
    r = await client.put(
        "/api/ai/groups/fast",
        json={"members": [{"provider_id": o["provider"]["id"], "model_id": "m1"}]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    return o


async def tender_task(client, agent, title="Prepare QT260123 on ePerolehan") -> dict:
    r = await client.post(
        "/api/tasks",
        json={
            "title": title,
            "brief": "Fill the quotation on the portal.",
            "assignee_agent_id": agent["id"],
            "labels": ["web", "tender"],
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def all_lessons(active_only: bool = True) -> list[BrainFact]:
    async with SessionLocal() as db:
        q = select(BrainFact).where(BrainFact.source_kind == "lesson")
        if active_only:
            q = q.where(BrainFact.valid_to.is_(None))
        return list((await db.scalars(q.order_by(BrainFact.created_at))).all())


async def send_back(client, task_id: str, feedback: str) -> httpx.Response:
    await runtime.finish(task_id, "done", "Filled every line with Ya.")
    return await client.post(
        f"/api/tasks/{task_id}/revise", json={"feedback": feedback}, headers=csrf(client)
    )


# ---------------------------------------------------------------- capture, every path


async def test_a_send_back_on_eperolehan_work_is_a_lesson_at_once(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await tender_task(client, agent)
    llm.say(
        lesson(
            "In the Catatan field, write the confirmed brand, model and the specification "
            "line that complies, not just Ya.",
            when="filling each requirement line",
            do="write brand, model and the matching specification",
            dont="leave only Ya",
            field="Catatan",
        )
    )
    r = await send_back(client, task["id"], "Wrong, Catatan must have the brand and model too.")
    assert r.status_code == 200, r.text
    got = await all_lessons()
    assert len(got) == 1
    f = got[0]
    me = (await client.get("/api/auth/me")).json()["user"]["id"]
    assert f.created_by == f"user:{me}" and f.confidence >= 0.95
    assert f.meta["topic"] == "eperolehan" and f.meta["field"] == "Catatan"
    assert f.meta["via"] == "send_back" and f.meta["agent_id"] == agent["id"]
    assert f.meta["task_id"] == task["id"] and f.meta["taught"] == 1
    assert f.agent_id is None and f.branch_id == o["branch"]["id"]  # a team agent: shared
    # The small model saw the correction and the work; the person sees "Noted" with Undo.
    asked = llm.requests[-1]["messages"][-1]["content"]
    assert "Catatan must have the brand" in asked and "ePerolehan" in asked
    events = (await client.get(f"/api/tasks/{task['id']}")).json()["events"]
    noted = [e for e in events if e["kind"] == "lesson"]
    assert noted and noted[0]["data"]["lesson_id"] == f.id and noted[0]["text"] == f.text


async def test_without_a_small_model_the_persons_words_are_the_lesson(client, llm, temporal):
    o = await office(client)  # smart only: no small model for lessons
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await new_task(client, agent, "Monthly claims summary")
    r = await send_back(client, task["id"], "Always group the claims by department first.")
    assert r.status_code == 200
    assert llm.requests == []  # the agent's own model is never used for this
    [f] = await all_lessons()
    assert f.text == "Always group the claims by department first."
    assert f.meta["topic"] == "general" and f.meta["via"] == "send_back"


async def test_a_reviewer_agents_send_back_is_not_a_persons_lesson(client, llm, temporal):
    from agentic.agents import launch
    from agentic.models import Agent

    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await new_task(client, agent, "Draft the letter")
    await runtime.finish(task["id"], "done", "Draft.")
    async with SessionLocal() as db:
        t = await db.get(Task, task["id"])
        a = await db.get(Agent, agent["id"])
        await launch.send_back(db, t, a, "Fix the date format please.", f"agent:{agent['id']}")
    assert await all_lessons() == [] and llm.requests == []


async def test_an_answer_with_a_rule_is_a_lesson_a_plain_answer_is_not(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await tender_task(client, agent)
    await client.post(f"/api/tasks/{task['id']}/start", json={}, headers=csrf(client))
    llm.call("ask_human", question="Which month should I use?")
    r = await runtime.run_task_step(task["id"])
    q = r.approval_id
    await client.post(
        f"/api/approvals/{q}",
        json={"decision": "answer", "answer": "October"},
        headers=csrf(client),
    )
    calls = len(llm.requests)
    await runtime.apply_approval(q)
    assert len(llm.requests) == calls and await all_lessons() == []  # no model call, no lesson

    llm.call("ask_human", question="Should I download the SSM certificate again?")
    llm.replies[-1]["tool_calls"][0]["id"] = "call_ssm"  # the script numbers calls from 1
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    llm.say(lesson("Never download the SSM certificate again; attach the one in Company files."))
    await client.post(
        f"/api/approvals/{r.approval_id}",
        json={
            "decision": "answer",
            "answer": "No, never download it again, always attach the SSM copy from Company files.",
        },
        headers=csrf(client),
    )
    await runtime.apply_approval(r.approval_id)
    [f] = await all_lessons()
    assert f.meta["via"] == "ask_human" and "SSM" in f.text and f.meta["topic"] == "eperolehan"
    assert (
        "Should I download the SSM certificate again?"
        in llm.requests[-1]["messages"][-1]["content"]
    )


async def test_a_denial_with_a_reason_is_a_lesson_or_the_old_fact(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Rafi", "Research")
    task = await new_task(client, agent, "Check the price")
    llm.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    r = await runtime.run_task_step(task["id"])
    llm.say(lesson("Use the supplier price list in Files for prices, not the web."))
    await client.post(
        f"/api/approvals/{r.approval_id}",
        json={"decision": "deny", "answer": "Use the supplier price list in Files, not the web."},
        headers=csrf(client),
    )
    await runtime.apply_approval(r.approval_id)
    [f] = await all_lessons()
    assert f.meta["via"] == "denial" and "supplier price list" in f.text

    # The model finds nothing for next time in it: the denial is kept as before (private).
    task2 = await new_task(client, agent, "Check the price again")
    llm.call("web_fetch", url="https://good.fake/page", why="Need it")
    r = await runtime.run_task_step(task2["id"])
    llm.say(json.dumps({"lesson": None}))
    await client.post(
        f"/api/approvals/{r.approval_id}",
        json={"decision": "deny", "answer": "Not now, the boss is away today."},
        headers=csrf(client),
    )
    await runtime.apply_approval(r.approval_id)
    async with SessionLocal() as db:
        kept = await db.scalar(
            select(BrainFact).where(
                BrainFact.agent_id == agent["id"], BrainFact.source_kind == "person"
            )
        )
    assert kept is not None and "boss is away" in kept.text
    assert len(await all_lessons()) == 1


async def test_chat_corrections_and_remember_this_become_lessons(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    llm.say("Tenders on ePerolehan close at 5pm.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "When do ePerolehan tenders close?"},
        headers=csrf(client),
    )
    sid = r.json()["session_id"]
    assert await all_lessons() == []  # a first message is a request, not a correction
    llm.say(lesson("ePerolehan tenders close at 12 noon on the closing date, not 5pm."))
    llm.say("Noted: 12 noon.")
    r = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "No, ePerolehan closes at 12 noon, not 5pm.", "session_id": sid},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["reply"] == "Noted: 12 noon."
    [f] = await all_lessons()
    assert f.meta["via"] == "chat" and f.meta["topic"] == "eperolehan"
    assert f.meta["session_id"] == sid
    # The very answer used it, and the person sees it under the answer (with Undo).
    final = llm.requests[-1]["messages"]
    assert any("12 noon on the closing date" in str(m.get("content")) for m in final)
    msgs = (await client.get(f"/api/chat/sessions/{sid}/messages")).json()
    assert msgs[-1]["meta"]["lesson"]["lesson_id"] == f.id

    llm.say(lesson("Address letters to the Pengarah by name.")).say("Will do.")
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Remember this: letters go to the Pengarah by name.", "session_id": sid},
        headers=csrf(client),
    )
    vias = sorted(f.meta["via"] for f in await all_lessons())
    assert vias == ["chat", "remember"]


# ---------------------------------------------------------------- secrets never get in


async def test_secrets_never_reach_the_model_or_the_lesson(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await tender_task(client, agent)
    # The model (somehow) writes a code into the lesson: nothing is kept.
    llm.say(lesson("Sign in with password Sutera1234 and then open the tender."))
    r = await send_back(
        client,
        task["id"],
        f"Open the tender first. The password is {SECRET_PW} and the TAC 554433 comes by SMS.",
    )
    assert r.status_code == 200
    sent = json.dumps(llm.requests)
    assert SECRET_PW not in sent and "554433" not in sent
    assert await all_lessons() == []

    # Without a model: the person's words minus the sentence with the secret.
    assert lessons.scrub(f"pin 4321. kata laluan: {SECRET_PW}") == (
        "pin [redacted]. kata laluan: [redacted]"
    )
    assert lessons.safe("Enter the OTP 123456 when asked") is None
    assert lessons.safe("Never type the password into notes.") is not None  # a mention is fine


# ---------------------------------------------------------------- newer replaces older


async def test_a_newer_lesson_on_the_same_point_replaces_the_older(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await tender_task(client, agent)
    llm.say(lesson("Name the summary file QT<5 digits> - COMPANY SUMMARY."))
    await send_back(client, task["id"], "Name the summary QT plus 5 digits then COMPANY SUMMARY.")
    [old] = await all_lessons()

    # P94: the rerun follows the eperolehan-tender skill (in its brief since it was started):
    # a brief that long is self-checked before it is handed in again.
    llm.say('{"ok": true, "issues": []}')
    llm.say(lesson("Same point: put the short company name in capitals.", same_as=old.id))
    await send_back(client, task["id"], "Again: the summary file name, like I said before.")
    [same] = await all_lessons()
    assert same.id == old.id and same.meta["taught"] == 2  # taught twice: a repeated mistake

    llm.say(
        lesson("Name the summary file QT<last 5 digits> - <SHORT NAME> SUMMARY.", replaces=old.id)
    )
    await send_back(client, task["id"], "No, use the last 5 digits and the SHORT company name.")
    [new] = await all_lessons()
    assert new.id != old.id and new.meta["replaced"] == old.id and new.meta["taught"] == 3
    async with SessionLocal() as db:
        ended = await db.get(BrainFact, old.id)
    assert ended.valid_to is not None and ended.end_reason == "replaced"
    assert ended.superseded_by == new.id

    # Undo brings the older one back.
    r = await client.post(f"/api/lessons/{new.id}/undo", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["restored"]["id"] == old.id
    assert [f.id for f in await all_lessons()] == [old.id]


async def test_the_post_task_extractor_never_ends_a_lesson(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await new_task(client, agent, "Claims summary")
    await send_back(client, task["id"], "Always group the claims by department first.")
    llm.requests.clear()
    [f] = await all_lessons()
    llm.say(
        json.dumps({"facts": [{"text": "Claims are grouped by branch only.", "private": False}]})
    )
    llm.say(json.dumps({"decisions": [{"new": 1, "action": "replace", "old": f.id}]}))
    from agentic.models import Agent

    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        out = await brain_facts.learn(
            db, a, await for_agent(db, a), "USER: group them\nASSISTANT: ok",
            source_kind="task", source_id=task["id"], source_label="t",
        )  # fmt: skip
    assert out.replaced == []
    assert [x.id for x in await all_lessons()] == [f.id]


# ---------------------------------------------------------------- used every time


async def test_tender_runs_get_the_lessons_and_count_the_use(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    first = await tender_task(client, agent)
    await client.post(f"/api/tasks/{first['id']}/start", json={}, headers=csrf(client))  # run 1
    llm.say(lesson("Press Cetak Tawaran before asking for the final approval."))
    await send_back(client, first["id"], "You forgot Cetak Tawaran before asking me to submit.")
    [f] = await all_lessons()

    # A brand-new tender task: the lesson rides on its first message, whatever its words.
    other = await tender_task(client, agent, "QT260999 quotation")
    llm.say("Done.")
    await runtime.run_task_step(other["id"])
    async with SessionLocal() as db:
        first_msg = await db.scalar(
            select(AgentMessage)
            .where(AgentMessage.task_id == other["id"])
            .order_by(AgentMessage.id)
            .limit(1)
        )
        used = await db.get(BrainFact, f.id)
    assert "Lessons learned for ePerolehan:" in first_msg.content
    assert f.text in first_msg.content
    assert used.hits >= 1 and used.last_used_at is not None

    # The sent-back task's rerun looks in memory again: the lesson rides on the feedback.
    llm.say("Fixed.")
    await runtime.run_task_step(first["id"])
    async with SessionLocal() as db:
        fb = await db.scalar(
            select(AgentMessage).where(
                AgentMessage.task_id == first["id"],
                AgentMessage.content.startswith("Feedback on your last answer:"),
            )
        )
    assert "Lessons learned for ePerolehan:" in fb.content and f.text in fb.content
    assert fb.meta["recall_run"] == 2
    hits = (await client.get("/api/lessons?topic=eperolehan")).json()["items"][0]["uses"]
    events = (await client.get(f"/api/tasks/{first['id']}")).json()["events"]
    assert any(e["kind"] == "memory" and "run 2" in e["text"] for e in events)
    # Once per run: a second step of the same run does not repeat it.
    llm.say("Still fixed.")
    await runtime.run_task_step(first["id"])
    assert (await client.get("/api/lessons?topic=eperolehan")).json()["items"][0]["uses"] == hits


async def test_a_general_lesson_stays_with_the_agent_taught(client, llm, temporal):
    o = await office(client)
    tina = await new_agent(client, o, "Tina", "Operations")
    adam = await new_agent(client, o, "Adam", "Operations")
    t = await new_task(client, tina, "Weekly roster")
    await send_back(client, t["id"], "Always put the night shift first in the roster.")
    for who, expect in ((tina, True), (adam, False)):
        task = await new_task(client, who, "Another roster")
        llm.say("Done.")
        await runtime.run_task_step(task["id"])
        async with SessionLocal() as db:
            msg = await db.scalar(
                select(AgentMessage.content)
                .where(AgentMessage.task_id == task["id"])
                .order_by(AgentMessage.id)
                .limit(1)
            )
        # The lessons block is the taught agent's; a colleague may still recall the shared
        # lesson by meaning, like any fact of its company.
        assert ("Lessons people taught you" in msg) is expect


# ---------------------------------------------------------------- the ePerolehan skill


async def test_tender_mode_follows_the_eperolehan_skill(client, llm, temporal, monkeypatch):
    from agentic.api.routers import web_tasks

    async def ok(url):
        return None

    monkeypatch.setattr(web_tasks, "guard_url", ok)
    o = await office(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    r = await client.post(
        f"/api/agents/{agent['id']}/web-task",
        json={"url": "https://eperolehan.example/tender", "instructions": "Prepare QT260123",
              "mode": "tender"},
        headers=csrf(client),
    )  # fmt: skip
    assert r.status_code == 201, r.text
    task = r.json()
    full = (await client.get(f"/api/tasks/{task['id']}")).json()["task"]
    assert "eperolehan-tender" in full["brief"] and "Never press the final submit" in full["brief"]
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        skill = await eperolehan.find(db, ws.id)
        assert skill is not None and skill.trust == "builtin"
        from agentic.models import SkillUse

        use = await db.scalar(select(SkillUse).where(SkillUse.task_id == task["id"]))
    assert use is not None and use.skill_id == skill.id  # reflection patches THIS skill


async def test_the_nightly_fold_puts_lessons_into_the_skill_pitfalls(
    client, llm, temporal, monkeypatch
):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    await client.get("/api/skills")  # built-in skills, eperolehan-tender included
    task = await tender_task(client, agent)
    llm.say(lesson("Upload the Cadangan Teknikal as PDF, never as Word."))
    await send_back(client, task["id"], "The Cadangan Teknikal must be a PDF, not Word.")
    [f] = await all_lessons()

    async def tested(db, p):  # the evals pass, as well as the live version
        p.eval = {"new": {"passed": 2, "total": 2}, "old": {"passed": 2, "total": 2}}
        await db.commit()
        return p.eval

    monkeypatch.setattr("agentic.skills.reflect.evaluate", tested)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        changes = await lessons.fold_into_skills(db, ws)
        assert [c["action"] for c in changes] == ["lessons"] and changes[0]["live"]
        skill = await eperolehan.find(db, ws.id)
        assert skill.version == 2 and skill.approved_by == autopilot.AUTOPILOT.actor
        assert f.text in eperolehan.pitfalls(skill.body)
        p = await db.scalar(select(SkillProposal).where(SkillProposal.proposed_by == "lessons"))
        assert p.status == "approved" and p.kind == "patch"
        # Nothing new: no new proposal tomorrow.
        assert await lessons.fold_into_skills(db, ws) == []
    # In the skill now: the brief carries it; the lessons block does not repeat it.
    other = await tender_task(client, agent, "QT260777")
    llm.say("Done.")
    await runtime.run_task_step(other["id"])
    async with SessionLocal() as db:
        first = await db.scalar(
            select(AgentMessage.content)
            .where(AgentMessage.task_id == other["id"])
            .order_by(AgentMessage.id)
            .limit(1)
        )
    assert "Lessons learned for ePerolehan" not in first


async def test_a_fold_waits_for_a_person_when_the_autopilot_rules_say_so(
    client, llm, temporal, monkeypatch
):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    await client.get("/api/skills")
    await client.put("/api/learning/settings", json={"mode": "review"}, headers=csrf(client))
    task = await tender_task(client, agent)
    llm.say(lesson("Check the closing time on the tender page before starting."))
    await send_back(client, task["id"], "Check the closing time first next time.")

    async def tested(db, p):
        return None

    monkeypatch.setattr("agentic.skills.reflect.evaluate", tested)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        [c] = await lessons.fold_into_skills(db, ws)
        assert not c["live"]
        skill = await eperolehan.find(db, ws.id)
        assert skill.version == 1  # a person approved the live text: no silent rewrite
        p = await db.get(SkillProposal, c["proposal_id"])
        assert p.status == "pending" and "Waiting for a person" in (p.decision_note or "")
        # Rejected by a person: those lessons are not proposed again.
        await skills_store.reject(
            db, ws, p, skills_store.brain_store.Author("user:x", "Owner One"), "Not now"
        )
        assert await lessons.fold_into_skills(db, ws) == []


def test_fold_body_adds_to_pitfalls_and_drops_the_replaced_line():
    body = "## When to use\nx\n\n## Pitfalls\n- Old rule.\n\n## Notes\nn\n"
    out = lessons.fold_body(body, ["New rule."], ["Old rule."])
    assert (
        "- New rule." in out
        and "Old rule." not in out
        and out.index("New rule") < out.index("## Notes")
    )
    assert "## Pitfalls\n- A." in lessons.fold_body("## Steps\n1. x\n", ["A."], [])


# ---------------------------------------------------------------- the Lessons view


async def _seed(ws_id: str, agent_id: str, text: str, by: str, *, private: bool = False):
    async with SessionLocal() as db:
        now = datetime.now(UTC)
        f = BrainFact(
            workspace_id=ws_id,
            agent_id=agent_id if private else None,
            text=text,
            source_kind="lesson",
            created_by=by,
            confidence=0.95,
            valid_from=now,
            created_at=now,
            meta={"topic": "eperolehan", "agent_id": agent_id, "via": "chat", "taught": 1,
                  "last_taught_at": now.isoformat()},
        )  # fmt: skip
        db.add(f)
        await db.commit()
        return f.id


async def test_lessons_view_permissions(client, llm, temporal):
    o = await office(client)
    team = await new_agent(client, o, "Faiz", "Operations")
    staff = await as_role(
        client,
        "staff@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Operations"],
    )
    try:
        mine = (
            await staff.post(
                "/api/agents",
                json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Operations"],
                      "name": "My Helper", "role": "Assistant"},
                headers=csrf(staff),
            )
        ).json()  # fmt: skip
        staff_id = (await staff.get("/api/auth/me")).json()["user"]["id"]
        owner_id = (await client.get("/api/auth/me")).json()["user"]["id"]
        async with SessionLocal() as db:
            ws_id = (await db.scalar(select(Workspace))).id
        on_team = await _seed(ws_id, team["id"], "Team lesson on Faiz.", f"user:{owner_id}")
        on_mine = await _seed(
            ws_id, mine["id"], "Staff taught their helper.", f"user:{staff_id}", private=True
        )
        by_owner = await _seed(
            ws_id, mine["id"], "Owner taught the helper.", f"user:{owner_id}", private=True
        )

        seen = (await staff.get("/api/lessons")).json()
        assert {x["id"] for x in seen["items"]} == {on_mine, by_owner}  # own AI only
        assert not seen["can_edit"]
        assert (await staff.get("/api/lessons?agent_id=" + team["id"])).json()["items"] == []
        r = await staff.patch(
            f"/api/lessons/{on_mine}", json={"text": "x" * 20}, headers=csrf(staff)
        )
        assert r.status_code == 403
        r = await staff.post(f"/api/lessons/{on_mine}/forget", json={}, headers=csrf(staff))
        assert r.status_code == 403
        r = await staff.post(f"/api/lessons/{on_team}/undo", json={}, headers=csrf(staff))
        assert r.status_code == 404  # not theirs to see
        r = await staff.post(f"/api/lessons/{by_owner}/undo", json={}, headers=csrf(staff))
        assert r.status_code == 403  # they did not teach it
        r = await staff.post(f"/api/lessons/{on_mine}/undo", json={}, headers=csrf(staff))
        assert r.status_code == 200 and r.json()["lesson"]["state"] == "ended"

        # The owner sees every lesson, edits one (a new lesson replaces it, on record).
        everything = (await client.get("/api/lessons?state=all")).json()
        assert {x["id"] for x in everything["items"]} == {on_team, on_mine, by_owner}
        assert everything["can_edit"]
        assert {a["name"] for a in everything["agents"]} == {"Faiz", "My Helper"}
        r = await client.patch(
            f"/api/lessons/{on_team}",
            json={"text": "Team lesson on Faiz, corrected.", "field": "Catatan"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["id"] != on_team and new["field"] == "Catatan" and new["via"] == "edit"
        assert new["taught_by"] == f"user:{owner_id}"
        r = await client.patch(
            f"/api/lessons/{new['id']}", json={"text": "Use pin 4321 here."}, headers=csrf(client)
        )
        assert r.status_code == 422
        async with SessionLocal() as db:
            old = await db.get(BrainFact, on_team)
            audit = await db.scalar(select(AuditLog).where(AuditLog.action == "lesson.edited"))
        assert old.superseded_by == new["id"] and old.end_reason == "replaced"
        assert audit is not None
        r = await client.post(f"/api/lessons/{new['id']}/forget", json={}, headers=csrf(client))
        assert r.status_code == 200 and r.json()["end_reason"] == "forgotten"
    finally:
        await staff.aclose()


async def test_daily_digest_and_weekly_report(client, llm, temporal):
    o = await with_fast(client)
    agent = await new_agent(client, o, "Tina", "Operations")
    task = await tender_task(client, agent)
    llm.say(lesson("Download every tender document before filling anything."))
    await send_back(client, task["id"], "Download all the tender documents first.")
    [f] = await all_lessons()
    # P94: the rerun follows the eperolehan-tender skill (in its brief since it was started):
    # a brief that long is self-checked before it is handed in again.
    llm.say('{"ok": true, "issues": []}')
    llm.say(lesson("Download every tender document first.", same_as=f.id))
    await send_back(client, task["id"], "Again, download the documents first.")

    d = (await client.get("/api/learning/digest")).json()
    assert d["totals"]["lessons"] == 1 and d["totals"]["repeated"] == 1
    assert d["lessons"][0]["text"] == f.text and d["repeated"][0]["taught"] == 2
    assert d["lessons"][0]["topic_label"] == "ePerolehan" and d["next"] is None
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        monday = weekly.week_of(datetime.now(UTC).date())[0]
        data = await weekly.gather(db, ws, monday)
    row = next(a for a in data["agents"] if a["id"] == agent["id"])
    assert row["lessons"] == 1 and row["repeated"] == 1 and f.text in row["lesson_examples"]
    assert "more than once" in weekly._body(data, "en")
    # A day with nothing learned is empty, not an error.
    old_day = (datetime.now(UTC) - timedelta(days=30)).date().isoformat()
    assert (await client.get(f"/api/learning/digest?day={old_day}")).json()["lessons"] == []


# ---------------------------------------------------------------- QA fixes


async def test_a_stale_skill_draft_cannot_undo_a_newer_version(client, llm, temporal):
    await office(client)
    await client.get("/api/skills")
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        skill = await skills_store.find(db, ws.id, "proofread-document")
        one = await skills_store.propose(
            db, ws, kind="patch", skill=skill, name=skill.name, description=skill.description,
            body=skill.body + "\n- First change.\n", reason="a", proposed_by="curator",
        )  # fmt: skip
        two = await skills_store.propose(
            db, ws, kind="patch", skill=skill, name=skill.name, description=skill.description,
            body=skill.body + "\n- Second change.\n", reason="b", proposed_by="user:x",
        )  # fmt: skip
        author = skills_store.brain_store.Author("user:x", "Owner One")
        await skills_store.approve(db, ws, one, author)
        try:
            await skills_store.approve(db, ws, two, author)
            raise AssertionError("a stale draft went live")
        except SkillError as e:
            assert "changed since this was drafted" in str(e)
        await db.refresh(skill)
        assert "First change" in skill.body
        # A person who edits the draft while approving has seen it: allowed.
        await skills_store.approve(db, ws, two, author, body=skill.body + "\n- Both.\n")


async def test_the_curator_never_merges_skills_of_different_companies(client, llm, temporal):
    o = await office(client)
    await client.get("/api/skills")
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        base = await skills_store.find(db, ws.id, "proofread-document")
        twin = Skill(
            workspace_id=ws.id, branch_id=o["branch"]["id"], name="proofread-company-docs",
            description=base.description, body=base.body, version=1, trust="trusted",
            created_by="user:x", approved_by="user:x", embedding=list(base.embedding),
        )  # fmt: skip
        db.add(twin)
        await db.commit()
        await curator.run(db, ws)
        merges = (
            await db.scalars(select(SkillProposal).where(SkillProposal.kind == "merge"))
        ).all()
    assert merges == []


async def test_staff_change_only_their_own_ais_memory(client, llm, temporal):
    o = await office(client)
    r = await client.post(
        "/api/brain/facts", json={"text": "Invoices are due on the 20th."}, headers=csrf(client)
    )
    shared = r.json()
    staff = await as_role(
        client,
        "staff@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Operations"],
    )
    try:
        mine = (
            await staff.post(
                "/api/agents",
                json={"branch_id": o["branch"]["id"], "department_id": o["depts"]["Operations"],
                      "name": "My Helper", "role": "Assistant"},
                headers=csrf(staff),
            )
        ).json()  # fmt: skip
        # Staff read the shared fact, but neither forget nor rewrite nor add to it.
        for verb in ("forget", "restore"):
            r = await staff.post(
                f"/api/brain/facts/{shared['id']}/{verb}", json={}, headers=csrf(staff)
            )
            assert r.status_code == 403, r.text
        r = await staff.patch(
            f"/api/brain/facts/{shared['id']}", json={"text": "No invoices."}, headers=csrf(staff)
        )
        assert r.status_code == 403
        r = await staff.post(
            "/api/brain/facts", json={"text": "Everyone gets a bonus."}, headers=csrf(staff)
        )
        assert r.status_code == 403
        # Their own AI's memory is theirs.
        r = await staff.post(
            "/api/brain/facts",
            json={"text": "I start work at 8am.", "agent_id": mine["id"]},
            headers=csrf(staff),
        )
        assert r.status_code == 201, r.text
        r = await staff.post(
            f"/api/brain/facts/{r.json()['id']}/forget", json={}, headers=csrf(staff)
        )
        assert r.status_code == 200
    finally:
        await staff.aclose()
