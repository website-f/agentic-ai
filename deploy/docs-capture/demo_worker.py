"""A stand-in worker for the docs capture, on its own task queue (agentic-office).

It answers the Command center's worker health check (PingWorkflow), and ends every other
workflow the demo API starts (a task run, a deferred start...) at once: demo work is moved
along by demo_advance.py instead of real model calls, and Temporal is left clean. The real dev
worker serves the dev database on its own queue and never sees demo work.

    cd apps/api
    AGENTIC_TEMPORAL_TASK_QUEUE=agentic-office uv run python ../../deploy/docs-capture/demo_worker.py
"""

import asyncio
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from temporalio import workflow
from temporalio.common import RawValue


@workflow.defn(dynamic=True)
class Done:
    @workflow.run
    async def run(self, args: Sequence[RawValue]) -> None:
        return None


async def main() -> None:
    # Here, not at import: the workflow sandbox re-imports this module and forbids file access.
    os.environ.setdefault("AGENTIC_TEMPORAL_TASK_QUEUE", "agentic-office")
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))
    from temporalio.worker import Worker

    from agentic.core.config import settings
    from agentic.core.temporal import temporal_client
    from agentic.workflows.activities import pong
    from agentic.workflows.system import PingWorkflow

    client = await temporal_client()
    worker = Worker(
        client, task_queue=settings.temporal_task_queue, workflows=[PingWorkflow, Done], activities=[pong]
    )
    print(f"demo worker on {settings.temporal_task_queue}", flush=True)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
