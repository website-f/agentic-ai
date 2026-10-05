"""Words in, words out: how document search cuts text into words and a query into a match.

Postgres' own text parser reads "RM700" as one word but "RM 700" as two, "1,500.50" as
"1" and "500.50", and "PKS-2024/07" as "pks", "-2024", "/07". People type amounts, dates and
codes every way, so search builds its tsvectors (and tsqueries) here instead:

- A word is a run of letters, or a number ("1,500.50" stays one number, stored as "1500.50"
  and "1500"). "RM700" is the two words "rm" "700" side by side, so "RM700", "RM 700" and
  "rm700.00" all meet. "16hb" is "16" "hb"; "16 hb" finds it too.
- No dictionary stemming (the office writes Malay and English in one sentence), but a light
  Malay/English root sits beside each word: "kelayakan" also carries "layak", "pembayaran"
  "bayar", "claims" "claim". Roots and number forms are weight C, real words weight D and
  heading words weight B, so an exact word outranks a root match and the vocabulary for
  suggestions leaves roots out.
- Stop words (the library's English + Malay list) are dropped from loose words but kept in
  "quoted phrases".

Every lexeme is letters, digits or "." only, so the tsvector / tsquery literals built here
cannot carry operators from the text.
"""

import html
import re
from dataclasses import dataclass, field

from ..brain.search import STOP

_TOKEN = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|[^\W\d_]+")
_QUOTED = re.compile(r'"([^"]*)"|“([^”]*)”')
MAX_POS = 16383  # Postgres keeps positions up to this
MAX_POSITIONS = 250  # per lexeme (Postgres keeps 256)
MAX_LEXEME = 120
HEAD_GAP = 3  # positions between a passage's heading and its text: no phrase across them

# Malay affixes, longest first. Roots must keep at least 4 letters.
_PARTICLES = ("nya", "lah", "kah")
_SUFFIXES = ("kan", "an")
_PREFIXES = (
    "memper",
    "member",
    "meng",
    "peng",
    "mem",
    "men",
    "pem",
    "pen",
    "per",
    "ber",
    "ter",
    "me",
    "pe",
    "di",
    "ke",
)
MIN_ROOT = 4


def norm_number(tok: str) -> list[str]:
    """'1,500.50' -> ['1500.50', '1500']; '700.00' -> ['700.00', '700']; '07' -> ['07', '7']."""
    n = tok.replace(",", "")
    out = [n]
    whole, _, frac = n.partition(".")
    if frac and (len(frac) <= 2 or set(frac) == {"0"}):
        out.append(whole)
    if len(whole) > 1 and whole.startswith("0") and whole.strip("0"):
        out.append(whole.lstrip("0") + (f".{frac}" if frac else ""))
    return list(dict.fromkeys(out))


def _unprefix(w: str) -> str:
    for p in _PREFIXES:
        if w.startswith(p) and len(w) - len(p) >= MIN_ROOT:
            return w[len(p) :]
    return w


def roots(word: str) -> list[str]:
    """Light roots: Malay particles, a suffix and one prefix, an English plural 's'. "-kan"
    and "-an" are ambiguous ("kelayakan" is ke-layak-an, "jalankan" jalan-kan), so both
    readings are kept. Empty when the word is its own root or too short to trim safely."""
    if not word.isalpha() or len(word) < 5:
        return []
    base = word
    for p in _PARTICLES:
        if base.endswith(p) and len(base) - len(p) >= MIN_ROOT:
            base = base[: -len(p)]
            break
    found = [base] if base != word else []
    for s in _SUFFIXES:
        if base.endswith(s) and len(base) - len(s) >= MIN_ROOT:
            found.append(base[: -len(s)])
    found = [_unprefix(w) for w in (found or [base])] + found
    if not found or found == [word]:
        found = [word[:-1]] if word.endswith("s") and not word.endswith("ss") else []
    out = [w for w in dict.fromkeys(found) if w != word and len(w) >= MIN_ROOT]
    return out[:4]


@dataclass
class Token:
    text: str  # as written (casefolded)
    start: int
    end: int

    @property
    def number(self) -> bool:
        return self.text[0].isdigit()


def tokens(text: str) -> list[Token]:
    low = text.casefold()
    return [Token(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(low)]


def lexemes_of(tok: str) -> tuple[list[str], list[str]]:
    """(the word's own lexemes, its variants)."""
    if tok[0].isdigit():
        forms = norm_number(tok)
        return forms[:1], forms[1:]
    return [tok], roots(tok)


def _quote(lex: str) -> str:
    return "'" + lex.replace("\\", "\\\\").replace("'", "''") + "'"


def tsvector(heading: str, body: str) -> str:
    """A tsvector literal for a passage: heading words (weight B), text words (D), their
    roots and number forms (C)."""
    pos: dict[str, dict[int, str]] = {}

    def add(lex: str, p: int, w: str) -> None:
        if not lex or len(lex) > MAX_LEXEME or p > MAX_POS:
            return
        slot = pos.setdefault(lex, {})
        if len(slot) >= MAX_POSITIONS:
            return
        # A real word beats a variant at the same spot.
        if p not in slot or (slot[p] == "C" and w != "C"):
            slot[p] = w

    p = 0
    for part, weight in ((heading, "B"), (body, "D")):
        if part is heading and not heading:
            continue
        for tok in tokens(part):
            p += 1
            own, extra = lexemes_of(tok.text)
            for lex in own:
                add(lex, p, weight)
            for lex in extra:
                add(lex, p, "C")
        p += HEAD_GAP
    items = []
    for lex in sorted(pos):
        spots = ",".join(f"{q}{'' if w == 'D' else w}" for q, w in sorted(pos[lex].items()))
        items.append(f"{_quote(lex)}:{spots}")
    return " ".join(items)


def words(text: str) -> list[str]:
    """The lexemes a vocabulary keeps: real words only (no roots or number forms)."""
    out = []
    for tok in tokens(text):
        out.extend(lexemes_of(tok.text)[0])
    return out


# ---------------------------------------------------------------- queries


@dataclass
class Term:
    """One thing the query asks for: a loose word, a written-together group ('rm700',
    'e-mel'), or a quoted phrase. `parts` are the words side by side."""

    parts: list[str]
    phrase: bool = False  # quoted: stop words kept, no prefix
    prefix: bool = False  # the last part may be the start of a word
    alternatives: list[str] = field(default_factory=list)  # fuzzy corrections (whole word)

    @property
    def single(self) -> bool:
        return len(self.parts) == 1

    def tsquery(self) -> str:
        if self.single:
            w = self.parts[0]
            alts: list[str] = []
            own, extra = lexemes_of(w)
            if self.prefix and not w[0].isdigit() and len(w) >= 2:
                alts.append(f"{_quote(own[0])}:*")
            else:
                alts.extend(_quote(x) for x in own)
            alts.extend(_quote(x) for x in extra)
            if not w[0].isdigit():
                alts.extend(_quote(x) for x in self.alternatives)
            return "(" + " | ".join(dict.fromkeys(alts)) + ")"
        out = []
        for i, w in enumerate(self.parts):
            if w[0].isdigit():
                forms = norm_number(w)
                out.append(
                    _quote(forms[0])
                    if len(forms) == 1
                    else "(" + " | ".join(map(_quote, forms)) + ")"
                )
            elif self.prefix and i == len(self.parts) - 1 and len(w) >= 2:
                out.append(f"{_quote(w)}:*")
            else:
                out.append(_quote(w))
        return "(" + " <-> ".join(out) + ")"

    def pattern(self) -> str:
        """A regex that finds this term in display text (for <mark>)."""

        def one(w: str, last: bool) -> str:
            if w[0].isdigit():
                whole, _, frac = w.replace(",", "").partition(".")
                digits = ",?".join(re.escape(c) for c in whole)
                tail = re.escape("." + frac) if frac else r"(?:\.\d+)?"
                return rf"(?<![\d,.]){digits}{tail}(?!\d)"
            body = re.escape(w)
            return rf"(?<![^\W\d_]){body}" + (
                r"[^\W\d_]*" if (self.prefix and last) else r"(?![^\W\d_])"
            )

        if self.single:
            w = self.parts[0]
            alts = [one(w, True)]
            for r in roots(w) if not w[0].isdigit() else []:
                if len(r) >= 5:  # a short root would mark unrelated words
                    alts.append(rf"[^\W\d_]*{re.escape(r)}[^\W\d_]*")
            alts.extend(rf"(?<![^\W\d_]){re.escape(a)}(?![^\W\d_])" for a in self.alternatives)
            return "|".join(alts)
        sep = r"[\W_]*"
        return sep.join(one(w, i == len(self.parts) - 1) for i, w in enumerate(self.parts))


@dataclass
class Query:
    raw: str
    terms: list[Term]

    @property
    def empty(self) -> bool:
        return not self.terms

    def tsquery(self, mode: str = "and") -> str:
        joiner = " & " if mode == "and" else " | "
        return joiner.join(t.tsquery() for t in self.terms)

    def loose(self) -> list[Term]:
        return [t for t in self.terms if t.single and not t.phrase]

    def regex(self) -> re.Pattern[str] | None:
        pats = [t.pattern() for t in self.terms]
        if not pats:
            return None
        loose = [t for t in self.terms if not t.phrase]
        if len(loose) > 1:
            # Words typed side by side are marked as one stretch where they stand together.
            parts = [w for t in loose for w in t.parts]
            pats.insert(0, Term(parts, prefix=loose[-1].prefix).pattern())
        return re.compile("|".join(f"(?:{p})" for p in pats), re.I)

    def literal(self) -> str:
        """The query as typed, quotes taken out, for an exact-substring match."""
        return re.sub(
            r"\s+", " ", _QUOTED.sub(lambda m: m.group(1) or m.group(2) or "", self.raw)
        ).strip(" *")


def _group(chunk: str) -> list[str]:
    return [t.text for t in tokens(chunk)]


def parse(raw: str, *, prefix_last: bool = True) -> Query:
    """Quoted phrases, words written together ('RM700', 'e-mel', '16/3/2026') and loose
    words. Loose words of 3+ letters match as prefixes ('kelayak' finds 'kelayakan'); a
    trailing * asks for a prefix on anything."""
    raw = (raw or "").strip()[:300]
    terms: list[Term] = []
    for m in _QUOTED.finditer(raw):
        parts = _group(m.group(1) or m.group(2) or "")
        if parts:
            terms.append(Term(parts, phrase=True))
    rest = _QUOTED.sub(" ", raw)
    chunks = rest.split()
    loose: list[Term] = []
    for i, chunk in enumerate(chunks):
        star = chunk.endswith("*")
        parts = _group(chunk)
        if not parts:
            continue
        last = i == len(chunks) - 1
        if len(parts) == 1:
            w = parts[0]
            pre = (
                star
                or (not w[0].isdigit() and len(w) >= 3)
                or (last and prefix_last and len(w) >= 2 and not w[0].isdigit())
            )
            loose.append(Term(parts, prefix=pre))
        else:
            loose.append(Term(parts, prefix=star or (last and prefix_last)))
    content = [t for t in loose if not (t.single and t.parts[0] in STOP)]
    terms.extend(content or loose)
    # One term per distinct ask, at most 12.
    seen: set[tuple[str, ...]] = set()
    out = []
    for t in terms:
        key = (*t.parts, "p" if t.phrase else "")
        if key not in seen:
            seen.add(key)
            out.append(t)
    return Query(raw, out[:12])


# ---------------------------------------------------------------- snippets


def _spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def spans(text: str, rx: re.Pattern[str] | None) -> list[tuple[int, int]]:
    if rx is None:
        return []
    out = []
    for m in rx.finditer(text):
        if m.end() > m.start():
            out.append((m.start(), m.end()))
    return out


def marked(text: str, rx: re.Pattern[str] | None) -> str:
    """HTML-escaped text with <mark> around every match (the only tag it ever holds)."""
    out: list[str] = []
    at = 0
    for s, e in spans(text, rx):
        if s < at:
            continue
        out.append(html.escape(text[at:s]))
        out.append("<mark>" + html.escape(text[s:e]) + "</mark>")
        at = e
    out.append(html.escape(text[at:]))
    return "".join(out)


def snippet(text: str, rx: re.Pattern[str] | None, limit: int = 240) -> str:
    """The stretch of `text` with the most matches, about `limit` characters, marked."""
    flat = _spaces(text)
    if not flat:
        return ""
    found = spans(flat, rx)
    if len(flat) <= limit:
        return marked(flat, rx)
    start = 0
    if found:
        best = -1
        for s, _ in found:
            n = sum(1 for x, _ in found if s <= x < s + limit - 40)
            if n > best:
                best, start = n, s
        start = max(0, start - limit // 4)
        if start:
            space = flat.find(" ", start)
            start = space + 1 if 0 <= space < start + 30 else start
    end = min(len(flat), start + limit)
    if end < len(flat):
        space = flat.rfind(" ", start + limit // 2, end)
        end = space if space > 0 else end
    body = flat[start:end].strip()
    return ("…" if start else "") + marked(body, rx) + ("…" if end < len(flat) else "")


def hit_count(text: str, q: Query) -> int:
    """How many of the query's terms appear in `text` (for ranking)."""
    n = 0
    for t in q.terms:
        if re.search(t.pattern(), text, re.I):
            n += 1
    return n
