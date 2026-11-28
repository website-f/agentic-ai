#!/usr/bin/env python3
"""P149a: nightly backup of the office to the company's S3 file server (bucket "backups").

Run on the VPS host by systemd (deploy/backup/agentic-s3-backup.timer, 02:30 Malaysia time):

    /usr/bin/python3 /opt/agentic-ai/deploy/backup/s3backup.py run      # one backup now
    /usr/bin/python3 /opt/agentic-ai/deploy/backup/s3backup.py plan     # what retention keeps
    /usr/bin/python3 /opt/agentic-ai/deploy/backup/s3backup.py verify [YYYY-MM-DD] [--deep]

What one backup is (s3://backups/agentic/<YYYY-MM-DD>/, Malaysia date):
    agentic-db.dump.zst   pg_dump -Fc of the office database        (zstd -dc | pg_restore)
    prima-db.dump.zst     pg_dump -Fc of the Prima database
    vault.tar.zst         the brain vault volume
    media.tar.zst         the media volume
    files.tar.zst         the files volume (without its read cache)
    manifest.json         size + SHA-256 + ETag of each; written last: no manifest = incomplete

Each object is uploaded in 64 MB parts (each part signed with its SHA-256) and checked after
upload: the size, and the ETag against the MD5s computed here (single or multipart). Retention:
the newest 14 daily, the newest backup of each of the last 8 weeks and of the last 6 months;
everything older (and incomplete backups of earlier days) is deleted, only after a backup
succeeded. The local /root/backups keeps only the newest 2 office and 2 Prima dumps.

Credentials are read at run time from /root/.grey-s3.env (S3_ENDPOINT, S3_REGION,
S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_BACKUPS) and never printed or logged. The
status (time, size, ok, error) goes to /root/backups/last-s3-backup.json and to the office
(System > File storage) through `docker exec agentic-api-1 python -m agentic.documents.offload
backup-status`. Only the Python standard library is used.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import xml.etree.ElementTree as ET  # noqa: S405 - our own bucket's listing
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import quote, urlparse

ENV_FILE = os.environ.get("BACKUP_ENV_FILE", "/root/.grey-s3.env")
LOCAL_DIR = Path(os.environ.get("BACKUP_LOCAL_DIR", "/root/backups"))
PREFIX = os.environ.get("BACKUP_S3_PREFIX", "agentic").strip("/")
PART = 64 * 1024 * 1024
USER_AGENT = "agentic-backup/1.0"
KEEP_DAILY, KEEP_WEEKLY, KEEP_MONTHLY = 14, 8, 6
KEEP_LOCAL = 2
MYT = dt.timezone(dt.timedelta(hours=8))
OFFICE_PG = os.environ.get("BACKUP_OFFICE_PG", "agentic-postgres-1")
PRIMA_PG = os.environ.get("BACKUP_PRIMA_PG", "agentic-prima-db-1")
API = os.environ.get("BACKUP_API_CONTAINER", "agentic-api-1")
VOLUMES = {"vault": "agentic_vault", "media": "agentic_media", "files": "agentic_files"}
ZSTD = ["zstd", "-q", "-T2", "-9"]
_SCRUB: list[str] = []  # the key values, removed from any message before it is shown


def log(msg: str) -> None:
    print(f"{dt.datetime.now(MYT):%Y-%m-%d %H:%M:%S} {msg}", flush=True)


# ---------------------------------------------------------------- retention (pure)


def select_keep(
    dates: Iterable[dt.date],
    today: dt.date,
    daily: int = KEEP_DAILY,
    weekly: int = KEEP_WEEKLY,
    monthly: int = KEEP_MONTHLY,
) -> set[dt.date]:
    """The backup dates to keep: the newest `daily`, the newest of each of the newest
    `weekly` ISO weeks and of the newest `monthly` months. Dates after `today` are kept."""
    ds = sorted(set(dates), reverse=True)
    keep = {d for d in ds if d > today}
    past = [d for d in ds if d <= today]
    keep.update(past[:daily])
    weeks: list[tuple[int, int]] = []
    months: list[tuple[int, int]] = []
    for d in past:  # newest first: the first date seen in a week / month is its newest
        wk = tuple(d.isocalendar())[:2]
        if wk not in weeks:
            weeks.append(wk)  # type: ignore[arg-type]
            if len(weeks) <= weekly:
                keep.add(d)
        mo = (d.year, d.month)
        if mo not in months:
            months.append(mo)
            if len(months) <= monthly:
                keep.add(d)
    return keep


def plan_deletions(
    complete: Iterable[dt.date], incomplete: Iterable[dt.date], today: dt.date
) -> list[dt.date]:
    """Dates to delete: complete backups retention does not keep, and incomplete ones (no
    manifest) of earlier days."""
    complete = set(complete)
    keep = select_keep(complete, today)
    out = {d for d in complete if d not in keep}
    out.update(d for d in incomplete if d < today and d not in complete)
    return sorted(out)


def local_rotation(names_mtimes: dict[str, float], keep: int = KEEP_LOCAL) -> list[str]:
    """Local dumps to delete: of each family (agentic-*, prima-*) all but the newest `keep`."""
    out: list[str] = []
    for fam in ("agentic-", "prima-"):
        mine = [n for n in names_mtimes if n.startswith(fam) and ".dump" in n]
        mine.sort(key=lambda n: names_mtimes[n], reverse=True)
        out.extend(mine[keep:])
    return sorted(out)


# ---------------------------------------------------------------- settings


def load_env(path: str) -> dict[str, str]:
    """KEY=VALUE lines (optional `export`, quotes); values never printed."""
    out: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.removeprefix("export ").split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1]
            out[k.strip()] = v
    return out


# ---------------------------------------------------------------- S3 (SigV4, stdlib)


class S3Error(Exception):
    pass


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _q(s: str, safe: str = "-_.~") -> str:
    return quote(s, safe=safe)


class S3:
    def __init__(self, endpoint: str, region: str, access_key: str, secret_key: str) -> None:
        u = urlparse(endpoint.rstrip("/"))
        if u.scheme not in ("http", "https") or not u.netloc:
            raise S3Error("S3_ENDPOINT is not an http(s) address")
        self.scheme, self.host, self.base = u.scheme, u.netloc, u.path.rstrip("/")
        self.region = region or "us-east-1"
        self._ak, self._sk = access_key, secret_key

    def __repr__(self) -> str:  # never shows the keys
        return f"S3({self.scheme}://{self.host})"

    def _conn(self) -> http.client.HTTPConnection:
        if self.scheme == "https":
            return http.client.HTTPSConnection(
                self.host, timeout=300, context=ssl.create_default_context()
            )
        return http.client.HTTPConnection(self.host, timeout=300)  # noqa: S309 - tests

    def request(
        self,
        method: str,
        bucket: str,
        key: str = "",
        *,
        query: dict[str, str] | None = None,
        body: bytes = b"",
        stream: bool = False,
        extra: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes, http.client.HTTPResponse | None]:
        path = f"{self.base}/{_q(bucket, '')}/" + (_q(key, "/-_.~") if key else "")
        q = query or {}
        cq = "&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(q.items()))
        now = dt.datetime.now(dt.UTC)
        amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        ph = hashlib.sha256(body).hexdigest()
        hdrs = {"host": self.host, "x-amz-content-sha256": ph, "x-amz-date": amz}
        signed = ";".join(sorted(hdrs))
        canon = "\n".join(
            [method, path, cq, "".join(f"{k}:{hdrs[k]}\n" for k in sorted(hdrs)), signed, ph]
        )
        scope = f"{day}/{self.region}/s3/aws4_request"
        sts = "\n".join(
            ["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canon.encode()).hexdigest()]
        )
        k = _hmac(
            _hmac(_hmac(_hmac(f"AWS4{self._sk}".encode(), day), self.region), "s3"), "aws4_request"
        )
        sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
        send = {
            "x-amz-content-sha256": ph,
            "x-amz-date": amz,
            "Authorization": f"AWS4-HMAC-SHA256 Credential={self._ak}/{scope}, "
            f"SignedHeaders={signed}, Signature={sig}",
            "Content-Length": str(len(body)),
            # The endpoint sits behind Cloudflare, which refuses Python's default (or no) agent.
            "User-Agent": USER_AGENT,
            **(extra or {}),
        }
        c = self._conn()
        c.request(method, path + (f"?{cq}" if cq else ""), body=body or None, headers=send)
        r = c.getresponse()
        headers = {k.lower(): v for k, v in r.getheaders()}
        if stream and r.status < 300:
            return r.status, headers, b"", r
        data = r.read()
        c.close()
        return r.status, headers, data, None

    def _check(self, status: int, data: bytes, what: str) -> None:
        if status >= 300:
            code = re.search(rb"<Code>([^<]+)</Code>", data or b"")
            raise S3Error(
                f"{what}: answered {status}" + (f" ({code.group(1).decode()})" if code else "")
            )

    def head(self, bucket: str, key: str) -> tuple[int, str] | None:
        """(size, ETag) or None. Cloudflare in front of the endpoint now and then answers HEAD
        with 403 for an object that is there: then the first byte is read instead."""
        st, h, data, _ = self.request("HEAD", bucket, key)
        if st == 404:
            return None
        if st < 300:
            return int(h.get("content-length") or 0), h.get("etag", "").strip('"')
        st, h, data, _ = self.request("GET", bucket, key, extra={"Range": "bytes=0-0"})
        if st == 404:
            return None
        if st == 416:
            return 0, h.get("etag", "").strip('"')
        self._check(st, data, f"checking {key}")
        total = (h.get("content-range") or "").rpartition("/")[2]
        size = int(total) if total.isdigit() else int(h.get("content-length") or 0)
        return size, h.get("etag", "").strip('"')

    def put(self, bucket: str, key: str, data: bytes) -> str:
        st, h, body, _ = self.request("PUT", bucket, key, body=data)
        self._check(st, body, f"saving {key}")
        return h.get("etag", "").strip('"')

    def get(self, bucket: str, key: str) -> bytes | None:
        st, _, data, _ = self.request("GET", bucket, key)
        if st == 404:
            return None
        self._check(st, data, f"reading {key}")
        return data

    def delete(self, bucket: str, key: str) -> None:
        st, _, data, _ = self.request("DELETE", bucket, key)
        if st != 404:
            self._check(st, data, f"deleting {key}")

    def list(self, bucket: str, prefix: str, delimiter: str = "") -> tuple[list[str], list[str]]:
        """(keys, common prefixes) under `prefix`, all pages."""
        keys: list[str] = []
        prefixes: list[str] = []
        token = ""
        ns = re.compile(r"^\{[^}]*\}")
        while True:
            q = {"list-type": "2", "max-keys": "1000", "prefix": prefix}
            if delimiter:
                q["delimiter"] = delimiter
            if token:
                q["continuation-token"] = token
            st, _, data, _ = self.request("GET", bucket, query=q)
            self._check(st, data, "listing the bucket")
            root = ET.fromstring(data)  # noqa: S314 - our own bucket's listing
            token = ""
            for el in root:
                tag = ns.sub("", el.tag)
                if tag == "Contents":
                    for c in el:
                        if ns.sub("", c.tag) == "Key" and c.text:
                            keys.append(c.text)
                elif tag == "CommonPrefixes":
                    for c in el:
                        if ns.sub("", c.tag) == "Prefix" and c.text:
                            prefixes.append(c.text)
                elif tag == "NextContinuationToken":
                    token = el.text or ""
            if not token:
                return keys, prefixes

    def upload_file(self, bucket: str, key: str, path: Path) -> dict[str, object]:
        """Upload in parts; returns size, sha256, etag and how it was verified."""
        size = path.stat().st_size
        sha = hashlib.sha256()
        if size <= PART:
            data = path.read_bytes()
            sha.update(data)
            md5 = hashlib.md5(data, usedforsecurity=False).hexdigest()
            for attempt in range(3):
                try:
                    self.put(bucket, key, data)
                    break
                except (S3Error, OSError):
                    if attempt == 2:
                        raise
                    time.sleep(5 * (attempt + 1))
            expect = md5
        else:
            st, _, data, _ = self.request("POST", bucket, key, query={"uploads": ""})
            self._check(st, data, f"starting {key}")
            m = re.search(rb"<UploadId>([^<]+)</UploadId>", data)
            if not m:
                raise S3Error(f"starting {key}: no upload id")
            upload_id = m.group(1).decode()
            parts: list[tuple[int, str]] = []
            digests: list[bytes] = []
            try:
                with path.open("rb") as fh:
                    n = 0
                    while chunk := fh.read(PART):
                        n += 1
                        sha.update(chunk)
                        digests.append(hashlib.md5(chunk, usedforsecurity=False).digest())
                        q = {"partNumber": str(n), "uploadId": upload_id}
                        for attempt in range(3):
                            try:
                                st, h, body, _ = self.request(
                                    "PUT", bucket, key, query=q, body=chunk
                                )
                                self._check(st, body, f"part {n} of {key}")
                                break
                            except (S3Error, OSError):
                                if attempt == 2:
                                    raise
                                time.sleep(5 * (attempt + 1))
                        parts.append((n, h.get("etag", "")))
                xml = (
                    "<CompleteMultipartUpload>"
                    + "".join(
                        f"<Part><PartNumber>{n}</PartNumber><ETag>{e}</ETag></Part>"
                        for n, e in parts
                    )
                    + "</CompleteMultipartUpload>"
                )
                st, _, data, _ = self.request(
                    "POST", bucket, key, query={"uploadId": upload_id}, body=xml.encode()
                )
                self._check(st, data, f"finishing {key}")
                if b"<Error>" in data:
                    raise S3Error(f"finishing {key}: the storage reported an error")
            except BaseException:
                with contextlib.suppress(Exception):
                    self.request("DELETE", bucket, key, query={"uploadId": upload_id})
                raise
            expect = (
                hashlib.md5(b"".join(digests), usedforsecurity=False).hexdigest() + f"-{len(parts)}"
            )
        got = self.head(bucket, key)
        if got is None or got[0] != size:
            raise S3Error(f"{key}: the stored size is not the file's size")
        etag = got[1]
        if re.fullmatch(r"[0-9a-f]{32}(-\d+)?", etag or ""):
            if etag != expect:
                raise S3Error(f"{key}: the stored copy's checksum does not match")
            how = "size+etag"
        else:
            how = "size"
        return {"size": size, "sha256": sha.hexdigest(), "etag": etag, "verified": how}

    def stream_sha256(self, bucket: str, key: str) -> tuple[int, str]:
        st, _, data, r = self.request("GET", bucket, key, stream=True)
        if r is None:
            self._check(st, data, f"reading {key}")
            raise S3Error(f"reading {key}: no body")
        h, n = hashlib.sha256(), 0
        while chunk := r.read(1024 * 1024):
            h.update(chunk)
            n += len(chunk)
        r.close()
        return n, h.hexdigest()


# ---------------------------------------------------------------- the backup


def _pipe(producer: list[str], out: Path) -> None:
    """producer | zstd > out, failing when either fails."""
    with out.open("wb") as fh:
        p1 = subprocess.Popen(producer, stdout=subprocess.PIPE)  # noqa: S603 - fixed argv
        p2 = subprocess.Popen(ZSTD, stdin=p1.stdout, stdout=fh)  # noqa: S603 - fixed argv
        assert p1.stdout is not None
        p1.stdout.close()
        r2 = p2.wait()
        r1 = p1.wait()
    if r1 != 0 or r2 != 0:
        raise RuntimeError(f"{producer[0]} {' '.join(producer[1:3])}... failed ({r1}/{r2})")


def _volume_path(name: str) -> Path | None:
    r = subprocess.run(  # noqa: S603 - fixed argv
        ["docker", "volume", "inspect", "-f", "{{ .Mountpoint }}", name],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    p = Path(r.stdout.strip()) if r.returncode == 0 else None
    return p if p and p.is_dir() else None


def make_artifacts(work: Path) -> list[Path]:
    out: list[Path] = []
    office = work / "agentic-db.dump.zst"
    log("dumping the office database")
    _pipe(
        ["docker", "exec", OFFICE_PG, "pg_dump", "-U", "agentic", "-d", "agentic", "-Fc", "-Z0"],
        office,
    )
    out.append(office)
    prima = work / "prima-db.dump.zst"
    log("dumping the Prima database")
    _pipe(
        ["docker", "exec", PRIMA_PG, "pg_dump", "-U", "prima_super", "-d", "prima", "-Fc", "-Z0"],
        prima,
    )
    out.append(prima)
    for label, vol in VOLUMES.items():
        src = _volume_path(vol)
        if src is None:
            log(f"volume {vol} not found; skipped")
            continue
        dest = work / f"{label}.tar.zst"
        log(f"archiving the {label} volume")
        _pipe(["tar", "-C", str(src), "--exclude=./.cache", "-cf", "-", "."], dest)
        out.append(dest)
    return out


def _dates_under(s3: S3, bucket: str) -> tuple[set[dt.date], set[dt.date]]:
    """(complete, incomplete) backup dates in the bucket."""
    _, prefixes = s3.list(bucket, f"{PREFIX}/", delimiter="/")
    complete, incomplete = set(), set()
    for p in prefixes:
        m = re.fullmatch(rf"{re.escape(PREFIX)}/(\d{{4}}-\d{{2}}-\d{{2}})/", p)
        if not m:
            continue
        d = dt.date.fromisoformat(m.group(1))
        (complete if s3.head(bucket, f"{p}manifest.json") else incomplete).add(d)
    return complete, incomplete


def apply_retention(s3: S3, bucket: str, today: dt.date) -> tuple[int, int]:
    complete, incomplete = _dates_under(s3, bucket)
    gone = plan_deletions(complete, incomplete, today)
    for d in gone:
        keys, _ = s3.list(bucket, f"{PREFIX}/{d.isoformat()}/")
        for k in keys:
            s3.delete(bucket, k)
        log(f"deleted the backup of {d} ({len(keys)} objects)")
    return len(complete) - len([d for d in gone if d in complete]), len(gone)


def rotate_local(keep_paths: set[Path]) -> list[str]:
    names = {
        p.name: p.stat().st_mtime
        for p in LOCAL_DIR.iterdir()
        if p.is_file() and ".dump" in p.name and p not in keep_paths
    }
    newest = {p.name: p.stat().st_mtime + 1e9 for p in keep_paths if p.exists()}
    gone = local_rotation({**names, **newest})
    for n in gone:
        with contextlib.suppress(OSError):
            (LOCAL_DIR / n).unlink()
            log(f"removed local dump {n}")
    return gone


def report(status: dict[str, object]) -> None:
    raw = json.dumps(status, default=str)
    with contextlib.suppress(OSError):
        (LOCAL_DIR / "last-s3-backup.json").write_text(raw)
    r = subprocess.run(  # noqa: S603 - fixed argv
        ["docker", "exec", "-i", API, "python", "-m", "agentic.documents.offload", "backup-status"],  # noqa: S607
        input=raw,
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        log("could not hand the status to the office (it is still in last-s3-backup.json)")


def _s3_from_env() -> tuple[S3, str]:
    env = load_env(ENV_FILE)
    missing = [
        k for k in ("S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY") if not env.get(k)
    ]
    if missing:
        raise SystemExit(f"{ENV_FILE} lacks {', '.join(missing)}")
    s3 = S3(
        env["S3_ENDPOINT"],
        env.get("S3_REGION", "us-east-1"),
        env["S3_ACCESS_KEY_ID"],
        env["S3_SECRET_ACCESS_KEY"],
    )
    _SCRUB[:] = [env["S3_ACCESS_KEY_ID"], env["S3_SECRET_ACCESS_KEY"]]
    return s3, env.get("S3_BUCKET_BACKUPS") or "backups"


def run() -> int:
    import fcntl  # Linux only (the tests import this file on any system)

    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    lock = (LOCAL_DIR / ".s3-backup.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another backup is running")
        return 1
    started = dt.datetime.now(MYT)
    today = started.date()
    status: dict[str, object] = {
        "ok": False,
        "date": today.isoformat(),
        "started_at": started.isoformat(timespec="seconds"),
        "bucket_prefix": f"{PREFIX}/{today.isoformat()}/",
    }
    work = LOCAL_DIR / "s3-staging" / today.isoformat()
    try:
        s3, bucket = _s3_from_env()
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        artifacts = make_artifacts(work)
        manifest: dict[str, object] = {"date": today.isoformat(), "files": {}}
        total = 0
        for a in artifacts:
            key = f"{PREFIX}/{today.isoformat()}/{a.name}"
            log(f"uploading {a.name} ({a.stat().st_size // (1024 * 1024)} MB)")
            meta = s3.upload_file(bucket, key, a)
            manifest["files"][a.name] = meta  # type: ignore[index]
            total += int(meta["size"])  # type: ignore[arg-type]
        manifest["finished_at"] = dt.datetime.now(MYT).isoformat(timespec="seconds")
        s3.put(
            bucket,
            f"{PREFIX}/{today.isoformat()}/manifest.json",
            json.dumps(manifest, indent=1).encode(),
        )
        kept, deleted = apply_retention(s3, bucket, today)
        # The newest dumps stay on this server too (a fast restore); older ones go.
        stamp = started.strftime("%Y%m%d-%H%M")
        local = {
            work / "agentic-db.dump.zst": LOCAL_DIR / f"agentic-nightly-{stamp}.dump.zst",
            work / "prima-db.dump.zst": LOCAL_DIR / f"prima-nightly-{stamp}.dump.zst",
        }
        for src, dst in local.items():
            if src.exists():
                os.replace(src, dst)
        removed = rotate_local(set(local.values()))
        status.update(
            ok=True,
            bytes=total,
            objects=len(artifacts) + 1,
            kept=kept,
            deleted=deleted,
            verified=sorted({str(m["verified"]) for m in manifest["files"].values()}),  # type: ignore[union-attr]
            local_kept=KEEP_LOCAL,
        )
        log(
            f"backup done: {total // (1024 * 1024)} MB in {len(artifacts)} files; "
            f"{kept} backups kept, {deleted} deleted, {len(removed)} local dumps removed"
        )
        return 0
    except Exception as e:  # noqa: BLE001 - reported, then a non-zero exit
        msg = f"{e.__class__.__name__}: {e}"
        for v in _SCRUB:  # belt and braces: never a key in a message
            if v:
                msg = msg.replace(v, "***")
        status["error"] = msg[:300]
        log(f"backup FAILED: {status['error']}")
        return 1
    finally:
        status["finished_at"] = dt.datetime.now(MYT).isoformat(timespec="seconds")
        shutil.rmtree(work, ignore_errors=True)
        report(status)
        lock.close()


def plan() -> int:
    s3, bucket = _s3_from_env()
    today = dt.datetime.now(MYT).date()
    complete, incomplete = _dates_under(s3, bucket)
    keep = select_keep(complete, today)
    print(
        json.dumps(
            {
                "complete": sorted(d.isoformat() for d in complete),
                "incomplete": sorted(d.isoformat() for d in incomplete),
                "keep": sorted(d.isoformat() for d in keep),
                "delete": [d.isoformat() for d in plan_deletions(complete, incomplete, today)],
            },
            indent=1,
        )
    )
    return 0


def verify(day: str | None, deep: bool) -> int:
    s3, bucket = _s3_from_env()
    if not day:
        complete, _ = _dates_under(s3, bucket)
        if not complete:
            print("no complete backup")
            return 1
        day = max(complete).isoformat()
    raw = s3.get(bucket, f"{PREFIX}/{day}/manifest.json")
    if raw is None:
        print(f"{day}: no manifest (incomplete)")
        return 1
    bad = 0
    for name, meta in json.loads(raw)["files"].items():
        key = f"{PREFIX}/{day}/{name}"
        got = s3.head(bucket, key)
        ok = got is not None and got[0] == meta["size"]
        if ok and deep:
            n, sha = s3.stream_sha256(bucket, key)
            ok = n == meta["size"] and sha == meta["sha256"]
        bad += 0 if ok else 1
        print(f"{day}/{name}: {'ok' if ok else 'BAD'}")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "run"
    if cmd == "run":
        return run()
    if cmd == "plan":
        return plan()
    if cmd == "verify":
        day = next((a for a in argv[1:] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a)), None)
        return verify(day, "--deep" in argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
