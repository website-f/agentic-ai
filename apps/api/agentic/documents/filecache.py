"""P149a: a small on-disk cache of files whose bytes live in an S3 bucket or file server.

Opening the same Library file again (a preview, then the download, then an agent reading it)
should not fetch it from the bucket each time. The cache is a folder in the files volume
(<files_dir>/.cache, shared by the API and the worker), capped at settings.file_cache_mb: when
it grows past the cap the files used least recently go first (a read touches the file's
modification time). An entry is named after the file and its content hash, so new bytes for a
file (a re-export, compression) never serve the old ones; `drop` removes a file's entries when
it is replaced or deleted. Everything here is best effort: a cache that cannot be written or read
only means the bytes come from the bucket again.
"""

import contextlib
import hashlib
import logging
import os
import re
import secrets
import time
from pathlib import Path

from ..core.config import settings

log = logging.getLogger("agentic.filecache")

DIR_NAME = ".cache"
MIN_EVICT_GAP = 30.0  # seconds between two size checks of the whole folder
_SAFE = re.compile(r"[^A-Za-z0-9_-]")
_last_evict = 0.0


def root() -> Path:
    return Path(settings.files_dir) / DIR_NAME


def cap_bytes() -> int:
    return max(0, int(settings.file_cache_mb)) * 1024 * 1024


def enabled() -> bool:
    return cap_bytes() > 0


def _name(file_id: str, sha256: str) -> str:
    return f"{_SAFE.sub('', file_id)}-{_SAFE.sub('', sha256 or '')[:32]}"


def path_for(file_id: str, sha256: str, size: int) -> Path | None:
    """The cached copy of this file's current bytes, or None. Only a copy of the right size is
    used (a half-written one never is); a hit counts as a recent use."""
    if not enabled() or not sha256:
        return None
    p = root() / _name(file_id, sha256)
    try:
        st = p.stat()
    except OSError:
        return None
    if size and st.st_size != size:
        with contextlib.suppress(OSError):
            p.unlink()
        return None
    with contextlib.suppress(OSError):
        os.utime(p, None)
    return p


def get(file_id: str, sha256: str, size: int) -> bytes | None:
    p = path_for(file_id, sha256, size)
    if p is None:
        return None
    try:
        return p.read_bytes()
    except OSError:
        return None


class Writer:
    """Writes one file into the cache as it streams past; kept only when complete and its
    content hash is the one the file's row records."""

    def __init__(self, file_id: str, sha256: str, size: int) -> None:
        self.final = root() / _name(file_id, sha256)
        self.size = size
        self.sha = sha256
        self.h = hashlib.sha256()
        self.tmp = self.final.with_name(f"{self.final.name}.{secrets.token_hex(4)}.part")
        self.n = 0
        self.fh = None
        try:
            self.tmp.parent.mkdir(parents=True, exist_ok=True)
            self.fh = self.tmp.open("wb")
        except OSError:
            self.fh = None

    def write(self, chunk: bytes) -> None:
        if self.fh is None:
            return
        try:
            self.fh.write(chunk)
            self.h.update(chunk)
            self.n += len(chunk)
            if self.size and self.n > self.size:
                self.abort()
        except OSError:
            self.abort()

    def close(self) -> None:
        if self.fh is None:
            return
        try:
            self.fh.close()
            self.fh = None
            if (self.size and self.n != self.size) or self.h.hexdigest() != self.sha:
                raise OSError("incomplete")
            os.replace(self.tmp, self.final)
        except OSError:
            self.abort()
            return
        evict()

    def abort(self) -> None:
        if self.fh is not None:
            with contextlib.suppress(OSError):
                self.fh.close()
            self.fh = None
        with contextlib.suppress(OSError):
            self.tmp.unlink()


def put(file_id: str, sha256: str, data: bytes) -> None:
    if not enabled() or not sha256 or len(data) > cap_bytes() // 4:
        return
    w = Writer(file_id, sha256, len(data))
    w.write(data)
    w.close()


def drop(file_id: str) -> None:
    """Forget every cached copy of a file (new bytes, deleted)."""
    d = root()
    prefix = f"{_SAFE.sub('', file_id)}-"
    try:
        names = [e.name for e in os.scandir(d) if e.name.startswith(prefix)]
    except OSError:
        return
    for n in names:
        with contextlib.suppress(OSError):
            (d / n).unlink()


def usage() -> tuple[int, int]:
    """(files, bytes) in the cache now."""
    n = total = 0
    try:
        for e in os.scandir(root()):
            if e.is_file():
                n += 1
                total += e.stat().st_size
    except OSError:
        pass
    return n, total


def evict(force: bool = False) -> int:
    """Drop the least recently used copies until the cache is under 90% of its cap. Returns
    the bytes freed. Leftover partial writes older than an hour go too."""
    global _last_evict
    now = time.time()
    if not force and now - _last_evict < MIN_EVICT_GAP:
        return 0
    _last_evict = now
    cap = cap_bytes()
    entries: list[tuple[float, int, Path]] = []
    freed = 0
    try:
        for e in os.scandir(root()):
            if not e.is_file():
                continue
            st = e.stat()
            if e.name.endswith(".part"):
                if now - st.st_mtime > 3600:
                    with contextlib.suppress(OSError):
                        os.unlink(e.path)
                continue
            entries.append((st.st_mtime, st.st_size, Path(e.path)))
    except OSError:
        return 0
    total = sum(s for _, s, _ in entries)
    if total <= cap:
        return 0
    goal = int(cap * 0.9)
    for _, size, p in sorted(entries):
        if total <= goal:
            break
        try:
            p.unlink()
        except OSError:
            continue
        total -= size
        freed += size
    log.info("file cache: freed %d bytes", freed)
    return freed
