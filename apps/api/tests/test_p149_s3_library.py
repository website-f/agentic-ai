"""P149a: Library files on the company's S3 file server, compressed; streamed to browsers;
nightly backups there.

The owner (28 Nov 2026): "Compress all Library files to the smallest size. Store all Library
uploads ... on our S3 file server so they don't consume the VPS storage ... when people open the
Library the data streams from there ... don't touch their work and tasks."

A fake S3 server (httpx.MockTransport through storage.use_transport) keeps objects in memory,
answers Range, HEAD and listings, and checks presigned links (signature and expiry).
"""

import asyncio
import datetime as dt
import hashlib
import importlib.util
import io
import re
import time
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse

import httpx
import pytest
from sqlalchemy import select, update

from agentic.core.db import SessionLocal
from agentic.documents import compress, filecache, offload, storage
from agentic.models import DocFile, StorageJob, StorageTarget, Workspace

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_documents import upload
from .test_office_roles import as_role

ENDPOINT = "https://s3.fake"
AK, SK = "AKFAKE", "secret-fake-key"
REPO = Path(__file__).resolve().parents[3]


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.calls: list[tuple[str, str]] = []
        self.flaky_head = False  # Cloudflare in front of the live endpoint: HEAD now and then 403

    def key(self, request: httpx.Request) -> str:
        path = unquote(request.url.path)
        parts = path.lstrip("/").split("/", 1)
        return parts[1] if len(parts) > 1 else ""

    def handler(self, request: httpx.Request) -> httpx.Response:
        key = self.key(request)
        m = request.method
        self.calls.append((m, key))
        if "X-Amz-Signature" in str(request.url):
            return self.presigned(request, key)
        assert request.headers["authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKFAKE/")
        if m == "PUT":
            self.objects[key] = request.content
            return httpx.Response(200, headers={"ETag": f'"{_md5(request.content)}"'})
        if m == "DELETE":
            self.objects.pop(key, None)
            return httpx.Response(204)
        if m == "GET" and not key:
            prefix = request.url.params.get("prefix", "")
            items = "".join(
                f"<Contents><Key>{k}</Key><Size>{len(v)}</Size><ETag>x</ETag></Contents>"
                for k, v in sorted(self.objects.items())
                if k.startswith(prefix)
            )
            return httpx.Response(200, content=f"<ListBucketResult>{items}</ListBucketResult>")
        if key not in self.objects:
            return httpx.Response(404, content=b"<Error><Code>NoSuchKey</Code></Error>")
        data = self.objects[key]
        etag = {"ETag": f'"{_md5(data)}"'}
        if m == "HEAD" and self.flaky_head:
            return httpx.Response(403)
        if m == "HEAD":
            return httpx.Response(200, headers={"Content-Length": str(len(data)), **etag})
        rng = request.headers.get("range")
        if rng:
            a, b = re.match(r"bytes=(\d*)-(\d*)", rng).groups()
            first = int(a) if a else len(data) - int(b)
            last = min(int(b), len(data) - 1) if a and b else len(data) - 1
            if first >= len(data):
                return httpx.Response(416)
            return httpx.Response(
                206,
                content=data[first : last + 1],
                headers={"Content-Range": f"bytes {first}-{last}/{len(data)}", **etag},
            )
        return httpx.Response(200, content=data, headers=etag)

    def presigned(self, request: httpx.Request, key: str, now: dt.datetime | None = None):
        """Checks a presigned link the way S3 does: signature over the same query, not
        expired. The test sets `self.clock` to pretend time passed."""
        q = dict(parse_qsl(request.url.query.decode()))
        signed_at = dt.datetime.strptime(q["X-Amz-Date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.UTC)
        extra = {k: v for k, v in q.items() if not k.startswith("X-Amz-")}
        u = request.url
        again = storage.presign_url(
            "GET",
            f"{u.scheme}://{u.netloc.decode()}{u.path}",
            region="us-east-1",
            access_key=AK,
            secret_key=SK,
            expires=int(q["X-Amz-Expires"]),
            query=extra,
            now=signed_at,
        )
        if dict(parse_qsl(urlparse(again).query))["X-Amz-Signature"] != q["X-Amz-Signature"]:
            return httpx.Response(403, content=b"<Error><Code>SignatureDoesNotMatch</Code></Error>")
        clock = getattr(self, "clock", None) or dt.datetime.now(dt.UTC)
        if clock > signed_at + dt.timedelta(seconds=int(q["X-Amz-Expires"])):
            return httpx.Response(403, content=b"<Error><Code>AccessDenied</Code></Error>")
        data = self.objects.get(key)
        if data is None:
            return httpx.Response(404)
        return httpx.Response(
            200,
            content=data,
            headers={
                "Content-Disposition": q.get("response-content-disposition", ""),
                "Content-Type": q.get("response-content-type", ""),
            },
        )

    def gets(self, key: str) -> int:
        return sum(1 for m, k in self.calls if m == "GET" and k == key)


def _md5(b: bytes) -> str:
    return hashlib.md5(b, usedforsecurity=False).hexdigest()


@pytest.fixture
def s3(monkeypatch, tmp_path):
    fake = FakeS3()
    storage.use_transport(httpx.MockTransport(fake.handler))
    monkeypatch.setattr(storage.settings, "files_dir", str(tmp_path / "files"))
    monkeypatch.setattr(offload, "PACE", {"office": (0, 1e12), "quiet": (0, 1e12)})
    yield fake
    storage.use_transport(None)


async def _ws() -> str:
    async with SessionLocal() as db:
        return (await db.scalars(select(Workspace.id))).one()


async def _bucket(client, primary: bool = True) -> dict:
    r = await client.post(
        "/api/storage",
        json={
            "name": "Grey file server",
            "kind": "s3",
            "config": {
                "endpoint": ENDPOINT,
                "bucket": "app-data",
                "region": "us-east-1",
                "access_key": AK,
                "secret_key": SK,
            },
            "is_primary": primary,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    assert SK not in r.text
    return r.json()


async def _db_file(ws: str, name: str, data: bytes, **kw) -> str:
    async with SessionLocal() as db:
        f = DocFile(
            workspace_id=ws,
            name=name,
            mime=kw.pop("mime", "text/plain"),
            size=len(data),
            sha256=kw.pop("sha256", hashlib.sha256(data).hexdigest()),
            data=data,
            status=kw.pop("status", "ready"),
            created_by="test",
            **kw,
        )
        db.add(f)
        await db.commit()
        return f.id


async def _row(fid: str) -> tuple[DocFile, bytes | None]:
    async with SessionLocal() as db:
        f = await db.get(DocFile, fid)
        data = await db.scalar(select(DocFile.data).where(DocFile.id == fid))
        return f, data


# ---------------------------------------------------------------- move


async def test_move_job_uploads_verifies_switches_and_clears_the_database_copy(
    client, llm, temporal, s3, monkeypatch
):
    await office(client)
    ws = await _ws()
    a = await _db_file(ws, "SOP cuti.txt", b"Annual leave: 14 days." * 50)
    b = await _db_file(ws, "Jadual.csv", b"a,b\n1,2\n" * 30, restricted=True)
    busy = await _db_file(ws, "being read.txt", b"still reading", status="reading")
    before = {fid: (await _row(fid))[0].updated_at for fid in (a, b)}
    target = await _bucket(client)
    monkeypatch.setattr(offload, "quiet_hours", lambda now=None: False)
    s3.flaky_head = True  # checked by reading the first byte instead
    r = await client.post("/api/storage/jobs/move/start", json={}, headers=csrf(client))
    assert r.status_code == 200, r.text
    st = await offload.run_move(ws, time.monotonic() + 30)
    assert st["moved"] == 2 and st["finished_at"]
    for fid, body in ((a, b"Annual leave: 14 days." * 50), (b, b"a,b\n1,2\n" * 30)):
        f, data = await _row(fid)
        assert data is None and f.storage_id == target["id"]
        assert f.storage_key.startswith(f"agentic/{ws}/files/{fid}-")
        assert s3.objects[f.storage_key] == body and f.storage_etag == _md5(body)
        assert f.updated_at == before[fid]  # people's "last changed" lists do not move
        got = await client.get(f"/api/files/{fid}/download")
        assert got.status_code == 200 and got.content == body
    f, data = await _row(busy)
    assert f.storage_id is None and data == b"still reading"  # left for later
    # The owner sees it: counts, bytes, what is left in the database, how to reclaim space.
    ov = (await client.get("/api/storage/jobs")).json()
    assert ov["jobs"]["move"]["moved"] == 2 and ov["on_primary"]["files"] == 2
    assert ov["in_database"]["files"] == 1 and "VACUUM (FULL" in ov["database"]["how"]
    # Pause: the job stops at the next file.
    await client.post("/api/storage/jobs/move/pause", json={}, headers=csrf(client))
    async with SessionLocal() as db:
        j = await db.get(StorageJob, offload.job_id("move", ws))
        assert j.paused and j.enabled
    assert (await offload.tick(5))["jobs"] == 0


async def test_a_file_changed_during_the_move_stays_where_it_is(client, llm, temporal, s3):
    await office(client)
    ws = await _ws()
    fid = await _db_file(ws, "minit.txt", b"version one")
    await _bucket(client)
    real_put = storage.put

    async def put_and_edit(t, key, data):
        await real_put(t, key, data)
        async with SessionLocal() as db:  # someone renames it meanwhile
            await db.execute(update(DocFile).where(DocFile.id == fid).values(name="minit 2.txt"))
            await db.commit()

    storage.put = put_and_edit
    try:
        async with SessionLocal() as db:
            t = await storage.primary(db, ws)
        async with SessionLocal() as db:
            result, _, _ = await offload.move_one(db, t, fid, squeeze=False)
    finally:
        storage.put = real_put
    assert result == "changed"
    f, data = await _row(fid)
    assert f.storage_id is None and data == b"version one"
    assert not any(k.startswith(f"agentic/{ws}/files/{fid}-") for k in s3.objects)


async def test_reads_find_the_bytes_while_a_move_finishes(client, llm, temporal, s3):
    await office(client)
    ws = await _ws()
    fid = await _db_file(ws, "polisi.txt", b"Polisi keselamatan")
    await _bucket(client)
    async with SessionLocal() as reader:
        f = await reader.get(DocFile, fid)  # loaded while still in the database
        assert f.storage_id is None
        async with SessionLocal() as db:
            t = await storage.primary(db, ws)
        async with SessionLocal() as db:
            assert (await offload.move_one(db, t, fid, squeeze=False))[0] == "moved"
        assert await storage.read(reader, f) == b"Polisi keselamatan"  # from the bucket now
    # And the other way: the row points to the bucket but the object is not there (yet).
    fid2 = await _db_file(ws, "draft.txt", b"draft bytes")
    async with SessionLocal() as db:
        f2 = await db.get(DocFile, fid2)
        f2.storage_id, f2.storage_key = t.id, "agentic/missing.txt"  # loaded view only
        assert await storage.read(db, f2) == b"draft bytes"  # from the database copy


# ---------------------------------------------------------------- browsers


async def test_downloads_stream_with_ranges_and_hot_files_come_from_the_cache(
    client, llm, temporal, s3
):
    await office(client)
    await _bucket(client)
    body = bytes(range(256)) * 40
    up = await upload(client, "rekod.bin", body)
    assert up.status_code == 201, up.text
    fid = up.json()["id"]
    f, data = await _row(fid)
    assert data is None and f.storage_key == f"agentic/{f.workspace_id}/files/{fid}.bin"
    part = await client.get(f"/api/files/{fid}/download", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == body[100:200]
    assert part.headers["content-range"] == f"bytes 100-199/{len(body)}"
    assert part.headers["accept-ranges"] == "bytes"
    tail = await client.get(f"/api/files/{fid}/download", headers={"Range": "bytes=-10"})
    assert tail.status_code == 206 and tail.content == body[-10:]
    past = await client.get(f"/api/files/{fid}/download", headers={"Range": "bytes=99999-"})
    assert past.status_code == 416
    whole = await client.get(f"/api/files/{fid}/download")
    assert whole.status_code == 200 and whole.content == body
    assert "sandbox" in whole.headers["content-security-policy"]
    n = s3.gets(f.storage_key)
    again = await client.get(f"/api/files/{fid}/download")
    assert again.content == body and s3.gets(f.storage_key) == n  # served from the cache
    ranged = await client.get(f"/api/files/{fid}/download", headers={"Range": "bytes=0-9"})
    assert ranged.status_code == 206 and ranged.content == body[:10]
    assert s3.gets(f.storage_key) == n
    # read() (agents, extraction) uses the cache too.
    async with SessionLocal() as db:
        assert await storage.read(db, await db.get(DocFile, fid)) == body
    assert s3.gets(f.storage_key) == n
    assert filecache.usage()[0] == 1
    # New bytes for the file: the old copy is dropped from the cache.
    async with SessionLocal() as db:
        row = await db.get(DocFile, fid)
        await storage.replace(db, row, b"new")
        row.size, row.sha256 = 3, hashlib.sha256(b"new").hexdigest()
        await db.commit()
    assert filecache.usage()[0] == 0
    assert (await client.get(f"/api/files/{fid}/download")).content == b"new"


async def test_cache_stays_under_its_cap(s3, monkeypatch):
    monkeypatch.setattr(filecache.settings, "file_cache_mb", 1)
    for i in range(6):
        data = bytes([i]) * 200_000
        filecache._last_evict = 0.0
        filecache.put(f"fl_{i}", hashlib.sha256(data).hexdigest(), data)
        await asyncio.sleep(0.01)
    files, size = filecache.usage()
    assert size <= 1024 * 1024 and files < 6
    newest = bytes([5]) * 200_000
    assert filecache.get("fl_5", hashlib.sha256(newest).hexdigest(), len(newest)) == newest
    assert filecache.get("fl_5", "0" * 64, len(newest)) is None  # other bytes: not a hit


def test_presigned_url_matches_the_aws_example():
    """AWS's published example (Signature V4 query authentication, GET test.txt, 1 day)."""
    url = storage.presign_url(
        "GET",
        "https://examplebucket.s3.amazonaws.com/test.txt",
        region="us-east-1",
        access_key="AKIAIOSFODNN7EXAMPLE",
        secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        expires=86400,
        now=dt.datetime(2013, 5, 24, tzinfo=dt.UTC),
    )
    assert url.endswith(
        "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )


async def test_presigned_links_only_after_the_access_check_and_they_expire(
    client, llm, temporal, s3
):
    o = await office(client)
    await _bucket(client)
    up = await upload(client, "Kontrak.pdf", b"%PDF-1.4 kontrak")
    fid = up.json()["id"]
    r = await client.get(f"/api/files/{fid}/link")
    assert r.status_code == 200, r.text
    link = r.json()
    assert link["direct"] and link["expires_in"] == 60
    q = dict(parse_qsl(urlparse(link["url"]).query))
    assert q["X-Amz-Expires"] == "60" and "attachment" in q["response-content-disposition"]
    assert SK not in link["url"]
    async with httpx.AsyncClient(transport=httpx.MockTransport(s3.handler)) as c:
        ok = await c.get(link["url"])
        assert ok.status_code == 200 and ok.content.startswith(b"%PDF")
        tampered = await c.get(link["url"].replace("attachment", "inline"))
        assert tampered.status_code == 403
        s3.clock = dt.datetime.now(dt.UTC) + dt.timedelta(seconds=61)
        assert (await c.get(link["url"])).status_code == 403  # expired
    # ?direct=1 on a download: a redirect to such a link.
    red = await client.get(f"/api/files/{fid}/download?direct=1")
    assert red.status_code == 307 and red.headers["location"].startswith(ENDPOINT)
    # Someone who may not open the file gets no link.
    staff = await as_role(
        client,
        "staff149@example.com",
        "staff",
        branch_id=o["branch"]["id"],
        department_id=o["depts"]["Operations"],
    )
    try:
        assert (await staff.get(f"/api/files/{fid}/link")).status_code == 404
        assert (await staff.get(f"/api/files/{fid}/download?direct=1")).status_code == 404
    finally:
        await staff.aclose()


async def test_preview_streams_pdfs_from_the_bucket(client, llm, temporal, s3):
    await office(client)
    await _bucket(client)
    body = b"%PDF-1.4\n" + b"x" * 5000
    fid = (await upload(client, "Laporan.pdf", body)).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(DocFile).where(DocFile.id == fid).values(status="ready"))
        await db.commit()
    r = await client.get(f"/api/files/{fid}/preview")
    assert r.status_code == 200 and r.content == body
    assert r.headers["content-type"].startswith("application/pdf")


# ---------------------------------------------------------------- compression backfill


def _photo_jpeg() -> bytes:
    from PIL import Image, ImageFilter

    im = Image.effect_noise((1600, 1200), 40).convert("RGB").filter(ImageFilter.GaussianBlur(2))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=98)
    return b.getvalue()


async def test_compression_backfill_keeps_the_p143c_skip_rules(
    client, llm, temporal, s3, monkeypatch
):
    await office(client)
    ws = await _ws()
    target = await _bucket(client)
    photo = _photo_jpeg()
    assert len(photo) > compress.MIN_BYTES

    async def on_bucket(name: str, data: bytes, **kw) -> str:
        fid = await _db_file(ws, name, data, mime="image/jpeg", **kw)
        async with SessionLocal() as db:
            f = await db.get(DocFile, fid)
            t = await db.get(StorageTarget, target["id"])
            key = storage.file_key(f)
            await storage.put(t, key, data)
            f.data, f.storage_id, f.storage_key = None, t.id, key
            await db.commit()
        return fid

    small = b"\xff\xd8\xff" + b"0" * 1000
    plain = await on_bucket("tapak.jpg", photo)
    skipped = {
        "restricted": await on_bucket("gaji.jpg", photo, restricted=True),
        "held back": await on_bucket("ic.jpg", photo, quarantined=True),
        "made here": await on_bucket("export.jpg", photo, source="generated"),
        "small": await on_bucket("logo.jpg", small),
        "not ready": await on_bucket("baru.jpg", photo, status="reading"),
    }
    in_db = await _db_file(ws, "dalam db.jpg", photo, mime="image/jpeg")
    # While the move runs, files still in Postgres wait to be compressed on their way out.
    async with SessionLocal() as db:
        await offload.set_job(db, "move", ws, "start", "test")
        await offload.set_job(db, "compress", ws, "start", "test")
        await db.commit()
    monkeypatch.setattr(offload, "quiet_hours", lambda now=None: False)
    st = await offload.run_compress(ws, time.monotonic() + 30)
    assert st.get("waiting") == "office hours" and not st.get("smaller")
    monkeypatch.setattr(offload, "quiet_hours", lambda now=None: True)
    st = await offload.run_compress(ws, time.monotonic() + 60)
    assert st["smaller"] == 1, st
    f, _ = await _row(plain)
    assert f.compression["result"] == "smaller" and f.size < len(photo)
    assert f.storage_key.startswith(f"agentic/{ws}/files/{plain}-")
    assert s3.objects[f.storage_key][:3] == b"\xff\xd8\xff"
    assert storage.file_key(f) not in s3.objects  # the old version is gone from the bucket
    assert hashlib.sha256(s3.objects[f.storage_key]).hexdigest() == f.sha256
    for why, fid in skipped.items():
        g, _ = await _row(fid)
        assert g.compression is None, why
        assert s3.objects[g.storage_key] == (small if why == "small" else photo), why
        async with SessionLocal() as db:
            assert compress.skip_reason(await db.get(DocFile, fid)) == why
    g, data = await _row(in_db)
    assert g.compression is None and data == photo
    # The move, in quiet hours, compresses it on the way out.
    st = await offload.run_move(ws, time.monotonic() + 60)
    g, data = await _row(in_db)
    assert data is None and g.compression["result"] == "smaller" and g.size < len(photo)


# ---------------------------------------------------------------- backups


def _backup_module():
    spec = importlib.util.spec_from_file_location(
        "s3backup", REPO / "deploy" / "backup" / "s3backup.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_backup_retention_keeps_14_daily_8_weekly_6_monthly():
    b = _backup_module()
    today = dt.date(2026, 11, 28)
    days = [today - dt.timedelta(days=i) for i in range(400)]
    keep = b.select_keep(days, today)
    assert all(today - dt.timedelta(days=i) in keep for i in range(14))
    assert today - dt.timedelta(days=14) not in keep or (today - dt.timedelta(days=14)).day == 1
    weeks = {tuple(d.isocalendar())[:2] for d in keep}
    assert len(weeks) >= 8
    months = {(d.year, d.month) for d in keep}
    assert len(months) == 6 and (2026, 6) in months and (2026, 5) not in months
    # The newest backup of each month is kept: the last day of a past month.
    assert dt.date(2026, 7, 31) in keep and dt.date(2026, 7, 30) not in keep
    assert len(keep) < 14 + 8 + 6
    # Incomplete backups of earlier days go; today's (being written) stays.
    gone = b.plan_deletions(days[:20], [today, today - dt.timedelta(days=3)], today)
    assert today not in gone and today - dt.timedelta(days=3) not in gone  # complete too
    gone = b.plan_deletions(days[:5], [today - dt.timedelta(days=40), today], today)
    assert gone == [today - dt.timedelta(days=40)]
    # Local dumps: the newest two of each family.
    drop = b.local_rotation(
        {
            "agentic-before-p145.dump": 1,
            "agentic-before-p146.dump": 2,
            "agentic-nightly-1.dump.zst": 3,
            "prima-nightly-1.dump.zst": 1,
            "prima-nightly-2.dump.zst": 2,
            "notes.txt": 0,
        }
    )
    assert drop == ["agentic-before-p145.dump"]


def test_backup_env_is_read_and_never_shown(tmp_path):
    b = _backup_module()
    p = tmp_path / "s3.env"
    p.write_text("# grey\nexport S3_ENDPOINT=https://s3.example\nS3_SECRET_ACCESS_KEY='sss'\n")
    env = b.load_env(str(p))
    assert env == {"S3_ENDPOINT": "https://s3.example", "S3_SECRET_ACCESS_KEY": "sss"}
    s = b.S3("https://s3.example", "r", "AK123", "sss")
    assert "sss" not in repr(s) and "AK123" not in repr(s)


async def test_backup_status_is_shown_to_the_owner(client, llm, temporal, s3):
    await office(client)
    await offload.record_backup(
        {
            "ok": True,
            "date": "2026-11-28",
            "finished_at": "2026-11-28T03:10:00+08:00",
            "bytes": 1234,
            "secret": "never kept",
        }  # fmt: skip
    )
    await offload.record_backup({"ok": False, "error": "S3Error: answered 503"})
    ov = (await client.get("/api/storage/jobs")).json()
    assert ov["backup"]["ok"] is False and ov["backup"]["last_ok_bytes"] == 1234
    assert "secret" not in ov["backup"]
    async with SessionLocal() as db:
        await db.execute(StorageJob.__table__.delete().where(StorageJob.id == "backup"))
        await db.commit()
