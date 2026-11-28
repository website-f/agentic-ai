"""P148b: database speed (the owner, 28 Nov 2026: "all queries fully optimized; users and members
load super fast; every action on the server super fast").

- The hot lists (Members, paged and not, My hierarchy, the org chart's structure, the Library)
  make the same number of queries for 20 members as for 80: nothing is loaded row by row.
- A request signs its person in with one query (session, person, membership, settings).
- Long runs never hold the workspace's row or audit lock while they wait on the network: the
  Prima mirror reads Prima first; seeding the built-in skills embeds and writes the vault with
  the workspace row free.
- workspace_settings.merge writes only its keys, over what others saved meanwhile.

Synthetic people and companies only (example.com).
"""

import contextlib
import hashlib
import hmac

import httpx
from sqlalchemy import delete, event, insert, select, text

from agentic.core import workspace_settings
from agentic.core.config import settings
from agentic.core.db import SessionLocal, engine
from agentic.models import (
    SOP,
    Agent,
    Branch,
    Department,
    Membership,
    MembershipBranch,
    Skill,
    User,
    Workspace,
)

from .conftest import setup_owner


@contextlib.contextmanager
def counting():
    """The SQL statements run inside the block (every connection of the app's engine)."""
    seen: list[str] = []

    def on_exec(_conn, _cursor, statement, *_a, **_k):
        seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", on_exec)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", on_exec)


async def _owner(client) -> tuple[str, str]:
    await setup_owner(client)
    async with SessionLocal() as db:
        m = (await db.scalars(select(Membership))).one()
        return m.workspace_id, m.user_id


async def _people(ws: str, boss: str, start: int, n: int, branches: int = 6) -> None:
    """n members in a reporting line under `boss`, each in two companies, with a twin."""
    async with SessionLocal() as db:
        have = set((await db.scalars(select(Branch.id).where(Branch.workspace_id == ws))).all())
        new_b = [
            {"id": f"br-p{i}", "workspace_id": ws, "name": f"Co {i}", "slug": f"co-p{i}"}
            for i in range(branches)
            if f"br-p{i}" not in have
        ]
        if new_b:
            await db.execute(insert(Branch), new_b)
            await db.execute(
                insert(Department),
                [
                    {
                        "id": f"dp-p{i}",
                        "workspace_id": ws,
                        "branch_id": f"br-p{i}",
                        "name": f"Ops {i}",
                        "slug": "ops",
                        "position": 1,
                    }
                    for i in range(branches)
                ],
            )
        ids = [f"us-p{k}" for k in range(start, start + n)]
        await db.execute(
            insert(User),
            [
                {"id": u, "email": f"{u}@example.com", "name": f"Person {u}", "password_hash": "x"}
                for u in ids
            ],
        )
        roles = ("staff", "supervisor", "hod", "branch_manager")
        await db.execute(
            insert(Membership),
            [
                {
                    "workspace_id": ws,
                    "user_id": u,
                    "role": roles[k % len(roles)],
                    "branch_id": f"br-p{k % branches}",
                    "department_id": f"dp-p{k % branches}",
                    "reports_to_user_id": boss if k < 3 else ids[(k - 3) // 3],
                }
                for k, u in enumerate(ids)
            ],
        )
        await db.execute(
            insert(MembershipBranch),
            [
                {"workspace_id": ws, "user_id": u, "branch_id": f"br-p{(k + j) % branches}"}
                for k, u in enumerate(ids)
                for j in (0, 1)
            ],
        )
        await db.execute(
            insert(Agent),
            [
                {
                    "workspace_id": ws,
                    "branch_id": f"br-p{k % branches}",
                    "slug": f"twin-{u}",
                    "name": f"Twin {k}",
                    "role": "Assistant",
                    "owner_user_id": u,
                    "is_twin": True,
                    "tools": {},
                    "sop_ids": [],
                }
                for k, u in enumerate(ids)
            ],
        )
        await db.commit()


HOT = (
    "/api/members",
    "/api/members?page=1&page_size=50",
    "/api/members?page=1&page_size=25&sort=company&q=person",
    "/api/members/hierarchy/mine",
    "/api/members/hierarchy",
    "/api/org/structure",
    "/api/library",
)


async def _counts(client) -> dict[str, int]:
    out: dict[str, int] = {}
    for path in HOT:
        await client.get(path)  # a first read may seed (the structure's units)
        with counting() as seen:
            r = await client.get(path)
        assert r.status_code == 200, (path, r.text)
        out[path] = len(seen)
    return out


async def test_hot_lists_do_not_load_row_by_row(client):
    ws, owner = await _owner(client)
    await _people(ws, owner, 0, 20)
    small = await _counts(client)
    await _people(ws, owner, 20, 60)
    big = await _counts(client)
    assert big == small, {p: (small[p], big[p]) for p in HOT if small[p] != big[p]}
    # And few: sign-in (2) plus the list's own handful.
    assert big["/api/members"] <= 10, big
    assert big["/api/members/hierarchy/mine"] <= 7, big
    assert big["/api/org/structure"] <= 12, big


async def test_library_department_sops_one_query(client):
    ws, owner = await _owner(client)
    await _people(ws, owner, 0, 3)
    async with SessionLocal() as db:
        db.add(SOP(workspace_id=ws, scope="department", scope_id="dp-p0", title="A", body="x"))
        await db.commit()
    with counting() as one:
        assert (await client.get("/api/library")).status_code == 200
    async with SessionLocal() as db:
        for i in range(1, 6):
            db.add(
                SOP(
                    workspace_id=ws, scope="department", scope_id=f"dp-p{i}", title=f"S{i}", body=""
                )
            )
        await db.commit()
    with counting() as six:
        r = await client.get("/api/library")
    assert r.status_code == 200
    assert len(six) == len(one), six
    sops = [s for s in r.json()["sources"] if s["kind"] == "sop"]
    assert {s["branch_id"] for s in sops} == {f"br-p{i}" for i in range(6)}
    # The list never loads SOP bodies.
    assert not any("sops.body" in s for s in six)


async def test_sign_in_is_one_query(client):
    ws, owner = await _owner(client)
    with counting() as seen:
        assert (await client.get("/api/me/prefs")).status_code == 200
    auth = [s for s in seen if "auth_sessions" in s]
    assert len(auth) == 1 and "memberships" in auth[0], auth
    # The two refusals stay apart: a person no longer in the workspace...
    async with SessionLocal() as db:
        await db.execute(
            delete(MembershipBranch).where(
                MembershipBranch.workspace_id == ws, MembershipBranch.user_id == owner
            )
        )
        await db.execute(delete(Membership).where(Membership.user_id == owner))
        await db.commit()
    r = await client.get("/api/me/prefs")
    assert r.status_code == 401 and r.json()["code"] == "access_removed", r.text
    # ...and a session that is gone.
    client.cookies.set("agentic_session", "not-a-session")
    r = await client.get("/api/me/prefs")
    assert r.status_code == 401 and r.json()["code"] == "session_expired", r.text


async def test_merge_keeps_what_others_saved(client):
    ws, _ = await _owner(client)
    async with SessionLocal() as a, SessionLocal() as b:
        wa = await a.get(Workspace, ws)
        assert wa is not None
        before = dict(wa.settings or {})
        # b saves meanwhile (a's copy is now stale)...
        await workspace_settings.merge(b, ws, {"from_b": 1})
        await b.commit()
        # ...a writes only its key: b's stays, and a's object shows what was saved.
        saved = await workspace_settings.merge(a, ws, {"from_a": {"x": 2}}, wa)
        await a.commit()
    assert saved["from_b"] == 1 and saved["from_a"] == {"x": 2}
    assert wa.settings == saved
    async with SessionLocal() as db:
        now = await db.scalar(select(Workspace.settings).where(Workspace.id == ws))
    assert now == {**before, "from_b": 1, "from_a": {"x": 2}}


async def _row_free(ws: str) -> bool:
    """Can another transaction lock the workspace row right now (NOWAIT)?"""
    async with engine.connect() as c:
        try:
            await c.execute(
                text("SELECT 1 FROM workspaces WHERE id = :w FOR NO KEY UPDATE NOWAIT"), {"w": ws}
            )
            return True
        except Exception:  # noqa: BLE001 - lock_not_available
            return False
        finally:
            await c.rollback()


async def _audit_free(ws: str) -> bool:
    async with engine.connect() as c:
        try:
            return bool(
                await c.scalar(
                    text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"), {"k": f"audit:{ws}"}
                )
            )
        finally:
            await c.rollback()


async def test_builtin_skills_seed_with_the_workspace_row_free(client, monkeypatch):
    from agentic.brain import embed
    from agentic.skills import store

    ws, _ = await _owner(client)
    async with SessionLocal() as db:
        await db.execute(delete(Skill).where(Skill.workspace_id == ws))
        w = await db.get(Workspace, ws)
        assert w is not None
        w.settings = {
            k: v
            for k, v in (w.settings or {}).items()
            if k not in ("builtin_skills", store._REV_KEY)
        }
        await db.commit()

    seen: list[bool] = []
    real = embed.embed

    async def watching(texts):
        seen.append(await _row_free(ws))
        return await real(texts)

    monkeypatch.setattr(embed, "embed", watching)
    async with SessionLocal() as db:
        w = await db.get(Workspace, ws)
        assert w is not None
        await store.ensure_builtin(db, w)
        assert w.settings.get("builtin_skills")
    assert seen and all(seen), seen  # every embedding (skills and vault pages) ran unlocked
    async with SessionLocal() as db:
        names = set((await db.scalars(select(Skill.name).where(Skill.workspace_id == ws))).all())
        st = await db.scalar(select(Workspace.settings).where(Workspace.id == ws))
    assert {b[0] for b in store.BUILTIN} <= names
    assert st["builtin_skills"] and st[store._REV_KEY] == store.BUILTIN_REV
    # A second run is the usual two dict lookups: no query.
    async with SessionLocal() as db:
        w = await db.get(Workspace, ws)
        with counting() as q:
            await store.ensure_builtin(db, w)
    assert q == []


SECRET = "p148-test-secret-0123456789abcdef"


async def test_prima_mirror_reads_prima_with_nothing_locked(client, monkeypatch):
    from agentic.prima import autolink, mirror, org_link, org_sync
    from agentic.prima import client as prima

    ws, _ = await _owner(client)
    async with SessionLocal() as db:
        b = Branch(workspace_id=ws, name="PW VENTURE", slug="pw")
        db.add(b)
        await db.flush()
        w = await db.get(Workspace, ws)
        assert w is not None
        w.settings = {**(w.settings or {}), "prima_companies": {b.id: "pwvsb"}, "keep_me": 7}
        await db.commit()
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", SECRET)
    monkeypatch.setattr(settings, "prima_workspace", "")
    monkeypatch.setattr(prima, "_TOP", {})
    monkeypatch.setattr(autolink, "on", False)
    monkeypatch.setattr(org_link, "on", False)
    monkeypatch.setattr(org_sync, "on", False)
    staff = [
        {"id": "u-ceo", "name": "Chief", "role": "director", "canSignIn": True, "top": "ceo"},
        {
            "id": "u-new",
            "name": "New Supervisor",
            "role": "supervisor",
            "canSignIn": True,
            "email": "new.sup@example.com",
            "companyIds": ["pwvsb"],
        },
    ]
    checks: list[tuple[str, bool, bool]] = []

    async def handler(req: httpx.Request) -> httpx.Response:
        h = req.headers
        url = req.url.raw_path.decode()
        head = (
            f"{h['x-office-ts']}\n{req.method}\n{url}\n{h['x-office-user']}\n{h['x-office-via']}\n"
        ).encode()
        sig = hmac.new(SECRET.encode(), head + req.content, hashlib.sha256).hexdigest()
        if h["x-office-signature"] != sig:
            return httpx.Response(401)
        checks.append((url, await _row_free(ws), await _audit_free(ws)))
        if url == "/api/office/companies":
            return httpx.Response(200, json=[{"id": "pwvsb", "name": "PW VENTURE", "aliases": []}])
        if url == "/api/office/staff":
            return httpx.Response(200, json=staff)
        if url == "/api/office/people":
            return httpx.Response(200, json=[])
        if url == "/api/org/chart":
            return httpx.Response(200, json={"installed": True, "people": []})
        return httpx.Response(404)

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    async with SessionLocal() as db:
        rep = await mirror.run(db, ws)
    assert rep.added, rep  # the new supervisor became a member (an audited write)...
    assert "/api/office/people" in [u for u, _, _ in checks]
    # ...yet every call to Prima ran with the workspace row and the audit lock free.
    assert all(row and audit for _, row, audit in checks), checks
    async with SessionLocal() as db:
        st = await db.scalar(select(Workspace.settings).where(Workspace.id == ws))
    assert st["keep_me"] == 7 and st["prima_mirror"]["on"] is True
    assert st["prima_companies"] == {b.id: "pwvsb"}


async def test_merge_is_one_statement(client):
    ws, _ = await _owner(client)
    async with SessionLocal() as db:
        with counting() as q:
            await workspace_settings.merge(db, ws, {"k": [1, 2]})
        await db.commit()
    assert len(q) == 1 and q[0].lstrip().upper().startswith("UPDATE WORKSPACES"), q
