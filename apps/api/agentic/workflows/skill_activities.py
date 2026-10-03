"""Activities for skills: reflecting on finished work, and running evals."""

import logging

from sqlalchemy import select
from temporalio import activity

from ..agents import runtime
from ..core.db import SessionLocal
from ..models import Skill, SkillEvalCase, SkillProposal, Task, Workspace
from ..services import events
from ..skills import autopilot, evals, reflect

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
            done = (
                f"learned {what} {p.name} and switched it on (it passed its tests)"
                if p.status == "approved"
                else f"proposed {what} {p.name} for review"
            )
            await runtime.task_event(
                db,
                task,
                "skill",
                f"agent:{task.assignee_agent_id}",
                done,
                {"proposal_id": p.id, "name": p.name, "kind": p.kind, "status": p.status},
            )
        return p.id


@activity.defn
async def skill_reflect_chat(message_id: int) -> str | None:
    async with SessionLocal() as db:
        p = await reflect.reflect_on_chat(db, message_id)
        return p.id if p else None


@activity.defn
async def skill_eval(kind: str, target_id: str) -> dict:
    """kind = skill (run its test cases) | proposal (old vs new)."""
    async with SessionLocal() as db:
        if kind == "proposal":
            p = await db.get(SkillProposal, target_id)
            if p is None:
                return {}
            result = await reflect.evaluate(db, p) or {}
            ws = await db.get(Workspace, p.workspace_id)
            if ws is not None:  # P17: proven drafts go live (per the workspace's mode)
                await autopilot.consider(db, ws, p)
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
