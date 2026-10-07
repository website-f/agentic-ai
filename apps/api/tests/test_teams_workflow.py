"""P7 workflows on Temporal's time-skipping server: children run in parallel and come back to
the parent, meetings stop early when everyone passes, scheduled runs retry at 5/15/30 min."""

import uuid

from temporalio import activity
from temporalio.worker import Worker

from agentic.workflows.agent_workflows import AgentTaskWorkflow
from agentic.workflows.teams_workflows import MeetingWorkflow, ScheduledTaskWorkflow

from .test_workflow import env  # noqa: F401 - the shared time-skipping server


class Fakes:
    def __init__(self, steps: dict[str, list[dict]]):
        self.steps = steps
        self.log: list[tuple] = []
        self.attempts: list[str] = []  # P29: scripted attempt answers (busy / stop:...)

    def activities(self):
        log, steps = self.log, self.steps

        @activity.defn(name="task_start")
        async def task_start(task_id: str) -> None:
            log.append(("start", task_id))

        @activity.defn(name="task_step")
        async def task_step(task_id: str) -> dict:
            log.append(("step", task_id))
            return steps[task_id].pop(0)

        @activity.defn(name="task_apply_approval")
        async def task_apply_approval(approval_id: str) -> None:
            log.append(("apply", approval_id))

        @activity.defn(name="task_expire_approval")
        async def task_expire_approval(approval_id: str) -> None:
            log.append(("expire", approval_id))

        @activity.defn(name="task_finish")
        async def task_finish(task_id: str, state: str, message: str | None) -> None:
            log.append(("finish", task_id, state))

        @activity.defn(name="brain_learn_task")
        async def brain_learn_task(task_id: str) -> int:
            return 0

        @activity.defn(name="skill_reflect")
        async def skill_reflect(task_id: str) -> str | None:
            return None

        @activity.defn(name="task_collect_children")
        async def task_collect_children(task_id: str, call_id: str) -> None:
            log.append(("collect", task_id, call_id))

        @activity.defn(name="task_meeting_result")
        async def task_meeting_result(task_id: str, call_id: str, meeting_id: str) -> None:
            log.append(("meeting_result", meeting_id))

        @activity.defn(name="meeting_plan")
        async def meeting_plan(meeting_id: str) -> dict:
            return {"participants": ["ag_a", "ag_b"], "start": 1, "rounds": 3}

        @activity.defn(name="meeting_turn")
        async def meeting_turn(meeting_id: str, rnd: int, agent_id: str) -> dict:
            log.append(("turn", rnd, agent_id))
            return {"stop": False, "passed": rnd >= 2}  # round 2: nobody adds anything

        @activity.defn(name="meeting_round_done")
        async def meeting_round_done(meeting_id: str, rnd: int) -> None:
            pass

        @activity.defn(name="meeting_close")
        async def meeting_close(meeting_id: str) -> dict:
            log.append(("close", meeting_id))
            return {"decision": "x"}

        @activity.defn(name="schedule_claim")
        async def schedule_claim(schedule_id: str, manual: bool) -> dict | None:
            return {"run_id": "1", "task_id": "tk_s"}

        @activity.defn(name="schedule_attempt")
        async def schedule_attempt(run_id: str, n: int) -> str:
            log.append(("attempt", n))
            if self.attempts:
                return self.attempts.pop(0)
            return f"task-tk_s-{n}-{uuid.uuid4().hex[:6]}"

        @activity.defn(name="schedule_finish")
        async def schedule_finish(run_id: str, state: str) -> None:
            log.append(("schedule_finish", state))

        return [
            task_start,
            task_step,
            task_apply_approval,
            task_expire_approval,
            task_finish,
            brain_learn_task,
            skill_reflect,
            task_collect_children,
            task_meeting_result,
            meeting_plan,
            meeting_turn,
            meeting_round_done,
            meeting_close,
            schedule_claim,
            schedule_attempt,
            schedule_finish,
        ]


async def _worker(env, fakes: Fakes):  # noqa: F811
    queue = f"q-{uuid.uuid4().hex[:8]}"
    return queue, Worker(
        env.client,
        task_queue=queue,
        workflows=[AgentTaskWorkflow, MeetingWorkflow, ScheduledTaskWorkflow],
        activities=fakes.activities(),
    )


async def test_parent_runs_three_children_then_collects(env):  # noqa: F811
    tag = uuid.uuid4().hex[:6]
    kids = [f"tk_{tag}_{i}" for i in range(3)]
    fakes = Fakes(
        {
            "tk_parent": [
                {
                    "state": "delegate",
                    "call_id": "call_1",
                    "children": [{"task_id": k, "workflow_id": f"task-{k}-1"} for k in kids],
                },
                {"state": "done", "message": "merged"},
            ],
            **{k: [{"state": "done", "message": "ok"}] for k in kids},
        }
    )
    queue, worker = await _worker(env, fakes)
    async with worker:
        result = await env.client.execute_workflow(
            AgentTaskWorkflow.run, "tk_parent", id=f"wf-{tag}", task_queue=queue
        )
    assert result == "done"
    finished = [x[1] for x in fakes.log if x[0] == "finish"]
    collect = fakes.log.index(("collect", "tk_parent", "call_1"))
    # every child finished before the parent collected, and the parent finished last
    assert sorted(finished[:3]) == sorted(kids) and finished[3] == "tk_parent"
    assert all(fakes.log.index(("finish", k, "done")) < collect for k in kids)


async def test_meeting_stops_when_everyone_passes(env):  # noqa: F811
    fakes = Fakes({})
    queue, worker = await _worker(env, fakes)
    async with worker:
        await env.client.execute_workflow(
            MeetingWorkflow.run, "mt_1", id=f"mt-{uuid.uuid4().hex[:6]}", task_queue=queue
        )
    turns = [x for x in fakes.log if x[0] == "turn"]
    assert [t[1] for t in turns] == [1, 1, 2, 2]  # round 3 never happens
    assert fakes.log[-1] == ("close", "mt_1")


async def test_scheduled_run_retries_then_records(env):  # noqa: F811
    fakes = Fakes(
        {
            "tk_s": [
                {"state": "failed", "message": "provider down"},
                {"state": "failed", "message": "provider down"},
                {"state": "done", "message": "report"},
            ]
        }
    )
    queue, worker = await _worker(env, fakes)
    async with worker:
        state = await env.client.execute_workflow(
            ScheduledTaskWorkflow.run,
            args=["sc_1", False],
            id=f"sch-{uuid.uuid4().hex[:6]}",
            task_queue=queue,
        )
    assert state == "done"
    assert [x[1] for x in fakes.log if x[0] == "attempt"] == [1, 2, 3]  # 5 and 15 min skipped
    assert fakes.log[-1] == ("schedule_finish", "done")


async def _scheduled(env, fakes: Fakes) -> str:  # noqa: F811
    queue, worker = await _worker(env, fakes)
    async with worker:
        return await env.client.execute_workflow(
            ScheduledTaskWorkflow.run,
            args=["sc_1", False],
            id=f"sch-{uuid.uuid4().hex[:6]}",
            task_queue=queue,
        )


async def test_scheduled_run_stops_when_its_task_was_cancelled(env):  # noqa: F811
    """P29: cancelled (or deleted) during the retry wait: no more attempts, a clean end."""
    fakes = Fakes({"tk_s": [{"state": "failed", "message": "provider down"}]})
    fakes.attempts = [f"task-tk_s-1-{uuid.uuid4().hex[:6]}", "stop:cancelled"]
    assert await _scheduled(env, fakes) == "cancelled"
    assert [x[1] for x in fakes.log if x[0] == "attempt"] == [1, 2]
    assert fakes.log[-1] == ("schedule_finish", "cancelled")


async def test_scheduled_run_waits_for_a_run_started_by_hand(env):  # noqa: F811
    """P29: never a second workflow on a task a person already started."""
    fakes = Fakes({"tk_s": []})
    fakes.attempts = ["busy", "busy", "stop:done"]
    assert await _scheduled(env, fakes) == "done"
    assert [x[0] for x in fakes.log].count("start") == 0  # no task run of its own
    assert fakes.log[-1] == ("schedule_finish", "done")
