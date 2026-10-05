"""Letters as Malaysian offices write them: paragraph numbers that start at 2, Malay dates."""

import io
from datetime import date

from docx import Document as DocxDocument

from agentic.documents import blocks, render_docx
from agentic.documents.fill import body_language, fill, fmt_date

LETTER = """Ruj. kami: {{doc.number}}
Tarikh: {{doc.date}}

Kepada:
**{{nama}}**

Tuan/Puan,

Dengan segala hormatnya perkara di atas adalah dirujuk.

2. Pada {{tarikh_kejadian}} anda didapati:

{{butiran}}

3. Anda dikehendaki memberi penjelasan.

Yang benar,
"""


def test_numbered_paragraphs_keep_their_numbers():
    parsed = blocks.parse("Intro.\n\n2. First point.\n\nText between.\n\n3. Second point.\n")
    numbers = [b for b in parsed if b.kind == "numbers"]
    assert [b.start for b in numbers] == [2, 3]
    md = blocks.to_preview_markdown("2. First point.\n\n3. Second point.\n")
    assert "2. First point." in md and "3. Second point." in md
    # A normal list still starts at 1.
    assert blocks.parse("1. a\n2. b\n")[0].start == 1


def test_word_export_writes_the_number_when_a_list_starts_later():
    data = render_docx.render("2. Berdasarkan rekod.\n\n3. Anda dikehendaki.\n", "Surat", {})
    text = "\n".join(p.text for p in DocxDocument(io.BytesIO(data)).paragraphs)
    assert "2.\tBerdasarkan rekod." in text and "3.\tAnda dikehendaki." in text


def test_malay_template_dates_in_malay():
    assert body_language(LETTER) == "ms"
    assert body_language("Dear Sir / Madam,\n\nDate: {{doc.date}}\n\nYours faithfully,") == "en"
    assert fmt_date("2026-10-05", "ms") == "5 Oktober 2026"
    assert fmt_date("2026-08-01", "ms") == "1 Ogos 2026"
    assert fmt_date("2026-10-05") == "5 October 2026"
    fields = [{"key": "tarikh_kejadian", "label": "Tarikh", "type": "date"}]
    out = fill(
        LETTER,
        {
            "nama": "Ali",
            "tarikh_kejadian": "2026-10-02",
            "butiran": "Tidur di pos.",
            "date": "2026-10-05",
        },
        fields,
        {"legal_name": "Syarikat Contoh Sdn Bhd"},
        {"number": "SA1-2026-0001", "title": "Surat amaran"},
        date(2026, 10, 5),
    )
    assert "Tarikh: 5 Oktober 2026" in out.markdown
    assert "Pada 2 Oktober 2026 anda didapati" in out.markdown


def test_blank_signatory_reads_in_the_letters_language():
    ms = fill(
        LETTER + "\n{{signature}}\n", {"nama": "Ali"}, [], {}, {"number": "X"}, date(2026, 10, 5)
    )
    assert "[[Nama penandatangan]]" in ms.markdown and "[[Nama syarikat]]" in ms.markdown
    en = fill("Dear Sir,\n\nYours faithfully,\n{{signature}}\n", {}, [], {}, {}, date(2026, 10, 5))
    assert "[[Signatory name]]" in en.markdown


def test_line_items_read_in_the_letters_language():
    from agentic.documents.fill import items_table

    items = [
        {"description": "Kasut kawad", "qty": 1, "unit": "pasang", "unit_price": 0, "amount": 0}
    ]
    totals = {"subtotal": 0.0, "tax": 0.0, "total": 0.0}
    ms = items_table(items, totals, "RM", "SST", "ms")
    assert "| Bil. | Perkara | Kuantiti | Harga seunit (RM) | Jumlah (RM) |" in ms
    assert "**Jumlah besar**" in ms
    assert "| No. | Description | Qty |" in items_table(items, totals, "RM", "SST")
