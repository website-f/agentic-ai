"""P24 company documents: upload a zip (folders kept) or files, read, scan for secrets and
personal data, sort by kind and department, library, report, tree, preview, archive, move,
release/hold back, the company_documents tool, and scope.

All data here is synthetic: made-up names, IC numbers with valid shapes, fake logins.
"""

import io
import json
import zipfile

import httpx
import pytest
from sqlalchemy import func, select, text

from agentic.agents import dispatch
from agentic.core.db import SessionLocal
from agentic.documents import extract
from agentic.intake import pipeline, scan, sort, unpack
from agentic.models import AuditLog, DocFile, IntakeBatch, KnowledgeChunk

from .conftest import csrf
from .test_agents import llm, new_agent, office, temporal  # noqa: F401
from .test_documents import _docx, inline_reading  # noqa: F401
from .test_library import indexing  # noqa: F401
from .test_office_roles import as_role

SECRET_PW = "Rahsia@2026"
SECRET_LOGIN = "contohsyarikat01"
SECRET_PIN = "482913"
SECRET_ANSWER = "Kucing Oren"
ICS = ["900101-14-5678", "850215-10-1234", "920315-08-4321", "881120-01-2468"]

TENDER_GUIDE = (
    "[page 1]\nPANDUAN TENDER ePerolehan\nLangkah demi langkah untuk menghantar tender.\n\n"
    "[page 3]\nMaklumat akaun portal:\n"
    f"ID Log Masuk : {SECRET_LOGIN}\n"
    f"Kata Laluan : {SECRET_PW}\n"
    "Soalan Keselamatan: Nama haiwan peliharaan pertama?\n"
    f"Jawapan: {SECRET_ANSWER}\n"
    f"PIN sijil digital: {SECRET_PIN}\n"
)
SOP_TEXT = (
    "SOP KAWALAN PINTU MASUK\nTatacara kerja pengawal keselamatan di pintu masuk. "
    "1. Pengawal memeriksa pas pelawat. 2. Pengawal mencatat nombor kenderaan dalam buku log. "
    "3. Pengawal melaporkan kejadian luar biasa kepada penyelia syif. " * 3
)
CHECKLIST = (
    "SENARAI SEMAK TUGAS PENGAWAL\n- Periksa lampu rondaan\n- Kunci pintu stor\n"
    "- Catat rondaan setiap jam dalam buku log rondaan\n"
)
GUIDE = [
    "BUKU PANDUAN PENGAWAL",
    "Panduan ini menerangkan tugas harian pengawal keselamatan di tapak.",
    "Setiap pengawal mesti memakai pakaian seragam lengkap dan membawa wisel.",
]
WARNING_LETTERS = [
    "CONTOH SURAT AMARAN",
    f"Kepada: Ali bin Abu (No. K/P: {ICS[0]})",
    f"Kepada: Siti binti Omar (No. K/P: {ICS[1]})",
    f"Kepada: Ramu a/l Muthu (No. K/P: {ICS[2]})",
    f"Kepada: Tan Mei Ling (No. K/P: {ICS[3]})",
    "Anda didapati tidur semasa bertugas. Ini amaran pertama.",
]


@pytest.fixture(autouse=True)
async def wipe_chunks():
    async with SessionLocal() as db:
        await db.execute(text("TRUNCATE knowledge_chunks RESTART IDENTITY"))
        await db.commit()


@pytest.fixture
def intake_inline(monkeypatch):
    """The worker side runs right away, in the request, instead of on Temporal."""
    calls: list[str] = []

    async def start_intake(batch_id):
        calls.append(batch_id)
        await pipeline.run_inline(batch_id)

    monkeypatch.setattr(dispatch, "start_intake", start_intake)
    return calls


# ---------------------------------------------------------------- builders of test files


def pdf_bytes(pages: list[str]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_font("Helvetica", size=11)
    for p in pages:
        pdf.add_page()
        pdf.multi_cell(0, 6, p)
    return bytes(pdf.output())


def png_bytes(words: str = "CARTA ALIR TENDER") -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (900, 200), "white")
    ImageDraw.Draw(img).text((20, 80), words, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def xlsx_bytes(rows: list[list[str]]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def pptx_bytes(slides: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        for i, s in enumerate(slides, 1):
            z.writestr(
                f"ppt/slides/slide{i}.xml",
                f'<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>{s}</a:t></a:r></a:p></p:sld>',
            )
    return buf.getvalue()


def make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


def flag_encrypted(data: bytes, name: str) -> bytes:
    """Set the 'encrypted' bit on one entry (zipfile cannot write encrypted entries)."""
    buf = bytearray(data)
    info = zipfile.ZipFile(io.BytesIO(data)).getinfo(name)
    buf[info.header_offset + 6] |= 1
    i = buf.find(b"PK\x01\x02")
    while i != -1:
        n = int.from_bytes(buf[i + 28 : i + 30], "little")
        if bytes(buf[i + 46 : i + 46 + n]).decode() == name:
            buf[i + 8] |= 1
        i = buf.find(b"PK\x01\x02", i + 4)
    return bytes(buf)


def operasi_zip() -> bytes:
    deep = make_zip({"x.txt": b"deep"})
    inner = make_zip({"Borang Cuti.txt": b"BORANG PERMOHONAN CUTI\nNama: ____\n", "deep.zip": deep})
    data = make_zip(
        {
            "OPERASI/SOP/SOP Kawalan Pintu Masuk.pdf": pdf_bytes([SOP_TEXT]),
            "OPERASI/SOP/Contoh Surat Amaran.docx": _docx(WARNING_LETTERS),
            "OPERASI/SENARAI SEMAK/Senarai Tugas Pengawal.txt": CHECKLIST.encode(),
            "OPERASI/Buku Panduan Pengawal.docx": _docx(GUIDE),
            "OPERASI/.DS_Store": b"junk",
            "OPERASI/Thumbs.db": b"junk",
            "OPERASI/empty.txt": b"",
            "OPERASI/inner.zip": inner,
            "OPERASI/locked.pdf": b"%PDF-1.4 locked",
            "OPERASI/bomb.txt": b"\0" * (2 * 1024 * 1024),
            "__MACOSX/OPERASI/._Buku Panduan Pengawal.docx": b"junk",
            "../evil.txt": b"zip slip",
        }
    )
    return flag_encrypted(data, "OPERASI/locked.pdf")


def tender_zip() -> bytes:
    return make_zip(
        {
            "Panduan Tender ePerolehan.txt": TENDER_GUIDE.encode(),
            "CARTA ALIR/Carta Alir Tender.png": png_bytes(),
            "Sijil SSM.pdf": pdf_bytes(["SIJIL PENDAFTARAN SYARIKAT\nMaju Sdn Bhd"]),
            "Penyata Bank.csv": (
                b"Tarikh,Butiran,Amaun\n2026-01-01,Maybank akaun 5141 2345 6789,100\n"
            ),
            "Kontrak Perkhidmatan.xlsx": xlsx_bytes(
                [["KONTRAK PERKHIDMATAN KAWALAN"], ["Tempoh", "2 tahun"]]
            ),
        }
    )


async def intake(c: httpx.AsyncClient, name: str, data: bytes, **params) -> httpx.Response:
    return await c.post(
        "/api/intake",
        params={"name": name, **params},
        content=data,
        headers={**csrf(c), "content-type": "application/octet-stream"},
    )


async def batch_detail(c: httpx.AsyncClient, batch_id: str) -> dict:
    r = await c.get(f"/api/intake/{batch_id}")
    assert r.status_code == 200, r.text
    return r.json()


def by_name(files: list[dict]) -> dict[str, dict]:
    return {f["name"]: f for f in files}


async def passages(source_id: str) -> int:
    async with SessionLocal() as db:
        return (
            await db.scalar(
                select(func.count())
                .select_from(KnowledgeChunk)
                .where(KnowledgeChunk.source_id == source_id)
            )
        ) or 0


async def two_zips(client) -> tuple[dict, dict, dict]:
    """The office, then OPERASI.zip and TENDER.zip uploaded into its company."""
    o = await office(client)
    b = o["branch"]["id"]
    r1 = await intake(client, "OPERASI.zip", operasi_zip(), branch_id=b)
    assert r1.status_code == 201, r1.text
    r2 = await intake(client, "TENDER.zip", tender_zip(), branch_id=b)
    assert r2.status_code == 201, r2.text
    return o, r1.json(), r2.json()


# ================================================================ scan (pure)


def test_scan_finds_tender_portal_login_password_answer_and_pin():
    found = scan.scan(TENDER_GUIDE)
    rec = found.record()
    assert rec["credentials"] == ["login_id", "password", "pin", "security_answer"]
    assert rec["credential_pages"] == [3] and found.quarantine
    blob = json.dumps(rec) + scan.describe(rec)
    for secret in (SECRET_PW, SECRET_LOGIN, SECRET_PIN, "Kucing", "Oren"):
        assert secret not in blob
    masked = scan.mask(TENDER_GUIDE, found)
    for secret in (SECRET_PW, SECRET_LOGIN, SECRET_PIN, SECRET_ANSWER):
        assert secret not in masked
    assert "ID Log Masuk : [hidden]" in masked and "PANDUAN TENDER" in masked
    assert scan.describe(rec) == "Login ID, password, PIN and security-question answer (page 3)"


def test_scan_english_pairs_tables_tokens_and_keys():
    text = (
        "Portal access\nUsername: acme.admin\nPassword: Sunshine2026!\n"
        "| User ID | ops_lead |\n| Kata Laluan | Tukar123 |\n"
        "Your TAC: 774201 (valid 3 minutes)\n"
        "api_key = abcd1234efgh5678ijkl9999\n"
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n"
    )
    rec = scan.scan(text).record()
    assert set(rec["credentials"]) == {"login_id", "password", "otp", "api_key", "private_key"}
    masked = scan.mask(text)
    for secret in ("acme.admin", "Sunshine2026!", "ops_lead", "Tukar123", "774201", "abcd1234"):
        assert secret not in masked


def test_scan_ignores_policies_and_blank_forms():
    text = (
        "Password must be at least 8 characters and changed every 90 days.\n"
        "Kata laluan hendaklah ditukar setiap 90 hari.\n"
        "Password: ________\nUsername: your email\nPIN: 6 digits\nKata Laluan: [isi sendiri]\n"
        "Login to the portal and click Submit. User ID: ..........\n"
        "Pin the notice on the board by 2024.\n"
    )
    assert scan.scan(text).record() == {}


def test_scan_counts_valid_ic_numbers_and_quarantines_three():
    one = scan.scan(f"Nama: Ali  No. K/P: {ICS[0]}")
    assert one.record()["personal_kinds"] == {"ic": 1} and not one.quarantine
    bad = scan.scan("KP 921330-14-1111, 920230-14-1111, 900101-00-1234, 900101-17-1234")
    assert bad.record() == {}  # month 13, 30 Feb, birthplace 00 and 17 are not real
    many = scan.scan("[page 2]\n" + "\n".join(f"K/P: {ic}" for ic in ICS) + f"\nIC {ICS[0]}")
    rec = many.record()
    assert rec["personal_ids"] == 4 and rec["personal_pages"] == [2] and many.quarantine
    assert "900101" not in json.dumps(rec) and scan.describe(rec) == "4 IC numbers (page 2)"
    undashed = scan.scan("No. Kad Pengenalan 900101145678")
    assert undashed.record()["personal_kinds"] == {"ic": 1}


def test_scan_bank_accounts_and_passports_flag_without_quarantine():
    text = (
        "Bayar ke Maybank akaun 5141 2345 6789 sebelum 5hb.\n"
        "Bank hotline tel 03-2070 8833.\nNo. Pasport: A12345678\n"
    )
    found = scan.scan(text)
    assert found.record()["personal_kinds"] == {"bank_account": 1, "passport": 1}
    assert not found.quarantine
    assert "5141" not in scan.mask(text, found) and "A12345678" not in scan.mask(text, found)


def test_scan_apply_keeps_a_release():
    class F:
        sensitive: dict = {}
        quarantined = False

    f = F()
    scan.apply(f, scan.scan(TENDER_GUIDE))
    assert f.quarantined is True
    f.quarantined = False
    f.sensitive = {**f.sensitive, "released": True, "reviewed_by": "user:x"}
    scan.apply(f, scan.scan(TENDER_GUIDE))  # a re-read does not hold it back again
    assert f.quarantined is False and f.sensitive["reviewed_by"] == "user:x"


# ================================================================ sort (pure)


def test_sort_by_name_folder_and_first_page():
    assert sort.kind_of("SOP Kawalan Pintu.pdf", "OPERASI/SOP", "").kind == "sop"
    assert sort.kind_of("x.png", "TENDER/CARTA ALIR", "").kind == "flowchart"
    assert sort.kind_of("Senarai Semak Harian.xlsx", "", "").kind == "checklist"
    assert sort.kind_of("Borang Cuti.docx", "HR", "").kind == "form"
    assert sort.kind_of("Sijil SSM.pdf", "", "").kind == "certificate"
    assert sort.kind_of("Kontrak Kawalan.pdf", "", "").kind == "contract"
    assert sort.kind_of("Invois 0042.pdf", "", "").kind == "financial"
    assert sort.kind_of("doc1.pdf", "", "[page 1]\nPANDUAN PENGGUNA SISTEM\n").kind == "guide"
    assert sort.kind_of("Employee Handbook.pdf", "", "").kind == "guide"
    unsure = sort.kind_of("notes.txt", "", "random words here")
    assert unsure.kind == "other" and not unsure.confident
    # The model's category decides when the rules have nothing.
    assert sort.kind_of("notes.txt", "", "x", category="policy").kind == "policy"
    assert sort.kind_of("a.pdf", "", "x", free_kind="SSM certificate").kind == "certificate"
    # ...but not over a confident rule.
    assert sort.kind_of("SOP Kawalan.pdf", "SOP", "", category="letter").kind == "sop"
    # A picture of a procedure in a flowchart folder is a flowchart, whatever the model says.
    chart = sort.kind_of(
        "3_TATACARA MENDAPATKAN NO QT.png", "TENDER/CARTA ALIR", "", category="template"
    )
    assert chart.kind == "flowchart" and chart.confident
    assert sort.kind_of("7.1_TATACARA CADANGAN HARGA.png", "", "", category="financial").kind == (
        "flowchart"
    )
    # A PDF procedure stays an SOP.
    assert sort.kind_of("2_TATACARA SEBELUM PENYEDIAAN TENDER.pdf", "TENDER", "").kind == "sop"


def test_sort_department_from_folder_words_and_model():
    depts = [
        sort.Dept("d_ops", "Operations"),
        sort.Dept("d_fin", "Finance"),
        sort.Dept("d_hr", "Human Resources"),
    ]
    assert sort.department_of(depts, "a.pdf", "OPERASI/SOP", "") == "d_ops"
    assert sort.department_of(depts, "Penyata Akaun.pdf", "", "") == "d_fin"
    assert sort.department_of(depts, "Surat Amaran.docx", "", "") == "d_hr"
    assert sort.department_of(depts, "x.pdf", "", "", suggested="finance") == "d_fin"
    assert sort.department_of(depts, "x.pdf", "", "") is None
    assert '"Operations", "Finance"' in sort.hint(depts)


# ================================================================ unpack (pure)


def test_unpack_keeps_folders_and_reports_what_it_skipped():
    items = list(unpack.entries(operasi_zip(), "OPERASI.zip"))
    report = items[-1]
    assert isinstance(report, unpack.Report)
    got = {(e.folder, e.name) for e in items[:-1] if isinstance(e, unpack.Entry)}
    assert got == {
        ("OPERASI/SOP", "SOP Kawalan Pintu Masuk.pdf"),
        ("OPERASI/SOP", "Contoh Surat Amaran.docx"),
        ("OPERASI/SENARAI SEMAK", "Senarai Tugas Pengawal.txt"),
        ("OPERASI", "Buku Panduan Pengawal.docx"),
        ("OPERASI/inner", "Borang Cuti.txt"),  # a nested zip, one level deep
    }
    codes = {s["path"]: s["code"] for s in report.skipped}
    assert codes == {
        "../evil.txt": "unsafe_path",
        "OPERASI/.DS_Store": "system_file",
        "OPERASI/Thumbs.db": "system_file",
        "__MACOSX/": "system_file",
        "OPERASI/empty.txt": "empty",
        "OPERASI/locked.pdf": "encrypted",
        "OPERASI/bomb.txt": "zip_bomb",
        "OPERASI/inner.zip/deep.zip": "zip_too_deep",
    }
    assert all(s["reason"] for s in report.skipped)


def test_unpack_prefixes_the_zip_name_and_enforces_limits(monkeypatch):
    items = list(unpack.entries(make_zip({"a.txt": b"a", "B/b.txt": b"b"}), "TENDER.zip"))
    assert {(e.folder, e.name) for e in items if isinstance(e, unpack.Entry)} == {
        ("TENDER", "a.txt"),
        ("TENDER/B", "b.txt"),
    }
    assert unpack.split_path("C:/Windows/x") is None and unpack.split_path("/etc/x") is None
    assert unpack.split_path("a\\..\\..\\b") is None and unpack.split_path("a/./b") == ["a", "b"]
    monkeypatch.setattr(unpack, "MAX_ENTRIES", 2)
    items = list(unpack.entries(make_zip({f"F/{i}.txt": b"x" for i in range(4)}), "F.zip"))
    assert len([e for e in items if isinstance(e, unpack.Entry)]) == 2
    assert [s["code"] for s in items[-1].skipped] == ["too_many_files", "too_many_files"]
    with pytest.raises(unpack.UnpackError):
        list(unpack.entries(b"PK\x03\x04 not really a zip", "x.zip"))
    assert unpack.is_zip(make_zip({"a": b"a"}), "a.zip")
    assert not unpack.is_zip(_docx(["x"]), "a.docx")


def test_pptx_text_is_read_slide_by_slide():
    out = extract.extract(pptx_bytes(["CARTA ALIR TENDER", "Langkah 2 &amp; 3"]), "deck.pptx")
    assert out.pages == 2 and "[page 2]\nLangkah 2 & 3" in out.text


# ================================================================ the pipeline over the API


async def test_zip_upload_is_unpacked_read_scanned_sorted_and_reported(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o, op, td = await two_zips(client)
    ops_dept = o["depts"]["Operations"]
    assert op["status"] == "ready" and op["total"] == 5 and op["done"] == 5
    assert op["name"] == "OPERASI" and td["name"] == "TENDER"
    assert intake_inline == [op["id"], td["id"]]

    detail = await batch_detail(client, op["id"])
    files = by_name(detail["files"])
    sop = files["SOP Kawalan Pintu Masuk.pdf"]
    assert sop["folder"] == "OPERASI/SOP" and sop["source_path"].endswith(sop["name"])
    assert sop["batch_id"] == op["id"] and sop["kind"] == "sop" and sop["status"] == "ready"
    assert sop["library"] is True and sop["department_id"] == ops_dept
    assert await passages(sop["id"]) >= 1  # in the library and searchable
    assert files["Senarai Tugas Pengawal.txt"]["kind"] == "checklist"
    assert files["Buku Panduan Pengawal.docx"]["kind"] == "guide"
    assert files["Borang Cuti.txt"]["folder"] == "OPERASI/inner"
    assert files["Borang Cuti.txt"]["kind"] == "form"

    letters = files["Contoh Surat Amaran.docx"]
    assert letters["quarantined"] is True and letters["library"] is False
    assert letters["sensitive"]["personal_kinds"] == {"ic": 4}
    assert await passages(letters["id"]) == 0

    report = detail["report"]
    assert report["by_kind"]["sop"] == 1 and sum(report["by_kind"].values()) == 5
    assert report["by_department"][ops_dept] == 5
    assert report["library"] == 4 and report["held_back"] == 1
    assert [f["name"] for f in report["flagged"]] == ["Contoh Surat Amaran.docx"]
    assert report["flagged"][0]["reasons"] == ["personal_ids"]
    assert report["flagged"][0]["detail"] == "4 IC numbers"
    codes = {s["code"] for s in report["skipped"]}
    assert codes >= {"unsafe_path", "system_file", "empty", "encrypted", "zip_bomb"}
    assert isinstance(report["suggestions"], list)

    tender = by_name((await batch_detail(client, td["id"]))["files"])
    guide = tender["Panduan Tender ePerolehan.txt"]
    assert guide["folder"] == "TENDER" and guide["kind"] == "guide"
    assert guide["quarantined"] is True and guide["library"] is False
    assert guide["sensitive"]["credentials"] == ["login_id", "password", "pin", "security_answer"]
    assert tender["Carta Alir Tender.png"]["folder"] == "TENDER/CARTA ALIR"
    assert tender["Carta Alir Tender.png"]["kind"] == "flowchart"
    assert tender["Sijil SSM.pdf"]["kind"] == "certificate"
    assert tender["Sijil SSM.pdf"]["library"] is False  # company file, not how-to
    assert tender["Kontrak Perkhidmatan.xlsx"]["kind"] == "contract"
    bank = tender["Penyata Bank.csv"]
    assert bank["kind"] == "financial" and bank["quarantined"] is False
    assert bank["sensitive"]["personal_kinds"] == {"bank_account": 1}

    # Secret values are stored nowhere but in the file itself.
    async with SessionLocal() as db:
        rows = (await db.scalars(select(IntakeBatch))).all()
        blob = json.dumps([b.report for b in rows])
        fl = (await db.scalars(select(DocFile))).all()
        blob += json.dumps([[f.sensitive, f.summary, f.title, f.fields] for f in fl])
    for secret in (SECRET_PW, SECRET_LOGIN, SECRET_PIN, SECRET_ANSWER, *ICS, "5141 2345"):
        assert secret not in blob

    # Lists: one folder, everything under a folder, one upload.
    at = (await client.get("/api/files", params={"folder": "OPERASI"})).json()
    assert [f["name"] for f in at] == ["Buku Panduan Pengawal.docx"]
    under = (await client.get("/api/files", params={"folder": "OPERASI", "recursive": True})).json()
    assert len(under) == 5
    one = await client.get("/api/files", params={"batch_id": td["id"]})
    assert one.headers["x-total-count"] == "5"

    # Batches list, paged.
    r = await client.get("/api/intake", params={"branch_id": o["branch"]["id"], "limit": 1})
    assert r.status_code == 200 and r.headers["x-total-count"] == "2"
    assert [b["id"] for b in r.json()] == [td["id"]] and r.headers.get("x-next-cursor")
    r = await client.get("/api/intake", params={"cursor": r.headers["x-next-cursor"]})
    assert [b["id"] for b in r.json()] == [op["id"]]


async def test_tree_and_move(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o, op, td = await two_zips(client)
    tree = (await client.get("/api/files/tree", params={"branch_id": o["branch"]["id"]})).json()
    paths = [f["path"] for f in tree["folders"]]
    assert paths == [
        "OPERASI",
        "OPERASI/inner",
        "OPERASI/SENARAI SEMAK",
        "OPERASI/SOP",
        "TENDER",
        "TENDER/CARTA ALIR",
    ]
    top = next(f for f in tree["folders"] if f["path"] == "OPERASI")
    assert top["files"] == 5 and top["direct"] == 1 and top["flagged"] == 1
    assert top["kinds"]["sop"] == 1 and top["size"] > 0
    assert tree["total_files"] == 10 and tree["root_files"] == 0 and tree["total_size"] > 0

    ids = [f["id"] for f in (await batch_detail(client, td["id"]))["files"]][:2]
    r = await client.post(
        "/api/files/move", json={"ids": ids, "folder": "/ARKIB//2026/ "}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json() == {"moved": 2, "folder": "ARKIB/2026"}
    moved = (await client.get("/api/files", params={"folder": "ARKIB/2026"})).json()
    assert sorted(f["id"] for f in moved) == sorted(ids)
    bad = await client.post(
        "/api/files/move", json={"ids": ids, "folder": "../x"}, headers=csrf(client)
    )
    assert bad.status_code == 400
    missing = await client.post(
        "/api/files/move", json={"ids": ["fl_nope"], "folder": "x"}, headers=csrf(client)
    )
    assert missing.status_code == 404

    # PATCH sorts by hand: folder, kind, department.
    fid = ids[0]
    r = await client.patch(
        f"/api/files/{fid}",
        json={"folder": "A/B", "kind": "policy", "department_id": o["depts"]["Finance"]},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    f = r.json()
    assert (f["folder"], f["kind"], f["department_id"]) == ("A/B", "policy", o["depts"]["Finance"])
    r = await client.patch(f"/api/files/{fid}", json={"kind": "poem"}, headers=csrf(client))
    assert r.status_code == 400


async def test_append_files_to_a_batch_and_single_files(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
    inline_reading,  # noqa: F811
):
    o = await office(client)
    b = o["branch"]["id"]
    r = await intake(
        client, "Panduan Rondaan.txt", b"PANDUAN RONDAAN\nLangkah rondaan malam.", branch_id=b
    )
    assert r.status_code == 201, r.text
    first = r.json()
    assert (
        first["total"] == 1
        and first["status"] == "ready"
        and first["name"] == "Panduan Rondaan.txt"
    )
    r = await intake(
        client, "Borang Aduan.txt", b"BORANG ADUAN PELANGGAN", batch=first["id"], folder="HQ/Borang"
    )
    assert r.status_code == 201, r.text
    again = r.json()
    assert again["id"] == first["id"] and again["total"] == 2 and again["done"] == 2
    files = by_name((await batch_detail(client, first["id"]))["files"])
    assert files["Panduan Rondaan.txt"]["folder"] == ""
    assert files["Borang Aduan.txt"]["folder"] == "HQ/Borang"
    assert files["Borang Aduan.txt"]["kind"] == "form"
    # A re-read keeps the intake sorting (kind from KINDS, not the model's free text).
    r = await client.post(
        f"/api/files/{files['Borang Aduan.txt']['id']}/reread", json={}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["kind"] == "form" and r.json()["status"] == "ready"

    # A folder upload names each file by its relative path: the folders are kept.
    r = await intake(
        client,
        "TENDER/CARTA ALIR/Langkah 3.txt",
        b"CARTA ALIR: langkah mendapatkan nombor sebut harga",
        batch=first["id"],
    )
    assert r.status_code == 201, r.text
    files = by_name((await batch_detail(client, first["id"]))["files"])
    assert files["Langkah 3.txt"]["folder"] == "TENDER/CARTA ALIR"
    # The list can ask for the top folder only, a kind, and files with no department.
    top = (await client.get("/api/files", params={"branch_id": b, "folder": "/"})).json()
    assert {f["name"] for f in top} == {"Panduan Rondaan.txt"}
    forms = (await client.get("/api/files", params={"branch_id": b, "kind": "form"})).json()
    assert [f["name"] for f in forms] == ["Borang Aduan.txt"]
    loose = (
        await client.get("/api/files", params={"branch_id": b, "department_id": "none"})
    ).json()
    assert all(f["department_id"] is None for f in loose)

    r = await intake(client, "broken.zip", b"PK\x03\x04 broken", branch_id=b)
    assert r.status_code == 400 and r.json()["code"] == "bad_zip"
    r = await intake(client, "x.txt", b"", branch_id=b)
    assert r.status_code == 400
    r = await intake(client, "x.txt", b"x", branch_id=b, department_id="dp_nope")
    assert r.status_code == 400
    no_token = await client.post(
        "/api/intake",
        params={"name": "a.txt"},
        content=b"hi",
        headers={"content-type": "application/octet-stream"},
    )
    assert no_token.status_code == 403


async def test_the_model_sorts_unsure_files_in_the_same_call_and_never_sees_secrets(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o = await office(client)
    await client.put(
        "/api/ai/groups/fast",
        json={"members": [{"provider_id": o["provider"]["id"], "model_id": "m1"}]},
        headers=csrf(client),
    )
    llm.say(
        json.dumps(
            {
                "kind": "staff rules",
                "title": "Peraturan kakitangan",
                "summary": "Rules every staff member follows.",
                "fields": {},
                "expires_on": "",
                "category": "policy",
                "department": "Finance",
            }
        )
    )
    body = b"Notes from the meeting about how staff behave at the office and what is allowed."
    r = await intake(client, "notes.txt", body, branch_id=o["branch"]["id"])
    f = (await batch_detail(client, r.json()["id"]))["files"][0]
    assert f["kind"] == "policy" and f["department_id"] == o["depts"]["Finance"]
    assert f["library"] is True and f["title"] == "Peraturan kakitangan"
    calls = [m for m in llm.requests if "category" in m["messages"][0]["content"]]
    assert len(calls) == 1 and '"Operations"' in calls[0]["messages"][0]["content"]

    llm.say(json.dumps({"kind": "guide", "title": "Panduan", "summary": "A tender guide."}))
    await intake(client, "Panduan Tender.txt", TENDER_GUIDE.encode(), branch_id=o["branch"]["id"])
    sent = json.dumps(llm.requests[-1])
    for secret in (SECRET_PW, SECRET_LOGIN, SECRET_PIN, SECRET_ANSWER):
        assert secret not in sent
    assert "[hidden]" in sent


async def test_previews_for_every_kind_of_file(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o = await office(client)
    b = o["branch"]["id"]
    payload = {
        "Docs/a.pdf": pdf_bytes(["PDF PAGE ONE"]),
        "Docs/b.png": png_bytes(),
        "Docs/c.txt": "Teks biasa ✓".encode(),
        "Docs/d.md": b"# Tajuk\nIsi",
        "Docs/e.csv": b"a,b\n1,2\n",
        "Docs/f.docx": _docx(["PANDUAN WORD", "Isi dokumen Word."]),
        "Docs/g.xlsx": xlsx_bytes([["SENARAI SEMAK", "Ya"]]),
        "Docs/h.pptx": pptx_bytes(["SLAID PERTAMA"]),
        "Docs/i.bin": b"\x00\x01\x02binary",
        "Docs/j.tif": b"",  # replaced below with a real TIFF
    }
    from PIL import Image

    tif = io.BytesIO()
    Image.new("RGB", (20, 20), "red").save(tif, format="TIFF")
    payload["Docs/j.tif"] = tif.getvalue()
    batch = (await intake(client, "Docs.zip", make_zip(payload), branch_id=b)).json()
    files = by_name((await batch_detail(client, batch["id"]))["files"])

    async def pv(name: str) -> httpx.Response:
        r = await client.get(f"/api/files/{files[name]['id']}/preview")
        assert r.status_code == 200, (name, r.text)
        assert "sandbox" in r.headers["content-security-policy"]
        assert r.headers["content-disposition"].startswith("inline")
        return r

    r = await pv("a.pdf")
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    r = await pv("b.png")
    assert r.headers["content-type"] == "image/png" and r.content == payload["Docs/b.png"]
    r = await pv("c.txt")
    assert r.headers["content-type"].startswith("text/plain") and r.text == "Teks biasa ✓"
    assert (await pv("d.md")).text.startswith("# Tajuk")
    assert (await pv("e.csv")).headers["content-type"].startswith("text/plain")
    for name in ("f.docx", "g.xlsx", "h.pptx", "i.bin"):
        r = await pv(name)
        assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
        assert ".pdf" in r.headers["content-disposition"]
    words = extract.extract((await pv("f.docx")).content, "x.pdf").text
    assert "Text preview of f.docx" in words and "PANDUAN WORD" in words
    assert "SLAID PERTAMA" in extract.extract((await pv("h.pptx")).content, "x.pdf").text
    r = await pv("j.tif")
    assert r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")


async def test_held_back_files_preview_archive_release_and_hold_again(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o, op, td = await two_zips(client)
    b = o["branch"]["id"]
    ops = by_name((await batch_detail(client, op["id"]))["files"])
    tender = by_name((await batch_detail(client, td["id"]))["files"])
    guide, sop = tender["Panduan Tender ePerolehan.txt"], ops["SOP Kawalan Pintu Masuk.pdf"]
    operator = await as_role(client, "op@example.com", "operator")  # sees all, manages nothing
    try:
        # Managers preview it, with a banner; others are refused, and get no text.
        r = await client.get(f"/api/files/{guide['id']}/preview")
        assert r.status_code == 200 and r.text.startswith("HELD BACK FOR REVIEW")
        letters = ops["Contoh Surat Amaran.docx"]
        r = await client.get(f"/api/files/{letters['id']}/preview")
        assert "HELD BACK FOR REVIEW" in extract.extract(r.content, "x.pdf").text
        assert (await operator.get(f"/api/files/{guide['id']}/preview")).status_code == 403
        assert (await operator.get(f"/api/files/{guide['id']}/download")).status_code == 403
        assert (await operator.get(f"/api/files/{guide['id']}")).json()["text"] is None
        assert SECRET_PW in (await client.get(f"/api/files/{guide['id']}")).json()["text"]

        # Archives: folders kept; held-back files only for managers.
        r = await client.get("/api/files/archive", params={"branch_id": b})
        assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
        assert r.headers["x-held-back"] == "0"
        assert "Maju%20Sdn%20Bhd%20-%20All%20files.zip" in r.headers["content-disposition"]
        names = set(zipfile.ZipFile(io.BytesIO(r.content)).namelist())
        assert "OPERASI/SOP/SOP Kawalan Pintu Masuk.pdf" in names
        assert "TENDER/CARTA ALIR/Carta Alir Tender.png" in names
        assert "TENDER/Panduan Tender ePerolehan.txt" in names and len(names) == 10
        z = zipfile.ZipFile(io.BytesIO(r.content))
        assert z.read("TENDER/Panduan Tender ePerolehan.txt") == TENDER_GUIDE.encode()

        r = await operator.get(
            "/api/files/archive", params={"branch_id": b, "folder": "OPERASI/SOP"}
        )
        assert r.status_code == 200 and r.headers["x-held-back"] == "1"
        assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == [
            "SOP/SOP Kawalan Pintu Masuk.pdf"
        ]
        r = await operator.get("/api/files/archive", params={"batch_id": td["id"]})
        names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
        assert len(names) == 4 and not any("Panduan" in n for n in names)
        assert "TENDER.zip" in r.headers["content-disposition"]
        r = await operator.get("/api/files/archive", params={"ids": f"{sop['id']},{guide['id']}"})
        assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == [
            "OPERASI/SOP/SOP Kawalan Pintu Masuk.pdf"
        ]

        # Release: managers only, audited, the scan record kept, then it joins the library.
        r = await operator.post(
            f"/api/files/{guide['id']}/release", json={"reason": "checked"}, headers=csrf(operator)
        )
        assert r.status_code == 403
        r = await client.post(
            f"/api/files/{guide['id']}/release",
            json={"reason": "Passwords changed already"},
            headers=csrf(client),
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["quarantined"] is False and out["library"] is True
        assert out["sensitive"]["credentials"] and out["sensitive"]["released"] is True
        assert out["sensitive"]["reviewed_by"].startswith("user:")
        assert out["sensitive"]["review_reason"] == "Passwords changed already"
        assert await passages(guide["id"]) >= 1
        again = await client.post(
            f"/api/files/{guide['id']}/release", json={"reason": "again"}, headers=csrf(client)
        )
        assert again.status_code == 400

        # Hold back again (anyone who may change it): its passages go at once.
        r = await operator.post(
            f"/api/files/{sop['id']}/quarantine",
            json={"reason": "has a phone list"},
            headers=csrf(operator),
        )
        assert r.status_code == 200 and r.json()["quarantined"] is True
        assert await passages(sop["id"]) == 0
        async with SessionLocal() as db:
            actions = (
                await db.scalars(
                    select(AuditLog.action).where(AuditLog.target.in_([guide["id"], sop["id"]]))
                )
            ).all()
        assert "file.released" in actions and "file.held_back" in actions
    finally:
        await operator.aclose()


async def test_agents_see_a_catalog_and_never_held_back_files(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    from agentic.agents.company_tools import _company_documents
    from agentic.agents.doc_tools import _list_files, _read_file, _view_image
    from agentic.agents.library_tools import _search_library
    from agentic.agents.tools import TOOLS, ToolContext
    from agentic.models import Agent, Workspace

    o, op, td = await two_zips(client)
    agent = await new_agent(client, o, "Aina", "Operations")
    ops = by_name((await batch_detail(client, op["id"]))["files"])
    tender = by_name((await batch_detail(client, td["id"]))["files"])
    guide, sop = tender["Panduan Tender ePerolehan.txt"], ops["SOP Kawalan Pintu Masuk.pdf"]
    assert TOOLS["company_documents"].default_mode == "allow"
    assert TOOLS["company_documents"].risk == "low"
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        assert a is not None
        ws = await db.get(Workspace, a.workspace_id)
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)  # type: ignore[arg-type]

        cat = await _company_documents(ctx, {})
        assert "Company documents of Maju Sdn Bhd: 8 file(s)" in cat and "2 held back" in cat
        assert "- OPERASI/SOP — 1: sop 1" in cat
        assert f"[{sop['id']}] OPERASI/SOP/SOP Kawalan Pintu Masuk.pdf — sop · Operations" in cat
        assert "2 file(s) held back for review" in cat
        for hidden in ("Panduan Tender ePerolehan", "Contoh Surat Amaran", SECRET_PW, ICS[0]):
            assert hidden not in cat
        sops = await _company_documents(ctx, {"kind": "sop"})
        assert "(1 of 1)" in sops and "Senarai Tugas" not in sops
        under = await _company_documents(ctx, {"folder": "TENDER", "query": "sijil"})
        assert "Sijil SSM.pdf" in under and "Kontrak" not in under

        listed = await _list_files(ctx, {})
        assert "Panduan Tender" not in listed and "held back for review" in listed
        assert "held back for review" in await _read_file(ctx, {"file_id": guide["id"]})
        assert "held back for review" in await _view_image(ctx, {"file_id": guide["id"]})
        assert "memeriksa" in await _read_file(ctx, {"file_id": sop["id"]})
        assert "SOP Kawalan" in await _search_library(
            ctx, {"query": "pengawal memeriksa pas pelawat"}
        )

    # Held back after it was indexed: gone from search at once.
    await client.post(
        f"/api/files/{sop['id']}/quarantine", json={"reason": "check"}, headers=csrf(client)
    )
    async with SessionLocal() as db:
        a = await db.get(Agent, agent["id"])
        ws = await db.get(Workspace, a.workspace_id)  # type: ignore[union-attr]
        ctx = ToolContext(db=db, agent=a, workspace=ws, task=None)  # type: ignore[arg-type]
        found = await _search_library(ctx, {"query": "pengawal memeriksa pas pelawat"})
        assert "SOP Kawalan" not in found
        assert "held back for review" in await _read_file(ctx, {"file_id": sop["id"]})
    hits = (await client.get("/api/library/search", params={"q": "pengawal memeriksa pas"})).json()
    assert all(h["source_id"] != sop["id"] for h in hits)


async def test_branch_managers_stay_inside_their_company(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    o, op, td = await two_zips(client)
    a = o["branch"]["id"]
    b2 = (
        await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    ).json()
    bm = await as_role(client, "bm2@example.com", "branch_manager", branch_id=b2["id"])
    try:
        sop = by_name((await batch_detail(client, op["id"]))["files"])[
            "SOP Kawalan Pintu Masuk.pdf"
        ]
        assert (await bm.get(f"/api/intake/{op['id']}")).status_code == 404
        assert (await bm.get("/api/intake")).json() == []
        assert (await bm.get(f"/api/files/{sop['id']}/preview")).status_code == 404
        tree = (await bm.get("/api/files/tree", params={"branch_id": a})).json()
        assert tree["folders"] == [] and tree["total_files"] == 0
        assert (await bm.get("/api/files/archive", params={"branch_id": a})).status_code == 400
        assert (await bm.get("/api/files/archive", params={"ids": sop["id"]})).status_code == 404
        r = await bm.post(
            "/api/files/move", json={"ids": [sop["id"]], "folder": "x"}, headers=csrf(bm)
        )
        assert r.status_code == 404
        r = await intake(bm, "x.txt", b"PANDUAN", branch_id=a)
        assert r.status_code in (400, 403)
        r = await intake(bm, "x.txt", b"PANDUAN", batch=op["id"])
        assert r.status_code == 404

        # Their own company works, and they release what is held back there.
        r = await intake(bm, "TENDER.zip", tender_zip())
        assert r.status_code == 201, r.text
        mine = r.json()
        assert mine["branch_id"] == b2["id"] and mine["status"] == "ready"
        assert [x["id"] for x in (await bm.get("/api/intake")).json()] == [mine["id"]]
        tree = (await bm.get("/api/files/tree", params={"branch_id": b2["id"]})).json()
        assert tree["total_files"] == 5
        held = by_name((await batch_detail(bm, mine["id"]))["files"])[
            "Panduan Tender ePerolehan.txt"
        ]
        r = await bm.post(
            f"/api/files/{held['id']}/release", json={"reason": "ok now"}, headers=csrf(bm)
        )
        assert r.status_code == 200 and r.json()["quarantined"] is False
    finally:
        await bm.aclose()


async def test_intake_events_reach_the_company_only():
    from agentic.api.scope import Scope

    data = {"batch_id": "ib_1", "branch_id": "br_a", "status": "ready"}
    assert Scope("all", "u").event_visible("intake.updated", data, set())
    assert Scope("branch", "u", "br_a").event_visible("intake.updated", data, set())
    assert not Scope("branch", "u", "br_b").event_visible("intake.updated", data, set())
    assert not Scope("own", "u", None).event_visible("intake.updated", data, set())


async def test_worker_runs_the_batch_and_appends_poke_it(monkeypatch):
    """The workflow's activities are the pipeline's steps; a running batch is poked."""
    from agentic.workflows import intake_activities, intake_workflows, worker

    assert intake_workflows.IntakeWorkflow in worker.WORKFLOWS
    for act in (
        intake_activities.intake_pending,
        intake_activities.intake_read,
        intake_activities.intake_finish,
        intake_activities.intake_fail,
    ):
        assert act in worker.ACTIVITIES

    from temporalio.exceptions import WorkflowAlreadyStartedError

    signals: list[str] = []

    class Handle:
        async def signal(self, sig):
            signals.append(sig.__name__)

    class Client:
        async def start_workflow(self, *a, **kw):
            raise WorkflowAlreadyStartedError(kw["id"], "IntakeWorkflow")

        def get_workflow_handle(self, wid):
            assert wid == "intake-ib_x"
            return Handle()

    async def fake_client():
        return Client()

    monkeypatch.setattr(dispatch, "temporal_client", fake_client)
    await dispatch.start_intake("ib_x")
    assert signals == ["poke"]


@pytest.mark.skipif(not extract.ocr_available(), reason="Tesseract (OCR) is not installed here")
async def test_a_scanned_flowchart_is_read_by_ocr(
    client,
    llm,  # noqa: F811
    temporal,  # noqa: F811
    intake_inline,
    indexing,  # noqa: F811
):
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1600, 400), "white")
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 72)
    except OSError:
        font = ImageFont.load_default(size=72)
    ImageDraw.Draw(img).text((40, 150), "CARTA ALIR TENDER", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    o = await office(client)
    r = await intake(client, "proses.png", buf.getvalue(), branch_id=o["branch"]["id"])
    f = (await batch_detail(client, r.json()["id"]))["files"][0]
    assert f["ocr"] is True and f["kind"] == "flowchart"
    full = (await client.get(f"/api/files/{f['id']}")).json()
    assert "CARTA" in full["text"].upper()


def test_department_named_for_the_topic_wins_a_tie():
    depts = [
        sort.Dept("d_sales", "Sales & Marketing"),
        sort.Dept("d_ops", "Operations"),
        sort.Dept("d_tender", "Tender & Procurement"),
    ]
    assert (
        sort.department_of(
            depts, "4_TATACARA SELEPAS PENGHANTARAN TENDER.pdf", "TENDER HQ", ""
        )
        == "d_tender"
    )
    assert sort.department_of(depts, "Brosur jualan.pdf", "MARKETING", "") == "d_sales"
    assert sort.department_of(depts, "SOP rondaan.pdf", "UNIT OPERASI MELAKA", "") == "d_ops"
