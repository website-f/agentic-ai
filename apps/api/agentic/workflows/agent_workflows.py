"""Durable agent work. A task can wait a full day for a person and survive any restart:
the wait lives in Temporal, the conversation lives in Postgres."""

import asyncio
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .agent_activities import (
        broadcast_reply,
        task_apply_approval,
        task_expire_approval,
        task_finish,
        task_start,
        task_step,
    )
    from .brain_activities import brain_learn_task
    from .skill_activities import skill_reflect
    from .teams_activities import task_collect_children, task_meeting_result

MAX_STEPS = 40
STEP_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=timedelta(seconds=5))
QUICK = timedelta(seconds=60)
# P29: finish may run the self-check and the goal judge (model calls): more time, and a
# bounded retry (it is safe to retry; the default retried forever).
FINISH_TIMEOUT = timedelta(minutes=5)
FINISH_RETRY = RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=5))


@workflow.defn
class AgentTaskWorkflow:
    def __init__(self) -> None:
        self.decided: set[str] = set()
        self.cancelled = False

    @workflow.signal
    def approval_decided(self, approval_id: str) -> None:
        self.decided.add(approval_id)

    @workflow.signal
    def cancel(self) -> None:
        self.cancelled = True

    @workflow.query
    def waiting_on(self) -> list[str]:
        return sorted(self.decided)

    @workflow.run
    async def run(self, task_id: str) -> str:
        await workflow.execute_activity(task_start, task_id, start_to_close_timeout=QUICK)
        for _ in range(MAX_STEPS):
            if self.cancelled:
                break
            try:
                r = await workflow.execute_activity(
                    task_step,
                    task_id,
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=STEP_RETRY,
                )
            except ActivityError as e:
                # Out of retries (database or worker trouble): never leave the task looking
                # like it is still running. Retry from the board once things are healthy.
                cause = str(e.cause or e)[:300]
                r: dict[str, Any] = {
                    "state": "failed",
                    "message": f"The worker could not run the step ({cause}).",
                }
            state = r["state"]
            if state == "delegate":
                # P7: child tasks run in parallel as child workflows; a cancel reaches them.
                await self._run_children(r["children"])
                if self.cancelled:
                    break
                why = await self._follow_up(
                    task_collect_children, [task_id, r["call_id"]], QUICK, "collect the answers"
                )
                if why is None:
                    continue
                state, r = "failed", {"state": "failed", "message": why}
            if state == "meeting":
                handle = await workflow.start_child_workflow(
                    "MeetingWorkflow", r["meeting_id"], id=f"meeting-{r['meeting_id']}"
                )
                await workflow.wait_condition(lambda handle=handle: handle.done() or self.cancelled)
                if self.cancelled:
                    handle.cancel()
                    break
                why = await self._follow_up(
                    task_meeting_result,
                    [task_id, r["call_id"], r["meeting_id"]],
                    QUICK,
                    "read the meeting result",
                )
                if why is None:
                    continue
                state, r = "failed", {"state": "failed", "message": why}
            if state == "needs_approval":
                aid = r["approval_id"]
                try:
                    await workflow.wait_condition(
                        lambda aid=aid: aid in self.decided or self.cancelled,
                        timeout=timedelta(seconds=r["timeout_seconds"]),
                    )
                except TimeoutError:
                    await workflow.execute_activity(
                        task_expire_approval, aid, start_to_close_timeout=QUICK
                    )
                if self.cancelled:
                    break
                why = await self._follow_up(
                    task_apply_approval, [aid], timedelta(minutes=2), "apply the decision"
                )
                if why is None:
                    continue
                state, r = "failed", {"state": "failed", "message": why}
            if state in ("done", "failed"):
                fin = await workflow.execute_activity(
                    task_finish,
                    args=[task_id, state, r.get("message")],
                    start_to_close_timeout=FINISH_TIMEOUT,
                    retry_policy=FINISH_RETRY,
                )
                # P29: the self-check or the goal judge sent the work back: the same run
                # continues (a new workflow would orphan a parent or a schedule waiting on
                # this one). Older runs (no marker) replay as they were.
                if (
                    isinstance(fin, dict)
                    and fin.get("continue")
                    and workflow.patched("finish-continue-v1")
                ):
                    continue
                # P3: learn from finished work. `patched` keeps runs started before this
                # existed replayable. P17: a failure teaches too.
                learn = state == "done" or workflow.patched("learn-failed-v1")
                if learn and workflow.patched("brain-learn-v1"):
                    try:
                        await workflow.execute_activity(
                            brain_learn_task,
                            task_id,
                            start_to_close_timeout=timedelta(minutes=5),
                            retry_policy=RetryPolicy(
                                maximum_attempts=2, initial_interval=timedelta(seconds=10)
                            ),
                        )
                    except ActivityError:
                        pass  # memory is best effort; the task itself is finished
                # P4: was this worth a skill? P17: the autopilot may switch it on.
                if learn and workflow.patched("skill-reflect-v1"):
                    try:
                        await workflow.execute_activity(
                            skill_reflect,
                            task_id,
                            start_to_close_timeout=timedelta(minutes=10),
                            retry_policy=RetryPolicy(maximum_attempts=1),
                        )
                    except ActivityError:
                        pass
                return state
        if self.cancelled:
            await workflow.execute_activity(
                task_finish,
                args=[task_id, "cancelled", None],
                start_to_close_timeout=QUICK,
                retry_policy=FINISH_RETRY,
            )
            return "cancelled"
        await workflow.execute_activity(
            task_finish,
            args=[task_id, "failed", f"Stopped after {MAX_STEPS} steps."],
            start_to_close_timeout=FINISH_TIMEOUT,
            retry_policy=FINISH_RETRY,
        )
        return "failed"

    async def _follow_up(
        self, fn: Any, args: list[Any], timeout: timedelta, what: str
    ) -> str | None:
        """Run a follow-up activity. None when it worked; out of retries, the reason the
        task fails (P29: never left looking like it is still running)."""
        try:
            await workflow.execute_activity(
                fn, args=args, start_to_close_timeout=timeout, retry_policy=STEP_RETRY
            )
        except ActivityError as e:
            if not workflow.patched("follow-up-fails-task-v1"):
                raise
            return f"The worker could not {what} ({str(e.cause or e)[:300]})."
        return None

    async def _run_children(self, children: list[dict[str, str]]) -> None:
        handles = [
            await workflow.start_child_workflow(
                AgentTaskWorkflow.run, c["task_id"], id=c["workflow_id"]
            )
            for c in children
        ]
        if not handles:
            return
        everyone = asyncio.gather(*handles, return_exceptions=True)
        await workflow.wait_condition(lambda: everyone.done() or self.cancelled)
        if not everyone.done():
            for h in handles:
                try:
                    await h.signal(AgentTaskWorkflow.cancel)
                except Exception:  # noqa: BLE001, S110 - that child already finished
                    pass
            await everyone


@workflow.defn
class BroadcastRepliesWorkflow:
    @workflow.run
    async def run(self, broadcast_id: str, agent_ids: list[str]) -> int:
        # Five at a time keeps free-tier rate limits happy.
        for i in range(0, len(agent_ids), 5):
            await asyncio.gather(
                *[
                    workflow.execute_activity(
                        broadcast_reply,
                        args=[broadcast_id, aid],
                        start_to_close_timeout=timedelta(minutes=2),
                        retry_policy=STEP_RETRY,
                    )
                    for aid in agent_ids[i : i + 5]
                ]
            )
        return len(agent_ids)
