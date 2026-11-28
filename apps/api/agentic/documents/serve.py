"""P149a: a stored file sent to a browser without loading it whole into the API process.

Called after the route's own access checks. Wherever the bytes are:

- in the disk cache (filecache.py)        sent from disk (Range answered by Starlette)
- in an S3 bucket / WebDAV file server     streamed through in pieces, the browser's Range
                                           passed on; a whole-file read also fills the cache
- on this server's disk                    streamed from disk with Range
- still in Postgres (not moved yet)        sent from memory, Range answered here

The database session is used only before the response starts: the stream itself never touches
it (it may be closed by then).
"""

import logging
from collections.abc import AsyncIterator, Mapping

from fastapi import Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DocFile, StorageTarget
from . import filecache, storage

log = logging.getLogger("agentic.serve")


def _bytes_response(
    data: bytes, range_header: str | None, media_type: str, headers: dict[str, str]
) -> Response:
    size = len(data)
    try:
        part = storage.parse_range(range_header, size) if size else None
    except ValueError:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    if part is None:
        return Response(content=data, media_type=media_type, headers=headers)
    first, last = part
    return Response(
        content=data[first : last + 1],
        status_code=206,
        media_type=media_type,
        headers={**headers, "Content-Range": f"bytes {first}-{last}/{size}"},
    )


async def file_response(
    db: AsyncSession,
    f: DocFile,
    request: Request,
    *,
    media_type: str,
    headers: Mapping[str, str],
) -> Response:
    """The file for a browser: streamed, with byte ranges (video seeking, resumed downloads).
    Raises storage.StorageError when its bytes cannot be reached anywhere."""
    hdrs = {**headers, "Accept-Ranges": "bytes"}
    rng = request.headers.get("range")
    file_id, sha, size = f.id, f.sha256 or "", int(f.size or 0)
    sid, key = await storage.pointer(db, file_id)  # where they are now, not when loaded
    if not sid:
        data = await storage.db_bytes(db, file_id)
        if data is not None:
            return _bytes_response(data, rng, media_type, hdrs)
        sid, key = await storage.pointer(db, file_id)  # moved this very moment
        if not sid:
            return _bytes_response(b"", None, media_type, hdrs)
    t = await db.get(StorageTarget, sid)
    if t is None or not key:
        raise storage.StorageError("The storage this file was kept in has been removed.")
    remote = t.kind != "local"
    if remote and (hit := filecache.path_for(file_id, sha, size)) is not None:
        return FileResponse(hit, media_type=media_type, headers=hdrs)
    try:
        opened = await storage.open_stream(t, key, rng)
    except storage.RangeNotSatisfiable:
        return Response(status_code=416, headers={**hdrs, "Content-Range": f"bytes */{size}"})
    except storage.StorageError as e:
        # The stored copy is not there (a move that did not finish): read() finds the bytes
        # wherever they still are, or raises.
        log.info("streaming %s failed (%s); reading it instead", file_id, e)
        return _bytes_response(await storage.read(db, f), rng, media_type, hdrs)
    if opened.length is not None:
        hdrs["Content-Length"] = str(opened.length)
    if opened.content_range:
        hdrs["Content-Range"] = opened.content_range
    cache = (
        filecache.Writer(file_id, sha, size)
        if remote
        and opened.status == 200
        and sha
        and filecache.enabled()
        and size <= filecache.cap_bytes() // 4
        else None
    )

    async def body() -> AsyncIterator[bytes]:
        done = False
        try:
            async for chunk in opened.body:
                if cache is not None:
                    cache.write(chunk)
                yield chunk
            done = True
        finally:
            if cache is not None:
                cache.close() if done else cache.abort()
            if not done:
                await opened.body.aclose()  # type: ignore[attr-defined]

    return StreamingResponse(body(), status_code=opened.status, media_type=media_type, headers=hdrs)
