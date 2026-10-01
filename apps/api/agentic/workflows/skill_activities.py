"""Activities for skills: reflecting on finished work, and running evals."""

import logging

from sqlalchemy import select
from temporalio import activity

from ..agents import runtime
from ..core.db import SessionLocal
from ..models import Skill, SkillEvalCase, SkillProposal, Task
from ..services import events
from ..skills import evals, reflect

log = logging.getLogger("agentic.worker.skills")


@activity.defn
async def skill_reflect(task_id: str) -> str | None:
    async with SessionLocal() as db:
        p = await reflect.reflect_on_task(db, task_id)
        if p is None:
            return None
        task = await db.get(Task, task_id)
        if task is not None:
            what = "an update to the skill" if p.kind == "patch" else "a new skill"
            await runtime.task_event(
                db,
                task,
                "skill",
                f"agent:{task.assignee_agent_id}",
                f"proposed {what} {p.name} for review",
                {"proposal_id": p.id, "name": p.name, "kind": p.kind},
            )
        return p.id


@activity.defn
async def skill_eval(kind: str, target_id: str) -> dict:
    """kind = skill (run its test cases) | proposal (old vs new)."""
    async with SessionLocal() as db:
        if kind == "proposal":
            p = await db.get(SkillProposal, target_id)
            if p is None:
                return {}
            result = await reflect.evaluate(db, p) or {}
            await events.publish(p.workspace_id, "skill.proposal", {"proposal_id": p.id})
            return {"passed": result.get("new", {}).get("passed")}
        s = await db.get(Skill, target_id)
        if s is None:
            return {}
        cases = [
            {"title": c.title, "input": c.input, "checks": c.checks}
            for c in (
                await db.scalars(select(SkillEvalCase).where(SkillEvalCase.skill_id == s.id))
            ).all()
        ]
        result = await evals.run_suite(db, s.workspace_id, s.body, cases)
        result["version"] = s.version
        s.last_eval = result
        await db.commit()
        await events.publish(s.workspace_id, "skill.updated", {"skill_id": s.id})
        return {"passed": result.get("passed"), "total": result.get("total")}
