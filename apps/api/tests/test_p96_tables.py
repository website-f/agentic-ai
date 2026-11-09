"""P96: data tables. The AI use and limits list is searched, filtered, sorted and paged on the
server (api/table.py), works out everyone's use in a few queries, and keeps its permissions."""

from datetime import UTC, datetime

from sqlalchemy import func, select

from agentic.core.db import SessionLocal
from agentic.core.security import hash_password
from agentic.models import LLMCall, Membership, User, Workspace

from .conftest import csrf
from .test_agents import office
from .test_office_roles import member, signed_in

HASH = hash_password("not-used-in-these-tests")


async def _ws() -> Workspace:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace).order_by(Workspace.created_at))).first()


async def _people(n: int, branch_id: str | None, role: str = "staff", start: int = 0) -> list[str]:
    ws = await _ws()
    ids = []
    async with SessionLocal() as db:
        for i in range(start, start + n):
            u = User(email=f"person{i:03d}@example.com", name=f"Person {i:03d}", password_hash=HASH)
            db.add(u)
            await db.flush()
            db.add(Membership(workspace_id=ws.id, user_id=u.id, role=role, branch_id=branch_id))
            ids.append(u.id)
        await db.commit()
    return ids


async def _used(user_id: str, tokens: int, cost: float = 0.0, task: str = "chat") -> None:
    ws = await _ws()
    async with SessionLocal() as db:
        db.add(
            LLMCall(
                workspace_id=ws.id,
                ts=datetime.now(UTC),
                task=task,
                provider_name="Good",
                model="m1",
                user_id=user_id,
                prompt_tokens=tokens,
                completion_tokens=0,
                cost_usd=cost,
                status="ok",
            )
        )
        await db.commit()


async def _table(c, **params) -> tuple[dict, int]:
    r = await c.get("/api/allowances", params={"page": 1, "size": 10, **params})
    assert r.status_code == 200, r.text
    return r.json(), int(r.headers["X-Total-Count"])


async def test_ai_use_is_a_searchable_sortable_paged_table(client):
    o = await office(client)
    bid = o["branch"]["id"]
    ids = await _people(30, bid)
    await _people(5, None, role="viewer", start=100)
    # Staff get the default 50,000 a day: one over, one near, one a little, and one learning
    # call that never counts.
    await _used(ids[0], 60_000, cost=0.5)
    await _used(ids[1], 45_000, cost=0.25)
    await _used(ids[2], 1_000)
    await _used(ids[3], 99_000, task="skill.learn")

    # The old shape still answers without ?page= (everyone, most used first).
    plain = (await client.get("/api/allowances")).json()
    assert len(plain["people"]) == 36 and plain["total"] == 36
    assert plain["people"][0]["user_id"] == ids[0]
    assert plain["summary"] == {
        "people": 36,
        "over": 1,
        "near": 1,
        "used": 106_000,
        "cost_usd": 0.75,
    }

    first, total = await _table(client)
    assert total == 36 and first["total"] == 36 and len(first["people"]) == 10
    top = first["people"][0]
    assert top["user_id"] == ids[0] and top["status"] == "over" and top["pct"] == 120
    assert top["cost_usd"] == 0.5 and top["branch_name"] == "Maju Sdn Bhd"
    assert first["people"][1]["status"] == "near"
    last, _ = await _table(client, page=4)
    assert len(last["people"]) == 6
    pages = [first] + [(await _table(client, page=p))[0] for p in (2, 3, 4)]
    seen = [x["user_id"] for pg in pages for x in pg["people"]]
    assert len(set(seen)) == 36

    # Find a person by name or email; every word must match.
    found, n = await _table(client, q="person 007")
    assert n == 1 and found["people"][0]["name"] == "Person 007"
    found, n = await _table(client, q="PERSON101@example")
    assert n == 1 and found["people"][0]["role"] == "viewer"
    # The tiles keep counting everyone in scope whatever the search.
    assert found["summary"]["people"] == 36

    # Filters: role, branch (or none), status.
    _, n = await _table(client, role="viewer")
    assert n == 5
    _, n = await _table(client, branch="none")
    assert n == 6  # the five viewers and the owner
    _, n = await _table(client, branch=bid)
    assert n == 30
    over, n = await _table(client, status="over")
    assert n == 1 and over["people"][0]["user_id"] == ids[0]
    _, n = await _table(client, status="unlimited")
    assert n == 6  # viewers and the owner have no default limit
    _, n = await _table(client, status="limited")
    assert n == 30

    # Sorting by any column, both ways; blanks (no limit) go last either way.
    by_name, _ = await _table(client, sort="name", role="staff")
    assert [x["name"] for x in by_name["people"][:2]] == ["Person 000", "Person 001"]
    by_name, _ = await _table(client, sort="-name", role="staff")
    assert by_name["people"][0]["name"] == "Person 029"
    by_used, _ = await _table(client, sort="used")
    assert by_used["people"][-1]["used"] == 0
    by_pct, _ = await _table(client, sort="-pct", size=50)
    assert by_pct["people"][0]["pct"] == 120 and by_pct["people"][-1]["pct"] is None
    by_pct, _ = await _table(client, sort="pct", size=50)
    assert by_pct["people"][0]["pct"] == 0 and by_pct["people"][-1]["pct"] is None
    r = await client.get("/api/allowances", params={"page": 1, "sort": "password"})
    assert r.status_code == 422 and r.json()["code"] == "bad_sort"

    # Editing a row answers the row in the same shape.
    r = await client.put(
        f"/api/allowances/{ids[0]}", json={"daily_tokens": 0}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["status"] == "unlimited" and row["pct"] is None and row["branch_id"] == bid


async def test_ai_use_table_keeps_its_walls(client):
    o = await office(client)
    bid = o["branch"]["id"]
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    await _people(4, bid)
    await _people(3, b2["id"], start=50)
    bm = await member(client, "bm@example.com", "branch_manager", branch_id=bid)
    c = await signed_in("bm@example.com", bm["temp_password"])
    page, n = await _table(c)
    # Their branch (four staff and themselves), never the other company, even by search.
    assert n == 5 and page["summary"]["people"] == 5
    _, n = await _table(c, q="person 050")
    assert n == 0
    _, n = await _table(c, branch=b2["id"])
    assert n == 0

    staff = await member(client, "staff@example.com", "staff", branch_id=bid)
    s = await signed_in("staff@example.com", staff["temp_password"])
    r = await s.get("/api/allowances", params={"page": 1})
    assert r.status_code == 403


# ------------------------------------------------- the other lists that became tables


async def test_activity_approvals_and_contacts_come_in_numbered_pages(client):
    from datetime import timedelta

    from agentic.models import Approval, AuditLog, Task

    from .test_pagination import add, at, owner

    o = await owner(client)
    # Activity: the setup wrote a few entries; add 30 more, some about a person by name.
    async with SessionLocal() as db:
        from agentic.services import audit

        for i in range(30):
            await audit.record(
                db,
                o["ws"],
                f"user:{o['user']}",
                "task.created" if i % 2 else "file.uploaded",
                target=f"t{i}",
                note=f"Rondaan malam {i}" if i % 5 == 0 else None,
            )
        await db.commit()
        everything = await db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.workspace_id == o["ws"])
        )
    r = await client.get("/api/audit", params={"page": 1, "size": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    assert int(r.headers["X-Total-Count"]) == everything and len(body["items"]) == 10
    assert body["kinds"] and "X-Next-Cursor" not in r.headers
    ids = [x["id"] for x in body["items"]]
    assert ids == sorted(ids, reverse=True)  # newest first
    oldest = (await client.get("/api/audit", params={"page": 1, "size": 10, "sort": "ts"})).json()
    assert [x["id"] for x in oldest["items"]] == sorted(x["id"] for x in oldest["items"])
    assert oldest["items"][0]["id"] < ids[-1]
    r = await client.get("/api/audit", params={"page": 1, "q": "rondaan"})
    assert int(r.headers["X-Total-Count"]) == 6
    r = await client.get("/api/audit", params={"page": 1, "q": "owner task.created"})
    assert int(r.headers["X-Total-Count"]) == 15  # by the owner's name, and the action
    r = await client.get("/api/audit", params={"page": 1, "kind": "work", "q": "file"})
    assert int(r.headers["X-Total-Count"]) == 15
    # The lazy list still pages by cursor, and its count follows the search.
    r = await client.get("/api/audit", params={"limit": 4, "q": "rondaan"})
    assert len(r.json()["items"]) == 4 and int(r.headers["X-Total-Count"]) == 6
    r = await client.get("/api/audit", params={"page": 1, "sort": "actor"})
    assert r.status_code == 422

    # Approvals history: numbered pages, words, outcome, and the decided order.
    task = Task(
        workspace_id=o["ws"], title="Bayar invois pembekal", created_by="user:x", created_at=at(0)
    )
    await add(task)
    await add(
        *[
            Approval(
                workspace_id=o["ws"],
                task_id=task.id,
                agent_id=o["agent"],
                tool_name="send_email" if i % 2 else "browser_submit",
                tool_call_id=f"c{i}",
                reason=f"Reason {i}",
                status=("approved", "denied", "pending")[i % 3],
                created_at=at(i * 3),
                decided_at=at(100 - i * 3),
                expires_at=at(i) + timedelta(days=1),
            )
            for i in range(17)
        ]
    )
    r = await client.get("/api/approvals", params={"state": "history", "page": 1, "size": 5})
    assert int(r.headers["X-Total-Count"]) == 12 and len(r.json()) == 5
    first = r.json()
    assert first[0]["created_at"] >= first[-1]["created_at"]
    r = await client.get("/api/approvals", params={"state": "history", "page": 3, "size": 5})
    assert len(r.json()) == 2
    r = await client.get("/api/approvals", params={"state": "history", "page": 1, "q": "browser"})
    assert int(r.headers["X-Total-Count"]) == 6
    r = await client.get(
        "/api/approvals", params={"state": "history", "page": 1, "q": "invois aina"}
    )
    assert int(r.headers["X-Total-Count"]) == 12  # the task's title and the agent's name
    r = await client.get(
        "/api/approvals", params={"state": "history", "page": 1, "status": "denied"}
    )
    assert int(r.headers["X-Total-Count"]) == 6
    by_decided = (
        await client.get(
            "/api/approvals", params={"state": "history", "page": 1, "size": 50, "sort": "decided"}
        )
    ).json()
    assert [a["decided_at"] for a in by_decided] == sorted(a["decided_at"] for a in by_decided)

    # Contacts: numbered pages with the total, sorted both ways.
    for i in range(12):
        r = await client.post(
            "/api/parties",
            json={"name": f"Syarikat {i:02d}", "roles": ["customer"]},
            headers=csrf(client),
        )
        assert r.status_code in (200, 201), r.text
    r = await client.get("/api/parties", params={"page": 2, "size": 5})
    assert r.status_code == 200, r.text
    assert int(r.headers["X-Total-Count"]) == 12 and r.json()["total"] == 12
    assert [p["name"] for p in r.json()["items"]] == [f"Syarikat {i:02d}" for i in range(5, 10)]
    r = await client.get("/api/parties", params={"page": 1, "size": 3, "sort": "-name"})
    assert [p["name"] for p in r.json()["items"]] == ["Syarikat 11", "Syarikat 10", "Syarikat 09"]
    r = await client.get("/api/parties", params={"page": 1, "q": "syarikat 07"})
    assert r.json()["total"] == 1  # the phrase, as before
    r = await client.get("/api/parties", params={"page": 1, "sort": "balance"})
    assert r.status_code == 422


async def test_the_run_ledger_comes_in_numbered_pages(client):
    from agentic.models import JobRun, Schedule

    from .test_pagination import add, at, owner

    o = await owner(client)
    # The ledger shows runs of schedules whose agent the person sees.
    sched = Schedule(
        workspace_id=o["ws"],
        name="Semak portal tender",
        agent_id=o["agent"],
        title="Semak",
        cron="0 9 * * *",
        created_by="user:x",
    )
    await add(sched)
    await add(
        *[
            JobRun(
                workspace_id=o["ws"],
                schedule_id=sched.id,
                job="heartbeat" if i % 2 else "schedule",
                status="failed" if i % 5 == 0 else "completed",
                error="Portal tamat masa" if i % 5 == 0 else None,
                started_at=at(i),
            )
            for i in range(23)
        ]
    )
    r = await client.get("/api/runs", params={"page": 1, "size": 10})
    assert r.status_code == 200, r.text
    assert int(r.headers["X-Total-Count"]) == 23 and len(r.json()) == 10
    ids = [x["id"] for x in r.json()]
    assert ids == sorted(ids, reverse=True)
    r = await client.get("/api/runs", params={"page": 3, "size": 10, "sort": "started"})
    assert len(r.json()) == 3
    r = await client.get("/api/runs", params={"page": 1, "q": "tamat"})
    assert int(r.headers["X-Total-Count"]) == 5
    r = await client.get("/api/runs", params={"page": 1, "q": "portal tender"})
    assert int(r.headers["X-Total-Count"]) == 23  # the schedule's name
    r = await client.get("/api/runs", params={"page": 1, "job": "heartbeat", "status": "failed"})
    assert int(r.headers["X-Total-Count"]) == 2  # 5 and 15
    # The old shape (the newest 100) still answers without ?page=.
    assert len((await client.get("/api/runs")).json()) == 23
