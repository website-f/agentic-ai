"""Keyset (cursor) pagination on the list endpoints: stable order, no duplicates or gaps
across pages, filters that hold on every page, and unchanged behaviour for old callers."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from agentic.api import paging
from agentic.core.db import SessionLocal
from agentic.models import (
    Agent,
    Approval,
    AuditLog,
    BrainFact,
    Branch,
    Broadcast,
    ChatSession,
    DocFile,
    EmailDraft,
    GoogleAccount,
    Meeting,
    Report,
    SkillProposal,
    Task,
    User,
    WorkflowRun,
    Workspace,
)

from .conftest import setup_owner

T0 = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def at(i: int) -> datetime:
    """Timestamps with deliberate ties: every three rows share one instant, so the id
    tie-break is what keeps pages apart."""
    return T0 + timedelta(minutes=i // 3)


async def owner(client: httpx.AsyncClient) -> dict[str, str]:
    await setup_owner(client)
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        user = await db.scalar(select(User))
        assert ws is not None and user is not None
        branch = Branch(workspace_id=ws.id, name="Maju", slug="maju")
        db.add(branch)
        await db.flush()
        agent = Agent(
            workspace_id=ws.id, branch_id=branch.id, slug="aina", name="Aina", role="Clerk"
        )
        db.add(agent)
        await db.commit()
        return {"ws": ws.id, "user": user.id, "branch": branch.id, "agent": agent.id}


async def add(*rows: Any) -> None:
    async with SessionLocal() as db:
        db.add_all(rows)
        await db.commit()


async def walk(
    client: httpx.AsyncClient,
    url: str,
    limit: int,
    items=lambda body: body,
    param: str = "cursor",
    header: str = paging.NEXT,
    key: str = "id",
) -> tuple[list[str], int]:
    """Every id from following the cursor to the end, and the number of pages it took."""
    ids: list[str] = []
    cursor: str | None = None
    pages = 0
    sep = "&" if "?" in url else "?"
    while True:
        r = await client.get(f"{url}{sep}limit={limit}" + (f"&{param}={cursor}" if cursor else ""))
        assert r.status_code == 200, r.text
        page = items(r.json())
        assert len(page) <= limit
        ids += [str(x[key]) for x in page]
        pages += 1
        cursor = r.headers.get(header)
        if not cursor:
            return ids, pages
        assert pages < 100, "cursor never ended"


def no_dupes(ids: list[str]) -> None:
    assert len(ids) == len(set(ids)), "a row showed up on two pages"


# ---------------------------------------------------------------- the cursor itself


def test_cursor_round_trip_and_rejects_garbage():
    values = [Decimal("1.500000"), T0, "tk_abc", 42]
    assert paging.decode(paging.encode(values), 4) == values
    for bad in ("not-base64!!", paging.encode([1, 2, 3]), paging.encode([None, "x"]), "e30"):
        with pytest.raises(Exception) as e:
            paging.decode(bad, 2)
        assert getattr(e.value, "status_code", None) == 400


# ---------------------------------------------------------------- tasks (board order)


async def test_tasks_pages_in_board_order_without_gaps(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            Task(
                workspace_id=o["ws"],
                title=f"Task {i:02d}",
                created_by="user:x",
                status="done" if i % 2 else "triage",
                position=Decimal(i % 4),  # ties on position too
                created_at=at(i),
            )
            for i in range(23)
        ]
    )
    full = await client.get("/api/tasks")
    assert full.status_code == 200
    everything = [t["id"] for t in full.json()]
    assert len(everything) == 23
    assert paging.NEXT not in full.headers  # default limit covers it: old callers unchanged
    assert full.headers[paging.TOTAL] == "23"

    ids, pages = await walk(client, "/api/tasks", 5)
    assert ids == everything and pages == 5
    no_dupes(ids)

    # The older id cursor still works and walks the same order.
    legacy, _ = await walk(client, "/api/tasks", 7, param="before", header="X-Next-Before")
    assert legacy == everything

    # A filter holds on every page and combines with the cursor.
    done, _ = await walk(client, "/api/tasks?status=done", 3)
    assert done == [t["id"] for t in full.json() if t["status"] == "done"]
    found, _ = await walk(client, "/api/tasks?q=Task%201", 2)
    assert found == [t["id"] for t in full.json() if t["title"].startswith("Task 1")]


async def test_board_rows_carry_position_and_patch_reorders(client: httpx.AsyncClient):
    """The board drops a card between two others by PATCHing the midpoint position."""
    from .conftest import csrf

    o = await owner(client)
    await add(
        *[
            Task(
                workspace_id=o["ws"],
                title=f"Card {i}",
                created_by="user:x",
                status="triage",
                position=Decimal(i * 10),
                created_at=at(i),
            )
            for i in range(3)
        ]
    )
    rows = (await client.get("/api/tasks?status=triage")).json()
    assert [t["title"] for t in rows] == ["Card 0", "Card 1", "Card 2"]
    assert [t["position"] for t in rows] == [0, 10, 20]
    # Card 2 dropped between Card 0 and Card 1.
    card2 = rows[2]["id"]
    r = await client.patch(f"/api/tasks/{card2}", json={"position": 5}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["position"] == 5
    after = (await client.get("/api/tasks?status=triage")).json()
    assert [t["title"] for t in after] == ["Card 0", "Card 2", "Card 1"]


async def test_new_rows_do_not_shift_later_pages(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            Report(workspace_id=o["ws"], agent_id=o["agent"], title=f"Report {i}", created_at=at(i))
            for i in range(10)
        ]
    )
    first = await client.get("/api/reports?limit=4")
    seen = [r["id"] for r in first.json()]
    # Something new lands at the top between page loads.
    await add(Report(workspace_id=o["ws"], agent_id=o["agent"], title="Fresh", created_at=at(100)))
    rest, _ = await walk(client, "/api/reports?x=1", 4)  # from the top again: includes Fresh
    assert len(rest) == 11
    r = await client.get(f"/api/reports?limit=50&cursor={first.headers[paging.NEXT]}")
    after = [x["id"] for x in r.json()]
    assert not set(seen) & set(after) and len(seen) + len(after) == 10


async def test_bad_cursor_is_a_400(client: httpx.AsyncClient):
    await owner(client)
    for url in ("/api/tasks?cursor=zzz", "/api/files?cursor=%%%", "/api/audit?cursor=abc"):
        r = await client.get(url)
        assert r.status_code == 400, url
        assert r.json()["code"] == "bad_cursor"


# ---------------------------------------------------------------- the other lists


async def test_approval_history_pages_and_filters(client: httpx.AsyncClient):
    o = await owner(client)
    task = Task(workspace_id=o["ws"], title="T", created_by="user:x", created_at=T0)
    await add(task)
    await add(
        *[
            Approval(
                workspace_id=o["ws"],
                task_id=task.id,
                agent_id=o["agent"],
                tool_name="send_email",
                tool_call_id=f"c{i}",
                status=("approved", "denied", "pending")[i % 3],
                created_at=at(i),
                expires_at=at(i) + timedelta(days=1),
            )
            for i in range(17)
        ]
    )
    default = (await client.get("/api/approvals?state=history")).json()
    assert len(default) == 12  # every decided one, pending left out
    ids, _ = await walk(client, "/api/approvals?state=history", 4)
    assert ids == [a["id"] for a in default]
    denied, _ = await walk(client, "/api/approvals?state=history&status=denied", 2)
    assert denied == [a["id"] for a in default if a["status"] == "denied"]
    pending = (await client.get("/api/approvals")).json()
    assert {a["status"] for a in pending} == {"pending"} and len(pending) == 5


async def test_files_documents_reports_proposals_runs(client: httpx.AsyncClient):
    o = await owner(client)
    rows: list[Any] = []
    for i in range(13):
        rows += [
            DocFile(
                workspace_id=o["ws"],
                name=f"{'invoice' if i % 2 else 'memo'}-{i}.txt",
                data=b"x",
                created_by="user:x",
                created_at=at(i),
            ),
            Report(workspace_id=o["ws"], agent_id=o["agent"], title=f"R{i}", created_at=at(i)),
            SkillProposal(
                workspace_id=o["ws"],
                kind="new",
                name=f"skill-{i}",
                description="d",
                body="b",
                proposed_by="curator",
                created_at=at(i),
            ),
            WorkflowRun(
                workspace_id=o["ws"],
                name="wf",
                title=f"Run {i}",
                created_by="user:x",
                status="done" if i % 3 == 0 else "running",
                created_at=at(i),
            ),
        ]
    await add(*rows)
    for url, n in (
        ("/api/files", 13),
        ("/api/files?q=invoice", 6),
        ("/api/reports", 13),
        ("/api/skill-proposals", 13),
        ("/api/workflow-runs", 13),
        ("/api/workflow-runs?status=done", 5),
    ):
        whole = await client.get(url)
        assert whole.status_code == 200, (url, whole.text)
        assert whole.headers[paging.TOTAL] == str(n), url
        ids, _ = await walk(client, url, 4)
        assert ids == [x["id"] for x in whole.json()] and len(ids) == n, url
        no_dupes(ids)


async def test_broadcasts_meetings_drafts_sessions(client: httpx.AsyncClient):
    o = await owner(client)
    acct = GoogleAccount(workspace_id=o["ws"], user_id=o["user"], email="me@x", token_enc="t")
    await add(acct)
    rows: list[Any] = []
    for i in range(11):
        rows += [
            Broadcast(
                workspace_id=o["ws"],
                sender=f"user:{o['user']}",
                audience={},
                audience_label="All",
                mode="announcement",
                body=f"B{i}",
                created_at=at(i),
            ),
            Meeting(
                workspace_id=o["ws"],
                started_by="user:x",
                topic=f"M{i}",
                participant_ids=[o["agent"]],
                status="done" if i % 2 else "running",
                created_at=at(i),
            ),
            EmailDraft(
                workspace_id=o["ws"],
                user_id=o["user"],
                account_id=acct.id,
                gmail_draft_id=f"g{i}",
                subject=f"S{i}",
                created_at=at(i),
            ),
            ChatSession(
                workspace_id=o["ws"],
                agent_id=o["agent"],
                user_id=o["user"],
                title=f"Chat {i}",
                updated_at=at(i),
            ),
        ]
    await add(*rows)
    for url, n in (
        ("/api/broadcasts", 11),
        ("/api/meetings", 11),
        ("/api/meetings?status=done", 5),
        ("/api/email-drafts", 11),
        (f"/api/agents/{o['agent']}/sessions?x=1", 11),
    ):
        whole = await client.get(url + ("&" if "?" in url else "?") + "limit=200")
        assert whole.status_code == 200, (url, whole.text)
        ids, _ = await walk(client, url, 3)
        assert ids == [x["id"] for x in whole.json()] and len(ids) == n, url
        no_dupes(ids)
    # Sessions keep their old default of 30.
    assert len((await client.get(f"/api/agents/{o['agent']}/sessions")).json()) == 11


async def test_brain_facts_cursor_and_offset(client: httpx.AsyncClient):
    o = await owner(client)
    await add(
        *[
            BrainFact(
                workspace_id=o["ws"],
                text=f"{'Supplier' if i % 2 else 'Client'} fact {i}",
                source_kind="person",
                created_by="user:x",
                valid_from=at(i),
                created_at=at(i),
            )
            for i in range(12)
        ]
    )
    whole = (await client.get("/api/brain/facts")).json()
    assert whole["total"] == 12 and whole["next_cursor"] is None
    ids, pages = await walk(client, "/api/brain/facts", 5, items=lambda b: b["items"])
    assert ids == [f["id"] for f in whole["items"]] and pages == 3
    sup, _ = await walk(client, "/api/brain/facts?q=supplier", 2, items=lambda b: b["items"])
    assert len(sup) == 6
    off = (await client.get("/api/brain/facts?limit=5&offset=5")).json()
    assert [f["id"] for f in off["items"]] == ids[5:10]


async def test_brain_pages_whole_by_default_paged_on_request(client: httpx.AsyncClient):
    await owner(client)
    whole = (await client.get("/api/brain/pages")).json()
    assert len(whole) >= 2  # the vault seeds its index and log
    paths, pages = await walk(client, "/api/brain/pages", 1, key="path")
    assert paths == [p["path"] for p in whole] and pages == len(whole)


async def test_audit_kind_filter_holds_across_pages(client: httpx.AsyncClient):
    await owner(client)
    for i in range(9):
        r = await client.post(
            "/api/branches",
            json={"name": f"Branch {i}"},
            headers={"x-csrf-token": client.cookies.get("agentic_csrf") or ""},
        )
        assert r.status_code == 201, r.text
    first = (await client.get("/api/audit?limit=200")).json()
    async with SessionLocal() as db:
        logged = len((await db.scalars(select(AuditLog.id))).all())
    assert first["total"] == logged == len(first["items"]) == sum(first["kinds"].values())
    assert first["kinds"]["org"] >= 9
    ids, _ = await walk(client, "/api/audit?kind=org", 4, items=lambda b: b["items"])
    org = [str(x["id"]) for x in first["items"] if x["action"].split(".")[0] in ORG]
    assert ids == org
    legacy, _ = await walk(
        client,
        "/api/audit?kind=org",
        4,
        items=lambda b: b["items"],
        param="before_id",
    )
    assert legacy == org


ORG = ("workspace", "branch", "department")


async def test_documents_pages_fix_filter_and_stats(client: httpx.AsyncClient):
    await owner(client)
    tpls = (await client.get("/api/doc-templates")).json()
    quote = next(t for t in tpls if t["name"] == "Quotation")
    hdr = {"x-csrf-token": client.cookies.get("agentic_csrf") or ""}
    for i in range(4):  # a quotation with nothing filled in fails its checks
        r = await client.post(
            "/api/documents", json={"template_id": quote["id"], "title": f"Q{i}"}, headers=hdr
        )
        assert r.status_code == 201, r.text
    for i in range(5):
        r = await client.post(
            "/api/documents", json={"title": f"Note {i}", "body": "# Note\n\nFine."}, headers=hdr
        )
        assert r.status_code == 201, r.text
    whole = (await client.get("/api/documents")).json()
    assert len(whole) == 9
    ids, _ = await walk(client, "/api/documents", 3)
    assert ids == [d["id"] for d in whole]
    failing = [d["id"] for d in whole if d["errors"]]
    assert len(failing) == 4
    fix, _ = await walk(client, "/api/documents?fix=true", 3)
    assert fix == failing
    stats = (await client.get("/api/documents/stats")).json()
    assert stats == {
        "total": 9,
        "draft": 9,
        "review": 0,
        "approved": 0,
        "fix": 4,
        "fix_complete": True,
        # P25: who made them
        "agent": 0,
        "person": 9,
        "ai_waiting": 0,
    }
    notes, _ = await walk(client, "/api/documents?q=note", 2)
    assert len(notes) == 5


async def test_files_expiring_filter_and_stats(client: httpx.AsyncClient):
    o = await owner(client)
    today = datetime.now(UTC).date()
    soon_, later, expired = (today + timedelta(days=d) for d in (10, 400, -3))
    await add(
        *[
            DocFile(
                workspace_id=o["ws"],
                name=f"cert-{i}.pdf",
                data=b"x",
                created_by="user:x",
                source="generated" if i == 0 else "upload",
                status="ready",
                # in 10 days (expiring), in 400 days (not), 3 days ago (expired), never
                expires_on=(soon_, later, expired, None)[i % 4],
                created_at=at(i),
            )
            for i in range(8)
        ]
    )
    stats = (await client.get("/api/files/stats")).json()
    assert stats == {
        "total": 8,
        "upload": 7,
        "generated": 1,
        "expiring": 4,
        "reading": 0,
        # P25: by who made them (rows written straight to the table keep the default)
        "agent": 0,
        "person": 0,
        "uploaded": 8,
    }
    soon, _ = await walk(client, "/api/files?expiring=true", 3)
    assert len(soon) == 4
    assert (await client.get("/api/files/stats?q=cert-1")).json()["total"] == 1
