"""People's own Word templates: find their {{placeholders}} and fill them in place, keeping
the file's layout, fonts and letterhead.

Word often splits "{{client_name}}" across several runs; a paragraph holding a placeholder is
rewritten into its first run (so that paragraph keeps the first run's formatting). A table row
holding {{item.description}}, {{item.qty}}, {{item.unit_price}} or {{item.amount}} is repeated
once per line item.
"""

import copy
import io
import re
from collections.abc import Iterator
from typing import Any

from docx import Document as Docx
from docx.table import Table, _Row

from .fill import PLACEHOLDER, label_for, money

_ITEM = re.compile(r"\{\{\s*item\.(\w+)\s*\}\}")


def _paragraphs(doc: Any) -> Iterator[Any]:
    def walk(container: Any) -> Iterator[Any]:
        yield from container.paragraphs
        for t in getattr(container, "tables", []):
            for row in t.rows:
                for cell in row.cells:
                    yield from walk(cell)

    yield from walk(doc)
    for s in doc.sections:
        for part in (s.header, s.footer, s.first_page_header, s.first_page_footer):
            yield from walk(part)


def _set_text(p: Any, text: str) -> None:
    lines = text.split("\n")
    if not p.runs:
        p.add_run("")
    first = p.runs[0]
    for r in p.runs[1:]:
        r._r.getparent().remove(r._r)  # noqa: SLF001
    first.text = lines[0]
    for line in lines[1:]:
        first.add_break()
        first.add_text(line)


def scan(data: bytes) -> list[str]:
    """Placeholder keys in a Word file, in order of first appearance."""
    doc = Docx(io.BytesIO(data))
    seen: list[str] = []
    for p in _paragraphs(doc):
        for m in PLACEHOLDER.finditer(p.text):
            key = m.group(1)
            if key.startswith("item."):
                key = "items"
            if key not in seen:
                seen.append(key)
    return seen


def _item_rows(doc: Any, items: list[dict[str, Any]]) -> None:
    for t in doc.tables:
        for row in list(t.rows):
            text = "".join(c.text for c in row.cells)
            if not _ITEM.search(text):
                continue
            tr = row._tr  # noqa: SLF001
            for n, it in enumerate(items, 1):
                new = copy.deepcopy(tr)
                tr.addprevious(new)  # clones go above the template row, in order
                r = _Row(new, t)
                vals = {
                    "no": str(n),
                    "description": it["description"],
                    "qty": f"{it['qty']:g}",
                    "unit": it.get("unit", ""),
                    "unit_price": money(it["unit_price"]),
                    "amount": money(it["amount"]),
                }
                for cell in r.cells:
                    for p in cell.paragraphs:
                        if _ITEM.search(p.text):
                            _set_text(p, _ITEM.sub(lambda m, v=vals: v.get(m.group(1), ""), p.text))
            tr.getparent().remove(tr)
            return


def fill(
    data: bytes, ctx: dict[str, str], items: list[dict[str, Any]], fields: list[dict[str, Any]]
) -> tuple[bytes, list[str]]:
    doc = Docx(io.BytesIO(data))
    _item_rows(doc, items)
    missing: list[str] = []
    for p in _paragraphs(doc):
        if "{{" not in p.text:
            continue

        def sub(m: re.Match[str]) -> str:
            key = m.group(1)
            val = ctx.get(key, "")
            if key == "items" or val.strip() == "":
                if key != "items":
                    lab = label_for(key, fields)
                    if lab not in missing:
                        missing.append(lab)
                    return f"[[{lab}]]"
                return ""
            return val

        _set_text(p, PLACEHOLDER.sub(sub, p.text))
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue(), missing


def text_of(data: bytes) -> str:
    """The filled Word file as plain text, for previews and the simple PDF layout."""
    doc = Docx(io.BytesIO(data))
    out: list[str] = []
    for block in doc.iter_inner_content():
        if isinstance(block, Table):
            rows = [[c.text.strip().replace("\n", " ") for c in r.cells] for r in block.rows]
            if rows:
                out.append("| " + " | ".join(rows[0]) + " |")
                out.append("|" + "---|" * len(rows[0]))
                out.extend("| " + " | ".join(r) + " |" for r in rows[1:])
                out.append("")
        else:
            style = (block.style.name or "").lower() if block.style is not None else ""
            text = block.text.strip()
            if style.startswith("heading") and text:
                level = "".join(ch for ch in style if ch.isdigit()) or "2"
                out.append("#" * min(3, int(level)) + " " + text)
            else:
                out.append(text)
            out.append("")
    return "\n".join(out).strip()
