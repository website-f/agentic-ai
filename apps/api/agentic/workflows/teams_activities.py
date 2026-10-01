"""Activities for P7: delegation, meetings, heartbeats, schedules."""

from typing import Any

from temporalio import activity

from ..core.db import SessionLocal
from ..models import Meeting
from ..teams import delegation, heartbeat, meetings, schedules


@activity.defn
async def task_collect_children(task_id: str, call_id: str) -> None:
    async with SessionLocal() as db:
        await delegation.collect(db, task_id, call_id)


@activity.defn
async def task_meeting_result(task_id: str, call_id: str, meeting_id: str) -> None:
    from ..agents import runtime

    async with SessionLocal() as db:
        m = await db.get(Meeting, meeting_id)
        await runtime.add_tool_result(
            db,
            task_id,
            call_id,
            "consult",
            meetings.result_for_tool(m) if m else "The meeting is gone.",
        )


@activity.defn
async def meeting_plan(meeting_id: str) -> dict[str, Any]:
    """Where to (re)start: participants and the first round still to hold."""
    async with SessionLocal() as db:
        m = await db.get(Meeting, meeting_id)
        if m is None or m.status != "running":
            return {"participants": [], "start": 1, "rounds": 0}
        return {
            "participants": list(m.participant_ids),
            "start": m.rounds_done + 1,
            "rounds": m.max_rounds,
        }


@activity.defn
async def meeting_turn(meeting_id: str, rnd: int, agent_id: str) -> dict[str, Any]:
    return await meetings.take_turn(meeting_id, rnd, agent_id)


@activity.defn
async def meeting_round_done(meeting_id: str, rnd: int) -> None:
    await meetings.finish_round(meeting_id, rnd)


@activity.defn
async def meeting_close(meeting_id: str) -> dict[str, Any]:
    return await meetings.close(meeting_id)


@activity.defn
async def heartbeat_tick() -> dict[str, int]:
    return await heartbeat.tick()


@activity.defn
async def schedule_claim(schedule_id: str, manual: bool) -> dict[str, str] | None:
    return await schedules.claim(schedule_id, manual)


@activity.defn
async def schedule_attempt(run_id: str, n: int) -> str:
    return await schedules.attempt(run_id, n)


@activity.defn
async def schedule_finish(run_id: str, state: str) -> None:
    await schedules.finish(run_id, state)
