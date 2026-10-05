"""PDFium is not thread-safe: several PDFs read at once (an upload of a whole zip) must all
finish instead of deadlocking the worker."""

import asyncio

from fpdf import FPDF

from agentic.documents.extract import extract


def _pdf(pages: int, label: str) -> bytes:
    doc = FPDF()
    doc.set_font("Helvetica", size=12)
    for n in range(pages):
        doc.add_page()
        doc.multi_cell(0, 8, f"{label} page {n + 1}. " + "Langkah kerja harian. " * 40)
    return bytes(doc.output())


async def test_many_pdfs_read_at_once_all_finish():
    files = [_pdf(30, f"Doc {i}") for i in range(6)]
    jobs = [
        asyncio.to_thread(extract, data, f"doc{i}.pdf", "application/pdf")
        for i, data in enumerate(files)
    ]
    out = await asyncio.wait_for(asyncio.gather(*jobs), timeout=120)
    assert [o.pages for o in out] == [30] * 6
    assert all(f"Doc {i} page 30" in o.text for i, o in enumerate(out))


def test_a_typed_page_with_a_pasted_scan_counts_as_a_picture_page(tmp_path):
    import pypdfium2 as pdfium
    from PIL import Image

    from agentic.documents.extract import PICTURE_PAGE_SHARE, _picture_share

    img = tmp_path / "scan.png"
    Image.new("RGB", (800, 600), "white").save(img)
    doc = FPDF()
    doc.set_font("Helvetica", size=12)
    doc.add_page()
    doc.multi_cell(0, 8, "Contoh surat amaran pertama. " * 10)
    doc.image(str(img), x=20, y=80, w=170)
    doc.add_page()
    doc.multi_cell(0, 8, "Typed text only. " * 30)
    pdf = pdfium.PdfDocument(bytes(doc.output()))
    assert _picture_share(pdfium, pdf[0]) >= PICTURE_PAGE_SHARE
    assert _picture_share(pdfium, pdf[1]) == 0.0
