"""P3 brain: pages + vault, search, facts, learning, recall, core memory, isolation, dream."""

import json
from datetime import UTC, datetime, timedelta

import httpx
from dulwich.repo import Repo
from sqlalchemy import select, update

from agentic.agents import runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.brain import dream, learn, vault
from agentic.core.db import SessionLocal
from agentic.models import Agent, BrainFact, BrainPage, Task, Workspace

from .conftest import VAULT_DIR, csrf
from .test_agents import llm, messages, new_agent, new_task, office, temporal  # noqa: F401


async def put_page(c: httpx.AsyncClient, path: str, body: str) -> httpx.Response:
    return await c.put("/api/brain/page", json={"path": path, "body": body}, headers=csrf(c))


async def ws_slug() -> str:
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        return ws.slug


async def tool(agent_id: str, name: str, task_id: str | None = None, **args) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        assert agent is not None
        ws = await db.get(Workspace, agent.workspace_id)
        assert ws is not None
        task = await db.get(Task, task_id) if task_id else None
        return await TOOLS[name].handler(ToolContext(db, agent, ws, task), args)


# ---------------------------------------------------------------- pages and the vault


async def test_page_links_backlinks_graph_and_git(client: httpx.AsyncClient, llm):
    await office(client)
    r = await put_page(
        client,
        "wiki/entities/maju-trading.md",
        "---\ntitle: Maju Trading\ntags: [supplier, packaging]\n---\n"
        "# Maju Trading\nPackaging supplier. Terms in [[payment-terms]]. See [[Missing Page]].",
    )
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["title"] == "Maju Trading" and page["frontmatter"]["tags"] == [
        "supplier",
        "packaging",
    ]
    await put_page(client, "wiki/topics/payment-terms.md", "# Payment terms\nNet 30 for suppliers.")

    terms = (
        await client.get("/api/brain/page", params={"path": "wiki/topics/payment-terms.md"})
    ).json()
    assert [b["path"] for b in terms["backlinks"]] == ["wiki/entities/maju-trading.md"]
    maju = (
        await client.get("/api/brain/page", params={"path": "wiki/entities/maju-trading.md"})
    ).json()
    links = {link["name"]: link["path"] for link in maju["links"]}
    assert links == {"payment-terms": "wiki/topics/payment-terms.md", "missing page": None}
    assert maju["history"][0]["author"] == "Owner One"

    g = (await client.get("/api/brain/graph")).json()
    by_id = {n["id"]: n["path"] for n in g["nodes"]}
    assert [(by_id[e["source"]], by_id[e["target"]]) for e in g["edges"]] == [
        ("wiki/entities/maju-trading.md", "wiki/topics/payment-terms.md")
    ]
    assert "missing page" in g["unresolved"]

    # Real files in a real git repo: Obsidian opens this folder as a vault.
    root = VAULT_DIR / await ws_slug()
    assert (root / "wiki/entities/maju-trading.md").read_text(encoding="utf-8").startswith("---")
    assert (root / "AGENTS.md").is_file() and (root / "log.md").is_file()
    repo = Repo(str(root))
    try:
        authors = {e.commit.author.decode() for e in repo.get_walker()}
    finally:
        repo.close()
    assert any(a.startswith("Owner One <user-") for a in authors)


async def test_page_paths_are_checked(client: httpx.AsyncClient, llm):
    await office(client)
    for bad in ("../escape.md", ".git/config", "wiki/.hidden.md", "wiki/<x>.md"):
        r = await put_page(client, bad, "x")
        assert r.status_code == 422, bad
    assert (await put_page(client, "index.md", "mine")).status_code == 422
    r = await client.delete(
        "/api/brain/page",
        params={"path": "AGENTS.md"},
        headers={"content-type": "application/json", **csrf(client)},
    )
    assert r.status_code == 409
    ok = await put_page(client, "wiki/howto/Close the month", "# Close\nSteps.")
    assert ok.json()["path"] == "wiki/howto/Close the month.md"


async def test_vault_edits_come_back_in(client: httpx.AsyncClient, llm):
    await office(client)
    await put_page(client, "wiki/topics/leave.md", "# Leave\n14 days a year.")
    await put_page(client, "wiki/topics/claims.md", "# Claims\nSubmit by the 5th.")
    await put_page(client, "wiki/topics/old.md", "# Old\nRemove me.")
    root = VAULT_DIR / await ws_slug()
    # Someone edits in Obsidian: one page changed, one new, one deleted.
    (root / "wiki/topics/leave.md").write_text(
        "# Leave\n16 days a year from 2027.", encoding="utf-8"
    )
    (root / "wiki/topics/new-hire.md").write_text("# New hire\nSee [[leave]].", encoding="utf-8")
    (root / "wiki/topics/old.md").unlink()
    # ...while someone else edits claims in both places.
    (root / "wiki/topics/claims.md").write_text("# Claims\nVault copy.", encoding="utf-8")
    await put_page(client, "wiki/topics/claims.md", "# Claims\nDashboard copy.")

    # The dashboard save re-mirrored claims, so only the Obsidian edits remain outside.
    (root / "wiki/topics/claims.md").write_text("# Claims\nVault copy again.", encoding="utf-8")
    async with SessionLocal() as db:
        await db.execute(
            update(BrainPage)
            .where(BrainPage.path == "wiki/topics/claims.md")
            .values(body="# Claims\nDashboard edit 2.", hash="x")
        )
        await db.commit()

    report = (await client.post("/api/brain/sync", json={}, headers=csrf(client))).json()
    assert sorted(report["imported"]) == ["wiki/topics/leave.md", "wiki/topics/new-hire.md"]
    assert report["deleted"] == ["wiki/topics/old.md"]
    assert report["conflicts"] == ["wiki/topics/claims.md"]
    leave = (await client.get("/api/brain/page", params={"path": "wiki/topics/leave.md"})).json()
    assert "16 days" in leave["body"] and leave["backlinks"][0]["path"] == "wiki/topics/new-hire.md"
    pages = {p["path"] for p in (await client.get("/api/brain/pages")).json()}
    assert any(p.startswith("wiki/topics/claims.conflict-") for p in pages)
    assert "wiki/topics/old.md" not in pages


# ---------------------------------------------------------------- search and facts


async def test_hybrid_search_keyword_meaning_and_links(client: httpx.AsyncClient, llm):
    await office(client)
    await put_page(
        client,
        "wiki/entities/maju-trading.md",
        "# Maju Trading\nOur carton supplier. Details: [[supplier-contacts]].",
    )
    await put_page(
        client,
        "wiki/topics/supplier-contacts.md",
        "# Supplier contacts\nSiti handles orders, ext 204.",
    )
    await put_page(client, "wiki/topics/leave.md", "# Leave\nAnnual leave is 14 days.")
    # Test embeddings are word hashes, so the query shares words; real ones match meaning.
    r = (await client.get("/api/brain/search", params={"q": "which carton supplier"})).json()
    paths = [h["path"] for h in r["pages"]]
    assert paths[0] == "wiki/entities/maju-trading.md"
    assert "wiki/topics/supplier-contacts.md" in paths  # reached through the link
    linked = next(h for h in r["pages"] if h["path"] == "wiki/topics/supplier-contacts.md")
    assert "link" in linked["via"] or "keyword" in linked["via"]
    assert "wiki/topics/leave.md" not in paths


async def test_facts_dedupe_correct_forget_restore(client: httpx.AsyncClient, llm):
    await office(client)
    a = (
        await client.post(
            "/api/brain/facts",
            json={"text": "Maju Trading invoices on net-30 terms."},
            headers=csrf(client),
        )
    ).json()
    again = (
        await client.post(
            "/api/brain/facts",
            json={"text": "maju trading invoices on NET-30 terms."},
            headers=csrf(client),
        )
    ).json()
    assert again["id"] == a["id"] and again["hits"] == 1
    secret = await client.post(
        "/api/brain/facts", json={"text": "The bank password is hunter22"}, headers=csrf(client)
    )
    assert secret.status_code == 422

    fixed = (
        await client.patch(
            f"/api/brain/facts/{a['id']}",
            json={"text": "Maju Trading invoices on net-45 terms from Oct 2026."},
            headers=csrf(client),
        )
    ).json()
    ended = (await client.get("/api/brain/facts", params={"state": "ended"})).json()["items"]
    assert (
        ended[0]["id"] == a["id"]
        and ended[0]["end_reason"] == "replaced"
        and ended[0]["superseded_by"] == fixed["id"]
    )

    await client.post(f"/api/brain/facts/{fixed['id']}/forget", json={}, headers=csrf(client))
    assert (await client.get("/api/brain/facts")).json()["total"] == 0
    await client.post(f"/api/brain/facts/{fixed['id']}/restore", json={}, headers=csrf(client))
    hits = (await client.get("/api/brain/search", params={"q": "Maju net-45 terms"})).json()[
        "facts"
    ]
    assert hits[0]["id"] == fixed["id"]


# ---------------------------------------------------------------- learning and recall


async def test_changed_number_is_not_a_duplicate(client: httpx.AsyncClient, llm):
    await office(client)
    a = (
        await client.post(
            "/api/brain/facts",
            json={"text": "Payroll cut-off is the 20th of the month."},
            headers=csrf(client),
        )
    ).json()
    b = (
        await client.post(
            "/api/brain/facts",
            json={"text": "Payroll cut-off is the 22nd of the month."},
            headers=csrf(client),
        )
    ).json()
    assert a["id"] != b["id"]  # near-identical words, different number: a new fact, not a repeat


async def test_task_learns_and_replaces_out_of_date_fact(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    old = (
        await client.post(
            "/api/brain/facts",
            json={"text": "Maju Trading delivers on Mondays.", "branch_id": o["branch"]["id"]},
            headers=csrf(client),
        )
    ).json()
    task = await new_task(client, agent, "Check Maju delivery days")
    await runtime.finish(task["id"], "done", "Maju Trading now delivers on Thursdays.")
    llm.say(
        json.dumps(
            {
                "facts": [
                    {
                        "text": "Maju Trading delivers on Thursdays (since Oct 2026).",
                        "private": False,
                    },
                    {"text": "Fitri prefers totals rounded to two decimals.", "private": True},
                    {"text": "The API key is sk-abcdefghijklmnop1234", "private": False},
                ]
            }
        )
    )
    llm.say(
        json.dumps(
            {
                "decisions": [
                    {"new": 1, "action": "replace", "old": old["id"]},
                    {"new": 2, "action": "add", "old": None},
                ]
            }
        )
    )
    async with SessionLocal() as db:
        learned = await learn.learn_from_task(db, task["id"])
    assert learned is not None and learned.error is None
    assert learned.replaced == [
        (
            "Maju Trading delivers on Mondays.",
            "Maju Trading delivers on Thursdays (since Oct 2026).",
        )
    ]
    assert learned.added == ["Fitri prefers totals rounded to two decimals."]

    active = (await client.get("/api/brain/facts")).json()["items"]
    texts = {f["text"]: f for f in active}
    assert "Maju Trading delivers on Mondays." not in texts
    assert not any("sk-" in t for t in texts)  # secrets never stored
    private = texts["Fitri prefers totals rounded to two decimals."]
    assert private["agent_id"] == agent["id"] and private["branch_id"] is None
    shared = texts["Maju Trading delivers on Thursdays (since Oct 2026)."]
    assert shared["branch_id"] == o["branch"]["id"] and shared["source_label"].startswith(
        'task "Check Maju'
    )
    # The reconcile call saw the existing fact as a candidate.
    assert old["id"] in llm.requests[1]["messages"][1]["content"]
    log_page = (await client.get("/api/brain/page", params={"path": "log.md"})).json()
    assert 'Aina finished "Check Maju delivery days"' in log_page["body"]


async def test_task_recalls_a_fact_from_two_weeks_ago(client: httpx.AsyncClient, llm, temporal):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await client.post(
        "/api/brain/facts",
        json={
            "text": "Maju Trading invoices are paid on net-30 terms.",
            "branch_id": o["branch"]["id"],
        },
        headers=csrf(client),
    )
    await client.post(
        "/api/brain/facts",
        json={"text": "The office closes at 6pm on Fridays."},
        headers=csrf(client),
    )
    two_weeks = datetime.now(UTC) - timedelta(days=14)
    async with SessionLocal() as db:
        await db.execute(update(BrainFact).values(valid_from=two_weeks, created_at=two_weeks))
        await db.commit()

    task = await new_task(
        client, agent, "When is the Maju Trading invoice due?", "Invoice dated 3 Oct."
    )
    llm.say("Due on 2 Nov (net-30).")
    r = await runtime.run_task_step(task["id"])
    assert r.state == "done"
    first = llm.requests[0]["messages"]
    kickoff = first[1]["content"]
    assert "<memory" in kickoff and "net-30 terms" in kickoff
    assert "6pm on Fridays" not in kickoff  # irrelevant facts stay out
    assert (
        "net-30" not in first[0]["content"]
    )  # recalled facts never touch the cached system prompt
    detail = (await client.get(f"/api/tasks/{task['id']}")).json()
    assert any(e["kind"] == "memory" and "recalled 1 fact" in e["text"] for e in detail["events"])
    used = (await client.get("/api/brain/facts", params={"q": "Maju"})).json()["items"][0]
    assert used["hits"] == 1 and used["last_used_at"] is not None


async def test_chat_recall_is_not_stored_and_memory_is_frozen(
    client: httpx.AsyncClient, llm, temporal
):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    await client.post(
        "/api/brain/facts",
        json={"text": "Payroll is processed on the 25th of every month."},
        headers=csrf(client),
    )
    put = await client.put(
        f"/api/agents/{agent['id']}/memory",
        json={"memory": ["Always show working for totals."], "user": ["Fitri runs finance."]},
        headers=csrf(client),
    )
    assert (
        put.status_code == 200
        and put.json()["used"]["memory"] == len("Always show working for totals.") + 1
    )

    llm.say("The 25th.").say("Still the 25th.")
    r1 = (
        await client.post(
            f"/api/agents/{agent['id']}/chat",
            json={"message": "When do we run payroll each month?"},
            headers=csrf(client),
        )
    ).json()
    sent = llm.requests[0]["messages"]
    assert (
        "Always show working" in sent[0]["content"] and "Fitri runs finance" in sent[0]["content"]
    )
    assert "25th of every month" in sent[-1]["content"]  # recalled into this turn
    stored = (await client.get(f"/api/chat/sessions/{r1['session_id']}/messages")).json()
    assert "<memory" not in stored[0]["content"]  # ...but never saved
    assert temporal["learn_chat"]  # learning queued in the background

    # Memory edited mid-conversation: this conversation keeps its snapshot.
    await client.put(
        f"/api/agents/{agent['id']}/memory",
        json={"memory": ["Reply in Malay."], "user": []},
        headers=csrf(client),
    )
    await client.post(
        f"/api/agents/{agent['id']}/chat",
        json={"message": "And in December?", "session_id": r1["session_id"]},
        headers=csrf(client),
    )
    second_system = llm.requests[1]["messages"][0]["content"]
    assert "Always show working" in second_system and "Reply in Malay" not in second_system


async def test_memory_tool_caps_and_edits(client: httpx.AsyncClient, llm):
    o = await office(client)
    agent = await new_agent(client, o, "Aina")
    ok = await tool(
        agent["id"], "memory", action="add", target="user", text="Fitri wants summaries first."
    )
    assert ok.startswith("Saved.")
    assert (
        await tool(
            agent["id"], "memory", action="add", target="user", text="Fitri wants summaries first."
        )
        == "Already in memory."
    )
    full = await tool(agent["id"], "memory", action="add", target="user", text="x" * 1400)
    assert full.startswith("Error:") and "full" in full
    await tool(
        agent["id"],
        "memory",
        action="replace",
        target="user",
        old_text="summaries",
        text="Fitri wants the summary line first.",
    )
    mem = (await client.get(f"/api/agents/{agent['id']}/memory")).json()
    assert mem["user"] == ["Fitri wants the summary line first."]
    ambiguous = await tool(
        agent["id"], "memory", action="remove", target="memory", old_text="nothing"
    )
    assert "matched 0 entries" in ambiguous


async def test_isolated_company_keeps_its_memory(client: httpx.AsyncClient, llm):
    o = await office(client)
    secret_co = (
        await client.post(
            "/api/branches",
            json={"name": "Rahsia Holdings", "isolated": True},
            headers=csrf(client),
        )
    ).json()
    open_agent = await new_agent(client, o, "Aina")
    closed_agent = (
        await client.post(
            "/api/agents",
            json={
                "branch_id": secret_co["id"],
                "department_id": secret_co["departments"][1]["id"],
                "name": "Zara",
                "role": "Accountant",
            },
            headers=csrf(client),
        )
    ).json()

    await tool(
        closed_agent["id"], "remember", fact="Rahsia Holdings pays rent of RM 9,000 monthly."
    )
    await tool(open_agent["id"], "remember", fact="Maju Sdn Bhd pays rent of RM 4,000 monthly.")
    assert "9,000" not in await tool(open_agent["id"], "recall", query="how much rent do we pay")
    seen = await tool(closed_agent["id"], "recall", query="how much rent do we pay")
    assert "9,000" in seen and "4,000" not in seen

    saved = await tool(
        closed_agent["id"], "write_page", path="wiki/topics/rent.md", content="# Rent\nRM 9,000."
    )
    assert saved == f"Saved branches/{secret_co['slug']}/wiki/topics/rent.md."
    denied = await tool(
        open_agent["id"], "read_page", path=f"branches/{secret_co['slug']}/wiki/topics/rent.md"
    )
    assert denied.startswith("Error:")
    assert (
        await tool(open_agent["id"], "write_page", path="AGENTS.md", content="hijack")
    ).startswith("Error:")
    peek = await tool(
        open_agent["id"], "read_page", path=f"agents/{closed_agent['slug']}/MEMORY.md"
    )
    assert peek.startswith("Error:")


# ---------------------------------------------------------------- the dream


async def test_dream_merges_settles_writes_diary_and_undoes(client: httpx.AsyncClient, llm):
    await office(client)
    texts = [
        "Maju Trading delivers on Mondays.",
        "maju trading delivers on mondays",  # duplicate (differs only in case and full stop)
        "Payroll cut-off is the 20th of the month.",
        "Payroll cut-off is the 22nd of the month.",  # contradiction, newer wins
    ]
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        from agentic.brain import embed
        from agentic.brain.scope import for_people

        base = datetime.now(UTC) - timedelta(days=3)
        for i, t in enumerate(texts):
            f = BrainFact(
                workspace_id=ws.id,
                text=t,
                embedding=await embed.embed_one(t),
                source_kind="person",
                created_by="system",
                confidence=0.8,
                valid_from=base + timedelta(hours=i),
                created_at=base + timedelta(hours=i),
            )
            db.add(f)
        await db.commit()
        assert for_people(ws.id).agent_id is None

    llm.say(json.dumps({"verdicts": [{"pair": 1, "verdict": "contradiction"}]}))
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        d = await dream.run_dream(db, ws)
    assert d.status == "done", d.error
    kinds = sorted(c["kind"] for c in d.changes)
    assert kinds == ["contradiction", "merge"]
    active = {f["text"] for f in (await client.get("/api/brain/facts")).json()["items"]}
    assert active == {
        "maju trading delivers on mondays",
        "Payroll cut-off is the 22nd of the month.",
    }

    detail = (await client.get(f"/api/brain/dreams/{d.id}")).json()
    assert (
        "## Merged duplicates (1)" in detail["diary"]
        and "## Contradictions settled (1)" in detail["diary"]
    )
    assert "Payroll cut-off is the 20th" in detail["diary"]
    assert (VAULT_DIR / await ws_slug() / detail["diary_path"]).is_file()

    idx = next(i for i, c in enumerate(d.changes) if c["kind"] == "contradiction")
    r = await client.post(f"/api/brain/dreams/{d.id}/undo/{idx}", json={}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["changes"][idx]["undone"] is True
    active = {f["text"] for f in (await client.get("/api/brain/facts")).json()["items"]}
    assert "Payroll cut-off is the 20th of the month." in active

    # Same day again: nothing re-runs unless forced.
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        assert ws is not None
        again = await dream.run_dream(db, ws)
    assert again.id == d.id and len(llm.requests) == 1


async def test_permissions(client: httpx.AsyncClient, llm, temporal):
    await office(client)
    r = await client.post(
        "/api/members",
        json={"email": "view@example.com", "name": "Vee", "role": "viewer"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    temp = r.json()["temp_password"]
    owner_dream = await client.post("/api/brain/dreams/run", json={}, headers=csrf(client))
    assert owner_dream.status_code == 202 and temporal["dream"]

    viewer = httpx.AsyncClient(transport=client._transport, base_url="http://test")  # noqa: SLF001
    async with viewer:
        await viewer.post("/api/auth/login", json={"email": "view@example.com", "password": temp})
        await viewer.post(
            "/api/auth/change-password",
            json={"current_password": temp, "new_password": "viewer-password-1"},
            headers=csrf(viewer),
        )
        assert (await viewer.get("/api/brain/pages")).status_code == 200
        assert (await put_page(viewer, "wiki/x.md", "no")).status_code == 403
        assert (
            await viewer.post("/api/brain/sync", json={}, headers=csrf(viewer))
        ).status_code == 403
        assert (await viewer.get("/api/brain/vault.zip")).status_code == 403
    zipped = await client.get("/api/brain/vault.zip")
    assert zipped.status_code == 200 and zipped.content[:2] == b"PK"
    assert vault.root(await ws_slug()).is_dir()
