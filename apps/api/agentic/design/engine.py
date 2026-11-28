"""The drawing kit posters are made with (Pillow; numpy only for smooth gradients).

Design rules kept here so no template (and no model) has to remember them:
- One unit `u` = 1% of the canvas's shorter side; every size is in units, so the same layout
  is right on a 1080 px post and a 300 dpi A3 sheet.
- Text blocks are stacked and scaled together (the type scale keeps its proportions) until
  everything fits the box; a line is only cut short ("...") when even the smallest readable
  size cannot hold it, and that is reported.
- Headlines are balanced (no lone word on the last line).
- Text colour is checked against what is actually behind it (WCAG 2.x contrast: 4.5:1, or
  3:1 for large text) and switched to white or near-black when it fails.
- Shapes are drawn supersampled (Pillow's own shapes have jagged edges).
- Characters the font cannot draw (emoji) are left out and reported, never drawn as boxes.
"""

import io
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from math import cos, pi, sin
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

from .spec import Palette

FONT_DIR = Path(__file__).parent / "fonts"
FONT_FILES = {
    "poppins-regular": "Poppins-Regular.ttf",
    "poppins-semibold": "Poppins-SemiBold.ttf",
    "poppins-bold": "Poppins-Bold.ttf",
    "poppins-extrabold": "Poppins-ExtraBold.ttf",
    "bebas": "BebasNeue-Regular.ttf",
    "serif": "DMSerifDisplay-Regular.ttf",
    "parisienne": "Parisienne-Regular.ttf",
}
FONT_LABEL = {
    "poppins-extrabold": "Poppins",
    "poppins-bold": "Poppins",
    "bebas": "Bebas Neue",
    "serif": "DM Serif Display",
    "parisienne": "Parisienne script",
}
MAX_PICTURE_PIXELS = 80_000_000
LANCZOS = Image.Resampling.LANCZOS
WHITE, NEAR_BLACK = "#FFFFFF", "#111111"
_SUBST = {
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "-",
    "•": "·",
    "…": "...",
    " ": " ",
    "−": "-",
}
_INVISIBLE = re.compile(r"[​-‏⁠︎️]")


class PictureError(ValueError):
    pass


# ---------------------------------------------------------------- fonts and text


@lru_cache(maxsize=600)
def font(key: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / FONT_FILES[key]), max(6, int(px)))


@lru_cache(maxsize=16)
def charset(key: str) -> frozenset[int]:
    from fontTools.ttLib import TTFont  # pyright: ignore[reportMissingImports]

    f = TTFont(str(FONT_DIR / FONT_FILES[key]), lazy=True)
    try:
        return frozenset(f.getBestCmap() or {})
    finally:
        f.close()


def clean(text: str, key: str) -> tuple[str, set[str]]:
    """The text with what the font cannot draw replaced or left out (and what was left out)."""
    cs = charset(key)
    out: list[str] = []
    dropped: set[str] = set()
    for ch in _INVISIBLE.sub("", text):
        if ch == "\n" or ord(ch) in cs:
            out.append(ch)
            continue
        sub = _SUBST.get(ch)
        if sub and all(ord(c) in cs for c in sub):
            out.append(sub)
        elif ch.isspace():
            out.append(" ")
        else:
            dropped.add(ch)
    return re.sub(r" {2,}", " ", "".join(out)).strip(), dropped


def width_of(s: str, f: ImageFont.FreeTypeFont, track: float = 0) -> float:
    return f.getlength(s) + track * max(0, len(s) - 1)


def wrap(text: str, f: ImageFont.FreeTypeFont, width: float, track: float = 0) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split():
            t = f"{cur} {word}" if cur else word
            if width_of(t, f, track) <= width:
                cur = t
                continue
            if cur:
                lines.append(cur)
            while width_of(word, f, track) > width and len(word) > 1:  # a very long word
                k = len(word) - 1
                while k > 1 and width_of(word[:k] + "-", f, track) > width:
                    k -= 1
                lines.append(word[:k] + "-")
                word = word[k:]
            cur = word
        if cur:
            lines.append(cur)
    return lines


def words_fit(text: str, f: ImageFont.FreeTypeFont, width: float, track: float = 0) -> bool:
    """No word is wider than the line (a word is only split as the last resort)."""
    return all(width_of(w, f, track) <= width for w in text.split())


def balanced(text: str, f: ImageFont.FreeTypeFont, width: float, track: float = 0) -> list[str]:
    """The same number of lines as a plain wrap, but as even as possible (no lone word)."""
    lines = wrap(text, f, width, track)
    if len(lines) < 2:
        return lines
    lo, hi = width * 0.45, width
    for _ in range(12):
        mid = (lo + hi) / 2
        if len(wrap(text, f, mid, track)) <= len(lines) and words_fit(text, f, mid, track):
            hi = mid
        else:
            lo = mid
    return wrap(text, f, hi + 0.5, track)


def ellipsize(line: str, f: ImageFont.FreeTypeFont, width: float, track: float = 0) -> str:
    s = line.rstrip(" .,;:")
    while s and width_of(s + "...", f, track) > width:
        s = s[:-1].rstrip()
    return (s + "...") if s else "..."


# ---------------------------------------------------------------- colour


def rgb(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def hexs(t: tuple[float, ...]) -> str:
    return "#" + "".join(f"{max(0, min(255, int(round(v)))):02X}" for v in t[:3])


def luminance(c: str | tuple[float, ...]) -> float:
    vals = rgb(c) if isinstance(c, str) else c
    out = []
    for v in vals[:3]:
        v = v / 255
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast(a: str | tuple[float, ...], b: str | tuple[float, ...]) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def mix(a: str, b: str, t: float) -> str:
    ra, rb = rgb(a), rgb(b)
    return hexs(tuple(x + (y - x) * t for x, y in zip(ra, rb, strict=True)))


def best_text(bg: str | tuple[float, ...]) -> str:
    return WHITE if contrast(WHITE, bg) >= contrast(NEAR_BLACK, bg) else NEAR_BLACK


# ---------------------------------------------------------------- geometry


def _scale_table(alpha: int) -> list[int]:
    """A point() table that scales a mask by alpha/255."""
    return [v * alpha // 255 for v in range(256)]


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    def inset(self, dx: float, dy: float | None = None) -> "Box":
        dy = dx if dy is None else dy
        return Box(self.x0 + dx, self.y0 + dy, self.x1 - dx, self.y1 - dy)

    def top(self, h: float) -> "Box":
        return Box(self.x0, self.y0, self.x1, self.y0 + h)

    def bottom(self, h: float) -> "Box":
        return Box(self.x0, self.y1 - h, self.x1, self.y1)

    def left(self, w: float) -> "Box":
        return Box(self.x0, self.y0, self.x0 + w, self.y1)

    def right(self, w: float) -> "Box":
        return Box(self.x1 - w, self.y0, self.x1, self.y1)

    def ints(self) -> tuple[int, int, int, int]:
        return int(round(self.x0)), int(round(self.y0)), int(round(self.x1)), int(round(self.y1))


def round_mask(w: int, h: int, r: float) -> Image.Image:
    m = Image.new("L", (max(1, w), max(1, h)), 255)
    r = int(min(r, w / 2, h / 2))
    if r < 1:
        return m
    ss = 4
    c = Image.new("L", (r * ss, r * ss), 0)
    ImageDraw.Draw(c).pieslice((0, 0, 2 * r * ss, 2 * r * ss), 180, 270, fill=255)
    c = c.resize((r, r), LANCZOS)
    m.paste(c, (0, 0))
    m.paste(c.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (w - r, 0))
    m.paste(c.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (0, h - r))
    m.paste(c.transpose(Image.Transpose.ROTATE_180), (w - r, h - r))
    return m


def open_picture(data: bytes, max_side: int) -> Image.Image:
    """A picture as RGBA, upright (EXIF), no larger than needed."""
    try:
        im = Image.open(io.BytesIO(data))
        if im.width * im.height > MAX_PICTURE_PIXELS:
            raise PictureError("the picture is too large (over 80 megapixels)")
        if im.format == "JPEG":
            im.draft("RGB", (max_side, max_side))
        im = ImageOps.exif_transpose(im)
        im.load()
    except PictureError:
        raise
    except Exception as e:  # noqa: BLE001 - any decoder error is "not a picture"
        raise PictureError("it is not a picture we can read (PNG, JPG or WebP)") from e
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side), LANCZOS)
    return im.convert("RGBA")


# ---------------------------------------------------------------- the canvas


ShapeFn = Callable[[ImageDraw.ImageDraw, Callable[[float, float], tuple[float, float]], int], None]


class Canvas:
    def __init__(
        self, w: int, h: int, pal: Palette, fonts: dict[str, str], safe: tuple[float, ...]
    ):
        self.w, self.h = w, h
        self.pal = pal
        self.fonts = fonts
        self.img = Image.new("RGB", (w, h), rgb(pal.bg))
        self.u = min(w, h) / 100
        m = max(0.065 * min(w, h), 0.032 * max(w, h))
        t, r, b, lf = (tuple(safe) + (0, 0, 0, 0))[:4]
        self.page = Box(0, 0, w, h)
        self.safe = Box(
            max(m, lf * w + m * 0.5), max(m, t * h), w - max(m, r * w), h - max(m, b * h)
        )
        self.notes: list[str] = []
        self.parts: list[str] = []
        self.truncated = False
        self.dropped: set[str] = set()

    @property
    def shape(self) -> str:
        if self.h / self.w >= 1.2:
            return "tall"
        if self.w / self.h >= 1.3:
            return "wide"
        return "square"

    def color(self, key: str) -> str:
        return key if key.startswith("#") else self.pal.get(key)

    def note(self, text: str) -> None:
        if text not in self.notes:
            self.notes.append(text)

    # -------------------------------------------------- filling

    def paste_color(self, color: str, pos: tuple[int, int], mask: Image.Image) -> None:
        self.img.paste(Image.new("RGB", mask.size, rgb(self.color(color))), pos, mask)

    def shape_draw(self, box: Box, fn: ShapeFn, color: str, alpha: int = 255) -> None:
        x0, y0, x1, y1 = box.inset(-2).ints()
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.w, x1), min(self.h, y1)
        w, h = x1 - x0, y1 - y0
        if w < 1 or h < 1:
            return
        area = w * h
        ss = 4 if area <= 1_000_000 else 3 if area <= 3_000_000 else 2 if area <= 9_000_000 else 1
        m = Image.new("L", (w * ss, h * ss), 0)
        fn(ImageDraw.Draw(m), lambda x, y: ((x - x0) * ss, (y - y0) * ss), ss)
        if ss > 1:
            m = m.resize((w, h), LANCZOS)
        if alpha < 255:
            m = m.point(_scale_table(alpha))
        self.paste_color(color, (x0, y0), m)

    def rect(self, box: Box, color: str, alpha: int = 255) -> None:
        x0, y0, x1, y1 = box.ints()
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return
        self.paste_color(color, (x0, y0), Image.new("L", (x1 - x0, y1 - y0), alpha))

    def rrect(self, box: Box, r: float, color: str, alpha: int = 255) -> None:
        x0, y0, x1, y1 = box.ints()
        if x1 <= x0 or y1 <= y0:
            return
        m = round_mask(x1 - x0, y1 - y0, r)
        if alpha < 255:
            m = m.point(_scale_table(alpha))
        self.paste_color(color, (x0, y0), m)

    def rrect_outline(self, box: Box, r: float, color: str, width: float) -> None:
        x0, y0, x1, y1 = box.ints()
        wd = max(1, int(round(width)))
        outer = round_mask(x1 - x0, y1 - y0, r)
        inner = Image.new("L", outer.size, 0)
        inner.paste(round_mask(x1 - x0 - 2 * wd, y1 - y0 - 2 * wd, max(0, r - wd)), (wd, wd))
        self.paste_color(color, (x0, y0), ImageChops.subtract(outer, inner))

    def ellipse(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float | None = None,
        color: str = "accent",
        alpha: int = 255,
        width: float = 0,
    ) -> None:
        ry = rx if ry is None else ry

        def fn(d: ImageDraw.ImageDraw, t: Callable, ss: int) -> None:
            a, b = t(cx - rx, cy - ry), t(cx + rx, cy + ry)
            if width:
                d.ellipse((*a, *b), outline=255, width=max(1, int(width * ss)))
            else:
                d.ellipse((*a, *b), fill=255)

        self.shape_draw(Box(cx - rx, cy - ry, cx + rx, cy + ry), fn, color, alpha)

    def polygon(self, pts: list[tuple[float, float]], color: str, alpha: int = 255) -> None:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]

        def fn(d: ImageDraw.ImageDraw, t: Callable, ss: int) -> None:
            d.polygon([t(x, y) for x, y in pts], fill=255)

        self.shape_draw(Box(min(xs), min(ys), max(xs), max(ys)), fn, color, alpha)

    def line(self, pts: list[tuple[float, float]], color: str, width: float, alpha: int = 255):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]

        def fn(d: ImageDraw.ImageDraw, t: Callable, ss: int) -> None:
            d.line(
                [t(x, y) for x, y in pts], fill=255, width=max(1, int(width * ss)), joint="curve"
            )

        self.shape_draw(Box(min(xs), min(ys), max(xs), max(ys)).inset(-width), fn, color, alpha)

    def gradient(self, box: Box, c1: str, c2: str, angle: float = 135) -> None:
        """c1 -> c2 along `angle` degrees (90: top to bottom)."""
        x0, y0, x1, y1 = box.ints()
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            return
        sw, sh = max(2, w // 8), max(2, h // 8)
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        xx *= w / max(1, sw - 1)
        yy *= h / max(1, sh - 1)
        a = np.deg2rad(angle)
        t = xx * np.cos(a) + yy * np.sin(a)
        t = (t - t.min()) / (float(np.ptp(t)) or 1.0)
        m = Image.fromarray((t * 255).astype(np.uint8), "L").resize(
            (w, h), Image.Resampling.BICUBIC
        )
        out = Image.composite(
            Image.new("RGB", (w, h), rgb(self.color(c2))),
            Image.new("RGB", (w, h), rgb(self.color(c1))),
            m,
        )
        self.img.paste(out, (x0, y0))

    def glow(self, cx: float, cy: float, r: float, color: str, strength: float = 0.5) -> None:
        box = Box(cx - r, cy - r, cx + r, cy + r)
        x0, y0, x1, y1 = box.ints()
        cx0, cy0 = max(0, x0), max(0, y0)
        cx1, cy1 = min(self.w, x1), min(self.h, y1)
        if cx1 <= cx0 or cy1 <= cy0:
            return
        n = 128
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
        d = np.sqrt((xx - n / 2) ** 2 + (yy - n / 2) ** 2) / (n / 2)
        a = np.clip(1 - d, 0, 1) ** 2 * 255 * strength
        m = Image.fromarray(a.astype(np.uint8), "L").resize(
            (x1 - x0, y1 - y0), Image.Resampling.BICUBIC
        )
        m = m.crop((cx0 - x0, cy0 - y0, cx1 - x0, cy1 - y0))
        self.paste_color(color, (cx0, cy0), m)

    def scrim(self, box: Box, color: str, a0: float, a1: float, angle: float = 90) -> None:
        """A see-through colour wash from alpha a0 to a1 (0..1) along `angle` (text on photos)."""
        x0, y0, x1, y1 = box.ints()
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            return
        sw, sh = max(2, w // 8), max(2, h // 8)
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        a = np.deg2rad(angle)
        t = (xx / max(1, sw - 1)) * np.cos(a) + (yy / max(1, sh - 1)) * np.sin(a)
        t = (t - t.min()) / (float(np.ptp(t)) or 1.0)
        t = t * t * (3 - 2 * t)  # smoothstep: a soft start, a solid end
        alpha = (a0 + (a1 - a0) * t) * 255
        m = Image.fromarray(alpha.astype(np.uint8), "L").resize((w, h), Image.Resampling.BICUBIC)
        self.paste_color(color, (x0, y0), m)

    # -------------------------------------------------- motifs

    def dots(self, box: Box, step: float, r: float, color: str, alpha: int = 255) -> None:
        rr = max(1, int(round(r)))
        ss = 4
        spr = Image.new("L", (2 * rr * ss, 2 * rr * ss), 0)
        ImageDraw.Draw(spr).ellipse((0, 0, 2 * rr * ss - 1, 2 * rr * ss - 1), fill=alpha)
        spr = spr.resize((2 * rr, 2 * rr), LANCZOS)
        col = Image.new("RGB", spr.size, rgb(self.color(color)))
        y = box.y0
        while y <= box.y1:
            x = box.x0
            while x <= box.x1:
                self.img.paste(col, (int(x - rr), int(y - rr)), spr)
                x += step
            y += step

    def rings(
        self,
        cx: float,
        cy: float,
        r0: float,
        step: float,
        n: int,
        color: str,
        width: float,
        alpha: int = 255,
    ) -> None:
        for i in range(n):
            self.ellipse(cx, cy, r0 + i * step, color=color, alpha=alpha, width=width)

    def star(
        self,
        cx: float,
        cy: float,
        r: float,
        color: str,
        points: int = 5,
        inner: float = 0.45,
        rot: float = -90,
        alpha: int = 255,
    ) -> None:
        pts = []
        for i in range(points * 2):
            rad = r if i % 2 == 0 else r * inner
            a = (rot + i * 180 / points) * pi / 180
            pts.append((cx + rad * cos(a), cy + rad * sin(a)))
        self.polygon(pts, color, alpha)

    def crescent(
        self, cx: float, cy: float, r: float, color: str, turn: float = 0.32, alpha: int = 255
    ) -> None:
        def fn(d: ImageDraw.ImageDraw, t: Callable, ss: int) -> None:
            d.ellipse((*t(cx - r, cy - r), *t(cx + r, cy + r)), fill=255)
            ox = cx + r * turn
            r2 = r * 0.82
            d.ellipse((*t(ox - r2, cy - r2 - r * 0.05), *t(ox + r2, cy + r2 - r * 0.05)), fill=0)

        self.shape_draw(Box(cx - r, cy - r, cx + r, cy + r), fn, color, alpha)

    def stripes(
        self, box: Box, color: str, band: float, angle_shift: float | None = None, alpha: int = 255
    ) -> None:
        """Diagonal hazard stripes of `color` over the box (the gaps keep what is under)."""
        shift = box.h if angle_shift is None else angle_shift

        def fn(d: ImageDraw.ImageDraw, t: Callable, ss: int) -> None:
            x = box.x0 - shift - band
            while x < box.x1 + band:
                d.polygon(
                    [
                        t(x, box.y1),
                        t(x + band, box.y1),
                        t(x + band + shift, box.y0),
                        t(x + shift, box.y0),
                    ],
                    fill=255,
                )
                x += band * 2

        self.shape_draw(box, fn, color, alpha)

    # -------------------------------------------------- pictures

    def photo(
        self, box: Box, im: Image.Image, radius: float = 0, focus: tuple[float, float] = (0.5, 0.42)
    ) -> None:
        x0, y0, x1, y1 = box.ints()
        w, h = x1 - x0, y1 - y0
        if w < 2 or h < 2:
            return
        fit = ImageOps.fit(im.convert("RGB"), (w, h), LANCZOS, centering=focus)
        mask = round_mask(w, h, radius) if radius else None
        self.img.paste(fit, (x0, y0), mask)

    def logo(self, box: Box, im: Image.Image, align: str = "left", chip: str = "") -> Box:
        """The logo contained in the box. On a background it would vanish into, it sits on a
        small white (or dark) rounded chip."""
        bb = im.getchannel("A").getbbox()
        if bb:
            im = im.crop(bb)
        scale = min(box.w / im.width, box.h / im.height)
        w, h = max(1, int(im.width * scale)), max(1, int(im.height * scale))
        x = box.x0 if align == "left" else box.x1 - w if align == "right" else box.cx - w / 2
        y = box.cy - h / 2
        small = im.resize((w, h), LANCZOS)
        under = self.sample(Box(x, y, x + w, y + h))
        opaque = small.getchannel("A").point([0] * 129 + [255] * 127)
        msk = np.asarray(opaque, dtype=bool)
        if msk.any():  # the logo's own colour: the mean of its opaque pixels
            arr = np.asarray(small.convert("RGB"), dtype=np.float32)
            mean = tuple(float(v) for v in arr[msk].mean(axis=0))
        else:
            mean = under
        placed = Box(x, y, x + w, y + h)
        if chip or contrast(mean, under) < 1.6:
            pad = h * 0.22
            chip_col = chip or (WHITE if luminance(mean) < 0.5 else "#1F2937")
            self.rrect(placed.inset(-pad), pad * 1.2, chip_col)
            self.note("logo placed on a chip so it stays visible")
        self.img.paste(small, (int(x), int(y)), small)
        return placed

    def sample(self, box: Box) -> tuple[float, float, float]:
        x0, y0, x1, y1 = box.ints()
        x0, y0 = max(0, min(self.w - 1, x0)), max(0, min(self.h - 1, y0))
        x1, y1 = max(x0 + 1, min(self.w, x1)), max(y0 + 1, min(self.h, y1))
        px = self.img.crop((x0, y0, x1, y1)).resize((1, 1), Image.Resampling.BOX)
        v = px.getpixel((0, 0))
        return v if isinstance(v, tuple) else (v, v, v)  # type: ignore[return-value]

    def readable(self, color: str, box: Box, large: bool, what: str) -> str:
        """`color`, or white/near-black when it would not be readable on what is behind."""
        under = self.sample(box)
        need = 3.0 if large else 4.5
        if contrast(self.color(color), under) >= need:
            return self.color(color)
        better = best_text(under)
        self.note(f"{what} colour changed for contrast")
        return better


# ---------------------------------------------------------------- blocks


@dataclass
class Measured:
    h: float
    ok: bool
    draw: Callable[[float, float, float], None]


class Block:
    gap: float = 2.0  # units of space after the block

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        raise NotImplementedError


def _excerpt(t: str, n: int = 48) -> str:
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 3] + "..."


@dataclass
class Text(Block):
    text: str
    role: str = "body"
    size: float = 3.4
    color: str = "ink"
    align: str = "left"
    leading: float = 1.25
    tracking: float = 0.0  # em
    upper: bool = False
    max_lines: int = 4
    balance: bool = False
    gap: float = 2.0
    min_px: float = 1.7  # units: the smallest readable size
    what: str = ""
    width_frac: float = 1.0

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        key = cv.fonts.get(self.role, self.role)
        txt, dropped = clean(self.text.upper() if self.upper else self.text, key)
        cv.dropped |= dropped
        px = max(self.min_px * cv.u, self.size * cv.u * s)
        f = font(key, round(px))
        track = self.tracking * px
        width = width * self.width_frac
        lines = (balanced if self.balance else wrap)(txt, f, width, track)
        ok = len(lines) <= self.max_lines and bool(txt) and words_fit(txt, f, width, track)
        if not ok and last and lines:
            lines = lines[: self.max_lines]
            lines[-1] = ellipsize(lines[-1], f, width, track)
            cv.truncated = True
            cv.note(f"{self.what or self.role} was cut short to fit")
        cap = -f.getbbox("H", anchor="ls")[1]
        adv = px * self.leading
        has_desc = any(re.search(r"[gjpqy,]", ln) for ln in lines[-1:])
        h = cap + (len(lines) - 1) * adv + (px * 0.24 if has_desc else px * 0.06)

        def draw(x: float, y: float, w: float) -> None:
            w = w * self.width_frac if self.align == "left" else w
            colour = cv.readable(
                self.color, Box(x, y, x + w, y + h), px >= 3.2 * cv.u, self.what or self.role
            )
            d = ImageDraw.Draw(cv.img)
            for i, ln in enumerate(lines):
                lw = width_of(ln, f, track)
                lx = (
                    x
                    if self.align == "left"
                    else x + w - lw
                    if self.align == "right"
                    else x + (w - lw) / 2
                )
                by = y + cap + i * adv
                if track:
                    cx = lx
                    for ch in ln:
                        d.text((cx, by), ch, font=f, fill=colour, anchor="ls")
                        cx += f.getlength(ch) + track
                else:
                    d.text((lx, by), ln, font=f, fill=colour, anchor="ls")
            cv.parts.append(
                f'{self.what or self.role} "{_excerpt(" ".join(lines))}" '
                f"({len(lines)} line{'s' if len(lines) != 1 else ''}, "
                f"{FONT_LABEL.get(key, 'Poppins')} {round(px)} px)"
            )

        return Measured(h, ok, draw)


@dataclass
class Pill(Block):
    text: str
    size: float = 3.0
    bg: str = "accent"
    fg: str = "accent_ink"
    align: str = "left"
    role: str = "semi"
    upper: bool = False
    tracking: float = 0.02
    outline: bool = False
    gap: float = 2.0
    what: str = "button"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        key = cv.fonts.get(self.role, self.role)
        txt, dropped = clean(self.text.upper() if self.upper else self.text, key)
        cv.dropped |= dropped
        px = max(1.6 * cv.u, self.size * cv.u * s)
        f = font(key, round(px))
        track = self.tracking * px
        padx, pady = px * 1.0, px * 0.62
        tw = width_of(txt, f, track)
        ok = tw + 2 * padx <= width
        if not ok and last:
            txt = ellipsize(txt, f, width - 2 * padx, track)
            tw = width_of(txt, f, track)
            cv.truncated = True
            cv.note(f"{self.what} text was cut short to fit")
        cap = -f.getbbox("H", anchor="ls")[1]
        h = cap + 2 * pady

        def draw(x: float, y: float, w: float) -> None:
            bw = tw + 2 * padx
            bx = (
                x
                if self.align == "left"
                else x + w - bw
                if self.align == "right"
                else x + (w - bw) / 2
            )
            box = Box(bx, y, bx + bw, y + h)
            if self.outline:
                cv.rrect_outline(box, h / 2, self.bg, max(2, px * 0.12))
                fg = cv.readable(self.bg, box, True, self.what)
            else:
                cv.rrect(box, h / 2, self.bg)
                fg = cv.readable(self.fg, box.inset(padx * 0.5, pady * 0.5), True, self.what)
            d = ImageDraw.Draw(cv.img)
            cx = bx + padx
            for ch in txt if track else [txt]:
                d.text((cx, y + pady + cap), ch, font=f, fill=fg, anchor="ls")
                cx += f.getlength(ch) + track
            cv.parts.append(f'{self.what} "{_excerpt(txt)}"')

        return Measured(h, ok, draw)


@dataclass
class Bullets(Block):
    items: list[str]
    size: float = 3.0
    marker: str = "dot"  # dot | check | num | dash | cross
    color: str = "ink"
    marker_color: str = "accent"
    cols: int = 1
    max_lines: int = 2
    gap: float = 2.2
    what: str = "list"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        key = cv.fonts["body"]
        px = max(1.7 * cv.u, self.size * cv.u * s)
        f = font(key, round(px))
        fnum = font(cv.fonts["head"], round(px * 0.8))
        cols = self.cols if width / max(1, self.cols) > 28 * px / 3 else 1
        colgap = px * 1.6
        cw = (width - colgap * (cols - 1)) / cols
        indent = px * (1.9 if self.marker == "num" else 1.45)
        adv = px * 1.28
        cap = -f.getbbox("H", anchor="ls")[1]
        laid = []
        ok = True
        for it in self.items:
            txt, dropped = clean(it, key)
            cv.dropped |= dropped
            lines = wrap(txt, f, cw - indent)
            ok = ok and words_fit(txt, f, cw - indent)
            if len(lines) > self.max_lines:
                ok = False
                if last:
                    lines = lines[: self.max_lines]
                    lines[-1] = ellipsize(lines[-1], f, cw - indent)
                    cv.truncated = True
                    cv.note(f"a {self.what} item was cut short to fit")
            laid.append(lines)
        item_gap = px * 0.62
        heights = [cap + (len(ls) - 1) * adv + px * 0.24 for ls in laid]
        per_col = -(-len(laid) // cols)
        col_h = [
            sum(heights[c * per_col : (c + 1) * per_col])
            + item_gap * max(0, len(heights[c * per_col : (c + 1) * per_col]) - 1)
            for c in range(cols)
        ]
        h = max(col_h) if col_h else 0

        def draw(x: float, y: float, w: float) -> None:
            d = ImageDraw.Draw(cv.img)
            colour = cv.readable(self.color, Box(x, y, x + w, y + h), False, self.what)
            mcol = self.color if self.marker_color == self.color else self.marker_color
            for c in range(cols):
                yy = y
                for k in range(c * per_col, min(len(laid), (c + 1) * per_col)):
                    xx = x + c * (cw + colgap)
                    mid = yy + cap * 0.55
                    mc = cv.color(mcol)
                    if self.marker == "check":
                        sz = px * 0.42
                        cv.line(
                            [
                                (xx + sz * 0.1, mid),
                                (xx + sz * 0.75, mid + sz * 0.6),
                                (xx + sz * 1.9, mid - sz * 0.75),
                            ],
                            mc,
                            px * 0.16,
                        )
                    elif self.marker == "cross":
                        sz = px * 0.36
                        cv.line([(xx, mid - sz), (xx + 2 * sz, mid + sz)], mc, px * 0.15)
                        cv.line([(xx, mid + sz), (xx + 2 * sz, mid - sz)], mc, px * 0.15)
                    elif self.marker == "num":
                        r = px * 0.62
                        cv.ellipse(xx + r, mid, r, color=mc)
                        d.text(
                            (xx + r, mid), str(k + 1), font=fnum, fill=best_text(mc), anchor="mm"
                        )
                    elif self.marker == "dash":
                        cv.rect(Box(xx, mid - px * 0.06, xx + px * 0.7, mid + px * 0.06), mc)
                    else:
                        cv.ellipse(xx + px * 0.22, mid, px * 0.2, color=mc)
                    for i, ln in enumerate(laid[k]):
                        d.text(
                            (xx + indent, yy + cap + i * adv), ln, font=f, fill=colour, anchor="ls"
                        )
                    yy += heights[k] + item_gap
            cv.parts.append(f"{self.what} of {len(laid)} ({self.marker} markers)")

        return Measured(h, ok, draw)


def _pair(item: str) -> tuple[str, str]:
    a, _, b = item.partition("|")
    return (a.strip(), b.strip()) if b.strip() else ("", a.strip())


@dataclass
class Details(Block):
    rows: list[str]  # "Label|Value"
    size: float = 3.2
    color: str = "ink"
    label_color: str = "muted"
    bar: str = "accent"
    cols: int = 1
    gap: float = 2.4
    table: bool = False  # ruled rows: label left, value right (notices)
    what: str = "details"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        px = max(1.8 * cv.u, self.size * cv.u * s)
        fv = font(cv.fonts["semi"], round(px))
        fl = font(cv.fonts["semi"], round(max(1.35 * cv.u, px * 0.56)))
        track = px * 0.56 * 0.12
        cols = self.cols if not self.table and width / max(1, self.cols) > 9 * px else 1
        colgap = px * 1.4
        cw = (width - colgap * (cols - 1)) / cols
        capv = -fv.getbbox("H", anchor="ls")[1]
        capl = -fl.getbbox("H", anchor="ls")[1]
        adv = px * 1.25
        ok = True
        laid = []
        for r in self.rows:
            lab, val = _pair(r)
            lab, d1 = clean(lab.upper(), cv.fonts["semi"])
            val, d2 = clean(val, cv.fonts["semi"])
            cv.dropped |= d1 | d2
            if self.table:
                lw = cw * 0.36
                llines = wrap(lab, fl, lw - px * 0.6, track)
                vlines = wrap(val, fv, cw - lw)
                if len(vlines) > 3 or len(llines) > 2:
                    ok = False
                    if last:
                        vlines = vlines[:3]
                        vlines[-1] = ellipsize(vlines[-1], fv, cw - lw)
                        llines = llines[:2]
                        cv.truncated = True
                        cv.note(f"a {self.what} row was cut short to fit")
                rh = max(capv + (len(vlines) - 1) * adv, capl + (len(llines) - 1) * px * 0.8)
                laid.append((llines, vlines, rh + px * 1.1))
            else:
                vlines = wrap(val, fv, cw - px * 0.75)
                ok = ok and words_fit(val, fv, cw - px * 0.75)
                if len(vlines) > 2:
                    ok = False
                    if last:
                        vlines = vlines[:2]
                        vlines[-1] = ellipsize(vlines[-1], fv, cw - px * 0.75)
                        cv.truncated = True
                        cv.note(f"a {self.what} row was cut short to fit")
                rh = (capl + px * 0.5 if lab else 0) + capv + (len(vlines) - 1) * adv + px * 0.25
                laid.append(([lab] if lab else [], vlines, rh))
        rgap = px * (0.0 if self.table else 0.8)
        per_col = -(-len(laid) // cols)
        col_h = []
        for c in range(cols):
            part = laid[c * per_col : (c + 1) * per_col]
            col_h.append(sum(p[2] for p in part) + rgap * max(0, len(part) - 1))
        h = max(col_h) if col_h else 0

        def draw(x: float, y: float, w: float) -> None:
            d = ImageDraw.Draw(cv.img)
            vcol = cv.readable(self.color, Box(x, y, x + w, y + h), px >= 3.2 * cv.u, self.what)
            lcol = cv.readable(
                self.label_color, Box(x, y, x + w, y + h), False, f"{self.what} label"
            )
            for c in range(cols):
                yy = y
                xx = x + c * (cw + colgap)
                for llines, vlines, rh in laid[c * per_col : (c + 1) * per_col]:
                    if self.table:
                        top = yy + px * 0.55
                        for i, ln in enumerate(llines):
                            cx = xx
                            for ch in ln:
                                d.text(
                                    (cx, top + capl + i * px * 0.8),
                                    ch,
                                    font=fl,
                                    fill=lcol,
                                    anchor="ls",
                                )
                                cx += fl.getlength(ch) + track
                        for i, ln in enumerate(vlines):
                            d.text(
                                (xx + cw * 0.36, top + capv + i * adv),
                                ln,
                                font=fv,
                                fill=vcol,
                                anchor="ls",
                            )
                        cv.rect(
                            Box(xx, yy + rh - max(1, px * 0.05), xx + cw, yy + rh),
                            self.label_color,
                            110,
                        )
                    else:
                        cv.rect(
                            Box(xx, yy + px * 0.05, xx + px * 0.16, yy + rh - px * 0.25), self.bar
                        )
                        tx = xx + px * 0.75
                        ty = yy
                        if llines:
                            cx = tx
                            for ch in llines[0]:
                                d.text((cx, ty + capl), ch, font=fl, fill=lcol, anchor="ls")
                                cx += fl.getlength(ch) + track
                            ty += capl + px * 0.5
                        for i, ln in enumerate(vlines):
                            d.text((tx, ty + capv + i * adv), ln, font=fv, fill=vcol, anchor="ls")
                    yy += rh + rgap
            cv.parts.append(
                f"{self.what}: {len(laid)} rows" + (" (ruled table)" if self.table else "")
            )

        return Measured(h, ok, draw)


@dataclass
class Stats(Block):
    rows: list[str]  # "Value|Label"
    size: float = 3.0
    card: str = "surface"
    card_ink: str = "surface_ink"
    value_color: str = "accent"
    gap: float = 2.4
    what: str = "stats"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        n = len(self.rows)
        if cv.shape == "tall":
            cols = {1: 1, 2: 2, 3: 3, 4: 2, 5: 2, 6: 2}.get(n, 2)
        else:
            wide = width > 60 * cv.u
            cols = {1: 1, 2: 2, 3: 3, 4: 4 if cv.shape == "wide" and wide else 2, 5: 3, 6: 3}.get(
                n, 3
            )
        gapx = cv.u * 2.0 * max(0.6, s)
        cw = (width - gapx * (cols - 1)) / cols
        px = max(1.6 * cv.u, self.size * cv.u * s)
        vkey = cv.fonts["display"]
        fl = font(cv.fonts["body"], round(px * 0.9))
        pad = px * 0.9
        ok = True
        laid = []
        for r in self.rows:
            val, lab = r.partition("|")[0].strip(), r.partition("|")[2].strip()
            val, d1 = clean(val, vkey)
            lab, d2 = clean(lab, cv.fonts["body"])
            cv.dropped |= d1 | d2
            vpx = px * 2.6
            while vpx > px * 1.2 and width_of(val, font(vkey, round(vpx))) > cw - 2 * pad:
                vpx *= 0.92
            fv = font(vkey, round(vpx))
            if width_of(val, fv) > cw - 2 * pad:
                ok = False
            lines = wrap(lab, fl, cw - 2 * pad)
            ok = ok and words_fit(lab, fl, cw - 2 * pad)
            if len(lines) > 3:
                ok = False
                if last:
                    lines = lines[:3]
                    lines[-1] = ellipsize(lines[-1], fl, cw - 2 * pad)
                    cv.truncated = True
                    cv.note(f"a {self.what} label was cut short to fit")
            laid.append((val, fv, lines))
        capl = -fl.getbbox("H", anchor="ls")[1]
        vcap = max(-f.getbbox("H", anchor="ls")[1] for _, f, _ in laid) if laid else 0
        maxl = max((len(ls) for *_, ls in laid), default=1)
        cell_h = pad + vcap + px * 0.7 + capl + (maxl - 1) * px * 1.15 + px * 0.3 + pad
        rows_n = -(-n // cols)
        gapy = gapx
        h = rows_n * cell_h + (rows_n - 1) * gapy

        def draw(x: float, y: float, w: float) -> None:
            d = ImageDraw.Draw(cv.img)
            for i, (val, fv, lines) in enumerate(laid):
                r, c = divmod(i, cols)
                in_row = min(cols, n - r * cols)
                off = (w - (in_row * cw + (in_row - 1) * gapx)) / 2  # centre a short last row
                bx = x + off + c * (cw + gapx)
                by = y + r * (cell_h + gapy)
                box = Box(bx, by, bx + cw, by + cell_h)
                if self.card:
                    cv.rrect(box, px * 0.6, self.card, 235)
                vc = cv.readable(self.value_color, box, True, "stat value")
                lc = cv.readable(self.card_ink if self.card else "ink", box, False, "stat label")
                d.text((box.cx, by + pad + vcap), val, font=fv, fill=vc, anchor="ms")
                for k, ln in enumerate(lines):
                    d.text(
                        (box.cx, by + pad + vcap + px * 0.7 + capl + k * px * 1.15),
                        ln,
                        font=fl,
                        fill=lc,
                        anchor="ms",
                    )
            cv.parts.append(f"{n} stat cards in {cols} columns")

        return Measured(h, ok, draw)


@dataclass
class Items(Block):
    rows: list[str]  # "Name|Price|note"
    size: float = 3.0
    color: str = "ink"
    price_color: str = "accent"
    note_color: str = "muted"
    cols: int = 1
    gap: float = 2.4
    what: str = "price list"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        px = max(1.7 * cv.u, self.size * cv.u * s)
        fn_ = font(cv.fonts["semi"], round(px))
        fp = font(cv.fonts["head"], round(px))
        fnote = font(cv.fonts["body"], round(px * 0.72))
        cols = self.cols if width / max(1, self.cols) > 16 * px else 1
        colgap = px * 2
        cw = (width - colgap * (cols - 1)) / cols
        cap = -fn_.getbbox("H", anchor="ls")[1]
        capn = -fnote.getbbox("H", anchor="ls")[1]
        ok = True
        laid = []
        for r in self.rows:
            parts = [p.strip() for p in r.split("|")]
            name, price, note = (parts + ["", "", ""])[:3]
            name, d1 = clean(name, cv.fonts["semi"])
            price, d2 = clean(price, cv.fonts["head"])
            note, d3 = clean(note, cv.fonts["body"])
            cv.dropped |= d1 | d2 | d3
            pw = width_of(price, fp)
            room = cw - pw - px * 1.2
            if width_of(name, fn_) > room:
                ok = False
                if last:
                    name = ellipsize(name, fn_, room)
                    cv.truncated = True
                    cv.note(f"a {self.what} name was cut short to fit")
            nlines = wrap(note, fnote, cw) if note else []
            if len(nlines) > 1:
                ok = ok and last
                nlines = nlines[:1] if last else nlines
            rh = cap + px * 0.3 + (capn + px * 0.45 + (len(nlines) - 1) * px if nlines else 0)
            laid.append((name, price, nlines, rh))
        rgap = px * 0.85
        per_col = -(-len(laid) // cols)
        col_h = []
        for c in range(cols):
            part = laid[c * per_col : (c + 1) * per_col]
            col_h.append(sum(p[3] for p in part) + rgap * max(0, len(part) - 1))
        h = max(col_h) if col_h else 0

        def draw(x: float, y: float, w: float) -> None:
            d = ImageDraw.Draw(cv.img)
            box = Box(x, y, x + w, y + h)
            nc = cv.readable(self.color, box, False, "item name")
            pc = cv.readable(self.price_color, box, True, "price")
            notec = cv.readable(self.note_color, box, False, "item note")
            for c in range(cols):
                yy = y
                xx = x + c * (cw + colgap)
                for name, price, nlines, rh in laid[c * per_col : (c + 1) * per_col]:
                    d.text((xx, yy + cap), name, font=fn_, fill=nc, anchor="ls")
                    d.text((xx + cw, yy + cap), price, font=fp, fill=pc, anchor="rs")
                    lx0 = xx + width_of(name, fn_) + px * 0.5
                    lx1 = xx + cw - width_of(price, fp) - px * 0.5
                    dot = px * 0.07
                    while lx0 < lx1:  # dotted leader
                        cv.rect(
                            Box(lx0, yy + cap - dot * 2, lx0 + dot * 2, yy + cap),
                            self.note_color,
                            160,
                        )
                        lx0 += px * 0.42
                    for i, ln in enumerate(nlines):
                        d.text(
                            (xx, yy + cap + px * 0.45 + capn + i * px),
                            ln,
                            font=fnote,
                            fill=notec,
                            anchor="ls",
                        )
                    yy += rh + rgap
            cv.parts.append(f"{self.what}: {len(laid)} items in {cols} column(s)")

        return Measured(h, ok, draw)


@dataclass
class People(Block):
    rows: list[str]  # "Name|Role"
    size: float = 3.0
    color: str = "ink"
    role_color: str = "muted"
    disc: str = "accent"
    cols: int = 2
    gap: float = 2.4

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        px = max(1.7 * cv.u, self.size * cv.u * s)
        fn_ = font(cv.fonts["semi"], round(px))
        fr = font(cv.fonts["body"], round(px * 0.78))
        fi = font(cv.fonts["head"], round(px * 0.9))
        cols = min(self.cols, len(self.rows)) if width > 40 * px / 3 * 2 else 1
        colgap = px * 1.4
        cw = (width - colgap * (cols - 1)) / cols
        disc = px * 2.6
        cap = -fn_.getbbox("H", anchor="ls")[1]
        capr = -fr.getbbox("H", anchor="ls")[1]
        ok = True
        laid = []
        for r in self.rows:
            name, role = (r.split("|") + [""])[:2]
            name, d1 = clean(name.strip(), cv.fonts["semi"])
            role, d2 = clean(role.strip(), cv.fonts["body"])
            cv.dropped |= d1 | d2
            room = cw - disc - px * 0.7
            nl = wrap(name, fn_, room)
            rl = wrap(role, fr, room) if role else []
            if len(nl) > 1 or len(rl) > 2:
                ok = False
                if last:
                    nl = [ellipsize(nl[0], fn_, room)] if nl else []
                    rl = rl[:2]
                    cv.truncated = True
                    cv.note("a speaker line was cut short to fit")
            initials = "".join(w[0] for w in name.split()[:2]).upper() or "?"
            laid.append((initials, nl, rl))
        row_h = max(disc, cap + px * 0.4 + capr + px * 1.0 * 1)
        rows_n = -(-len(laid) // cols)
        rgap = px * 0.9
        h = rows_n * row_h + (rows_n - 1) * rgap

        def draw(x: float, y: float, w: float) -> None:
            d = ImageDraw.Draw(cv.img)
            box = Box(x, y, x + w, y + h)
            nc = cv.readable(self.color, box, False, "speaker name")
            rc = cv.readable(self.role_color, box, False, "speaker role")
            for i, (ini, nl, rl) in enumerate(laid):
                r, c = divmod(i, cols)
                xx = x + c * (cw + colgap)
                yy = y + r * (row_h + rgap)
                dc = cv.color(self.disc)
                cv.ellipse(xx + disc / 2, yy + row_h / 2, disc / 2, color=dc)
                d.text(
                    (xx + disc / 2, yy + row_h / 2), ini, font=fi, fill=best_text(dc), anchor="mm"
                )
                tx = xx + disc + px * 0.7
                ty = yy + (row_h - (cap + (px * 0.4 + capr if rl else 0))) / 2
                for ln in nl[:1]:
                    d.text((tx, ty + cap), ln, font=fn_, fill=nc, anchor="ls")
                for k, ln in enumerate(rl[:1]):
                    d.text(
                        (tx, ty + cap + px * 0.4 + capr + k * px), ln, font=fr, fill=rc, anchor="ls"
                    )
            cv.parts.append(f"{len(laid)} speakers with initials discs")

        return Measured(h, ok, draw)


@dataclass
class Rule(Block):
    length: float = 10
    thickness: float = 0.55
    color: str = "accent"
    align: str = "left"
    gap: float = 2.4

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        L = min(width, self.length * cv.u * max(s, 0.6))
        t = max(2, self.thickness * cv.u * max(s, 0.6))

        def draw(x: float, y: float, w: float) -> None:
            lx = (
                x
                if self.align == "left"
                else x + (w - L) / 2
                if self.align == "center"
                else x + w - L
            )
            cv.rrect(Box(lx, y, lx + L, y + t), t / 2, self.color)

        return Measured(t, True, draw)


@dataclass
class Space(Block):
    size: float = 2.0
    gap: float = 0.0

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        return Measured(self.size * cv.u * s, True, lambda x, y, w: None)


@dataclass
class Placed:
    scale: float
    height: float
    boxes: list[Box] = field(default_factory=list)


def stack(
    cv: Canvas, box: Box, blocks: list[Any], valign: str = "top", grow: float = 1.0
) -> Placed:
    """Lay the blocks out top to bottom in the box, all at one scale: the largest (up to 1,
    or up to `grow` for content that should fill the space, like a menu) at which every
    block fits its line limits and the whole stack fits the box."""
    blocks = [b for b in blocks if b is not None]
    # Room to spare: type grows (a tall page most) rather than floating in empty space.
    grow = max(grow, 1.5 if cv.shape == "tall" else 1.25)
    if not blocks or box.w < 4 or box.h < 4:
        return Placed(1.0, 0)

    def lay(s: float, last: bool) -> tuple[list[Measured], float, bool]:
        ms = [b.measure(cv, box.w, s, last) for b in blocks]
        h = sum(m.h for m in ms) + sum(b.gap * cv.u * s for b in blocks[:-1])
        return ms, h, all(m.ok for m in ms)

    s, chosen = 1.0, None
    while s >= 0.3:
        ms, h, ok = lay(s, False)
        if ok and h <= box.h:
            chosen = (ms, h, s)
            break
        s *= 0.94
    if chosen is not None and chosen[2] == 1.0 and grow > 1.0:
        g = 1.0
        while g * 1.06 <= grow:
            ms, h, ok = lay(g * 1.06, False)
            if not ok or h > box.h * 0.92:
                break
            g *= 1.06
            chosen = (ms, h, g)
    if chosen is None:
        s = 0.3
        ms, h, _ = lay(s, True)
        while h > box.h and len(ms) > 1:  # still too tall: the last blocks are left out
            blocks = blocks[:-1]
            ms, h, _ = lay(s, True)
            cv.truncated = True
            cv.note("some text was left out: there was not room for it")
        chosen = (ms, h, s)
    ms, h, s = chosen
    if s < 0.55:
        cv.note(f"text set at {int(s * 100)}% of its full size to fit; shorter text reads better")
    extra = max(0.0, box.h - h)
    y = box.y0
    between = 0.0
    if valign == "center":
        y += extra / 2
    elif valign == "bottom":
        y += extra
    elif valign == "spread" and len(ms) > 1:
        between = min(extra / (len(ms) - 1), cv.u * 6)
        y += (extra - between * (len(ms) - 1)) / 2
    boxes = []
    for b, m in zip(blocks, ms, strict=False):
        m.draw(box.x0, y, box.w)
        boxes.append(Box(box.x0, y, box.x1, y + m.h))
        y += m.h + b.gap * cv.u * s + between
    return Placed(s, h, boxes)
