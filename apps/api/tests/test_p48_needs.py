"""P48 "Needs you": what waits on each person, only what they may act on."""

from agentic.agents import runtime
from agentic.core.db import SessionLocal
from agentic.models import Task

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401
from .test_office_roles import as_role


def counts(body: dict) -> dict[str, int]:
    return {i["key"]: i["count"] for i in body["items"]}


async def test_needs_you_counts_only_what_each_person_may_act_on(client, llm, temporal):
    o = await office(client)
    fin = await new_agent(client, o, "Faiz", "Finance")
    r = await client.get("/api/me/needs")
    assert r.status_code == 200
    assert {k: r.json()[k] for k in ("total", "items", "entries", "unread")} == {
        "total": 0,
        "items": [],
        "entries": [],
        "unread": 0,
    }

    # An approval (a tool that asks) and a failed task of mine.
    t = await new_task(client, fin, "Check the supplier's price")
    await client.post(f"/api/tasks/{t['id']}/start", json={}, headers=csrf(client))
    llm.call("web_fetch", url="https://good.fake/page", why="Need today's price")
    assert (await runtime.run_task_step(t["id"])).state == "needs_approval"
    failed = await new_task(client, fin, "Pay the vendor")
    async with SessionLocal() as db:
        row = await db.get(Task, failed["id"])
        assert row is not None
        row.status = "failed"
        await db.commit()

    got = (await client.get("/api/me/needs")).json()
    c = counts(got)
    assert c["approvals"] == 1 and c["failed"] == 1
    assert "bills" not in c  # P102: Money and its bills are gone
    assert got["total"] == sum(c.values()) - c.get("routines", 0)

    # A staff member sees none of the owner's items.
    staff = await as_role(client, "aina@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        mine = (await staff.get("/api/me/needs")).json()
        assert "failed" not in counts(mine)
        assert "approvals" not in counts(mine)
    finally:
        await staff.aclose()
