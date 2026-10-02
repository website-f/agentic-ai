"""Render a document (markdown subset + company letterhead) to PDF with fpdf2.

Pure Python: no browser and no office suite. Uses a system TrueType sans (Liberation Sans in
the container, Arial on a Windows dev box) so any Latin text, including Malay, prints
correctly; without one it falls back to Helvetica and replaces characters it cannot encode.
"""

import io
import os
import re
from dataclasses import dataclass, field
from typing import Any

from fpdf import FPDF, FontFace

from .blocks import SIGN_LINE, Block, Run, is_numeric, parse, runs

_FONT_SETS = (
    (
        "/usr/share/fonts/truetype/liberation",
        (
            "LiberationSans-Regular.ttf",
            "LiberationSans-Bold.ttf",
            "LiberationSans-Italic.ttf",
            "LiberationSans-BoldItalic.ttf",
        ),
    ),
    (
        "/usr/share/fonts/truetype/dejavu",
        (
            "DejaVuSans.ttf",
            "DejaVuSans-Bold.ttf",
            "DejaVuSans-Oblique.ttf",
            "DejaVuSans-BoldOblique.ttf",
        ),
    ),
    ("C:/Windows/Fonts", ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf")),
)
_font_cache: tuple[str, ...] | None = None


def _fonts() -> tuple[str, ...]:
    """Paths for regular, bold, italic, bold-italic, or () to use the core font."""
    global _font_cache
    if _font_cache is None:
        _font_cache = ()
        custom = os.environ.get("AGENTIC_PDF_FONT_DIR")
        sets = ((custom, _FONT_SETS[0][1]),) + _FONT_SETS if custom else _FONT_SETS
        for folder, names in sets:
            paths = tuple(os.path.join(folder, n) for n in names)
            if os.path.exists(paths[0]) and os.path.exists(paths[1]):
                # Italic files are optional: fall back to the upright ones.
                reg, bold = paths[0], paths[1]
                it = paths[2] if os.path.exists(paths[2]) else reg
                bi = paths[3] if os.path.exists(paths[3]) else bold
                _font_cache = (reg, bold, it, bi)
                break
    return _font_cache


def hex_rgb(value: str, default: tuple[int, int, int] = (19, 137, 95)) -> tuple[int, int, int]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", (value or "").strip())
    if not m:
        return default
    h = m.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


@dataclass
class Letterhead:
    name: str = ""
    lines: list[str] = field(default_factory=list)
    logo: bytes | None = None
    accent: tuple[int, int, int] = (19, 137, 95)
    footer: str = ""

    @classmethod
    def from_kit(cls, kit: dict[str, Any], logo: bytes | None = None) -> "Letterhead":
        name = str(kit.get("legal_name") or kit.get("trading_name") or "").strip()
        lines: list[str] = []
        if kit.get("reg_no"):
            reg = f"Registration No. {kit['reg_no']}"
            if kit.get("tax_no"):
                reg += f"  ·  Tax No. {kit['tax_no']}"
            lines.append(reg)
        if kit.get("address"):
            lines.append(
                ", ".join(
                    x.strip().rstrip(",") for x in str(kit["address"]).splitlines() if x.strip()
                )
            )
        contact = "  ·  ".join(str(kit[k]) for k in ("phone", "email", "website") if kit.get(k))
        if contact:
            lines.append(contact)
        foot = " · ".join(x for x in (name, str(kit.get("reg_no") or "")) if x)
        if kit.get("footer_note"):
            foot = f"{foot}  —  {kit['footer_note']}" if foot else str(kit["footer_note"])
        return cls(name, lines, logo, hex_rgb(str(kit.get("accent") or "")), foot)


class _PDF(FPDF):
    def __init__(self, lh: Letterhead | None, title: str, numbered: bool = True) -> None:
        super().__init__(format="A4", unit="mm")
        self.lh = lh
        self.numbered = numbered  # off inside a pack, which numbers every page itself
        self.doc_title = title
        self.set_margins(18, 16, 18)
        self.set_auto_page_break(True, margin=20)
        fonts = _fonts()
        if fonts:
            for style, path in zip(("", "B", "I", "BI"), fonts, strict=True):
                self.add_font("body", style, path)
            self.family = "body"
            self.unicode = True
        else:
            self.family = "helvetica"
            self.unicode = False
        self.set_title(title or "Document")
        if lh and lh.name:
            self.set_author(lh.name)
        self.alias_nb_pages()

    # ------------------------------------------------------------- text helpers

    def t(self, text: str) -> str:
        if self.unicode:
            return text
        return (
            text.replace("•", "-")
            .replace("·", "-")
            .replace("—", "-")
            .replace("–", "-")
            .replace("’", "'")
            .replace("“", '"')
            .replace("”", '"')
            .encode("latin-1", "replace")
            .decode("latin-1")
        )

    def font(self, size: float, style: str = "") -> None:
        self.set_font(self.family, style, size)

    # ------------------------------------------------------------- page furniture

    def header(self) -> None:
        lh = self.lh
        if not lh or not (lh.name or lh.logo):
            return
        if self.page_no() == 1:
            x0, y0 = self.l_margin, 12
            text_x = x0
            if lh.logo:
                try:
                    self.image(io.BytesIO(lh.logo), x=x0, y=y0, h=16)
                    text_x = x0 + 30
                except Exception:  # noqa: BLE001 - a bad logo never breaks the document
                    text_x = x0
            self.set_xy(text_x, y0)
            self.set_text_color(25, 25, 25)
            self.font(14, "B")
            self.cell(0, 7, self.t(lh.name), new_x="LMARGIN", new_y="NEXT")
            self.set_text_color(95, 95, 95)
            self.font(8.5)
            for line in lh.lines:
                self.set_x(text_x)
                self.cell(0, 4.2, self.t(line), new_x="LMARGIN", new_y="NEXT")
            y = max(self.get_y(), y0 + 17) + 2.5
            self.set_draw_color(*lh.accent)
            self.set_line_width(0.6)
            self.line(self.l_margin, y, self.w - self.r_margin, y)
            self.set_line_width(0.2)
            self.set_y(y + 6)
        else:
            self.set_text_color(130, 130, 130)
            self.font(8)
            self.set_y(9)
            self.cell(0, 4, self.t(f"{lh.name}  ·  {self.doc_title}"), align="R")
            self.set_y(18)
        self.set_text_color(25, 25, 25)

    def footer(self) -> None:
        self.set_y(-13)
        self.set_text_color(140, 140, 140)
        self.font(7.5)
        foot = self.lh.footer if self.lh else ""
        self.cell(0, 4, self.t(foot[:140]), align="L")
        if self.numbered:
            self.set_x(self.l_margin)
            self.cell(0, 4, f"Page {self.page_no()} of {{nb}}", align="R")
        self.set_text_color(25, 25, 25)

    # ------------------------------------------------------------- blocks

    def write_runs(self, rs: list[Run], size: float, h: float) -> None:
        for r in rs:
            style = ("B" if r.bold else "") + ("I" if r.italic else "")
            self.font(size, style)
            self.write(h, self.t(r.text))

    def block(self, b: Block) -> None:
        if b.kind == "heading":
            size = {1: 15, 2: 12.5, 3: 11}.get(b.level, 11)
            self.ln(2.5 if b.level > 1 else 1)
            self.set_x(self.l_margin)
            self.font(size, "B")
            text = self.t("".join(r.text for r in runs(b.lines[0])))
            self.multi_cell(0, size * 0.5, text, new_x="LMARGIN", new_y="NEXT")
            self.ln(1.2)
        elif b.kind == "para":
            for line in b.lines:
                if SIGN_LINE.match(line):
                    self.ln(12)  # room to sign above the line
                self.set_x(self.l_margin)
                self.write_runs(runs(line), 10, 5)
                self.ln(5)
            self.ln(2)
        elif b.kind == "note":
            self.set_text_color(90, 90, 90)
            for line in b.lines:
                self.set_x(self.l_margin + 3)
                self.write_runs([Run(r.text, r.bold, True) for r in runs(line)], 9.5, 4.8)
                self.ln(4.8)
            self.set_text_color(25, 25, 25)
            self.ln(2)
        elif b.kind in ("bullets", "numbers"):
            left = self.l_margin
            for n, item in enumerate(b.lines, 1):
                mark = "•" if b.kind == "bullets" else f"{n}."
                self.set_x(left + 1.5)
                self.font(10)
                self.write(5, self.t(mark))
                self.set_left_margin(left + 7)
                self.set_x(left + 7)
                self.write_runs(runs(item), 10, 5)
                self.ln(5.6)
                self.set_left_margin(left)
            self.ln(1.5)
        elif b.kind == "rule":
            self.ln(1)
            self.set_draw_color(200, 200, 200)
            y = self.get_y()
            self.line(self.l_margin, y, self.w - self.r_margin, y)
            self.ln(3)
        elif b.kind == "pagebreak":
            self.add_page()
        elif b.kind == "table":
            self.table_block(b)

    def table_block(self, b: Block) -> None:
        cols = len(b.header)
        if not cols:
            return
        lens = [
            max([len(b.header[c])] + [len(r[c]) for r in b.rows if c < len(r)]) for c in range(cols)
        ]
        widths = [max(6, min(48, n)) for n in lens]
        aligns = []
        # Totals rows (blank first cell) carry labels; judge alignment by the item rows.
        body = [r for r in b.rows if r and r[0].strip()] or b.rows
        for c in range(cols):
            cells = [r[c] for r in body if c < len(r) and r[c].strip()]
            num = cells and sum(is_numeric(x) for x in cells) >= max(1, len(cells) * 0.6)
            aligns.append("RIGHT" if num else "LEFT")
        accent = self.lh.accent if self.lh else (19, 137, 95)
        light = tuple(int(255 - (255 - v) * 0.12) for v in accent)
        self.font(9)
        self.ln(1)

        def md(text: str) -> str:
            out = []
            for r in runs(text):
                piece = self.t(r.text).replace("--", "- -")
                if r.bold and r.text.strip():
                    piece = f"**{piece}**"
                elif r.italic and r.text.strip():
                    piece = f"__{piece}__"
                out.append(piece)
            return "".join(out)

        with self.table(
            col_widths=tuple(widths),
            text_align=tuple(aligns),
            markdown=True,
            line_height=4.8,
            padding=1.6,
            headings_style=FontFace(emphasis="BOLD", fill_color=light),  # type: ignore[arg-type]
            borders_layout="SINGLE_TOP_LINE",
            first_row_as_headings=True,
        ) as table:
            head = table.row()
            for c in b.header:
                head.cell(md(c))
            for r in b.rows:
                row = table.row()
                for c in r[:cols]:
                    row.cell(md(c))
        self.ln(3)


def render(
    markdown: str, title: str = "", lh: Letterhead | None = None, numbered: bool = True
) -> bytes:
    pdf = _PDF(lh, title, numbered)
    pdf.add_page()
    for b in parse(markdown):
        pdf.block(b)
    return bytes(pdf.output())


def new_pdf(title: str = "", lh: Letterhead | None = None, numbered: bool = True) -> _PDF:
    """A blank document with the same fonts and furniture (packs build covers with it)."""
    return _PDF(lh, title, numbered)
