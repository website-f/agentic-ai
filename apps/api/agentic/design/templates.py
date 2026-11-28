"""The poster templates: a named layout each, with named slots, a palette and fonts.

Every template adapts to the canvas: tall (A4/A3 portrait, story, WhatsApp status), square
(feed post) and wide (landscape, Facebook/LinkedIn, banner). Text goes through engine.stack,
so long Malay lines shrink and wrap instead of overflowing; a template never needs the model
to say where anything goes.

Design references the layouts follow (re-implemented, nothing copied): the Swiss/International
grid (one strong headline, generous margins, left-aligned rag), the "big number" promo and
infographic patterns, ISO 7010 safety-sign colours (MS ISO 7010 in Malaysia), formal notice
layouts of Malaysian tender adverts (ruled label/value table), and festive greeting cards
(centred script greeting, motifs at the edges, the message small).
"""

from collections.abc import Callable
from dataclasses import dataclass
from math import cos, pi, sin
from typing import Any

from PIL import Image, ImageDraw

from . import engine as E
from .engine import Box, Canvas, Details, Measured, Pill, Rule, Stats, Text, stack
from .spec import SLOTS


@dataclass
class Assets:
    photo: Image.Image | None = None
    logo: Image.Image | None = None
    brand: str = ""  # the company's name, when there is no logo


@dataclass(frozen=True)
class Template:
    id: str
    title: str
    use: str
    slots: tuple[str, ...]
    required: tuple[str, ...]
    palette: str
    fonts: str
    sizes: tuple[str, ...]
    draw: Callable[[Canvas, dict[str, Any], Assets], None]
    list_slot: str = ""
    list_range: tuple[int, int] = (0, 99)
    brand: str = "brand-dark"  # which company-colour palette suits it

    def slot_names(self) -> list[str]:
        return list(self.slots)


# ---------------------------------------------------------------- shared pieces


def _t(sl: dict[str, Any], k: str) -> str:
    return str(sl.get(k) or "")


def header(cv: Canvas, area: Box, a: Assets, align: str = "left") -> Box:
    """The logo (or the company's name) at the top of the area; the rest of the area back."""
    h = min(cv.u * (6.5 if cv.shape != "wide" else 8.5), area.h * 0.14)
    if a.logo is not None:
        cv.logo(area.top(h), a.logo, align)
        cv.parts.append(f"company logo at the top {align}")
        return Box(area.x0, area.y0 + h + cv.u * 3.2, area.x1, area.y1)
    if a.brand:
        p = stack(
            cv,
            area.top(h),
            [
                Text(
                    a.brand,
                    "semi",
                    2.6,
                    "ink",
                    align,
                    max_lines=1,
                    upper=True,
                    tracking=0.12,
                    what="company name",
                )
            ],
        )
        return Box(area.x0, area.y0 + p.height + cv.u * 3, area.x1, area.y1)
    return area


def footer(cv: Canvas, area: Box, text: str, align: str = "left", color: str = "muted") -> Box:
    if not text:
        return area
    blk = Text(text, "body", 2.4, color, align, max_lines=2, what="footer", min_px=1.4)
    m = blk.measure(cv, area.w, 1.0, False)
    s = 1.0
    while not m.ok and s > 0.5:
        s *= 0.9
        m = blk.measure(cv, area.w, s, False)
    if not m.ok:
        m = blk.measure(cv, area.w, s, True)
    m.draw(area.x0, area.y1 - m.h, area.w)
    return Box(area.x0, area.y0, area.x1, area.y1 - m.h - cv.u * 3)


def kicker_pill(sl: dict[str, Any], align: str = "left", **kw: Any) -> Pill | None:
    k = _t(sl, "kicker")
    return (
        Pill(k, 2.6, align=align, upper=True, tracking=0.08, gap=2.6, what="kicker", **kw)
        if k
        else None
    )


def kicker_text(sl: dict[str, Any], align: str = "left", color: str = "accent") -> Text | None:
    k = _t(sl, "kicker")
    return (
        Text(
            k,
            "semi",
            2.7,
            color,
            align,
            upper=True,
            tracking=0.14,
            max_lines=2,
            gap=1.8,
            what="kicker",
        )
        if k
        else None
    )


def headline(
    sl: dict[str, Any],
    size: float = 9.5,
    align: str = "left",
    role: str = "display",
    color: str = "ink",
    upper: bool = False,
    lines: int = 4,
    gap: float = 2.6,
) -> Text:
    return Text(
        _t(sl, "headline"),
        role,
        size,
        color,
        align,
        leading=1.06 if role != "script" else 1.15,
        upper=upper,
        max_lines=lines,
        balance=True,
        gap=gap,
        what="headline",
        min_px=2.2,
    )


def subhead(
    sl: dict[str, Any],
    align: str = "left",
    color: str = "muted",
    size: float = 4.0,
    role: str = "body",
) -> Text | None:
    t = _t(sl, "subhead")
    return (
        Text(t, role, size, color, align, max_lines=3, balance=True, what="subhead") if t else None
    )


def body(
    sl: dict[str, Any], align: str = "left", color: str = "ink", size: float = 3.2
) -> Text | None:
    t = _t(sl, "body")
    return (
        Text(t, "body", size, color, align, leading=1.38, max_lines=7, what="body") if t else None
    )


def cta(sl: dict[str, Any], align: str = "left", **kw: Any) -> Pill | None:
    t = _t(sl, "cta")
    return Pill(t, 3.0, align=align, gap=2.0, what="button", **kw) if t else None


def details(sl: dict[str, Any], cols: int = 1, **kw: Any) -> Details | None:
    rows = sl.get("details") or []
    return Details(rows, cols=cols, **kw) if rows else None


def points(sl: dict[str, Any], marker: str = "dot", **kw: Any) -> E.Bullets | None:
    rows = sl.get("points") or []
    return E.Bullets(rows, marker=marker, **kw) if rows else None


def bg_gradient(cv: Canvas, angle: float = 125) -> None:
    cv.gradient(cv.page, "bg", "bg2", angle)
    cv.parts.append(f"background {cv.pal.look or cv.pal.name} gradient")


def bg_solid(cv: Canvas) -> None:
    cv.parts.append(f"background {cv.pal.look or cv.pal.name}")


def photo_note(cv: Canvas, where: str) -> None:
    cv.parts.append(f"photo {where}")


def split_areas(cv: Canvas, ratio: float) -> tuple[Box, Box]:
    """(photo panel, text area) for a photo + text layout on this canvas's shape."""
    W, H = cv.w, cv.h
    s = cv.safe
    if cv.shape == "wide":
        pw = W * ratio
        return Box(W - pw, 0, W, H), Box(s.x0, s.y0, W - pw - cv.u * 5, s.y1)
    ph = H * ratio * (0.92 if cv.shape != "tall" else 0.85 if H / W > 1.6 else 1.0)
    return Box(0, 0, W, ph), Box(s.x0, max(s.y0, ph + cv.u * 5), s.x1, s.y1)


@dataclass
class Badge(E.Block):
    """A big number or word in a starburst (sale) or a disc (price)."""

    text: str
    size: float = 30
    burst: bool = True
    color: str = "accent"
    ink: str = "accent_ink"
    align: str = "left"
    gap: float = 2.6
    what: str = "badge"

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        D = min(width, self.size * cv.u * s)
        key = cv.fonts["display"]
        txt, dropped = E.clean(self.text, key)
        cv.dropped |= dropped
        px = D * 0.42
        while px > 8 and E.width_of(txt, E.font(key, round(px))) > D * 0.68:
            px *= 0.93
        f = E.font(key, round(px))

        def draw(x: float, y: float, w: float) -> None:
            cx = (
                x + D / 2
                if self.align == "left"
                else x + w - D / 2
                if self.align == "right"
                else x + w / 2
            )
            cy = y + D / 2
            col = cv.color(self.color)
            if self.burst:
                cv.star(cx, cy, D / 2, col, points=18, inner=0.86, rot=0)
            else:
                cv.ellipse(cx, cy, D / 2, color=col)
            cv.ellipse(
                cx, cy, D / 2 * 0.78, color=E.best_text(col), alpha=60, width=max(2, D * 0.012)
            )
            ImageDraw.Draw(cv.img).text((cx, cy), txt, font=f, fill=E.best_text(col), anchor="mm")
            cv.parts.append(f'{self.what} "{txt}" in a {"starburst" if self.burst else "disc"}')

        return Measured(D, bool(txt), draw)


@dataclass
class Sign(E.Block):
    """An ISO 7010-style safety sign: warning triangle, prohibition, mandatory or safe."""

    kind: str = "warning"
    size: float = 22
    align: str = "center"
    gap: float = 3.0

    def measure(self, cv: Canvas, width: float, s: float, last: bool) -> Measured:
        D = min(width, self.size * cv.u * max(s, 0.5))

        def draw(x: float, y: float, w: float) -> None:
            cx = x + D / 2 if self.align == "left" else x + w / 2
            cy = y + D / 2
            r = D / 2
            ex = E.font("poppins-extrabold", round(D * 0.5))
            d = ImageDraw.Draw(cv.img)
            if self.kind == "warning":
                pts = [(cx, cy - r), (cx + r * 1.08, cy + r * 0.86), (cx - r * 1.08, cy + r * 0.86)]
                cv.polygon(pts, "#111111")
                k = 0.78
                inner = [
                    (cx, cy - r * k + r * 0.08),
                    (cx + r * 1.08 * k, cy + r * 0.86 * k + r * 0.02),
                    (cx - r * 1.08 * k, cy + r * 0.86 * k + r * 0.02),
                ]
                cv.polygon(inner, "#FFC20E")
                d.text((cx, cy + r * 0.32), "!", font=ex, fill="#111111", anchor="ms")
            elif self.kind == "prohibition":
                cv.ellipse(cx, cy, r, color="#C8102E")
                cv.ellipse(cx, cy, r * 0.78, color="#FFFFFF")
                cv.line(
                    [(cx - r * 0.55, cy - r * 0.55), (cx + r * 0.55, cy + r * 0.55)],
                    "#C8102E",
                    r * 0.2,
                )
            elif self.kind == "mandatory":
                cv.ellipse(cx, cy, r, color="#005BAC")
                d.text((cx, cy + r * 0.3), "!", font=ex, fill="#FFFFFF", anchor="ms")
            else:
                cv.rrect(Box(cx - r, cy - r, cx + r, cy + r), r * 0.18, "#008542")
                cv.line(
                    [
                        (cx - r * 0.45, cy + r * 0.02),
                        (cx - r * 0.1, cy + r * 0.38),
                        (cx + r * 0.5, cy - r * 0.35),
                    ],
                    "#FFFFFF",
                    r * 0.16,
                )
            cv.parts.append(f"{self.kind} safety sign")

        return Measured(D, True, draw)


# ---------------------------------------------------------------- templates


def _event(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    photo = a.photo
    if photo is not None and cv.shape != "wide":
        cv.photo(cv.page, photo)
        cv.scrim(cv.page, "bg", 0.15, 0.94, 90)
        photo_note(cv, "full-bleed behind a dark fade")
        area = header(cv, cv.safe, a)
        area = Box(area.x0, area.y0 + area.h * 0.28, area.x1, area.y1)
    elif photo is not None:
        panel, area = split_areas(cv, 0.44)
        bg_gradient(cv)
        cv.photo(panel, photo)
        photo_note(cv, "on the right")
        area = header(cv, area, a)
    else:
        bg_gradient(cv)
        W, H, u = cv.w, cv.h, cv.u
        cv.rings(W * 0.92, H * 0.06, u * 14, u * 5, 6, "accent", max(2, u * 0.45), alpha=90)
        cv.glow(W * 0.1, H * 0.95, u * 55, "accent", 0.35)
        cv.dots(Box(W * 0.62, H * 0.72, W * 0.98, H * 0.98), u * 3.2, u * 0.32, "ink", 60)
        area = header(cv, cv.safe, a)
    area = footer(cv, area, _t(sl, "footer"))
    stack(
        cv,
        area,
        [
            kicker_pill(sl),
            headline(sl, 10.5 if cv.shape == "tall" else 9.0),
            subhead(sl),
            Rule(),
            details(sl, cols=2 if cv.shape == "wide" or len(sl.get("details") or []) > 3 else 1),
            cta(sl),
        ],
        "bottom" if photo is not None and cv.shape != "wide" else "center",
    )


def _announcement(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_solid(cv)
    cv.ellipse(W * 1.02, H * 0.98, u * 48, color="accent", alpha=36)
    cv.ellipse(W * 1.02, H * 0.98, u * 32, color="accent", alpha=40)
    cv.rect(Box(0, 0, u * 2.2, H), "accent")
    area = header(cv, cv.safe, a)
    if a.photo is not None:
        ph = area.h * (0.3 if cv.shape == "tall" else 0.36)
        if cv.shape == "wide":
            pw = area.w * 0.38
            cv.photo(Box(area.x1 - pw, area.y0, area.x1, area.y1), a.photo, radius=u * 2)
            area = Box(area.x0, area.y0, area.x1 - pw - u * 4, area.y1)
        else:
            cv.photo(area.top(ph), a.photo, radius=u * 2)
            area = Box(area.x0, area.y0 + ph + u * 4, area.x1, area.y1)
        photo_note(cv, "in a rounded frame")
    area = footer(cv, area, _t(sl, "footer"))
    stack(
        cv,
        area,
        [
            kicker_pill(sl),
            headline(sl, 8.6, role="head"),
            subhead(sl, color="ink"),
            Rule(14),
            body(sl),
            details(sl, cols=2 if cv.shape == "wide" else 1),
            cta(sl),
        ],
        "center",
    )


def _hiring(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 160)
    area = cv.safe
    if a.photo is not None:
        panel, area = split_areas(cv, 0.36 if cv.shape == "tall" else 0.4)
        cv.photo(panel, a.photo)
        cv.scrim(panel, "bg", 0.0, 0.35, 90)
        photo_note(cv, "as a banner panel")
    else:
        cv.stripes(Box(W * 0.55, 0, W, u * 3.2), "accent", u * 2.2, alpha=200)
        cv.dots(Box(W * 0.74, H * 0.8, W * 0.98, H * 0.97), u * 3, u * 0.35, "accent", 90)
        cv.ellipse(W * 0.02, H * 1.0, u * 36, color="accent", alpha=30, width=u * 0.6)
    area = header(cv, area, a)
    area = footer(cv, area, _t(sl, "footer"))
    kick = _t(sl, "kicker")
    stack(
        cv,
        area,
        [
            Text(
                kick,
                "display",
                14 if cv.shape != "wide" else 12,
                "accent",
                upper=True,
                leading=0.95,
                max_lines=2,
                balance=True,
                gap=1.6,
                what="kicker",
            )
            if kick
            else None,
            headline(sl, 7.2, role="head"),
            subhead(sl),
            points(sl, "check", size=3.1, cols=2 if cv.shape == "wide" else 1),
            details(sl, cols=2 if cv.shape != "tall" else 1, size=3.0),
            cta(sl),
        ],
        "center",
    )


def _sale(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 110)
    cv.glow(W * 0.85, H * 0.15, u * 60, "accent", 0.3)
    for i in range(14):  # confetti
        x = W * ((i * 37 % 100) / 100)
        y = H * ((i * 53 % 100) / 100)
        cv.ellipse(x, y, u * (0.5 + (i % 3) * 0.35), color="accent" if i % 2 else "ink", alpha=120)
    area = cv.safe
    if a.photo is not None:
        panel, area = split_areas(cv, 0.42)
        cv.photo(panel, a.photo)
        photo_note(cv, "of the product")
    area = header(cv, area, a)
    area = footer(cv, area, _t(sl, "footer"))
    big = _t(sl, "big")
    wide = cv.shape == "wide"
    blocks = [
        kicker_text(sl, color="ink"),
        headline(sl, 9 if not wide else 7.5, upper=True),
        subhead(sl, color="ink"),
        details(sl, cols=2 if wide else 1, size=2.9),
        cta(sl),
    ]
    if big and wide and a.photo is None:
        bw = min(area.h, area.w * 0.4)
        Badge(big, size=bw / u).measure(cv, bw, 1.0, False).draw(area.x1 - bw, area.cy - bw / 2, bw)
        stack(cv, Box(area.x0, area.y0, area.x1 - bw - u * 4, area.y1), blocks, "center")
    else:
        stack(
            cv,
            area,
            [Badge(big, size=34 if cv.shape == "tall" else 26) if big else None, *blocks],
            "center",
        )


SIGN_OF = {"safety-red": "prohibition", "safety-blue": "mandatory", "safety-green": "safe"}


def _safety(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_solid(cv)
    band = u * (13 if cv.shape != "wide" else 15)
    cv.rect(Box(0, 0, W, band), "accent")
    hazard = cv.pal.name in ("safety-yellow",) or not cv.pal.name.startswith("safety")
    if hazard:
        cv.stripes(Box(0, H - u * 3.2, W, H), "#111111", u * 2.4)
        cv.rect(Box(0, H - u * 3.2 - u * 0.5, W, H - u * 3.2), "#111111")
    else:
        cv.rect(Box(0, H - u * 2.4, W, H), "accent")
    s = cv.safe
    top = Box(s.x0, u * 2.5, s.x1, band - u * 2.5)
    kick = _t(sl, "kicker")
    if a.logo is not None:
        lw = min(top.w * 0.25, top.h * 3)
        cv.logo(Box(top.x1 - lw, top.y0, top.x1, top.y1), a.logo, "right", chip="#FFFFFF")
        top = Box(top.x0, top.y0, top.x1 - lw - u * 3, top.y1)
    if kick:
        stack(
            cv,
            top,
            [
                Text(
                    kick,
                    "display",
                    8.5,
                    "accent_ink",
                    upper=True,
                    max_lines=1,
                    tracking=0.04,
                    what="kicker",
                    min_px=2,
                )
            ],
            "center",
        )
    cv.parts.append(
        f"{cv.pal.look} header band" + (" with hazard stripes at the foot" if hazard else "")
    )
    area = Box(s.x0, band + u * 5, s.x1, H - u * 6)
    area = footer(cv, area, _t(sl, "footer"), color="ink")
    kind = SIGN_OF.get(cv.pal.name, "warning")
    wide = cv.shape == "wide"
    if wide:
        sz = min(area.h * 0.8, area.w * 0.3)
        Sign(kind, size=sz / u).measure(cv, sz, 1.0, False).draw(area.x0, area.cy - sz / 2, sz)
        area = Box(area.x0 + sz + u * 5, area.y0, area.x1, area.y1)
    stack(
        cv,
        area,
        [
            None if wide else Sign(kind, size=24 if cv.shape == "tall" else 18),
            headline(sl, 8.4, align="left" if wide else "center", upper=True, role="display"),
            subhead(sl, align="left" if wide else "center", color="ink"),
            points(sl, "num", size=3.3, cols=2 if wide and len(sl.get("points") or []) > 4 else 1),
            body(sl),
        ],
        "center",
    )


def _training(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 135)
    cv.rings(W * 0.95, H * 0.03, u * 10, u * 4, 5, "accent", max(2, u * 0.35), alpha=80)
    s = cv.safe
    wide = cv.shape == "wide"
    if wide:
        left = Box(s.x0, s.y0, s.x0 + s.w * 0.45, s.y1)
        card = Box(left.x1 + u * 4, s.y0, s.x1, s.y1)
    else:
        frac = 0.4 if cv.shape == "tall" else 0.44
        left = Box(s.x0, s.y0, s.x1, s.y0 + s.h * frac)
        card = Box(s.x0, left.y1 + u * 3, s.x1, s.y1)
    left = header(cv, left, a)
    if a.photo is not None and wide:
        ph = left.h * 0.35
        cv.photo(left.bottom(ph), a.photo, radius=u * 2)
        left = Box(left.x0, left.y0, left.x1, left.y1 - ph - u * 3)
        photo_note(cv, "under the title")
    stack(
        cv, left, [kicker_pill(sl), headline(sl, 8.2), subhead(sl)], "center" if wide else "bottom"
    )
    cv.rrect(card, u * 3, "surface")
    cv.parts.append("white content card")
    inner = card.inset(u * 4.5)
    inner = footer(cv, inner, _t(sl, "footer"), color="muted")
    stack(
        cv,
        inner,
        [
            points(
                sl,
                "num",
                size=3.0,
                color="surface_ink",
                cols=2 if not wide and len(sl.get("points") or []) > 4 else 1,
            ),
            details(sl, cols=2, size=2.9, color="surface_ink", label_color="#6B7280"),
            cta(sl),
        ],
        "spread",
    )


FESTIVE = {
    "festive-raya": ("raya", "Hari Raya Aidilfitri / Aidiladha"),
    "festive-cny": ("cny", "Chinese New Year"),
    "festive-deepavali": ("deepavali", "Deepavali"),
    "festive-christmas": ("christmas", "Christmas"),
    "festive-merdeka": ("merdeka", "Merdeka / Hari Malaysia"),
}


def _motif_raya(cv: Canvas) -> None:
    W, H, u = cv.w, cv.h, cv.u
    gold = cv.color("accent")
    for i, x in enumerate((0.08, 0.2, 0.8, 0.92)):  # hanging ketupat and stars
        L = min(H * (0.08 + 0.05 * (i % 2)), u * (11 + 5 * (i % 2)))
        cv.line([(W * x, 0), (W * x, L)], gold, max(1.5, u * 0.18), alpha=200)
        if i % 2:
            cv.star(W * x, L + u * 2.2, u * 2.4, gold)
        else:
            d = u * 2.8
            cv.polygon(
                [(W * x, L), (W * x + d, L + d), (W * x, L + 2 * d), (W * x - d, L + d)], gold
            )
            cv.line(
                [(W * x - d / 2, L + d / 2), (W * x + d / 2, L + 1.5 * d)], cv.color("bg"), u * 0.25
            )
    cv.crescent(
        W * 0.7 if cv.shape == "wide" else W * 0.5,
        u * 9 if cv.shape != "tall" else H * 0.07,
        u * 5,
        gold,
        alpha=235,
    )
    step = u * 7
    y0 = H - u * 14
    for row in range(3):  # ketupat lattice along the foot
        for k in range(int(W / step) + 2):
            cx = k * step + (step / 2 if row % 2 else 0)
            cy = y0 + row * step / 2
            d = step * 0.32
            cv.polygon([(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)], gold, alpha=70)
    cv.parts.append("crescent moon, hanging ketupat and stars, ketupat lattice at the foot")


def _lantern(cv: Canvas, x: float, y: float, r: float) -> None:
    gold = cv.color("accent")
    cv.line([(x, 0), (x, y - r * 0.9)], gold, max(1.5, r * 0.05))
    cv.rrect(Box(x - r * 0.45, y - r * 0.95, x + r * 0.45, y - r * 0.7), r * 0.08, gold)
    cv.ellipse(x, y, r * 1.05, r * 0.8, color="#E11D2E")
    for k in (-0.5, 0, 0.5):
        cv.ellipse(
            x + r * k,
            y,
            r * 0.18 + r * 0.3 * (1 - abs(k)),
            r * 0.78,
            color=gold,
            alpha=110,
            width=max(1.5, r * 0.04),
        )
    cv.rrect(Box(x - r * 0.45, y + r * 0.7, x + r * 0.45, y + r * 0.95), r * 0.08, gold)
    cv.line([(x, y + r * 0.95), (x, y + r * 1.6)], gold, max(2, r * 0.08))


def _blossom(cv: Canvas, x: float, y: float, r: float, color: str) -> None:
    for k in range(5):
        a = k * 2 * pi / 5 - pi / 2
        cv.ellipse(x + r * 0.55 * cos(a), y + r * 0.55 * sin(a), r * 0.5, color=color, alpha=230)
    cv.ellipse(x, y, r * 0.28, color=cv.color("accent"))


def _motif_cny(cv: Canvas) -> None:
    W, H, u = cv.w, cv.h, cv.u
    r = u * (7 if cv.shape != "wide" else 9)
    _lantern(cv, W * 0.12, H * 0.13 if cv.shape == "tall" else H * 0.2, r)
    _lantern(cv, W * 0.88, H * 0.09 if cv.shape == "tall" else H * 0.16, r * 0.8)
    for i, (x, y) in enumerate(((0.06, 0.9), (0.15, 0.95), (0.9, 0.88), (0.97, 0.8), (0.82, 0.96))):
        _blossom(cv, W * x, H * y, u * (2.6 - (i % 2) * 0.8), "#FFD6E0")
    cv.dots(Box(W * 0.3, H * 0.94, W * 0.7, H * 0.99), u * 2.6, u * 0.3, "accent", 110)
    cv.parts.append("red lanterns, plum blossoms, gold dots")


def _motif_deepavali(cv: Canvas) -> None:
    W, H, u = cv.w, cv.h, cv.u

    def rangoli(cx: float, cy: float, R: float) -> None:
        for ring, (n, col, rr) in enumerate(
            ((16, "accent", 1.0), (12, "extra", 0.7), (8, "ink", 0.42))
        ):
            for k in range(n):
                a = k * 2 * pi / n + ring * 0.2
                px, py = cx + R * rr * 0.62 * cos(a), cy + R * rr * 0.62 * sin(a)
                tip = (cx + R * rr * cos(a), cy + R * rr * sin(a))
                side = R * rr * 0.16
                cv.polygon(
                    [
                        (px + side * cos(a + pi / 2), py + side * sin(a + pi / 2)),
                        tip,
                        (px - side * cos(a + pi / 2), py - side * sin(a + pi / 2)),
                        (cx + R * rr * 0.45 * cos(a), cy + R * rr * 0.45 * sin(a)),
                    ],
                    cv.color(col),
                    alpha=200 if ring < 2 else 120,
                )
        cv.ellipse(cx, cy, R * 0.18, color=cv.color("accent"))

    rangoli(0, 0, u * 26)
    rangoli(W, H, u * 26)
    n = 5 if cv.shape != "wide" else 7
    for k in range(n):  # a row of diyas
        x = W * (k + 0.5) / n
        y = H - u * 5
        cv.glow(x, y - u * 3, u * 7, "extra", 0.45)
        cv.shape_draw(
            Box(x - u * 3, y - u * 1.6, x + u * 3, y + u * 1.8),
            lambda d, t, ss, x=x, y=y: d.pieslice(
                (*t(x - u * 3, y - u * 3.2), *t(x + u * 3, y + u * 1.8)), 0, 180, fill=255
            ),
            "accent",
        )
        cv.polygon(
            [
                (x, y - u * 4.2),
                (x + u * 0.8, y - u * 2.2),
                (x, y - u * 1.4),
                (x - u * 0.8, y - u * 2.2),
            ],
            cv.color("extra"),
        )
    cv.parts.append("rangoli in two corners and a row of lit diyas")


def _snowflake(cv: Canvas, x: float, y: float, r: float, col: str, alpha: int) -> None:
    w = max(1.5, r * 0.1)
    for k in range(6):
        a = k * pi / 3
        ex, ey = x + r * cos(a), y + r * sin(a)
        cv.line([(x, y), (ex, ey)], col, w, alpha)
        mx, my = x + r * 0.6 * cos(a), y + r * 0.6 * sin(a)
        for side in (-1, 1):
            b = a + side * pi / 4
            cv.line([(mx, my), (mx + r * 0.3 * cos(b), my + r * 0.3 * sin(b))], col, w, alpha)


def _motif_christmas(cv: Canvas) -> None:
    W, H, u = cv.w, cv.h, cv.u
    gold, red = cv.color("extra"), cv.color("accent")
    for i, x in enumerate((0.07, 0.17, 0.27, 0.73, 0.83, 0.93)):  # baubles on strings
        L = H * (0.06 + 0.05 * (i % 3))
        cv.line([(W * x, 0), (W * x, L)], gold, max(1.5, u * 0.15))
        col = red if i % 2 else gold
        cv.ellipse(W * x, L + u * 2.4, u * 2.4, color=col)
        cv.ellipse(W * x - u * 0.8, L + u * 1.6, u * 0.6, color="#FFFFFF", alpha=150)
    for i in range(9):
        x = W * ((i * 41 + 7) % 100) / 100
        y = H * (0.35 + ((i * 29) % 60) / 100)
        if W * 0.2 < x < W * 0.8:
            continue
        _snowflake(cv, x, y, u * (1.6 + (i % 3)), "#FFFFFF", 110)
    for i in range(6):
        cv.glow(W * ((i * 23 + 11) % 100) / 100, H * ((i * 37 + 50) % 100) / 100, u * 9, gold, 0.25)
    cv.parts.append("baubles on strings, snowflakes, gold bokeh")


def _motif_merdeka(cv: Canvas) -> None:
    W, H, u = cv.w, cv.h, cv.u
    band = u * 10
    y0 = H - band
    n = 14
    for k in range(n):  # Jalur Gemilang stripes
        cv.rect(
            Box(0, y0 + band * k / n, W, y0 + band * (k + 1) / n),
            "#CC0001" if k % 2 == 0 else "#FFFFFF",
        )
    cv.rect(Box(0, y0, band * 1.9, H), "#010066")
    cv.crescent(band * 0.72, y0 + band / 2, band * 0.36, "#FFCC00", turn=0.3)
    cv.star(band * 1.32, y0 + band / 2, band * 0.26, "#FFCC00", points=14, inner=0.5)
    for i, (x, y, R) in enumerate(((0.15, 0.12, 9), (0.85, 0.18, 11), (0.7, 0.05, 6))):  # fireworks
        col = "#FFCC00" if i % 2 == 0 else "#CC0001"
        for k in range(16):
            a = k * pi / 8
            r0, r1 = u * R * 0.35, u * R
            cv.line(
                [
                    (W * x + r0 * cos(a), H * y + r0 * sin(a)),
                    (W * x + r1 * cos(a), H * y + r1 * sin(a)),
                ],
                col,
                max(1.5, u * 0.3),
                alpha=200,
            )
    cv.parts.append("Jalur Gemilang stripes with crescent and 14-point star at the foot, fireworks")


MOTIFS = {
    "festive-raya": _motif_raya,
    "festive-cny": _motif_cny,
    "festive-deepavali": _motif_deepavali,
    "festive-christmas": _motif_christmas,
    "festive-merdeka": _motif_merdeka,
}


def _festive(tid: str) -> Callable[[Canvas, dict[str, Any], Assets], None]:
    def draw(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
        bg_gradient(cv, 90)
        cv.glow(cv.w / 2, cv.h * 0.45, min(cv.w, cv.h) * 0.6, "accent", 0.18)
        MOTIFS[tid](cv)
        u = cv.u
        s = cv.safe
        foot = u * (12 if tid == "festive-merdeka" else 9 if tid == "festive-deepavali" else 6)
        area = Box(
            s.x0 + u * 4,
            s.y0 + u * (10 if cv.shape == "tall" else 6),
            s.x1 - u * 4,
            cv.h - max(foot, cv.h - s.y1) - u * 2,
        )
        if cv.shape == "wide":
            area = Box(cv.w * 0.22, s.y0, cv.w * 0.78, cv.h - foot - u * 2)
        if a.logo is not None:
            lh = min(u * 6, area.h * 0.12)
            cv.logo(area.bottom(lh), a.logo, "center")
            area = Box(area.x0, area.y0, area.x1, area.y1 - lh - u * 3)
        elif a.brand and not _t(sl, "name"):
            sl = {**sl, "name": a.brand}
        if a.photo is not None:
            ph = min(area.h * 0.3, area.w * 0.5)
            cx = area.cx
            img = a.photo
            box = Box(cx - ph / 2, area.y0, cx + ph / 2, area.y0 + ph)
            mask_box = box.ints()
            size = (mask_box[2] - mask_box[0], mask_box[3] - mask_box[1])
            fit = E.ImageOps.fit(img.convert("RGB"), size, E.LANCZOS)
            m = Image.new("L", (size[0] * 4, size[1] * 4), 0)
            ImageDraw.Draw(m).ellipse((0, 0, size[0] * 4 - 1, size[1] * 4 - 1), fill=255)
            cv.ellipse(box.cx, box.cy, ph / 2 + u * 0.8, color="accent")
            cv.img.paste(fit, mask_box[:2], m.resize(size, E.LANCZOS))
            photo_note(cv, "in a gold-ringed circle")
            area = Box(area.x0, area.y0 + ph + u * 3, area.x1, area.y1)
        name = _t(sl, "name")
        stack(
            cv,
            area,
            [
                kicker_text(sl, "center"),
                headline(sl, 13 if cv.shape != "wide" else 11, "center", role="script", lines=3),
                subhead(sl, "center", color="ink", size=4.4, role="display"),
                Rule(12, align="center"),
                body(sl, "center", size=3.1),
                Text(name, "semi", 3.0, "accent", "center", max_lines=2, tracking=0.06, what="from")
                if name
                else None,
            ],
            "center",
        )
        footer(cv, Box(s.x0, s.y0, s.x1, cv.h - foot - u), _t(sl, "footer"), "center", "muted")

    return draw


def _quote(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    u = cv.u
    bg_gradient(cv, 140)
    big = _t(sl, "big")
    area = header(cv, cv.safe, a)
    area = footer(cv, area, _t(sl, "footer"))
    if a.photo is not None:
        if cv.shape == "wide":
            r = min(area.h * 0.42, area.w * 0.18)
            cx, cy = area.x1 - r, area.cy
            area = Box(area.x0, area.y0, area.x1 - 2 * r - u * 5, area.y1)
        else:
            r = min(area.w * 0.16, area.h * 0.12)
            cx, cy = area.x0 + r, area.y1 - r
            area = Box(area.x0, area.y0, area.x1, area.y1 - 2 * r - u * 3)
        box = Box(cx - r, cy - r, cx + r, cy + r)
        x0, y0, x1, y1 = box.ints()
        fit = E.ImageOps.fit(
            a.photo.convert("RGB"), (x1 - x0, y1 - y0), E.LANCZOS, centering=(0.5, 0.35)
        )
        m = Image.new("L", ((x1 - x0) * 4, (y1 - y0) * 4), 0)
        ImageDraw.Draw(m).ellipse((0, 0, m.width - 1, m.height - 1), fill=255)
        cv.ellipse(cx, cy, r + u * 0.7, color="accent")
        cv.img.paste(fit, (x0, y0), m.resize((x1 - x0, y1 - y0), E.LANCZOS))
        photo_note(cv, "of the person in a circle")
    blocks: list[Any] = [kicker_text(sl)]
    if big:
        blocks.append(
            Text(
                big,
                "display",
                30 if cv.shape != "wide" else 22,
                "accent",
                max_lines=1,
                leading=1.0,
                gap=1.0,
                what="big number",
            )
        )
        blocks.append(headline(sl, 7.5, role="head"))
    else:
        blocks.append(
            Text(
                "“", "serif", 22, "accent", max_lines=1, leading=1.0, gap=-6, what="quotation mark"
            )
        )
        blocks.append(headline(sl, 6.8, role="head", lines=6))
    name = _t(sl, "name")
    blocks += [
        Rule(10),
        Text(name, "semi", 3.4, "ink", max_lines=2, gap=0.8, what="attribution") if name else None,
        subhead(sl, size=2.8),
        body(sl, color="muted", size=2.9),
    ]
    stack(cv, area, blocks, "center")


def _stats(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 90)
    cv.ellipse(W * 0.98, H * 0.02, u * 24, color="accent", alpha=28)
    cv.dots(Box(W * 0.03, H * 0.82, W * 0.3, H * 0.98), u * 2.8, u * 0.3, "accent", 70)
    area = header(cv, cv.safe, a)
    area = footer(cv, area, _t(sl, "footer"))
    wide = cv.shape == "wide"
    if wide:
        left = Box(area.x0, area.y0, area.x0 + area.w * 0.36, area.y1)
        stack(
            cv,
            left,
            [kicker_text(sl), headline(sl, 7.6), subhead(sl), body(sl, size=2.8)],
            "center",
        )
        stack(
            cv, Box(left.x1 + u * 4, area.y0, area.x1, area.y1), [Stats(sl["stats"], 3.2)], "center"
        )
    else:
        stack(
            cv,
            area,
            [
                kicker_text(sl),
                headline(sl, 7.8),
                subhead(sl),
                Stats(sl["stats"], 3.2),
                body(sl, size=2.8),
            ],
            "center",
        )


def _tender(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_solid(cv)
    m = u * 3
    cv.rrect_outline(Box(m, m, W - m, H - m), 0, "ink", u * 0.6)
    cv.rrect_outline(
        Box(m + u * 1.4, m + u * 1.4, W - m - u * 1.4, H - m - u * 1.4), 0, "accent", u * 0.25
    )
    cv.parts.append("formal double-ruled border")
    area = cv.safe.inset(u * 2, u * 1)
    area = header(cv, area, a, "center")
    area = footer(cv, area, _t(sl, "footer"), "center", "ink")
    ref = _t(sl, "ref")
    stack(
        cv,
        area,
        [
            Text(
                _t(sl, "kicker") or "NOTIS",
                "head",
                5.0,
                "accent",
                "center",
                upper=True,
                tracking=0.16,
                max_lines=1,
                gap=1.2,
                what="notice title",
            ),
            Text(ref, "semi", 2.8, "muted", "center", max_lines=1, gap=2.0, what="reference")
            if ref
            else None,
            headline(sl, 6.0, "center", role="head", upper=True, lines=4),
            subhead(sl, "center", color="ink", size=3.2),
            Rule(18, 0.35, "ink", "center"),
            details(sl, size=2.9, table=True, label_color="muted"),
            body(sl, size=2.6),
            cta(sl, "center", outline=True, bg="ink"),
        ],
        "spread" if cv.shape == "tall" else "center",
    )


def _menu(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_solid(cv)
    cv.rrect_outline(Box(u * 3, u * 3, W - u * 3, H - u * 3), u * 2, "accent", u * 0.3)
    cv.dots(Box(u * 6, u * 6, W * 0.25, u * 12), u * 2.2, u * 0.25, "accent", 120)
    area = cv.safe.inset(u * 1.5)
    if a.photo is not None:
        if cv.shape == "wide":
            pw = area.w * 0.36
            cv.photo(Box(area.x1 - pw, area.y0, area.x1, area.y1), a.photo, radius=u * 2.5)
            area = Box(area.x0, area.y0, area.x1 - pw - u * 4, area.y1)
        else:
            ph = area.h * (0.26 if cv.shape == "tall" else 0.3)
            cv.photo(Box(area.x0, area.y1 - ph, area.x1, area.y1), a.photo, radius=u * 2.5)
            area = Box(area.x0, area.y0, area.x1, area.y1 - ph - u * 3)
        photo_note(cv, "of the food/product in a rounded frame")
    area = header(cv, area, a, "center")
    area = footer(cv, area, _t(sl, "footer"), "center")
    n = len(sl.get("items") or [])
    cols = 2 if (cv.shape == "wide" or (cv.shape == "square" and n > 7) or n > 10) else 1
    stack(
        cv,
        area,
        [
            kicker_text(sl, "center"),
            headline(sl, 8.0, "center", role="head", lines=2),
            subhead(sl, "center", size=3.2),
            Rule(10, align="center"),
            E.Items(sl["items"], 3.0, cols=cols),
            cta(sl, "center"),
        ],
        "center",
        grow=1.5,
    )


def _webinar(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 120)
    cv.rings(W * 0.97, H * 0.97, u * 10, u * 4.5, 4, "accent", max(2, u * 0.35), alpha=60)
    cv.glow(W * 0.9, H * 0.1, u * 40, "accent", 0.25)
    area = cv.safe
    if a.photo is not None:
        panel, area = split_areas(cv, 0.38)
        cv.photo(panel, a.photo)
        cv.scrim(panel, "bg", 0.0, 0.4, 90)
        photo_note(cv, "of the speaker or topic")
    area = header(cv, area, a)
    area = footer(cv, area, _t(sl, "footer"))
    people = sl.get("people") or []
    stack(
        cv,
        area,
        [
            kicker_pill(sl),
            headline(sl, 8.6),
            subhead(sl),
            details(sl, cols=3 if cv.shape == "wide" else 2, size=3.0),
            E.People(people, 2.9, cols=2) if people else None,
            cta(sl),
        ],
        "center",
    )


def _thanks(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 90)
    for i in range(26):  # confetti
        x = W * ((i * 37 + 5) % 100) / 100
        y = H * ((i * 61 + 3) % 100) / 100
        if abs(x - W / 2) < W * 0.3 and abs(y - H / 2) < H * 0.3:
            continue
        col = "accent" if i % 3 else "muted"
        if i % 2:
            cv.ellipse(x, y, u * (0.6 + (i % 4) * 0.3), color=col, alpha=200)
        else:
            a0 = i * 0.7
            r = u * 1.2
            cv.polygon(
                [
                    (x + r * cos(a0 + k * pi / 2), y + r * 0.45 * sin(a0 + k * pi / 2))
                    for k in range(4)
                ],
                cv.color(col),
                200,
            )
    cv.parts.append("confetti around the edges")
    area = cv.safe.inset(u * 3)
    if a.logo is not None:
        lh = min(u * 6, area.h * 0.12)
        cv.logo(area.bottom(lh), a.logo, "center")
        area = Box(area.x0, area.y0, area.x1, area.y1 - lh - u * 3)
    elif a.brand and not _t(sl, "name"):
        sl = {**sl, "name": a.brand}
    area = footer(cv, area, _t(sl, "footer"), "center")
    name = _t(sl, "name")
    stack(
        cv,
        area,
        [
            kicker_text(sl, "center"),
            headline(sl, 15 if cv.shape != "wide" else 12, "center", role="script", lines=2),
            subhead(sl, "center", color="ink", size=4.2),
            Rule(10, align="center"),
            body(sl, "center", size=3.2),
            Text(name, "semi", 3.0, "accent", "center", max_lines=2, tracking=0.06, what="from")
            if name
            else None,
        ],
        "center",
    )


def _product(cv: Canvas, sl: dict[str, Any], a: Assets) -> None:
    W, H, u = cv.w, cv.h, cv.u
    bg_gradient(cv, 135)
    area = cv.safe
    if a.photo is not None:
        panel, area = split_areas(cv, 0.48 if cv.shape != "wide" else 0.46)
        cv.photo(panel, a.photo)
        photo_note(cv, "of the product/service, large")
    else:
        cv.glow(W * 0.8, H * 0.25, u * 50, "accent", 0.35)
        cv.rings(W * 0.8, H * 0.25, u * 10, u * 6, 5, "accent", max(2, u * 0.3), alpha=70)
    area = header(cv, area, a)
    area = footer(cv, area, _t(sl, "footer"))
    big = _t(sl, "big")
    blocks: list[Any] = [
        kicker_pill(sl),
        headline(sl, 8.4),
        subhead(sl),
        points(sl, "check", size=3.1, cols=2 if cv.shape == "wide" else 1),
    ]
    if big:
        blocks.append(Text(big, "display", 8.5, "accent", max_lines=1, gap=1.6, what="price"))
    blocks.append(cta(sl))
    stack(cv, area, blocks, "center")


ALL_SIZES_TALL = ("a4-portrait", "ig-square", "ig-story", "a3-portrait")
_COMMON = ("kicker", "headline", "subhead")


LIGHT = {"announcement", "stats", "menu", "thank-you", "tender-notice"}


def _tpl(
    tid: str,
    title: str,
    use: str,
    slots: tuple[str, ...],
    req: tuple[str, ...],
    pal: str,
    fonts: str,
    sizes: tuple[str, ...],
    draw: Callable,
    list_slot: str = "",
    rng: tuple[int, int] = (0, 99),
) -> Template:
    brand = "brand" if tid in LIGHT else "brand-dark"
    return Template(tid, title, use, slots, req, pal, fonts, sizes, draw, list_slot, rng, brand)


TEMPLATES: dict[str, Template] = {
    t.id: t
    for t in (
        _tpl(
            "event",
            "Event",
            "events, launches, dinners, open days (photo optional)",
            (*_COMMON, "details", "cta", "footer", "photo"),
            ("headline",),
            "midnight",
            "modern",
            ("ig-square", "a4-portrait", "ig-story"),
            _event,
        ),
        _tpl(
            "announcement",
            "Announcement",
            "notices to staff/customers, closures, new policy",
            (*_COMMON, "body", "details", "cta", "footer", "photo"),
            ("headline",),
            "sky",
            "modern",
            ("a4-portrait", "ig-square"),
            _announcement,
        ),
        _tpl(
            "hiring",
            "Hiring / vacancy",
            "jawatan kosong, we're hiring, internships",
            ("kicker", "headline", "subhead", "points", "details", "cta", "footer", "photo"),
            ("headline",),
            "midnight",
            "impact",
            ("ig-square", "a4-portrait", "ig-story"),
            _hiring,
        ),
        _tpl(
            "sale",
            "Promotion / sale",
            "discounts, promos, offers (big = '50%')",
            (*_COMMON, "big", "details", "cta", "footer", "photo"),
            ("headline",),
            "sunset",
            "impact",
            ("ig-square", "ig-story", "a4-portrait"),
            _sale,
        ),
        _tpl(
            "safety",
            "Safety notice",
            "security/safety rules, warnings, PPE, emergency contacts",
            ("kicker", "headline", "subhead", "points", "body", "footer"),
            ("headline",),
            "safety-yellow",
            "impact",
            ("a4-portrait", "a3-portrait", "ig-square"),
            _safety,
        ),
        _tpl(
            "training",
            "Training / course",
            "courses, workshops, briefings with modules",
            (*_COMMON, "points", "details", "cta", "footer", "photo"),
            ("headline",),
            "ocean",
            "modern",
            ("a4-portrait", "ig-square"),
            _training,
        ),
        *(
            _tpl(
                tid,
                f"Festive: {label}",
                f"{label} greetings",
                ("kicker", "headline", "subhead", "body", "name", "footer", "photo"),
                ("headline",),
                pal,
                "elegant",
                ("ig-square", "ig-story", "a4-portrait"),
                _festive(tid),
            )
            for tid, (pal, label) in FESTIVE.items()
        ),
        _tpl(
            "quote-milestone",
            "Quote / milestone",
            "a leader's quote, anniversaries, awards (big = '10')",
            ("kicker", "headline", "big", "name", "subhead", "body", "footer", "photo"),
            ("headline",),
            "midnight",
            "elegant",
            ("ig-square", "linkedin-post", "a4-portrait"),
            _quote,
        ),
        _tpl(
            "stats",
            "Infographic: key numbers",
            "results, KPIs, year in numbers (3-6 stats)",
            (*_COMMON, "stats", "body", "footer"),
            ("headline", "stats"),
            "mint",
            "modern",
            ("ig-square", "a4-portrait", "linkedin-post"),
            _stats,
            "stats",
            (3, 6),
        ),
        _tpl(
            "tender-notice",
            "Tender / notice board",
            "tender adverts, formal notices, notice-board letters",
            ("kicker", "ref", "headline", "subhead", "details", "body", "cta", "footer"),
            ("headline",),
            "mono",
            "elegant",
            ("a4-portrait", "a3-portrait"),
            _tender,
        ),
        _tpl(
            "menu",
            "Menu / price list",
            "cafe menus, price lists, service rates",
            (*_COMMON, "items", "cta", "footer", "photo"),
            ("headline", "items"),
            "sand",
            "elegant",
            ("a4-portrait", "ig-portrait", "ig-square"),
            _menu,
            "items",
            (1, 14),
        ),
        _tpl(
            "webinar",
            "Webinar / meeting",
            "webinars, town halls, online meetings with speakers",
            (*_COMMON, "details", "people", "cta", "footer", "photo"),
            ("headline",),
            "royal",
            "modern",
            ("ig-square", "linkedin-post", "ig-story"),
            _webinar,
        ),
        _tpl(
            "thank-you",
            "Thank you",
            "thanks to staff, customers, partners",
            ("kicker", "headline", "subhead", "body", "name", "footer"),
            ("headline",),
            "coral",
            "elegant",
            ("ig-square", "ig-story"),
            _thanks,
        ),
        _tpl(
            "product",
            "Product / service highlight",
            "a product or service with features and price",
            (*_COMMON, "points", "big", "cta", "footer", "photo"),
            ("headline",),
            "charcoal",
            "modern",
            ("ig-square", "ig-portrait", "fb-post"),
            _product,
        ),
    )
}


def catalogue(query: str = "") -> str:
    """Compact list for design_templates: one line per template, then sizes and palettes."""
    from .spec import BRAND_PALETTES, PALETTES, SIZES

    q = query.strip().lower()
    lines = []
    for t in TEMPLATES.values():
        if q and q not in f"{t.id} {t.title} {t.use}".lower():
            continue
        slots = ", ".join(s + ("*" if s in t.required else "") for s in t.slots)
        extra = f" ({t.list_slot}: {t.list_range[0]}-{t.list_range[1]})" if t.list_slot else ""
        lines.append(f"- {t.id}: {t.use}. Slots: {slots}{extra}. Default {t.palette}.")
    if not lines:
        lines.append(f"(no template matches {query!r}; all: {', '.join(TEMPLATES)})")
    lines.append("Sizes: " + ", ".join(f"{k} ({v[4]})" for k, v in SIZES.items()))
    lines.append(
        "Palettes: " + ", ".join([*BRAND_PALETTES, *PALETTES]) + ", or {bg, accent} colours."
    )
    lines.append(
        "Fonts: modern, impact, elegant. * = required. List slots: one short line per item; "
        + "; ".join(f"{k} {v.hint}" for k, v in SLOTS.items() if v.kind == "list")
    )
    return "\n".join(lines)
