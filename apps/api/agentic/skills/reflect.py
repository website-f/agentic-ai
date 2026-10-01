"""After a task: should this become a skill (or improve one)?

Deterministic trigger first, so most tasks cost nothing: the task used many tool calls, was
sent back twice or more, or someone asked to "remember how to do this". Only then a cheap
model drafts a proposal, which a person reviews. Evals (old vs new) run before review when
the skill has test cases.
"""

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import embed
from ..brain.facts import parse_json
from ..core.config import settings
from ..engine import gateway
from ..models import (
    Agent,
    AgentMessage,
    Skill,
    SkillEvalCase,
    SkillProposal,
    SkillUse,
    Task,
    Workspace,
)
from . import evals
from . import format as fmt
from .store import SkillError, propose

log = logging.getLogger("agentic.skills.reflect")

REMEMBER = re.compile(
    r"remember how to do this|save (this|it) as a skill|make (this|it) a skill|ingat cara", re.I
)
CONTEXT_SIMILARITY = 0.5

DRAFT = """You turn finished office work into reusable procedures ("skills") for AI staff.
Return JSON only:
{"propose": true, "why": "one sentence", "name": "kebab-case-name",
 "description": "one sentence: what it does and when to use it",
 "body": "markdown: ## When to use, ## Steps (numbered), ## Output format, ## Pitfalls",
 "eval_cases": [{"title": "...", "input": "a realistic request", "must_contain": ["..."]}]}

Rules:
- Propose only if this kind of work will come again and the steps generalise.
  Otherwise return {"propose": false, "why": "..."}.
- Write the general procedure. Never copy this task's client names, amounts, dates or secrets.
- Name the tools to use (calc, web_fetch, recall, write_page, ask_human) where they belong.
- If an EXISTING skill covers this work, improve it: use its exact name, return the full
  improved body, and say in "why" what was missing.
- Up to 3 eval_cases, each checkable by words that must appear in a correct answer."""


def _trigger(task: Task, msgs: list[AgentMessage]) -> str | None:
    tool_calls = sum(1 for m in msgs if m.role == "tool")
    if tool_calls >= settings.skill_min_tool_calls:
        return f"the task took {tool_calls} tool calls"
    if task.run_count >= 3:
        return f"the work was sent back {task.run_count - 1} times"
    asked = [task.brief] + [m.content or "" for m in msgs if m.role == "user"]
    if any(REMEMBER.search(a) for a in asked):
        return "someone asked to remember how to do this"
    return None


def _transcript(task: Task, msgs: list[AgentMessage]) -> str:
    out = [f"TASK: {task.title}\n{task.brief}".strip()]
    for m in msgs[1:]:
        if m.role == "assistant" and m.tool_calls:
            for c in m.tool_calls:
                fn = c.get("function") or {}
                args = fn.get("arguments")
                args = args if isinstance(args, str) else json.dumps(args)
                out.append(f"CALL {fn.get('name')}: {str(args)[:240]}")
        elif m.role == "tool":
            out.append(f"RESULT {m.name}: {(m.content or '')[:300]}")
        elif m.role == "user":
            out.append(f"PERSON: {(m.content or '')[:600]}")
        elif m.content:
            out.append(f"ANSWER: {m.content[:1500]}")
    return "\n".join(out)[-9000:]


async def _ask(db: AsyncSession, agent: Agent, user: str) -> dict[str, Any]:
    for group in dict.fromkeys(("fast", agent.model_group)):
        try:
            r = await gateway.chat(
                db,
                agent.workspace_id,
                group,
                [{"role": "system", "content": DRAFT}, {"role": "user", "content": user}],
                task="skill.reflect",
                max_tokens=1400,
                temperature=0.2,
                json_mode=True,
                agent_id=agent.id,
            )
            return parse_json(r.content)
        except gateway.GatewayUnavailable:
            continue
    return {}


async def evaluate(db: AsyncSession, p: SkillProposal) -> dict[str, Any] | None:
    """Old vs new on the skill's test cases plus any the proposal brings."""
    cases: list[dict[str, Any]] = (
        [
            {"title": c.title, "input": c.input, "checks": c.checks}
            for c in (
                await db.scalars(select(SkillEvalCase).where(SkillEvalCase.skill_id == p.skill_id))
            ).all()
        ]
        if p.skill_id
        else []
    )
    have = {c["title"] for c in cases}
    cases += [c for c in p.eval_cases if c.get("title") not in have and c.get("input")]
    if not cases or p.kind == "retire":
        return None
    result: dict[str, Any] = {"new": await evals.run_suite(db, p.workspace_id, p.body, cases)}
    skill = await db.get(Skill, p.skill_id) if p.skill_id else None
    if skill is not None:
        result["old"] = await evals.run_suite(db, p.workspace_id, skill.body, cases)
        result["old_version"] = skill.version
    p.eval = result
    await db.commit()
    return result


async def reflect_on_task(db: AsyncSession, task_id: str) -> SkillProposal | None:
    task = await db.get(Task, task_id)
    if task is None or task.status not in ("review", "done") or not task.assignee_agent_id:
        return None
    agent = await db.get(Agent, task.assignee_agent_id)
    ws = await db.get(Workspace, task.workspace_id)
    if agent is None or ws is None:
        return None
    msgs = list(
        (
            await db.scalars(
                select(AgentMessage)
                .where(AgentMessage.task_id == task.id)
                .order_by(AgentMessage.id)
            )
        ).all()
    )
    why = _trigger(task, msgs)
    if why is None:
        return None

    used = (
        await db.scalars(
            select(Skill)
            .join(SkillUse, SkillUse.skill_id == Skill.id)
            .where(SkillUse.task_id == task.id)
        )
    ).all()
    related: dict[str, Skill] = {s.id: s for s in used}
    vec = await embed.embed_one(f"{task.title}\n{task.brief}")
    if vec is not None:
        dist = Skill.embedding.cosine_distance(vec)
        for s, sim in (
            await db.execute(
                select(Skill, (1 - dist).label("sim"))
                .where(
                    Skill.workspace_id == ws.id,
                    Skill.status == "active",
                    Skill.embedding.is_not(None),
                )
                .order_by(dist)
                .limit(3)
            )
        ).all():
            if float(sim) >= CONTEXT_SIMILARITY:
                related.setdefault(s.id, s)
    existing = (
        "\n\n".join(
            f"EXISTING SKILL {s.name} (v{s.version}): {s.description}\n{s.body[:1500]}"
            for s in related.values()
        )
        or "EXISTING SKILLS: none related."
    )

    got = await _ask(
        db,
        agent,
        f"Why this is being considered: {why}.\n\n{existing}\n\n{_transcript(task, msgs)}",
    )
    if not got.get("propose"):
        return None
    try:
        p = await propose(
            db,
            ws,
            name=str(got.get("name") or task.title),
            description=str(got.get("description") or ""),
            body=str(got.get("body") or ""),
            reason=f"{str(got.get('why') or '').strip()} (Trigger: {why}.)".strip(),
            proposed_by=f"agent:{agent.id}",
            agent=agent,
            source_task_id=task.id,
            eval_cases=got.get("eval_cases") if isinstance(got.get("eval_cases"), list) else [],
        )
    except (SkillError, fmt.SkillFormatError) as e:
        log.info("no skill proposal for %s: %s", task_id, e)
        return None
    try:
        await evaluate(db, p)
    except Exception:  # noqa: BLE001 - evals are advice for the reviewer, never a blocker
        log.warning("evals failed for proposal %s", p.id, exc_info=True)
    return p
