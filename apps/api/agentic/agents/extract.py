"""Main-content extraction for fetched web pages: prune -> markdown -> query-aware selection.

`tools.html_to_text` strips tags and nothing else, so navigation, cookie banners and footers
eat the clip, tables and links flatten into word soup, and every long page read "with a why"
costs a model call to condense. This module does the cleaning in plain Python (lxml):

1. `prune(html, url)` parses the page, drops chrome (scripts, styles, forms that are not the
   page, nav/aside/footer, cookie and share widgets, hidden nodes), splits what is left into
   blocks (headings, paragraphs, lists, tables, code, quotes) and keeps the blocks whose
   composite score passes a threshold. The score follows crawl4ai's PruningContentFilter:
   0.4 text density + 0.2 (1 - link density) + 0.2 tag weight + 0.1 class/id penalty
   + 0.1 log(text length) (normalised to 0..1 here so one threshold fits every page size).
2. `to_markdown(blocks)` renders them as markdown: `#` headings, lists, pipe tables, code
   fences, and links as numbered citations `[text][n]` with a "Links:" list at the bottom.
3. `bm25_blocks(blocks, query, budget_chars)` picks the blocks that answer a question
   (BM25 with heading and bold boosts, section headings carried along), in document order,
   within a character budget, so a long page read for a reason rarely needs a model at all.

Ideas from crawl4ai (Apache-2.0, see THIRD_PARTY_NOTICES.md) and vercel-labs/agent-browser
(markdown-first reads, llms.txt); re-implemented, no code copied.
"""

import math
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from urllib.parse import urldefrag, urljoin, urlparse

from lxml import html as lhtml

THRESHOLD = 0.48
MIN_WORDS = 3
MAX_TABLE_ROWS = 40
MAX_TABLE_COLS = 10
MAX_CELL_CHARS = 200
MAX_LIST_ITEMS = 80
MAX_PRE_CHARS = 4000
MAX_LINKS_LISTED = 60

# Never content: removed before anything is scored.
DROP_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "svg",
        "math",
        "iframe",
        "template",
        "button",
        "input",
        "select",
        "option",
        "textarea",
        "canvas",
        "object",
        "embed",
        "link",
        "meta",
        "dialog",
        "video",
        "audio",
        "picture",
        "source",
        "map",
        "head",
    }
)
CHROME_TAGS = frozenset({"nav", "aside", "footer"})
CHROME_ROLES = frozenset(
    {
        "navigation",
        "banner",
        "contentinfo",
        "complementary",
        "search",
        "menu",
        "menubar",
        "dialog",
        "alertdialog",
    }
)
HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
LEAF_BLOCKS = HEADINGS | {"p", "ul", "ol", "menu", "table", "pre", "blockquote", "dl"}
LEAF_BLOCKS |= {"figcaption", "address", "li", "dd", "dt", "caption"}
CONTAINERS = frozenset(
    {
        "html",
        "body",
        "div",
        "section",
        "article",
        "main",
        "header",
        "footer",
        "aside",
        "nav",
        "figure",
        "center",
        "details",
        "summary",
        "form",
        "fieldset",
        "hgroup",
        "search",
        "tr",
        "td",
        "th",
        "tbody",
        "thead",
        "tfoot",
        "hr",
        "legend",
        "noframes",
    }
)
BLOCKISH = LEAF_BLOCKS | CONTAINERS

TAG_WEIGHT = {
    "article": 1.5,
    "main": 1.5,
    "p": 1.0,
    "h1": 1.2,
    "h2": 1.1,
    "h3": 1.0,
    "h4": 0.9,
    "h5": 0.8,
    "h6": 0.8,
    "table": 1.0,
    "pre": 1.0,
    "blockquote": 0.9,
    "dl": 0.8,
    "section": 0.8,
    "list": 0.6,
    "li": 0.6,
    "td": 0.7,
    "th": 0.7,
    "figcaption": 0.7,
    "div": 0.5,
    "span": 0.3,
}
HEAD_BOOST = {"h1": 5.0, "h2": 4.0, "h3": 3.0, "h4": 2.0, "h5": 1.5, "h6": 1.5}

# class/id words that mark page chrome. Word-bounded (so "header" does not hit "headers"
# and "ad" does not hit "address"); the camelCase-safe ones are matched as substrings too.
_NEG_WORDS = (
    r"nav|navbar|navigation|footer|header|masthead|sidebar|menu|menubar|cookies?|consent"
    r"|gdpr|banner|ads?|advert\w*|sponsor\w*|comments?|promo\w*|social|share|sharing"
    r"|breadcrumbs?|newsletter|subscribe|popup|modal|related|pagination|skip|toolbar|widget|tags?"
)
_NEG = re.compile(rf"(?:^|[\s_-])(?:{_NEG_WORDS})(?=$|[\s_-])")
_NEG_SUB = re.compile(r"cookie|consent|gdpr|newsletter|breadcrumb|sidebar|navbar|advert|popup")
# The subset that is removed outright (the rest only lowers the score).
_HARD_WORDS = (
    r"nav|navbar|navigation|footer|sidebar|menu|menubar|cookies?|consent|gdpr|ads?|advert\w*"
    r"|sponsor\w*|comments?|promo\w*|social|share|sharing|breadcrumbs?|newsletter|subscribe"
    r"|popup|modal|related|pagination|skip"
)
_HARD = re.compile(rf"(?:^|[\s_-])(?:{_HARD_WORDS})(?=$|[\s_-])")
# Containers whose class/id says "this is the article".
_POSITIVE = re.compile(
    r"(?:^|[\s_-])(?:content|main|article|post|entry|story|kandungan)"
    r"(?:[\s_-]?(?:body|text|content|main))?(?=$|[\s_-])"
)
_HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden", re.I)
_NOISE = re.compile(
    r"^\W*(?:©|\(c\)|copyright|all rights reserved|hak cipta|skip to (?:main )?content"
    r"|back to top|kembali ke atas|loading|advertisement|iklan|share(?: this)?|kongsi"
    r"|read more|baca lagi|baca seterusnya)\b|all rights reserved|hak cipta terpelihara",
    re.I,
)
_BAD_ALT = re.compile(
    r"^(?:image|img|photo|picture|logo|icon|banner|spacer|placeholder|gambar|foto)\b"
    r"|\.(?:png|jpe?g|gif|webp|svg|bmp)$|^(?:dsc|img|image)[_-]?\d+",
    re.I,
)
_SKIP_SCHEMES = ("javascript:", "mailto:", "tel:", "data:", "sms:", "ftp:", "file:")

# Control characters used internally: a link placeholder and a hard line break.
_L0, _L1, _L2, _BR = "\x01", "\x02", "\x03", "\x04"
_CTRL = re.compile(r"[\x00-\x04]")
_PH = re.compile(r"\x01(\d+)\x02(.*?)\x03", re.S)


@dataclass
class Block:
    """One piece of main content. `md` may hold link placeholders resolved by `render`."""

    kind: str  # h1..h6 | p | list | table | pre | quote | dl
    md: str
    text: str  # plain text, for scoring and search
    links: list[tuple[str, str]] = field(default_factory=list)  # (anchor text, absolute url)
    strong: str = ""  # bold text (BM25 boost)
    score: float = 0.0
    order: int = 0

    @property
    def heading(self) -> int:
        return int(self.kind[1]) if self.kind in HEADINGS else 0


@dataclass
class Page:
    title: str
    blocks: list[Block]  # kept main content
    all_links: list[tuple[str, str, str]]  # (anchor, url, surrounding text), whole page


@dataclass
class Markdown:
    body: str
    links: list[str]  # citation n is links[n - 1]

    def full(self, max_links: int = MAX_LINKS_LISTED) -> str:
        return self.body + _links_section(self.links, range(1, len(self.links) + 1), max_links)

    def slice(self, start: int, length: int, max_links: int = MAX_LINKS_LISTED) -> str:
        """A window of the body with only the citations it uses listed after it."""
        piece = self.body[start : start + length]
        used = sorted({int(n) for n in re.findall(r"\]\[(\d+)\]", piece)})
        return piece + _links_section(self.links, used, max_links)


def _links_section(links: list[str], used: Iterable[int], max_links: int) -> str:
    rows = [f"[{n}]: {links[n - 1]}" for n in used if 0 < n <= len(links)]
    if not rows:
        return ""
    extra = len(rows) - max_links
    rows = rows[:max_links] + ([f"(+{extra} more links)"] if extra > 0 else [])
    return "\n\nLinks:\n" + "\n".join(rows)


# ---------------------------------------------------------------- parsing helpers

_PARSER = lhtml.HTMLParser(remove_comments=True, remove_pis=True, recover=True)


def _tag(el: object) -> str:
    tag = getattr(el, "tag", None)
    return tag.lower() if isinstance(tag, str) else ""


def _collapse(s: str) -> str:
    """Whitespace runs -> one space, internal line breaks kept, control chars dropped."""
    s = re.sub(r"\s+", " ", s)
    lines = [ln.strip() for ln in s.split(_BR)]
    out: list[str] = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return "\n".join(out).strip()


def _clean_text(s: str | None) -> str:
    return _CTRL.sub(" ", s) if s else ""


def _classid(el: object) -> str:
    get = getattr(el, "get", None)
    if get is None:
        return ""
    return f"{get('class') or ''} {get('id') or ''}".lower()


def _abs_url(base: str, href: str) -> str | None:
    href = href.strip()
    if not href or href.startswith("#") or href.lower().startswith(_SKIP_SCHEMES):
        return None
    url = urldefrag(urljoin(base, href) if base else href).url
    return url if urlparse(url).scheme in ("http", "https") and urlparse(url).netloc else None


def _parse(raw: str):
    raw = re.sub(r"^\s*<\?xml[^>]*>", "", raw or "")
    if not raw.strip():
        return None
    try:
        return lhtml.document_fromstring(raw, parser=_PARSER)
    except Exception:  # lxml's ParserError (an empty or broken document) and ValueError
        return None


def title_of(root) -> str:
    for xp in ('.//meta[@property="og:title"]', './/meta[@name="twitter:title"]'):
        el = root.find(xp)
        if el is not None and (el.get("content") or "").strip():
            return _collapse(el.get("content"))[:200]
    el = root.find(".//title")
    if el is not None and el.text_content().strip():
        return _collapse(el.text_content())[:200]
    h1 = root.find(".//h1")
    return _collapse(h1.text_content())[:200] if h1 is not None else ""


# ---------------------------------------------------------------- chrome removal


def _protected(el) -> bool:
    """A node that holds the article itself, whatever its class says."""
    tag = _tag(el)
    if tag in ("html", "body", "main", "article") or el.get("role") == "main":
        return True
    if el.find(".//main") is not None or el.find(".//article") is not None:
        return True
    if el.find(".//h1") is not None:
        return True
    text = el.text_content()
    if len(text) > 2500:  # a big wrapper with a misleading class ("has-sidebar")
        links = sum(len(a.text_content()) for a in el.iter("a"))
        return links / max(len(text), 1) < 0.3
    return False


def _strip_chrome(body) -> None:
    for el in list(body.iter()):
        if el.getparent() is None and el is not body:
            continue  # inside a subtree already removed
        tag = _tag(el)
        if not tag or el is body:
            continue
        if tag in DROP_TAGS:
            el.drop_tree()
            continue
        if tag == "form":
            # ASP.NET pages wrap the whole page in one <form>: drop only small, chrome forms.
            if len(el.text_content().strip()) < 500 and not _protected(el):
                el.drop_tree()
            continue
        role = (el.get("role") or "").lower()
        hidden = (
            el.get("hidden") is not None
            or (el.get("aria-hidden") or "").lower() == "true"
            or bool(_HIDDEN_STYLE.search(el.get("style") or ""))
        )
        if hidden:
            el.drop_tree()
            continue
        if (tag in CHROME_TAGS or role in CHROME_ROLES) and not _protected(el):
            el.drop_tree()
            continue
        if tag == "header" and not _in_main(el) and el.find(".//h1") is None:
            el.drop_tree()
            continue
        cid = _classid(el)
        if cid.strip() and (_HARD.search(cid) or _NEG_SUB.search(cid)) and not _protected(el):
            el.drop_tree()


def _in_main(el) -> bool:
    p = el.getparent()
    while p is not None:
        if _tag(p) in ("article", "main") or p.get("role") == "main":
            return True
        p = p.getparent()
    return False


# ---------------------------------------------------------------- inline rendering


class _Inline:
    """Renders inline content to (markdown, plain text), collecting links and bold text."""

    def __init__(self, base: str) -> None:
        self.base = base
        self.links: list[tuple[str, str]] = []
        self.strong: list[str] = []
        self.link_chars = 0
        self.href_chars = 0
        self.elements = 0

    def items(self, el) -> list:
        out: list = [el.text] if el.text else []
        for c in el:
            out.append(c)
            if c.tail:
                out.append(c.tail)
        return out

    def seq(self, items: Iterable) -> tuple[str, str]:
        md: list[str] = []
        pl: list[str] = []
        for it in items:
            if isinstance(it, str):
                t = _clean_text(it)
                md.append(t)
                pl.append(t)
            else:
                m, p = self.node(it)
                md.append(m)
                pl.append(p)
        return "".join(md), "".join(pl)

    def node(self, el) -> tuple[str, str]:
        tag = _tag(el)
        if not tag or tag in DROP_TAGS:
            return "", ""
        self.elements += 1
        if tag == "br":
            return _BR, _BR
        if tag == "img":
            alt = _collapse(el.get("alt") or "")
            if len(alt) >= 4 and not _BAD_ALT.search(alt):
                return f" (image: {alt}) ", f" {alt} "
            return "", ""
        if tag in ("ul", "ol", "menu"):  # a list inside a paragraph-like run
            m, p = _list_lines(self, el, 0)
            return _BR + m.replace("\n", _BR) + _BR, _BR + p + _BR
        m, p = self.seq(self.items(el))
        if tag == "a":
            return self._link(el, m, p)
        if tag in ("strong", "b") and p.strip():
            self.strong.append(p.strip())
            return _wrap(m, "**"), p
        if tag in ("em", "i") and p.strip():
            return _wrap(m, "*"), p
        if tag in ("code", "kbd", "samp") and p.strip():
            return _wrap(m, "`"), p
        if tag in BLOCKISH:
            return _BR + m + _BR, _BR + p + _BR
        return m, p

    def _link(self, el, m: str, p: str) -> tuple[str, str]:
        text = _collapse(p)
        if not text:
            return m, p
        href = el.get("href") or ""
        self.link_chars += len(text)
        self.href_chars += min(len(href), 120)
        url = _abs_url(self.base, href)
        if url is None:
            return m, p
        i = len(self.links)
        self.links.append((text[:200], url))
        lead = m[: len(m) - len(m.lstrip())]
        trail = m[len(m.rstrip()) :]
        return f"{lead}{_L0}{i}{_L1}{m.strip()}{_L2}{trail}", p


def _wrap(m: str, mark: str) -> str:
    lead = m[: len(m) - len(m.lstrip())]
    trail = m[len(m.rstrip()) :]
    inner = m.strip()
    return f"{lead}{mark}{inner}{mark}{trail}" if inner else m


def _list_lines(inl: _Inline, el, depth: int) -> tuple[str, str]:
    ordered = _tag(el) == "ol"
    lines: list[str] = []
    plain: list[str] = []
    n = 0
    for li in el:
        if _tag(li) != "li":
            continue
        n += 1
        if n > MAX_LIST_ITEMS:
            lines.append("  " * depth + "- ...")
            break
        parts: list = [li.text] if li.text else []
        nested = []
        for c in li:
            if _tag(c) in ("ul", "ol", "menu"):
                nested.append(c)
            else:
                parts.append(c)
            if c.tail:
                parts.append(c.tail)
        inl.elements += 1
        m, p = inl.seq(parts)
        m = _collapse(m).replace("\n", " ")
        bullet = f"{n}." if ordered else "-"
        if m:
            lines.append(f"{'  ' * depth}{bullet} {m}")
            plain.append(_collapse(p))
        for sub in nested:
            sm, sp = _list_lines(inl, sub, depth + 1)
            if sm:
                lines.append(sm)
                plain.append(sp)
    return "\n".join(lines), " ".join(plain)


# ---------------------------------------------------------------- blocks


@dataclass
class _Ctx:
    main: bool = False
    positive: bool = False
    penalty: int = 0

    def enter(self, el) -> "_Ctx":
        tag = _tag(el)
        cid = _classid(el)
        main = self.main or tag in ("article", "main") or el.get("role") == "main"
        positive = self.positive or bool(cid.strip() and _POSITIVE.search(cid))
        penalty = self.penalty + (1 if cid.strip() and _NEG.search(cid) else 0)
        return _Ctx(main, positive, penalty)


@dataclass
class _Raw:
    block: Block
    tag: str
    text_len: int
    markup_len: int
    link_len: int
    ctx: _Ctx


def _is_layout_table(t) -> bool:
    if (t.get("role") or "").lower() in ("presentation", "none"):
        return True
    if t.find(".//table") is not None:
        return True
    for bad in ("h1", "h2", "article", "main", "nav", "form"):
        if t.find(f".//{bad}") is not None:
            return True
    rows = t.findall(".//tr")
    longest = max((len(c.text_content()) for c in t.iter("td", "th")), default=0)
    return len(rows) <= 4 and longest > 600


class _Walker:
    def __init__(self, base: str) -> None:
        self.base = base
        self.out: list[_Raw] = []

    def walk(self, el, ctx: _Ctx) -> None:
        ctx = ctx.enter(el)
        run: list = [el.text] if el.text else []
        for child in el:
            tag = _tag(child)
            if tag and tag not in DROP_TAGS:
                if self._is_block(child, tag):
                    self._flush(run, el, ctx)
                    run = []
                    self.block(child, tag, ctx)
                else:
                    run.append(child)
            if child.tail:
                run.append(child.tail)
        self._flush(run, el, ctx)

    @staticmethod
    def _is_block(el, tag: str) -> bool:
        if tag in BLOCKISH:
            return True
        # An inline element wrapping blocks (a card link around a heading and a paragraph).
        return any(_tag(d) in BLOCKISH for d in el.iterdescendants())

    def _flush(self, run: list, parent, ctx: _Ctx) -> None:
        if not any((isinstance(x, str) and x.strip()) or not isinstance(x, str) for x in run):
            return
        inl = _Inline(self.base)
        m, p = inl.seq(run)
        m, p = _collapse(m), _collapse(p)
        if not p:
            return
        self._emit("p", _tag(parent) or "div", m, p, inl, ctx)

    def _emit(self, kind: str, tag: str, md: str, plain: str, inl: _Inline, ctx: _Ctx) -> None:
        text_len = len(plain)
        markup = text_len + 7 * (inl.elements + 1) + inl.href_chars
        block = Block(kind, md, plain, inl.links, " ".join(inl.strong))
        self.out.append(_Raw(block, tag, text_len, markup, inl.link_chars, ctx))

    def block(self, el, tag: str, ctx: _Ctx) -> None:
        if tag in HEADINGS:
            inl = _Inline(self.base)
            m, p = inl.seq(inl.items(el))
            m, p = _collapse(m).replace("\n", " "), _collapse(p).replace("\n", " ")
            if p:
                self._emit(tag, tag, f"{'#' * int(tag[1])} {m}", p, inl, ctx.enter(el))
        elif tag in ("p", "figcaption", "address", "li", "dd", "dt", "caption", "summary"):
            inl = _Inline(self.base)
            m, p = inl.seq(inl.items(el))
            m, p = _collapse(m), _collapse(p)
            if p:
                self._emit("p", "p" if tag != "figcaption" else tag, m, p, inl, ctx.enter(el))
        elif tag in ("ul", "ol", "menu"):
            inl = _Inline(self.base)
            m, p = _list_lines(inl, el, 0)
            if p.strip():
                self._emit("list", "list", m, p, inl, ctx.enter(el))
        elif tag == "table" and not _is_layout_table(el):
            self._table(el, ctx.enter(el))
        elif tag == "pre":
            code = _clean_text(el.text_content()).strip("\n")
            if code.strip():
                code = code[:MAX_PRE_CHARS]
                inl = _Inline(self.base)
                self._emit("pre", "pre", f"```\n{code}\n```", code, inl, ctx.enter(el))
        elif tag == "blockquote":
            inl = _Inline(self.base)
            m, p = inl.seq(inl.items(el))
            m, p = _collapse(m), _collapse(p)
            if p:
                quoted = "\n".join(f"> {ln}" if ln else ">" for ln in m.split("\n"))
                self._emit("quote", "blockquote", quoted, p, inl, ctx.enter(el))
        elif tag == "dl":
            self._dl(el, ctx.enter(el))
        elif tag == "hr":
            return
        else:
            self.walk(el, ctx)

    def _dl(self, el, ctx: _Ctx) -> None:
        inl = _Inline(self.base)
        lines: list[str] = []
        plain: list[str] = []
        for c in el:
            t = _tag(c)
            if t not in ("dt", "dd"):
                continue
            m, p = inl.seq(inl.items(c))
            m, p = _collapse(m).replace("\n", " "), _collapse(p)
            if p:
                lines.append(f"**{m}**" if t == "dt" else f": {m}")
                plain.append(p)
        if plain:
            self._emit("dl", "dl", "\n".join(lines), " ".join(plain), inl, ctx)

    def _table(self, t, ctx: _Ctx) -> None:
        inl = _Inline(self.base)
        rows: list[list[str]] = []
        plain: list[str] = []
        head_row = False
        key_rows = 0  # rows whose first cell is a <th> (a key: value table)
        for tr in t.iter("tr"):
            cells: list[str] = []
            all_th = True
            for c in tr:
                ct = _tag(c)
                if ct not in ("td", "th"):
                    continue
                if not cells and ct == "th":
                    key_rows += 1
                all_th = all_th and ct == "th"
                inl.elements += 1
                m, p = inl.seq(inl.items(c))
                m = _collapse(m).replace("\n", " ").replace("|", "\\|")
                if len(m) > MAX_CELL_CHARS:
                    m = m[:MAX_CELL_CHARS].rstrip() + "..."
                plain.append(_collapse(p))
                try:
                    span = max(1, min(MAX_TABLE_COLS, int(c.get("colspan") or 1)))
                except ValueError:
                    span = 1
                cells.extend([m] + [""] * (span - 1))
            if any(x.strip() for x in cells):
                if not rows:
                    parent = tr.getparent()
                    head_row = all_th or (parent is not None and _tag(parent) == "thead")
                rows.append(cells)
        if not rows:
            return
        text = " ".join(x for x in plain if x)
        ncols = max(len(r) for r in rows)
        if ncols == 1 or len(rows) == 1 and not head_row:
            # One column (or one plain row): a list reads better than a table.
            md = "\n".join(f"- {' '.join(c for c in r if c)}" for r in rows)
            self._emit("table", "table", md, text, inl, ctx)
            return
        shown = min(ncols, MAX_TABLE_COLS)
        if not head_row and key_rows >= len(rows) * 0.8:
            header, body = [""] * shown, rows  # key: value rows, no header row
        else:
            header, body = rows[0], rows[1:]
        more_rows = len(body) - MAX_TABLE_ROWS
        body = body[:MAX_TABLE_ROWS]

        def line(r: list[str]) -> str:
            r = (r + [""] * shown)[:shown]
            return "| " + " | ".join(r) + " |"

        out = [line(header), "|" + " --- |" * shown] + [line(r) for r in body]
        cap = t.find("caption")
        if cap is not None and cap.text_content().strip():
            out.insert(0, f"**{_collapse(cap.text_content())}**\n")
        notes = []
        if more_rows > 0:
            notes.append(f"{more_rows} more rows")
        if ncols > shown:
            notes.append(f"{ncols - shown} more columns")
        if notes:
            out.append(f"[table cut: {', '.join(notes)} not shown]")
        self._emit("table", "table", "\n".join(out), text, inl, ctx)


def _score(raw: _Raw) -> float:
    """crawl4ai-style composite score, roughly 0..1.1 (higher = more like main content)."""
    density = min(1.0, raw.text_len / max(raw.markup_len, 1))
    heading = raw.block.kind in HEADINGS
    links = 1.0 if heading else 1.0 - min(1.0, raw.link_len / max(raw.text_len, 1))
    weight = TAG_WEIGHT.get(raw.tag, 0.5)
    if raw.ctx.main:
        weight = max(weight, 1.5)
    elif raw.ctx.positive:
        weight = max(weight, 1.3)
    cls = -0.5 * min(2, raw.ctx.penalty)
    length = min(1.0, math.log1p(raw.text_len) / math.log1p(400))
    return 0.4 * density + 0.2 * links + 0.2 * weight + 0.1 * cls + 0.1 * length


def _keep(raw: _Raw, score: float, threshold: float, min_words: int) -> bool:
    b = raw.block
    if len(b.text) < 120 and _NOISE.search(b.text):
        return False
    if b.kind in HEADINGS:
        return score >= threshold * 0.75
    if score < threshold:
        return False
    if b.kind in ("table", "pre", "list", "dl"):
        return True
    words = len(b.text.split())
    return words >= min_words or (words >= 1 and any(ch.isdigit() for ch in b.text))


def extract_page(
    html: str, url: str = "", *, threshold: float = THRESHOLD, min_words: int = MIN_WORDS
) -> Page:
    root = _parse(html)
    if root is None:
        return Page("", [], [])
    title = title_of(root)
    base = url
    base_el = root.find(".//base[@href]")
    if base_el is not None:
        base = urljoin(url, base_el.get("href") or "")
    body = root.find("body")
    if body is None:
        body = root
    _strip_chrome(body)
    walker = _Walker(base)
    walker.walk(body, _Ctx())
    raws = walker.out
    scores = [_score(r) for r in raws]
    for r, s in zip(raws, scores, strict=True):
        r.block.score = round(s, 3)
    kept = [r for r, s in zip(raws, scores, strict=True) if _keep(r, s, threshold, min_words)]
    if not any(r.block.kind not in HEADINGS for r in kept):
        # Nothing passed: dynamic threshold relative to this page's best block.
        body_scores = [s for r, s in zip(raws, scores, strict=True) if r.block.kind not in HEADINGS]
        if body_scores:
            dyn = max(body_scores) * 0.8
            kept = [r for r, s in zip(raws, scores, strict=True) if _keep(r, s, dyn, min_words)]
    blocks = _drop_orphan_headings([r.block for r in kept])
    for i, b in enumerate(blocks):
        b.order = i
    all_links = [link for r in raws for link in link_contexts(r.block)]
    return Page(title, blocks, all_links)


def link_contexts(block: Block) -> list[tuple[str, str, str]]:
    """(anchor, url, surrounding text) per link: the line it sits on (one list item, one
    table row), cut to about 150 characters either side of the anchor."""
    out: list[tuple[str, str, str]] = []
    for line in block.md.split("\n"):
        for m in _PH.finditer(line):
            i = int(m.group(1))
            if i >= len(block.links):
                continue
            text = _PH.sub(lambda x: x.group(2), line)
            anchor, url = block.links[i]
            at = max(0, text.find(anchor))
            out.append((anchor, url, text[max(0, at - 150) : at + len(anchor) + 150]))
    return out


def _drop_orphan_headings(blocks: list[Block]) -> list[Block]:
    """A heading with nothing under it (its section was all chrome) goes; h1 always stays."""
    out: list[Block] = []
    for i, b in enumerate(blocks):
        if b.heading > 1:
            nxt = blocks[i + 1] if i + 1 < len(blocks) else None
            if nxt is None or (nxt.heading and nxt.heading <= b.heading):
                continue
        out.append(b)
    return out


def prune(html: str, url: str = "", **kw) -> list[Block]:
    """The page's main-content blocks, in document order."""
    return extract_page(html, url, **kw).blocks


# ---------------------------------------------------------------- markdown


def render(blocks: Iterable[Block]) -> Markdown:
    urls: list[str] = []
    index: dict[str, int] = {}
    parts: list[str] = []
    for b in blocks:

        def cite(m: re.Match[str], b: Block = b) -> str:
            i, text = int(m.group(1)), m.group(2)
            if i >= len(b.links) or not text.strip():
                return text
            url = b.links[i][1]
            if url not in index:
                urls.append(url)
                index[url] = len(urls)
            return f"[{text}][{index[url]}]"

        md = _PH.sub(cite, b.md).strip()
        if md:
            parts.append(md)
    return Markdown("\n\n".join(parts), urls)


def to_markdown(blocks: Iterable[Block]) -> str:
    """Markdown with numbered link citations and a "Links:" list at the bottom."""
    return render(blocks).full()


def plain_md(block: Block) -> str:
    """The block's markdown with link placeholders reduced to their text."""
    return _PH.sub(lambda m: m.group(2), block.md)


_MD_LINK = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^)\s]+)[^)]*\)")
_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _md_plain(md: str) -> str:
    s = _MD_LINK.sub(r"\1", md)
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+", "", s, flags=re.M)
    s = re.sub(r"[*_`|]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def markdown_blocks(md: str) -> list[Block]:
    """Split a markdown (or plain text) document into blocks for search and selection."""
    chunks: list[tuple[str, list[str]]] = []
    cur: list[str] = []
    kind = "p"
    in_code = False

    def flush() -> None:
        nonlocal cur, kind
        if any(ln.strip() for ln in cur):
            chunks.append((kind, cur))
        cur, kind = [], "p"

    for ln in md.replace("\r\n", "\n").split("\n"):
        if ln.strip().startswith("```"):
            if in_code:
                cur.append(ln)
                kind = "pre"
                flush()
                in_code = False
            else:
                flush()
                in_code = True
                cur = [ln]
            continue
        if in_code:
            cur.append(ln)
            continue
        h = _MD_HEADING.match(ln.strip())
        if h:
            flush()
            chunks.append((f"h{len(h.group(1))}", [ln.strip()]))
            continue
        if not ln.strip():
            flush()
            continue
        if ln.lstrip().startswith("|"):
            if kind != "table" and cur:
                flush()
            kind = "table"
        elif re.match(r"^\s*(?:[-*+]|\d+\.)\s", ln) and not cur:
            kind = "list"
        cur.append(ln)
    if in_code:
        kind = "pre"
    flush()
    out: list[Block] = []
    for i, (k, lines) in enumerate(chunks):
        raw = "\n".join(lines).strip("\n")
        links = [(t, u) for t, u in _MD_LINK.findall(raw)]
        strong = " ".join(re.findall(r"\*\*([^*]+)\*\*", raw))
        out.append(Block(k, raw, _md_plain(raw), links, strong, 1.0, i))
    return out


# ---------------------------------------------------------------- BM25

_WORD = re.compile(r"[^\W_]+(?:[.,][0-9]+)*", re.U)
STOPWORDS = frozenset(
    """a an the and or but if of to in on at by for with from as is are was were be been being
    it its this that these those there here what which who whom whose when where why how do does
    did can could should would will may might must shall i you he she we they me him her us them
    my your his our their not no so than then too very just about into over under after before
    between also any all some more most such only own same other each few both up down out off
    again once get got please tell find give
    dan atau tetapi jika kalau yang di ke dari pada untuk dengan oleh ini itu adalah ialah ia
    mereka kami kita saya anda awak dia akan telah sudah belum tidak bukan juga lagi sahaja hanya
    dalam antara kepada bagi serta apa siapa bila bagaimana mengapa kenapa mana boleh perlu ada
    para sebagai tersebut iaitu manakala setiap semua lebih paling secara nak mahu sila""".split()
)
# Light suffix stripping that works for English and Malay alike (no stemming library).
_SUFFIXES = (
    ("ies", "y", 5),
    ("ied", "y", 5),
    ("ing", "", 6),
    ("nya", "", 6),
    ("lah", "", 6),
    ("kah", "", 6),
    ("kan", "", 6),
    ("ed", "", 5),
    ("es", "", 5),
    ("an", "", 6),
    ("s", "", 4),
)


def stem(word: str) -> str:
    if word.isdigit() or len(word) < 4:
        return word
    for suf, rep, min_len in _SUFFIXES:
        if len(word) >= min_len and word.endswith(suf):
            if suf == "s" and word.endswith(("ss", "us", "is")):
                break
            word = word[: -len(suf)] + rep
            break
    if len(word) >= 4 and word.endswith("e"):
        word = word[:-1]
    return word


def tokens(text: str) -> list[str]:
    out = []
    for w in _WORD.findall(text.lower()):
        if w in STOPWORDS or (len(w) < 2 and not w.isdigit()):
            continue
        out.append(stem(w))
    return out


def key_terms(text: str) -> list[str]:
    """Distinct search terms of a question, in order."""
    return list(dict.fromkeys(tokens(text)))


def key_words(text: str) -> dict[str, str]:
    """Each distinct search term with the word it came from (for showing people)."""
    out: dict[str, str] = {}
    for w in _WORD.findall(text.lower()):
        if w not in STOPWORDS and (len(w) >= 2 or w.isdigit()):
            out.setdefault(stem(w), w)
    return out


def bm25_scores(docs: list[Counter[str]], query: list[str], k1: float = 1.2, b: float = 0.75):
    n = len(docs)
    if not n or not query:
        return [0.0] * n
    q = list(dict.fromkeys(query))
    lengths = [sum(d.values()) for d in docs]
    avgdl = (sum(lengths) / n) or 1.0
    df = Counter(t for d in docs for t in q if t in d)
    scores = []
    for d, dl in zip(docs, lengths, strict=True):
        s = 0.0
        for t in q:
            f = d.get(t, 0)
            if f:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * dl / avgdl))
        scores.append(s)
    return scores


def block_tokens(b: Block) -> Counter[str]:
    c = Counter(tokens(b.text))
    for t in tokens(b.strong):  # bold text counts twice
        c[t] += 1
    return c


def _sections(blocks: list[Block]) -> list[int | None]:
    """Each block's section heading (h2 and below; the h1 page title matches everything)."""
    out: list[int | None] = []
    section: int | None = None
    for i, b in enumerate(blocks):
        out.append(None if b.heading else section)
        if b.heading == 1:
            section = None
        elif b.heading:
            section = i
    return out


def rank_blocks(blocks: list[Block], query: str) -> list[float]:
    """Per block: BM25 with heading boosts, plus half the score of its section heading."""
    raw = bm25_scores([block_tokens(b) for b in blocks], key_terms(query))
    boosted = [s * HEAD_BOOST.get(b.kind, 1.0) for s, b in zip(raw, blocks, strict=True)]
    return [
        boosted[i] + (0.5 * boosted[h] if h is not None else 0.0)
        for i, h in enumerate(_sections(blocks))
    ]


def bm25_blocks(
    blocks: list[Block], query: str, budget_chars: int, *, min_ratio: float = 0.25
) -> list[Block]:
    """The blocks that best answer `query`, in document order, within `budget_chars` of
    markdown. Blocks scoring under `min_ratio` of the best one are left out (a stray common
    word is not a match), and a block's section heading comes along when it fits. If even
    the best block is over budget it is returned alone (the caller decides what to do)."""
    if not blocks or not key_terms(query):
        return []
    final = rank_blocks(blocks, query)
    floor = max(final, default=0.0) * min_ratio
    sect = _sections(blocks)
    order = sorted(range(len(blocks)), key=lambda i: -final[i])
    chosen: set[int] = set()
    used = 0

    def cost(i: int) -> int:
        return len(plain_md(blocks[i])) + 2 + 4 * len(blocks[i].links)

    for i in order:
        if final[i] <= 0 or final[i] < floor:
            break
        if i in chosen:
            continue
        need = [i]
        h = sect[i]
        if h is not None and h not in chosen:
            need.append(h)
        c = sum(cost(j) for j in need)
        if used + c <= budget_chars:
            chosen.update(need)
            used += c
        elif used + cost(i) <= budget_chars:
            chosen.add(i)
            used += cost(i)
    if not chosen and order and final[order[0]] > 0:
        chosen.add(order[0])
    return [blocks[i] for i in sorted(chosen)]
