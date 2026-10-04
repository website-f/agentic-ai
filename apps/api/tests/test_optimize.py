"""P18 skill optimizer: reflective rewrites tested old vs new; only a better variant becomes a
proposal, and cases are drafted from accepted work when a skill has too few."""

import json

import httpx
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import Skill, SkillEvalCase, SkillProposal, Workspace
from agentic.skills import optimize

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_skills import BODY

BETTER = BODY.replace(
    "3. List unmatched lines.", "3. List unmatched lines.\n4. Say which line is the cheapest."
)


async def _skill_with_cases(client: httpx.AsyncClient, n: int) -> str:
    o = await office(client)
    await new_agent(client, o, "Aina")
    skills = (await client.get("/api/skills")).json()
    sid = next(s["id"] for s in skills if s["name"] == "compare-quotes")
    for i in range(n):
        r = await client.post(
            f"/api/skills/{sid}/cases",
            json={
                "title": f"case {i}",
                "input": f"Quotes {i}: A 10, B 8",
                "must_contain": ["cheapest"],
            },
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    return sid


async def test_a_better_variant_is_proposed_and_goes_live(client, llm, temporal):
    sid = await _skill_with_cases(client, 2)
    llm.say("Here are the quotes.").say("Done.")  # baseline: 0/2
    llm.say(json.dumps({"diagnosis": "It never says which is cheapest.", "body": BETTER}))
    llm.say("The cheapest is B.").say("B is the cheapest.")  # variant: 2/2
    async with SessionLocal() as db:
        skill = await db.get(Skill, sid)
        ws = await db.get(Workspace, skill.workspace_id) if skill else None
        assert skill is not None and ws is not None
        out = await optimize.optimize(db, ws, skill)
    assert out.baseline["passed"] == 0 and out.best and out.best["passed"] == 2
    assert out.status == "approved"  # auto_safe: no worse than the live text
    sent = [r["messages"][-1]["content"] for r in llm.requests]
    reflect = next(c for c in sent if "RESULTS (0/2 passed)" in c)
    assert "FAIL: missing" in reflect
    async with SessionLocal() as db:
        p = await db.scalar(select(SkillProposal).where(SkillProposal.proposed_by == "optimizer"))
        skill = await db.get(Skill, sid)
    assert p is not None and p.reason.startswith("Optimizer: 0/2 -> 2/2")
    assert skill is not None and "cheapest" in skill.body and skill.version == 2


async def test_no_better_variant_means_no_proposal(client, llm, temporal):
    sid = await _skill_with_cases(client, 2)
    llm.say("The cheapest is B.").say("Cheapest: B")  # baseline already 2/2
    async with SessionLocal() as db:
        skill = await db.get(Skill, sid)
        ws = await db.get(Workspace, skill.workspace_id) if skill else None
        assert skill is not None and ws is not None
        out = await optimize.optimize(db, ws, skill)
        assert out.proposal_id is None and "No variant beat" in out.note
        assert await db.scalar(select(SkillProposal)) is None


async def test_cases_are_drafted_when_a_skill_has_too_few(client, llm, temporal):
    sid = await _skill_with_cases(client, 0)
    drafted = {"cases": [{"title": "two quotes", "input": "A 5, B 7", "must_contain": ["A"]}]}
    llm.say(json.dumps(drafted))
    async with SessionLocal() as db:
        skill = await db.get(Skill, sid)
        assert skill is not None
        cases = await optimize.draft_cases(db, skill)
        saved = (await db.scalars(select(SkillEvalCase).where(SkillEvalCase.skill_id == sid))).all()
    assert [c["title"] for c in cases] == ["two quotes"]
    assert len(saved) == 1 and saved[0].created_by == "optimizer"


async def test_optimize_endpoint_starts_the_job(client, llm, temporal):
    sid = await _skill_with_cases(client, 2)
    r = await client.post(f"/api/skills/{sid}/optimize", json={}, headers=csrf(client))
    assert r.status_code == 202 and temporal["skill_eval"] == [("optimize", sid)]
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        skill = await db.get(Skill, sid)
        assert skill is not None
        skill.last_eval = {"passed": 1, "total": 2}
        await db.commit()
        pick = await optimize.nightly_pick(db, ws)
    assert pick is not None and pick.id == sid
