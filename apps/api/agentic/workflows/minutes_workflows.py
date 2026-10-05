"""Meeting minutes from a recording: prepare -> hear each chunk -> write.

Durable end to end: a worker restart resumes at the chunk it was on (finished chunks are
stored on the recording). When every speech model is resting (Groq's audio-seconds-per-hour
limit), the chunk step says how long to wait and this workflow sleeps; it gives up only
after waiting MAX_WAIT in total."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .minutes_activities import (
        minutes_fail,
        minutes_prepare,
        minutes_purge,
        minutes_transcribe,
        minutes_write,
    )

CHUNK_PAUSE = timedelta(seconds=3)  # gentle on per-minute request limits between chunks
MAX_WAIT_SECONDS = 4 * 3600
STEP_RETRY = RetryPolicy(
    maximum_attempts=4,
    initial_interval=timedelta(seconds=20),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=5),
)


@workflow.defn
class MeetingMinutesWorkflow:
    def __init__(self) -> None:
        self.stage = "starting"

    @workflow.query
    def progress(self) -> str:
        return self.stage

    @workflow.run
    async def run(self, rec_id: str) -> str:
        try:
            return await self._run(rec_id)
        except ActivityError as e:
            cause = getattr(e.cause, "message", None) or str(e.cause or e)
            await workflow.execute_activity(
                minutes_fail,
                args=[rec_id, f"Processing stopped at {self.stage}: {cause}"[:480]],
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return "failed"

    async def _run(self, rec_id: str) -> str:
        self.stage = "extracting the audio"
        info = await workflow.execute_activity(
            minutes_prepare,
            rec_id,
            # ffmpeg reads a 4-hour video in a few minutes; it heartbeats every 10 s.
            start_to_close_timeout=timedelta(minutes=45),
            heartbeat_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=15)),
        )
        if info.get("failed"):
            return "failed"
        total = int(info.get("chunks") or 0)
        waited = 0
        i = 0
        while i < total:
            self.stage = f"transcribing part {i + 1} of {total}"
            r = await workflow.execute_activity(
                minutes_transcribe,
                args=[rec_id, i],
                start_to_close_timeout=timedelta(minutes=8),
                heartbeat_timeout=timedelta(minutes=2),
                retry_policy=STEP_RETRY,
            )
            if r.get("failed"):
                return "failed"
            if r.get("wait"):
                wait = int(r["wait"])
                waited += wait
                if waited > MAX_WAIT_SECONDS:
                    await workflow.execute_activity(
                        minutes_fail,
                        args=[
                            rec_id,
                            "The speech model stayed busy for hours. Add a second speech "
                            "model (AI Engine > Model groups > Speech to text) or retry later.",
                        ],
                        start_to_close_timeout=timedelta(minutes=1),
                    )
                    return "failed"
                await workflow.sleep(timedelta(seconds=min(wait + 2, 3600)))
                continue
            i += 1
            if i < total:
                await workflow.sleep(CHUNK_PAUSE)
        self.stage = "writing the minutes"
        r = await workflow.execute_activity(
            minutes_write,
            rec_id,
            start_to_close_timeout=timedelta(minutes=40),
            heartbeat_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=30),
                backoff_coefficient=2.0,
            ),
        )
        return "failed" if r.get("failed") else "ready"


@workflow.defn
class MinutesPurgeWorkflow:
    """Started nightly by the `minutes-purge` schedule (see worker.py)."""

    @workflow.run
    async def run(self) -> dict[str, int]:
        return await workflow.execute_activity(
            minutes_purge, start_to_close_timeout=timedelta(minutes=15)
        )
