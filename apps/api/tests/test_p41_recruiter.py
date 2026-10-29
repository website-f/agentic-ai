"""P41: the Recruiter researches a job and drafts the blueprint for an agent that does it."""

from sqlalchemy import select

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import SOP, Agent, Blueprint, SkillProposal, Task

from .conftest import csrf
from .test_agents import ScriptedLLM, llm, office, temporal  # noqa: F401


def _call(llm: ScriptedLLM, **args):
    """The model calls draft_blueprint (ScriptedLLM.call takes `name` itself)."""
    import json

    n = len(llm.replies) + 1
    llm.replies.append(
        {
            "content": None,
            "tool_calls": [
                {
                    "id": f"call_{n}",
                    "type": "function",
                    "function": {"name": "draft_blueprint", "arguments": json.dumps(args)},
                }
            ],
        }
    )
    return llm


SOUL = (
    "You are the purchasing officer of a construction company in Malaysia. "
    "## Raise a purchase request\n1. Check the budget line.\n2. Get three quotations.\n"
    "## Compare quotations\n1. Same specification.\n2. Lowest compliant price wins.\n"
    "Ask a person before any order above RM 5,000. Never pay a supplier yourself. "
) * 2


async def test_the_recruiter_researches_and_drafts_a_blueprint(client, llm, temporal):
    o = await office(client)
    r = await client.post(
        "/api/blueprints/recruit",
        json={"role": "Purchasing officer", "notes": "We buy cement and steel weekly."},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["task_id"]
    async with SessionLocal() as db:
        t = await db.get(Task, task_id)
        rec = await db.get(Agent, t.assignee_agent_id)
        assert rec.template == "recruiter" and rec.tools["draft_blueprint"] == "allow"
        assert "Purchasing officer" in t.title and "cement and steel" in t.brief
        assert rec.branch_id == o["branch"]["id"]
    # A second recruit reuses the same Recruiter.
    r2 = await client.post(
        "/api/blueprints/recruit", json={"role": "Quantity surveyor"}, headers=csrf(client)
    )
    assert r2.json()["agent_id"] == r.json()["agent_id"]

    _call(
        llm,
        name="Purchasing Officer",
        role="Purchasing Officer",
        description="Buys materials at the right price and time.",
        instructions=SOUL,
        tools={
            "web_search": "allow",
            "email_draft": "allow",  # outward: lowered to ask
            "browser_submit": "allow",  # high risk: lowered to ask
            "made_up_tool": "allow",  # unknown: dropped
            "draft_blueprint": "allow",  # never passed on
        },
        model_group="smart",
        skills=[
            {
                "name": "compare-three-quotations",
                "description": "Compare three supplier quotations on like-for-like terms.",
                "body": (
                    "## When to use\nThree quotes in.\n\n## Steps\n1. Same spec.\n2. Lowest wins.\n"
                ),
            }
        ],
        sops=[{"title": "Purchase request", "body": "1. Budget line\n2. Three quotations"}],
        sources=["https://www.cidb.gov.my/"],
    ).say("Drafted the Purchasing Officer blueprint from CIDB guidance and the company SOPs.")
    step = await runtime.run_task_step(task_id)
    assert step.state == "done", step
    async with SessionLocal() as db:
        bp = (await db.scalars(select(Blueprint))).one()
        assert bp.source == "analyst" and bp.role == "Purchasing Officer"
        assert bp.tools == {"web_search": "allow", "email_draft": "ask", "browser_submit": "ask"}
        assert "Sources the Recruiter used" in bp.soul and "cidb.gov.my" in bp.soul
        sop = (await db.scalars(select(SOP))).one()
        assert sop.status == "draft" and bp.sop_ids == [sop.id]
        p = (await db.scalars(select(SkillProposal))).one()
        assert p.name == "compare-three-quotations" and p.status == "pending"
    # The owner sees it with the analyst mark and can apply it like any blueprint.
    listed = (await client.get("/api/blueprints")).json()
    # P55: beside the premade roles (source "builtin").
    assert [b["source"] for b in listed if b["role"] == "Purchasing Officer"] == ["analyst"]


async def test_a_thin_blueprint_is_refused(client, llm, temporal):
    await office(client)
    r = await client.post("/api/blueprints/recruit", json={"role": "Clerk"}, headers=csrf(client))
    task_id = r.json()["task_id"]
    _call(llm, name="Clerk", role="Clerk", instructions="Do clerk things.", tools={}).say("done")
    await runtime.run_task_step(task_id)
    async with SessionLocal() as db:
        assert (await db.scalars(select(Blueprint))).first() is None
        tool = next(m for m in (await db.scalars(select(Task))).all() if m.id == task_id)
        assert tool is not None
