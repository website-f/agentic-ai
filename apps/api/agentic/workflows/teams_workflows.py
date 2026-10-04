"""P7 workflows: meetings, heartbeats and scheduled tasks."""

from datetime import datetime, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .agent_workflows import AgentTaskWorkflow
    from .teams_activities import (
        heartbeat_tick,
        meeting_close,
        meeting_plan,
        meeting_round_done,
        meeting_turn,
        schedule_attempt,
        schedule_claim,
        schedule_finish,
    )

QUICK = timedelta(seconds=60)
TURN_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=timedelta(seconds=5))


@workflow.defn
class MeetingWorkflow:
    """Rounds x participants, one turn each, then the chair writes the outcome. Stops early
    when everyone passes in a round or the token budget runs out."""

    @workflow.run
    async def run(self, meeting_id: str) -> str:
        plan = await workflow.execute_activity(
            meeting_plan, meeting_id, start_to_close_timeout=QUICK
        )
        stop = False
        for rnd in range(plan["start"], plan["rounds"] + 1):
            passes = 0
            for agent_id in plan["participants"]:
                try:
                    r = await workflow.execute_activity(
                        meeting_turn,
                        args=[meeting_id, rnd, agent_id],
                        start_to_close_timeout=timedelta(minutes=3),
                        retry_policy=TURN_RETRY,
                    )
                except ActivityError:
                    r = {"stop": False, "passed": True}  # one agent failing does not end it
                passes += 1 if r["passed"] else 0
                if r["stop"]:
                    stop = True
                    break
            await workflow.execute_activity(
                meeting_round_done, args=[meeting_id, rnd], start_to_close_timeout=QUICK
            )
            if stop or (rnd > 1 and passes == len(plan["participants"])):
                break
        await workflow.execute_activity(
            meeting_close,
            meeting_id,
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=TURN_RETRY,
        )
        return meeting_id


@workflow.defn
class HeartbeatWorkflow:
    """Started hourly by the `agent-heartbeat` schedule (see worker.py)."""

    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            heartbeat_tick, start_to_close_timeout=timedelta(minutes=5)
        )


@workflow.defn
class ScheduledTaskWorkflow:
    """claim -> task run (a child AgentTaskWorkflow) -> finish, retrying at 5/15/30 min."""

    @workflow.run
    async def run(self, schedule_id: str, manual: bool = False) -> str:
        claimed = await workflow.execute_activity(
            schedule_claim, args=[schedule_id, manual], start_to_close_timeout=QUICK
        )
        if not claimed:
            return "skipped"
        # P19: the agent is off duty; start at its next shift (older runs carry no key).
        if claimed.get("wait_until"):
            wait = (datetime.fromisoformat(claimed["wait_until"]) - workflow.now()).total_seconds()
            if wait > 0:
                await workflow.sleep(timedelta(seconds=wait))
        state = "failed"
        for n, delay in enumerate((0, 300, 900, 1800), 1):
            if delay:
                await workflow.sleep(timedelta(seconds=delay))
            wid = await workflow.execute_activity(
                schedule_attempt, args=[claimed["run_id"], n], start_to_close_timeout=QUICK
            )
            state = await workflow.execute_child_workflow(
                AgentTaskWorkflow.run, claimed["task_id"], id=wid
            )
            if state in ("done", "cancelled"):
                break
        await workflow.execute_activity(
            schedule_finish, args=[claimed["run_id"], state], start_to_close_timeout=QUICK
        )
        return state
