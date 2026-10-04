"""Play an agent's work on a demo task, live, for the videos (no model is called).

The demo's provider keys are fake, so a task started in a video would never move. This plays
what a real run looks like through the same events the worker sends: running, a plan ticked
off step by step, tool calls, a self-check, and the result handed in for review.

    uv run python ../../deploy/docs-capture/demo_advance.py --title "Reconcile ..." [--pace 1.2]
    uv run python ../../deploy/docs-capture/demo_advance.py --title "..." --finish-only

Uses AGENTIC_DATABASE_URL / AGENTIC_VALKEY_URL (the demo database and Valkey db 8).
"""

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))
os.environ.setdefault("AGENTIC_TEMPORAL_TASK_QUEUE", "agentic-office")

PLAN = [
    "Read the brief and the files",
    "Gather the figures",
    "Work out the result",
    "Check the totals",
    "Write it up for review",
]
TOOLS = [
    ("read_file", "Read a file", "Read 3 files (bank statement, ageing list, payment schedule)"),
    ("finance_calc", "Finance calculator", "Totals reconcile: RM 1,284.60 difference explained"),
    ("publish_report", "Publish a report", "Report published"),
]
RESULT = (
    "**Done: the summary is ready for your review.**\n\n"
    "| Item | Amount (RM) | Note |\n|---|---:|---|\n"
    "| Collected this week | 488,000 | 12 customers |\n"
    "| Still due this month | 612,300 | 3 over 60 days |\n"
    "| Payments due | 571,400 | payroll on the 25th |\n\n"
    "Next step: chase Seri Murni Foods (RM 92,400) this week; drafts are attached, nothing was sent."
)


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--title", required=True)
    p.add_argument("--pace", type=float, default=1.2)
    p.add_argument("--finish-only", action="store_true")
    a = p.parse_args()

    from sqlalchemy import select

    from agentic.agents import runtime
    from agentic.core.db import SessionLocal, engine
    from agentic.models import Agent, Task
    from agentic.services import events

    async with SessionLocal() as db:
        t = await db.scalar(
            select(Task).where(Task.title == a.title).order_by(Task.created_at.desc()).limit(1)
        )
        if t is None:
            raise SystemExit(f"no task {a.title!r}")
        agent = await db.get(Agent, t.assignee_agent_id)
        who = f"agent:{agent.id}"

        async def activity(kind: str, **data) -> None:
            await runtime.activity(agent, t, kind, **data)

        async def plan(done: int) -> None:
            steps = [
                {"text": s, "status": "done" if i < done else ("doing" if i == done else "todo")}
                for i, s in enumerate(PLAN)
            ]
            await runtime.task_event(db, t, "plan", who, f"plan: {done}/{len(PLAN)} done", {"steps": steps})

        pace = a.pace
        if not a.finish_only:
            await runtime.set_task_status(db, t, "running", actor="system", started_at=datetime.now(UTC), blocked_reason=None)
            await runtime.agent_status(agent, "working", t)
            await asyncio.sleep(pace)
            await activity("think", text="I'll keep a short plan and show my workings.", model="gpt-4.1-mini", tokens=4210)
            await plan(0)
            for i, (tool, label, preview) in enumerate(TOOLS):
                await asyncio.sleep(pace)
                await activity("tool_call", tool=tool, label=label, args="{}")
                await asyncio.sleep(pace * 0.6)
                await activity("tool_result", tool=tool, preview=preview)
                await runtime.task_event(db, t, "tool", who, f"used {label}", {"tool": tool, "args": {}, "result_preview": preview})
                await plan(i + 1 if i < 2 else 4)
        else:
            await runtime.set_task_status(db, t, "running", actor="system", blocked_reason=None)
            await runtime.agent_status(agent, "working", t)
            await asyncio.sleep(pace)
            await activity("tool_call", tool="browser_submit", label="Send a form", args="{}")
            await asyncio.sleep(pace)
            await activity("tool_result", tool="browser_submit", preview="Order PO-NL-1043 submitted; supplier reference SP-88213")
        await asyncio.sleep(pace)
        await runtime.task_event(db, t, "selfcheck", "system", "self-check passed", {"ok": True, "checked": True, "issues": []})
        await asyncio.sleep(pace * 0.6)
        if not a.finish_only:
            await plan(5)
        result = RESULT if not a.finish_only else (
            "**Purchase order PO-NL-1043 was submitted** on the supplier portal (approved by you).\n\n"
            "- 120 rolls of stretch film, RM 2,208.00\n- Supplier reference SP-88213, delivery 9 Oct to the Shah Alam hub\n\n"
            "The GRN will be matched when the goods arrive."
        )
        await runtime.set_task_status(db, t, "review", actor=who, result=result, finished_at=datetime.now(UTC))
        await activity("answer", text="Handed in for review.")
        await runtime.agent_status(agent, "idle", None)
        await events.publish(t.workspace_id, "task.updated", {"task_id": t.id, "status": "review"})
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
