"""P114 (Fitri, 18 Nov 2026): a task paused at a person's daily AI allowance says whose request it
is and whose AI does it, managers see every paused task (first paused first) and give more for
today only or for every day this week, which starts those tasks again."""

from datetime import UTC, datetime

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Approval, LLMCall, Task, TaskEvent
from agentic.teams import allowance

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_p36 import twin_of, ws_of
from .test_twins import staff_in


def test_a_week_starts_on_monday():
    assert allowance.week_of("2026-11-18") == "2026-11-16"  # a Wednesday
    assert allowance.week_of("2026-11-16") == "2026-11-16"
    assert allowance.week_of("2026-11-22") == "2026-11-16"  # Sunday ends it
    end = allowance.week_end("Asia/Kuala_Lumpur", datetime(2026, 11, 18, 4, tzinfo=UTC))
    assert end == datetime(2026, 11, 22, 16, tzinfo=UTC)  # Monday 23 Nov, 00:00 local


async def _paused_task(client, staff, me: str, twin: dict) -> tuple[str, str]:
    await client.put(
        "/api/allowances/policy",
        json={"daily_tokens": 100, "roles": ["staff"]},
        headers=csrf(client),
    )
    r = await staff.post(
        "/api/tasks",
        json={
            "title": "Prepare the aging report",
            "brief": "By customer.",
            "assignee_agent_id": twin["id"],
        },
        headers=csrf(staff),
    )
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]
    async with SessionLocal() as db:
        db.add(
            LLMCall(
                workspace_id=await ws_of(twin),
                ts=datetime.now(UTC),
                task="agent.chat",
                provider_name="Good",
                model="m1",
                prompt_tokens=150,
                completion_tokens=0,
                status="ok",
                user_id=me,
            )
        )
        await db.commit()
    step = await runtime.run_task_step(task_id)
    assert step.state == "needs_approval"
    return task_id, step.approval_id


async def test_paused_tasks_say_whose_they_are_and_a_gift_starts_them(client, llm, temporal):
    o = await office(client)
    staff = await staff_in(client, o)
    try:
        twin = await twin_of(staff)
        me_body = (await staff.get("/api/auth/me")).json()["user"]
        me, my_name = me_body["id"], me_body["name"]
        # Staff rename their AI as they like: the task still says whose it is.
        r = await staff.patch(
            f"/api/agents/{twin['id']}", json={"name": "Jarvis"}, headers=csrf(staff)
        )
        renamed = r.status_code == 200
        task_id, approval_id = await _paused_task(client, staff, me, twin)

        t = (await client.get(f"/api/tasks/{task_id}")).json()["task"]
        assert t["for_user_id"] == me and t["for_user_name"] == my_name
        assert t["assignee_owner_id"] == me and t["assignee_owner_name"] == my_name
        if renamed:
            assert t["assignee_name"] == "Jarvis"

        # A sub-task of that request is the same person's work.
        async with SessionLocal() as db:
            root = await db.get(Task, task_id)
            child = Task(
                id="tk_p114child",
                workspace_id=root.workspace_id,
                title="A part of it",
                brief="",
                created_by=f"agent:{twin['id']}",
                parent_task_id=task_id,
                root_task_id=task_id,
            )
            who = await allowance.people_of_tasks(db, [child, root])
        assert who == {"tk_p114child": me, task_id: me}

        # Managers see what waits, first paused first; staff do not.
        assert (await staff.get("/api/allowances/paused")).status_code == 403
        paused = (await client.get("/api/allowances/paused")).json()
        assert [(p["task_id"], p["user_id"], p["name"], p["order"]) for p in paused] == [
            (task_id, me, my_name, 1)
        ]
        assert paused[0]["agent_owner_name"] == my_name and paused[0]["used"] == 150
        body = (await client.get("/api/allowances?status=paused")).json()
        assert body["summary"]["paused"] == 1
        assert [p["user_id"] for p in body["people"]] == [me]
        assert body["people"][0]["paused"] == 1 and body["people"][0]["status"] == "over"

        # Not for yourself, and a sensible amount.
        owner_id = (await client.get("/api/auth/me")).json()["user"]["id"]
        r = await client.post(
            f"/api/allowances/{owner_id}/give", json={"tokens": 5000}, headers=csrf(client)
        )
        assert r.status_code == 403 and r.json()["code"] == "self_allowance"
        r = await client.post(
            f"/api/allowances/{me}/give", json={"tokens": 10}, headers=csrf(client)
        )
        assert r.status_code == 422
        r = await staff.post(
            f"/api/allowances/{me}/give", json={"tokens": 5000}, headers=csrf(staff)
        )
        assert r.status_code == 403

        # This week: added to every day to Sunday, and the paused task starts again.
        r = await client.post(
            f"/api/allowances/{me}/give",
            json={"tokens": 1000, "span": "week"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["resumed"] == 1 and out["span"] == "week"
        assert out["person"]["extra_week"] == 1000 and out["person"]["limit"] == 1100
        assert out["person"]["paused"] == 0
        async with SessionLocal() as db:
            a = await db.get(Approval, approval_id)
            assert a.status == "approved" and a.args["given"] == {"tokens": 1000, "span": "week"}
        await runtime.apply_approval(approval_id)
        mine = (await staff.get("/api/me/allowance")).json()
        assert mine["extra"] == 1000 and mine["limit"] == 1100  # not "half again" on top
        async with SessionLocal() as db:
            ev = await db.scalar(
                TaskEvent.__table__.select()
                .where(TaskEvent.task_id == task_id, TaskEvent.kind == "budget")
                .with_only_columns(TaskEvent.text)
            )
        assert ev == "gave 1,000 more AI tokens a day for this week"
        assert (await client.get("/api/allowances/paused")).json() == []

        # Today only adds on top of the week.
        r = await client.post(
            f"/api/allowances/{me}/give",
            json={"tokens": 2000, "span": "today"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        assert r.json()["person"]["extra"] == 3000 and r.json()["person"]["extra_week"] == 1000
        assert r.json()["resumed"] == 0
    finally:
        await staff.aclose()
