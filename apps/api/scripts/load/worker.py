"""The real Temporal worker (every workflow and activity of agentic.workflows.worker) for the
load harness, minus the recurring schedules and the Telegram poller, plus an interceptor
that records each activity's queue wait (scheduled -> started) and run time in Valkey
(list `load:acts`). LOAD_PROFILE=<file> also writes a CPU profile (cProfile, process time)
every 15 s. Never in CI.

    python scripts/load/worker.py
"""

import asyncio
import cProfile
import json
import logging
import os
import time
from datetime import UTC, datetime
from typing import Any

from temporalio import activity
from temporalio.client import Client
from temporalio.worker import (
    ActivityInboundInterceptor,
    ExecuteActivityInput,
    Interceptor,
    Worker,
)

from agentic.core.config import settings
from agentic.core.valkey import valkey
from agentic.workflows.worker import ACTIVITIES, WORKFLOWS


class _Timing(ActivityInboundInterceptor):
    async def execute_activity(self, input: ExecuteActivityInput) -> Any:  # noqa: A002
        info = activity.info()
        sched = info.current_attempt_scheduled_time
        wait = (datetime.now(UTC) - sched).total_seconds() if sched else 0.0
        t0 = time.perf_counter()
        ok = True
        try:
            return await self.next.execute_activity(input)
        except BaseException:
            ok = False
            raise
        finally:
            row = {
                "type": info.activity_type,
                "wait": round(wait, 3),
                "run": round(time.perf_counter() - t0, 3),
                "ok": ok,
                "at": time.time(),
            }
            try:
                await valkey().rpush("load:acts", json.dumps(row))
            except Exception:  # noqa: BLE001, S110 - measuring never breaks the work
                pass


class Timing(Interceptor):
    def intercept_activity(self, next: ActivityInboundInterceptor) -> ActivityInboundInterceptor:  # noqa: A002
        return _Timing(next)


async def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    worker = Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=WORKFLOWS,
        activities=ACTIVITIES,
        # as the real worker: P96 caps the steps at what the database pool serves
        max_concurrent_activities=getattr(settings, "worker_slots", settings.worker_max_activities),
        interceptors=[Timing()],
    )
    print(
        f"load worker: {getattr(settings, 'worker_slots', settings.worker_max_activities)} "
        f"activities, db pool "
        f"{settings.db_pool_size}+{settings.db_max_overflow}",
        flush=True,
    )
    prof_path = os.environ.get("LOAD_PROFILE", "")
    prof_path = f"{prof_path}.{os.getpid()}" if prof_path else ""
    prof = cProfile.Profile(time.process_time) if prof_path else None
    if prof is not None:
        prof.enable()  # CPU time only: where the worker's core goes under load
    async with worker:
        while True:
            await asyncio.sleep(15)
            if prof is not None:
                prof.dump_stats(prof_path)  # this stops the profiler: start it again
                prof.enable()


if __name__ == "__main__":
    asyncio.run(main())
