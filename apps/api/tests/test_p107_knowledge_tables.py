"""P107: the lessons and recorded-meetings lists became data tables. Both endpoints take
`page/size/q/sort` (api/table.py) for numbered pages with the total in X-Total-Count, and
answer exactly as before without `page` (lessons: the newest 100; recordings: the latest 200)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from agentic.brain import lessons
from agentic.core.db import SessionLocal
from agentic.models import BrainFact, MeetingRecording, Workspace

from .test_agents import office

NOW = datetime.now(UTC)


async def _ws() -> Workspace:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace).order_by(Workspace.created_at))).first()


async def _lessons(n: int, *, topic: str = "general", agent_id: str | None = None, start: int = 0):
    ws = await _ws()
    async with SessionLocal() as db:
        for i in range(start, start + n):
            when = NOW - timedelta(minutes=i)
            what = "tender" if i % 2 else "invoice"
            db.add(
                BrainFact(
                    workspace_id=ws.id,
                    text=f"Lesson {i:03d}: always check the {what} total",
                    source_kind=lessons.KIND,
                    created_by="user:test",
                    hits=i % 7,
                    last_used_at=when if i % 3 else None,
                    valid_from=when,
                    created_at=when,
                    meta={"topic": topic, "agent_id": agent_id},
                )
            )
        await db.commit()


async def _recordings(n: int, *, status: str = "ready", start: int = 0) -> None:
    ws = await _ws()
    async with SessionLocal() as db:
        for i in range(start, start + n):
            db.add(
                MeetingRecording(
                    workspace_id=ws.id,
                    title=f"Board meeting {i:03d}" if i % 2 else f"Site visit {i:03d}",
                    original_name=f"rec{i:03d}.m4a",
                    status=status,
                    duration_seconds=None if status != "ready" else float(60 * (i % 9 + 1)),
                    created_by="user:test",
                    created_at=NOW - timedelta(hours=i),
                )
            )
        await db.commit()


async def test_lessons_page_search_and_sort_on_the_server(client):
    await office(client)
    await _lessons(130)
    await _lessons(3, topic="eperolehan", agent_id="ag_x", start=500)

    # The old shape: the newest 100, no paging.
    plain = await client.get("/api/lessons")
    assert plain.status_code == 200, plain.text
    body = plain.json()
    assert len(body["items"]) == 100
    assert body["items"][0]["text"].startswith("Lesson 000")
    assert {t["key"] for t in body["topics"]} == {"general", "eperolehan"}

    # A numbered page, its total, and the next page carries on.
    r = await client.get("/api/lessons", params={"page": 1, "size": 25})
    assert r.status_code == 200, r.text
    assert int(r.headers["X-Total-Count"]) == 133
    first = [x["text"][:10] for x in r.json()["items"]]
    assert len(first) == 25 and first[0] == "Lesson 000"
    r2 = await client.get("/api/lessons", params={"page": 2, "size": 25})
    assert not set(first) & {x["text"][:10] for x in r2.json()["items"]}
    # Past the end: an empty page, the same total.
    r = await client.get("/api/lessons", params={"page": 99, "size": 25})
    assert r.json()["items"] == [] and int(r.headers["X-Total-Count"]) == 133

    # Every word must match; filters still apply; the total follows them.
    r = await client.get("/api/lessons", params={"page": 1, "size": 50, "q": "tender total"})
    assert int(r.headers["X-Total-Count"]) == 66  # the odd lessons (0..129) + 501
    r = await client.get(
        "/api/lessons", params={"page": 1, "size": 50, "topic": "eperolehan", "agent_id": "ag_x"}
    )
    assert int(r.headers["X-Total-Count"]) == 3

    # Sorting: most used first; never-used last when sorting by last use.
    r = await client.get("/api/lessons", params={"page": 1, "size": 200, "sort": "-uses"})
    uses = [x["uses"] for x in r.json()["items"]]
    assert uses == sorted(uses, reverse=True)
    r = await client.get("/api/lessons", params={"page": 1, "size": 200, "sort": "-last_used_at"})
    last = [x["last_used_at"] for x in r.json()["items"]]
    assert last[0] is not None and last[-1] is None
    assert last.index(None) == sum(1 for x in last if x)
    r = await client.get("/api/lessons", params={"page": 1, "sort": "text"})
    assert r.status_code == 422


async def test_recordings_page_search_filter_and_sort_on_the_server(client):
    await office(client)
    await _recordings(210)
    await _recordings(4, status="failed", start=300)
    await _recordings(2, status="transcribing", start=400)

    # The old shape: a plain list of the latest 200.
    plain = await client.get("/api/minutes")
    assert plain.status_code == 200, plain.text
    rows = plain.json()
    assert isinstance(rows, list) and len(rows) == 200
    assert rows[0]["title"] == "Site visit 000"

    r = await client.get("/api/minutes", params={"page": 1, "size": 25})
    assert int(r.headers["X-Total-Count"]) == 216
    assert len(r.json()) == 25
    r = await client.get("/api/minutes", params={"page": 9, "size": 25})
    assert len(r.json()) == 16  # 216 - 8 * 25

    # Filters: ready, failed, still being processed.
    for status, n in (("ready", 210), ("failed", 4), ("processing", 2)):
        r = await client.get("/api/minutes", params={"page": 1, "size": 10, "status": status})
        assert int(r.headers["X-Total-Count"]) == n, status
    # Words in the title or the file name.
    r = await client.get("/api/minutes", params={"page": 1, "size": 10, "q": "board 007"})
    assert [x["title"] for x in r.json()] == ["Board meeting 007"]
    r = await client.get("/api/minutes", params={"page": 1, "size": 10, "q": "rec300"})
    assert [x["title"] for x in r.json()] == ["Site visit 300"]

    # Longest first; recordings without a length (still processing) last either way.
    r = await client.get("/api/minutes", params={"page": 1, "size": 200, "sort": "-duration"})
    lengths = [x["duration_seconds"] for x in r.json()]
    known = [x for x in lengths if x is not None]
    assert known == sorted(known, reverse=True)
    r = await client.get("/api/minutes", params={"page": 2, "size": 200, "sort": "duration"})
    assert [x["duration_seconds"] for x in r.json()][-1] is None
    r = await client.get("/api/minutes", params={"page": 1, "sort": "size"})
    assert r.status_code == 422
