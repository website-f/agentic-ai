"""The poster spec: sizes, palettes, font sets, slots, and validate().

A spec is what the model writes, kept small on purpose:

    {"template": "event", "size": "ig-square", "palette": "ocean",
     "slots": {"kicker": "Majlis Makan Malam", "headline": "Malam Penghargaan Staf 2026",
               "details": ["Tarikh|12 Dis 2026", "Masa|8.00 malam"], "cta": "Daftar sekarang",
               "photo": "fl_..."}}

List slots take short "a|b|c" strings (one line each) rather than objects: fewer tokens.
"""

import re
from dataclasses import dataclass, field
from typing import Any

# name -> (width px, height px, paper mm or None, safe-zone fractions (top, right, bottom,
# left) the platform covers, a short use). Print sizes are 300 dpi.
SIZES: dict[str, tuple[int, int, tuple[float, float] | None, tuple[float, ...], str]] = {
    "a4-portrait": (2480, 3508, (210, 297), (0, 0, 0, 0), "print A4"),
    "a4-landscape": (3508, 2480, (297, 210), (0, 0, 0, 0), "print A4 landscape"),
    "a3-portrait": (3508, 4961, (297, 420), (0, 0, 0, 0), "print A3 notice board"),
    "a3-landscape": (4961, 3508, (420, 297), (0, 0, 0, 0), "print A3 landscape"),
    "ig-square": (1080, 1080, None, (0, 0, 0, 0), "Instagram/Facebook feed"),
    "ig-portrait": (1080, 1350, None, (0, 0, 0, 0), "Instagram 4:5 feed"),
    "ig-story": (1080, 1920, None, (0.13, 0, 0.13, 0), "Instagram/Facebook story"),
    "whatsapp-status": (1080, 1920, None, (0.1, 0, 0.1, 0), "WhatsApp status"),
    "fb-post": (1200, 630, None, (0, 0, 0, 0), "Facebook link/post"),
    "fb-cover": (1640, 624, None, (0, 0, 0, 0.0), "Facebook page cover"),
    "linkedin-post": (1200, 627, None, (0, 0, 0, 0), "LinkedIn post"),
    "linkedin-banner": (1584, 396, None, (0, 0, 0, 0.3), "LinkedIn profile banner"),
    "screen-16x9": (1920, 1080, None, (0, 0, 0, 0), "TV screen, slide, YouTube"),
}
SCREEN_DPI = 150  # the PDF page of a screen size: its pixels at 150 dpi

# Colours by role. bg/bg2: the background (bg2 the gradient's other end); ink/muted: text on
# it; accent (+ accent_ink, the text on it); surface (+ surface_ink): cards; extra: motifs.
PALETTE_KEYS = ("bg", "bg2", "ink", "muted", "accent", "accent_ink", "surface", "surface_ink")


@dataclass(frozen=True)
class Palette:
    name: str
    bg: str
    bg2: str
    ink: str
    muted: str
    accent: str
    accent_ink: str
    surface: str = "#FFFFFF"
    surface_ink: str = "#111827"
    extra: str = ""
    look: str = ""  # a few words for the description

    def get(self, key: str) -> str:
        return str(getattr(self, key, "") or "") or key


def _p(name: str, look: str, *c: str, extra: str = "") -> Palette:
    return Palette(name, *c, extra=extra or c[4], look=look)


PALETTES: dict[str, Palette] = {
    p.name: p
    for p in (
        _p(
            "midnight",
            "navy, amber accent",
            "#0F172A",
            "#1E293B",
            "#F8FAFC",
            "#CBD5E1",
            "#F59E0B",
            "#111827",
            "#FFFFFF",
            "#0F172A",
        ),
        _p(
            "ocean",
            "deep blue to teal, yellow accent",
            "#0B3B60",
            "#0E7490",
            "#FFFFFF",
            "#CFE8F3",
            "#FACC15",
            "#0B1B2B",
            "#FFFFFF",
            "#0B3B60",
        ),
        _p(
            "forest",
            "deep green, gold accent",
            "#0F3D2E",
            "#166534",
            "#F0FDF4",
            "#BBF7D0",
            "#FBBF24",
            "#1A1A1A",
            "#FFFFFF",
            "#0F3D2E",
        ),
        _p(
            "sunset",
            "rust to magenta, lemon accent",
            "#7C2D12",
            "#BE185D",
            "#FFF7ED",
            "#FED7AA",
            "#FDE047",
            "#3B0A0A",
            "#FFF7ED",
            "#431407",
        ),
        _p(
            "royal",
            "indigo to violet, pink accent",
            "#312E81",
            "#6D28D9",
            "#FFFFFF",
            "#DDD6FE",
            "#F9A8D4",
            "#1E1B4B",
            "#FFFFFF",
            "#312E81",
        ),
        _p(
            "charcoal",
            "near-black, lime accent",
            "#18181B",
            "#27272A",
            "#FAFAFA",
            "#A1A1AA",
            "#A3E635",
            "#111111",
            "#FFFFFF",
            "#18181B",
        ),
        _p(
            "coral",
            "warm cream, coral accent",
            "#FFF1EC",
            "#FFE1D6",
            "#2B1B17",
            "#6B4F47",
            "#E4572E",
            "#FFFFFF",
            "#FFFFFF",
            "#2B1B17",
        ),
        _p(
            "mint",
            "soft mint, green accent",
            "#ECFDF5",
            "#D1FAE5",
            "#052E2B",
            "#285E55",
            "#047857",
            "#FFFFFF",
            "#FFFFFF",
            "#052E2B",
        ),
        _p(
            "sand",
            "sand paper, terracotta accent",
            "#F5EFE6",
            "#EADFCF",
            "#2D2A26",
            "#6B6257",
            "#A4471F",
            "#FFFFFF",
            "#FFFDF8",
            "#2D2A26",
        ),
        _p(
            "sky",
            "white to light blue, blue accent",
            "#F8FAFC",
            "#DBEAFE",
            "#0F172A",
            "#475569",
            "#1D4ED8",
            "#FFFFFF",
            "#FFFFFF",
            "#0F172A",
        ),
        _p(
            "mono",
            "black on white",
            "#FFFFFF",
            "#F3F4F6",
            "#111111",
            "#4B5563",
            "#111111",
            "#FFFFFF",
            "#FFFFFF",
            "#111111",
        ),
        # Safety signs (ISO 7010 / MS 1184 colours): warning, prohibition, mandatory, safe.
        _p(
            "safety-yellow",
            "warning yellow and black",
            "#FFFFFF",
            "#FFF8D6",
            "#111111",
            "#3F3F46",
            "#FFC20E",
            "#111111",
            "#FFFFFF",
            "#111111",
            extra="#111111",
        ),
        _p(
            "safety-red",
            "prohibition red on white",
            "#FFFFFF",
            "#FDECEC",
            "#111111",
            "#3F3F46",
            "#C8102E",
            "#FFFFFF",
            "#FFFFFF",
            "#111111",
            extra="#111111",
        ),
        _p(
            "safety-blue",
            "mandatory blue on white",
            "#FFFFFF",
            "#E8F0FA",
            "#111111",
            "#3F3F46",
            "#005BAC",
            "#FFFFFF",
            "#FFFFFF",
            "#111111",
            extra="#111111",
        ),
        _p(
            "safety-green",
            "safe-condition green on white",
            "#FFFFFF",
            "#E7F5EC",
            "#111111",
            "#3F3F46",
            "#008542",
            "#FFFFFF",
            "#FFFFFF",
            "#111111",
            extra="#111111",
        ),
        # Festive.
        _p(
            "raya",
            "emerald green and gold",
            "#0B4D2C",
            "#127047",
            "#FFF8E1",
            "#E9D8A6",
            "#D4AF37",
            "#0B2E1B",
            "#FFFDF5",
            "#0B4D2C",
        ),
        _p(
            "cny",
            "lucky red and gold",
            "#9E0B0F",
            "#D7261E",
            "#FFF5D6",
            "#FBD9A0",
            "#F5C542",
            "#5A0A0A",
            "#FFF8E7",
            "#7A0A0A",
        ),
        _p(
            "deepavali",
            "plum and marigold",
            "#3B0A57",
            "#7A1E6C",
            "#FFF4E0",
            "#F6D7B0",
            "#FF9F1C",
            "#2A0638",
            "#FFF9F0",
            "#3B0A57",
            extra="#FFD166",
        ),
        _p(
            "christmas",
            "pine green, red and gold",
            "#0E3B2E",
            "#145A41",
            "#FFFFFF",
            "#D7EADF",
            "#C8102E",
            "#FFFFFF",
            "#FFFFFF",
            "#0E3B2E",
            extra="#E9C46A",
        ),
        _p(
            "merdeka",
            "Jalur Gemilang navy, red, yellow",
            "#010066",
            "#0B1F8A",
            "#FFFFFF",
            "#D6DBFF",
            "#FFCC00",
            "#010066",
            "#FFFFFF",
            "#010066",
            extra="#CC0001",
        ),
    )
}
BRAND_PALETTES = ("brand", "brand-dark")  # made from the company's own colour (kit accent)

FONT_SETS: dict[str, dict[str, str]] = {
    # role -> font key (engine.FONT_FILES)
    "modern": {
        "display": "poppins-extrabold",
        "head": "poppins-bold",
        "semi": "poppins-semibold",
        "body": "poppins-regular",
        "script": "parisienne",
    },
    "impact": {
        "display": "bebas",
        "head": "poppins-bold",
        "semi": "poppins-semibold",
        "body": "poppins-regular",
        "script": "parisienne",
    },
    "elegant": {
        "display": "serif",
        "head": "serif",
        "semi": "poppins-semibold",
        "body": "poppins-regular",
        "script": "parisienne",
    },
}


@dataclass(frozen=True)
class Slot:
    kind: str  # text | list | image
    max_chars: int = 0  # text: the whole value; list: each item
    max_items: int = 0
    hint: str = ""


SLOTS: dict[str, Slot] = {
    "kicker": Slot("text", 40, hint="small line above the headline"),
    "headline": Slot("text", 80, hint="the main words, ideally under 6 words"),
    "subhead": Slot("text", 140),
    "body": Slot("text", 320, hint="1-3 short sentences"),
    "big": Slot("text", 14, hint="a big number or word: 50%, RM99, 10"),
    "points": Slot("list", 90, 8, hint="short lines"),
    "details": Slot("list", 90, 6, hint="'Label|Value', e.g. 'Tarikh|12 Dis 2026'"),
    "stats": Slot("list", 60, 6, hint="'Value|Label', e.g. '98%|Kehadiran'"),
    "items": Slot("list", 90, 14, hint="'Name|Price|note'"),
    "people": Slot("list", 80, 4, hint="'Name|Role'"),
    "cta": Slot("text", 44, hint="button text"),
    "name": Slot("text", 80, hint="who it is from / who said it"),
    "ref": Slot("text", 60, hint="reference number"),
    "footer": Slot("text", 140, hint="contact, website, address"),
    "photo": Slot("image", hint="a Library picture's file id"),
}
_HEX = re.compile(r"^#?[0-9a-fA-F]{6}$")
_FILE = re.compile(r"^fl_[0-9a-z]{6,40}$")
MAX_SIZES = 4


class SpecError(ValueError):
    """Everything wrong with a spec, one problem per line, for the model to fix in one go."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("\n".join(f"- {p}" for p in problems))


@dataclass
class Spec:
    template: str
    sizes: list[str]
    slots: dict[str, Any]
    palette: str | dict[str, str]
    fonts: str
    logo: bool | str  # True: the company's logo; False: none; "fl_...": that picture
    name: str = ""
    warnings: list[str] = field(default_factory=list)

    def stored(self, size: str) -> dict[str, Any]:
        """What design_revise starts from (kept in the file's key facts)."""
        out: dict[str, Any] = {"template": self.template, "size": size, "slots": self.slots}
        if self.palette:
            out["palette"] = self.palette
        if self.fonts:
            out["fonts"] = self.fonts
        if self.logo is not True:
            out["logo"] = self.logo
        return out


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, dict):  # {"label": "Tarikh", "value": "..."} -> "Tarikh|..."
        return "|".join(str(x).strip() for x in v.values() if str(x).strip())
    if isinstance(v, list | tuple):
        return "|".join(str(x).strip() for x in v)
    s = str(v).replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n{2,}", "\n", s).strip()


def _close(word: str, options: list[str]) -> str:
    import difflib

    near = difflib.get_close_matches(word, options, n=3, cutoff=0.5)
    return f" (did you mean {', '.join(near)}?)" if near else ""


def validate(raw: dict[str, Any]) -> Spec:
    """A clean Spec, or SpecError listing every problem (names, limits, what is allowed)."""
    from .templates import TEMPLATES

    if not isinstance(raw, dict):
        raise SpecError(["the spec must be an object"])
    problems: list[str] = []
    warnings: list[str] = []
    tid = str(raw.get("template") or "").strip().lower()
    tpl = TEMPLATES.get(tid)
    if tpl is None:
        problems.append(
            f"template {tid!r} is not one of ours{_close(tid, list(TEMPLATES))}; "
            "design_templates lists them"
            if tid
            else "give template (design_templates lists them)"
        )
    size_raw = raw.get("size") or raw.get("sizes") or (tpl.sizes[0] if tpl else "ig-square")
    sizes = [
        str(s).strip().lower() for s in (size_raw if isinstance(size_raw, list) else [size_raw])
    ]
    sizes = list(dict.fromkeys(s for s in sizes if s))
    for s in sizes:
        if s not in SIZES:
            problems.append(f"size {s!r} is not one of: {', '.join(SIZES)}{_close(s, list(SIZES))}")
    if len(sizes) > MAX_SIZES:
        problems.append(f"at most {MAX_SIZES} sizes in one call")
    pal = raw.get("palette") or ""
    if isinstance(pal, str):
        pal = pal.strip().lower()
        if pal and pal not in PALETTES and pal not in BRAND_PALETTES:
            problems.append(
                f"palette {pal!r} is not one of: {', '.join([*BRAND_PALETTES, *PALETTES])}, or "
                'give colours {"bg": "#0B3B60", "accent": "#FACC15"}'
            )
    elif isinstance(pal, dict):
        clean = {}
        for k, v in pal.items():
            k = str(k).strip().lower()
            if k not in PALETTE_KEYS:
                problems.append(f"palette colour {k!r} is not one of: {', '.join(PALETTE_KEYS)}")
            elif not _HEX.match(str(v).strip()):
                problems.append(f"palette {k} must be a colour like #0B3B60, not {v!r}")
            else:
                clean[k] = "#" + str(v).strip().lstrip("#").upper()
        if not {"bg", "accent"} & set(clean) and not problems:
            problems.append("a palette of your own needs at least bg or accent")
        pal = clean
    else:
        problems.append("palette must be a name or an object of colours")
    fonts = str(raw.get("fonts") or "").strip().lower()
    if fonts and fonts not in FONT_SETS:
        problems.append(f"fonts {fonts!r} is not one of: {', '.join(FONT_SETS)}")
    logo = raw.get("logo", True)
    if isinstance(logo, str) and logo.strip().lower() in ("", "true", "yes", "company"):
        logo = True
    elif isinstance(logo, str) and logo.strip().lower() in ("false", "no", "none"):
        logo = False
    elif isinstance(logo, str):
        logo = logo.strip()
        if not _FILE.match(logo):
            problems.append(
                f"logo must be true, false or a picture's file id (fl_...), not {logo!r}"
            )
    elif not isinstance(logo, bool):
        problems.append("logo must be true, false or a picture's file id")

    slots_raw = raw.get("slots") or {}
    if not isinstance(slots_raw, dict):
        problems.append("slots must be an object of slot name -> text")
        slots_raw = {}
    # The ask's images[] list fills the photo slot.
    images = raw.get("images")
    if isinstance(images, list) and images and "photo" not in slots_raw:
        slots_raw = {**slots_raw, "photo": images[0]}
    slots: dict[str, Any] = {}
    if tpl is not None:
        allowed = tpl.slot_names()
        for k, v in slots_raw.items():
            k = str(k).strip().lower()
            if k not in allowed:
                problems.append(
                    f"template {tid} has no slot {k!r}; its slots: {', '.join(allowed)}"
                )
                continue
            sl = SLOTS[k]
            if sl.kind == "image":
                fid = _text(v)
                if fid and not _FILE.match(fid):
                    problems.append(f"{k} must be a picture's file id (fl_...), not {fid[:40]!r}")
                elif fid:
                    slots[k] = fid
            elif sl.kind == "list":
                items = v if isinstance(v, list) else [x for x in _text(v).split("\n")]
                items = [_text(x) for x in items]
                items = [x for x in items if x]
                if len(items) > sl.max_items:
                    problems.append(f"{k}: at most {sl.max_items} items (you gave {len(items)})")
                for x in items:
                    if len(x) > sl.max_chars:
                        problems.append(
                            f"{k}: {x[:30]!r}... is {len(x)} characters; keep each under "
                            f"{sl.max_chars}"
                        )
                if items:
                    slots[k] = items
            else:
                t = _text(v)
                if len(t) > sl.max_chars:
                    problems.append(
                        f"{k} is {len(t)} characters; keep it under {sl.max_chars} "
                        "(a poster is read in a few seconds)"
                    )
                if t:
                    slots[k] = t
        for k in tpl.required:
            if k not in slots:
                problems.append(f"template {tid} needs slot {k!r} ({SLOTS[k].hint or k})")
        lo, hi = tpl.list_range
        if tpl.list_slot and tpl.list_slot in slots and not lo <= len(slots[tpl.list_slot]) <= hi:
            problems.append(f"{tpl.list_slot}: give {lo} to {hi} items for template {tid}")
    if problems:
        raise SpecError(problems)
    assert tpl is not None
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", str(raw.get("name") or "")).strip()[:120]
    return Spec(
        template=tid,
        sizes=sizes,
        slots=slots,
        palette=pal,
        fonts=fonts,
        logo=logo,
        name=name,
        warnings=warnings,
    )
