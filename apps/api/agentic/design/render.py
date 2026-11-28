"""Spec + pictures -> a PNG and a PDF, with what was drawn and what had to be adjusted."""

import io
from dataclasses import dataclass, field

from PIL import Image

from . import engine as E
from .spec import BRAND_PALETTES, PALETTES, SCREEN_DPI, SIZES, Palette, Spec
from .templates import TEMPLATES, Assets

PRINT_DPI = 300
JPEG_QUALITY = 92  # inside the PDF: 4:4:4 so small text stays crisp


@dataclass
class Rendered:
    size: str
    width: int
    height: int
    png: bytes
    pdf: bytes
    palette: str
    description: str
    notes: list[str] = field(default_factory=list)
    truncated: bool = False


def _brand(accent: str, dark: bool) -> Palette:
    acc = accent if accent else "#1D4ED8"
    if dark:
        bg = E.mix(acc, "#000000", 0.62)
        hi = E.mix(acc, "#FFFFFF", 0.55)
        if E.contrast(hi, bg) < 3:
            hi = "#FACC15"
        return Palette(
            "brand-dark",
            bg,
            E.mix(acc, "#000000", 0.32),
            "#FFFFFF",
            E.mix(acc, "#FFFFFF", 0.78),
            hi,
            E.best_text(hi),
            "#FFFFFF",
            "#111827",
            look="the company's colour, dark",
        )
    bg = E.mix(acc, "#FFFFFF", 0.94)
    a = acc
    while E.contrast(a, bg) < 3 and E.luminance(a) > 0.02:  # a pale brand colour: deepen it
        a = E.mix(a, "#000000", 0.15)
    return Palette(
        "brand",
        bg,
        E.mix(acc, "#FFFFFF", 0.8),
        "#111827",
        "#4B5563",
        a,
        E.best_text(a),
        "#FFFFFF",
        "#111827",
        look="the company's colour, light",
    )


def _custom(c: dict[str, str], accent: str) -> Palette:
    bg = c.get("bg") or ("#FFFFFF" if not c.get("accent") else E.mix(c["accent"], "#FFFFFF", 0.93))
    dark = E.luminance(bg) < 0.25
    acc = c.get("accent") or accent or ("#FACC15" if dark else "#1D4ED8")
    ink = c.get("ink") or E.best_text(bg)
    return Palette(
        "custom",
        bg,
        c.get("bg2") or E.mix(bg, acc, 0.18),
        ink,
        c.get("muted") or E.mix(ink, bg, 0.3),
        acc,
        c.get("accent_ink") or E.best_text(acc),
        c.get("surface") or "#FFFFFF",
        c.get("surface_ink") or "#111827",
        look="custom colours",
    )


def palette_for(spec: Spec, brand_accent: str) -> Palette:
    tpl = TEMPLATES[spec.template]
    p = spec.palette
    if isinstance(p, dict):
        return _custom(p, brand_accent)
    if not p:
        # The company's colour unless the template has a colour code of its own (festive,
        # safety, formal notice) or the company has none.
        own = tpl.palette.startswith(("safety", "mono")) or tpl.id.startswith("festive")
        p = tpl.brand if brand_accent and not own else tpl.palette
    if p in BRAND_PALETTES:
        return _brand(brand_accent, p == "brand-dark")
    return PALETTES[p]


def to_pdf(img: Image.Image, size: str, title: str) -> bytes:
    from fpdf import FPDF

    w, h, paper, *_ = SIZES[size]
    mm = paper or (w / SCREEN_DPI * 25.4, h / SCREEN_DPI * 25.4)
    pdf = FPDF(unit="mm", format=mm)
    pdf.set_auto_page_break(False)
    pdf.set_margin(0)
    pdf.set_title(title[:200])
    pdf.set_creator("Agentic Office posters")
    pdf.add_page()
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY, subsampling=0, optimize=True)
    buf.seek(0)
    pdf.image(buf, x=0, y=0, w=mm[0], h=mm[1])
    return bytes(pdf.output())


def render(spec: Spec, size: str, assets: Assets, brand_accent: str = "") -> Rendered:
    from .spec import FONT_SETS

    tpl = TEMPLATES[spec.template]
    w, h, paper, safe, use = SIZES[size]
    pal = palette_for(spec, brand_accent)
    fonts = FONT_SETS[spec.fonts or tpl.fonts]
    cv = E.Canvas(w, h, pal, fonts, safe)
    tpl.draw(cv, dict(spec.slots), assets)
    if cv.dropped:
        shown = "".join(sorted(cv.dropped))[:20]
        cv.note(f"left out characters the fonts cannot draw (emoji or symbols): {shown}")
    title = str(spec.slots.get("headline") or tpl.title)
    png = io.BytesIO()
    dpi = (PRINT_DPI, PRINT_DPI) if paper else (SCREEN_DPI, SCREEN_DPI)
    cv.img.save(png, "PNG", compress_level=6, dpi=dpi)
    pdf = to_pdf(cv.img, size, title)
    where = f"{paper[0]:g}x{paper[1]:g} mm at {PRINT_DPI} dpi" if paper else use
    desc = (
        f"{w}x{h} px {size} ({where}); template {tpl.id}; palette {pal.name} ({pal.look}); "
        + "; ".join(cv.parts)
    )
    return Rendered(size, w, h, png.getvalue(), pdf, pal.name, desc[:1500], cv.notes, cv.truncated)
