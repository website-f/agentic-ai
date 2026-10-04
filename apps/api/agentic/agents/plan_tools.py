"""A visible plan for multi-step work (P19, like Hermes' todo list, but people can watch it).

The agent writes a short checklist at the start of a bigger task and ticks it off as it goes.
Each update is a task event (kind "plan"), so the task sheet shows the live checklist and the
history of how the plan changed. Nothing is stored anywhere else.
"""

from typing import Any

from .tools import Tool, ToolContext

MAX_STEPS = 12
STATUSES = ("todo", "doing", "done", "skipped")


def clean(raw: Any) -> list[dict[str, str]]:
    steps: list[dict[str, str]] = []
    for s in raw if isinstance(raw, list) else []:
        if isinstance(s, str):
            s = {"text": s}
        if not isinstance(s, dict):
            continue
        text = " ".join(str(s.get("text") or "").split())[:160]
        if not text:
            continue
        status = str(s.get("status") or "todo").lower()
        steps.append({"text": text, "status": status if status in STATUSES else "todo"})
    return steps[:MAX_STEPS]


async def _update_plan(ctx: ToolContext, args: dict[str, Any]) -> str:
    if ctx.task is None:
        return "Plans are for tasks. In chat, just answer."
    steps = clean(args.get("steps"))
    if not steps:
        return (
            "Error: give the steps as a list, e.g. "
            "[{'text': 'Collect the invoices', 'status': 'done'}]."
        )
    if sum(1 for s in steps if s["status"] == "doing") > 1:
        return "Error: only one step can be in progress at a time."
    from .runtime import task_event  # late: runtime imports the tools

    done = sum(1 for s in steps if s["status"] in ("done", "skipped"))
    await task_event(
        ctx.db,
        ctx.task,
        "plan",
        f"agent:{ctx.agent.id}",
        f"plan: {done}/{len(steps)} done",
        {"steps": steps},
    )
    await ctx.db.commit()
    nxt = next((s["text"] for s in steps if s["status"] in ("doing", "todo")), None)
    return f"Plan saved ({done}/{len(steps)} done)." + (f" Next: {nxt}." if nxt else " All done.")


PLAN_TOOLS = (
    Tool(
        "update_plan",
        "Keep a plan",
        "For work with several steps: write a short plan (3-8 steps) before you start, then "
        "send the whole list again with each step's status (todo, doing, done, skipped) as you "
        "go. People watch it live on the task. Skip it for one-step work.",
        {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "status": {"type": "string", "enum": list(STATUSES)},
                        },
                        "required": ["text"],
                    },
                }
            },
            "required": ["steps"],
        },
        "low",
        "allow",
        _update_plan,
    ),
)
