"""P61 Library: copying files, folders that exist while empty, labels, the in-place view of
Excel / CSV / Word / text, and inline downloads that never show HTML."""

import io

import httpx

from agentic.documents import render_pdf, viewer

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_documents import inline_reading, upload  # noqa: F401
from .test_office_roles import as_role

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00"
    b"\x00\x00\x00IEND\xaeB`\x82"
)


def _xlsx() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    ws.append(["Item", "Qty", "Price"])
    ws.append(["Kopi", 2, 3.5])
    ws.append(["<script>x</script>", None, 10])
    other = wb.create_sheet("Big")
    for i in range(viewer.MAX_ROWS + 20):
        other.append([i] * (viewer.MAX_COLS + 5))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _docx() -> bytes:
    from docx import Document

    d = Document()
    d.add_heading("Quarterly <report>", level=1)
    p = d.add_paragraph("Plain ")
    p.add_run("bold").bold = True
    p.add_run(" and ")
    p.add_run("italic").italic = True
    d.add_paragraph("first point", style="List Bullet")
    d.add_paragraph("second point", style="List Bullet")
    d.add_paragraph("step one", style="List Number")
    d.add_paragraph('<img src=x onerror="alert(1)">')
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "Name", "Total"
    t.cell(1, 0).text, t.cell(1, 1).text = "Aina & Co", "RM 10"
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


async def post_file(c: httpx.AsyncClient, name: str, data: bytes, mime: str = "") -> dict:
    r = await c.post(
        "/api/files",
        params={"name": name},
        content=data,
        headers={**csrf(c), "content-type": "application/octet-stream", "x-file-type": mime},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def move(c: httpx.AsyncClient, ids: list[str], folder: str) -> None:
    r = await c.post("/api/files/move", json={"ids": ids, "folder": folder}, headers=csrf(c))
    assert r.status_code == 200, r.text


async def tree(c: httpx.AsyncClient, **params) -> dict[str, dict]:
    r = await c.get("/api/files/tree", params=params)
    assert r.status_code == 200, r.text
    return {f["path"]: f for f in r.json()["folders"]}


# ================================================================ the viewer (pure)


def test_viewer_tables_from_excel_and_csv():
    out = viewer.view(_xlsx(), "sales.xlsx")
    assert out["type"] == "table" and [s["name"] for s in out["sheets"]] == ["Sales", "Big"]
    sales, big = out["sheets"]
    assert sales["rows"][0] == ["Item", "Qty", "Price"]
    assert sales["rows"][1] == ["Kopi", 2, 3.5] and sales["rows"][2][1] is None
    assert sales["columns"] == 3 and sales["truncated"] is False
    assert len(big["rows"]) == viewer.MAX_ROWS and big["columns"] == viewer.MAX_COLS
    assert big["truncated"] is True

    semi = viewer.view(b"a;b;c\n1;2;3\n4;;6\n", "x.csv")
    assert semi["type"] == "table" and semi["sheets"][0]["rows"] == [
        ["a", "b", "c"],
        ["1", "2", "3"],
        ["4", None, "6"],
    ]
    tsv = viewer.view("nama\tbandar\nAina\tKL\n".encode("cp1252"), "x.tsv")
    assert tsv["sheets"][0]["rows"][1] == ["Aina", "KL"]
    latin = viewer.view("caf\xe9,1\n".encode("cp1252"), "y.csv")
    assert latin["sheets"][0]["rows"][0] == ["caf\xe9", "1"]
    # An old .xls openpyxl cannot read: the read text instead, or nothing.
    assert viewer.view(b"\xd0\xcf\x11\xe0junk", "old.xls", text="A1 B1") == {
        "type": "text",
        "text": "A1 B1",
    }
    assert viewer.view(b"\xd0\xcf\x11\xe0junk", "old.xls") == {"type": "none"}


def test_viewer_word_is_escaped_html_with_only_safe_tags():
    import re

    out = viewer.view(_docx(), "report.docx")
    assert out["type"] == "html"
    h = out["html"]
    assert "<h1>Quarterly &lt;report&gt;</h1>" in h
    assert "<p>Plain <strong>bold</strong> and <em>italic</em></p>" in h
    assert "<ul><li>first point</li><li>second point</li></ul><ol><li>step one</li></ol>" in h
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in h and "<img" not in h
    assert "<thead><tr><th>Name</th><th>Total</th></tr></thead>" in h
    assert "<td>Aina &amp; Co</td>" in h
    allowed = set("h1 h2 h3 h4 p strong em ul ol li table thead tbody tr th td section hr".split())
    assert set(re.findall(r"</?([a-z0-9]+)", h)) <= allowed


def test_viewer_text_pdf_image_media_and_none():
    assert viewer.view(b"hello\nworld", "notes.txt") == {"type": "text", "text": "hello\nworld"}
    assert viewer.view(b'{"a": 1}', "data.json")["type"] == "text"
    assert viewer.view(b"<b>hi</b>", "page.html") == {"type": "text", "text": "<b>hi</b>"}
    long = viewer.view(b"x" * (viewer.MAX_TEXT + 10), "big.log")
    assert len(long["text"]) == viewer.MAX_TEXT
    pdf = render_pdf.render("Hello", "Doc")
    assert viewer.view(pdf, "a.pdf", "application/pdf") == {"type": "pdf"}
    assert viewer.view(PNG, "a.png", "image/png") == {"type": "image"}
    assert viewer.view(b"ID3....", "song.mp3") == {"type": "media", "mime": "audio/mpeg"}
    assert viewer.view(b"\x00\x00", "clip.bin", "video/mp4") == {
        "type": "media",
        "mime": "video/mp4",
    }
    assert viewer.view(b"\x00\x01\x02", "blob.bin") == {"type": "none"}
    assert viewer.view(b"\x00\x01\x02", "blob.bin", text="read text") == {
        "type": "text",
        "text": "read text",
    }
    # A media type that carries markup is never one to play.
    assert viewer.media_mime("x.bin", "video/svg+xml") is None


# ================================================================ copy


async def test_copy_files_bytes_names_scope_and_held_back(client, llm, temporal, inline_reading):
    o = await office(client)
    a = await post_file(client, "notes.txt", b"the notes")
    b = await post_file(client, "plan.txt", b"the plan")
    await move(client, [a["id"], b["id"]], "Src")
    r = await client.patch(
        f"/api/files/{a['id']}", json={"labels": ["urgent"]}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        "/api/files/copy", json={"ids": [a["id"], b["id"]], "folder": "Dest"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["copied"] == 2 and len(out["ids"]) == 2 and out["skipped"] == []
    c1 = (await client.get(f"/api/files/{out['ids'][0]}")).json()
    assert c1["name"] == "notes.txt" and c1["folder"] == "Dest" and c1["origin"] == "person"
    assert c1["labels"] == ["urgent"] and c1["id"] != a["id"]
    assert "the notes" in (c1["text"] or "")
    dl = await client.get(f"/api/files/{c1['id']}/download")
    assert dl.content == b"the notes"

    # A second copy into the same folder gets "(copy)", then "(copy 2)".
    again = (
        await client.post(
            "/api/files/copy",
            json={"ids": [a["id"], a["id"]], "folder": "Dest"},
            headers=csrf(client),
        )
    ).json()
    assert again["copied"] == 1  # the same id twice is one copy
    names = {(await client.get(f"/api/files/{i}")).json()["name"] for i in again["ids"]}
    assert names == {"notes (copy).txt"}
    third = (
        await client.post(
            "/api/files/copy", json={"ids": [a["id"]], "folder": "Dest"}, headers=csrf(client)
        )
    ).json()
    assert (await client.get(f"/api/files/{third['ids'][0]}")).json()["name"] == (
        "notes (copy 2).txt"
    )

    # Held back: refused and reported, the rest still copied.
    r = await client.post(
        f"/api/files/{b['id']}/quarantine", json={"reason": "check it"}, headers=csrf(client)
    )
    assert r.status_code == 200
    held = (
        await client.post(
            "/api/files/copy",
            json={"ids": [b["id"], a["id"]], "folder": "Other"},
            headers=csrf(client),
        )
    ).json()
    assert held["copied"] == 1 and held["skipped"] == [b["id"]]

    # Someone else's file is not there for a staff member; their own copy is theirs.
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    r = await staff.post(
        "/api/files/copy", json={"ids": [a["id"]], "folder": ""}, headers=csrf(staff)
    )
    assert r.status_code == 404
    own = await post_file(staff, "mine.txt", b"mine")
    r = await staff.post(
        "/api/files/copy", json={"ids": [own["id"]], "folder": "x"}, headers=csrf(staff)
    )
    assert r.status_code == 200 and r.json()["copied"] == 1
    assert r.json()["ids"][0] in {f["id"] for f in (await staff.get("/api/files")).json()}
    bad = await client.post("/api/files/copy", json={"ids": [], "folder": ""}, headers=csrf(client))
    assert bad.status_code == 422


# ================================================================ folders


async def test_folders_create_rename_move_and_delete(client, llm, temporal, inline_reading):
    o = await office(client)
    r = await client.post(
        "/api/files/folders", json={"path": "/Projects//Empty/"}, headers=csrf(client)
    )
    assert r.status_code == 201 and r.json() == {"path": "Projects/Empty", "branch_id": None}
    t = await tree(client)
    assert t["Projects/Empty"]["files"] == 0 and "Projects" in t
    again = await client.post(
        "/api/files/folders", json={"path": "Projects/Empty"}, headers=csrf(client)
    )
    assert again.status_code == 409
    noname = await client.post("/api/files/folders", json={"path": " / "}, headers=csrf(client))
    assert noname.status_code == 422

    # Files go in: the folder is listed once, with its count.
    f1 = await post_file(client, "one.txt", b"1")
    f2 = await post_file(client, "two.txt", b"2")
    f3 = await post_file(client, "three.txt", b"3")
    await move(client, [f1["id"]], "Projects/Empty")
    await move(client, [f2["id"]], "A")
    await move(client, [f3["id"]], "A/B")
    r = await client.post("/api/files/folders", json={"path": "A"}, headers=csrf(client))
    assert r.status_code == 409  # it has files
    await client.post("/api/files/folders", json={"path": "A/C"}, headers=csrf(client))
    r = await client.get("/api/files/tree")
    paths = [f["path"] for f in r.json()["folders"]]
    assert paths.count("Projects/Empty") == 1
    assert {f["path"]: f["files"] for f in r.json()["folders"]}["Projects/Empty"] == 1

    # Rename / move: everything under it follows, the empty sub-folder too.
    into = await client.post(
        "/api/files/folders/rename", json={"path": "A", "to": "A/B/deeper"}, headers=csrf(client)
    )
    assert into.status_code == 422
    same = await client.post(
        "/api/files/folders/rename", json={"path": "A", "to": "A"}, headers=csrf(client)
    )
    assert same.status_code == 422
    r = await client.post(
        "/api/files/folders/rename", json={"path": "A", "to": "Z/A"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json() == {"moved": 2}
    t = await tree(client)
    assert {"Z", "Z/A", "Z/A/B", "Z/A/C"} <= set(t) and "A" not in t and "A/C" not in t
    assert t["Z/A"]["files"] == 2 and t["Z/A/B"]["direct"] == 1
    assert (await client.get(f"/api/files/{f3['id']}")).json()["folder"] == "Z/A/B"
    missing = await client.post(
        "/api/files/folders/rename", json={"path": "Nope", "to": "Q"}, headers=csrf(client)
    )
    assert missing.status_code == 404

    # Delete: refused while anything is inside; an empty one goes, with its empty children.
    r = await client.post("/api/files/folders/delete", json={"path": "Z/A"}, headers=csrf(client))
    assert r.status_code == 409
    r = await client.post("/api/files/folders/delete", json={"path": "Z/A/C"}, headers=csrf(client))
    assert r.status_code == 204
    await client.post("/api/files/folders", json={"path": "Empty/Inner"}, headers=csrf(client))
    r = await client.post("/api/files/folders/delete", json={"path": "Empty"}, headers=csrf(client))
    assert r.status_code == 204
    t = await tree(client)
    assert "Z/A/C" not in t and "Empty" not in t and "Empty/Inner" not in t

    # Another person's file counts too, even though they cannot see it.
    staff = await as_role(client, "staff2@example.com", "staff", branch_id=o["branch"]["id"])
    await client.post("/api/files/folders", json={"path": "Shared"}, headers=csrf(client))
    s = await post_file(staff, "s.txt", b"s")
    await move(staff, [s["id"]], "Shared")
    r = await client.post(
        "/api/files/folders/delete", json={"path": "Shared"}, headers=csrf(client)
    )
    assert r.status_code == 409


async def test_folders_by_company(client, llm, temporal, inline_reading):
    o = await office(client)
    bid = o["branch"]["id"]
    r = await client.post(
        "/api/files/folders", json={"path": "HQ only", "branch_id": bid}, headers=csrf(client)
    )
    assert r.status_code == 201
    assert "HQ only" in await tree(client, branch_id=bid)
    b2 = (await client.post("/api/branches", json={"name": "Jaya"}, headers=csrf(client))).json()
    assert "HQ only" not in await tree(client, branch_id=b2["id"])
    manager = await as_role(client, "bm@example.com", "branch_manager", branch_id=b2["id"])
    assert "HQ only" not in await tree(manager)


# ================================================================ labels


async def test_labels_patch_bulk_filter_and_counts(client, llm, temporal, inline_reading):
    o = await office(client)
    a = await post_file(client, "a.txt", b"a")
    b = await post_file(client, "b.txt", b"b")
    r = await client.patch(
        f"/api/files/{a['id']}",
        json={"labels": ["  Urgent ", "urgent", "Q3", "Q3"]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["labels"] == ["Urgent", "Q3"]
    too_long = await client.patch(
        f"/api/files/{a['id']}", json={"labels": ["x" * 31]}, headers=csrf(client)
    )
    assert too_long.status_code == 422
    empty = await client.patch(
        f"/api/files/{a['id']}", json={"labels": ["  "]}, headers=csrf(client)
    )
    assert empty.status_code == 422
    many = await client.patch(
        f"/api/files/{a['id']}", json={"labels": [f"l{i}" for i in range(13)]}, headers=csrf(client)
    )
    assert many.status_code == 422
    assert (await client.get(f"/api/files/{a['id']}")).json()["labels"] == ["Urgent", "Q3"]

    r = await client.post(
        "/api/files/labels",
        json={"ids": [a["id"], b["id"]], "add": ["Audit"], "remove": ["q3"]},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json() == {"updated": 2}
    assert (await client.get(f"/api/files/{a['id']}")).json()["labels"] == ["Urgent", "Audit"]
    assert (await client.get(f"/api/files/{b['id']}")).json()["labels"] == ["Audit"]

    listed = (await client.get("/api/files", params={"label": "Audit"})).json()
    assert {f["id"] for f in listed} == {a["id"], b["id"]}
    assert all("origin" in f and "labels" in f for f in listed)
    only = (await client.get("/api/files", params={"label": "Urgent"})).json()
    assert [f["id"] for f in only] == [a["id"]]
    counts = (await client.get("/api/files/labels")).json()
    assert counts == [{"label": "Audit", "count": 2}, {"label": "Urgent", "count": 1}]

    # A staff member counts only the files they see.
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    assert (await staff.get("/api/files/labels")).json() == []
    r = await staff.post(
        "/api/files/labels", json={"ids": [a["id"]], "add": ["x"]}, headers=csrf(staff)
    )
    assert r.status_code == 404


# ================================================================ view and inline downloads


async def test_view_endpoint_and_inline_downloads(client, llm, temporal, inline_reading):
    o = await office(client)
    xlsx = await post_file(client, "sales.xlsx", _xlsx())
    r = await client.get(f"/api/files/{xlsx['id']}/view")
    assert r.status_code == 200 and r.json()["type"] == "table"
    assert r.json()["sheets"][0]["rows"][1] == ["Kopi", 2, 3.5]
    csv = await post_file(client, "list.csv", b"name,city\nAina,KL\n")
    assert (await client.get(f"/api/files/{csv['id']}/view")).json()["sheets"][0]["rows"] == [
        ["name", "city"],
        ["Aina", "KL"],
    ]
    doc = await post_file(client, "report.docx", _docx())
    h = (await client.get(f"/api/files/{doc['id']}/view")).json()
    assert h["type"] == "html" and "<strong>bold</strong>" in h["html"]
    txt = await post_file(client, "notes.txt", b"plain words")
    assert (await client.get(f"/api/files/{txt['id']}/view")).json() == {
        "type": "text",
        "text": "plain words",
    }
    pdf_bytes = render_pdf.render("Hello there", "Doc")
    pdf = await post_file(client, "a.pdf", pdf_bytes, "application/pdf")
    assert (await client.get(f"/api/files/{pdf['id']}/view")).json() == {"type": "pdf"}
    img = await post_file(client, "dot.png", PNG, "image/png")
    assert (await client.get(f"/api/files/{img['id']}/view")).json() == {"type": "image"}

    # Inline only when asked, and only for PDFs, pictures, audio and video.
    dl = await client.get(f"/api/files/{pdf['id']}/download", params={"inline": 1})
    assert dl.headers["content-disposition"].startswith("inline")
    assert dl.headers["content-type"] == "application/pdf" and dl.content == pdf_bytes
    dl = await client.get(f"/api/files/{pdf['id']}/download")
    assert dl.headers["content-disposition"].startswith("attachment")
    dl = await client.get(f"/api/files/{img['id']}/download", params={"inline": "1"})
    assert dl.headers["content-disposition"].startswith("inline")
    song = await post_file(client, "song.mp3", b"ID3fake", "audio/mpeg")
    dl = await client.get(f"/api/files/{song['id']}/download", params={"inline": 1})
    assert dl.headers["content-disposition"].startswith("inline")
    assert dl.headers["content-type"] == "audio/mpeg"
    assert (await client.get(f"/api/files/{song['id']}/view")).json() == {
        "type": "media",
        "mime": "audio/mpeg",
    }
    for name, body, mime in (
        ("page.html", b"<script>alert(1)</script>", "text/html"),
        ("pic.svg", b"<svg onload='alert(1)'/>", "image/svg+xml"),
        ("feed.xml", b"<x/>", "application/xml"),
        ("trick.html", b"<script>alert(1)</script>", "audio/mpeg; html"),
    ):
        f = await post_file(client, name, body, mime)
        dl = await client.get(f"/api/files/{f['id']}/download", params={"inline": 1})
        assert dl.headers["content-disposition"].startswith("attachment"), name
        assert dl.headers["content-type"] == "application/octet-stream", name
        assert dl.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in dl.headers["content-security-policy"]

    # Held back: 403 for people who do not manage files, as /preview.
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    mine = await post_file(staff, "secret.txt", b"pw")
    r = await staff.post(
        f"/api/files/{mine['id']}/quarantine",
        json={"reason": "has a password"},
        headers=csrf(staff),
    )
    assert r.status_code == 200
    assert (await staff.get(f"/api/files/{mine['id']}/view")).status_code == 403
    assert (await staff.get(f"/api/files/{mine['id']}/preview")).status_code == 403
    assert (await staff.get(f"/api/files/{xlsx['id']}/view")).status_code == 404
    assert (await client.get(f"/api/files/{mine['id']}/view")).json()["type"] == "text"
