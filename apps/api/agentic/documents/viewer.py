"""P61: a file as something the browser can show without downloading it.

`view(data, name, mime, text)` answers one of:

- {"type": "table", "sheets": [{"name", "rows", "columns", "truncated"}]}  Excel and CSV/TSV
- {"type": "html", "html": "..."}   Word (and PowerPoint when python-pptx is installed)
- {"type": "text", "text": "..."}   plain text, code, and anything else with read text
- {"type": "pdf"} / {"type": "image"} / {"type": "media", "mime": "..."}  shown from the
  file itself (/preview, /download?inline=1)
- {"type": "none"}                  nothing to show

Pure functions over bytes: no database, no network. The HTML is built here from escaped text
only (never a document's own markup), with a short list of tags, so the web can render it.
"""

import csv
import datetime as dt
import html
import io
import math
import re
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Any

from .extract import sniff

MAX_ROWS = 500
MAX_COLS = 50
MAX_SHEETS = 10
MAX_TEXT = 200_000
MAX_HTML = 2_000_000
MAX_CELL = 2_000

SHEET_EXT = (".xlsx", ".xlsm", ".xls", ".xltx", ".xltm")
CSV_EXT = (".csv", ".tsv", ".tab")
TEXT_EXT = (
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".xml",
    ".log",
    ".ini",
    ".cfg",
    ".conf",
    ".toml",
    ".yaml",
    ".yml",
    ".env",
    ".sql",
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".scss",
    ".html",
    ".htm",
    ".svg",
    ".sh",
    ".bat",
    ".ps1",
    ".java",
    ".kt",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".swift",
    ".r",
    ".vue",
    ".srt",
    ".vtt",
    ".rtf",
)
MEDIA_EXT = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".weba": "audio/webm",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
}
_MEDIA_MIME = re.compile(r"^(audio|video)/[a-z0-9][a-z0-9.+-]{0,60}$")


def _ext(name: str) -> str:
    return PurePosixPath((name or "").replace("\\", "/").lower()).suffix


def media_mime(name: str, mime: str) -> str | None:
    """The audio or video type a browser may play, or None. Never anything with markup."""
    m = (mime or "").split(";")[0].strip().lower()
    if _MEDIA_MIME.match(m) and not any(w in m for w in ("xml", "html", "svg")):
        return m
    return MEDIA_EXT.get(_ext(name))


def decode(data: bytes) -> str:
    """UTF-8 (with or without a BOM), UTF-16 with a BOM, then Windows-1252, then Latin-1."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


# ---------------------------------------------------------------- tables


def _cell(v: Any) -> str | int | float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, Decimal):
        f = float(v)
        return f if math.isfinite(f) else str(v)
    if isinstance(v, dt.datetime):
        return v.isoformat(sep=" ", timespec="seconds").removesuffix(" 00:00:00")
    if isinstance(v, (dt.date, dt.time)):
        return v.isoformat()
    s = str(v)
    return s[:MAX_CELL] if s != "" else None


def _sheet(name: str, rows_in: Any) -> dict[str, Any]:
    """First MAX_ROWS rows x MAX_COLS columns, trailing empty cells and rows dropped."""
    rows: list[list[Any]] = []
    truncated = False
    pending_blank = 0  # empty rows kept only when something follows them
    for raw in rows_in:
        cells = [_cell(v) for v in raw]
        while cells and cells[-1] is None:
            cells.pop()
        if not cells:
            pending_blank += 1
            if pending_blank > 20_000:  # formatted but empty to the bottom of the sheet
                break
            continue
        if len(rows) + pending_blank >= MAX_ROWS:
            truncated = True
            break
        rows.extend([] for _ in range(pending_blank))
        pending_blank = 0
        if len(cells) > MAX_COLS:
            truncated = True
            cells = cells[:MAX_COLS]
        rows.append(cells)
    columns = max((len(r) for r in rows), default=0)
    for r in rows:
        r.extend([None] * (columns - len(r)))
    return {"name": name[:100], "rows": rows, "columns": columns, "truncated": truncated}


def excel_table(data: bytes) -> dict[str, Any]:
    """Values (not formulas) of the first MAX_SHEETS sheets. Raises when it is not a
    workbook openpyxl reads (old .xls files are not)."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        sheets = []
        for ws in wb.worksheets[:MAX_SHEETS]:
            if hasattr(ws, "reset_dimensions"):  # a wrong saved size would cut rows off
                ws.reset_dimensions()
            sheets.append(_sheet(ws.title, ws.iter_rows(values_only=True)))
    finally:
        wb.close()
    return {"type": "table", "sheets": sheets}


def csv_table(data: bytes, name: str) -> dict[str, Any]:
    body = decode(data[: 20 * 1024 * 1024])
    if _ext(name) in (".tsv", ".tab"):
        delimiter = "\t"
    else:
        try:
            delimiter = csv.Sniffer().sniff(body[:8192], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    old = csv.field_size_limit()
    csv.field_size_limit(max(old, 10 * 1024 * 1024))
    try:
        reader = csv.reader(io.StringIO(body), delimiter=delimiter)
        sheet = _sheet(PurePosixPath(name or "Sheet").stem or "Sheet", reader)
    finally:
        csv.field_size_limit(old)
    for r in sheet["rows"]:
        for i, v in enumerate(r):
            if v == "":
                r[i] = None
    return {"type": "table", "sheets": [sheet]}


# ---------------------------------------------------------------- Word


def _esc(s: str) -> str:
    return html.escape(s or "", quote=True)


def _runs_html(par: Any) -> str:
    """A paragraph's text with bold and italic, every piece escaped."""
    items = list(par.iter_inner_content()) if hasattr(par, "iter_inner_content") else par.runs
    runs: list[Any] = []
    for it in items:
        if hasattr(it, "bold"):
            runs.append(it)
        else:  # a hyperlink: its own runs
            runs.extend(getattr(it, "runs", []))
    out: list[str] = []
    for r in runs:
        t = r.text or ""
        if not t:
            continue
        piece = _esc(t)
        if r.italic:
            piece = f"<em>{piece}</em>"
        if r.bold:
            piece = f"<strong>{piece}</strong>"
        out.append(piece)
    return "".join(out)


def _list_kind(doc: Any, par: Any) -> str | None:
    """ "ul", "ol" or None: from the style name, else from the paragraph's numbering."""
    style = (getattr(par.style, "name", "") or "").lower()
    if style.startswith("list bullet"):
        return "ul"
    if style.startswith("list number"):
        return "ol"
    ppr = par._p.pPr
    numpr = ppr.numPr if ppr is not None else None
    if numpr is None or numpr.numId is None:
        return "ul" if style.startswith("list") else None
    try:
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        num_id = str(numpr.numId.val)
        ilvl = str(numpr.ilvl.val) if numpr.ilvl is not None else "0"
        numbering = doc.part.numbering_part.element
        abstract = None
        for num in numbering.findall(f"{ns}num"):
            if num.get(f"{ns}numId") == num_id:
                ref = num.find(f"{ns}abstractNumId")
                abstract = ref.get(f"{ns}val") if ref is not None else None
        for an in numbering.findall(f"{ns}abstractNum"):
            if an.get(f"{ns}abstractNumId") != abstract:
                continue
            for lvl in an.findall(f"{ns}lvl"):
                if lvl.get(f"{ns}ilvl") == ilvl:
                    fmt = lvl.find(f"{ns}numFmt")
                    val = fmt.get(f"{ns}val") if fmt is not None else "bullet"
                    return "ul" if val in ("bullet", "none") else "ol"
    except Exception:  # noqa: BLE001 - odd numbering: still a list
        return "ul"
    return "ul"


def _heading(par: Any) -> int:
    style = (getattr(par.style, "name", "") or "").lower()
    if style == "title":
        return 1
    m = re.match(r"heading (\d)", style)
    return min(int(m.group(1)), 4) if m else 0


def _table_html(table: Any) -> str:
    rows: list[list[str]] = []
    for row in table.rows:
        seen: set[int] = set()
        cells: list[str] = []
        for c in row.cells:
            if id(c._tc) in seen:  # a merged cell is listed once per column it spans
                continue
            seen.add(id(c._tc))
            cells.append(_esc(c.text.strip()))
        rows.append(cells)
    if not rows:
        return ""
    head = "".join(f"<th>{c}</th>" for c in rows[0])
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows[1:])
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def docx_html(data: bytes) -> dict[str, Any]:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(io.BytesIO(data))
    parts: list[str] = []
    size = 0
    open_list: str | None = None

    def close_list() -> None:
        nonlocal open_list
        if open_list:
            parts.append(f"</{open_list}>")
            open_list = None

    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    for el in doc.element.body.iterchildren():
        if size > MAX_HTML:
            break
        if el.tag == f"{ns}p":
            par = Paragraph(el, doc)
            inner = _runs_html(par)
            if not inner.strip():
                continue
            level = _heading(par)
            kind = None if level else _list_kind(doc, par)
            if kind:
                if open_list != kind:
                    close_list()
                    parts.append(f"<{kind}>")
                    open_list = kind
                piece = f"<li>{inner}</li>"
            else:
                close_list()
                piece = f"<h{level}>{inner}</h{level}>" if level else f"<p>{inner}</p>"
        elif el.tag == f"{ns}tbl":
            close_list()
            piece = _table_html(Table(el, doc))
        else:
            continue
        parts.append(piece)
        size += len(piece)
    close_list()
    return {"type": "html", "html": "".join(parts)}


# ---------------------------------------------------------------- PowerPoint


def pptx_html(data: bytes) -> dict[str, Any] | None:
    """One section per slide (title, then each text box's paragraphs); None when
    python-pptx is not installed."""
    try:
        from pptx import Presentation
    except ImportError:
        return None
    prs = Presentation(io.BytesIO(data))
    parts: list[str] = []
    size = 0
    for n, slide in enumerate(prs.slides, start=1):
        if size > MAX_HTML:
            break
        title_shape = slide.shapes.title
        title = (title_shape.text_frame.text if title_shape is not None else "").strip()
        body: list[str] = [f"<h3>{_esc(f'{n}. {title}' if title else str(n))}</h3>"]
        for shape in slide.shapes:
            if shape is title_shape:
                continue
            if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    t = "".join(r.text for r in p.runs).strip()
                    if t:
                        body.append(f"<p>{_esc(t)}</p>")
            elif getattr(shape, "has_table", False) and shape.has_table:
                rows = [[_esc(c.text.strip()) for c in r.cells] for r in shape.table.rows]
                if rows:
                    head = "".join(f"<th>{c}</th>" for c in rows[0])
                    tb = "".join(
                        "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows[1:]
                    )
                    body.append(f"<table><thead><tr>{head}</tr></thead><tbody>{tb}</tbody></table>")
        piece = "<section>" + "".join(body) + "</section>"
        parts.append(piece)
        size += len(piece)
    return {"type": "html", "html": "<hr>".join(parts)}


# ---------------------------------------------------------------- the choice


def _text(s: str) -> dict[str, Any]:
    return {"type": "text", "text": s[:MAX_TEXT]}


def view(data: bytes, name: str, mime: str = "", text: str = "") -> dict[str, Any]:
    """What the browser shows for this file (see the module docstring). `text` is what the
    reader already took out of it (the fallback)."""
    ext = _ext(name)
    kind = sniff(data, name, mime) if data else "other"
    fallback = _text(text) if (text or "").strip() else {"type": "none"}
    if not data:
        return fallback
    media = media_mime(name, mime)
    if media and kind not in ("pdf", "image"):
        return {"type": "media", "mime": media}
    if kind == "pdf":
        return {"type": "pdf"}
    if kind == "image":
        return {"type": "image"}
    if ext in SHEET_EXT or kind == "xlsx":
        try:
            return excel_table(data)
        except Exception:  # noqa: BLE001 - not a workbook openpyxl reads (.xls): its text
            return fallback
    if ext in CSV_EXT or kind == "csv":
        try:
            return csv_table(data, name)
        except (csv.Error, ValueError):
            return _text(decode(data[: MAX_TEXT * 4]))
    if kind == "docx" or ext == ".docx":
        try:
            return docx_html(data)
        except Exception:  # noqa: BLE001 - a damaged document: its text
            return fallback
    if kind == "pptx" or ext == ".pptx":
        try:
            return pptx_html(data) or fallback
        except Exception:  # noqa: BLE001
            return fallback
    if ext in TEXT_EXT or kind == "text" or (mime or "").startswith("text/"):
        return _text(decode(data[: MAX_TEXT * 4]))
    return fallback
