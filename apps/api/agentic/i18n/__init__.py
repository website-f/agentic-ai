"""Languages on the server (P22): English and Bahasa Melayu, the same idea as the web app.

The English text IS the key, with `{var}` placeholders: `tr("Linked to {name}.", name=n)`.
Malay lives in `ms.py` as English -> Malay pairs; a missing entry falls back to the English.
`tests/test_i18n.py` fails while a marked text has no Malay entry or a `{var}` goes missing.

Three ways to mark text:

- `tr(text, lang=None, **vars)`: render now, in `lang` or the current language. For text
  going to one known person right away (a bot reply, a notification for this recipient).
- `Msg(text, **vars)`: a str that IS the English (so logs, audit rows and tests read English)
  and remembers its template, so it can be rendered later in someone else's language:
  `render(m, "ms")`. Errors and notifications use it: the API turns an error's Msg into the
  request's language only when it answers, and the delivery ledger renders a notice in each
  recipient's language.
- `api_error(status, code, "English template.", **vars)` treats its message as a template too.

The language of the request lives in a contextvar (`current_lang()`): set from the X-Lang
header, else the signed-in person's saved preference, else English. Notifications use the
RECIPIENT's preference (`services.prefs.language`), never the request's.

Text this module never had a Msg for (a plain str) is still looked up: first as an exact
key, then against the templates with `{vars}` (so "Agent Ali is paused." finds
"Agent {name} is paused."). That lets messages raised in modules that build plain English
strings be translated by adding the template to `ms.py`, without touching them.

No dependencies on the rest of the app, on purpose.
"""

import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar, Token
from functools import lru_cache
from typing import Any

from .ms import MS

LANGS: tuple[str, ...] = ("en", "ms")
DEFAULT = "en"
DICTS: dict[str, Mapping[str, str]] = {"en": {}, "ms": MS}

_lang: ContextVar[str | None] = ContextVar("agentic_lang", default=None)
_VAR = re.compile(r"\{(\w+)\}")


def normalize(value: Any) -> str | None:
    """ "ms", "ms-MY", "MS", "en-GB" -> "ms" / "en"; anything else -> None."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower()[:2]
    return v if v in LANGS else None


def current_lang() -> str:
    """The language for what is being said right now (the request's, or one set by
    use_lang). English when nothing set one."""
    return _lang.get() or DEFAULT


def explicit_lang() -> str | None:
    """The language someone set for this context, or None when it is only the default."""
    return _lang.get()


def set_lang(lang: str | None) -> Token[str | None]:
    return _lang.set(normalize(lang))


def reset_lang(token: Token[str | None]) -> None:
    _lang.reset(token)


@contextmanager
def use_lang(lang: str | None) -> Iterator[str]:
    """`with use_lang(user_lang):` everything tr() says inside is in that language."""
    token = _lang.set(normalize(lang) or DEFAULT)
    try:
        yield current_lang()
    finally:
        _lang.reset(token)


def _plain(text: str) -> str:
    """One English word, two meanings: "Open|verb" shows "Open" in English (as in the app)."""
    bar = text.find("|")
    return text[:bar] if bar > 0 else text


def _lookup(text: str, lang: str) -> str:
    if lang == DEFAULT:
        return _plain(text)
    d = DICTS.get(lang) or {}
    return d.get(text) or d.get(_plain(text)) or _plain(text)


def _fill(template: str, values: Mapping[str, Any], lang: str) -> str:
    if not values:
        return template

    def one(m: re.Match[str]) -> str:
        k = m.group(1)
        if k not in values:
            return m.group(0)
        v = values[k]
        # Only a Msg is translated: names, titles and numbers go in exactly as they are.
        return v.render(lang) if isinstance(v, Msg) else str(v)

    return _VAR.sub(one, template)


def _rebuild(template: str, values: dict[str, Any]) -> "Msg":
    return Msg(template, **values)


class Msg(str):
    """English now, any language later. `Msg("{n} files", n=3) == "3 files"`.

    str() of it (and of an exception holding it) keeps the template, so a router that does
    `api_error(400, "x", str(e))` still answers in the person's language.
    """

    template: str
    vars: dict[str, Any]

    def __new__(cls, template: str, /, **vars: Any) -> "Msg":
        obj = super().__new__(cls, _fill(_plain(template), vars, DEFAULT))
        obj.template = template
        obj.vars = vars
        return obj

    def __str__(self) -> str:
        return self

    def __reduce__(self) -> tuple[Any, ...]:
        return (_rebuild, (self.template, dict(self.vars)))

    def render(self, lang: str | None = None) -> str:
        lang = normalize(lang) or current_lang()
        return _fill(_lookup(self.template, lang), self.vars, lang)

    @property
    def english(self) -> str:
        return str.__str__(self)


class _Lookup(Msg):
    """Plain English from elsewhere, translated by lookup when rendered (see lookup())."""

    def render(self, lang: str | None = None) -> str:
        return render(self.english, lang)


def lookup(text: str) -> Msg:
    """Wrap English that is not a Msg (an error raised in another module) so it is still
    translated, by exact key or template, when it goes into a sentence as a {var}."""
    if isinstance(text, Msg):
        return text
    str_value = str.__str__(text)
    m = str.__new__(_Lookup, str_value)
    m.template, m.vars = str_value, {}
    return m


class Plain(str):
    """Text that must never be translated (what an agent or a person wrote)."""

    def __str__(self) -> str:
        return self


def tr(text: str, lang: str | None = None, /, **vars: Any) -> str:
    """`text` in `lang` (default: the current language), with `{vars}` filled in."""
    lang = normalize(lang) or current_lang()
    return _fill(_lookup(text, lang), vars, lang)


def render(text: Any, lang: str | None = None) -> str:
    """Any text in `lang`: a Msg by its template, a Plain as it is, a plain str by lookup
    (exact key, then the templates with {vars}). Always returns a plain str."""
    if text is None:
        return ""
    lang = normalize(lang) or current_lang()
    if isinstance(text, Msg):
        return text.render(lang)
    if not isinstance(text, str):
        return str(text)
    out = str.__str__(text)
    if isinstance(text, Plain) or lang == DEFAULT or not out:
        return out
    d = DICTS.get(lang) or {}
    hit = d.get(out)
    if hit is not None:
        return hit
    found = match_template(out, lang)
    return found if found is not None else out


# ---------------------------------------------------------------- templates for plain text


_MIN_LETTERS = 6  # a template needs this many literal letters to be matched against


@lru_cache(maxsize=8)
def _patterns(lang: str, _size: int) -> tuple[tuple[str, re.Pattern[str], str], ...]:
    """(longest literal piece, pattern, template) for every template with {vars}, the most
    specific (longest literal text) first. Values never span lines."""
    out: list[tuple[int, str, re.Pattern[str], str]] = []
    for key in DICTS.get(lang) or {}:
        template = _plain(key)
        if "{" not in template:
            continue
        pieces = _VAR.split(template)  # literal, var, literal, var, ...
        literals = pieces[0::2]
        letters = sum(c.isalpha() for c in "".join(literals))
        if letters < _MIN_LETTERS:
            continue
        rx, seen = "", set()
        for i, p in enumerate(pieces):
            if i % 2 == 0:
                rx += re.escape(p)
            elif p in seen:
                rx += f"(?P={p})"
            else:
                seen.add(p)
                rx += f"(?P<{p}>.+?)"
        try:
            pat = re.compile(rx)
        except re.error:
            continue
        out.append((letters, max(literals, key=len), pat, key))
    out.sort(key=lambda x: -x[0])
    return tuple((lit, pat, key) for _, lit, pat, key in out)


def match_template(text: str, lang: str) -> str | None:
    """Translate English that was built from a known template ("Agent Ali is paused." via
    "Agent {name} is paused."). None when no template fits."""
    if "\n" in text or len(text) > 600:
        return None
    # The size is part of the cache key: modules may register entries at import time.
    for lit, pat, key in _patterns(lang, len(DICTS.get(lang) or {})):
        if lit and lit not in text:
            continue
        m = pat.fullmatch(text)
        if m is not None:
            return _fill(_lookup(key, lang), m.groupdict(), lang)
    return None


def vars_of(text: str) -> list[str]:
    """The {var} names in a text, sorted, each once (for the coverage test). A var used
    twice in English may appear once in the translation."""
    return sorted(set(_VAR.findall(text)))
