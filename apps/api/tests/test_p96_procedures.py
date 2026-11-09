"""P96: what an agent learned becomes its own brain. Learned procedures (routines) replay
without the agent's model, browser steps included (elements found again by name, the same
policy and approvals); a repeated first question is answered from what the agent said; a
person's correction pauses a procedure; one person's procedures never serve another; the
owner or a manager switches replay off per agent and forgets a procedure.

Tokens are counted by a fake model that bills what it is sent (characters / 4), so the
numbers below are the real shape of a first run against a repeated one."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from agentic.agents import runtime
from agentic.brain import answers
from agentic.brain import lessons as brain_lessons
from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.models import Agent, Approval, BrainFact, LLMCall, Routine, Task, TaskEvent, User
from agentic.skills import routines

from .conftest import csrf
from .test_agents import ScriptedLLM, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role
from .test_p36 import _done, _draft, _messages, _vec, chat, fast_group, twin_of
from .test_twins import staff_in


class CountingLLM(ScriptedLLM):
    """The scripted model, billing what it is sent: every message and every tool schema."""

    def handler(self, request: httpx.Request) -> httpx.Response:
        r = super().handler(request)
        if request.url.path.endswith("/chat/completions"):
            body = self.requests[-1]
            sent = json.dumps(body["messages"]) + json.dumps(body.get("tools") or [])
            data = json.loads(r.content)
            data["usage"] = {"prompt_tokens": len(sent) // 4, "completion_tokens": 20}
            return httpx.Response(200, json=data)
        return r


@pytest.fixture
def llm():
    s = CountingLLM()
    engine_client.use_transport(httpx.MockTransport(s.handler))
    yield s
    engine_client.use_transport(None)


@pytest.fixture
def loose(monkeypatch):
    monkeypatch.setattr(routines, "MATCH", 0.5)
    monkeypatch.setattr(routines, "CONFIRM", 0.5)


async def _tokens(task_id: str) -> tuple[int, int]:
    """(model calls, tokens) billed for a task."""
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(LLMCall.prompt_tokens, LLMCall.completion_tokens).where(
                    LLMCall.task_id == task_id
                )
            )
        ).all()
    return len(rows), sum(p + c for p, c in rows)


async def _owner() -> str:
    async with SessionLocal() as db:
        return await db.scalar(select(User.id).where(User.email == "owner@example.com"))


async def _place(agent: dict) -> dict:
    a = await _agent_row(agent["id"])
    return {"branch_id": a.branch_id, "department_id": a.department_id}


async def _office_of(agent: dict) -> dict:
    a = await _agent_row(agent["id"])
    return {"branch": {"id": a.branch_id}, "depts": {"Finance": a.department_id}}


async def _agent_row(agent_id: str) -> Agent:
    async with SessionLocal() as db:
        return await db.get(Agent, agent_id)


# ---------------------------------------------------------------- pure parts


def test_values_are_read_off_a_brief_that_reads_the_same():
    slots = [{"name": "first", "example": "1250"}, {"name": "second", "example": "300"}]
    ex = "Add up the invoices: 1250 and 300"
    assert routines.by_pattern(ex, slots, "Add up the invoices: 700 and 45") == {
        "first": "700",
        "second": "45",
    }
    # Case and spacing do not matter; the values keep the person's own writing.
    named = [{"name": "who", "example": "Syarikat Maju"}]
    got = routines.by_pattern(
        "Send the statement to Syarikat Maju", named, "send the  statement to Kedai ABC"
    )
    assert got == {"who": "Kedai ABC"}
    # Other wording, a number that became words, a value that swallows a sentence: the model.
    assert routines.by_pattern(ex, slots, "Please total 700 and 45 for me") is None
    assert routines.by_pattern(ex, slots, "Add up the invoices: seven hundred and 45") is None
    long = "Send the statement to Kedai ABC and also chase every unpaid invoice from last year"
    assert routines.by_pattern("Send the statement to Syarikat Maju", named, long) is None
    # A value that shows up twice in the example: which one changed is a guess.
    assert (
        routines.by_pattern("Pay 300 of 300", [{"name": "a", "example": "300"}], "Pay 1 of 2")
        is None
    )


SEARCH = (
    "Page: Carian | https://good.fake/carian;jsessionid=AB12?x=1\nElements (view 1):\n"
    '<<<page\n- form "Carian" [e2]\n  - textbox "Nombor rujukan" [e3]\n'
    '  - button "Cari" [e4]\npage>>>'
)
RESULT = "Page: Keputusan | https://good.fake/keputusan\nPage text:\nStatus: Lulus"


def test_browser_steps_are_kept_by_element_name_and_page():
    calls = [
        routines.Call("browser_open", {"url": "https://good.fake/carian"}, SEARCH),
        routines.Call("browser_type", {"ref": "e3", "text": "QT-2026-0012"}, SEARCH),
        routines.Call("browser_click", {"ref": "e4"}, RESULT),
    ]
    slots = [{"name": "ref_no", "example": "QT-2026-0012"}]
    steps = [
        {"tool": "browser_open", "args": {"url": "https://good.fake/carian"}},
        {"tool": "browser_type", "args": {"ref": "e3", "text": "{{ref_no}}"}},
        {"tool": "browser_click", "args": {"ref": "e4"}},
    ]
    text = "Check the status of QT-2026-0012 on the portal"
    assert (
        routines.check(text, calls, "x", slots, steps, {"mode": "compose", "text": "Say it."})
        is None
    )
    located, why = routines.locate(steps, calls, slots)
    assert why is None
    assert located[1]["args"]["ref"] == {"$el": {"role": "textbox", "name": "Nombor rujukan"}}
    assert located[2]["args"] == {"ref": {"$el": {"role": "button", "name": "Cari"}}}
    assert located[0]["expect"] == "good.fake/carian"  # no session id, no query
    assert located[2]["expect"] == "good.fake/keputusan"
    # A ref the page never named cannot be found again: not a routine.
    _, why = routines.locate(
        steps,
        [calls[0], routines.Call("browser_type", {"ref": "e9", "text": "x"}, ""), calls[2]],
        slots,
    )
    assert why and "cannot be found again" in why
    # Found again only when exactly one element has that role and name.
    seen = '- button "Cari" [e14]\n- link "Cari" [e15]'
    assert routines.found_ref(seen, "button", "Cari") == "e14"
    assert (
        routines.found_ref('- button "Cari" [e1]\n- button "Cari" [e2]', "button", "Cari") is None
    )
    # A run done the same way on a new page (new refs) still confirms it.
    r = Routine(steps=located)
    again = [
        routines.Call(
            "browser_open", {"url": "https://good.fake/carian"}, SEARCH.replace("e3", "e33")
        ),
        routines.Call("browser_type", {"ref": "e33", "text": "QT-2026-0099"}, SEARCH),
        routines.Call("browser_click", {"ref": "e4"}, RESULT),
    ]
    assert routines.confirms(r, "Check the status of QT-2026-0099 on the portal", again)
    assert not routines.confirms(
        r,
        "Check the status of QT-2026-0099 on the portal",
        again[:1]
        + [routines.Call("browser_type", {"ref": "e2", "text": "QT-2026-0099"}, SEARCH), again[2]],
    )


def test_answer_reuse_rules():
    assert answers.may_reuse("How do I claim mileage for a site visit?", True, False, True)
    assert not answers.may_reuse("How do I claim mileage for a site visit?", False, False, True)
    assert not answers.may_reuse("What is on the roster today?", True, False, True)
    assert not answers.may_reuse("Apa tender terkini?", True, False, True)
    assert not answers.may_reuse("How do I claim mileage?", True, True, True)  # a lesson
    assert not answers.may_reuse("How do I claim mileage?", True, False, False)  # switched off
    m = [{"role": "user", "content": "q"}]
    assert answers.key("w", "a", "u1", "smart", m, None) != answers.key(
        "w", "a", "u2", "smart", m, None
    )


# ---------------------------------------------------------------- the browser, replayed


class FakeBrowser:
    """A tiny site: a search form and its result. Refs change between sessions, as they do."""

    def __init__(self) -> None:
        self.session = 0
        self.calls: list[tuple[str, dict]] = []
        self.button = "Cari"

    def refs(self) -> tuple[str, str]:
        base = 3 + 10 * self.session
        return f"e{base}", f"e{base + 1}"

    def page(self) -> str:
        box, btn = self.refs()
        return (
            "Page: Carian | https://good.fake/carian\nElements (view 1):\n"
            f'- textbox "Nombor rujukan" [{box}]\n- button "{self.button}" [{btn}]'
        )

    async def run(self, ctx, name: str, args: dict) -> str:
        self.calls.append((name, args))
        box, btn = self.refs()
        if name == "browser_open":
            return self.page()
        if name == "browser_find":
            hits = [ln for ln in self.page().splitlines() if f'"{args.get("label")}"' in ln]
            return f"{len(hits)} match(es) on https://good.fake/carian:\n" + "\n".join(hits)
        if name == "browser_type":
            assert args["ref"] == box, args
            return self.page()
        if name == "browser_click":
            assert args["ref"] == btn, args
            return "Page: Keputusan | https://good.fake/keputusan\nStatus: Lulus"
        return f"Error: {name} is not on this fake"


BROWSER_TOOLS = {
    t: "allow"
    for t in ("browser_open", "browser_find", "browser_type", "browser_click", "browser_snapshot")
}


async def _browser_routine(client, llm, monkeypatch) -> tuple[dict, dict, FakeBrowser, str]:
    o = await office(client)
    await fast_group(client, o)
    agent = await new_agent(client, o, "Rina", tools=BROWSER_TOOLS)
    site = FakeBrowser()
    monkeypatch.setattr(runtime, "run_tool", site.run)
    a = await new_task(
        client, agent, "Tender status", "Check the status of QT-2026-0012 on the portal"
    )
    llm.call("browser_open", url="https://good.fake/carian")
    llm.call("browser_type", ref="e3", text="QT-2026-0012")
    llm.call("browser_click", ref="e4")
    llm.say("QT-2026-0012: Lulus.")
    assert (await runtime.run_task_step(a["id"])).state == "done"
    first = await _tokens(a["id"])
    await _done(a["id"], "QT-2026-0012: Lulus.")
    llm.say(
        _draft(
            [{"name": "ref_no", "description": "tender number", "example": "QT-2026-0012"}],
            [
                {"tool": "browser_open", "args": {"url": "https://good.fake/carian"}},
                {"tool": "browser_type", "args": {"ref": "e3", "text": "{{ref_no}}"}},
                {"tool": "browser_click", "args": {"ref": "e4"}},
            ],
            {"mode": "template", "text": "{{ref_no}}: Lulus."},
        )
    )
    async with SessionLocal() as db:
        r = await routines.learn(db, a["id"])
        assert r is not None and r.agent_only and r.person_id is not None
        assert "browser_find" in r.tools
        r.status = "active"
        await db.commit()
        rid = r.id
    site.session = 1  # a new day, a new browser: other refs
    return agent, {"first": first, "routine_id": rid}, site, a["id"]


async def test_browser_work_replays_by_element_name_without_the_model(
    client, llm, temporal, loose, monkeypatch
):
    agent, info, site, _ = await _browser_routine(client, llm, monkeypatch)
    b = await new_task(
        client, agent, "Tender status", "Check the status of QT-2026-0099 on the portal"
    )
    sent = len(llm.requests)
    step = await runtime.run_task_step(b["id"])
    assert step.state == "done" and step.message == "QT-2026-0099: Lulus."
    assert len(llm.requests) == sent  # not one model call: values, steps and answer all known
    typed = [a for n, a in site.calls if n == "browser_type"][-1]
    assert typed == {"ref": "e13", "text": "QT-2026-0099"}  # found again by its name
    assert await _tokens(b["id"]) == (0, 0)
    print(f"\nP96 browser job: first run {info['first']}, repeated run (0, 0)")
    async with SessionLocal() as db:
        r = await db.get(Routine, info["routine_id"])
        assert r.uses == 1 and r.failure_streak == 0


async def test_a_page_that_changed_hands_the_browser_job_to_the_agent(
    client, llm, temporal, loose, monkeypatch
):
    agent, _, site, _ = await _browser_routine(client, llm, monkeypatch)
    site.button = "Search"  # the site was redesigned
    b = await new_task(
        client, agent, "Tender status", "Check the status of QT-2026-0099 on the portal"
    )
    llm.say("I looked it up myself: QT-2026-0099 is still open.")
    step = await runtime.run_task_step(b["id"])
    assert step.state == "done" and "myself" in step.message
    stopped = [
        m.content
        for m in await _messages(b["id"])
        if m.role == "user" and "stopped" in (m.content or "")
    ]
    assert stopped and "'Cari'" in stopped[0]
    assert not any(n == "browser_click" for n, _ in site.calls[-3:])  # nothing clicked blind


async def test_a_browser_procedure_never_serves_another_person(
    client, llm, temporal, loose, monkeypatch
):
    agent, _, site, _ = await _browser_routine(client, llm, monkeypatch)
    b = await new_task(
        client, agent, "Tender status", "Check the status of QT-2026-0099 on the portal"
    )
    async with SessionLocal() as db:
        t = await db.get(Task, b["id"])
        t.created_by = "user:somebody-else"
        await db.commit()
    llm.say("Done by the agent.")
    step = await runtime.run_task_step(b["id"])
    assert step.message == "Done by the agent."
    async with SessionLocal() as db:
        assert not (
            await db.scalars(
                select(TaskEvent).where(
                    TaskEvent.task_id == b["id"], TaskEvent.kind == "routine_run"
                )
            )
        ).all()


async def test_a_send_step_in_a_procedure_still_waits_for_a_person(client, llm, temporal, loose):
    o = await office(client)
    agent = await new_agent(client, o, "Rina", tools={**BROWSER_TOOLS, "browser_submit": "allow"})
    owner_id = await _owner()
    text = "Send the quotation form for QT-2026-0012"
    async with SessionLocal() as db:
        db.add(
            Routine(
                workspace_id=(await db.get(Agent, agent["id"])).workspace_id,
                name="Send quotation",
                example=text,
                embedding=await _vec(text),
                steps=[{"tool": "browser_submit", "args": {"why": "send it"}}],
                answer={"mode": "template", "text": "Sent."},
                tools=["browser_submit"],
                status="active",
                agent_id=agent["id"],
                agent_only=True,
                person_id=owner_id,
            )
        )
        await db.commit()
    b = await new_task(client, agent, text, "")
    step = await runtime.run_task_step(b["id"])
    assert step.state == "needs_approval"  # policy.ALWAYS_ASK, even on "allow"
    async with SessionLocal() as db:
        a = await db.get(Approval, step.approval_id)
        assert a.tool_name == "browser_submit" and a.status == "pending"


# ---------------------------------------------------------------- whose brain


async def test_a_persons_own_ai_keeps_what_it_learned_to_itself(client, llm, temporal, loose):
    o = await office(client)
    staff = await staff_in(client, o)
    twin = await twin_of(staff)
    team = await new_agent(client, o, "Aina")
    text = "Work out the guards needed: 4 x 3"
    async with SessionLocal() as db:
        ws = (await db.get(Agent, team["id"])).workspace_id
        db.add(
            Routine(
                workspace_id=ws,
                name="Headcount (Siti's own)",
                example=text,
                embedding=await _vec(text),
                steps=[{"tool": "calc", "args": {"expression": "4 * 3"}}],
                answer={"mode": "template", "text": "12 guards."},
                tools=["calc"],
                status="active",
                agent_id=twin["id"],
                agent_only=True,
                person_id=(await db.get(Agent, twin["id"])).owner_user_id,
            )
        )
        await db.commit()
    t = await new_task(client, team, "Headcount", text)
    llm.say("12 guards (the team agent worked it out).")
    step = await runtime.run_task_step(t["id"])
    assert "team agent" in step.message  # the twin's routine is not the office's

    # And a team agent's work learned by a twin's task never becomes the office's.
    a = await new_task(staff, twin, "Headcount", text)
    llm.call("calc", expression="4 * 3").say("12 guards.")
    async with SessionLocal() as db:
        await db.execute(Routine.__table__.delete())
        await db.commit()
    assert (await runtime.run_task_step(a["id"])).state == "done"
    await _done(a["id"], "12 guards.")
    llm.say(
        _draft(
            [],
            [{"tool": "calc", "args": {"expression": "4 * 3"}}],
            {"mode": "template", "text": "12 guards."},
        )
    )
    async with SessionLocal() as db:
        r = await routines.learn(db, a["id"])
        assert r is not None and r.agent_only and r.agent_id == twin["id"]
        assert r.person_id == (await db.get(Agent, twin["id"])).owner_user_id


# ---------------------------------------------------------------- corrections and freshness


async def _calc_routine(client, topic_label: str | None = None) -> tuple[dict, str, str]:
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    text = "Work out the guards needed: 4 x 3"
    async with SessionLocal() as db:
        r = Routine(
            workspace_id=(await db.get(Agent, agent["id"])).workspace_id,
            name="Headcount",
            example=text,
            embedding=await _vec(text),
            steps=[{"tool": "calc", "args": {"expression": "4 * 3"}}],
            answer={"mode": "template", "text": "12 guards are needed."},
            tools=["calc"],
            status="active",
            checked_at=datetime.now(UTC) - timedelta(days=3),
        )
        db.add(r)
        await db.commit()
        rid = r.id
    return agent, rid, text


async def test_a_correction_on_a_procedures_work_pauses_it(client, llm, temporal, loose):
    agent, rid, text = await _calc_routine(client)
    t = await new_task(client, agent, "Daily headcount", text)
    step = await runtime.run_task_step(t["id"])
    assert step.message == "12 guards are needed."
    owner = await _owner()
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        task = await db.get(Task, t["id"])
        noted = await brain_lessons.capture(
            db,
            a,
            "Always add one relief guard per site.",
            via="send_back",
            taught_by=f"user:{owner}",
            task=task,
        )
        assert noted is not None
        r = await db.get(Routine, rid)
        await db.refresh(r)
        assert r.status == "paused" and "relief guard" in (r.note or "")
    # The next task is done by the agent, with the lesson.
    t2 = await new_task(client, agent, "Daily headcount", text)
    llm.say("13 guards: 12 plus one relief guard.")
    assert "relief" in (await runtime.run_task_step(t2["id"])).message


async def test_a_newer_lesson_on_this_kind_of_work_makes_the_agent_do_it_itself(
    client, llm, temporal, loose
):
    agent, rid, _ = await _calc_routine(client)
    text = "ePerolehan: work out the guards needed: 4 x 3"
    async with SessionLocal() as db:
        r = await db.get(Routine, rid)
        r.example, r.embedding = text, await _vec(text)
        a = await db.get(Agent, agent["id"])
        db.add(
            BrainFact(
                workspace_id=a.workspace_id,
                branch_id=a.branch_id,
                text="Count the relief guard too.",
                source_kind=brain_lessons.KIND,
                created_by="user:x",
                confidence=0.95,
                valid_from=datetime.now(UTC),
                created_at=datetime.now(UTC),
                meta={
                    "topic": brain_lessons.EPEROLEHAN,
                    "last_taught_at": datetime.now(UTC).isoformat(),
                },
            )
        )
        await db.commit()
    t = await new_task(client, agent, "Headcount", text)
    llm.say("13 with the relief guard.")
    assert "relief" in (await runtime.run_task_step(t["id"])).message
    # Once people accept the job done the routine's way again, it is up to date.
    async with SessionLocal() as db:
        r = await db.get(Routine, rid)
        r.source_task_ids = [t["id"]]
        await db.commit()
        await routines.settle(db, t["id"], "accepted")
        await db.refresh(r)
        assert r.checked_at > datetime.now(UTC) - timedelta(minutes=1)
        a = await db.get(Agent, agent["id"])
        task = await db.get(Task, t["id"])
        assert not await routines.stale(db, a, task, r)


# ---------------------------------------------------------------- switch, forget, numbers


async def test_replay_is_switched_off_per_agent_and_a_procedure_forgotten(
    client, llm, temporal, loose
):
    agent, rid, text = await _calc_routine(client)
    staff = await staff_in(client, await _office_of(agent))
    # Staff do not reach an office agent's switch (they do not see it); they do their own AI's.
    r = await staff.put(
        f"/api/procedures/agents/{agent['id']}", json={"replay": False}, headers=csrf(staff)
    )
    assert r.status_code == 404, r.text
    twin = await twin_of(staff)
    r = await staff.put(
        f"/api/procedures/agents/{twin['id']}", json={"replay": False}, headers=csrf(staff)
    )
    assert r.status_code == 200, r.text
    assert (await staff.get(f"/api/procedures/agents/{twin['id']}")).json()["replay"] is False
    r = await client.put(
        f"/api/procedures/agents/{agent['id']}", json={"replay": False}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    t = await new_task(client, agent, "Daily headcount", text)
    llm.say("12, worked out by the agent.")
    assert "by the agent" in (await runtime.run_task_step(t["id"])).message
    # The office switch keeps the per-agent one.
    await client.put("/api/routines/settings", json={"enabled": True}, headers=csrf(client))
    d = (await client.get(f"/api/procedures/agents/{agent['id']}")).json()
    assert d["replay"] is False and d["office_on"] is True and d["can_manage"] is True
    await client.put(
        f"/api/procedures/agents/{agent['id']}", json={"replay": True}, headers=csrf(client)
    )
    t2 = await new_task(client, agent, "Daily headcount", text)
    assert (await runtime.run_task_step(t2["id"])).message == "12 guards are needed."
    d = (await client.get(f"/api/procedures/agents/{agent['id']}")).json()
    assert d["replays"] == 1 and [i["id"] for i in d["items"]] == [rid]
    assert d["items"][0]["can_forget"] is True
    s = (await client.get("/api/procedures/summary")).json()
    assert any(row["agent_id"] == agent["id"] and row["replays"] == 1 for row in s)
    # Someone who sees the agent but does not manage routines cannot forget it; a manager can.
    hr = await as_role(client, "sup@example.com", "supervisor", **await _place(agent))
    r = await hr.delete(
        f"/api/procedures/{rid}?agent_id={agent['id']}",
        headers={"content-type": "application/json", **csrf(hr)},
    )
    assert r.status_code in (403, 404), r.text
    r = await client.delete(
        f"/api/procedures/{rid}?agent_id={agent['id']}",
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 204, r.text
    async with SessionLocal() as db:
        assert await db.get(Routine, rid) is None


async def test_the_same_first_question_is_answered_from_what_the_agent_said(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    q = "How do I claim mileage for a site visit?"
    llm.say("Fill in form K-3 with the distance and attach the parking receipt.")
    first = await chat(client, agent["id"], q)
    sent = len(llm.requests)
    tokens_first = llm.requests[-1]
    again = await chat(client, agent["id"], q)  # a new conversation, same question
    assert again == first and len(llm.requests) == sent  # no model call
    stats = (await client.get(f"/api/procedures/agents/{agent['id']}")).json()
    assert stats["answers_reused"] == 1 and stats["answer_tokens_saved"] > 1000
    print(f"\nP96 chat answer: first {len(json.dumps(tokens_first)) // 4} tokens, repeat 0")
    # Another person asks the same: their own model call.
    other = await as_role(client, "hr@example.com", "hr")
    llm.say("Use form K-3.")
    assert await chat(other, agent["id"], q) == "Use form K-3."
    # A question about now is always asked again.
    llm.say("Nothing is due today.").say("Still nothing due today.")
    await chat(client, agent["id"], "What claims are due today?")
    assert (
        await chat(client, agent["id"], "What claims are due today?") == "Still nothing due today."
    )
    # Switched off for the agent: asked again.
    await client.put(
        f"/api/procedures/agents/{agent['id']}", json={"replay": False}, headers=csrf(client)
    )
    llm.say("Form K-3, as before.")
    assert await chat(client, agent["id"], q) == "Form K-3, as before."


async def test_tokens_first_run_against_a_learned_repeat(client, llm, temporal, loose):
    """The measurement in the report: a job the agent does with its tools the first time, then
    the same job again once learned."""
    o = await office(client)
    await fast_group(client, o)
    agent = await new_agent(client, o, "Aina")
    brief = "Add up this month's supplier invoices for the finance report: 1250 and 300"
    a = await new_task(client, agent, "Invoices total", brief)
    llm.call("calc", expression="1250 + 300").say("The total is RM 1550.")
    assert (await runtime.run_task_step(a["id"])).state == "done"
    first_calls, first = await _tokens(a["id"])
    await _done(a["id"], "The total is RM 1550.")
    llm.say(
        _draft(
            [{"name": "a", "example": "1250"}, {"name": "b", "example": "300"}],
            [{"tool": "calc", "args": {"expression": "{{a}} + {{b}}"}}],
            {"mode": "compose", "text": "Say the total in ringgit in one sentence."},
        )
    )
    async with SessionLocal() as db:
        r = await routines.learn(db, a["id"])
        r.status = "active"
        await db.commit()
    b = await new_task(
        client, agent, "Invoices total", brief.replace("1250", "700").replace("300", "45")
    )
    llm.say("The total is RM 745.")
    assert (await runtime.run_task_step(b["id"])).message == "The total is RM 745."
    calls, repeat = await _tokens(b["id"])
    print(
        f"\nP96 tool job: first run {first_calls} calls / {first} tokens; repeat {calls} / {repeat}"
    )
    assert first_calls == 2 and calls == 1  # only the cheap write-up
    assert repeat * 10 < first  # under a tenth of the first run
