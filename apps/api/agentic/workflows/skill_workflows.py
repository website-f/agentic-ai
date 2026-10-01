"""Skill evals run in the background: they call a model once or twice per test case."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .skill_activities import skill_eval


@workflow.defn
class SkillEvalWorkflow:
    @workflow.run
    async def run(self, kind: str, target_id: str) -> dict:
        return await workflow.execute_activity(
            skill_eval,
            args=[kind, target_id],
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
