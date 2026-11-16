"""P107: numbered pages (api/table.py) on lists that only paged with a cursor before: reports,
broadcasts, meetings, documents (and their review queue) and brain facts. Without `page` each
endpoint answers exactly as before; with it, one page plus X-Total-Count, searched, sorted and
filtered on the server, within the same visibility rules."""

import httpx
from sqlalchemy import select

from agentic.api import paging
from agentic.core.db import SessionLocal
from agentic.models import Agent, BrainFact, Branch, Broadcast, Meeting, Report

from .conftest import csrf
from .test_office_roles import as_role
from .test_pagination import add, at, owner


async def _page(c: httpx.AsyncClient, url: str, **params) -> tuple[list, int]:
    r = await c.get(url, params={"page": 1, "size": 5, **params})
    assert r.status_code == 200, r.text
    return r.json(), int(r.headers[paging.TOTAL])


def _ids(rows: list) -> list[str]:
    return [x["id"] for x in rows]


async def test_reports_numbered_pages_search_sort_and_scope(client: httpx.AsyncClient):
    o = await owner(client)
    async with SessionLocal() as db:
        far = Branch(workspace_id=o["ws"], name="Jaya", slug="jaya")
        db.add(far)
        await db.flush()
        other = Agent(workspace_id=o["ws"], branch_id=far.id, slug="far", name="Far", role="Clerk")
        db.add(other)
        await db.commit()
        far_id, other_id = far.id, other.id
    await add(
        *[
            Report(
                workspace_id=o["ws"],
                agent_id=o["agent"],
                branch_id=o["branch"],
                title=f"{'Sales' if i % 2 else 'Stock'} report {i:02d}",
                created_at=at(i),
            )
            for i in range(12)
        ],
        *[
            Report(
                workspace_id=o["ws"],
                agent_id=other_id,
                branch_id=far_id,
                title=f"Far {i}",
                created_at=at(20 + i),
            )
            for i in range(3)
        ],
    )
    # The old shape: everything, newest first, no page.
    whole = (await client.get("/api/reports")).json()
    assert len(whole) == 15
    rows, total = await _page(client, "/api/reports")
    assert total == 15 and _ids(rows) == _ids(whole)[:5]
    rows, total = await _page(client, "/api/reports", page=3)
    assert total == 15 and _ids(rows) == _ids(whole)[10:]
    assert (await _page(client, "/api/reports", page=9))[0] == []  # past the end: empty
    rows, total = await _page(client, "/api/reports", q="sales", sort="title")
    assert total == 6 and [r["title"] for r in rows] == [
        f"Sales report {i:02d}" for i in (1, 3, 5, 7, 9)
    ]
    rows, total = await _page(client, "/api/reports", branch_id=far_id)
    assert total == 3 and {r["agent_name"] for r in rows} == {"Far"}
    rows, total = await _page(client, "/api/reports", agent_id=o["agent"], sort="-title", size=2)
    assert total == 12 and rows[0]["title"] == "Stock report 10"
    bad = await client.get("/api/reports", params={"page": 1, "sort": "agent"})
    assert bad.status_code == 422 and bad.json()["code"] == "bad_sort"
    # A branch manager of Maju sees Maju's reports only, paged or not.
    bm = await as_role(client, "bm@example.com", "branch_manager", branch_id=o["branch"])
    try:
        rows, total = await _page(bm, "/api/reports", size=50)
        assert total == 12 and "Far" not in {r["agent_name"] for r in rows}
        assert len((await bm.get("/api/reports")).json()) == 12
    finally:
        await bm.aclose()


async def test_broadcasts_mode_filter_search_and_pages(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            Broadcast(
                workspace_id=o["ws"],
                sender=f"user:{o['user']}",
                audience={},
                audience_label="Maju" if i % 3 else "Everyone",
                mode="directive" if i % 2 else "announcement",
                body=f"Message {i:02d} about {'stock' if i % 4 == 0 else 'leave'}",
                created_at=at(i),
            )
            for i in range(11)
        ]
    )
    whole = (await client.get("/api/broadcasts")).json()
    assert len(whole) == 11 and paging.NEXT not in (await client.get("/api/broadcasts")).headers
    rows, total = await _page(client, "/api/broadcasts")
    assert total == 11 and _ids(rows) == _ids(whole)[:5]
    rows, total = await _page(client, "/api/broadcasts", mode="directive", size=50)
    assert total == 5 and {r["mode"] for r in rows} == {"directive"}
    rows, total = await _page(client, "/api/broadcasts", q="stock")
    assert total == 3  # 0, 4, 8
    rows, total = await _page(client, "/api/broadcasts", q="everyone")  # the audience counts too
    assert total == 4  # 0, 3, 6, 9
    rows, _ = await _page(client, "/api/broadcasts", sort="created")
    assert rows[0]["body"].startswith("Message 00")
    # The cursor still walks the same list for older callers.
    r = await client.get("/api/broadcasts?limit=4")
    assert r.headers[paging.TOTAL] == "11" and paging.NEXT in r.headers
    assert (await client.get("/api/broadcasts", params={"mode": "nope"})).status_code == 422


async def test_meetings_status_search_sort_and_pages(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            Meeting(
                workspace_id=o["ws"],
                started_by="user:x",
                topic=f"{'Budget' if i % 2 else 'Hiring'} talk {i:02d}",
                participant_ids=[o["agent"]],
                status=("done", "failed", "cancelled", "running")[i % 4],
                created_at=at(i),
            )
            for i in range(13)
        ]
    )
    past = "done,failed,cancelled"
    whole = (await client.get("/api/meetings", params={"status": past})).json()
    assert len(whole) == 10  # 3, 7 and 11 are still running
    rows, total = await _page(client, "/api/meetings", status=past)
    assert total == 10 and _ids(rows) == _ids(whole)[:5]
    rows, total = await _page(client, "/api/meetings", status="done")
    assert total == 4 and {m["status"] for m in rows} == {"done"}
    rows, total = await _page(client, "/api/meetings", status=past, q="budget", sort="topic")
    assert total == 3 and [m["topic"] for m in rows] == sorted(m["topic"] for m in rows)
    assert all(m["topic"].startswith("Budget") for m in rows)
    running = (await client.get("/api/meetings", params={"status": "running"})).json()
    assert len(running) == 3


async def test_documents_and_review_queue_numbered_pages(client: httpx.AsyncClient):
    await owner(client)
    tpls = (await client.get("/api/doc-templates")).json()
    quote = next(t for t in tpls if t["name"] == "Quotation")
    for i in range(3):  # a quotation with nothing filled in fails its checks
        r = await client.post(
            "/api/documents",
            json={"template_id": quote["id"], "title": f"Quote {i}"},
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    for i in range(6):
        r = await client.post(
            "/api/documents",
            json={"title": f"Note {i}", "body": "# Note\n\nFine."},
            headers=csrf(client),
        )
        assert r.status_code == 201, r.text
    whole = (await client.get("/api/documents")).json()
    assert len(whole) == 9
    rows, total = await _page(client, "/api/documents")
    assert total == 9 and _ids(rows) == _ids(whole)[:5]
    rows, total = await _page(client, "/api/documents", page=2)
    assert _ids(rows) == _ids(whole)[5:]
    rows, total = await _page(client, "/api/documents", q="note", sort="title")
    assert total == 6 and [d["title"] for d in rows] == [f"Note {i}" for i in range(5)]
    rows, total = await _page(client, "/api/documents", sort="-title", size=2)
    assert [d["title"] for d in rows] == ["Quote 2", "Quote 1"]
    # Failing ones: counted and paged from the latest scan.
    rows, total = await _page(client, "/api/documents", fix="true", size=2, sort="title")
    assert total == 3 and [d["title"] for d in rows] == ["Quote 0", "Quote 1"]
    assert all(d["errors"] for d in rows)
    rows, total = await _page(client, "/api/documents", status="approved")
    assert total == 0 and rows == []
    # The review queue: nothing from agents here; the old shape and the paged one agree.
    assert (await client.get("/api/documents/review-queue")).json() == []
    rows, total = await _page(client, "/api/documents/review-queue", q="quote")
    assert total == 0 and rows == []


async def test_facts_numbered_pages_sort_and_old_shapes(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            BrainFact(
                workspace_id=o["ws"],
                text=f"{'Supplier' if i % 2 else 'Client'} fact {i:02d}",
                source_kind="person",
                created_by="user:x",
                hits=i % 5,
                valid_from=at(i),
                created_at=at(i),
            )
            for i in range(12)
        ]
    )
    whole = (await client.get("/api/brain/facts")).json()
    assert whole["total"] == 12 and whole["next_cursor"] is None
    r = await client.get("/api/brain/facts", params={"page": 2, "size": 5})
    body = r.json()
    assert r.headers[paging.TOTAL] == "12" and body["total"] == 12 and body["next_cursor"] is None
    assert _ids(body["items"]) == _ids(whole["items"])[5:10]
    body = (
        await client.get("/api/brain/facts", params={"page": 1, "q": "supplier", "sort": "text"})
    ).json()
    assert body["total"] == 6 and [f["text"] for f in body["items"]][:2] == [
        "Supplier fact 01",
        "Supplier fact 03",
    ]
    body = (
        await client.get("/api/brain/facts", params={"page": 1, "sort": "-used", "size": 3})
    ).json()
    assert [f["hits"] for f in body["items"]] == [4, 4, 3]
    # Forgetting one moves it to Ended in the paged list too.
    async with SessionLocal() as db:
        f = await db.scalar(select(BrainFact).where(BrainFact.text == "Client fact 00"))
        assert f is not None
    r = await client.post(f"/api/brain/facts/{f.id}/forget", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    body = (await client.get("/api/brain/facts", params={"page": 1, "state": "ended"})).json()
    assert body["total"] == 1 and body["items"][0]["id"] == f.id
    # The old offset and cursor callers still work.
    old = (await client.get("/api/brain/facts", params={"limit": 5, "offset": 5})).json()
    assert old["total"] == 11 and len(old["items"]) == 5 and old["next_cursor"]
