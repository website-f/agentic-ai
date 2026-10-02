"""Document Studio and workflow-run workflows."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .document_activities import file_extract, workflow_run_tick


@workflow.defn
class FileExtractWorkflow:
    @workflow.run
    async def run(self, file_id: str) -> str:
        # OCR of a long scan takes minutes; one retry covers a worker restart mid-read.
        return await workflow.execute_activity(
            file_extract,
            file_id,
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=15)),
        )


TICK_EVERY = timedelta(seconds=15)
TICKS_PER_HISTORY = 300  # then continue-as-new, so a run waiting days stays small


@workflow.defn
class WorkflowRunWorkflow:
    """Ticks a workflow run until it finishes: every 15 s, or at once when poked (a person
    decided, a step's task finished)."""

    def __init__(self) -> None:
        self.poked = False

    @workflow.signal
    def poke(self) -> None:
        self.poked = True

    @workflow.run
    async def run(self, run_id: str) -> str:
        for _ in range(TICKS_PER_HISTORY):
            self.poked = False
            finished = await workflow.execute_activity(
                workflow_run_tick,
                run_id,
                start_to_close_timeout=timedelta(minutes=3),
                retry_policy=RetryPolicy(maximum_attempts=5, initial_interval=timedelta(seconds=5)),
            )
            if finished:
                return "finished"
            try:
                await workflow.wait_condition(lambda: self.poked, timeout=TICK_EVERY)
            except TimeoutError:
                pass
        workflow.continue_as_new(run_id)
