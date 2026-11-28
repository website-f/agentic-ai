"""P40: where file bytes live. A company's documents can be kept in several places at once:

- db       in Postgres (DocFile.data), as before; the default, covered by the nightly backup
- local    this server's disk (settings.files_dir, a Docker volume)
- s3       any S3-compatible bucket: Backblaze B2, AWS S3, Cloudflare R2, Wasabi, MinIO
- webdav   a company's own file server: Nextcloud, ownCloud, Synology, QNAP, IIS, Apache...

A storage target (StorageTarget) is set up by an owner or admin. One may be the primary:
new files go there. Any target may also be a source: its files are imported into a company's
Library and read in place (they are not copied into the database). Every read of a file's
bytes goes through `read()`, whatever the place.

P149a: files are moved off the VPS onto the company's S3 file server (documents/offload.py);
`read()` finds the bytes wherever they are at that moment (a move may finish between loading a
file and reading it) and keeps hot ones in a small disk cache (filecache.py). Browsers are
served by `open_stream()` (chunked, with Range) or a short-lived presigned URL
(`presigned_get`), never by loading a whole file into the API process.

S3 requests are signed with AWS Signature V4 (no SDK). Credentials are encrypted at rest with
the master key (core/crypto.py) and never returned by the API.
"""

import asyncio
import datetime as dt
import hashlib
import hmac
import logging
import os
import re
import xml.etree.ElementTree as ET  # noqa: S405 - parses our own storage's listing XML
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.config import settings
from ..models import DocFile, StorageTarget
from . import filecache

log = logging.getLogger("agentic.storage")

KINDS = ("local", "s3", "webdav")
TIMEOUT = 60
MAX_LIST = 5000
CHUNK = 256 * 1024  # bytes per piece when a file is streamed
_transport: httpx.AsyncBaseTransport | None = None  # tests replace it


def use_transport(t: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = t


class StorageError(Exception):
    """A storage target could not do what was asked (with a sentence for people)."""


@dataclass
class Entry:
    key: str
    size: int
    etag: str
    modified: str


def _client() -> httpx.AsyncClient:
    # P149a: a named agent: the company's S3 endpoint sits behind Cloudflare, which refuses
    # some library defaults.
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        transport=_transport,
        follow_redirects=False,
        headers={"User-Agent": "agentic-office/1.0"},
    )


# ---------------------------------------------------------------- secrets


SECRET_FIELDS = ("secret_key", "password")


def seal_config(target_id: str, config: dict[str, Any]) -> dict[str, Any]:
    out = dict(config)
    for k in SECRET_FIELDS:
        v = out.pop(k, None)
        if v:
            out[f"{k}_enc"] = crypto.encrypt(str(v), f"storage:{target_id}:{k}")
    return out


def _secret(t: StorageTarget, k: str) -> str:
    enc = (t.config or {}).get(f"{k}_enc")
    if not enc:
        return ""
    try:
        return crypto.decrypt(enc, f"storage:{t.id}:{k}")
    except crypto.DecryptError as e:
        raise StorageError(
            f"The {k.replace('_', ' ')} of {t.name} cannot be read here; enter it again."
        ) from e


def public_config(t: StorageTarget) -> dict[str, Any]:
    """What the API shows: everything but the secrets (only whether one is set)."""
    c = dict(t.config or {})
    out = {k: v for k, v in c.items() if not k.endswith("_enc")}
    for k in SECRET_FIELDS:
        out[f"{k}_set"] = bool(c.get(f"{k}_enc"))
    return out


# ---------------------------------------------------------------- local disk


def _local_root(t: StorageTarget) -> Path:
    sub = re.sub(r"[^A-Za-z0-9_-]", "", str((t.config or {}).get("folder") or t.workspace_id))
    return (Path(settings.files_dir) / (sub or t.workspace_id)).resolve()


def _local_path(t: StorageTarget, key: str) -> Path:
    root = _local_root(t)
    p = (root / key).resolve()
    if root != p and root not in p.parents:
        raise StorageError("That path leaves the storage folder.")
    return p


async def _local_put(t: StorageTarget, key: str, data: bytes) -> None:
    def write() -> None:
        p = _local_path(t, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, p)

    await asyncio.to_thread(write)


async def _local_get(t: StorageTarget, key: str) -> bytes:
    p = _local_path(t, key)
    try:
        return await asyncio.to_thread(p.read_bytes)
    except FileNotFoundError as e:
        raise StorageError("The file is no longer on this server's disk.") from e


async def _local_delete(t: StorageTarget, key: str) -> None:
    p = _local_path(t, key)
    await asyncio.to_thread(lambda: p.unlink(missing_ok=True))


async def _local_list(t: StorageTarget, prefix: str) -> list[Entry]:
    root = _local_root(t)

    def walk() -> list[Entry]:
        base = _local_path(t, prefix) if prefix else root
        out: list[Entry] = []
        if not base.exists():
            return out
        for dirpath, _, names in os.walk(base):
            for n in names:
                if n.endswith(".part") or n.startswith("."):
                    continue
                p = Path(dirpath) / n
                st = p.stat()
                key = p.relative_to(root).as_posix()
                out.append(Entry(key, st.st_size, f"{st.st_size}-{int(st.st_mtime)}", ""))
                if len(out) >= MAX_LIST:
                    return out
        return out

    return await asyncio.to_thread(walk)


# ---------------------------------------------------------------- S3 (SigV4)


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sigv4_headers(
    method: str,
    url: str,
    *,
    region: str,
    access_key: str,
    secret_key: str,
    payload: bytes = b"",
    query: dict[str, str] | None = None,
    now: dt.datetime | None = None,
) -> dict[str, str]:
    """AWS Signature Version 4 headers for one S3 request (path-style URL)."""
    now = now or dt.datetime.now(dt.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    u = urlparse(url)
    host = u.netloc
    # The path as sent, encoded once (S3 does not double-encode): decode, then encode
    # everything but the unreserved characters.
    canonical_uri = quote(unquote(u.path or "/"), safe="/~-_.")
    q = query or {}
    canonical_query = "&".join(
        f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(q.items())
    )
    payload_hash = hashlib.sha256(payload).hexdigest()
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    signed = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical = "\n".join(
        [method, canonical_uri, canonical_query, canonical_headers, signed, payload_hash]
    )
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    k = _sign(_sign(_sign(_sign(f"AWS4{secret_key}".encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed}, "
            f"Signature={signature}"
        ),
    }


def presign_url(
    method: str,
    url: str,
    *,
    region: str,
    access_key: str,
    secret_key: str,
    expires: int = 60,
    query: dict[str, str] | None = None,
    now: dt.datetime | None = None,
) -> str:
    """P149a: a URL anyone holding it may use for `expires` seconds (SigV4 query signing,
    UNSIGNED-PAYLOAD, only the host header signed). `query` adds S3's response-* overrides
    (Content-Disposition, Content-Type), which are signed too and so cannot be changed."""
    now = now or dt.datetime.now(dt.UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    u = urlparse(url)
    scope = f"{day}/{region}/s3/aws4_request"
    q = dict(query or {})
    q.update(
        {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": f"{access_key}/{scope}",
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(max(1, min(int(expires), 7 * 24 * 3600))),
            "X-Amz-SignedHeaders": "host",
        }
    )
    canonical_uri = quote(unquote(u.path or "/"), safe="/~-_.")
    canonical_query = "&".join(
        f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(q.items())
    )
    canonical = "\n".join(
        [method, canonical_uri, canonical_query, f"host:{u.netloc}\n", "host", "UNSIGNED-PAYLOAD"]
    )
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    k = _sign(_sign(_sign(_sign(f"AWS4{secret_key}".encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{u.scheme}://{u.netloc}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def _s3(t: StorageTarget) -> tuple[str, str, str, str, str]:
    c = t.config or {}
    endpoint = str(c.get("endpoint") or "").rstrip("/")
    bucket = str(c.get("bucket") or "")
    if not endpoint.startswith(("http://", "https://")) or not bucket:
        raise StorageError(f"{t.name} needs an endpoint address and a bucket.")
    return (
        endpoint,
        bucket,
        str(c.get("region") or "us-east-1"),
        str(c.get("access_key") or ""),
        _secret(t, "secret_key"),
    )


def _s3_url(endpoint: str, bucket: str, key: str) -> str:
    return f"{endpoint}/{quote(bucket, safe='')}/{quote(key, safe='/~-_.')}"


async def _s3_call(
    t: StorageTarget,
    method: str,
    key: str = "",
    *,
    data: bytes = b"",
    query: dict[str, str] | None = None,
    extra: dict[str, str] | None = None,
) -> httpx.Response:
    endpoint, bucket, region, ak, sk = _s3(t)
    url = _s3_url(endpoint, bucket, key) if key else f"{endpoint}/{quote(bucket, safe='')}/"
    headers = sigv4_headers(
        method, url, region=region, access_key=ak, secret_key=sk, payload=data, query=query
    )
    if query:  # sent exactly as it was signed (httpx would encode it its own way)
        url += "?" + "&".join(
            f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(query.items())
        )
    async with _client() as c:
        return await c.request(
            method, httpx.URL(url), content=data or None, headers={**headers, **(extra or {})}
        )


def _s3_error(r: httpx.Response, what: str) -> StorageError:
    code = re.search(r"<Code>([^<]+)</Code>", r.text or "")
    return StorageError(
        f"{what}: the storage answered {r.status_code}" + (f" ({code.group(1)})" if code else "")
    )


async def _s3_put(t: StorageTarget, key: str, data: bytes) -> None:
    r = await _s3_call(t, "PUT", key, data=data)
    if r.status_code >= 300:
        raise _s3_error(r, "Saving the file failed")


async def _s3_get(t: StorageTarget, key: str) -> bytes:
    r = await _s3_call(t, "GET", key)
    if r.status_code == 404:
        raise StorageError("The file is no longer in the bucket.")
    if r.status_code >= 300:
        raise _s3_error(r, "Reading the file failed")
    return r.content


async def _s3_head(t: StorageTarget, key: str) -> tuple[int, str] | None:
    """(size, ETag without quotes) of an object, or None when it is not there. P149a: the
    company's endpoint sits behind Cloudflare, which now and then answers HEAD with 403 for an
    object that is there: then the first byte is read instead (GET is answered reliably)."""
    r = await _s3_call(t, "HEAD", key)
    if r.status_code == 404:
        return None
    if r.status_code < 300:
        return int(r.headers.get("content-length") or 0), r.headers.get("etag", "").strip('"')
    r = await _s3_call(t, "GET", key, extra={"Range": "bytes=0-0"})
    if r.status_code == 404:
        return None
    if r.status_code == 416:  # an empty object
        return 0, r.headers.get("etag", "").strip('"')
    if r.status_code >= 300:
        raise _s3_error(r, "Checking the file failed")
    total = (r.headers.get("content-range") or "").rpartition("/")[2]
    size = int(total) if total.isdigit() else int(r.headers.get("content-length") or 0)
    return size, r.headers.get("etag", "").strip('"')


async def _s3_delete(t: StorageTarget, key: str) -> None:
    r = await _s3_call(t, "DELETE", key)
    if r.status_code >= 300 and r.status_code != 404:
        raise _s3_error(r, "Deleting the file failed")


_NS = re.compile(r"^\{[^}]*\}")


async def _s3_list(t: StorageTarget, prefix: str) -> list[Entry]:
    out: list[Entry] = []
    token = ""
    while len(out) < MAX_LIST:
        q = {"list-type": "2", "max-keys": "1000"}
        if prefix:
            q["prefix"] = prefix
        if token:
            q["continuation-token"] = token
        r = await _s3_call(t, "GET", query=q)
        if r.status_code >= 300:
            raise _s3_error(r, "Listing the bucket failed")
        root = ET.fromstring(r.content)  # noqa: S314 - the bucket's own listing
        token = ""
        for el in root:
            tag = _NS.sub("", el.tag)
            if tag == "Contents":
                f = {_NS.sub("", c.tag): (c.text or "") for c in el}
                key = f.get("Key", "")
                if key and not key.endswith("/"):
                    out.append(
                        Entry(
                            key,
                            int(f.get("Size") or 0),
                            f.get("ETag", "").strip('"'),
                            f.get("LastModified", ""),
                        )
                    )
            elif tag == "NextContinuationToken":
                token = el.text or ""
        if not token:
            break
    return out


# ---------------------------------------------------------------- WebDAV


def _dav(t: StorageTarget) -> tuple[str, Any]:
    """(base url, auth): basic auth when a username is set, else the client default."""
    c = t.config or {}
    url = str(c.get("url") or "").rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise StorageError(f"{t.name} needs the file server's address (https://...).")
    user = str(c.get("username") or "")
    if not user:
        return url, httpx.USE_CLIENT_DEFAULT
    return url, httpx.BasicAuth(user, _secret(t, "password"))


def _dav_url(base: str, key: str) -> str:
    return f"{base}/{quote(key, safe='/~-_.')}"


async def _dav_put(t: StorageTarget, key: str, data: bytes) -> None:
    base, auth = _dav(t)
    async with _client() as c:
        parts = key.split("/")[:-1]
        for i in range(1, len(parts) + 1):  # make the folders (405 = already there)
            await c.request("MKCOL", _dav_url(base, "/".join(parts[:i])) + "/", auth=auth)
        r = await c.put(_dav_url(base, key), content=data, auth=auth)
    if r.status_code >= 300:
        raise StorageError(f"Saving the file failed: the file server answered {r.status_code}.")


async def _dav_get(t: StorageTarget, key: str) -> bytes:
    base, auth = _dav(t)
    async with _client() as c:
        r = await c.get(_dav_url(base, key), auth=auth)
    if r.status_code == 404:
        raise StorageError("The file is no longer on the file server.")
    if r.status_code >= 300:
        raise StorageError(f"Reading the file failed: the file server answered {r.status_code}.")
    return r.content


async def _dav_delete(t: StorageTarget, key: str) -> None:
    base, auth = _dav(t)
    async with _client() as c:
        r = await c.delete(_dav_url(base, key), auth=auth)
    if r.status_code >= 300 and r.status_code != 404:
        raise StorageError(f"Deleting the file failed: the file server answered {r.status_code}.")


PROPFIND = (
    '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>'
    "<d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/>"
    "</d:prop></d:propfind>"
)


async def _dav_list(t: StorageTarget, prefix: str) -> list[Entry]:
    base, auth = _dav(t)
    base_path = urlparse(base).path.rstrip("/")
    out: list[Entry] = []
    folders = [prefix.strip("/")]
    seen: set[str] = set()
    async with _client() as c:
        while folders and len(out) < MAX_LIST:
            folder = folders.pop()
            if folder in seen:
                continue
            seen.add(folder)
            url = _dav_url(base, folder) + "/" if folder else base + "/"
            r = await c.request(
                "PROPFIND",
                url,
                content=PROPFIND,
                headers={"Depth": "1", "Content-Type": "application/xml"},
                auth=auth,
            )
            if r.status_code >= 300:
                raise StorageError(f"Listing the file server failed: it answered {r.status_code}.")
            root = ET.fromstring(r.content)  # noqa: S314 - the file server's own listing
            for resp in root:
                if _NS.sub("", resp.tag) != "response":
                    continue
                href = next((x.text or "" for x in resp if _NS.sub("", x.tag) == "href"), "")
                path = unquote(urlparse(href).path)
                rel = path[len(base_path) :].strip("/") if path.startswith(base_path) else ""
                props: dict[str, Any] = {}
                is_dir = False
                for el in resp.iter():
                    tag = _NS.sub("", el.tag)
                    if tag == "collection":
                        is_dir = True
                    elif tag in ("getcontentlength", "getetag", "getlastmodified"):
                        props[tag] = el.text or ""
                if not rel or rel == folder:
                    continue
                if is_dir:
                    folders.append(rel)
                else:
                    out.append(
                        Entry(
                            rel,
                            int(props.get("getcontentlength") or 0),
                            str(props.get("getetag") or "").strip('"'),
                            str(props.get("getlastmodified") or ""),
                        )
                    )
    return out


# ---------------------------------------------------------------- dispatch


_OPS = {
    "local": (_local_put, _local_get, _local_delete, _local_list),
    "s3": (_s3_put, _s3_get, _s3_delete, _s3_list),
    "webdav": (_dav_put, _dav_get, _dav_delete, _dav_list),
}


def _ops(t: StorageTarget) -> tuple[Any, Any, Any, Any]:
    ops = _OPS.get(t.kind)
    if ops is None:
        raise StorageError(f"Unknown storage kind {t.kind}.")
    return ops


async def _approved(t: StorageTarget) -> None:
    """P57: with the approved-services lock on, outside storage the company has not approved
    is neither written nor read (this server's disk needs no approval; deleting always may)."""
    if t.kind == "local":
        return
    from ..core.db import SessionLocal
    from ..engine import compliance

    async with SessionLocal() as db:
        ok = await compliance.allowed(db, t.workspace_id, f"storage:{t.id}", t.name, "a file")
    if not ok:
        raise StorageError(compliance.BLOCKED.format(label=t.name))


async def put(t: StorageTarget, key: str, data: bytes) -> None:
    await _approved(t)
    await _ops(t)[0](t, key, data)


async def get(t: StorageTarget, key: str) -> bytes:
    await _approved(t)
    return await _ops(t)[1](t, key)


async def delete(t: StorageTarget, key: str) -> None:
    await _ops(t)[2](t, key)


async def list_files(t: StorageTarget, prefix: str = "") -> list[Entry]:
    return await _ops(t)[3](t, prefix)


# ---------------------------------------------------------------- P149a: head, stream, link


async def head(t: StorageTarget, key: str) -> tuple[int, str] | None:
    """(size, ETag) of a stored file, or None when it is not there."""
    if t.kind == "s3":
        await _approved(t)
        return await _s3_head(t, key)
    if t.kind == "local":
        p = _local_path(t, key)
        try:
            st = await asyncio.to_thread(p.stat)
        except FileNotFoundError:
            return None
        return st.st_size, f"{st.st_size}-{int(st.st_mtime)}"
    if t.kind == "webdav":
        await _approved(t)
        base, auth = _dav(t)
        async with _client() as c:
            r = await c.head(_dav_url(base, key), auth=auth)
        if r.status_code == 404:
            return None
        if r.status_code >= 300:
            raise StorageError(
                f"Checking the file failed: the file server answered {r.status_code}."
            )
        return int(r.headers.get("content-length") or 0), r.headers.get("etag", "").strip('"')
    raise StorageError(f"Unknown storage kind {t.kind}.")


_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """(first, last) byte of one `Range: bytes=a-b` over `size` bytes; None for the whole
    file (no header, several ranges, or one this does not understand). Raises ValueError for
    a range past the end (416)."""
    m = _RANGE.match((header or "").strip())
    if not m or (not m.group(1) and not m.group(2)):
        return None
    if m.group(1):
        first = int(m.group(1))
        last = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
    else:  # the last n bytes
        n = int(m.group(2))
        if n == 0:
            raise ValueError("empty suffix range")
        first, last = max(0, size - n), size - 1
    if first >= size or first > last:
        raise ValueError("range not satisfiable")
    return first, last


@dataclass
class Opened:
    """A stored file opened for streaming. status 200 (whole file) or 206 (`content_range`);
    `body` yields it in pieces and closes the connection when done or dropped."""

    status: int
    length: int | None
    content_range: str | None
    etag: str
    body: AsyncIterator[bytes] = field(repr=False)


class RangeNotSatisfiable(StorageError):
    """The range asked for is past the end of the file."""


async def _http_stream(url: str, headers: dict[str, str], auth: Any, what: str) -> Opened:
    c = _client()
    extra: dict[str, Any] = {}
    if auth is not None and auth is not httpx.USE_CLIENT_DEFAULT:
        extra["auth"] = auth
    try:
        req = c.build_request("GET", httpx.URL(url), headers=headers)
        r = await c.send(req, stream=True, **extra)
    except BaseException:
        await c.aclose()
        raise
    if r.status_code >= 300:
        await r.aread()
        await r.aclose()
        await c.aclose()
        if r.status_code == 416:
            raise RangeNotSatisfiable("That part of the file does not exist.")
        if r.status_code == 404:
            raise StorageError(f"The file is no longer in {what}.")
        raise StorageError(f"Reading the file failed: {what} answered {r.status_code}.")

    async def body() -> AsyncIterator[bytes]:
        try:
            async for chunk in r.aiter_bytes(CHUNK):
                yield chunk
        finally:
            await r.aclose()
            await c.aclose()

    length = r.headers.get("content-length")
    return Opened(
        status=206 if r.status_code == 206 else 200,
        length=int(length) if length and length.isdigit() else None,
        content_range=r.headers.get("content-range") if r.status_code == 206 else None,
        etag=r.headers.get("etag", "").strip('"'),
        body=body(),
    )


async def open_stream(t: StorageTarget, key: str, range_header: str | None = None) -> Opened:
    """Open a stored file for streaming, passing one byte range on (S3 and WebDAV answer it
    themselves). Nothing is held in memory but one piece at a time."""
    await _approved(t)
    rng = {"Range": range_header} if range_header and _RANGE.match(range_header.strip()) else {}
    if t.kind == "s3":
        endpoint, bucket, region, ak, sk = _s3(t)
        url = _s3_url(endpoint, bucket, key)
        headers = sigv4_headers("GET", url, region=region, access_key=ak, secret_key=sk)
        return await _http_stream(url, {**headers, **rng}, None, t.name)
    if t.kind == "webdav":
        base, auth = _dav(t)
        return await _http_stream(_dav_url(base, key), rng, auth, t.name)
    if t.kind == "local":
        p = _local_path(t, key)
        try:
            st = await asyncio.to_thread(p.stat)
        except FileNotFoundError as e:
            raise StorageError("The file is no longer on this server's disk.") from e
        try:
            part = parse_range(range_header, st.st_size)
        except ValueError as e:
            raise RangeNotSatisfiable("That part of the file does not exist.") from e
        first, last = part or (0, st.st_size - 1)
        return Opened(
            status=206 if part else 200,
            length=max(0, last - first + 1),
            content_range=f"bytes {first}-{last}/{st.st_size}" if part else None,
            etag=f"{st.st_size}-{int(st.st_mtime)}",
            body=_file_pieces(p, first, last),
        )
    raise StorageError(f"Unknown storage kind {t.kind}.")


async def _file_pieces(p: Path, first: int, last: int) -> AsyncIterator[bytes]:
    fh = await asyncio.to_thread(p.open, "rb")
    try:
        await asyncio.to_thread(fh.seek, first)
        left = last - first + 1
        while left > 0:
            chunk = await asyncio.to_thread(fh.read, min(CHUNK, left))
            if not chunk:
                break
            left -= len(chunk)
            yield chunk
    finally:
        fh.close()


LINK_SECONDS = 60


async def presigned_get(
    t: StorageTarget,
    key: str,
    *,
    filename: str,
    content_type: str,
    inline: bool,
    expires: int = LINK_SECONDS,
) -> str | None:
    """A short-lived link straight to the bucket (S3 only; None elsewhere), with the name,
    type and inline/attachment fixed in the signed link. Only for after the access checks."""
    if t.kind != "s3":
        return None
    await _approved(t)
    endpoint, bucket, region, ak, sk = _s3(t)
    disposition = f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(filename)}"
    return presign_url(
        "GET",
        _s3_url(endpoint, bucket, key),
        region=region,
        access_key=ak,
        secret_key=sk,
        expires=expires,
        query={
            "response-content-disposition": disposition,
            "response-content-type": content_type,
            "response-cache-control": "private, no-store",
        },
    )


async def check(t: StorageTarget) -> None:
    """Write, read back and delete a small file: proves the target works. Raises StorageError."""
    key = f".agentic-check-{os.urandom(4).hex()}.txt"
    probe = b"agentic storage check"
    try:
        await put(t, key, probe)
        if await get(t, key) != probe:
            raise StorageError("The file read back was not the file written.")
    except httpx.HTTPError as e:
        raise StorageError(f"{t.name} could not be reached ({e.__class__.__name__}).") from e
    finally:
        try:
            await delete(t, key)
        except (StorageError, httpx.HTTPError):
            pass


# ---------------------------------------------------------------- files


async def primary(db: AsyncSession, workspace_id: str) -> StorageTarget | None:
    return await db.scalar(
        select(StorageTarget).where(
            StorageTarget.workspace_id == workspace_id, StorageTarget.is_primary.is_(True)
        )
    )


def file_key(f: DocFile, sha256: str = "") -> str:
    """Where we keep a file: agentic/<workspace>/files/<file id>[-<content hash>]<ext>. P149a:
    the background jobs write each version under its own hash, so the pointer only ever
    changes to bytes that are fully stored (the old object is deleted after the switch)."""
    ext = re.sub(r"[^a-z0-9.]", "", Path(f.name or "").suffix.lower())[:10]
    tag = f"-{sha256[:12]}" if sha256 else ""
    return f"agentic/{f.workspace_id}/files/{f.id}{tag}{ext}"


async def store_new(db: AsyncSession, f: DocFile, data: bytes) -> None:
    """Put a new file's bytes in the workspace's primary storage (Postgres when none is set,
    or when that storage fails: an upload is never lost because a bucket is down)."""
    t = await primary(db, f.workspace_id)
    if t is None:
        f.data, f.storage_id, f.storage_key = data, None, None
        return
    key = file_key(f)
    try:
        await put(t, key, data)
    except (StorageError, httpx.HTTPError) as e:
        log.warning("primary storage %s failed, keeping %s in the database: %s", t.id, f.id, e)
        f.data, f.storage_id, f.storage_key = data, None, None
        return
    f.data, f.storage_id, f.storage_key = None, t.id, key


async def replace(db: AsyncSession, f: DocFile, data: bytes) -> None:
    """New bytes for an existing file, where it lives (a re-export, new minutes). P143c: what
    compression recorded is about the old bytes, so it goes (compress.py sets it after).
    P148b: the upload runs before the file's row is changed (and so locked by the flush the
    storage look-up would make): people moving or filing the file never wait for a bucket."""
    filecache.drop(f.id)
    if f.storage_id:
        with db.no_autoflush:
            t = await db.get(StorageTarget, f.storage_id)
        if t is not None and f.storage_key:
            try:
                await put(t, f.storage_key, data)
                f.compression = None
                return
            except (StorageError, httpx.HTTPError) as e:
                log.warning("storage %s failed, moving %s into the database: %s", t.id, f.id, e)
    f.compression = None
    f.data, f.storage_id, f.storage_key = data, None, None


async def pointer(db: AsyncSession, file_id: str) -> tuple[str | None, str | None]:
    """Where the file's bytes are now, as stored (not as loaded earlier)."""
    row = (
        await db.execute(
            select(DocFile.storage_id, DocFile.storage_key).where(DocFile.id == file_id)
        )
    ).first()
    return (row[0], row[1]) if row else (None, None)


async def db_bytes(db: AsyncSession, file_id: str) -> bytes | None:
    data = await db.scalar(select(DocFile.data).where(DocFile.id == file_id))
    return None if data is None else bytes(data)


async def _read_from(db: AsyncSession, f: DocFile, sid: str, key: str | None) -> bytes:
    t = await db.get(StorageTarget, sid)
    if t is None or not key:
        raise StorageError("The storage this file was kept in has been removed.")
    remote = t.kind != "local"
    sha, size = f.sha256 or "", int(f.size or 0)
    if remote and (hit := await asyncio.to_thread(filecache.get, f.id, sha, size)) is not None:
        return hit
    try:
        data = await get(t, key)
    except httpx.HTTPError as e:
        raise StorageError(f"{t.name} could not be reached ({e.__class__.__name__}).") from e
    if remote and sha:

        def keep() -> None:
            if hashlib.sha256(data).hexdigest() == sha:  # only bytes the row describes
                filecache.put(f.id, sha, data)

        await asyncio.to_thread(keep)
    return data


async def read(db: AsyncSession, f: DocFile) -> bytes:
    """A file's bytes from wherever it lives. Raises StorageError when it cannot be read.
    P149a: wherever they are *now*: a move to the file server may have finished after the
    file was loaded (then the database copy is gone), or not finished (then the stored copy
    may not be there yet); both are looked up again before giving up. Hot files come from the
    disk cache."""
    if not f.storage_id:
        data = await db_bytes(db, f.id)
        if data is not None:
            return data
        sid, key = await pointer(db, f.id)
        return await _read_from(db, f, sid, key) if sid else b""
    try:
        return await _read_from(db, f, f.storage_id, f.storage_key)
    except StorageError:
        data = await db_bytes(db, f.id)
        if data is not None:
            return data
        sid, key = await pointer(db, f.id)
        if sid and (sid, key) != (f.storage_id, f.storage_key):
            return await _read_from(db, f, sid, key)
        raise


def _first_bytes(p: Path, n: int) -> bytes:
    with p.open("rb") as fh:
        return fh.read(n)


async def read_head(db: AsyncSession, f: DocFile, n: int = 4096) -> bytes:
    """The first `n` bytes of a file (to tell its type) without fetching all of it."""
    if not f.storage_id:
        data = await db.scalar(select(func.substring(DocFile.data, 1, n)).where(DocFile.id == f.id))
        if data is not None:
            return bytes(data)
    try:
        sid, key = await pointer(db, f.id)
        t = await db.get(StorageTarget, sid) if sid else None
        if t is None or not key:
            return (await read(db, f))[:n]
        hit = await asyncio.to_thread(filecache.path_for, f.id, f.sha256 or "", int(f.size or 0))
        if hit is not None:
            return await asyncio.to_thread(_first_bytes, hit, n)
        opened = await open_stream(t, key, f"bytes=0-{n - 1}")
        out = b""
        async for chunk in opened.body:
            out += chunk
            if len(out) >= n:
                break
        await opened.body.aclose()  # type: ignore[attr-defined]
        return out[:n]
    except RangeNotSatisfiable:
        return b""
    except (StorageError, httpx.HTTPError):
        return (await read(db, f))[:n]


async def read_id(db: AsyncSession, file_id: str | None) -> bytes:
    """read() by id; empty bytes for no file or a file that cannot be read."""
    if not file_id:
        return b""
    f = await db.get(DocFile, file_id)
    if f is None:
        return b""
    try:
        return await read(db, f)
    except StorageError as e:
        log.warning("could not read file %s: %s", file_id, e)
        return b""


async def forget(db: AsyncSession, f: DocFile) -> None:
    """Delete a file's bytes where they live (before its row is deleted). Files imported
    from a source stay there: they are the company's own copy."""
    filecache.drop(f.id)
    # Only what we wrote ourselves (agentic/...): a company's own files never are.
    if not f.storage_id or not f.storage_key or not f.storage_key.startswith("agentic/"):
        return
    t = await db.get(StorageTarget, f.storage_id)
    if t is None:
        return
    try:
        await delete(t, f.storage_key)
    except (StorageError, httpx.HTTPError) as e:
        log.warning("could not delete %s from %s: %s", f.storage_key, t.id, e)
