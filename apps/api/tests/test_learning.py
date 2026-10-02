"""P12 learning upgrades (from Hermes Agent): corrections and a regular cadence trigger
reflection, an agent that saved its own skill is not asked again, the reflect prompt patches
the skill in play first and refuses poisonous lessons, and stale skills shrink the index."""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import Agent, Skill
from agentic.skills import reflect
from agentic.skills import store as skill_store

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401


@dataclass
class T:
    title: str = "Reconcile statements"
    brief: str = ""
    run_count: int = 1


@dataclass
class M:
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = field(default=None)


def tools(n: int) -> list[M]:
    return [M("tool", "ok") for _ in range(n)]


def test_reflection_triggers():
    assert reflect._trigger(T(), [M("user", "x")] + tools(1)) is None
    corrected = [M("user", "x"), M("user", f"{reflect.FEEDBACK} use our letterhead")]
    assert reflect._trigger(T(), corrected) == "a person corrected the work"
    assert reflect._trigger(
        T(), [M("user", "x")] + tools(3), tasks_since=reflect.CADENCE
    ).startswith("a regular check")
    assert (
        reflect._trigger(T(), [M("user", "x")] + tools(2), tasks_since=99) is None
    )  # too little work
    saved = [
        M("user", "x"),
        M(
            "assistant",
            None,
            [{"id": "c", "function": {"name": "propose_skill", "arguments": "{}"}}],
        ),
        *tools(20),
    ]
    assert reflect._trigger(T(), saved) is None  # it already saved what it learned


def test_the_reflect_prompt_guards_against_bad_lessons():
    for rule in (
        "USED IN THIS TASK",
        "important signal",
        "Never capture",
        "fix the wrong text in place",
    ):
        assert rule in reflect.DRAFT


async def test_stale_skills_are_named_but_not_described(client, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    for name, desc in (("fresh-one", "Used last week."), ("old-one", "Nobody used this for ages.")):
        r = await client.post(
            "/api/skills",
            json={
                "name": name,
                "description": desc,
                "body": "## When to use\nAlways.\n## Steps\n1. Do it.",
            },
            headers=csrf(client),
        )
        assert r.status_code in (200, 201), r.text
    async with SessionLocal() as db:
        old = await db.scalar(select(Skill).where(Skill.name == "old-one"))
        assert old is not None
        old.created_at = old.last_used_at = datetime.now(UTC) - timedelta(days=40)
        await db.commit()
        a = await db.get(Agent, agent["id"])
        index = await skill_store.index_for(db, a)
    assert "- fresh-one: Used last week." in index
    assert "Nobody used this" not in index and "Also available (not used lately): " in index
    assert "old-one" in index
