"""P40: company files kept in several places: Postgres, this server's disk, an S3-compatible
bucket (Backblaze B2, AWS S3, R2...) or a WebDAV file server, and storage imported into the
Library.

The live tests run against real servers when STORAGE_IT_S3 / STORAGE_IT_DAV are set, e.g.
    docker run -d -p 127.0.0.1:19000:8000 -e REMOTE_MANAGEMENT_DISABLE=1 -e S3BACKEND=mem \
        zenko/cloudserver
    docker run -d -p 127.0.0.1:19001:8080 rclone/rclone serve webdav /data --addr :8080 \
        --user davuser --pass davpass123
    STORAGE_IT_S3=http://127.0.0.1:19000 STORAGE_IT_DAV=http://127.0.0.1:19001 pytest ...
"""

import os
import shutil
import tempfile
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.documents import service, storage
from agentic.models import DocFile, StorageTarget

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401


@pytest.fixture
def files_dir(monkeypatch):
    d = Path(tempfile.mkdtemp(prefix="agentic-files-"))
    monkeypatch.setattr(storage.settings, "files_dir", str(d))
    yield d
    shutil.rmtree(d, ignore_errors=True)


async def _upload(client, name: str, data: bytes) -> dict:
    r = await client.post(
        "/api/files",
        params={"name": name},
        content=data,
        headers={**csrf(client), "content-type": "application/octet-stream"},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_new_files_go_to_the_primary_storage_and_come_back(client, llm, temporal, files_dir):
    await office(client)
    r = await client.post(
        "/api/storage",
        json={"name": "Server disk", "kind": "local", "config": {}, "is_primary": True},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    target = r.json()
    assert target["is_primary"] and "secret_key_enc" not in str(target)
    f = await _upload(client, "price list.txt", b"Cement RM 25 a bag")
    async with SessionLocal() as db:
        row = await db.get(DocFile, f["id"])
        assert row.storage_id == target["id"] and row.storage_key.startswith("agentic/")
        assert await db.scalar(select(DocFile.data).where(DocFile.id == f["id"])) is None
    on_disk = list(files_dir.rglob("*.txt"))
    assert len(on_disk) == 1 and on_disk[0].read_bytes() == b"Cement RM 25 a bag"
    got = await client.get(f"/api/files/{f['id']}/download")
    assert got.status_code == 200 and got.content == b"Cement RM 25 a bag"
    # In use: the storage cannot be removed.
    json_h = {**csrf(client), "content-type": "application/json"}
    r = await client.delete(f"/api/storage/{target['id']}", headers=json_h)
    assert r.status_code == 409
    # Deleting the file deletes its bytes on the disk too.
    r = await client.delete(f"/api/files/{f['id']}", headers=json_h)
    assert r.status_code == 204 and not list(files_dir.rglob("*.txt"))


async def test_a_storage_that_fails_never_loses_an_upload(client, llm, temporal):
    await office(client)
    async with SessionLocal() as db:
        ws = (await db.scalars(select(DocFile.workspace_id))).first()
        from agentic.models import Workspace

        ws_id = (await db.scalars(select(Workspace.id))).one()
        t = StorageTarget(
            id="st_broken",
            workspace_id=ws_id,
            name="Broken bucket",
            kind="s3",
            config={"endpoint": "http://127.0.0.1:9", "bucket": "b", "access_key": "k"},
            is_primary=True,
            created_by="test",
        )
        db.add(t)
        await db.commit()
        assert ws is None
    f = await _upload(client, "note.txt", b"keep me")
    async with SessionLocal() as db:
        row = await db.get(DocFile, f["id"])
        assert row.storage_id is None  # kept in the database instead
    got = await client.get(f"/api/files/{f['id']}/download")
    assert got.content == b"keep me"


async def test_a_bad_storage_is_never_saved(client, llm, temporal):
    await office(client)
    r = await client.post(
        "/api/storage",
        json={
            "name": "Nowhere",
            "kind": "webdav",
            "config": {"url": "http://127.0.0.1:9/dav", "username": "u", "password": "p"},
        },
        headers=csrf(client),
    )
    assert r.status_code == 422 and r.json()["code"] == "storage_check_failed"
    bad = await client.post(
        "/api/storage",
        json={"name": "x", "kind": "local", "config": {"bucket": "b"}},
        headers=csrf(client),
    )
    assert bad.status_code == 422


async def test_a_source_is_imported_into_the_library_and_read_in_place(
    client, llm, temporal, files_dir, monkeypatch
):
    o = await office(client)
    folder = files_dir / "sop-share"
    (folder / "HR").mkdir(parents=True)
    (folder / "HR" / "Leave policy.txt").write_text("Annual leave: 14 days a year.")
    (folder / "Tender checklist.md").write_text("# Tender\n- SSM certificate\n- Bank statement")
    (folder / "setup.exe").write_bytes(b"MZ")  # not a document: skipped
    read: list[str] = []

    async def reading(fid: str) -> None:
        read.append(fid)
        async with SessionLocal() as db:
            await service.process_file(db, fid)

    import agentic.api.routers.files as files_router

    monkeypatch.setattr(files_router, "start_reading", reading)
    r = await client.post(
        "/api/storage",
        json={
            "name": "SOP share",
            "kind": "local",
            "config": {"folder": "sop-share"},
            "sync": {"enabled": True, "branch_id": o["branch"]["id"]},
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    r = await client.post(f"/api/storage/{tid}/sync", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["new"] == 2 and r.json()["skipped"] == 1 and len(read) == 2
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DocFile).where(DocFile.storage_id == tid))).all()
        assert {f.name for f in rows} == {"Leave policy.txt", "Tender checklist.md"}
        assert all(f.library and f.status == "ready" for f in rows)
        leave = next(f for f in rows if f.name == "Leave policy.txt")
        assert leave.folder == "SOP share/HR" and leave.storage_key == "HR/Leave policy.txt"
    # Again: nothing new. A changed file is read again; a removed one leaves the Library.
    r = await client.post(f"/api/storage/{tid}/sync", json={}, headers=csrf(client))
    assert r.json()["new"] == 0 and r.json()["changed"] == 0
    (folder / "HR" / "Leave policy.txt").write_text("Annual leave: 16 days a year from 2027.")
    os.utime(folder / "HR" / "Leave policy.txt", (2_000_000_000, 2_000_000_000))
    (folder / "Tender checklist.md").unlink()
    r = await client.post(f"/api/storage/{tid}/sync", json={}, headers=csrf(client))
    assert r.json()["changed"] == 1 and r.json()["gone"] == 1
    hits = (await client.get("/api/library/search", params={"q": "annual leave days"})).json()
    assert any("16 days" in h["text"] for h in hits)


# ---------------------------------------------------------------- live servers


S3 = os.environ.get("STORAGE_IT_S3")
DAV = os.environ.get("STORAGE_IT_DAV")


def _target(kind: str, config: dict) -> StorageTarget:
    t = StorageTarget(id=f"st_it_{kind}", workspace_id="ws_it", name=f"IT {kind}", kind=kind)
    t.config = storage.seal_config(t.id, config)
    return t


async def _roundtrip(t: StorageTarget) -> None:
    await storage.check(t)
    await storage.put(t, "folder/a b/report.txt", b"hello storage")
    assert await storage.get(t, "folder/a b/report.txt") == b"hello storage"
    keys = {e.key for e in await storage.list_files(t, "folder/")}
    assert "folder/a b/report.txt" in keys
    await storage.delete(t, "folder/a b/report.txt")
    with pytest.raises(storage.StorageError):
        await storage.get(t, "folder/a b/report.txt")


@pytest.mark.skipif(not S3, reason="no S3 server (STORAGE_IT_S3)")
async def test_live_s3_compatible_bucket():
    bucket = "agentic-it"
    url = f"{S3}/{bucket}/"
    headers = storage.sigv4_headers(
        "PUT", url, region="us-east-1", access_key="accessKey1", secret_key="verySecretKey1"
    )
    async with httpx.AsyncClient() as c:
        r = await c.put(url, headers=headers)
        assert r.status_code in (200, 409), r.text  # made, or already there
    t = _target(
        "s3",
        {
            "endpoint": S3,
            "bucket": bucket,
            "region": "us-east-1",
            "access_key": "accessKey1",
            "secret_key": "verySecretKey1",
        },
    )
    await _roundtrip(t)
    wrong = _target(
        "s3",
        {
            "endpoint": S3,
            "bucket": bucket,
            "access_key": "accessKey1",
            "secret_key": "not-the-secret",
        },
    )
    with pytest.raises(storage.StorageError):
        await storage.check(wrong)  # the server checks our signature


@pytest.mark.skipif(not DAV, reason="no WebDAV server (STORAGE_IT_DAV)")
async def test_live_webdav_file_server():
    t = _target("webdav", {"url": DAV, "username": "davuser", "password": "davpass123"})
    await _roundtrip(t)
    wrong = _target("webdav", {"url": DAV, "username": "davuser", "password": "nope"})
    with pytest.raises(storage.StorageError):
        await storage.check(wrong)
