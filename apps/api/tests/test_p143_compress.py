"""P143c: uploaded files are made smaller in the background, in the same format.

The owner (27 Nov 2026): every upload compressed as far as it goes, the quality and format
kept: same name, extension and MIME type, still opens the same; only the size changes.
"""

import hashlib
import io
import json
import random
import shutil
import subprocess
import zipfile

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

from agentic.core.db import SessionLocal
from agentic.documents import compress, service, storage
from agentic.models import AuditLog, DocFile

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_documents import inline_reading, upload  # noqa: F401

# ---------------------------------------------------------------- synthetic files


def _photo(w: int, h: int, seed: int = 1) -> Image.Image:
    rnd = random.Random(seed)  # noqa: S311 - test pictures
    im = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    d = ImageDraw.Draw(im)
    for _ in range(300):
        x, y, r = rnd.randrange(w), rnd.randrange(h), rnd.randrange(10, w // 8)
        d.ellipse((x, y, x + r, y + r), fill=tuple(rnd.randrange(256) for _ in range(3)))
    im = im.filter(ImageFilter.GaussianBlur(3))
    return Image.blend(im, Image.effect_noise((w, h), 12).convert("RGB"), 0.08)


def _jpeg(w: int = 5000, h: int = 3500, q: int = 98, seed: int = 1) -> bytes:
    b = io.BytesIO()
    _photo(w, h, seed).save(b, "JPEG", quality=q, subsampling=0)
    return b.getvalue()


def _png(w: int = 2000, h: int = 1400) -> bytes:
    b = io.BytesIO()
    _photo(w, h).save(b, "PNG", compress_level=1)
    return b.getvalue()


def _pdf(pages: int = 3) -> bytes:
    from fpdf import FPDF

    p = FPDF()
    for i in range(pages):
        p.add_page()
        p.set_font("helvetica", size=14)
        p.cell(text=f"Page {i + 1} of the site report")
        p.image(io.BytesIO(_jpeg(4200, 3000, seed=i)), x=10, y=30, w=190)
    return bytes(p.output())


def _docx() -> bytes:
    from docx import Document
    from docx.shared import Inches

    d = Document()
    d.add_paragraph("Site photo report")
    d.add_picture(io.BytesIO(_jpeg(4500, 3000)), width=Inches(6))
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


def _render(pdf: bytes, page: int = 0) -> Image.Image:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf)
    try:
        return doc[page].render(scale=1).to_pil().convert("RGB")
    finally:
        doc.close()


def _diff(a: Image.Image, b: Image.Image) -> float:
    return max(ImageStat.Stat(ImageChops.difference(a, b)).mean)


# ---------------------------------------------------------------- the bytes


def test_a_big_jpeg_gets_much_smaller_stays_a_jpeg_and_looks_the_same():
    data = _jpeg()
    r = compress.compress_bytes(data, "site.jpg")
    assert r is not None and r.method == "jpeg"
    assert len(r.data) < len(data) * 0.2  # 5000 px quality 98 -> 4000 px quality 85
    with Image.open(io.BytesIO(r.data)) as im:
        assert im.format == "JPEG" and max(im.size) == compress.MAX_SIDE
        assert compress.jpeg_quality(im) >= compress.MIN_QUALITY
        small = _photo(5000, 3500).resize(im.size)
        assert _diff(im.convert("RGB"), small) < 4  # visually the same


def test_a_light_jpeg_keeps_its_own_quality():
    data = _jpeg(3000, 2000, q=70)
    try:
        r = compress.compress_bytes(data, "light.jpg")
    except compress.Skip:
        r = None
    if r is not None:  # only better packed: the same tables, never a lower quality
        with Image.open(io.BytesIO(r.data)) as a, Image.open(io.BytesIO(data)) as b:
            assert a.size == b.size and a.quantization == b.quantization


def test_a_png_is_packed_losslessly():
    data = _png()
    r = compress.compress_bytes(data, "chart.png")
    assert r is not None and r.method == "png" and len(r.data) < len(data) * 0.7
    with Image.open(io.BytesIO(r.data)) as a, Image.open(io.BytesIO(data)) as b:
        assert a.format == "PNG" and a.size == b.size
        assert ImageChops.difference(a.convert("RGB"), b.convert("RGB")).getbbox() is None


def test_a_pdf_with_big_photos_keeps_its_pages_text_and_look():
    from pypdf import PdfReader

    data = _pdf()
    r = compress.compress_bytes(data, "report.pdf")
    assert r is not None and r.method == "pdf"
    assert len(r.data) < len(data) * 0.2
    a, b = PdfReader(io.BytesIO(data)), PdfReader(io.BytesIO(r.data))
    assert len(a.pages) == len(b.pages) == 3
    assert [p.extract_text() for p in a.pages] == [p.extract_text() for p in b.pages]
    assert r.data[:5] == b"%PDF-"
    for page in range(3):
        assert _diff(_render(data, page), _render(r.data, page)) < 3


def test_a_word_file_with_a_big_picture_still_opens_with_the_same_parts():
    from docx import Document

    data = _docx()
    r = compress.compress_bytes(data, "photos.docx")
    assert r is not None and r.method == "zip"
    assert len(r.data) < len(data) * 0.3
    old, new = zipfile.ZipFile(io.BytesIO(data)), zipfile.ZipFile(io.BytesIO(r.data))
    assert old.namelist() == new.namelist() and new.testzip() is None
    d = Document(io.BytesIO(r.data))
    assert d.paragraphs[0].text == "Site photo report"
    assert len(d.inline_shapes) == 1
    media = [n for n in new.namelist() if n.startswith("word/media/")]
    with Image.open(io.BytesIO(new.read(media[0]))) as im:
        assert im.format == "JPEG"


def test_small_odd_and_broken_files_are_left():
    with pytest.raises(compress.Skip):
        compress.compress_bytes(b"%PDF-1.4 tiny", "tiny.pdf")
    with pytest.raises(compress.Skip):
        compress.compress_bytes(b"a,b\n" * 100_000, "rows.csv")
    with pytest.raises(Exception):  # noqa: B017, PT011 - any reader error: the caller keeps it
        compress.compress_bytes(b"%PDF-1.7\n" + b"\x00garbage" * 40_000, "broken.pdf")


def test_encrypted_and_signed_pdfs_are_left():
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, NumberObject

    w = PdfWriter(clone_from=PdfReader(io.BytesIO(_pdf(1))))
    w.encrypt("secret")
    b = io.BytesIO()
    w.write(b)
    with pytest.raises(compress.Skip, match="encrypted"):
        compress.compress_bytes(b.getvalue(), "locked.pdf")

    w = PdfWriter(clone_from=PdfReader(io.BytesIO(_pdf(1))))
    w._root_object[NameObject("/AcroForm")] = DictionaryObject(  # noqa: SLF001
        {NameObject("/SigFlags"): NumberObject(3)}
    )
    b = io.BytesIO()
    w.write(b)
    with pytest.raises(compress.Skip, match="signed"):
        compress.compress_bytes(b.getvalue(), "signed.pdf")


@pytest.mark.skipif(not compress.ffmpeg_available(), reason="ffmpeg is not installed here")
def test_a_video_stays_an_mp4_of_the_same_length(tmp_path):
    src = tmp_path / "clip.mp4"
    subprocess.run(  # noqa: S603
        [shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
         "testsrc2=size=1280x720:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
         "-t", "4", "-c:v", "libx264", "-crf", "4", "-c:a", "aac", "-b:a", "256k", str(src)],
        check=True, timeout=120,
    )  # fmt: skip
    data = src.read_bytes()
    r = compress.compress_bytes(data, "clip.mp4")
    assert r is not None and r.method == "video" and len(r.data) < len(data) * 0.5
    out = tmp_path / "out.mp4"
    out.write_bytes(r.data)
    dur, kinds = compress._probe(out)  # noqa: SLF001
    assert abs(dur - 4) < 0.5 and kinds == ["audio", "video"]


# ---------------------------------------------------------------- stored files


async def _put(ws_id: str, name: str, data: bytes, **kw) -> str:
    async with SessionLocal() as db:
        f = await service.create_file(
            db,
            workspace_id=ws_id,
            name=name,
            data=data,
            created_by="system:test",
            source="upload",
            status="ready",
            **kw,
        )
        await db.commit()
        return f.id


async def _ws(client) -> str:
    await office(client)
    return (await client.get("/api/auth/me")).json()["workspace"]["id"]


async def test_a_stored_photo_is_replaced_by_the_smaller_one_with_the_same_name(client):
    ws = await _ws(client)
    data = _jpeg(4800, 3200)
    fid = await _put(ws, "Site photo.JPG", data, mime="image/jpeg")
    async with SessionLocal() as db:
        f = await db.get(DocFile, fid)
        assert await compress.compress_file(db, f) == "smaller"
    async with SessionLocal() as db:
        f = await db.get(DocFile, fid)
        now = await storage.read(db, f)
        assert f.name == "Site photo.JPG" and f.mime == "image/jpeg"
        assert f.size == len(now) < len(data) * 0.2
        assert f.sha256 == hashlib.sha256(now).hexdigest()
        assert f.compression["original_size"] == len(data)
        assert f.compression["original_sha256"] == hashlib.sha256(data).hexdigest()
        audit = await db.scalar(
            AuditLog.__table__.select()
            .with_only_columns(AuditLog.note)
            .where(AuditLog.target == fid, AuditLog.action == "file.compressed")
        )
        assert audit and audit.startswith("Compressed from ")
        # Tried once: a second pass leaves it.
        assert await compress.compress_file(db, f) == "tried"
    detail = (await client.get(f"/api/files/{fid}")).json()
    assert detail["original_size"] == len(data) and detail["size"] < len(data)
    assert detail["name"] == "Site photo.JPG" and detail["mime"] == "image/jpeg"


async def test_held_back_restricted_tiny_and_broken_files_keep_their_bytes(client):
    ws = await _ws(client)
    big = _jpeg(3000, 2000)
    held = await _put(ws, "held.jpg", big)
    secret = await _put(ws, "pay.jpg", big)
    tiny = await _put(ws, "tiny.jpg", _jpeg(200, 150))
    broken_bytes = b"%PDF-1.7\n" + b"\x00garbage" * 40_000
    broken = await _put(ws, "broken.pdf", broken_bytes)
    async with SessionLocal() as db:
        (await db.get(DocFile, held)).quarantined = True
        (await db.get(DocFile, secret)).restricted = True
        await db.commit()
    want = {held: "held back", secret: "restricted", tiny: "small", broken: "kept"}
    for fid, result in want.items():
        async with SessionLocal() as db:
            f = await db.get(DocFile, fid)
            before = await storage.read(db, f)
            assert await compress.compress_file(db, f) == result
        async with SessionLocal() as db:
            f = await db.get(DocFile, fid)
            assert await storage.read(db, f) == before
            assert f.size == len(before)
            assert f.sha256 == hashlib.sha256(before).hexdigest()
    async with SessionLocal() as db:
        f = await db.get(DocFile, broken)
        assert f.compression["result"] == "kept"
        assert f.compression["reason"].startswith("failed")
    detail = (await client.get(f"/api/files/{broken}")).json()
    assert detail["original_size"] is None


async def test_an_upload_is_compressed_after_it_is_read(client, llm, temporal, inline_reading):
    o = await office(client)
    await client.put(
        "/api/ai/groups/fast",
        json={"members": [{"provider_id": o["provider"]["id"], "model_id": "m1"}]},
        headers=csrf(client),
    )
    llm.say(
        json.dumps({"kind": "Report", "title": "Site report", "summary": "Photos.", "fields": {}})
    )
    data = _pdf(2)
    r = await upload(client, "site report.pdf", data, branch_id=o["branch"]["id"])
    assert r.status_code == 201, r.text
    f = (await client.get(f"/api/files/{r.json()['id']}")).json()
    assert f["status"] == "ready" and f["pages"] == 2
    assert f["name"] == "site report.pdf" and f["mime"] == "application/pdf"
    assert f["original_size"] == len(data) and f["size"] < len(data) * 0.3
    assert "site report" in f["text"]
    got = await client.get(f"/api/files/{f['id']}/download")
    assert got.status_code == 200 and len(got.content) == f["size"]
    assert got.content[:5] == b"%PDF-"
