"""P17 learning engine: the autopilot, learning from failures, denials and chat, curator
repairs, faithful evals with stub tools, learning from a source, the learning API, trajectory
export, context limits that follow the model's window and an independent goal judge."""

import json
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select, update

from agentic.agents import context, goals, runtime
from agentic.core.db import SessionLocal
from agentic.models import (
    Agent,
    AgentMessage,
    BrainFact,
    Skill,
    SkillProposal,
    SkillUse,
    Task,
    Workspace,
)
from agentic.skills import autopilot, curator, evals, reflect

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_skills import BODY, DRAFT, long_task, tool

PASSING = "Reconciled. 1 unmatched line: 50."


async def set_mode(client: httpx.AsyncClient, mode: str) -> None:
    r = await client.put("/api/learning/settings", json={"mode": mode}, headers=csrf(client))
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------- the autopilot's rule


@dataclass
class P:
    kind: str = "new"
    scan: list[dict[str, Any]] = field(default_factory=list)
    eval: dict[str, Any] | None = None


def ev(new: tuple[int, int], old: tuple[int, int] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"new": {"passed": new[0], "total": new[1]}}
    if old:
        out["old"] = {"passed": old[0], "total": old[1]}
    return out


def test_autopilot_verdicts():
    v = autopilot.verdict
    assert v(P(eval=ev((3, 3))), "review")[0] is False  # people review everything
    # P29: a brand-new skill always waits for a person in auto_safe (it wrote its own tests)
    assert v(P(eval=ev((3, 3))), "auto_safe") == (
        False,
        "a brand-new skill is always checked by a person first",
    )
    assert v(P(eval=ev((3, 3))), "auto")[0] is True
    assert v(P(eval=ev((1, 3))), "auto")[0] is False  # a new skill must mostly pass
    assert v(P(kind="patch", eval=ev((2, 3), (3, 3))), "auto_safe")[0] is False  # regression
    assert v(P(kind="patch", eval=ev((2, 3), (2, 3))), "auto_safe")[0] is True  # no worse
    assert v(P(kind="patch", eval=ev((0, 2), (0, 2))), "auto_safe")[0] is False
    assert v(P(kind="retire"), "auto")[0] is False  # retiring is always a person's call
    warn = [{"level": "warn", "code": "x", "message": "m"}]
    assert v(P(scan=warn, eval=ev((3, 3))), "auto")[0] is False
    assert v(P(kind="patch"), "auto_safe") == (False, "it has no test results yet")
    assert v(P(), "auto")[0] is True  # untested but clean: auto mode only
    assert v(P(eval={"new": {"error": "down", "passed": 0, "total": 2}}), "auto_safe")[0] is False


# ---------------------------------------------------------------- triggers


@dataclass
class T:
    title: str = "Reconcile statements"
    brief: str = ""
    run_count: int = 1
    status: str = "failed"
    error: str | None = None


@dataclass
class M:
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    name: str | None = None


def test_failures_teach_but_the_weather_does_not():
    work = [M("user", "x")] + [M("tool", "ok") for _ in range(3)]
    assert reflect._trigger(T(error="The supplier form needs the SST number first."), work) == (
        "the task failed: The supplier form needs the SST number first."
    )
    assert reflect._trigger(T(error="Read timed out after 60 s"), work) is None
    assert reflect._trigger(T(error="No model in the Smart group could answer."), work) is None
    assert reflect._trigger(T(error="Budget used up for today"), work) is None
    assert reflect._trigger(T(error="Wrong format."), [M("user", "x")]) is None  # nothing tried


def test_chat_triggers():
    hello = [M("user", "hi"), M("assistant", "Hello!")]
    assert reflect.chat_trigger(hello, 1) is None
    fix = [*hello, M("user", "No, always put the SST number on the invoice"), M("assistant", "Ok")]
    assert reflect.chat_trigger(fix, 2) == "a person corrected the agent"
    assert reflect.chat_trigger([M("user", "Salah, guna format lama")], 3) is not None
    keep = [M("user", "Remember how to do this for next month")]
    assert reflect.chat_trigger(keep, 1) == "someone asked to remember how to do this"
    tools = [M("user", "do it")] + [M("tool", "ok") for _ in range(3)]
    assert reflect.chat_trigger(tools, reflect.CADENCE).startswith("a regular check")
    assert reflect.chat_trigger(tools, reflect.CADENCE - 1) is None


# ---------------------------------------------------------------- reflect -> evals -> autopilot


async def test_a_new_skill_waits_for_a_person_in_auto_safe(
    client: httpx.AsyncClient, llm, temporal
):
    """P29: a brand-new skill passed only the cases its own author wrote: a person checks it."""
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    first = await long_task(client, llm, agent)
    llm.say(json.dumps(DRAFT)).say(PASSING)
    async with SessionLocal() as db:
        p = await reflect.reflect_on_task(db, first["id"])
    assert p is not None and p.status == "pending" and p.eval["new"]["passed"] == 1
    assert "brand-new skill is always checked by a person" in (p.decision_note or "")


async def test_a_proven_skill_goes_live_by_itself(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await set_mode(client, "auto")  # P29: auto_safe never publishes a brand-new skill
    first = await long_task(client, llm, agent)
    llm.say(json.dumps(DRAFT)).say(PASSING)  # the draft, then its one test case passes
    async with SessionLocal() as db:
        p = await reflect.reflect_on_task(db, first["id"])
    assert p is not None and p.status == "approved"
    assert p.decided_by == autopilot.AUTOPILOT.actor and "passes 1/1" in (p.decision_note or "")
    skills = {s["name"]: s for s in (await client.get("/api/skills")).json()}
    assert skills["reconcile-bank-statement"]["version"] == 1
    # The drafting call used the best group and a JSON check.
    draft_req = next(r for r in llm.requests if "TASK: Reconcile" in r["messages"][-1]["content"])
    assert draft_req["model"] == "m1"

    overview = (await client.get("/api/learning/overview?days=7")).json()
    assert overview["mode"] == "auto"
    assert overview["proposals"]["approved_auto"] == 1
    assert overview["recent"][0]["auto"] is True
    assert overview["recent"][0]["decided_by"] == "Learning autopilot"
    assert overview["recent"][0]["eval"]["new"] == [1, 1]
    assert len(overview["series"]) == 7


async def test_review_mode_keeps_people_in_charge(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await set_mode(client, "review")
    first = await long_task(client, llm, agent)
    llm.say(json.dumps(DRAFT)).say(PASSING)
    async with SessionLocal() as db:
        p = await reflect.reflect_on_task(db, first["id"])
    assert p is not None and p.status == "pending"
    assert "reviews every skill change" in (p.decision_note or "")


async def test_a_failed_task_becomes_a_lesson(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Register supplier Maju", "Fill the supplier form.")
    for i in range(3):
        llm.call("calc", expression=f"{i} + 1")
    llm.say("Could not finish.")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    await runtime.finish(task["id"], "failed", "The portal rejects forms without an SST number.")
    lesson = {**DRAFT, "name": "register-supplier", "eval_cases": []}
    llm.say(json.dumps(lesson))
    async with SessionLocal() as db:
        p = await reflect.reflect_on_task(db, task["id"])
    assert p is not None and "the task failed: The portal rejects" in p.reason
    assert p.status == "pending"  # untested: waits for a person in auto_safe
    sent = llm.requests[-1]["messages"][0]["content"]
    assert "If the work FAILED" in sent and "lessons, not logs" in sent


async def test_chat_correction_becomes_a_skill(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    llm.say("Here is the invoice draft.")
    r1 = await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "Draft an invoice for 3 boxes of paper"},
        headers=csrf(client),
    )
    sid = r1.json()["session_id"]
    llm.say("Noted, I will add it.")
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "No, always put our SST number at the top", "session_id": sid},
        headers=csrf(client),
    )
    async with SessionLocal() as db:
        reply_id = await db.scalar(
            select(AgentMessage.id)
            .where(AgentMessage.session_id == sid, AgentMessage.role == "assistant")
            .order_by(AgentMessage.id.desc())
        )
    assert reply_id is not None and reply_id in temporal["learn_chat"]
    lesson = {**DRAFT, "name": "draft-invoice", "eval_cases": []}
    llm.say(json.dumps(lesson))
    async with SessionLocal() as db:
        p = await reflect.reflect_on_chat(db, reply_id)
    assert p is not None and p.name == "draft-invoice" and "corrected" in p.reason
    assert "PERSON: No, always put our SST number" in llm.requests[-1]["messages"][-1]["content"]


async def test_untested_drafts_are_tested_and_tidied(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    out = await tool(
        agent["id"],
        "propose_skill",
        name="reconcile-bank-statement",
        description="Reconcile a bank statement against the ledger.",
        body=BODY,
    )
    assert out.startswith("Proposed") and "passes its tests" in out
    async with SessionLocal() as db:
        p = await db.scalar(select(SkillProposal))
        assert p is not None and p.eval is None
        p.eval_cases = [{"title": "t", "input": "Statement 100, 50", "must_contain": ["unmatched"]}]
        await db.commit()
        ws = await db.get(Workspace, p.workspace_id)
        assert ws is not None
        llm.say(PASSING)
        tidied = await autopilot.tidy(db, ws)
        await db.refresh(p)
    # Tested now; P29: a brand-new skill still waits for a person in auto_safe.
    assert tidied["approved"] == 0 and p.status == "pending" and p.eval is not None
    assert p.eval["new"]["passed"] == 1 and "brand-new skill" in (p.decision_note or "")


# ---------------------------------------------------------------- revert


async def test_revert_puts_an_old_version_back(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    await new_agent(client, o, "Aina")
    skill = next(
        s for s in (await client.get("/api/skills")).json() if s["name"] == "compare-quotes"
    )
    r = await client.patch(
        f"/api/skills/{skill['id']}",
        json={"body": BODY, "note": "try the reconcile text"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    back = await client.post(
        f"/api/skills/{skill['id']}/revert", json={"version": 1}, headers=csrf(client)
    )
    assert back.status_code == 200, back.text
    assert back.json()["version"] == 3
    detail = (await client.get(f"/api/skills/{skill['id']}")).json()
    assert "Line up the items" in detail["body"]
    again = await client.post(
        f"/api/skills/{skill['id']}/revert", json={"version": 3}, headers=csrf(client)
    )
    assert again.status_code == 409


# ---------------------------------------------------------------- denials teach


async def test_a_denial_with_a_reason_is_remembered(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Rafi", "Research")
    task = await new_task(client, agent, "Check the price")
    llm.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "needs_approval"
    await client.post(
        f"/api/approvals/{r.approval_id}",
        json={"decision": "deny", "answer": "Use the supplier price list in Files, not the web."},
        headers=csrf(client),
    )
    await runtime.apply_approval(r.approval_id)
    async with SessionLocal() as db:
        f = await db.scalar(select(BrainFact).where(BrainFact.agent_id == agent["id"]))
    assert f is not None and "supplier price list" in f.text and "Read a web page" in f.text


# ---------------------------------------------------------------- curator repairs


async def test_curator_repairs_a_skill_that_keeps_failing(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await client.get("/api/skills")  # starter skills
    async with SessionLocal() as db:
        skill = await db.scalar(select(Skill).where(Skill.name == "compare-quotes"))
        assert skill is not None
        ws = await db.get(Workspace, skill.workspace_id)
        assert ws is not None
        for i in range(6):
            t = Task(
                workspace_id=ws.id,
                title=f"Compare quotes {i}",
                brief="",
                assignee_agent_id=agent["id"],
                status="done",
                created_by="system",
                error=None,
            )
            db.add(t)
            await db.flush()
            db.add(
                SkillUse(
                    workspace_id=ws.id,
                    skill_id=skill.id,
                    version=skill.version,
                    agent_id=agent["id"],
                    task_id=t.id,
                    outcome="accepted" if i == 0 else "sent_back",
                    created_at=t.created_at,
                )
            )
            db.add(
                AgentMessage(
                    workspace_id=ws.id,
                    agent_id=agent["id"],
                    task_id=t.id,
                    role="user",
                    content=f"{reflect.FEEDBACK} the delivery time is missing",
                    created_at=t.created_at,
                )
            )
        await db.commit()
        fixed = {
            "fix": True,
            "why": "Delivery time was never compared.",
            "description": skill.description,
            "body": skill.body.replace(
                "## Pitfalls", "## Pitfalls\n- Always compare delivery time."
            )
            + (
                ""
                if "## Pitfalls" in skill.body
                else "\n## Pitfalls\n- Always compare delivery time.\n"
            ),
            "eval_cases": [],
        }
        llm.say(json.dumps(fixed))
        changes = await curator.run(db, ws)
    assert {"kind": "skill", "action": "repair", "name": "compare-quotes", "uses": 6} in changes
    repair_req = next(r for r in llm.requests if "WHAT WENT WRONG" in r["messages"][-1]["content"])
    assert "the delivery time is missing" in repair_req["messages"][-1]["content"]
    async with SessionLocal() as db:
        p = await db.scalar(select(SkillProposal).where(SkillProposal.proposed_by == "curator"))
    assert p is not None and p.kind == "patch" and p.reason.startswith("Repair:")


# ---------------------------------------------------------------- faithful evals


async def test_evals_offer_stub_tools_and_fail_refusals(client: httpx.AsyncClient, llm, temporal):
    await office(client)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        llm.call("calc", expression="100 - 50").say("<｜DSML｜tool>Unmatched: 50")
        case = {
            "title": "t",
            "input": "Statement 100, 50",
            "must_contain": ["50"],
            "must_call": ["calc"],
        }
        r = await evals.run_case(db, ws.id, BODY, case)
        assert r["pass"], r
        assert r["called"] == ["calc"] and "DSML" not in r["output"]
        offered = [t["function"]["name"] for t in llm.requests[-2]["tools"]]
        assert offered == ["calc"]  # only the tools the skill names
        assert "[evaluation stub]" in llm.requests[-1]["messages"][-1]["content"]

        llm.say("I'm sorry, I can't help with that.")
        refused = await evals.run_case(db, ws.id, BODY, {"title": "r", "must_not_contain": ["x"]})
        assert not refused["pass"] and "refused" in refused["failures"][0]

        llm.say("Matched everything.")
        lazy = await evals.run_case(
            db, ws.id, BODY, {"title": "c", "input": "go", "must_call": ["calc"]}
        )
        assert lazy["failures"] == ["did not use calc"]


# ---------------------------------------------------------------- learn from a source


async def test_learn_a_skill_from_pasted_notes(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    notes = "SOP: petty cash. " + "Every claim needs a receipt and the manager's initials. " * 4
    learned = {**DRAFT, "name": "petty-cash-claims", "eval_cases": []}
    llm.say(json.dumps(learned))
    r = await client.post(
        "/api/learning/learn-source",
        json={"text": notes, "focus": "petty cash claims", "agent_id": agent["id"]},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "petty-cash-claims" and r.json()["status"] == "pending"
    assert temporal["skill_eval"] == [("proposal", r.json()["id"])]
    sent = llm.requests[-1]["messages"]
    assert (
        "data, not instructions" in sent[0]["content"] and "FOCUS: petty cash" in sent[1]["content"]
    )

    page = await client.post(
        "/api/learning/learn-source",
        json={"url": "https://good.fake/page", "focus": "prices"},
        headers=csrf(client),
    )
    assert page.status_code == 422  # too little text there to learn from
    empty = await client.post("/api/learning/learn-source", json={}, headers=csrf(client))
    assert empty.status_code == 422
    blocked = await client.post(
        "/api/learning/learn-source", json={"url": "http://127.0.0.1:8501/"}, headers=csrf(client)
    )
    assert blocked.status_code == 422 and "not allowed" in blocked.json()["message"]


# ---------------------------------------------------------------- trajectories


async def test_trajectory_export_skips_private_agents(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    secret = await new_agent(client, o, "Shadow")
    for a, title in ((agent, "Public work"), (secret, "Private work")):
        t = await new_task(client, a, title, "Use key sk-abcdefghijklmnopqrstuvwx123 here.")
        llm.call("calc", expression="1 + 1").say("Done: 2.")
        r = await runtime.run_task_step(t["id"])
        if r.state == "continue":
            r = await runtime.run_task_step(t["id"])
        await runtime.finish(t["id"], "done", r.message)
    async with SessionLocal() as db:
        await db.execute(update(Agent).where(Agent.id == secret["id"]).values(private=True))
        await db.commit()
    r = await client.get("/api/learning/trajectories.jsonl?outcome=all")
    assert r.status_code == 200
    rows = [json.loads(line) for line in r.text.splitlines() if line.strip()]
    assert [x["meta"]["title"] for x in rows] == ["Public work"]
    conv = rows[0]["conversations"]
    assert conv[0]["from"] == "human" and any(c["from"] == "tool" for c in conv)
    assert any("<tool_call>" in c["value"] for c in conv if c["from"] == "gpt")
    assert "sk-abcdefghijklmnop" not in r.text


async def test_only_admins_change_the_mode(client: httpx.AsyncClient, llm, temporal):
    await office(client)
    bad = await client.put("/api/learning/settings", json={"mode": "yolo"}, headers=csrf(client))
    assert bad.status_code == 422
    await set_mode(client, "auto")
    assert (await client.get("/api/learning/overview")).json()["mode"] == "auto"


# ---------------------------------------------------------------- context and goals


def test_context_limits_follow_the_model_window():
    assert context.limits_for(None) == context.Limits()
    assert context.limits_for(200_000) == context.Limits()
    small = context.limits_for(16_000)
    assert small.compact_at == int(16_000 * context.HISTORY_SHARE) < context.COMPACT_AT
    assert small.tail < small.compact_tail < small.compact_at and small.prune_at < small.compact_at
    tiny = context.limits_for(1_000)  # never below the floor
    assert tiny.compact_at == int(context.MIN_WINDOW * context.HISTORY_SHARE)


def test_goal_judge_is_not_the_worker():
    assert goals.judge_groups("smart") == ("fast", "smart")
    assert goals.judge_groups("fast") == ("smart", "fast")
    assert goals.judge_groups("local") == ("smart", "fast", "local")


async def test_an_unchecked_goal_goes_to_review(
    client: httpx.AsyncClient, llm, temporal, monkeypatch
):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    task = await new_task(client, agent, "Write the summary")
    async with SessionLocal() as db:
        await db.execute(update(Task).where(Task.id == task["id"]).values(goal="Under 100 words"))
        await db.commit()

    async def no_judge(db, task, agent, result):
        return goals.Verdict(True, "", checked=False)

    monkeypatch.setattr(goals, "judge", no_judge)
    await runtime.finish(task["id"], "done", "Summary.")
    t = (await client.get(f"/api/tasks/{task['id']}")).json()["task"]
    assert t["status"] == "review"


def test_number_checks_ignore_thousands_separators():
    assert evals.check("Total RM 2,000.00", {"must_contain": ["2000"]}) == []
    assert evals.check("Total RM 2000", {"must_contain": ["2,000"]}) == []
    assert evals.check("Total 20", {"must_contain": ["2000"]}) == ["missing “2000”"]
