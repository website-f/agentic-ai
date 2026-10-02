"""AgentTaskWorkflow on Temporal's time-skipping test server: a 24-hour approval wait takes
milliseconds, so we can prove expiry and resume without waiting a day."""

import uuid
from datetime import timedelta

import pytest
from temporalio import activity
from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from agentic.workflows.agent_workflows import AgentTaskWorkflow

DAY = 24 * 3600


class FakeRun:
    """Stands in for the real activities; scripts the step results."""

    def __init__(self, steps: list[dict]):
        self.steps = steps
        self.log: list[tuple] = []
        self.learn_fails = False

    def activities(self):
        @activity.defn(name="task_start")
        async def task_start(task_id: str) -> None:
            self.log.append(("start", task_id))

        @activity.defn(name="task_step")
        async def task_step(task_id: str) -> dict:
            self.log.append(("step",))
            step = self.steps[0] if self.steps[0].get("raise") else self.steps.pop(0)
            if step.get("raise"):
                raise RuntimeError("QueuePool limit reached")
            return step

        @activity.defn(name="task_apply_approval")
        async def task_apply_approval(approval_id: str) -> None:
            self.log.append(("apply", approval_id))

        @activity.defn(name="task_expire_approval")
        async def task_expire_approval(approval_id: str) -> None:
            self.log.append(("expire", approval_id))

        @activity.defn(name="task_finish")
        async def task_finish(task_id: str, state: str, message: str | None) -> None:
            self.log.append(("finish", state, message))

        @activity.defn(name="brain_learn_task")
        async def brain_learn_task(task_id: str) -> int:
            self.log.append(("learn", task_id))
            if self.learn_fails:
                raise RuntimeError("no model")
            return 1

        @activity.defn(name="skill_reflect")
        async def skill_reflect(task_id: str) -> str | None:
            self.log.append(("reflect", task_id))
            return None

        return [
            skill_reflect,
            task_start,
            task_step,
            task_apply_approval,
            task_expire_approval,
            task_finish,
            brain_learn_task,
        ]


@pytest.fixture(scope="module")
async def env():
    try:
        e = await WorkflowEnvironment.start_time_skipping()
    except Exception as exc:  # noqa: BLE001 - needs a one-time download of the test server
        pytest.skip(f"Temporal test server unavailable: {exc}")
    yield e
    await e.shutdown()


async def _run(env: WorkflowEnvironment, fake: FakeRun, signal_after: str | None = None) -> str:
    queue = f"q-{uuid.uuid4().hex[:8]}"
    async with Worker(
        env.client, task_queue=queue, workflows=[AgentTaskWorkflow], activities=fake.activities()
    ):
        handle = await env.client.start_workflow(
            AgentTaskWorkflow.run, "tk_1", id=f"wf-{uuid.uuid4().hex[:8]}", task_queue=queue
        )
        if signal_after:
            await env.sleep(timedelta(hours=3))  # a person decides three hours later
            await handle.signal(AgentTaskWorkflow.approval_decided, signal_after)
        return await handle.result()


async def test_approval_wait_expires_after_a_day(env):
    fake = FakeRun(
        [
            {"state": "needs_approval", "approval_id": "ap_1", "timeout_seconds": DAY},
            {"state": "done", "message": "Finished without it."},
        ]
    )
    assert await _run(env, fake) == "done"
    kinds = [x[0] for x in fake.log]
    assert kinds == ["start", "step", "expire", "apply", "step", "finish", "learn", "reflect"]
    assert fake.log[-3] == ("finish", "done", "Finished without it.")


async def test_decision_signal_resumes_without_expiry(env):
    fake = FakeRun(
        [
            {"state": "needs_approval", "approval_id": "ap_2", "timeout_seconds": DAY},
            {"state": "continue"},
            {"state": "done", "message": "Used the page."},
        ]
    )
    assert await _run(env, fake, signal_after="ap_2") == "done"
    kinds = [x[0] for x in fake.log]
    assert "expire" not in kinds and kinds.count("step") == 3
    assert ("apply", "ap_2") in fake.log


async def test_failed_step_finishes_task_as_failed(env):
    fake = FakeRun([{"state": "failed", "message": "No model could answer."}])
    try:
        result = await _run(env, fake)
    except WorkflowFailureError:  # pragma: no cover - the workflow itself must not crash
        pytest.fail("workflow crashed instead of finishing the task")
    assert result == "failed" and fake.log[-1] == ("finish", "failed", "No model could answer.")
    assert "learn" not in [x[0] for x in fake.log]  # nothing to learn from a failed run


async def test_learning_failure_does_not_fail_the_task(env):
    fake = FakeRun([{"state": "done", "message": "Done."}])
    fake.learn_fails = True
    assert await _run(env, fake) == "done"
    kinds = [x[0] for x in fake.log]
    # one retry, then the task stays done and still reflects
    assert kinds[-4:] == ["finish", "learn", "learn", "reflect"]


async def test_step_out_of_retries_marks_the_task_failed(env):
    """A step that keeps crashing (database down) must not leave the task 'running'."""
    fake = FakeRun([{"raise": True}])
    assert await _run(env, fake) == "failed"
    assert [x[0] for x in fake.log].count("step") == 3  # STEP_RETRY attempts
    assert fake.log[-1][0:2] == ("finish", "failed") and "could not run the step" in fake.log[-1][2]
