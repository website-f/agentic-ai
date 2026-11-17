"""P107: the Feedbacks inbox and the Channels delivery ledger are data tables. With ?page= they
answer one numbered page (api/table.py: q, page, size, sort) and the matching rows in
X-Total-Count; without it they answer exactly as before."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.models import Delivery, Feedback, Workspace

from .conftest import setup_owner
from .test_p73_feedback import make_dev

T0 = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)


async def _ws_id() -> str:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace.id).order_by(Workspace.created_at))).first()


async def _feedback(n: int) -> list[str]:
    """n pieces, one a minute: every third a bug from Ana, the rest ideas from Ben; every
    fourth planned."""
    ws = await _ws_id()
    ids = []
    async with SessionLocal() as db:
        for i in range(n):
            f = Feedback(
                workspace_id=ws,
                author_name="Ana" if i % 3 == 0 else "Ben",
                author_role="staff",
                kind="general",
                category="bug" if i % 3 == 0 else "idea",
                note=f"note {i:02d} " + ("broken button" if i % 3 == 0 else "dark mode"),
                page_path="/tasks" if i % 2 else "/reports",
                status="planned" if i % 4 == 0 else "new",
                created_at=T0 + timedelta(minutes=i),
                updated_at=T0 + timedelta(minutes=i),
            )
            db.add(f)
            await db.flush()
            ids.append(f.id)
        await db.commit()
    return ids


async def test_feedback_inbox_pages_on_the_server(client):
    await setup_owner(client)
    await make_dev()
    ids = await _feedback(30)

    # Without ?page= the old answer: everything (up to limit), newest first, no total header.
    plain = await client.get("/api/feedback")
    assert plain.status_code == 200
    body = plain.json()
    assert [i["id"] for i in body["items"]] == ids[::-1]
    assert body["total"] == 30 and body["counts"] == {"new": 22, "planned": 8}
    assert len((await client.get("/api/feedback", params={"limit": 5})).json()["items"]) == 5
    # The old one-phrase search still works the old way.
    assert (
        len((await client.get("/api/feedback", params={"q": "broken button"})).json()["items"])
        == 10
    )

    # One numbered page, newest first by default, the matching count in the header.
    r = await client.get("/api/feedback", params={"page": 2, "size": 10})
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "30"
    assert [i["id"] for i in r.json()["items"]] == ids[::-1][10:20]
    assert r.json()["total"] == 30  # the status tabs keep the whole inbox's counts

    # Words (each must match somewhere), a status and a kind filter, and a sort.
    r = await client.get("/api/feedback", params={"page": 1, "size": 50, "q": "ana tasks"})
    assert r.headers["X-Total-Count"] == "5"  # i = 3, 9, 15, 21, 27
    assert all(i["author_name"] == "Ana" and i["page_path"] == "/tasks" for i in r.json()["items"])
    r = await client.get(
        "/api/feedback", params={"page": 1, "size": 50, "status": "planned", "category": "idea"}
    )
    assert r.headers["X-Total-Count"] == "5"  # i = 4, 8, 16, 20, 28
    assert r.json()["counts"] == {"new": 15, "planned": 5}  # the kind filter, all statuses
    r = await client.get("/api/feedback", params={"page": 1, "size": 3, "sort": "when"})
    assert [i["id"] for i in r.json()["items"]] == ids[:3]
    r = await client.get("/api/feedback", params={"page": 1, "size": 50, "sort": "-from"})
    names = [i["author_name"] for i in r.json()["items"]]
    assert names == sorted(names, reverse=True)

    # Past the end: an empty page; an unknown column is refused.
    r = await client.get("/api/feedback", params={"page": 9, "size": 10})
    assert r.json()["items"] == [] and r.headers["X-Total-Count"] == "30"
    r = await client.get("/api/feedback", params={"page": 1, "sort": "note"})
    assert r.status_code == 422 and r.json()["code"] == "bad_sort"


async def test_feedback_table_stays_the_developers(client):
    await setup_owner(client)
    # P109: owners (and management) read and page through it too; staff never do
    # (tests/test_p109_org_library_feedback.py).
    assert (await client.get("/api/feedback", params={"page": 1})).status_code == 200


async def _deliveries(n: int) -> list[str]:
    ws = await _ws_id()
    ids = []
    async with SessionLocal() as db:
        for i in range(n):
            d = Delivery(
                workspace_id=ws,
                channel="telegram" if i % 2 else "webpush",
                target=f"t{i}",
                kind="approval" if i % 3 else "reply",
                payload={"title": f"Approve invoice {i:02d}"}
                if i % 3
                else {"text": f"Reply {i:02d}"},
                state="failed" if i % 5 == 0 else "sent",
                attempts=3 if i % 5 == 0 else 1,
                last_error="timed out" if i % 5 == 0 else None,
                created_at=T0 + timedelta(minutes=i),
            )
            db.add(d)
            await db.flush()
            ids.append(d.id)
        await db.commit()
    return ids


async def test_delivery_ledger_pages_on_the_server(client):
    await setup_owner(client)
    ids = await _deliveries(24)

    # The old answer: newest first, at most `limit`, counts of the whole ledger.
    plain = (await client.get("/api/deliveries")).json()
    assert [i["id"] for i in plain["items"]] == ids[::-1]
    assert plain["counts"] == {"failed": 5, "sent": 19}
    assert len((await client.get("/api/deliveries", params={"limit": 4})).json()["items"]) == 4
    failed = (await client.get("/api/deliveries", params={"state": "failed"})).json()
    assert len(failed["items"]) == 5

    r = await client.get("/api/deliveries", params={"page": 2, "size": 10})
    assert r.headers["X-Total-Count"] == "24"
    assert [i["id"] for i in r.json()["items"]] == ids[::-1][10:20]
    assert r.json()["counts"] == {"failed": 5, "sent": 19}

    # A channel, a state and words (what it said, its kind or its error).
    r = await client.get(
        "/api/deliveries", params={"page": 1, "size": 50, "channel": "telegram", "state": "failed"}
    )
    assert r.headers["X-Total-Count"] == "2"  # i = 5, 15
    r = await client.get("/api/deliveries", params={"page": 1, "size": 50, "q": "invoice 1"})
    assert {i["summary"] for i in r.json()["items"]} == {
        f"Approve invoice {i:02d}" for i in range(24) if i % 3 and "1" in f"{i:02d}"
    }
    r = await client.get("/api/deliveries", params={"page": 1, "size": 50, "q": "timed"})
    assert r.headers["X-Total-Count"] == "5"
    r = await client.get("/api/deliveries", params={"page": 1, "size": 50, "q": "reply"})
    assert r.headers["X-Total-Count"] == "8"  # i % 3 == 0: kind reply, "Reply nn"

    # Sorted oldest first, or by state (failed before sent).
    r = await client.get("/api/deliveries", params={"page": 1, "size": 3, "sort": "when"})
    assert [i["id"] for i in r.json()["items"]] == ids[:3]
    r = await client.get("/api/deliveries", params={"page": 1, "size": 5, "sort": "state"})
    assert {i["state"] for i in r.json()["items"]} == {"failed"}
    r = await client.get("/api/deliveries", params={"page": 1, "sort": "kind"})
    assert r.status_code == 422 and r.json()["code"] == "bad_sort"
