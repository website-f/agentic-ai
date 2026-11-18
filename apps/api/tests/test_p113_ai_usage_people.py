"""P113: AI usage per user, the developer's report (api/routers/ai_people_usage.py).

P115: owners, admins and the system's developer read it (management, branch managers and staff
get 403). The
numbers come straight from the model-call ledger (llm_calls), here synthetic rows.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from agentic.api.routers.ai_people_usage import feature_of, window
from agentic.core.db import SessionLocal
from agentic.core.security import hash_password
from agentic.models import LLMCall, Membership, Task, User, Workspace

from .test_agents import new_agent, office
from .test_office_roles import as_role
from .test_p73_feedback import make_dev

BASE = "/api/ai/people-usage"
HASH = hash_password("not-used-in-these-tests")
KL = ZoneInfo("Asia/Kuala_Lumpur")


async def _ws() -> Workspace:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace).order_by(Workspace.created_at))).first()


async def _person(name: str, role: str | None, branch_id: str | None = None) -> str:
    ws = await _ws()
    async with SessionLocal() as db:
        u = User(email=f"{name.lower()}@example.com", name=name, password_hash=HASH)
        db.add(u)
        await db.flush()
        if role:
            db.add(Membership(workspace_id=ws.id, user_id=u.id, role=role, branch_id=branch_id))
        await db.commit()
        return u.id


async def _call(user_id, task, prompt, completion, cost, ts, **extra) -> None:
    ws = await _ws()
    async with SessionLocal() as db:
        db.add(
            LLMCall(
                workspace_id=ws.id,
                ts=ts,
                task=task,
                provider_name="Good",
                model="m1",
                group_name="smart",
                user_id=user_id,
                prompt_tokens=prompt,
                completion_tokens=completion,
                cost_usd=cost,
                status=extra.pop("status", "ok"),
                error_detail="the provider's words" if extra.get("error_class") else None,
                **extra,
            )
        )
        await db.commit()


def test_features_and_periods():
    assert feature_of("agent.chat") == "chat"
    assert feature_of("agent.chat.backup") == "chat"
    assert feature_of("agent.task") == "agent_task"
    assert feature_of("document.write") == "documents"
    assert feature_of("minutes.write") == "meetings"
    assert feature_of("brain.dream") == "learning"
    assert feature_of("something.new") == "other"
    now = datetime(2026, 3, 1, 1, 0, tzinfo=UTC)  # 09:00 on 1 March in Kuala Lumpur
    w = window("Asia/Kuala_Lumpur", "last_month", None, None, now)
    assert (w.start, w.end) == (date(2026, 2, 1), date(2026, 2, 28))
    assert w.since == datetime(2026, 1, 31, 16, 0, tzinfo=UTC)  # midnight KL
    assert w.until == datetime(2026, 2, 28, 16, 0, tzinfo=UTC)
    w = window("Asia/Kuala_Lumpur", "7d", None, None, now)
    assert (w.start, w.end) == (date(2026, 2, 23), date(2026, 3, 1))
    w = window("Asia/Kuala_Lumpur", "month", None, None, now)
    assert (w.start, w.end) == (date(2026, 3, 1), date(2026, 3, 1))


async def test_owners_admins_and_the_developer_see_it(client):
    """P115 (Fitri, 18 Nov 2026): owners and admins too; every other role 403."""
    o = await office(client)
    admin = await as_role(client, "ada@example.com", "admin")
    staff = await as_role(client, "sam@example.com", "staff", branch_id=o["branch"]["id"])
    mgmt = await as_role(client, "mia@example.com", "management")
    hod = await as_role(client, "hana@example.com", "branch_manager", branch_id=o["branch"]["id"])
    urls = (BASE, f"{BASE}/office", f"{BASE}/office/events")
    for c in (staff, mgmt, hod):
        for url in urls:
            assert (await c.get(url)).status_code == 403, url
    for c in (client, admin):  # client = a plain owner (no developer flag)
        for url in urls:
            assert (await c.get(url)).status_code == 200, url
    await make_dev()
    for url in urls:
        assert (await client.get(url)).status_code == 200, url
    for c in (admin, staff, mgmt, hod):
        await c.aclose()


async def test_numbers_filters_and_report(client):
    o = await office(client)
    await make_dev()
    ws = await _ws()
    agent = await new_agent(client, o, "Ana")
    branch = o["branch"]["id"]
    a = await _person("Aina", "staff", branch)
    b = await _person("Badrul", "admin")
    gone = await _person("Chong", None)  # used AI, no longer a member
    async with SessionLocal() as db:
        task = Task(workspace_id=ws.id, title="Quarterly report", created_by="test")
        db.add(task)
        await db.commit()
        task_id = task.id

    now = datetime.now(UTC)
    today = now.astimezone(KL).date()
    s = timedelta(seconds=1)
    await _call(a, "agent.chat", 1000, 200, 0.01, now - 4 * s, agent_id=agent["id"])
    await _call(
        a, "agent.task", 3000, 500, 0.05, now - 3 * s, agent_id=agent["id"], task_id=task_id
    )
    await _call(a, "document.write", 500, 100, None, now - 2 * s)  # unpriced
    await _call(
        a,
        "agent.task",
        100,
        0,
        None,
        now - s,
        agent_id=agent["id"],
        status="error",
        error_class="timeout",
    )
    await _call(b, "document.write", 2000, 0, 0.02, now - timedelta(days=3))
    await _call(gone, "agent.chat", 400, 100, 0.005, now)
    await _call(None, "brain.dream", 600, 0, 0.001, now)  # the office's own work
    await _call(b, "agent.chat", 9999, 0, 0.1, now - timedelta(days=20))  # outside 7 days
    first_of_last = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    await _call(a, "agent.chat", 7000, 0, 0.07, datetime.combine(first_of_last, time(12), KL))

    r = await client.get(BASE, params={"period": "7d", "page": 1, "size": 25})
    assert r.status_code == 200, r.text
    body = r.json()
    t = body["totals"]
    assert body["currency"] == "USD" and body["period"]["days"] == 7
    assert t["tokens"] == 8500 and t["calls"] == 7 and t["errors"] == 1 and t["unpriced"] == 1
    assert round(t["cost_usd"], 6) == 0.086
    assert t["active_users"] == 3 and t["office_tokens"] == 600 and t["office_calls"] == 1
    assert t["top_feature"] == "agent_task" and t["top_feature_tokens"] == 3600
    people = body["people"]
    assert [p["user_id"] for p in people[:3]] == [a, b, gone]  # most tokens first
    pa = people[0]
    assert (pa["calls"], pa["prompt"], pa["completion"], pa["tokens"]) == (4, 4600, 800, 5400)
    assert round(pa["cost_usd"], 6) == 0.06 and pa["unpriced"] == 1 and pa["errors"] == 1
    assert pa["share"] == 63.53 and pa["top_feature"] == "agent_task"
    assert pa["role"] == "staff" and pa["branch_name"] == o["branch"]["name"]
    assert pa["today_used"] == 5400 and pa["today_limit"] == 300_000
    assert pa["last_used"] is not None
    assert people[2]["member"] is False and people[2]["role"] == ""
    assert all(p["tokens"] == 0 for p in people[3:])  # members who used none, at the end
    assert int(r.headers["X-Total-Count"]) == len(people)

    # Sort, search, filters.
    r = await client.get(BASE, params={"period": "7d", "page": 1, "sort": "tokens"})
    assert r.json()["people"][-1]["user_id"] == a
    r = await client.get(BASE, params={"period": "7d", "page": 1, "q": "badrul"})
    assert [p["user_id"] for p in r.json()["people"]] == [b]
    r = await client.get(BASE, params={"period": "7d", "role": "staff"})
    assert a in {p["user_id"] for p in r.json()["people"]}
    assert all(p["role"] == "staff" for p in r.json()["people"])
    r = await client.get(BASE, params={"period": "7d", "branch": branch})
    assert [p["user_id"] for p in r.json()["people"]] == [a]
    assert (await client.get(BASE, params={"sort": "nope"})).status_code == 422

    # Periods.
    r = (await client.get(BASE, params={"period": "today"})).json()
    by = {p["user_id"]: p for p in r["people"]}
    assert by[a]["tokens"] == 5400 and by[b]["tokens"] == 0 and r["totals"]["tokens"] == 6500
    r = (await client.get(BASE, params={"period": "month"})).json()
    assert {p["user_id"]: p for p in r["people"]}[a]["tokens"] == 5400
    r = (await client.get(BASE, params={"period": "last_month"})).json()
    assert {p["user_id"]: p for p in r["people"]}[a]["tokens"] == 7000
    day = (today - timedelta(days=3)).isoformat()
    r = await client.get(BASE, params={"period": "custom", "start": day, "end": day})
    by = {p["user_id"]: p for p in r.json()["people"]}
    assert by[b]["tokens"] == 2000 and by[a]["tokens"] == 0
    for bad in (
        {"period": "custom"},
        {"period": "custom", "start": day, "end": (today - timedelta(days=5)).isoformat()},
        {"period": "custom", "start": "2024-01-01", "end": "2025-06-01"},
        {"period": "forever"},
    ):
        assert (await client.get(BASE, params=bad)).status_code == 422, bad

    # One person's full report.
    r = await client.get(f"{BASE}/{a}", params={"period": "7d"})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["person"]["name"] == "Aina" and rep["person"]["today_used"] == 5400
    assert rep["totals"]["tokens"] == 5400 and rep["tasks"] == 1
    feats = {f["feature"]: f for f in rep["by_feature"]}
    assert feats["agent_task"]["tokens"] == 3600 and feats["agent_task"]["calls"] == 2
    assert feats["chat"]["tokens"] == 1200 and feats["documents"]["tokens"] == 600
    assert rep["by_feature"][0]["feature"] == "agent_task"
    purposes = {p["purpose"]: p for p in rep["by_purpose"]}
    assert purposes["document.write"]["charged"] is True
    agents = {g["agent_id"]: g for g in rep["by_agent"]}
    assert agents[agent["id"]]["name"] == "Ana" and agents[agent["id"]]["tokens"] == 4800
    assert agents[None]["tokens"] == 600
    assert rep["by_model"][0]["model"] == "m1" and rep["by_model"][0]["group"] == "smart"
    assert len(rep["daily"]) == 7 and rep["daily"][-1] == {
        "day": today.isoformat(),
        "calls": 4,
        "tokens": 5400,
        "cost_usd": 0.06,
    }

    # Their calls, one page: what for, which task, never what was said.
    r = await client.get(f"{BASE}/{a}/events", params={"period": "7d", "page": 1, "size": 10})
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "4"
    ev = r.json()
    assert [e["purpose"] for e in ev] == [
        "agent.task",
        "document.write",
        "agent.task",
        "agent.chat",
    ]
    assert ev[0]["status"] == "error" and ev[0]["error_class"] == "timeout"
    assert all("error_detail" not in e and "content" not in e for e in ev)
    assert ev[2]["task_title"] == "Quarterly report" and ev[2]["agent_name"] == "Ana"
    r = await client.get(
        f"{BASE}/{a}/events", params={"period": "7d", "page": 1, "feature": "agent_task"}
    )
    assert r.headers["X-Total-Count"] == "2"
    r = await client.get(
        f"{BASE}/{a}/events", params={"period": "7d", "page": 1, "sort": "-tokens"}
    )
    assert r.json()[0]["tokens"] == 3500
    r = await client.get(f"{BASE}/{a}/events", params={"period": "7d", "page": 1, "q": "document"})
    assert r.headers["X-Total-Count"] == "1"
    assert (await client.get(f"{BASE}/{a}/events", params={"feature": "nope"})).status_code == 422

    # The office's own work, someone who left, and someone who was never here.
    rep = (await client.get(f"{BASE}/office", params={"period": "7d"})).json()
    assert rep["totals"]["tokens"] == 600 and rep["by_feature"][0]["feature"] == "learning"
    assert rep["by_purpose"][0]["charged"] is False
    rep = (await client.get(f"{BASE}/{gone}", params={"period": "7d"})).json()
    assert rep["person"]["member"] is False and rep["totals"]["tokens"] == 500
    assert (await client.get(f"{BASE}/us_nobody")).status_code == 404
