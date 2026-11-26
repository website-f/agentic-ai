"""P140: agents edit Word, Excel, PDF and PowerPoint files with structured operations (a new
file next to the original, never the original), and a routine learned from a document job
replays on the next attached file, chaining the files its steps make, without a model."""

import hashlib
import io
import json
import re
import zipfile

import pytest
from sqlalchemy import select

from agentic.agents import runtime
from agentic.agents.tools import TOOLS, ToolContext
from agentic.core.db import SessionLocal
from agentic.documents import service, storage
from agentic.models import Agent, BrainFact, DocFile, Routine, Task, TaskEvent, Workspace
from agentic.skills import routines

from .conftest import csrf
from .test_agents import llm, new_agent, new_task, office, temporal  # noqa: F401

SAVED = re.compile(r"Saved \[(fl_[0-9a-z]+)\] (.+?) \(folder")
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


@pytest.fixture
def loose(monkeypatch):
    """Word-hash embeddings in tests score paraphrases lower than the real model."""
    monkeypatch.setattr(routines, "MATCH", 0.6)
    monkeypatch.setattr(routines, "CONFIRM", 0.6)


# ---------------------------------------------------------------- small files


def _docx() -> bytes:
    from docx import Document

    d = Document()
    p = d.add_paragraph("This agreement is between ")
    p.add_run("ACME").bold = True
    p.add_run(" Sdn Bhd and AC").italic = True
    p.add_run("ME Trading.")
    d.add_paragraph("DRAFT - remove before signing")
    d.add_paragraph("Payment terms: 30 days.")
    t = d.add_table(rows=2, cols=2)
    for r, row in enumerate([["Item", "Qty"], ["Pen", "3"]]):
        for c, v in enumerate(row):
            t.cell(r, c).text = v
    d.sections[0].header.paragraphs[0].text = "ACME confidential"
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def _xlsx() -> bytes:
    import openpyxl
    from openpyxl.styles import Font

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Claims"
    ws.append(["Date", "Item", "Amount"])
    ws.append(["2026-10-03", "Grab", 23.5])
    ws["C2"].font = Font(bold=True)
    ws["E1"] = "=SUM(C2:C50)"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _pdf(pages: int, label: str = "Page") -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    for i in range(pages):
        pdf.add_page()
        pdf.set_font("helvetica", size=18)
        pdf.text(20, 30, f"{label} body {i + 1}")
    return bytes(pdf.output())


def _form_pdf() -> bytes:
    from pypdf import PdfWriter
    from pypdf.generic import (
        ArrayObject,
        DictionaryObject,
        FloatObject,
        NameObject,
        NumberObject,
        TextStringObject,
    )

    w = PdfWriter()
    page = w.add_blank_page(300, 300)
    font = w._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
    )
    field = w._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Tx"),
                NameObject("/T"): TextStringObject("Nama"),
                NameObject("/Rect"): ArrayObject([FloatObject(x) for x in (50, 200, 250, 220)]),
                NameObject("/F"): NumberObject(4),
                NameObject("/DA"): TextStringObject("/Helv 12 Tf 0 g"),
                NameObject("/P"): page.indirect_reference,
            }
        )
    )
    page[NameObject("/Annots")] = ArrayObject([field])
    w._root_object[NameObject("/AcroForm")] = DictionaryObject(
        {
            NameObject("/Fields"): ArrayObject([field]),
            NameObject("/DA"): TextStringObject("/Helv 0 Tf 0 g"),
            NameObject("/DR"): DictionaryObject(
                {NameObject("/Font"): DictionaryObject({NameObject("/Helv"): font})}
            ),
        }
    )
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def _slide(paragraphs: list[list[str]]) -> bytes:
    body = "".join(
        "<a:p>" + "".join(f'<a:r><a:rPr b="1"/><a:t>{t}</a:t></a:r>' for t in runs) + "</a:p>"
        for runs in paragraphs
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<p:sld xmlns:a="{A_NS}" '
        'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
        f"<p:cSld><p:spTree><p:sp><p:txBody>{body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
    ).encode()


def _pptx() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("ppt/presentation.xml", "<p:presentation/>")
        z.writestr("ppt/slides/slide1.xml", _slide([["Q3 results for ", "Acme"], ["Up 12%"]]))
        z.writestr("ppt/slides/slide2.xml", _slide([["Thank you Ac", "me team"]]))
        z.writestr("ppt/media/image1.png", b"\x89PNG not really a picture")
    return out.getvalue()


# ---------------------------------------------------------------- helpers


async def _put(
    ws_id: str,
    branch_id: str | None,
    name: str,
    data: bytes,
    *,
    task_id: str | None = None,
    folder: str = "",
) -> str:
    async with SessionLocal() as db:
        f = await service.create_file(
            db,
            workspace_id=ws_id,
            name=name,
            data=data,
            created_by="system:test",
            branch_id=branch_id,
            task_id=task_id,
            source="upload",
            status="ready",
            folder=folder,
        )
        await db.commit()
        return f.id


async def _bytes(file_id: str) -> bytes:
    async with SessionLocal() as db:
        f = await db.get(DocFile, file_id)
        return await storage.read(db, f)


async def _sha(file_id: str) -> str:
    return hashlib.sha256(await _bytes(file_id)).hexdigest()


async def _tool(agent_id: str, name: str, args: dict, task_id: str | None = None) -> str:
    async with SessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        ws = await db.get(Workspace, agent.workspace_id)
        task = await db.get(Task, task_id) if task_id else None
        ctx = ToolContext(db=db, agent=agent, workspace=ws, task=task)
        return await TOOLS[name].handler(ctx, args)


def _made(out: str) -> tuple[str, str]:
    m = SAVED.search(out)
    assert m, out
    return m.group(1), m.group(2)


async def _setup(client) -> tuple[dict, dict, str]:
    o = await office(client)
    agent = await new_agent(client, o, "Rina", "Operations")
    async with SessionLocal() as db:
        ws = (await db.get(Agent, agent["id"])).workspace_id
    return o, agent, ws


async def _count_files() -> int:
    async with SessionLocal() as db:
        return len((await db.scalars(select(DocFile.id))).all())


# ---------------------------------------------------------------- Word


async def test_word_edits_keep_the_formatting_and_never_touch_the_original(client, llm, temporal):
    o, agent, ws = await _setup(client)
    src = await _put(ws, o["branch"]["id"], "Contract.docx", _docx(), folder="Legal/Contracts")
    before = await _sha(src)
    out = await _tool(
        agent["id"],
        "docx_edit",
        {
            "file_id": src,
            "operations": [
                {"op": "replace_text", "find": "ACME", "replace": "Globex"},
                {"op": "delete_paragraph_containing", "text": "DRAFT"},
                {"op": "insert_paragraph_after", "anchor_text": "Payment", "text": "Late fee 1%."},
                {"op": "append_paragraph", "text": "Signed for Globex."},
                {"op": "set_table_cell", "table_index": 1, "row": 2, "col": 2, "text": "5"},
                {"op": "add_table_row", "table_index": 1, "values": ["Ink", "2"]},
            ],
        },
    )
    new_id, name = _made(out)
    assert name == "Contract (edited).docx" and "the original is unchanged" in out
    assert "replaced 'ACME' with 'Globex' (3x)" in out  # body (twice, one across runs) + header
    assert await _sha(src) == before  # the original is never changed

    from docx import Document

    d = Document(io.BytesIO(await _bytes(new_id)))
    texts = [p.text for p in d.paragraphs]
    assert texts == [
        "This agreement is between Globex Sdn Bhd and Globex Trading.",
        "Payment terms: 30 days.",
        "Late fee 1%.",
        "Signed for Globex.",
    ]
    runs = [(r.text, r.bold, r.italic) for r in d.paragraphs[0].runs]
    assert ("Globex", True, None) in runs  # the bold run stays bold
    assert [[c.text for c in r.cells] for r in d.tables[0].rows] == [
        ["Item", "Qty"],
        ["Pen", "5"],
        ["Ink", "2"],
    ]
    assert d.sections[0].header.paragraphs[0].text == "Globex confidential"
    async with SessionLocal() as db:
        f = await db.get(DocFile, new_id)
        # Next to the original, with where it came from, readable at once.
        assert f.folder == "Legal/Contracts" and f.source == "generated"
        assert f.fields == {"Edited from": f"Contract.docx [{src}]"}
        assert f.task_id is None and f.agent_id == agent["id"]
        text = await db.scalar(select(DocFile.text).where(DocFile.id == new_id))
        assert "Globex" in text and "DRAFT" not in text

    # An operation that finds nothing stops the call: nothing is saved.
    n = await _count_files()
    bad = await _tool(
        agent["id"],
        "docx_edit",
        {"file_id": src, "operations": [{"op": "replace_text", "find": "Nope", "replace": "x"}]},
    )
    assert bad.startswith("Error: operation 1 (replace_text)") and await _count_files() == n
    # ... unless it says it may find nothing; editing an edited copy names it (edited 2).
    ok = await _tool(
        agent["id"],
        "docx_edit",
        {
            "file_id": new_id,
            "operations": [
                {"op": "replace_text", "find": "Nope", "replace": "x", "optional": True},
                {"op": "replace_text", "find": "globex", "replace": "GX", "match_case": False},
            ],
        },
    )
    assert _made(ok)[1] == "Contract (edited 2).docx"


# ---------------------------------------------------------------- Excel


async def test_excel_edits_keep_formulas_and_styles(client, llm, temporal):
    o, agent, ws = await _setup(client)
    src = await _put(ws, o["branch"]["id"], "Claims.xlsx", _xlsx())
    out = await _tool(
        agent["id"],
        "xlsx_edit",
        {
            "file_id": src,
            "file_name": "Claims October",
            "operations": [
                {"op": "set_cells", "cells": {"C2": 25, "F1": "=E1*2", "Notes!A1": "x"}},
                {"op": "add_sheet", "name": "Notes"},
            ],
        },
    )
    assert out.startswith("Error: operation 1 (set_cells): no sheet 'Notes'"), out
    out = await _tool(
        agent["id"],
        "xlsx_edit",
        {
            "file_id": src,
            "file_name": "Claims October",
            "operations": [
                {"op": "set_cells", "sheet": "claims", "cells": {"C2": 25, "F1": "=E1*2"}},
                {"op": "append_rows", "rows": [["2026-10-04", "Parking", 8], ["x", "y", 1]]},
                {"op": "find_replace", "find": "Grab", "replace": "Grab ride"},
                {"op": "delete_rows", "start": 4, "count": 1},
                {"op": "add_sheet", "name": "Notes"},
                {"op": "rename_sheet", "sheet": "Notes", "name": "Nota"},
                {"op": "set_column_width", "column": "B", "width": 28},
            ],
        },
    )
    new_id, name = _made(out)
    assert name == "Claims October.xlsx"
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(await _bytes(new_id)))
    ws_ = wb["Claims"]
    assert [[c.value for c in r][:3] for r in ws_.iter_rows()] == [
        ["Date", "Item", "Amount"],
        ["2026-10-03", "Grab ride", 25],
        ["2026-10-04", "Parking", 8],
    ]
    assert ws_["E1"].value == "=SUM(C2:C50)" and ws_["F1"].value == "=E1*2"
    assert ws_["C3"].font.bold  # the appended row is styled like the one above
    assert wb.sheetnames == ["Claims", "Nota"] and ws_.column_dimensions["B"].width == 28
    old = openpyxl.load_workbook(io.BytesIO(await _bytes(src)))
    assert old["Claims"]["C2"].value == 23.5 and old.sheetnames == ["Claims"]


# ---------------------------------------------------------------- PDF


async def test_pdf_pages_stamps_numbers_merges_and_forms(client, llm, temporal):
    from pypdf import PdfReader

    o, agent, ws = await _setup(client)
    src = await _put(ws, o["branch"]["id"], "Scan.pdf", _pdf(3))
    extra = await _put(ws, o["branch"]["id"], "Annex.pdf", _pdf(1, "Annex"))
    out = await _tool(
        agent["id"],
        "pdf_edit",
        {
            "file_id": src,
            "operations": [
                {"op": "rotate_pages", "pages": "1", "degrees": 90},
                {"op": "stamp_text", "text": "PAID", "pages": "all", "position": "top-right"},
                {"op": "add_page_numbers"},
                {"op": "merge_with", "file_ids": [extra]},
                {"op": "reorder", "order": [4, 1, 2, 3]},
                {"op": "delete_pages", "pages": "last"},
            ],
        },
    )
    new_id, _ = _made(out)
    r = PdfReader(io.BytesIO(await _bytes(new_id)))
    texts = [p.extract_text() for p in r.pages]
    assert len(r.pages) == 3 and [p.rotation for p in r.pages] == [0, 90, 0]
    assert "Annex body 1" in texts[0] and "Page body 1" in texts[1] and "Page body 2" in texts[2]
    assert all("PAID" in t for t in texts[1:]) and "Page 1 of 3" in texts[1]
    assert len(PdfReader(io.BytesIO(await _bytes(src))).pages) == 3  # the original as it was

    out = await _tool(agent["id"], "pdf_edit", {"file_id": src, "operations": [
        {"op": "extract_pages", "pages": "2-"},
    ]})  # fmt: skip
    assert len(PdfReader(io.BytesIO(await _bytes(_made(out)[0]))).pages) == 2
    bad = await _tool(agent["id"], "pdf_edit", {"file_id": src, "operations": [
        {"op": "rotate_pages", "pages": "7", "degrees": 90},
    ]})  # fmt: skip
    assert "do not exist (the PDF has 3 pages)" in bad

    form = await _put(ws, o["branch"]["id"], "Borang.pdf", _form_pdf())
    n = await _count_files()
    listed = await _tool(
        agent["id"], "pdf_edit", {"file_id": form, "operations": [{"op": "list_form_fields"}]}
    )
    assert "Nama (Tx)" in listed and await _count_files() == n  # a listing saves nothing
    wrong = await _tool(agent["id"], "pdf_edit", {"file_id": form, "operations": [
        {"op": "fill_form_fields", "fields": {"Name": "Aina"}},
    ]})  # fmt: skip
    assert "the fields are: Nama" in wrong
    out = await _tool(agent["id"], "pdf_edit", {"file_id": form, "operations": [
        {"op": "fill_form_fields", "fields": {"Nama": "Aina binti Ali"}},
    ]})  # fmt: skip
    filled = PdfReader(io.BytesIO(await _bytes(_made(out)[0]))).get_fields()
    assert filled["Nama"]["/V"] == "Aina binti Ali"


# ---------------------------------------------------------------- PowerPoint


async def test_powerpoint_text_changes_and_every_other_part_stays(client, llm, temporal):
    o, agent, ws = await _setup(client)
    data = _pptx()
    src = await _put(ws, o["branch"]["id"], "Q3.pptx", data)
    listed = await _tool(
        agent["id"], "pptx_edit", {"file_id": src, "operations": [{"op": "list_texts"}]}
    )
    assert "Slide 1: Q3 results for Acme | Up 12%" in listed and "Saved" not in listed
    out = await _tool(
        agent["id"],
        "pptx_edit",
        {
            "file_id": src,
            "operations": [{"op": "replace_text", "find": "Acme", "replace": "Globex"}],
        },
    )
    new_id, name = _made(out)
    assert name == "Q3 (edited).pptx" and "(2x)" in out  # one split over two runs
    before = zipfile.ZipFile(io.BytesIO(data))
    after = zipfile.ZipFile(io.BytesIO(await _bytes(new_id)))
    assert before.namelist() == after.namelist()
    for part in ("[Content_Types].xml", "ppt/presentation.xml", "ppt/media/image1.png"):
        assert before.read(part) == after.read(part)
    slide2 = after.read("ppt/slides/slide2.xml").decode()
    assert slide2.startswith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    assert "<a:t>Thank you Globex</a:t>" in slide2 and 'b="1"' in slide2
    async with SessionLocal() as db:
        text = await db.scalar(select(DocFile.text).where(DocFile.id == new_id))
        assert "Thank you Globex team" in text


# ---------------------------------------------------------------- who may edit what


async def test_files_the_agent_may_not_see_are_refused(client, llm, temporal):
    o, agent, ws = await _setup(client)
    b2 = await client.post("/api/branches", json={"name": "Jaya Bhd"}, headers=csrf(client))
    other = await _put(ws, b2.json()["id"], "Their contract.docx", _docx())
    n = await _count_files()
    out = await _tool(agent["id"], "docx_edit", {"file_id": other, "operations": [
        {"op": "replace_text", "find": "ACME", "replace": "Globex"},
    ]})  # fmt: skip
    assert out.startswith("Error: no such file") and await _count_files() == n
    # Another company's PDF may not be merged in either.
    mine = await _put(ws, o["branch"]["id"], "Mine.pdf", _pdf(1))
    theirs = await _put(ws, b2.json()["id"], "Theirs.pdf", _pdf(1))
    out = await _tool(agent["id"], "pdf_edit", {"file_id": mine, "operations": [
        {"op": "merge_with", "file_ids": [theirs]},
    ]})  # fmt: skip
    assert out.startswith("Error: no such file")
    # Held back for review: not edited.
    held = await _put(ws, o["branch"]["id"], "Payroll.docx", _docx())
    async with SessionLocal() as db:
        (await db.get(DocFile, held)).quarantined = True
        await db.commit()
    out = await _tool(agent["id"], "docx_edit", {"file_id": held, "operations": [
        {"op": "replace_text", "find": "ACME", "replace": "Globex"},
    ]})  # fmt: skip
    assert "held back for review" in out
    # The right editor for the type, and a limit on operations.
    out = await _tool(agent["id"], "xlsx_edit", {"file_id": mine, "operations": [
        {"op": "add_sheet", "name": "x"},
    ]})  # fmt: skip
    assert "is not a .xlsx or .xlsm file" in out
    many = [{"op": "rotate_pages", "degrees": 90}] * 31
    out = await _tool(agent["id"], "pdf_edit", {"file_id": mine, "operations": many})
    assert "at most 30 operations" in out
    # A file given to the task is the agent's to edit, whatever its company.
    t = await new_task(client, agent, "Fix it", "Stamp the attached file")
    given = await _put(ws, b2.json()["id"], "Given.pdf", _pdf(1), task_id=t["id"])
    out = await _tool(agent["id"], "pdf_edit", {"file_id": given, "operations": [
        {"op": "stamp_text", "text": "OK"},
    ]}, task_id=t["id"])  # fmt: skip
    assert out.startswith("Saved [")


# ---------------------------------------------------------------- routines


def test_file_ids_become_links_and_stale_values_are_still_refused():
    attached = {"fl_aaaaaaaaaa": "scan.pdf"}
    names = {**attached, "fl_bbbbbbbbbb": "scan (edited).pdf"}
    calls = [
        routines.Call(
            "pdf_edit",
            {"file_id": "fl_aaaaaaaaaa", "operations": [{"op": "rotate_pages", "degrees": 90}]},
            "Saved [fl_bbbbbbbbbb] scan (edited).pdf (folder X), an edited copy of "
            "[fl_aaaaaaaaaa] scan.pdf; the original is unchanged.\nChanges:\n- rotated",
        ),
        routines.Call(
            "compile_documents",
            {"title": "Claim Aina", "file_ids": ["fl_bbbbbbbbbb"]},
            "Compiled 1 item(s) into [fl_cccccccccc] Claim Aina.pdf (2 pages, folder X).",
        ),
    ]
    text = "Rotate the scan and compile it as the claim for Aina"
    steps = [{"tool": c.tool, "args": c.args} for c in calls]
    steps[1] = {"tool": "compile_documents", "args": {"title": "Claim {{who}}", "file_ids": [
        "fl_bbbbbbbbbb"
    ]}}  # fmt: skip
    slots = [{"name": "who", "example": "Aina"}]
    answer = {"mode": "template", "text": "Done: [fl_cccccccccc] Claim Aina.pdf"}
    final = answer["text"]
    names["fl_cccccccccc"] = "Claim Aina.pdf"
    # Unlinked, the second step reuses an id an earlier step made: refused as before.
    why = routines.check(text, calls, final, slots, steps, answer, attached, names)
    assert why and "earlier step" in why
    bound, slots2, answer2 = routines.bind_files(steps, calls, slots, answer, attached, names)
    assert bound[0]["args"]["file_id"] == "{{file_1}}"
    assert bound[1]["args"]["file_ids"] == ["{{out_1}}"]
    assert answer2["text"] == "Done: [{{out_2}}] {{out_2_name}}"
    assert slots2[-1] == {
        "name": "file_1",
        "kind": "file",
        "description": "a file attached to the task, like scan.pdf",
        "example": "fl_aaaaaaaaaa",
        "ext": "pdf",
    }
    assert routines.check(text, calls, final, slots2, bound, answer2, attached, names) is None
    # A file slot holds a file attached to the task, nothing else.
    assert "not attached" in routines.check(text, calls, final, slots2, bound, answer2, {}, names)
    # Document jobs may be longer; code is still never a routine.
    many = [calls[0]] * 15
    assert routines.trajectory(_messages_for(many)) is not None
    assert routines.trajectory(_messages_for([routines.Call("calc", {}, "1")] * 15)) is None
    assert routines.forbidden("run_python") and not routines.forbidden("pdf_edit")
    assert routines.is_document(bound) and not routines.is_document([{"tool": "calc"}])


def _messages_for(calls: list[routines.Call]) -> list:
    from agentic.models import AgentMessage

    msgs = []
    for i, c in enumerate(calls):
        msgs.append(
            AgentMessage(
                role="assistant",
                tool_calls=[
                    {
                        "id": f"c{i}",
                        "type": "function",
                        "function": {"name": c.tool, "arguments": json.dumps(c.args)},
                    }
                ],
                meta={},
            )
        )
        msgs.append(AgentMessage(role="tool", tool_call_id=f"c{i}", content=c.result, meta={}))
    return msgs


class _Lazy(list):
    """Scripted replies where a callable is worked out when the model is asked (the ids of
    files the run has just made)."""

    def pop(self, i=-1):
        item = super().pop(i)
        return item() if callable(item) else item


def _last_saved(llm) -> tuple[str, str]:
    for m in reversed(llm.requests[-1]["messages"]):
        if m.get("role") == "tool" and (found := SAVED.search(str(m.get("content") or ""))):
            return found.group(1), found.group(2)
    raise AssertionError("no file was saved yet")


async def test_a_document_job_learned_once_replays_on_a_new_attachment_without_the_model(
    client, llm, temporal, loose
):
    from pypdf import PdfReader

    o, agent, ws = await _setup(client)
    brief = "Rotate the attached scan and stamp it {}"
    a = await new_task(client, agent, "Stamp the scan", brief.format("COPY"))
    fa = await _put(ws, o["branch"]["id"], "scan-a.pdf", _pdf(1, "Alpha"), task_id=a["id"])
    rotate = [{"op": "rotate_pages", "pages": "all", "degrees": 90}]
    llm.replies = _Lazy(llm.replies)
    llm.call("pdf_edit", file_id=fa, operations=rotate)
    llm.replies.append(
        lambda: {
            "content": None,
            "tool_calls": [
                {
                    "id": "call_2",
                    "type": "function",
                    "function": {
                        "name": "pdf_edit",
                        "arguments": json.dumps(
                            {
                                "file_id": _last_saved(llm)[0],
                                "operations": [{"op": "stamp_text", "text": "COPY"}],
                            }
                        ),
                    },
                }
            ],
        }
    )
    llm.replies.append(lambda: {"content": "Done: [{}] {}.".format(*_last_saved(llm))})
    assert (await runtime.run_task_step(a["id"])).state == "done"
    async with SessionLocal() as db:
        made = (
            await db.scalars(
                select(DocFile)
                .where(DocFile.task_id == a["id"], DocFile.source == "generated")
                .order_by(DocFile.created_at)
            )
        ).all()
        assert [f.name for f in made] == ["scan-a (edited).pdf", "scan-a (edited 2).pdf"]
        one, two = made[0], made[1]
        final = f"Done: [{two.id}] {two.name}."
        t = await db.get(Task, a["id"])
        t.status, t.result = "done", final
        await db.commit()

    # The model drafts the routine once, keeping the file ids as they were; the office links
    # them: the attached scan becomes a file slot, the rotated copy the first step's output.
    llm.say(
        json.dumps(
            {
                "replayable": True,
                "name": "Rotate and stamp a scan",
                "description": "Rotate an attached scan and stamp a word on it.",
                "slots": [{"name": "stamp", "description": "the stamp", "example": "COPY"}],
                "steps": [
                    {"tool": "pdf_edit", "args": {"file_id": fa, "operations": rotate}},
                    {
                        "tool": "pdf_edit",
                        "args": {
                            "file_id": one.id,
                            "operations": [{"op": "stamp_text", "text": "{{stamp}}"}],
                        },
                    },
                ],
                "answer": {"mode": "template", "text": final},
            }
        )
    )
    async with SessionLocal() as db:
        r = await routines.learn(db, a["id"])
        assert r is not None and r.status == "candidate", r
        assert r.steps[0]["args"]["file_id"] == "{{file_1}}"
        assert r.steps[1]["args"]["file_id"] == "{{out_1}}"
        assert r.answer["text"] == "Done: [{{out_2}}] {{out_2_name}}."
        slot = next(s for s in r.slots if s["name"] == "file_1")
        assert slot["kind"] == "file" and slot["ext"] == "pdf" and slot["example"] == fa
        # Remembered: a brain fact with the routine's fingerprint.
        fp = routines.fingerprint(r)
        fact = await db.scalar(select(BrainFact).where(BrainFact.text.contains(fp)))
        assert fact is not None and "pdf_edit then pdf_edit" in fact.text
        ev = await db.scalar(
            select(TaskEvent).where(TaskEvent.task_id == a["id"], TaskEvent.kind == "routine")
        )
        assert ev.data["fingerprint"] == fp
        r.status = "active"  # trusted by a person (or confirmed by a second task)
        r.baseline_tokens = 1000
        await db.commit()
        rid = r.id

    # A new scan, a new stamp: the routine runs both steps on the new file, chaining the
    # rotated copy into the stamp, and writes the answer from its template. No model at all.
    b = await new_task(client, agent, "Stamp the scan", brief.format("PAID"))
    fb = await _put(ws, o["branch"]["id"], "scan-b.pdf", _pdf(2, "Beta"), task_id=b["id"])
    original = await _sha(fb)
    sent = len(llm.requests)
    step = await runtime.run_task_step(b["id"])
    assert step.state == "done", step
    assert len(llm.requests) == sent  # not one model call
    async with SessionLocal() as db:
        made = (
            await db.scalars(
                select(DocFile)
                .where(DocFile.task_id == b["id"], DocFile.source == "generated")
                .order_by(DocFile.created_at)
            )
        ).all()
        assert [f.name for f in made] == ["scan-b (edited).pdf", "scan-b (edited 2).pdf"]
        last = made[-1]
        assert last.fields == {"Edited from": f"scan-b (edited).pdf [{made[0].id}]"}
        assert step.message == f"Done: [{last.id}] {last.name}."
        states = [
            e.data.get("state")
            for e in (
                await db.scalars(
                    select(TaskEvent).where(
                        TaskEvent.task_id == b["id"], TaskEvent.kind == "routine_run"
                    )
                )
            ).all()
        ]
        assert states == ["started", "done"]
        assert (await db.get(Routine, rid)).uses == 1
    pdf = PdfReader(io.BytesIO(await _bytes(last.id)))
    assert [p.rotation for p in pdf.pages] == [90, 90]
    assert all("PAID" in p.extract_text() and "Beta" in p.extract_text() for p in pdf.pages)
    assert await _sha(fb) == original

    # Two scans attached where the routine takes one: which is which would be a guess, so
    # the agent does it itself.
    c = await new_task(client, agent, "Stamp the scan", brief.format("SEEN"))
    await _put(ws, o["branch"]["id"], "scan-c.pdf", _pdf(1), task_id=c["id"])
    await _put(ws, o["branch"]["id"], "scan-d.pdf", _pdf(1), task_id=c["id"])
    llm.say("Both scans are stamped SEEN.")
    sent = len(llm.requests)
    step = await runtime.run_task_step(c["id"])
    assert step.message == "Both scans are stamped SEEN." and len(llm.requests) == sent + 1
