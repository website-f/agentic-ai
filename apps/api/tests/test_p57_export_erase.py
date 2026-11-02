"""P57: export all of a workspace's data, and erase the workspace (an NDA's return-or-destroy
clause): the export holds that workspace's rows and files and never a secret or a second
workspace's data; the erase leaves no row with the workspace's id in any table, no stored
object, no vault, no cache key, keeps people who belong to another workspace, and writes the
server-level erasure record and the certificate."""

import io
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, text

from agentic.api.main import app
from agentic.brain import vault
from agentic.core.db import SessionLocal
from agentic.core.security import hash_password
from agentic.core.valkey import valkey
from agentic.documents import storage
from agentic.erasure import certificate, erase, export, jobs
from agentic.models import (
    AIProvider,
    AuditLog,
    CrmField,
    CrmObject,
    CrmRecord,
    DocFile,
    Document,
    ErasureRecord,
    Membership,
    Schedule,
    StorageTarget,
    Task,
    User,
    Workspace,
    WorkspaceExport,
)

from .conftest import csrf
from .test_agents import GOOD_KEY, llm, new_agent, new_task, office, temporal  # noqa: F401

PW = "correct-horse-battery"


@pytest.fixture
def files_dir(monkeypatch):
    d = Path(tempfile.mkdtemp(prefix="agentic-files-"))
    monkeypatch.setattr(storage.settings, "files_dir", str(d))
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def jobs_fake(monkeypatch):
    calls: dict[str, list] = {"export": [], "erase": [], "forget": [], "schedule": []}

    async def start_export(eid):
        calls["export"].append(eid)
        return f"export-{eid}"

    async def start_erase(rid):
        calls["erase"].append(rid)
        return f"erase-{rid}"

    async def temporal_forget(wid):
        calls["forget"].append(wid)
        return True

    async def temporal_drop_schedule(sid):
        calls["schedule"].append(sid)

    for name, fn in [
        ("start_export", start_export),
        ("start_erase", start_erase),
        ("temporal_forget", temporal_forget),
        ("temporal_drop_schedule", temporal_drop_schedule),
    ]:
        monkeypatch.setattr(jobs, name, fn)
    return calls


def _json(client) -> dict:
    return {**csrf(client), "content-type": "application/json"}


async def _me(client) -> dict:
    return (await client.get("/api/auth/me")).json()


async def _upload(client, name: str, data: bytes, folder: str = "") -> dict:
    r = await client.post(
        "/api/files",
        params={"name": name, **({"folder": folder} if folder else {})},
        content=data,
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _second_workspace(shared_user_id: str | None = None) -> dict:
    """Another company on the same server, with its own rows, file and key."""
    async with SessionLocal() as db:
        b = Workspace(name="Other Co", slug="other-co")
        db.add(b)
        await db.flush()
        f = DocFile(workspace_id=b.id, name="b.txt", data=b"SECRET-OF-B", created_by="x")
        p = AIProvider(workspace_id=b.id, name="B AI", base_url="https://b.fake/v1")
        p.api_key_enc = "enc-of-b"
        t = StorageTarget(workspace_id=b.id, name="B disk", kind="local", config={}, created_by="x")
        db.add_all([f, p, t])
        if shared_user_id:
            db.add(Membership(workspace_id=b.id, user_id=shared_user_id, role="admin"))
        await db.commit()
        await storage.put(t, f"agentic/{b.id}/bfile.txt", b"B bytes on disk")
        return {"id": b.id, "file": f.id, "target": t.id}


async def _company_data(client, ws_id: str, slug: str) -> None:
    async with SessionLocal() as db:
        obj = CrmObject(workspace_id=ws_id, key="leads", name="Leads", created_by="x")
        db.add(obj)
        await db.flush()
        db.add(
            CrmField(
                workspace_id=ws_id, object_id=obj.id, key="company", label="Company", created_by="x"
            )
        )
        db.add(
            CrmRecord(
                workspace_id=ws_id,
                object_id=obj.id,
                title="Maju",
                data={"company": "Maju Trading", "api_key": "sk-crm-zzz"},
                created_by="x",
            )
        )
        db.add(
            Document(workspace_id=ws_id, title="Quote 7", body="# Quote\nRM 100", created_by="x")
        )
        await db.commit()
    vault.commit(slug, {"wiki/hello.md": "# Hello\nMaju notes"}, "T <t@x>", "test page")


# ---------------------------------------------------------------- export


async def test_export_has_this_workspaces_rows_and_files_and_no_secrets(
    client, llm, temporal, files_dir, jobs_fake
):
    await office(client)
    me = await _me(client)
    ws_id, slug = me["workspace"]["id"], me["workspace"]["slug"]
    in_db = await _upload(client, "notes.txt", b"kept in the database")
    r = await client.post(
        "/api/storage",
        json={"name": "Server disk", "kind": "local", "config": {}, "is_primary": True},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    on_disk = await _upload(client, "price list.txt", b"Cement RM 25 a bag")
    await _company_data(client, ws_id, slug)
    b = await _second_workspace()

    r = await client.post(
        "/api/workspace/data/exports", json={"password": "nope"}, headers=csrf(client)
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/workspace/data/exports", json={"password": PW}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    assert jobs_fake["export"] == [eid]
    counts = await export.build(eid)
    assert counts["files"] == 2 and counts["vault_pages"] == 1 and counts["crm_records"] == 1

    r = await client.get(f"/api/workspace/data/exports/{eid}")
    ex = r.json()
    assert ex["status"] == "ready" and ex["progress"] == 100 and ex["download_url"]
    bad = ex["download_url"].replace("sig=", "sig=0")
    assert (await client.get(bad)).status_code == 403
    got = await client.get(ex["download_url"])
    assert got.status_code == 200, got.text
    assert got.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(got.content))
    names = set(z.namelist())
    everything = b"".join(z.read(n) for n in names)

    # Files with their original bytes, in their folders; the brain; documents; CRM; index.
    assert z.read("files/price list.txt") == b"Cement RM 25 a bag"
    assert z.read("files/notes.txt") == b"kept in the database"
    assert z.read("vault/wiki/hello.md").decode().startswith("# Hello")
    assert "RM 100" in z.read("documents/Quote 7.md").decode()
    crm = z.read("crm/leads.csv").decode("utf-8-sig")
    assert "Maju Trading" in crm and "sk-crm-zzz" not in crm and "[redacted]" in crm
    assert {"README.md", "index.html", "manifest.json"} <= names
    # This workspace's rows, by table.
    files = json.loads(z.read("tables/files.json"))
    assert {f["id"] for f in files} == {in_db["id"], on_disk["id"]}
    assert all("data" not in f for f in files)  # bytes are under files/, not in the JSON
    providers = json.loads(z.read("tables/ai_providers.json"))
    assert providers and all(p["api_key_enc"] == "[redacted]" for p in providers)
    users = json.loads(z.read("tables/users.json"))
    assert [u["email"] for u in users] == ["owner@example.com"]
    assert users[0]["password_hash"] == "[redacted]"
    assert json.loads(z.read("tables/workspaces.json"))[0]["id"] == ws_id
    assert len(json.loads(z.read("tables/audit_log.json"))) >= 1
    # No secret, nothing of the other workspace.
    assert GOOD_KEY.encode() not in everything and b"$argon2" not in everything
    assert b"sk-crm-zzz" not in everything
    assert b["id"].encode() not in everything and b"SECRET-OF-B" not in everything
    assert b"enc-of-b" not in everything

    # Downloadable once: the ZIP is gone after.
    async with SessionLocal() as db:
        row = await db.get(WorkspaceExport, eid)
        assert row.status == "downloaded" and export.file_of(row) is not None
        assert not export.file_of(row).exists()
    again = await client.get(ex["download_url"])
    assert again.status_code == 410


async def test_only_an_owner_sees_data_and_privacy(client, llm, temporal, files_dir):
    await office(client)
    me = await _me(client)
    async with SessionLocal() as db:
        u = User(email="admin@example.com", name="Ad Min", password_hash=hash_password(PW))
        db.add(u)
        await db.flush()
        db.add(Membership(workspace_id=me["workspace"]["id"], user_id=u.id, role="admin"))
        await db.commit()
    other = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    async with other:
        r = await other.post("/api/auth/login", json={"email": "admin@example.com", "password": PW})
        assert r.status_code == 200, r.text
        assert (await other.get("/api/workspace/data")).status_code == 403
        r = await other.post(
            "/api/workspace/data/erasure",
            json={"confirm_name": me["workspace"]["name"], "password": PW},
            headers=csrf(other),
        )
        assert r.status_code == 403
    r = await client.get("/api/workspace/data")
    assert r.status_code == 200 and r.json()["summary"]


# ---------------------------------------------------------------- erase


async def test_a_request_can_be_cancelled_before_the_erase_starts(
    client, llm, temporal, files_dir, jobs_fake
):
    await office(client)
    name = (await _me(client))["workspace"]["name"]
    r = await client.post(
        "/api/workspace/data/erasure",
        json={"confirm_name": "Acme", "password": PW},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "name_mismatch"
    r = await client.post(
        "/api/workspace/data/erasure",
        json={"confirm_name": name, "password": "wrong"},
        headers=csrf(client),
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/workspace/data/erasure",
        json={"confirm_name": name, "password": PW},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert r.json()["status"] == "requested" and r.json()["due_by"]
    r = await client.delete(f"/api/workspace/data/erasure/{rid}", headers=_json(client))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert jobs_fake["erase"] == []
    assert (await client.get("/api/agents")).status_code == 200  # nothing was touched


async def test_erase_removes_everything_of_one_workspace_and_nothing_else(
    client, llm, temporal, files_dir, jobs_fake
):
    o = await office(client)
    me = await _me(client)
    ws_id, slug, name = me["workspace"]["id"], me["workspace"]["slug"], me["workspace"]["name"]
    agent = await new_agent(client, o, "Ana")
    task = await new_task(client, agent, "Count the cement")
    r = await client.post(
        "/api/storage",
        json={"name": "Server disk", "kind": "local", "config": {}, "is_primary": True},
        headers=csrf(client),
    )
    target_id = r.json()["id"]
    await _upload(client, "price list.txt", b"Cement RM 25 a bag")
    await _company_data(client, ws_id, slug)
    async with SessionLocal() as db:
        t = await db.get(StorageTarget, target_id)
        await storage.put(t, f"pc-backups/{ws_id}/dv_1/abc/report.xlsx", b"pc backup bytes")
        staff = User(email="staff@example.com", name="Staff Only", password_hash="x")
        shared = User(email="both@example.com", name="In Both", password_hash="x")
        db.add_all([staff, shared])
        await db.flush()
        db.add(Membership(workspace_id=ws_id, user_id=staff.id, role="staff"))
        db.add(Membership(workspace_id=ws_id, user_id=shared.id, role="admin"))
        sched = Schedule(
            workspace_id=ws_id,
            name="Daily",
            agent_id=agent["id"],
            title="Daily count",
            cron="0 9 * * *",
            created_by="x",
        )
        db.add(sched)
        row = await db.get(Task, task["id"])
        row.workflow_id = f"task-{task['id']}-1"
        await db.commit()
        staff_id, shared_id, sched_id = staff.id, shared.id, sched.id
        owner_id = me["user"]["id"]
        assert await db.scalar(select(AuditLog.id).where(AuditLog.workspace_id == ws_id))
    b = await _second_workspace(shared_id)
    v = valkey()
    await v.set(f"llmcache:{ws_id}:abc", "an answer")
    await v.set(f"events:{ws_id}", "1")
    await v.set(f"browser:task:{task['id']}", "sid-a-123456")
    await v.set("browser:session:sid-a-123456", "{}")
    await v.set(f"agent:{agent['id']}:x", "1")
    await v.set(f"llmcache:{b['id']}:abc", "theirs")
    await v.set(f"events:{b['id']}", "1")
    assert vault.root(slug).exists()

    r = await client.post(
        "/api/workspace/data/erasure",
        json={"confirm_name": name, "password": PW},
        headers=csrf(client),
    )
    rid = r.json()["id"]
    r = await client.post(
        f"/api/workspace/data/erasure/{rid}/start",
        json={"confirm_name": name, "password": PW},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    assert r.json()["status"] == "erasing" and jobs_fake["erase"] == [rid]
    # Once started it cannot be cancelled.
    r = await client.delete(f"/api/workspace/data/erasure/{rid}", headers=_json(client))
    assert r.status_code == 409

    result = await erase.run_all(rid)

    # Database: no row with the workspace's id in any table that has the column.
    async with SessionLocal() as db:
        assert await erase.leftovers(db, ws_id) == {}
        tables = (
            await db.scalars(
                text(
                    "SELECT table_name FROM information_schema.columns WHERE table_schema = "
                    "current_schema() AND column_name = 'workspace_id'"
                )
            )
        ).all()
        assert "files" in tables and "audit_log" in tables
        for t in tables:
            n = await db.scalar(
                text(f"SELECT count(*) FROM {t} WHERE workspace_id = :ws"),  # noqa: S608
                {"ws": ws_id},
            )
            assert n == 0, t
        assert await db.get(Workspace, ws_id) is None
        # People only here are gone; the one in another workspace keeps their account there.
        assert await db.get(User, staff_id) is None and await db.get(User, owner_id) is None
        assert await db.get(User, shared_id) is not None
        assert (
            await db.scalar(
                select(Membership).where(
                    Membership.user_id == shared_id, Membership.workspace_id == b["id"]
                )
            )
        ) is not None
        # The other workspace is untouched.
        assert await db.get(Workspace, b["id"]) is not None
        assert await db.get(DocFile, b["file"]) is not None
        assert (
            await db.scalar(
                select(AIProvider.api_key_enc).where(AIProvider.workspace_id == b["id"])
            )
        ) == "enc-of-b"
        rec = await db.get(ErasureRecord, rid)
    # Storage, vault, cache.
    left = [p for p in files_dir.rglob("*") if p.is_file() and ws_id in p.as_posix()]
    assert left == [] or all(".erasure" in p.as_posix() for p in left)
    assert not list(files_dir.rglob("price list*")) and not list(files_dir.rglob("report.xlsx"))
    assert (
        files_dir / b["id"] / "agentic" / b["id"] / "bfile.txt"
    ).read_bytes() == b"B bytes on disk"
    assert not vault.root(slug).exists()
    for k in (
        f"llmcache:{ws_id}:abc",
        f"events:{ws_id}",
        f"browser:task:{task['id']}",
        "browser:session:sid-a-123456",
        f"agent:{agent['id']}:x",
    ):
        assert await v.get(k) is None, k
    assert await v.get(f"llmcache:{b['id']}:abc") == "theirs"
    assert await v.get(f"events:{b['id']}") == "1"
    # Temporal: running work and schedules removed.
    assert f"task-{task['id']}-1" in jobs_fake["forget"]
    assert sched_id in jobs_fake["schedule"]

    # The server-level record: ids, a name, counts, timestamps, the hash; no content.
    assert rec.status == "done" and rec.completed_at and rec.certificate_sha256
    assert rec.certificate_sha256 == result["sha256"]
    assert rec.counts["files"] == 1 and rec.counts["tasks"] == 1
    flat = json.dumps({"counts": rec.counts, "revoked": rec.revoked})
    assert "Cement" not in flat and "Maju" not in flat and "sk-" not in flat

    # The certificate, fetched with the access token (the owner's session is gone).
    assert (await client.get("/api/auth/me")).status_code == 401
    anon = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    async with anon:
        assert (await anon.get(f"/api/erasure/{rid}", params={"token": "wrong"})).status_code == 404
        s = await anon.get(f"/api/erasure/{rid}", params={"token": token})
        assert s.status_code == 200 and s.json()["status"] == "done"
        cj = await anon.get(f"/api/erasure/{rid}/certificate.json", params={"token": token})
        doc = cj.json()
        pdf = await anon.get(f"/api/erasure/{rid}/certificate.pdf", params={"token": token})
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        r = await anon.post(
            f"/api/erasure/{rid}/retry",
            json={"token": token},
            headers={"content-type": "application/json"},
        )
        assert r.status_code == 409  # only a failed erase is tried again
    assert doc["workspace"] == {"id": ws_id, "name": name}
    assert doc["requested_by"]["email"] == "owner@example.com"
    assert doc["sha256"] == certificate.sha256_of(doc) == rec.certificate_sha256
    assert doc["erased"]["Stored file objects deleted (all storage targets)"] == 2
    assert doc["erased"]["Brain vault files deleted (git history included)"] >= 1
    assert doc["erased"]["Accounts deleted (people only in this workspace)"] == 2
    assert doc["erased"]["Accounts kept (people in other workspaces; access here removed)"] == 1
    assert doc["revoked"]["AI provider keys destroyed"] == 1
    assert doc["verification"]["rows_left_with_workspace_id"] == 0
    assert any(p["kind"] == "AI provider" for p in doc["providers_to_notify"])
    assert any("encrypted server backups" in s for s in doc["statements"])
    assert doc["requested_at"] and doc["completed_at"]
