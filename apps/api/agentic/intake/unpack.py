"""Read a ZIP of company documents safely (P24).

- paths: "\\" and "/" both separate folders; absolute paths, drive letters, "." and ".."
  parts are refused (zip-slip), control characters dropped; names stay as people wrote them
  (old Windows zips store them in cp437, which is decoded back to UTF-8 when it fits)
- junk: __MACOSX, .DS_Store, Thumbs.db, desktop.ini, folders and empty files
- nested zips: unpacked one level deep, into a folder named after them
- limits: MAX_ENTRIES files, MAX_FILE_BYTES each (Document Studio's own limit), MAX_TOTAL
  uncompressed, and a compression-ratio guard against zip bombs; sizes are checked again
  while reading, because a zip's own size fields can lie
- password-protected entries are skipped with a reason

Everything left out is reported as {"path", "reason"}; reasons are plain sentences.
"""

import io
import re
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field

from ..documents.service import MAX_FILE_BYTES

MAX_ENTRIES = 500
MAX_TOTAL = 300 * 1024 * 1024
MAX_ZIP_BYTES = 200 * 1024 * 1024  # the upload itself
MAX_RATIO = 200  # uncompressed / compressed, for entries over RATIO_FLOOR
RATIO_FLOOR = 1024 * 1024
MAX_FOLDER = 300
MAX_PATH = 500

JUNK_NAMES = frozenset({".ds_store", "thumbs.db", "desktop.ini", ".localized", "icon\r"})
JUNK_DIRS = frozenset({"__macosx", ".git", ".svn"})
OFFICE_EXT = (".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".epub", ".jar", ".apk")

REASON_UNSAFE = "Unsafe path (points outside the folder)."
REASON_JUNK = "System file, not a document."
REASON_EMPTY = "Empty file."
REASON_ENCRYPTED = "Password-protected. Unzip it yourself and upload the files."
REASON_TOO_BIG = "Larger than {mb} MB."
REASON_BOMB = "Compressed suspiciously well (possible zip bomb)."
REASON_TOO_MANY = "Over the {n}-file limit for one upload."
REASON_TOTAL = "Over the {mb} MB limit for one upload."
REASON_DEEP = "A zip inside a zip inside a zip. Unzip it and upload the inner files."
REASON_BROKEN = "Could not be read from the zip ({error})."


class UnpackError(ValueError):
    """The upload is not a readable zip at all."""


@dataclass
class Entry:
    folder: str  # "OPERASI/SOP" ("" = top)
    name: str
    path: str  # where it was inside the upload, folders included
    data: bytes


@dataclass
class Report:
    skipped: list[dict[str, str]] = field(default_factory=list)
    files: int = 0
    total: int = 0

    def skip(self, path: str, reason: str) -> None:
        self.skipped.append({"path": path[:MAX_PATH], "reason": reason, "code": code_of(reason)})


_CODES = (
    (REASON_UNSAFE, "unsafe_path"),
    (REASON_JUNK, "system_file"),
    (REASON_EMPTY, "empty"),
    (REASON_ENCRYPTED, "encrypted"),
    (REASON_TOO_BIG, "too_large"),
    (REASON_BOMB, "zip_bomb"),
    (REASON_TOO_MANY, "too_many_files"),
    (REASON_TOTAL, "upload_too_large"),
    (REASON_DEEP, "zip_too_deep"),
    (REASON_BROKEN, "unreadable"),
)
_CODE_RX = [(re.compile(re.sub(r"\\\{\w+\\\}", ".+?", re.escape(t)) + "$"), c) for t, c in _CODES]


def code_of(reason: str) -> str:
    """A stable code for a skip reason (the app can say it in the person's language)."""
    return next((c for rx, c in _CODE_RX if rx.match(reason)), "other")


def is_zip(data: bytes, name: str) -> bool:
    """A zip archive to unpack (not a Word, Excel or PowerPoint file, which are zips too)."""
    if data[:4] not in (b"PK\x03\x04", b"PK\x05\x06"):
        return False
    low = name.lower()
    if low.endswith(".zip"):
        return True
    if low.endswith(OFFICE_EXT):
        return False
    return b"[Content_Types].xml" not in data[:4096] and b"META-INF/" not in data[:4096]


def stem(name: str) -> str:
    base = clean_part(name.replace("\\", "/").rsplit("/", 1)[-1])
    return re.sub(r"\.zip$", "", base, flags=re.I).strip() or "Upload"


def clean_part(part: str) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", "", part).strip().rstrip(".").strip()


def split_path(raw: str) -> list[str] | None:
    """Folder parts of a path inside a zip, or None when it is unsafe (zip-slip)."""
    raw = raw.replace("\\", "/")
    if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        return None
    parts = []
    for p in raw.split("/"):
        if p in ("", "."):
            continue
        if p == "..":
            return None
        c = clean_part(p)
        if c:
            parts.append(c)
    return parts


def join_folder(*parts: str) -> str:
    """A normalised folder path: "A/B/C", no empty or dot parts, at most MAX_FOLDER chars."""
    out: list[str] = []
    for chunk in parts:
        for p in (chunk or "").replace("\\", "/").split("/"):
            c = clean_part(p)
            if c and c not in (".", ".."):
                out.append(c[:120])
    folder = "/".join(out)
    while len(folder) > MAX_FOLDER and "/" in folder:
        folder = folder.rsplit("/", 1)[0]
    return folder[:MAX_FOLDER]


def _name_of(info: zipfile.ZipInfo) -> str:
    """The entry's name as its maker typed it (cp437 zips re-read as UTF-8 when they fit)."""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def _junk(parts: list[str]) -> bool:
    low = [p.lower() for p in parts]
    return (
        any(p in JUNK_DIRS for p in low[:-1])
        or low[-1] in JUNK_NAMES
        or low[-1].startswith("._")
        or low[-1].startswith("~$")  # Office lock files
    )


def _note_junk(report: Report, parts: list[str], where: str) -> None:
    """One line per junk file, or one per junk folder (__MACOSX holds a copy of everything)."""
    lead = f"{where}/" if where else ""
    for i, p in enumerate(parts[:-1]):
        if p.lower() in JUNK_DIRS:
            key = lead + "/".join(parts[: i + 1]) + "/"
            if not any(s["path"] == key for s in report.skipped):
                report.skip(key, REASON_JUNK)
            return
    report.skip(lead + "/".join(parts), REASON_JUNK)


def _open(data: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError) as e:
        raise UnpackError(str(e)) from e


def _read(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    with zf.open(info) as fh:
        data = fh.read(limit + 1)
    return data


def entries(data: bytes, zip_name: str, base: str = "") -> Iterator[Entry | Report]:
    """Yield each document in the zip, then the Report (always last).

    Folders: the zip's own name is the top folder unless everything already sits in one
    top folder. `base` is a folder to put it all under. Lazy, so a caller can store one
    file at a time instead of holding the whole upload in memory twice."""
    report = Report()
    zf = _open(data)
    with zf:
        infos = zf.infolist()
        files = [i for i in infos if not i.is_dir()]
        safe = {}
        for i in files:
            parts = split_path(_name_of(i))
            safe[i.filename] = parts
        tops = {p[0] for p in safe.values() if p and len(p) > 1 and not _junk(p)}
        loose = [p for p in safe.values() if p and len(p) == 1 and not _junk(p)]
        prefix = "" if len(tops) == 1 and not loose else stem(zip_name)
        for info in files:
            parts = safe[info.filename]
            shown = _name_of(info)
            if parts is None:
                report.skip(shown, REASON_UNSAFE)
                continue
            if not parts:
                continue
            if _junk(parts):
                _note_junk(report, parts, "")
                continue
            path = "/".join([prefix, *parts] if prefix else parts)
            folder = join_folder(base, prefix, *parts[:-1])
            yield from _one(zf, info, parts[-1], folder, path, report, nested_ok=True)
    yield report


def _one(
    zf: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    name: str,
    folder: str,
    path: str,
    report: Report,
    nested_ok: bool,
) -> Iterator[Entry]:
    if info.flag_bits & 0x1:
        report.skip(path, REASON_ENCRYPTED)
        return
    if info.file_size == 0:
        report.skip(path, REASON_EMPTY)
        return
    nested = name.lower().endswith(".zip")
    limit = MAX_ZIP_BYTES if nested else MAX_FILE_BYTES
    if info.file_size > limit:
        report.skip(path, REASON_TOO_BIG.format(mb=limit // (1024 * 1024)))
        return
    if info.file_size > RATIO_FLOOR and info.file_size > MAX_RATIO * max(info.compress_size, 1):
        report.skip(path, REASON_BOMB)
        return
    if not nested and report.files >= MAX_ENTRIES:
        report.skip(path, REASON_TOO_MANY.format(n=MAX_ENTRIES))
        return
    if report.total + info.file_size > MAX_TOTAL:
        report.skip(path, REASON_TOTAL.format(mb=MAX_TOTAL // (1024 * 1024)))
        return
    try:
        data = _read(zf, info, limit)
    except Exception as e:  # noqa: BLE001 - BadZipFile, zlib.error, CRC errors: report, go on
        report.skip(path, REASON_BROKEN.format(error=e.__class__.__name__))
        return
    if len(data) > limit:  # the header lied about the size
        report.skip(path, REASON_TOO_BIG.format(mb=limit // (1024 * 1024)))
        return
    if not data:
        report.skip(path, REASON_EMPTY)
        return
    if nested:
        if not nested_ok:
            report.skip(path, REASON_DEEP)
            return
        yield from _nested(data, name, folder, path, report)
        return
    report.files += 1
    report.total += len(data)
    yield Entry(folder=folder, name=name[:200], path=path[:MAX_PATH], data=data)


def _nested(data: bytes, name: str, folder: str, path: str, report: Report) -> Iterator[Entry]:
    try:
        zf = _open(data)
    except UnpackError:
        report.skip(path, REASON_BROKEN.format(error="BadZipFile"))
        return
    inner_base = join_folder(folder, stem(name))
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            shown = _name_of(info)
            parts = split_path(shown)
            if parts is None:
                report.skip(f"{path}/{shown}", REASON_UNSAFE)
                continue
            if not parts:
                continue
            if _junk(parts):
                _note_junk(report, parts, path)
                continue
            inner_path = f"{path}/{'/'.join(parts)}"
            inner_folder = join_folder(inner_base, *parts[:-1])
            yield from _one(zf, info, parts[-1], inner_folder, inner_path, report, nested_ok=False)
