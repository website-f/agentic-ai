"""P140: agents edit the office's own files: Word, Excel, PDF and PowerPoint.

Until now an agent could read these files and make new ones, but changing an existing file
meant writing code. These tools take structured operations ("replace this text", "set these
cells", "rotate pages 2-3", "stamp PAID on page 1"), so the same call can be repeated
exactly: a learned routine (skills/routines.py) replays them on the next file people attach,
without the paid model.

Rules for every tool:
- The file is one the agent may read (doc_tools._file: its company's, its task's, never
  anyone's private files) and not held back for review.
- The original is never changed: the result is a NEW file next to it (same folder, company,
  department and restriction), named "<name> (edited).<ext>" unless a name is given, with
  "Edited from: <name> [id]" in its key facts and on the audit log.
- Files up to MAX_BYTES, at most MAX_OPS operations a call; an operation that finds nothing
  to change is an error (so a replay on the wrong file stops) unless it says optional=true.
- PowerPoint is edited without python-pptx: a .pptx is a zip of XML; only the slide parts a
  replacement touched are rewritten, every other part is copied as it is.
"""

import asyncio
import copy
import io
import re
import zipfile
from collections.abc import Callable
from typing import Any

from ..documents import provenance, service
from ..documents.extract import MAX_SLIDE_XML, check_office_zip, extract
from ..models import DocFile
from .doc_tools import HELD_BACK, _file
from .tools import Tool, ToolContext

MAX_BYTES = 10 * 1024 * 1024  # like run_python's inputs: office files, not archives
MAX_OPS = 30
MAX_PDF_PAGES = 500
MAX_CELLS = 5000  # values written by one xlsx_edit call
MAX_FIND = 1000
MAX_TEXT = 20_000

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
_SLIDE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
_EDITED = re.compile(r" \(edited(?: (\d+))?\)$")
_BAD_NAME = re.compile(r"[\\/:*?\"<>|\x00-\x1f]")


class EditError(ValueError):
    """An operation that cannot be done; the message goes back to the agent."""


# ---------------------------------------------------------------- shared


def _ops(args: dict[str, Any], allowed: tuple[str, ...]) -> list[dict[str, Any]] | str:
    raw = args.get("operations")
    if not isinstance(raw, list) or not raw:
        return "Error: give operations, a list like [{'op': '" + allowed[0] + "', ...}]."
    if len(raw) > MAX_OPS:
        return f"Error: at most {MAX_OPS} operations in one call."
    out: list[dict[str, Any]] = []
    for n, op in enumerate(raw, 1):
        if not isinstance(op, dict) or str(op.get("op") or "") not in allowed:
            return f"Error: operation {n} needs 'op', one of: {', '.join(allowed)}."
        out.append(op)
    return out


async def _source(
    ctx: ToolContext, file_id: Any, exts: tuple[str, ...]
) -> tuple[DocFile, bytes] | str:
    """The file to edit and its bytes, or why not (the same rule as read_file)."""
    from ..documents import storage  # P40: the bytes may live outside the database

    f = await _file(ctx, str(file_id or ""))
    if f is None:
        return (
            f"Error: no such file {str(file_id or '')[:60]!r} for you. Use list_files (or the "
            "task's attached files) for the ids."
        )
    if f.quarantined:
        return HELD_BACK.format(name=f.name)
    ext = _ext(f.name)
    if ext not in exts:
        return f"Error: {f.name} is not a {' or '.join('.' + e for e in exts)} file."
    if (f.size or 0) > MAX_BYTES:
        return f"Error: {f.name} is larger than {MAX_BYTES // (1024 * 1024)} MB."
    try:
        data = await storage.read(ctx.db, f)
    except storage.StorageError as e:
        return f"Error: {f.name}: {e}"
    if len(data) > MAX_BYTES:
        return f"Error: {f.name} is larger than {MAX_BYTES // (1024 * 1024)} MB."
    return f, data


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def out_name(source: str, given: Any, ext: str) -> str:
    """The new file's name: the one given (with the right extension), else the source's
    name + " (edited)", " (edited 2)" when that is already an edited copy."""
    raw = _BAD_NAME.sub(" ", str(given or "")).strip()[:150]
    if raw:
        stem = raw[: -len(ext) - 1] if raw.lower().endswith("." + ext) else raw
        return f"{stem.strip() or 'Edited'}.{ext}"
    stem = source.rsplit(".", 1)[0] if "." in source else source
    m = _EDITED.search(stem)
    if m:
        stem = stem[: m.start()] + f" (edited {int(m.group(1) or 1) + 1})"
    else:
        stem += " (edited)"
    return f"{stem[:180]}.{ext}"


def _text_of(data: bytes, name: str, ext: str) -> tuple[str, int]:
    """The new file's text for read_file and search. A PDF's typed text only (no OCR: an
    edited scan must not hold the tool up for minutes)."""
    if ext != "pdf":
        got = extract(data, name)
        return got.text, got.pages
    import pypdfium2 as pdfium

    from ..documents.extract import _PDFIUM

    with _PDFIUM:
        doc = pdfium.PdfDocument(data)
        try:
            total = len(doc)
            texts = [
                doc[i].get_textpage().get_text_range().strip()
                for i in range(min(total, MAX_PDF_PAGES))
            ]
        finally:
            doc.close()
    return "\n\n".join(f"[page {i + 1}]\n{t}" for i, t in enumerate(texts)), total


async def _save(
    ctx: ToolContext, src: DocFile, data: bytes, ext: str, given: Any, changes: list[str]
) -> str:
    from ..services import audit

    if len(data) > 2 * MAX_BYTES:
        return f"Error: the edited file would be larger than {2 * MAX_BYTES // (1024 * 1024)} MB."
    name = out_name(src.name, given, ext)
    folder = src.folder or await provenance.ai_folder(
        ctx.db, ctx.workspace.id, src.branch_id or ctx.agent.branch_id, "file"
    )
    text, pages = await asyncio.to_thread(_text_of, data, name, ext)
    f = await service.create_file(
        ctx.db,
        workspace_id=ctx.workspace.id,
        name=name,
        data=data,
        created_by=f"agent:{ctx.agent.id}",
        branch_id=src.branch_id or ctx.agent.branch_id,
        task_id=ctx.task.id if ctx.task else None,
        agent_id=ctx.agent.id,
        source="generated",
        status="ready",
        folder=folder,
        department_id=src.department_id,
        owner_user_id=src.owner_user_id,
    )
    f.restricted = src.restricted  # a restricted contract's copy stays restricted
    f.kind = src.kind
    f.title = name.rsplit(".", 1)[0]
    f.text, f.pages = text, pages
    f.fields = {"Edited from": f"{src.name} [{src.id}]"}
    f.summary = (f"Edited copy of {src.name} by {ctx.agent.name}: " + "; ".join(changes))[:1000]
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "file.edited",
        target=f.id,
        before={"source": src.id},
        after={"changes": changes[:20], "task_id": ctx.task.id if ctx.task else None},
    )
    await ctx.db.commit()
    return (
        f"Saved [{f.id}] {f.name} (folder {f.folder}), an edited copy of [{src.id}] {src.name}; "
        "the original is unchanged.\nChanges:\n" + "\n".join(f"- {c}" for c in changes)
    )


async def _run(
    ctx: ToolContext,
    args: dict[str, Any],
    exts: tuple[str, ...],
    allowed: tuple[str, ...],
    work: Callable[..., tuple[bytes | None, list[str]]],
    extra: dict[str, bytes] | None = None,
) -> str:
    ops = _ops(args, allowed)
    if isinstance(ops, str):
        return ops
    got = await _source(ctx, args.get("file_id"), exts)
    if isinstance(got, str):
        return got
    src, data = got
    ext = _ext(src.name)
    try:
        out, changes = await asyncio.to_thread(work, data, ops, ext, extra or {})
    except EditError as e:
        return f"Error: {e}"
    except zipfile.BadZipFile:
        return f"Error: {src.name} is damaged or not really a .{ext} file."
    except Exception as e:  # noqa: BLE001 - a broken or unusual file
        return f"Error: could not edit {src.name} ({e.__class__.__name__}: {str(e)[:200]})."
    if out is None:  # only read-only operations (a listing)
        return f"{src.name} [{src.id}]:\n" + "\n".join(changes)
    return await _save(ctx, src, out, ext, args.get("file_name"), changes)


def _optional(op: dict[str, Any]) -> bool:
    return op.get("optional") is True


def _nothing(n: int, op: dict[str, Any], what: str) -> None:
    if not _optional(op):
        raise EditError(
            f'operation {n} ({op["op"]}): {what}. Nothing was saved (add "optional": true '
            "to skip an operation that finds nothing)."
        )


def _finder(op: dict[str, Any], n: int, key: str = "find") -> re.Pattern[str]:
    find = str(op.get(key) or "")
    if not find:
        raise EditError(f"operation {n} ({op['op']}): give the text to find ({key}).")
    if len(find) > MAX_FIND:
        raise EditError(f"operation {n} ({op['op']}): the text to find is too long.")
    pattern = re.escape(find)
    if op.get("whole_word"):
        pattern = rf"(?<!\w){pattern}(?!\w)"
    return re.compile(pattern, 0 if op.get("match_case", True) else re.IGNORECASE)


def _text_arg(op: dict[str, Any], n: int, key: str, *, required: bool = True) -> str:
    v = op.get(key)
    if v is None:
        if required:
            raise EditError(f"operation {n} ({op['op']}): give {key}.")
        return ""
    s = str(v)
    if len(s) > MAX_TEXT:
        raise EditError(f"operation {n} ({op['op']}): {key} is too long.")
    return s


def _num(op: dict[str, Any], key: str, default: float, lo: float, hi: float) -> float:
    raw = op.get(key)
    try:
        v = float(raw) if raw not in (None, "") else default  # type: ignore[arg-type]
    except (TypeError, ValueError):
        v = lo - 1
    if not lo <= v <= hi:
        raise EditError(f"{key} is from {lo:g} to {hi:g}")
    return v


def replace_in_runs(nodes: list[Any], rx: re.Pattern[str], repl: str) -> int:
    """Replace every match of `rx` in the text the nodes (runs' text elements, in reading
    order) hold together. A match spread over several runs takes the first run's formatting;
    runs outside a match are untouched. Returns how many were replaced."""
    texts = [n.text or "" for n in nodes]
    full = "".join(texts)
    matches = [m for m in rx.finditer(full) if m.end() > m.start()]
    if not matches:
        return 0
    lens = [len(t) for t in texts]
    starts, pos = [], 0
    for n in lens:
        starts.append(pos)
        pos += n

    def at(offset: int) -> int:
        for i, (s0, n) in enumerate(zip(starts, lens, strict=True)):
            if s0 <= offset < s0 + n:
                return i
        return len(lens) - 1

    for m in reversed(matches):  # right to left: earlier offsets stay true
        s, e = m.span()
        i, j = at(s), at(e - 1)
        if i == j:
            t = texts[i]
            texts[i] = t[: s - starts[i]] + repl + t[e - starts[i] :]
        else:
            texts[i] = texts[i][: s - starts[i]] + repl
            for k in range(i + 1, j):
                texts[k] = ""
            texts[j] = texts[j][e - starts[j] :]
    for node, t in zip(nodes, texts, strict=True):
        if (node.text or "") != t:
            node.text = t
            if node.tag.startswith("{" + W_NS):
                node.set(XML_SPACE, "preserve")
    return len(matches)


def _paragraph_nodes(root: Any, p_tag: str, t_tag: str) -> list[tuple[Any, list[Any]]]:
    """(paragraph, its own text elements) for every paragraph under root; a paragraph inside
    another (a text box) is its own entry, never counted twice."""
    out = []
    for p in root.iter(p_tag):
        nodes = [t for t in p.iter(t_tag) if next(t.iterancestors(p_tag), None) is p]
        out.append((p, nodes))
    return out


# ---------------------------------------------------------------- Word


DOCX_OPS = (
    "replace_text",
    "append_paragraph",
    "insert_paragraph_after",
    "set_table_cell",
    "add_table_row",
    "delete_paragraph_containing",
)


def _docx_roots(doc: Any) -> list[Any]:
    roots = [doc.element.body]
    seen: set[str] = set()
    for s in doc.sections:
        for hf in (
            s.header,
            s.footer,
            s.first_page_header,
            s.first_page_footer,
            s.even_page_header,
            s.even_page_footer,
        ):
            if hf.is_linked_to_previous:
                continue
            part = str(hf.part.partname)
            if part not in seen:
                seen.add(part)
                roots.append(hf._element)
    return roots


def _int(op: dict[str, Any], n: int, key: str, lo: int = 1, hi: int = 1_000_000) -> int:
    try:
        v = int(op.get(key))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise EditError(f"operation {n} ({op['op']}): {key} must be a whole number.") from None
    if not lo <= v <= hi:
        raise EditError(f"operation {n} ({op['op']}): {key} must be from {lo} to {hi}.")
    return v


def _set_cell(cell: Any, text: str) -> None:
    """A table cell's text, keeping the first run's formatting."""
    paras = cell.paragraphs
    first = paras[0]
    runs = first.runs
    if runs:
        runs[0].text = text
        for r in runs[1:]:
            r._r.getparent().remove(r._r)
    elif text:
        first.add_run(text)
    for p in paras[1:]:
        p._p.getparent().remove(p._p)


def edit_docx(
    data: bytes, ops: list[dict[str, Any]], ext: str = "docx", extra: dict[str, bytes] | None = None
) -> tuple[bytes, list[str]]:
    from docx import Document as Docx
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    check_office_zip(data)
    doc = Docx(io.BytesIO(data))
    w_p, w_t = qn("w:p"), qn("w:t")
    changes: list[str] = []

    def body_paragraphs() -> list[tuple[Any, list[Any]]]:
        return _paragraph_nodes(doc.element.body, w_p, w_t)

    def table(op: dict[str, Any], n: int) -> Any:
        i = _int(op, n, "table_index")
        if i > len(doc.tables):
            raise EditError(
                f"operation {n} ({op['op']}): there is no table {i} (the document has "
                f"{len(doc.tables)})."
            )
        return doc.tables[i - 1]

    for n, op in enumerate(ops, 1):
        kind = op["op"]
        if kind == "replace_text":
            rx = _finder(op, n)
            repl = _text_arg(op, n, "replace")
            count = sum(
                replace_in_runs(nodes, rx, repl)
                for root in _docx_roots(doc)
                for _, nodes in _paragraph_nodes(root, w_p, w_t)
            )
            if not count:
                _nothing(n, op, f"{op['find']!r} is not in the document")
            changes.append(f"replaced {op['find']!r} with {repl!r} ({count}x)")
        elif kind == "append_paragraph":
            text = _text_arg(op, n, "text")
            style = str(op.get("style") or "").strip() or None
            try:
                doc.add_paragraph(text, style=style)
            except KeyError:
                raise EditError(
                    f"operation {n} (append_paragraph): the document has no style {style!r}."
                ) from None
            changes.append(f"added a paragraph at the end: {text[:60]!r}")
        elif kind == "insert_paragraph_after":
            anchor = _text_arg(op, n, "anchor_text")
            text = _text_arg(op, n, "text")
            hit = next(
                (
                    p
                    for p, nodes in body_paragraphs()
                    if anchor in "".join(t.text or "" for t in nodes)
                ),
                None,
            )
            if hit is None:
                _nothing(n, op, f"no paragraph contains {anchor!r}")
                continue
            new = OxmlElement("w:p")
            ppr = hit.find(qn("w:pPr"))
            if ppr is not None:
                ppr = copy.deepcopy(ppr)
                for sect in ppr.findall(qn("w:sectPr")):  # never a second section break
                    ppr.remove(sect)
                new.append(ppr)
            hit.addnext(new)
            run = Paragraph(new, None).add_run(text)
            rpr = next(
                (
                    r.find(qn("w:rPr"))
                    for r in hit.iter(qn("w:r"))
                    if r.find(qn("w:rPr")) is not None
                ),
                None,
            )
            if rpr is not None:
                run._r.insert(0, copy.deepcopy(rpr))
            changes.append(f"inserted a paragraph after {anchor[:40]!r}")
        elif kind == "set_table_cell":
            t = table(op, n)
            row = _int(op, n, "row", hi=len(t.rows))
            col = _int(op, n, "col", hi=len(t.columns))
            text = _text_arg(op, n, "text", required=False)
            _set_cell(t.cell(row - 1, col - 1), text)
            changes.append(f"table {op['table_index']} row {row} column {col}: {text[:40]!r}")
        elif kind == "add_table_row":
            t = table(op, n)
            values = op.get("values")
            if not isinstance(values, list):
                raise EditError(f"operation {n} (add_table_row): give values, a list.")
            last = t.rows[-1]._tr
            new_tr = copy.deepcopy(last)
            last.addnext(new_tr)
            cells = t.rows[-1].cells
            if len(values) > len(cells):
                new_tr.getparent().remove(new_tr)
                raise EditError(
                    f"operation {n} (add_table_row): {len(values)} values for a row of "
                    f"{len(cells)} cells."
                )
            for i, cell in enumerate(cells):
                _set_cell(cell, str(values[i]) if i < len(values) and values[i] is not None else "")
            changes.append(f"table {op['table_index']}: added a row {values[:6]!r}")
        elif kind == "delete_paragraph_containing":
            rx = _finder(op, n, "text")
            gone = 0
            for p, nodes in body_paragraphs():
                if not rx.search("".join(t.text or "" for t in nodes)):
                    continue
                parent = p.getparent()
                ppr = p.find(qn("w:pPr"))
                alone = (
                    parent is not None
                    and parent.tag == qn("w:tc")
                    and len(parent.findall(w_p)) == 1
                )
                if alone or (ppr is not None and ppr.find(qn("w:sectPr")) is not None):
                    for t in nodes:  # a cell needs a paragraph; a section break stays
                        t.text = ""
                else:
                    parent.remove(p)
                gone += 1
            if not gone:
                _nothing(n, op, f"no paragraph contains {op['text']!r}")
            changes.append(f"deleted {gone} paragraph(s) containing {op['text']!r}")
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue(), changes


# ---------------------------------------------------------------- Excel


XLSX_OPS = (
    "set_cells",
    "append_rows",
    "find_replace",
    "add_sheet",
    "rename_sheet",
    "delete_rows",
    "set_column_width",
)
_SHEET_BAD = re.compile(r"[\[\]:*?/\\]")


def _value(v: Any, n: int, kind: str) -> Any:
    if v is None or isinstance(v, bool | int | float):
        return v
    if isinstance(v, str):
        if len(v) > 32_000:
            raise EditError(f"operation {n} ({kind}): a value is longer than Excel allows.")
        return v
    raise EditError(f"operation {n} ({kind}): values must be text, numbers, true/false or null.")


def _sheet_name(name: Any, n: int, kind: str) -> str:
    s = str(name or "").strip()
    if not s or len(s) > 31 or _SHEET_BAD.search(s):
        raise EditError(
            f"operation {n} ({kind}): a sheet name is 1-31 characters without [ ] : * ? / \\."
        )
    return s


def edit_xlsx(
    data: bytes, ops: list[dict[str, Any]], ext: str = "xlsx", extra: dict[str, bytes] | None = None
) -> tuple[bytes, list[str]]:
    import openpyxl
    from openpyxl.cell.cell import MergedCell
    from openpyxl.utils.cell import column_index_from_string, coordinate_from_string

    check_office_zip(data)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        pictures = any(n.startswith(("xl/drawings/", "xl/charts/")) for n in z.namelist())
    wb = openpyxl.load_workbook(io.BytesIO(data), keep_vba=ext == "xlsm", keep_links=True)
    changes: list[str] = []
    written = 0

    def sheet(op: dict[str, Any], n: int, key: str = "sheet") -> Any:
        name = str(op.get(key) or "").strip()
        if not name:
            return wb.active
        if name in wb.sheetnames:
            return wb[name]
        for s in wb.sheetnames:
            if s.casefold() == name.casefold():
                return wb[s]
        raise EditError(
            f"operation {n} ({op['op']}): no sheet {name!r} (sheets: {', '.join(wb.sheetnames)})."
        )

    for n, op in enumerate(ops, 1):
        kind = op["op"]
        if kind == "set_cells":
            cells = op.get("cells")
            if not isinstance(cells, dict) or not cells:
                raise EditError(f"operation {n} (set_cells): give cells, e.g. {{'B5': 120}}.")
            for ref, v in cells.items():
                ws = sheet(op, n)
                ref = str(ref).strip()
                if "!" in ref:
                    name, ref = ref.rsplit("!", 1)
                    ws = sheet({"op": kind, "sheet": name.strip("'")}, n)
                try:
                    coordinate_from_string(ref.replace("$", ""))
                except ValueError:
                    raise EditError(
                        f"operation {n} (set_cells): {ref!r} is not a cell like B5."
                    ) from None
                cell = ws[ref.replace("$", "")]
                if isinstance(cell, MergedCell):
                    raise EditError(
                        f"operation {n} (set_cells): {ref} is inside a merged area; write to its "
                        "top-left cell."
                    )
                cell.value = _value(v, n, kind)
                written += 1
            changes.append(f"set {len(cells)} cell(s): " + ", ".join(list(map(str, cells))[:8]))
        elif kind == "append_rows":
            ws = sheet(op, n)
            rows = op.get("rows")
            if not isinstance(rows, list) or not rows or not all(isinstance(r, list) for r in rows):
                raise EditError(f"operation {n} (append_rows): give rows, a list of lists.")
            above = ws.max_row
            first = above + 1
            for row in rows:
                values = [_value(v, n, kind) for v in row[:500]]
                ws.append(values)
                r = ws.max_row
                if above >= 1:  # the new row looks like the one above it
                    for c in range(1, len(values) + 1):
                        src = ws.cell(row=above, column=c)
                        if src.has_style:
                            ws.cell(row=r, column=c)._style = copy.copy(src._style)
                written += len(values)
            changes.append(f"{ws.title}: added {len(rows)} row(s) from row {first}")
        elif kind == "find_replace":
            rx = _finder(op, n)
            repl = _text_arg(op, n, "replace")
            sheets = [sheet(op, n)] if op.get("sheet") else list(wb.worksheets)
            count = 0
            for ws in sheets:
                for row in ws.iter_rows():
                    for cell in row:
                        v = cell.value
                        if isinstance(v, str) and not v.startswith("=") and rx.search(v):
                            if isinstance(cell, MergedCell):
                                continue
                            cell.value = rx.sub(lambda _m, r=repl: r, v)
                            count += 1
            if not count:
                _nothing(n, op, f"no cell holds {op['find']!r}")
            changes.append(f"replaced {op['find']!r} with {repl!r} in {count} cell(s)")
        elif kind == "add_sheet":
            name = _sheet_name(op.get("name"), n, kind)
            if any(s.casefold() == name.casefold() for s in wb.sheetnames):
                raise EditError(f"operation {n} (add_sheet): a sheet {name!r} already exists.")
            wb.create_sheet(name)
            changes.append(f"added the sheet {name!r}")
        elif kind == "rename_sheet":
            ws = sheet(op, n)
            name = _sheet_name(op.get("name"), n, kind)
            if any(s.casefold() == name.casefold() and s != ws.title for s in wb.sheetnames):
                raise EditError(f"operation {n} (rename_sheet): a sheet {name!r} already exists.")
            before, ws.title = ws.title, name
            changes.append(f"renamed the sheet {before!r} to {name!r}")
        elif kind == "delete_rows":
            ws = sheet(op, n)
            start = _int(op, n, "start")
            count = _int(op, n, "count", hi=100_000) if op.get("count") is not None else 1
            if start > ws.max_row:
                _nothing(n, op, f"{ws.title} has only {ws.max_row} rows")
                continue
            ws.delete_rows(start, count)
            changes.append(
                f"{ws.title}: deleted {count} row(s) from row {start} (formulas elsewhere are "
                "not shifted)"
            )
        elif kind == "set_column_width":
            ws = sheet(op, n)
            col = str(op.get("column") or "").strip().upper()
            try:
                column_index_from_string(col)
            except ValueError:
                raise EditError(
                    f"operation {n} (set_column_width): {col!r} is not a column like C."
                ) from None
            try:
                width = float(op.get("width"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                width = -1
            if not 0 < width <= 255:
                raise EditError(f"operation {n} (set_column_width): width is from 1 to 255.")
            ws.column_dimensions[col].width = width
            changes.append(f"{ws.title}: column {col} width {width:g}")
        if written > MAX_CELLS:
            raise EditError(f"at most {MAX_CELLS} values in one call.")
    if pictures:
        changes.append("note: pictures and charts in the original are not kept in this copy")
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), changes


# ---------------------------------------------------------------- PDF


PDF_OPS = (
    "extract_pages",
    "delete_pages",
    "rotate_pages",
    "reorder",
    "merge_with",
    "stamp_text",
    "fill_form_fields",
    "add_page_numbers",
    "list_form_fields",
)
POSITIONS = (
    "top-left",
    "top-center",
    "top-right",
    "center",
    "bottom-left",
    "bottom-center",
    "bottom-right",
    "diagonal",
)
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


def pages_of(spec: Any, total: int) -> list[int]:
    """0-based page indexes from "1-3,5", "2-", "last", "all" (in the order given)."""
    if spec is None or (isinstance(spec, str) and spec.strip().lower() in ("", "all")):
        return list(range(total))
    parts: list[str]
    if isinstance(spec, int):
        parts = [str(spec)]
    elif isinstance(spec, list):
        parts = [str(x) for x in spec]
    else:
        parts = str(spec).replace(" ", "").split(",")
    out: list[int] = []
    for part in parts:
        p = part.strip().lower()
        if not p:
            continue
        if p == "last":
            lo = hi = total
        elif m := re.fullmatch(r"(\d+)-(\d*|last)", p):
            lo = int(m.group(1))
            hi = total if m.group(2) in ("", "last") else int(m.group(2))
        elif p.isdigit():
            lo = hi = int(p)
        else:
            raise EditError(f"{part!r} is not a page or range like 1-3,5")
        if lo < 1 or hi > total or lo > hi:
            raise EditError(f"pages {part!r} do not exist (the PDF has {total} pages)")
        for i in range(lo - 1, hi):
            if i not in out:
                out.append(i)
    if not out:
        raise EditError("no pages given")
    return out


def _reader(data: bytes) -> Any:
    from pypdf import PdfReader

    r = PdfReader(io.BytesIO(data))
    if r.is_encrypted and not r.decrypt(""):
        raise EditError("the PDF is password-protected")
    if len(r.pages) > MAX_PDF_PAGES:
        raise EditError(f"the PDF has more than {MAX_PDF_PAGES} pages")
    return r


def _write(writer: Any) -> bytes:
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _select(data: bytes, idx: list[int]) -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    w.append(_reader(data), pages=idx)
    return _write(w)


def _rgb(raw: Any, default: tuple[int, int, int]) -> tuple[int, int, int]:
    m = _HEX.match(str(raw or ""))
    if not m:
        return default
    h = m.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _overlays(specs: list[tuple[float, float, str, str, float, tuple[int, int, int]]]) -> list[Any]:
    """One transparent page per spec (width, height, text, position, size, colour), drawn
    with fpdf2, to lay over a PDF page."""
    from fpdf import FPDF

    from ..documents.render_pdf import _fonts

    pdf = FPDF(unit="pt", format=(specs[0][0], specs[0][1]))
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    fonts = _fonts()
    family = "helvetica"
    if fonts:
        pdf.add_font("stamp", "", fonts[0])
        family = "stamp"
    for w, h, text, position, size, rgb in specs:
        if not fonts:  # the core font has Latin-1 only
            text = text.encode("latin-1", "replace").decode("latin-1")
        pdf.add_page(format=(w, h))
        pdf.set_font(family, size=size)
        pdf.set_text_color(*rgb)
        tw = pdf.get_string_width(text)
        margin = 24.0
        if position == "diagonal":
            with pdf.local_context(fill_opacity=0.35), pdf.rotation(45, x=w / 2, y=h / 2):
                pdf.text(x=(w - tw) / 2, y=h / 2 + size / 3, text=text)
            continue
        vert, _, horiz = (
            position.partition("-") if position != "center" else ("center", "", "center")
        )
        x = {"left": margin, "right": w - margin - tw}.get(horiz, (w - tw) / 2)
        y = {"top": margin + size, "bottom": h - margin}.get(vert, h / 2 + size / 3)
        pdf.text(x=x, y=y, text=text)
    from pypdf import PdfReader

    return list(PdfReader(io.BytesIO(bytes(pdf.output()))).pages)


def _overlay_pages(
    data: bytes,
    texts: dict[int, str],
    position: str,
    size: float,
    rgb: tuple[int, int, int],
) -> bytes:
    """Lay text over the given pages, upright as people see each page (rotated pages too)."""
    from pypdf import PdfWriter, Transformation

    reader = _reader(data)
    writer = PdfWriter(clone_from=reader)
    specs, where = [], []
    for i, text in texts.items():
        page = writer.pages[i]
        box = page.mediabox
        w, h = float(box.width), float(box.height)
        rot = int(page.rotation or 0) % 360
        vw, vh = (h, w) if rot in (90, 270) else (w, h)
        specs.append((vw, vh, text, position, size, rgb))
        where.append((i, w, h, rot, float(box.left), float(box.bottom)))
    for over, (i, w, h, rot, left, bottom) in zip(_overlays(specs), where, strict=True):
        shift = {0: (0.0, 0.0), 90: (w, 0.0), 180: (w, h), 270: (0.0, h)}.get(rot, (0.0, 0.0))
        ctm = Transformation().rotate(rot).translate(shift[0] + left, shift[1] + bottom)
        writer.pages[i].merge_transformed_page(over, ctm)
    return _write(writer)


def _field_value(field: Any, v: Any) -> Any:
    states = [str(s) for s in (field.get("/_States_") or [])]
    if field.get("/FT") == "/Btn" and states:
        on = next((s for s in states if s != "/Off"), states[0])
        truthy = v is True or str(v).strip().lower() in ("yes", "true", "on", "1", "x", on.lower())
        return on if truthy else "/Off"
    return "" if v is None else str(v)


def edit_pdf(
    data: bytes, ops: list[dict[str, Any]], ext: str = "pdf", extra: dict[str, bytes] | None = None
) -> tuple[bytes | None, list[str]]:
    from pypdf import PdfWriter

    extra = extra or {}
    changes: list[str] = []
    listing: list[str] = []
    changed = False
    for n, op in enumerate(ops, 1):
        kind = op["op"]
        total = len(_reader(data).pages)
        try:
            if kind == "extract_pages":
                idx = pages_of(op.get("pages"), total)
                data = _select(data, idx)
                changes.append(f"kept {len(idx)} of {total} pages ({op.get('pages')})")
            elif kind == "delete_pages":
                gone = set(pages_of(op.get("pages"), total))
                keep = [i for i in range(total) if i not in gone]
                if not keep:
                    raise EditError("that would delete every page")
                data = _select(data, keep)
                changes.append(f"deleted {len(gone)} page(s) ({op.get('pages')})")
            elif kind == "rotate_pages":
                deg = _int(op, n, "degrees", lo=-270, hi=270)
                if deg % 90 or deg == 0:
                    raise EditError("degrees must be 90, 180, 270 or -90")
                idx = pages_of(op.get("pages"), total)
                writer = PdfWriter(clone_from=_reader(data))
                for i in idx:
                    writer.pages[i].rotate(deg)
                data = _write(writer)
                changes.append(f"rotated {len(idx)} page(s) by {deg} degrees")
            elif kind == "reorder":
                order = op.get("order")
                if not isinstance(order, list) or sorted(map(str, order)) != sorted(
                    str(i) for i in range(1, total + 1)
                ):
                    raise EditError(
                        f"order must list every page 1-{total} once (use extract_pages to keep "
                        "only some)"
                    )
                data = _select(data, [int(x) - 1 for x in order])
                changes.append(f"pages reordered: {order[:20]}")
            elif kind == "merge_with":
                ids = op.get("file_ids")
                if not isinstance(ids, list) or not ids:
                    raise EditError("give file_ids, the PDFs to add")
                writer = PdfWriter(clone_from=_reader(data))
                added = 0
                for fid in ids:
                    blob = extra.get(str(fid))
                    if blob is None:
                        raise EditError(f"file {fid!r} could not be read")
                    other = _reader(blob)
                    writer.append(other)
                    added += len(other.pages)
                if op.get("position") == "start":
                    pages = len(writer.pages)
                    data = _select(_write(writer), list(range(total, pages)) + list(range(total)))
                else:
                    data = _write(writer)
                if total + added > MAX_PDF_PAGES:
                    raise EditError(f"the result would pass {MAX_PDF_PAGES} pages")
                changes.append(f"added {added} page(s) from {len(ids)} file(s)")
            elif kind == "stamp_text":
                text = _text_arg(op, n, "text")[:200]
                position = str(op.get("position") or "top-right")
                if position not in POSITIONS:
                    raise EditError(f"position is one of {', '.join(POSITIONS)}")
                size = _num(op, "size", 60 if position == "diagonal" else 14, 4, 200)
                default = (160, 160, 160) if position == "diagonal" else (192, 0, 0)
                idx = pages_of(op.get("pages"), total)
                data = _overlay_pages(
                    data, {i: text for i in idx}, position, size, _rgb(op.get("color"), default)
                )
                changes.append(f"stamped {text!r} on {len(idx)} page(s) ({position})")
            elif kind == "add_page_numbers":
                fmt = str(op.get("format") or "Page {n} of {total}")[:80]
                start = int(_num(op, "start", 1, 0, 100_000))
                position = str(op.get("position") or "bottom-center")
                if position not in POSITIONS or position == "diagonal":
                    raise EditError("position is top-/bottom- left, center or right")
                size = _num(op, "size", 10, 4, 72)
                idx = pages_of(op.get("pages"), total)
                last = start + len(idx) - 1

                labels = {
                    i: fmt.replace("{n}", str(start + k)).replace("{total}", str(last))
                    for k, i in enumerate(sorted(idx))
                }
                data = _overlay_pages(
                    data, labels, position, size, _rgb(op.get("color"), (0, 0, 0))
                )
                changes.append(f"numbered {len(idx)} page(s) ({position})")
            elif kind == "fill_form_fields":
                values = op.get("fields")
                if not isinstance(values, dict) or not values:
                    raise EditError("give fields, e.g. {'Name': 'Aina'}")
                reader = _reader(data)
                fields = reader.get_fields() or {}
                if not fields:
                    raise EditError("this PDF has no form fields to fill")
                unknown = [k for k in values if k not in fields]
                if unknown:
                    raise EditError(
                        f"no field {unknown[0]!r}; the fields are: " + ", ".join(list(fields)[:40])
                    )
                writer = PdfWriter(clone_from=reader)
                writer.set_need_appearances_writer(True)
                writer.update_page_form_field_values(
                    None,
                    {k: _field_value(fields[k], v) for k, v in values.items()},
                    auto_regenerate=False,
                )
                data = _write(writer)
                changes.append(
                    f"filled {len(values)} form field(s): " + ", ".join(list(values)[:8])
                )
            elif kind == "list_form_fields":
                fields = _reader(data).get_fields() or {}
                listing.append(
                    "Form fields: "
                    + (
                        "; ".join(
                            f"{k} ({str(f.get('/FT') or '').lstrip('/')}"
                            + (f", now {f.get('/V')!s}" if f.get("/V") not in (None, "") else "")
                            + ")"
                            for k, f in list(fields.items())[:80]
                        )
                        or "none"
                    )
                )
                continue
        except EditError as e:
            if str(e).startswith("operation "):
                raise
            raise EditError(f"operation {n} ({kind}): {e}") from None
        changed = True
    if not changed:
        return None, listing
    return data, changes + listing


# ---------------------------------------------------------------- PowerPoint


PPTX_OPS = ("replace_text", "list_texts")
XML_DECL = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'


def _slide_parts(z: zipfile.ZipFile) -> list[tuple[int, zipfile.ZipInfo]]:
    return sorted(
        (int(m.group(1)), i)
        for i in z.infolist()
        if (m := _SLIDE.match(i.filename)) and i.file_size <= MAX_SLIDE_XML
    )


def edit_pptx(
    data: bytes, ops: list[dict[str, Any]], ext: str = "pptx", extra: dict[str, bytes] | None = None
) -> tuple[bytes | None, list[str]]:
    from lxml import etree

    check_office_zip(data)
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
    a_p, a_t = f"{{{A_NS}}}p", f"{{{A_NS}}}t"
    changes: list[str] = []
    listing: list[str] = []
    trees: dict[str, Any] = {}
    touched: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        slides = _slide_parts(z)
        if not slides:
            raise EditError("this presentation has no slides")

        def tree(info: zipfile.ZipInfo) -> Any:
            if info.filename not in trees:
                trees[info.filename] = etree.fromstring(z.read(info), parser)
            return trees[info.filename]

        for n, op in enumerate(ops, 1):
            numbers = [s for s, _ in slides]
            chosen = slides
            if op.get("slides") not in (None, "", "all"):
                try:
                    want = {numbers[i] for i in pages_of(op.get("slides"), len(numbers))}
                except EditError as e:
                    raise EditError(
                        f"operation {n} ({op['op']}): {e}".replace("pages", "slides")
                    ) from None
                chosen = [(s, i) for s, i in slides if s in want]
            if op["op"] == "list_texts":
                for s, info in chosen:
                    lines = [
                        "".join(t.text or "" for t in nodes).strip()
                        for _, nodes in _paragraph_nodes(tree(info), a_p, a_t)
                    ]
                    listing.append(f"Slide {s}: " + " | ".join(x for x in lines if x))
                continue
            rx = _finder(op, n)
            repl = _text_arg(op, n, "replace")
            count = 0
            for _, info in chosen:
                here = sum(
                    replace_in_runs(nodes, rx, repl)
                    for _, nodes in _paragraph_nodes(tree(info), a_p, a_t)
                )
                if here:
                    touched.add(info.filename)
                    count += here
            if not count:
                _nothing(n, op, f"{op['find']!r} is not on the slides")
            changes.append(f"replaced {op['find']!r} with {repl!r} ({count}x)")
        if not changes:
            return None, listing
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as zout:
            for info in z.infolist():
                if info.filename in touched:
                    # The declaration as Office writes it (double quotes, standalone).
                    body = XML_DECL + etree.tostring(trees[info.filename], encoding="UTF-8")
                else:
                    body = z.read(info)  # every other part exactly as it was
                zout.writestr(info, body)
    return out.getvalue(), changes + listing


# ---------------------------------------------------------------- handlers


async def _docx_edit(ctx: ToolContext, args: dict[str, Any]) -> str:
    return await _run(ctx, args, ("docx",), DOCX_OPS, edit_docx)


async def _xlsx_edit(ctx: ToolContext, args: dict[str, Any]) -> str:
    return await _run(ctx, args, ("xlsx", "xlsm"), XLSX_OPS, edit_xlsx)


async def _pdf_edit(ctx: ToolContext, args: dict[str, Any]) -> str:
    extra: dict[str, bytes] = {}
    raw = args.get("operations")
    for op in raw if isinstance(raw, list) else []:
        if isinstance(op, dict) and op.get("op") == "merge_with":
            ids = op.get("file_ids")
            for fid in (ids if isinstance(ids, list) else [])[:20]:
                got = await _source(ctx, fid, ("pdf",))
                if isinstance(got, str):
                    return got
                extra[str(fid)] = got[1]
    return await _run(ctx, args, ("pdf",), PDF_OPS, edit_pdf, extra)


async def _pptx_edit(ctx: ToolContext, args: dict[str, Any]) -> str:
    return await _run(ctx, args, ("pptx",), PPTX_OPS, edit_pptx)


def _schema(ops: tuple[str, ...], name_hint: str) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "file_id": {"type": "string", "description": "The file to edit (it is not changed)"},
            "operations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"op": {"type": "string", "enum": list(ops)}},
                    "required": ["op"],
                },
                "description": 'Done in order. Add "optional": true to an operation that may '
                "find nothing.",
            },
            "file_name": {"type": "string", "description": f"Name for the new file ({name_hint})"},
        },
        "required": ["file_id", "operations"],
    }


OFFICE_EDIT_TOOLS = (
    Tool(
        "docx_edit",
        "Edit a Word file",
        "Change a Word (.docx) file and save the result as a new file next to it (the original "
        "stays). Operations, done in order: replace_text {find, replace, match_case (default "
        "true), whole_word} in the body, tables, headers and footers, keeping the formatting; "
        "append_paragraph {text, style}; insert_paragraph_after {anchor_text, text}; "
        "set_table_cell {table_index, row, col, text}; add_table_row {table_index, values[]}; "
        "delete_paragraph_containing {text}. Tables, rows and columns count from 1. Returns "
        "the new file's id.",
        _schema(DOCX_OPS, "default '<name> (edited).docx'"),
        "low",
        "allow",
        _docx_edit,
    ),
    Tool(
        "xlsx_edit",
        "Edit an Excel file",
        "Change an Excel (.xlsx/.xlsm) file and save the result as a new file next to it (the "
        "original stays; formulas, styles and macros are kept). Operations: set_cells {sheet, "
        "cells: {'B5': 120, 'C9': '=SUM(C2:C8)', 'Sheet2!A1': 'x'}}; append_rows {sheet, rows: "
        "[[...], ...]} (styled like the row above); find_replace {sheet?, find, replace}; "
        "add_sheet {name}; rename_sheet {sheet, name}; delete_rows {sheet, start, count}; "
        "set_column_width {sheet, column: 'C', width}. No sheet means the first one. For a "
        "company form use fill_form instead.",
        _schema(XLSX_OPS, "default '<name> (edited).xlsx'"),
        "low",
        "allow",
        _xlsx_edit,
    ),
    Tool(
        "pdf_edit",
        "Edit a PDF",
        "Change a PDF and save the result as a new file next to it (the original stays). "
        "Operations, in order: extract_pages {pages: '1-3,5'}; delete_pages {pages}; "
        "rotate_pages {pages, degrees: 90|180|270}; reorder {order: [3,1,2]}; merge_with "
        "{file_ids[], position: 'end'|'start'}; stamp_text {text, pages, position: "
        "top-left|top-center|top-right|center|bottom-left|bottom-center|bottom-right|diagonal, "
        "size, color '#RRGGBB'} (e.g. PAID, COPY, a reference number); fill_form_fields "
        "{fields: {name: value}} for a fillable PDF form; add_page_numbers {position, format: "
        "'Page {n} of {total}', start}; list_form_fields (only lists the field names, saves "
        "nothing). Pages count from 1; 'all', 'last' and '3-' work.",
        _schema(PDF_OPS, "default '<name> (edited).pdf'"),
        "low",
        "allow",
        _pdf_edit,
    ),
    Tool(
        "pptx_edit",
        "Edit a PowerPoint file",
        "Change the text of a PowerPoint (.pptx) file and save the result as a new file next "
        "to it (the original stays; layout, pictures and everything else are kept as they "
        "are). Operations: replace_text {find, replace, match_case, whole_word, slides: '1-3'}; "
        "list_texts {slides} (only lists each slide's text, saves nothing).",
        _schema(PPTX_OPS, "default '<name> (edited).pptx'"),
        "low",
        "allow",
        _pptx_edit,
    ),
)
