"""P143c: uploaded files are made smaller in the background, in the same format.

The owner (27 Nov 2026): "In the Library, or any files uploaded in this system, auto-compress
the file size with the maximum compression ... but the quality and format of the file remain;
only the file size changes."

Every upload is read once by the worker (service.process_file); right after that read this
module tries to make the stored bytes smaller and keeps the result only when it is smaller and
still opens the same way with the same library:

- JPEG    re-encoded optimised + progressive: the same quantisation when the photo is already at
          quality 85 or lower, else quality 85 (never below 75); the EXIF orientation applied;
          metadata dropped except the colour profile and DPI; longest side at most 4000 px
- PNG     optimise + zlib level 9 (palette, transparency, colour profile and DPI kept)
- WEBP    lossy at quality 85 / lossless stays lossless, method 6; animated ones are left
- TIFF    lossless Deflate (Group 4 for black and white), every page kept
- PDF     content streams at zlib level 9, identical objects merged, orphans dropped, and big
          embedded JPEG photos re-encoded at quality 80 and at most 200 dpi of the page
          (never below 150 dpi); same page count, checked with pypdf and PDFium
- Office  Word / Excel / PowerPoint / OpenDocument / zip: the zip rewritten at Deflate level 9
          and the pictures inside made smaller as above; same parts in the same order
- Video   H.264 CRF 28 + AAC 96k in the same container (mp4, m4v, mov, mkv), audio AAC 96k
          (m4a) or MP3 128k (mp3): only when ffmpeg is on the server; same length and streams

Left as they are: files under 200 KB, over 300 MB, held back (quarantined) or restricted,
encrypted or signed PDFs, signed Office files, password-protected zips, what the office made
itself (exports, generated files), files read in place from a company's own storage, and every
format not listed (text, CSV, GIF...). A file that cannot be made smaller, or whose result
does not pass the check, keeps its bytes; the attempt is logged once and recorded on the file
so it is not tried again. Name, extension and MIME type never change.
"""

import asyncio
import contextlib
import hashlib
import io
import json
import logging
import re
import shutil
import subprocess  # noqa: S404 - ffmpeg with a fixed argv, no shell
import tempfile
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DocFile

log = logging.getLogger("agentic.compress")

MIN_BYTES = 200 * 1024  # smaller than this is not worth the work
MAX_BYTES = 300 * 1024 * 1024  # larger than this is not done in the worker
GAIN = 0.95  # kept only when at least 5% smaller
TIME_LIMIT = 240.0  # seconds of in-process work per file
FFMPEG_TIMEOUT = 600.0  # seconds for one video or sound file (the read has 20 minutes)
JPEG_QUALITY = 85
MIN_QUALITY = 75  # photos are never made worse than this
PDF_JPEG_QUALITY = 80
PDF_DPI = 200  # embedded photos at most this sharp at full-page size (>= 150 always)
PDF_IMAGE_MIN = 60 * 1024  # embedded photos smaller than this are left
MAX_SIDE = 4000  # pixels on the longest side of a photo
ACTOR = "system:compress"

OFFICE_EXT = {
    ".docx", ".docm", ".dotx", ".dotm",
    ".xlsx", ".xlsm", ".xltx", ".xltm",
    ".pptx", ".pptm", ".potx", ".potm", ".ppsx",
    ".odt", ".ods", ".odp", ".odg", ".ott", ".ots", ".otp",
    ".epub", ".zip",
}  # fmt: skip
VIDEO_EXT = {".mp4", ".m4v", ".mov", ".mkv"}
AUDIO_EXT = {".m4a": ("aac", "96k"), ".mp3": ("libmp3lame", "128k")}
_MEDIA_PART = re.compile(r"(?:^|/)(?:media|Pictures|images?)/[^/]+\.(?:jpe?g|png)$", re.I)
_SIGNED_PART = re.compile(
    r"^_xmlsignatures/|^META-INF/(?:documentsignatures|macrosignatures|signatures)", re.I
)


class Skip(Exception):  # noqa: N818 - a reason, not a failure
    """This file is left as it is (the reason says why)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class TooLong(Exception):
    """The time for one file ran out."""


@dataclass
class Result:
    data: bytes
    method: str


def _check_time(deadline: float) -> None:
    if time.monotonic() > deadline:
        raise TooLong("compression took too long")


# ---------------------------------------------------------------- pictures


_STD_LUMA = (16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40,
             57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35,
             55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112,
             100, 103, 99)  # fmt: skip


def jpeg_quality(im: Any) -> int:
    """The libjpeg quality a JPEG was saved at, estimated from its luminance table (100 when
    unknown, so it is treated as a big file worth re-encoding)."""
    q = getattr(im, "quantization", None) or {}
    table = q.get(0)
    if not table or len(table) != 64:
        return 100
    scale = sum(table) * 100.0 / sum(_STD_LUMA)
    est = (200 - scale) / 2 if scale <= 100 else 5000 / scale
    return max(1, min(100, round(est)))


def _fit(im: Any, side: int) -> Any:
    from PIL import Image

    w, h = im.size
    if max(w, h) <= side:
        return im
    r = side / max(w, h)
    return im.resize((max(1, round(w * r)), max(1, round(h * r))), Image.Resampling.LANCZOS)


def image_bytes(data: bytes, *, max_side: int = MAX_SIDE) -> tuple[bytes, str] | None:
    """A smaller JPEG / PNG / WEBP / TIFF in the same format, or None (left as it is)."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as im:
        fmt = im.format
        frames = getattr(im, "n_frames", 1)
        if fmt == "JPEG":
            return _jpeg(im, max_side), "jpeg"
        if fmt in ("GIF", "MPO") or (fmt in ("PNG", "WEBP") and frames > 1):
            return None  # animations: left as they are
        if fmt == "PNG":
            out = io.BytesIO()
            img = _fit(im, max_side)
            kw = _keep(im, ("icc_profile", "dpi", "transparency", "gamma"))
            img.save(out, "PNG", optimize=True, compress_level=9, **kw)
            return out.getvalue(), "png"
        if fmt == "WEBP":
            lossless = b"VP8L" in data[12:4096] and b"VP8 " not in data[12:4096]
            img = ImageOps.exif_transpose(im) or im
            img = _fit(img, max_side)
            out = io.BytesIO()
            kw = _keep(im, ("icc_profile",))
            if lossless:
                img.save(out, "WEBP", lossless=True, quality=100, method=6, **kw)
            else:
                img.save(out, "WEBP", quality=JPEG_QUALITY, method=6, **kw)
            return out.getvalue(), "webp"
        if fmt == "TIFF":
            out = io.BytesIO()
            comp = "group4" if im.mode == "1" else "tiff_adobe_deflate"
            kw = _keep(im, ("icc_profile", "dpi"))
            im.save(out, "TIFF", compression=comp, save_all=frames > 1, **kw)
            return out.getvalue(), "tiff"
    return None


def _keep(im: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    return {k: im.info[k] for k in keys if im.info.get(k) is not None}


def _jpeg(im: Any, max_side: int) -> bytes:
    from PIL import ImageOps

    if im.mode not in ("RGB", "L"):
        raise Skip("jpeg colours")  # CMYK and the rest: colours could shift
    est = jpeg_quality(im)
    kw = _keep(im, ("icc_profile", "dpi"))
    turned = im.getexif().get(0x0112, 1) not in (None, 1)
    big = max(im.size) > max_side
    out = io.BytesIO()
    if est <= JPEG_QUALITY and not turned and not big:
        # Already light: the same tables and subsampling, only better packed (no new loss).
        im.save(out, "JPEG", quality="keep", subsampling="keep", optimize=True,
                progressive=True, **kw)  # fmt: skip
        return out.getvalue()
    img = ImageOps.exif_transpose(im) or im
    img = _fit(img, max_side)
    q = max(MIN_QUALITY, min(JPEG_QUALITY, est))
    img.save(out, "JPEG", quality=q, optimize=True, progressive=True, **kw)
    return out.getvalue()


def _check_image(new: bytes, old: bytes) -> None:
    from PIL import Image

    with Image.open(io.BytesIO(old)) as a, Image.open(io.BytesIO(new)) as b:
        if a.format != b.format:
            raise ValueError("format changed")
        if getattr(a, "n_frames", 1) != getattr(b, "n_frames", 1):
            raise ValueError("pages changed")
        ra, rb = a.size[0] / max(1, a.size[1]), b.size[0] / max(1, b.size[1])
        # The EXIF turn may swap width and height; the shape is otherwise the same.
        if abs(ra - rb) > 0.02 and abs(1 / max(ra, 1e-9) - rb) > 0.02:
            raise ValueError("shape changed")
        b.load()


# ---------------------------------------------------------------- PDF


def _signed_pdf(reader: Any) -> bool:
    root = reader.trailer.get("/Root")
    root = root.get_object() if root is not None else {}
    if "/Perms" in root:
        return True
    form = root.get("/AcroForm")
    if form is None:
        return False
    form = form.get_object()
    if int(form.get("/SigFlags", 0) or 0):
        return True
    for fld in form.get("/Fields", []) or []:
        with contextlib.suppress(Exception):
            if fld.get_object().get("/FT") == "/Sig":
                return True
    return False


def _pdf(data: bytes, deadline: float) -> bytes:
    from PIL import Image
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise Skip("encrypted pdf")
    if _signed_pdf(reader):
        raise Skip("signed pdf")
    pages = len(reader.pages)
    writer = PdfWriter(clone_from=reader)
    done: set[int] = set()
    for page in writer.pages:
        _check_time(deadline)
        with contextlib.suppress(Exception):
            page.compress_content_streams(level=9)
        box = page.mediabox
        longest = max(float(box.width), float(box.height)) / 72.0 or 11.7
        cap = max(int(longest * PDF_DPI), 600)
        try:
            images = list(page.images)
        except Exception as e:  # noqa: BLE001 - an odd image list: the page keeps its pictures
            log.debug("compress: images of a page not listed: %s", e)
            continue
        for img in images:
            _check_time(deadline)
            ref = img.indirect_reference
            if ref is None or ref.idnum in done:
                continue
            done.add(ref.idnum)
            obj = ref.get_object()
            flt = obj.get("/Filter")
            flt = list(flt) if isinstance(flt, list) else [flt]
            if flt != ["/DCTDecode"]:
                continue  # only photos; drawings and scans in other codecs stay lossless
            if any(k in obj for k in ("/SMask", "/Mask", "/Decode", "/OC", "/ImageMask")):
                continue
            if obj.get("/ColorSpace") not in ("/DeviceRGB", "/DeviceGray"):
                continue
            if int(obj.get("/BitsPerComponent", 8) or 8) != 8:
                continue
            raw_len = len(obj._data or b"")  # noqa: SLF001 - the encoded stream's length
            if raw_len < PDF_IMAGE_MIN:
                continue
            pil = img.image
            if pil is None or pil.mode not in ("RGB", "L"):
                continue
            if max(pil.size) > cap:
                pil = pil.resize(
                    (
                        max(1, round(pil.size[0] * cap / max(pil.size))),
                        max(1, round(pil.size[1] * cap / max(pil.size))),
                    ),
                    Image.Resampling.LANCZOS,
                )
            probe = io.BytesIO()
            pil.save(probe, "JPEG", quality=PDF_JPEG_QUALITY, optimize=True)
            if probe.tell() >= raw_len * 0.9:
                continue
            img.replace(pil, quality=PDF_JPEG_QUALITY)
    _check_time(deadline)
    writer.compress_identical_objects()  # duplicates merged, unreferenced objects dropped
    out = io.BytesIO()
    writer.write(out)
    new = out.getvalue()
    _check_pdf(new, pages)
    return new


def _check_pdf(new: bytes, pages: int) -> None:
    import pypdfium2 as pdfium
    from pypdf import PdfReader

    if len(PdfReader(io.BytesIO(new)).pages) != pages:
        raise ValueError("page count changed")
    doc = pdfium.PdfDocument(new)
    try:
        if len(doc) != pages:
            raise ValueError("page count changed (PDFium)")
        doc[0].get_textpage()  # the first page still parses
    finally:
        doc.close()


# ---------------------------------------------------------------- Word, Excel, PowerPoint, zip


def _office(data: bytes, ext: str, deadline: float) -> bytes:
    zin = zipfile.ZipFile(io.BytesIO(data))
    infos = zin.infolist()
    if any(i.flag_bits & 0x1 for i in infos):
        raise Skip("password zip")
    if any(_SIGNED_PART.search(i.filename) for i in infos):
        raise Skip("signed document")
    if zin.testzip() is not None:
        raise ValueError("broken zip")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for i in infos:
            _check_time(deadline)
            raw = zin.read(i)
            if _MEDIA_PART.search(i.filename) and len(raw) >= 20 * 1024:
                try:
                    got = image_bytes(raw)
                    if got and len(got[0]) < len(raw) * GAIN:
                        _check_image(got[0], raw)
                        raw = got[0]
                except Exception as e:  # noqa: BLE001 - that picture stays as it was
                    log.debug("compress: %s left as it was: %s", i.filename, e)
            ni = zipfile.ZipInfo(i.filename, date_time=i.date_time)
            ni.external_attr, ni.comment, ni.create_system = (
                i.external_attr,
                i.comment,
                i.create_system,
            )
            # ODF and EPUB: "mimetype" stays first and stored, as their readers require.
            stored = i.filename == "mimetype" or i.is_dir()
            ni.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            zout.writestr(ni, raw, compresslevel=None if stored else 9)
        zout.comment = zin.comment
    new = out.getvalue()
    _check_office(new, [i.filename for i in infos], ext)
    return new


def _check_office(new: bytes, names: list[str], ext: str) -> None:
    z = zipfile.ZipFile(io.BytesIO(new))
    if z.namelist() != names or z.testzip() is not None:
        raise ValueError("zip parts changed")
    if ext in (".docx", ".docm", ".dotx", ".dotm"):
        import docx

        docx.Document(io.BytesIO(new))
    elif ext in (".xlsx", ".xlsm", ".xltx", ".xltm"):
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(new), read_only=True)
        wb.close()
    elif ext in (".pptx", ".pptm", ".potx", ".potm", ".ppsx"):
        if "ppt/presentation.xml" not in names:
            raise ValueError("not a presentation")
        z.read("ppt/presentation.xml")


# ---------------------------------------------------------------- video and sound (ffmpeg)


def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _probe(path: Path) -> tuple[float, list[str]]:
    exe = shutil.which("ffprobe") or "ffprobe"
    out = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [exe, "-v", "error", "-show_entries", "format=duration:stream=codec_type,disposition",
         "-of", "json", str(path)],
        capture_output=True, timeout=60, check=True,
    ).stdout  # fmt: skip
    info = json.loads(out or b"{}")
    kinds = [
        s.get("codec_type", "")
        for s in info.get("streams", [])
        if not (s.get("disposition") or {}).get("attached_pic")
    ]
    return float((info.get("format") or {}).get("duration") or 0), sorted(
        k for k in kinds if k in ("video", "audio")
    )


def _media(data: bytes, ext: str) -> bytes:
    if not ffmpeg_available():
        raise Skip("no ffmpeg")
    exe = shutil.which("ffmpeg") or "ffmpeg"
    with tempfile.TemporaryDirectory(prefix="agentic-compress-") as tmp:
        src, dst = Path(tmp) / f"in{ext}", Path(tmp) / f"out{ext}"
        src.write_bytes(data)
        dur, kinds = _probe(src)
        if ext in VIDEO_EXT:
            if "video" not in kinds:
                raise Skip("no picture")
            args = [
                "-map", "0:V?", "-map", "0:a?", "-c:v", "libx264", "-crf", "28", "-preset",
                "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
            ]  # fmt: skip
            if ext != ".mkv":
                args += ["-movflags", "+faststart"]
        else:
            codec, rate = AUDIO_EXT[ext]
            args = ["-map", "0:a", "-vn", "-c:a", codec, "-b:a", rate]
        subprocess.run(  # noqa: S603 - fixed argv, no shell
            [exe, "-nostdin", "-y", "-v", "error", "-i", str(src), *args,
             "-map_metadata", "0", str(dst)],
            capture_output=True, timeout=FFMPEG_TIMEOUT, check=True,
        )  # fmt: skip
        new_dur, new_kinds = _probe(dst)
        if new_kinds != kinds or abs(new_dur - dur) > max(1.0, dur * 0.02):
            raise ValueError("length or streams changed")
        return dst.read_bytes()


# ---------------------------------------------------------------- one file


def kind_of(data: bytes, name: str) -> str:
    ext = Path(name or "").suffix.lower()
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:2] == b"PK" and ext in OFFICE_EXT:
        return "office"
    if (
        data[:3] == b"\xff\xd8\xff"
        or data[:8] == b"\x89PNG\r\n\x1a\n"
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
        or data[:4] in (b"II*\x00", b"MM\x00*")
    ):
        return "image"
    if ext in VIDEO_EXT or ext in AUDIO_EXT:
        return "media"
    return "other"


def compress_bytes(data: bytes, name: str, *, time_limit: float = TIME_LIMIT) -> Result | None:
    """Smaller bytes in the same format, checked, or None when nothing smaller was found.
    Raises Skip for a file that must stay as it is, anything else when the file is broken."""
    if len(data) < MIN_BYTES:
        raise Skip("small")
    if len(data) > MAX_BYTES:
        raise Skip("large")
    deadline = time.monotonic() + time_limit
    kind = kind_of(data, name)
    ext = Path(name or "").suffix.lower()
    if kind == "pdf":
        new, method = _pdf(data, deadline), "pdf"
    elif kind == "office":
        new, method = _office(data, ext, deadline), "zip"
    elif kind == "image":
        got = image_bytes(data)
        if got is None:
            return None
        new, method = got
        _check_image(new, data)
    elif kind == "media":
        new, method = _media(data, ext), "video" if ext in VIDEO_EXT else "audio"
    else:
        raise Skip("format")
    if len(new) >= len(data) * GAIN:
        return None
    return Result(new, method)


# ---------------------------------------------------------------- after a file is read


def skip_reason(f: DocFile) -> str | None:
    """Why a stored file is not compressed (None: it is tried)."""
    if f.compression:
        return "tried"
    if f.status != "ready":
        return "not ready"
    if f.quarantined:
        return "held back"
    if f.restricted:
        return "restricted"
    if f.source == "generated" or f.document_id or f.report_id:
        return "made here"
    if f.storage_id and not (f.storage_key or "").startswith("agentic/"):
        return "company storage"  # read in place from a company's own storage: theirs
    if (f.size or 0) < MIN_BYTES:
        return "small"
    if (f.size or 0) > MAX_BYTES:
        return "large"
    return None


def human(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{max(1, round(n / 1024))} KB"


async def compress_file(db: AsyncSession, f: DocFile) -> str:
    """Make a stored file smaller where it lives, if it can be; commits. Returns what
    happened: "smaller", "kept", or the reason it was skipped. Never raises."""
    from ..i18n import tr
    from ..services import audit
    from . import storage

    reason = skip_reason(f)
    if reason:
        return reason
    file_id = f.id
    try:
        data = await storage.read(db, f)
    except storage.StorageError as e:
        log.info("compress: could not read %s: %s", file_id, e)
        return "unreadable"
    before_sha = hashlib.sha256(data).hexdigest()
    now = datetime.now(UTC).isoformat(timespec="seconds")
    await db.commit()  # no transaction stays open while the bytes are worked on
    try:
        res = await asyncio.to_thread(compress_bytes, data, f.name)
    except Skip as s:
        res, why = None, s.reason
    except Exception as e:  # noqa: BLE001 - a file that cannot be compressed keeps its bytes
        log.info("compress: %s (%s) kept as it is: %s", file_id, f.name, e.__class__.__name__)
        res, why = None, f"failed: {e.__class__.__name__}"
    else:
        why = "" if res else "not smaller"
    # What may have changed while it was worked on (held back, replaced, deleted).
    try:
        await db.refresh(f, ["sha256", "quarantined", "restricted", "compression", "size"])
    except Exception:  # noqa: BLE001 - deleted meanwhile
        await db.rollback()
        return "gone"
    if f.compression or f.quarantined or f.restricted:
        return "changed"
    if f.sha256 and f.sha256 != before_sha:
        return "changed"
    if res is None:
        f.compression = {"result": "kept", "reason": why, "original_size": len(data), "at": now}
        await db.commit()
        return "kept"
    new_sha = hashlib.sha256(res.data).hexdigest()
    try:
        await storage.replace(db, f, res.data)
    except Exception as e:  # noqa: BLE001 - the original stays where it was
        await db.rollback()
        await _settle(db, f)
        log.warning("compress: could not save %s: %s", file_id, e)
        return "kept"
    f.size, f.sha256 = len(res.data), new_sha
    f.compression = {
        "result": "smaller",
        "original_size": len(data),
        "original_sha256": before_sha,
        "method": res.method,
        "at": now,
    }
    await audit.record(
        db,
        f.workspace_id,
        ACTOR,
        "file.compressed",
        file_id,
        before={"size": len(data), "sha256": before_sha},
        after={"size": len(res.data), "sha256": new_sha, "method": res.method},
        note=tr(
            "Compressed from {before} to {after}; same file type.",
            "en",
            before=human(len(data)),
            after=human(len(res.data)),
        ),
    )
    await db.commit()
    return "smaller"


async def _settle(db: AsyncSession, f: DocFile) -> None:
    """After a rollback the file's loaded values are expired: load them again, so the caller
    (process_file) can go on using it without a lazy load in async code."""
    with contextlib.suppress(Exception):
        await db.refresh(f)


async def after_read(db: AsyncSession, f: DocFile) -> None:
    """process_file's last step: compress, never letting a problem reach the read."""
    file_id = f.id
    try:
        await compress_file(db, f)
    except Exception:  # noqa: BLE001 - the file is read; compressing can wait for a re-upload
        await db.rollback()
        await _settle(db, f)
        log.warning("compress: %s failed", file_id, exc_info=True)
