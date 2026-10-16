"""P33 privacy gateway: whatever data is in here stays in here; AI providers are just fuel.

Every text a cloud model is sent passes through `Masker`: real identifiers (MyKad, passport,
bank account and card numbers, people's names, emails, phones, addresses, company names,
registration numbers, tender and PO/invoice references) become placeholders such as
`[PERSON_K3QZX]`. The reply, its reasoning and the agent's tool-call arguments come back with
the real values restored (`unmask`), so tools act on real data and nothing stored changes.

Placeholders are stable without storing any mapping: the code is the first 5 characters of
base32(HMAC-SHA256(secret_key, KIND + normalised value)), so the same person is the same
placeholder in every call and the provider's prompt cache keeps working. The per-call
mapping (placeholder -> real) lives only in memory for that request.

Detection: a per-workspace dictionary of known values from the database (members, branches,
company kits, P35 customers / suppliers and their contacts; built at most once a minute per
process, and again at once when they change) plus pattern detectors. Where two
findings overlap, the longest wins.

Routing (gateway.py): a company's data level (branches.data_level) limits which providers may
see its work at all: "confidential" = trusted providers (and local) only, "local_only" = this
server's own model only. Local providers are never masked: the data does not leave.
"""

import base64
import hashlib
import hmac
import json
import re
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings as app_settings
from ..models import (
    Agent,
    AIProvider,
    Branch,
    CompanyKit,
    Membership,
    Party,
    PartyContact,
    Task,
    User,
    Workspace,
)
from . import store

# ---------------------------------------------------------------- settings

CATEGORIES: tuple[str, ...] = ("ids", "people", "companies", "amounts")
DEFAULT_CATEGORIES: dict[str, bool] = {
    "ids": True,
    "people": True,
    "companies": True,
    "amounts": False,
}
LEVELS: tuple[str, ...] = ("standard", "confidential", "local_only")

KIND_CATEGORY: dict[str, str] = {
    "IC": "ids",
    "PASSPORT": "ids",
    "BANKACC": "ids",
    "CARD": "ids",
    "PERSON": "people",
    "EMAIL": "people",
    "PHONE": "people",
    "ADDRESS": "people",
    "COMPANY": "companies",
    # One of the workspace's own companies (from the database): telling the model "ours" from
    # "another company" reveals nothing private and keeps it from mixing the two up.
    "OURCO": "companies",
    "REF": "companies",
    "AMOUNT": "amounts",
}
KINDS: tuple[str, ...] = tuple(KIND_CATEGORY)


def privacy_settings(ws_settings: dict[str, Any] | None) -> dict[str, Any]:
    """workspace.settings["privacy"] merged over the defaults (masking ON when absent)."""
    raw = (ws_settings or {}).get("privacy") or {}
    cats = dict(DEFAULT_CATEGORIES)
    for k, v in (raw.get("categories") or {}).items():
        if k in cats and isinstance(v, bool):
            cats[k] = v
    masking = raw.get("masking")
    return {"masking": masking if isinstance(masking, bool) else True, "categories": cats}


# ---------------------------------------------------------------- routing policy


def is_local(p: AIProvider) -> bool:
    """The data does not leave this server: the built-in local model or a provider the
    workspace marked as local (its own Ollama, for example)."""
    return p.tier == "local" or p.name == store.LOCAL_PROVIDER


def allowed(p: AIProvider, level: str) -> bool:
    if level == "local_only":
        return is_local(p)
    if level == "confidential":
        return is_local(p) or bool(p.trusted)
    return True


BLOCKED = {
    "confidential": (
        "This company is set to Confidential: no trusted AI provider is available. Mark one "
        "as trusted on the AI Engine page or add one."
    ),
    "local_only": (
        "This company is set to Local only: no AI model on this server is available for this "
        "job. Its data never goes to cloud AI providers."
    ),
}
SKIPPED = {
    "confidential": "not trusted for this Confidential company",
    "local_only": "cloud provider: this company is Local only",
}


async def resolve_level(
    db: AsyncSession,
    workspace_id: str,
    branch_id: str | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> tuple[str, str | None]:
    """(data level, branch id) for a model call. The branch is the one given, else the
    task's, else the agent's: every call made for a company's work follows its level, even
    from a call site that did not name the company."""
    if not branch_id and task_id:
        t = await db.get(Task, task_id)
        if t is not None and t.workspace_id == workspace_id:
            branch_id = t.branch_id
    if not branch_id and agent_id:
        a = await db.get(Agent, agent_id)
        if a is not None and a.workspace_id == workspace_id:
            branch_id = a.branch_id
    if not branch_id:
        return "standard", None
    b = await db.get(Branch, branch_id)
    if b is None or b.workspace_id != workspace_id:
        return "standard", None
    level = b.data_level if b.data_level in LEVELS else "standard"
    return level, branch_id


def zdr_body() -> dict[str, Any]:
    """OpenRouter provider routing (openrouter.ai/docs/features/zdr and provider-routing):
    only endpoints that keep no prompts and do not collect data. A model without such an
    endpoint fails the call, which the gateway treats as that member failing."""
    return {"provider": {"data_collection": "deny", "zdr": True}}


# ---------------------------------------------------------------- normalising + codes


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v)


def normalise(kind: str, value: str) -> str:
    v = value.strip()
    if kind in ("IC", "CARD", "BANKACC"):
        return _digits(v)
    if kind == "PHONE":
        d = _digits(v)
        return "0" + d[2:] if d.startswith("60") and len(d) >= 10 else d
    if kind == "EMAIL":
        return v.lower()
    if kind in ("PASSPORT", "REF"):
        return re.sub(r"\s+", "", v).upper()
    if kind in ("COMPANY", "OURCO"):
        v = v.replace(".", " ")
    return re.sub(r"[\s,]+", " ", v).casefold().strip()


def _secret() -> bytes:
    return app_settings.secret_key.encode()


def code_for(kind: str, value: str) -> str:
    """The full base32 code of a value; placeholders use its first 5 characters (more only
    when two values of one call collide)."""
    digest = hmac.new(_secret(), (kind + normalise(kind, value)).encode(), hashlib.sha256)
    return base64.b32encode(digest.digest()).decode().rstrip("=")


# ---------------------------------------------------------------- pattern detectors


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def _mykad_date(v: str) -> bool:
    d = _digits(v)
    if len(d) != 12:
        return False
    month, day = int(d[2:4]), int(d[4:6])
    return 1 <= month <= 12 and 1 <= day <= 31


def _has_digit(v: str) -> bool:
    return any(c.isdigit() for c in v)


@dataclass(frozen=True)
class _Pattern:
    kind: str
    rx: re.Pattern[str]
    group: int = 0
    check: Any = None  # callable(str) -> bool


_LABEL_NO = r"(?:\s*(?:no|number|num|#)\b)?\.?\s*[:#.\-]?\s*"

# People who are not in the database (customers, suppliers' staff named in documents) are
# found by strong Malaysian signals: a title, a patronymic (bin/binti/a/l/a/p) or a label.
_NAME_WORD = r"(?:[A-Z][A-Za-z'\u2019\-]*[A-Za-z]|[A-Z]\.)"
_NAME_LINK = r"(?:(?i:bin|binti|bt\.?|b\.|a/l|a/p|anak)|@)"
_NAME_SEQ = _NAME_WORD + r"(?:(?:[ \t]+" + _NAME_LINK + r")?[ \t]+" + _NAME_WORD + r"){0,6}"
_TITLE_RX = (
    r"(?i:encik|en\.?|puan|pn\.?|cik|tuan|tn\.?|dato['\u2019]?(?:[ \t]+s(?:e)?ri)?"
    r"|datuk(?:[ \t]+seri)?|datin(?:[ \t]+paduka)?|tan[ \t]+sri|puan[ \t]+sri|dr\.?|ir\.?"
    r"|ts\.?|haji|hj\.?|hajah|hjh\.?|mr\.?|mrs\.?|ms\.?|miss|mdm\.?|madam|prof\.?|professor)"
)
_NAME_LABEL = (
    r"(?i:\b(?:dear|attn|attention|contact[ \t]+person|name|nama|pegawai|officer"
    r"|prepared[ \t]+by|approved[ \t]+by|signed[ \t]+by|requested[ \t]+by|submitted[ \t]+by)"
    r"\b\.?[ \t]*[:\-]?[ \t]*)"
)

PATTERNS: tuple[_Pattern, ...] = (
    _Pattern(
        "EMAIL",
        re.compile(
            r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])"
        ),
    ),
    # Bank account numbers when a label says so ("Account no: 5123 4567 8901", "No. akaun").
    _Pattern(
        "BANKACC",
        re.compile(
            r"(?i:\b(?:bank\s+)?(?:account|acct|acc|akaun|a/c)" + _LABEL_NO + r")"
            r"(\d(?:[ \-]?\d){6,19})(?!\d)"
        ),
        1,
    ),
    # MyKad: 900101-14-5678 or 900101145678 (birth date checked).
    _Pattern("IC", re.compile(r"(?<![\d\-])\d{6}[\- ]\d{2}[\- ]\d{4}(?![\d\-])"), 0, _mykad_date),
    _Pattern("IC", re.compile(r"(?<!\d)\d{12}(?!\d)"), 0, _mykad_date),
    # Card numbers: Luhn-valid 13-19 digits, plain or grouped.
    _Pattern(
        "CARD",
        re.compile(
            r"(?<![\d\-])(?:\d{4}([ \-]?)\d{4}\1\d{4}\1\d{1,7}|\d{4}[ \-]\d{6}[ \-]\d{5}|\d{13,19})"
            r"(?![\d\-])"
        ),
        0,
        lambda v: 13 <= len(_digits(v)) <= 19 and _luhn(_digits(v)),
    ),
    # Passports: Malaysian A/H/K + 8 digits, or any number after the word passport.
    _Pattern("PASSPORT", re.compile(r"(?<![A-Za-z0-9])[AHK]\d{8}(?![A-Za-z0-9])")),
    _Pattern(
        "PASSPORT",
        re.compile(r"(?i:\bpas+port" + _LABEL_NO + r")([A-Z0-9]{6,9})(?![A-Za-z0-9])"),
        1,
        _has_digit,
    ),
    # Malaysian phones: mobile 01x and landlines, local or +60.
    _Pattern(
        "PHONE",
        re.compile(r"(?<![\w+])(?:\+?60[ \-]?|0)1\d[ \-]?\d{3,4}[ \-]?\d{4}(?!\d)"),
    ),
    _Pattern(
        "PHONE",
        re.compile(r"(?<![\w+])(?:\+?60[ \-]?|0)[3-9][ \-]?\d{3,4}[ \-]?\d{4}(?!\d)"),
    ),
    # Other international numbers, written with a + country code.
    _Pattern(
        "PHONE",
        re.compile(
            r"(?<![\w+])\+\d{1,3}[ \-]?(?:\(\d{1,4}\)[ \-]?)?\d{2,4}(?:[ \-]?\d{2,4}){1,4}(?!\d)"
        ),
        0,
        lambda v: 8 <= len(_digits(v)) <= 15,
    ),
    # ePerolehan tender (QT...) and proposal (PN...) numbers.
    _Pattern("REF", re.compile(r"(?<![A-Za-z0-9])(?:QT|PN)\d{10,}(?!\d)")),
    # PO / invoice numbers when labelled.
    _Pattern(
        "REF",
        re.compile(
            r"(?i:\b(?:p\.?o\.?|purchase\s+order|invoice|inv)" + _LABEL_NO + r")"
            r"([A-Za-z0-9][A-Za-z0-9/\-]{2,30})(?![A-Za-z0-9])"
        ),
        1,
        _has_digit,
    ),
    # A title then a name: only the name is hidden, so "Encik [PERSON_...]" keeps the form
    # of address. Several titles may stack ("Dato' Sri Dr. Ahmad").
    _Pattern(
        "PERSON",
        re.compile(r"(?<![\w])(?:" + _TITLE_RX + r"[ \t]+)+(" + _NAME_SEQ + r")"),
        1,
        lambda v: _name_ok(v),
    ),
    # Patronymic names: "Siti Aminah binti Abdullah", "Muthu a/l Rajan".
    _Pattern(
        "PERSON",
        re.compile(
            r"(?<![\w])(?:"
            + _NAME_WORD
            + r"[ \t]+){1,4}(?i:bin|binti|bt\.?|a/l|a/p)[ \t]+"
            + _NAME_WORD
            + r"(?:[ \t]+"
            + _NAME_WORD
            + r"){0,3}"
        ),
        0,
        lambda v: _name_ok(v),
    ),
    # A label then a name: "Dear Ahmad", "Attn: Siti", "Contact person: Lim Wei Ming".
    _Pattern(
        "PERSON",
        re.compile(_NAME_LABEL + r"(" + _NAME_SEQ + r")"),
        1,
        lambda v: _name_ok(v),
    ),
    # Malaysian company names: "<Capitalised words> Sdn Bhd / Bhd / Berhad / PLT / ...".
    _Pattern(
        "COMPANY",
        re.compile(
            r"(?<![\w&])(?:[A-Z][\w&'.\-]*|\(M\))(?:[ \t]+(?:[A-Z][\w&'.\-]*|\(M\)|&)){0,6}"
            r"[ \t]+(?:Sdn\.?[ \t]*Bhd\.?|Bhd\.?|Berhad|PLT|Enterprise|Trading|Resources)(?!\w)"
        ),
    ),
    _Pattern(
        "AMOUNT",
        re.compile(
            r"(?:(?i:\b(?:RM|MYR|USD|SGD|EUR|GBP))[ \t]?|\$)\d[\d,]*(?:\.\d{1,2})?"
            r"(?:[ \t]?(?i:k|mil|million|juta|bil|billion)\b)?"
        ),
    ),
)

# Words that start a sentence, not a company name ("The ABC Trading" -> "ABC Trading").
_LEAD_WORDS = frozenset(
    "the a an our your their my his her its this that these those dear hi hello to from for "
    "and or of in at by with please contact call email ask tell send pay paid via per "
    "syarikat kepada daripada untuk dan".split()
)

# Titles and name prefixes: the "first name" of "Mohd Ali" is Ali, of "Dr Siti" is Siti.
_TITLES = frozenset(
    "dr ir mr mrs ms miss mdm madam encik en puan pn cik tuan dato datuk datin tan sri "
    "haji hj hajah hjh prof professor sir ts tn".split()
)
_PREFIXES = frozenset(
    "mohd muhammad mohamad mohammad mohamed muhd md nur nurul siti abdul abd wan nik tengku "
    "tunku raja syed sharifah che".split()
)
# Words a label or title may be followed by that are not someone's name ("Dear Sir/Madam").
_NOT_NAMES = frozenset(
    "sir sirs madam team all customer customers valued colleague colleagues everyone "
    "client clients member members manager management staff tuan puan".split()
)


def _name_ok(value: str) -> bool:
    """A found name is a person's, not a title ("Dear Encik ..." is left to the title rule)
    or a greeting word ("Dear Sir")."""
    words = value.replace("/", " ").split()
    if not words:
        return False
    first = words[0].strip(".'’").lower()
    if first in ("tan", "sri"):  # "Tan Sri" is a title, but Tan is a surname and Sri a name
        second = words[1].strip(".").lower() if len(words) > 1 else ""
        return not (first == "tan" and second == "sri")
    return first not in _TITLES and first not in _NOT_NAMES


# ---------------------------------------------------------------- the detector


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    kind: str
    value: str


def _literal_rx(value: str) -> str:
    tokens = [t for t in re.split(r"[\s,]+", value.strip()) if t]
    return r"[\s,]+".join(re.escape(t) for t in tokens)


def _key(text: str) -> str:
    return re.sub(r"[\s,]+", " ", text).casefold().strip()


class Detector:
    """Finds what to mask in a text: known values (one case-insensitive regex, longest
    first, word-bounded so "Ali" never matches inside "Alibaba"), capitalised first names
    (case-sensitive) and the pattern detectors of the enabled categories."""

    _version = 0

    def __init__(self, literals: list[tuple[str, str]], first_names: list[str], cats: dict):
        Detector._version += 1
        self.version = Detector._version
        self.categories = dict(cats)
        on = {k for k, c in KIND_CATEGORY.items() if cats.get(c)}
        self.patterns = [p for p in PATTERNS if p.kind in on]
        self.kinds: dict[str, str] = {}
        alts: list[str] = []
        for kind, value in sorted(literals, key=lambda kv: -len(kv[1])):
            v = value.strip()
            if kind not in on or len(v) < 3 or (v.isdigit() and len(v) < 6):
                continue
            k = _key(v)
            if k in self.kinds:
                continue
            self.kinds[k] = kind
            alts.append(_literal_rx(v))
        self.literal_rx = (
            re.compile(r"(?<!\w)(?:" + "|".join(alts) + r")(?!\w)", re.I) if alts else None
        )
        names: set[str] = set()
        if "PERSON" in on:
            for n in first_names:
                n = n.strip()
                if len(n) >= 3 and n.isalpha():
                    names.add(n[0].upper() + n[1:].lower())
                    names.add(n.upper())
        self.first_rx = (
            re.compile(
                r"(?<!\w)(?:"
                + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
                + r")(?!\w)"
            )
            if names
            else None
        )
        self._cache: OrderedDict[bytes, list[Span]] = OrderedDict()

    def find(self, text: str) -> list[Span]:
        if not text or len(text) < 3:
            return []
        h = hashlib.blake2b(text.encode("utf-8", "surrogatepass"), digest_size=16).digest()
        hit = self._cache.get(h)
        if hit is not None:
            self._cache.move_to_end(h)
            return hit
        spans = self._find(text)
        self._cache[h] = spans
        if len(self._cache) > 4096:
            self._cache.popitem(last=False)
        return spans

    def _find(self, text: str) -> list[Span]:
        found: list[tuple[int, int, int, str]] = []  # (start, end, priority, kind)
        if self.literal_rx is not None:
            for m in self.literal_rx.finditer(text):
                kind = self.kinds.get(_key(m.group(0)))
                if kind:
                    found.append((m.start(), m.end(), 0, kind))
        if self.first_rx is not None:
            for m in self.first_rx.finditer(text):
                found.append((m.start(), m.end(), 1, "PERSON"))
        for i, p in enumerate(self.patterns, start=2):
            for m in p.rx.finditer(text):
                s, e = m.span(p.group)
                if s < 0:
                    continue
                if p.kind == "COMPANY":
                    s = _skip_lead_words(text, s, e)
                    if s < 0:
                        continue
                    e = s + len(text[s:e].rstrip("."))  # "... Sdn Bhd." ends a sentence
                if p.check is not None and not p.check(text[s:e]):
                    continue
                found.append((s, e, i, p.kind))
        if not found:
            return []
        # Longest wins; on a tie, known values before patterns, then pattern order.
        found.sort(key=lambda f: (f[0] - f[1], f[2], f[0]))
        taken = bytearray(len(text))
        out: list[Span] = []
        for s, e, _, kind in found:
            if taken.find(1, s, e) != -1:
                continue
            taken[s:e] = b"\x01" * (e - s)
            out.append(Span(s, e, kind, text[s:e]))
        out.sort(key=lambda sp: sp.start)
        return out


def _skip_lead_words(text: str, s: int, e: int) -> int:
    """Drop sentence words in front of a company name; -1 when nothing but the suffix is
    left ("The Enterprise" is not a company)."""
    words = list(re.finditer(r"\S+", text[s:e]))
    i = 0
    while i < len(words) - 1 and words[i].group(0).casefold() in _LEAD_WORDS:
        i += 1
    if i >= len(words) - 1:
        return -1
    return s + words[i].start()


# ---------------------------------------------------------------- known values


def _first_names(full: str) -> list[str]:
    tokens = [t for t in re.split(r"[\s,]+", full.strip()) if t]
    out: list[str] = []
    for t in tokens:
        low = t.casefold().strip(".")
        if low in _TITLES:
            continue
        out.append(t)
        if low not in _PREFIXES:
            break
    return out


# Kit fields that are not private (or are settings, not facts).
_KIT_PUBLIC = frozenset(
    (
        "bank_name",
        "website",
        "currency",
        "tax_label",
        "tax_rate",
        "payment_terms",
        "language",
        "accent",
        "footer_note",
        "incorporated_on",
        "signatory_title",
    )
)
_PERSON_KEYS = ("signatory", "director", "contact", "person", "pic", "witness")
_IC_KEY = re.compile(r"(?:^|_)(?:ic|nric|mykad|ic_no|kp|no_kp)(?:$|_)")


async def known_values(
    db: AsyncSession, workspace_id: str
) -> tuple[list[tuple[str, str]], list[str]]:
    """(literals [(kind, value)], first names) for one workspace."""
    literals: list[tuple[str, str]] = []
    firsts: list[str] = []

    def person(name: str) -> None:
        if name and name.strip():
            literals.append(("PERSON", name.strip()))
            firsts.extend(_first_names(name))

    ws = await db.get(Workspace, workspace_id)
    if ws is not None and ws.name:
        literals.append(("OURCO", ws.name))
    for name, email in (
        await db.execute(
            select(User.name, User.email)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == workspace_id)
        )
    ).all():
        person(name or "")
        if email:
            literals.append(("EMAIL", email))
    for (name,) in (
        await db.execute(select(Branch.name).where(Branch.workspace_id == workspace_id))
    ).all():
        if name:
            literals.append(("OURCO", name))
    for (data,) in (
        await db.execute(select(CompanyKit.data).where(CompanyKit.workspace_id == workspace_id))
    ).all():
        for k, v in (data or {}).items():
            if not isinstance(v, str | int) or isinstance(v, bool):
                continue
            v = str(v).strip()
            if not v:
                continue
            key = str(k).lower()
            if key in _KIT_PUBLIC:
                continue
            if key in ("legal_name", "trading_name"):
                literals.append(("OURCO", v))
            elif key in ("reg_no", "tax_no") or "registration" in key:
                literals.append(("REF", v))
            elif key == "address" or key.endswith("_address"):
                literals.append(("ADDRESS", v))
                for line in v.splitlines():
                    line = line.strip().strip(",")
                    if len(line) >= 12:
                        literals.append(("ADDRESS", line))
            elif key == "phone" or key.endswith("_phone"):
                literals.append(("PHONE", v))
            elif key == "email" or key.endswith("_email"):
                literals.append(("EMAIL", v))
            elif key in ("bank_account",) or "account" in key:
                literals.append(("BANKACC", v))
            elif key == "bank_holder":
                company = any(p.kind == "COMPANY" and p.rx.search(v) for p in PATTERNS)
                if company:
                    literals.append(("OURCO", v))
                else:
                    person(v)
            elif key in ("signatory_name", "directors") or (
                key.endswith("_name") and any(w in key for w in _PERSON_KEYS)
            ):
                for line in v.splitlines():
                    person(line)
            elif _IC_KEY.search(key):
                literals.append(("IC", v))
            elif "passport" in key:
                literals.append(("PASSPORT", v))
    # P35: customers, suppliers and their people. A company party is another company
    # (COMPANY), a person party and every contact a person; their ids are references.
    for kind, name, legal, email, phone, tin, reg_no, sst_no in (
        await db.execute(
            select(
                Party.kind,
                Party.name,
                Party.legal_name,
                Party.email,
                Party.phone,
                Party.tin,
                Party.reg_no,
                Party.sst_no,
            ).where(Party.workspace_id == workspace_id)
        )
    ).all():
        for n in (name, legal):
            if not (n or "").strip():
                continue
            if kind == "person":
                person(n)
            else:
                literals.append(("COMPANY", n.strip()))
        if email:
            literals.append(("EMAIL", email))
        if phone:
            literals.append(("PHONE", phone))
        for ref in (tin, reg_no, sst_no):
            if (ref or "").strip():
                literals.append(("REF", ref.strip()))
    for name, email, phone in (
        await db.execute(
            select(PartyContact.name, PartyContact.email, PartyContact.phone).where(
                PartyContact.workspace_id == workspace_id
            )
        )
    ).all():
        person(name or "")
        if email:
            literals.append(("EMAIL", email))
        if phone:
            literals.append(("PHONE", phone))
    return literals, firsts


CACHE_SECONDS = 60.0
_detectors: dict[str, tuple[float, tuple, Detector]] = {}


def invalidate(workspace_id: str | None = None) -> None:
    """Forget the cached dictionary (a branch, member or kit changed)."""
    if workspace_id is None:
        _detectors.clear()
    else:
        _detectors.pop(workspace_id, None)


async def build_detector(db: AsyncSession, workspace_id: str, cats: dict[str, bool]) -> Detector:
    key = tuple(sorted(cats.items()))
    hit = _detectors.get(workspace_id)
    now = time.monotonic()
    if hit is not None and hit[0] > now and hit[1] == key:
        return hit[2]
    literals, firsts = await known_values(db, workspace_id)
    d = Detector(literals, firsts, cats)
    _detectors[workspace_id] = (now + CACHE_SECONDS, key, d)
    return d


async def detector_for(db: AsyncSession, workspace_id: str) -> Detector | None:
    """The workspace's detector, or None when masking is turned off."""
    ws = await db.get(Workspace, workspace_id)
    s = privacy_settings(ws.settings if ws else None)
    if not s["masking"]:
        return None
    return await build_detector(db, workspace_id, s["categories"])


# ---------------------------------------------------------------- masking


@dataclass
class Masker:
    """One request's masking: placeholder -> real value lives here and nowhere else."""

    detector: Detector
    mapping: dict[str, str] = field(default_factory=dict)  # "PERSON_K3QZX" -> real
    counts: Counter = field(default_factory=Counter)  # category -> occurrences
    _by_norm: dict[tuple[str, str], str] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    def placeholder(self, kind: str, value: str) -> str:
        norm = (kind, normalise(kind, value))
        ph = self._by_norm.get(norm)
        if ph is None:
            code = code_for(kind, value)
            n = 5
            ph = f"{kind}_{code[:n]}"
            while ph in self.mapping and n < len(code):  # in-call collision: a longer code
                n += 1
                ph = f"{kind}_{code[:n]}"
            self.mapping[ph] = value
            self._by_norm[norm] = ph
        return ph

    def text(self, text: str) -> str:
        if not text:
            return text
        spans = self.detector.find(text)
        if not spans:
            return text
        out: list[str] = []
        pos = 0
        for sp in spans:
            out.append(text[pos : sp.start])
            out.append(f"[{self.placeholder(sp.kind, sp.value)}]")
            self.counts[KIND_CATEGORY[sp.kind]] += 1
            pos = sp.end
        out.append(text[pos:])
        return "".join(out)

    def json_text(self, raw: str) -> str:
        """Tool-call arguments: mask inside the JSON string values only."""
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return self.text(raw)
        before = self.total
        masked = _walk_strings(data, self.text)
        return json.dumps(masked, ensure_ascii=False) if self.total != before else raw

    def content(self, content: Any) -> Any:
        if isinstance(content, str):
            return self.text(content)
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    part = {**part, "text": self.text(str(part.get("text") or ""))}
                parts.append(part)  # images and audio pass untouched (they cannot be masked)
            return parts
        return content

    def message(self, m: dict[str, Any]) -> dict[str, Any]:
        out = dict(m)
        if "content" in out:
            out["content"] = self.content(out["content"])
        if isinstance(out.get("reasoning_content"), str):
            out["reasoning_content"] = self.text(out["reasoning_content"])
        if out.get("tool_calls"):
            out["tool_calls"] = [self._tool_call(c) for c in out["tool_calls"]]
        return out

    def _tool_call(self, call: Any) -> Any:
        if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
            return call
        fn = call["function"]
        if isinstance(fn.get("arguments"), str):
            return {**call, "function": {**fn, "arguments": self.json_text(fn["arguments"])}}
        return call

    def messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [self.message(m) if isinstance(m, dict) else m for m in messages]


# Told to the model only when something was masked: it keeps placeholders intact (so they
# can be put back) and knows "ours" from "theirs" without seeing any real value.
LEGEND = (
    "Private values in this conversation are replaced by placeholders such as [PERSON_AB12C]. "
    "Whenever you mean that value, copy its placeholder exactly as written, in your reply and "
    "in tool arguments; the system puts the real value back. [OURCO_...] is one of our own "
    "companies, [COMPANY_...] is another company, [PERSON_...] is one of our people."
)


def with_legend(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add LEGEND to the first system message (or as one), so no provider sees two."""
    out = list(messages)
    if out and out[0].get("role") == "system" and isinstance(out[0].get("content"), str):
        out[0] = {**out[0], "content": out[0]["content"] + "\n\n" + LEGEND}
    else:
        out.insert(0, {"role": "system", "content": LEGEND})
    return out


def mask_messages(
    messages: list[dict[str, Any]], detector: Detector
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, int]]:
    """(masked messages, placeholder -> real, occurrences per category). Tool schemas are
    never part of `messages`, so they are never masked."""
    m = Masker(detector)
    masked = m.messages(messages)
    return masked, m.mapping, dict(m.counts)


def _walk_strings(data: Any, fn: Any) -> Any:
    if isinstance(data, str):
        return fn(data)
    if isinstance(data, list):
        return [_walk_strings(x, fn) for x in data]
    if isinstance(data, dict):
        return {k: _walk_strings(v, fn) for k, v in data.items()}
    return data


# ---------------------------------------------------------------- unmasking

_PLACEHOLDER = re.compile(
    r"\[?\b(" + "|".join(KINDS) + r")_([A-Z2-7]{5,52})\b\]?",
    re.I,
)


def _real(mapping: dict[str, str], kind: str, code: str) -> tuple[str, str] | None:
    """(real value, leftover letters) for a placeholder; the model may glue letters on
    ("[PERSON_K3QZX]s" without the apostrophe), so shorter prefixes are tried too."""
    kind, code = kind.upper(), code.upper()
    for n in range(len(code), 4, -1):
        real = mapping.get(f"{kind}_{code[:n]}")
        if real is not None:
            return real, code[n:]
    return None


def unmask(text: str, mapping: dict[str, str]) -> str:
    """Real values back in place of placeholders: any case, with or without the brackets.
    Unknown placeholders are left as they are."""
    if not text or not mapping or "_" not in text:
        return text

    def put(m: re.Match[str]) -> str:
        hit = _real(mapping, m.group(1), m.group(2))
        if hit is None:
            return m.group(0)
        real, rest = hit
        if rest:
            # Keep the model's own letters, in the case it wrote them.
            rest = m.group(2)[len(m.group(2)) - len(rest) :]
        tail = "]" if m.group(0).endswith("]") and not m.group(0).startswith("[") else ""
        return real + rest + tail

    return _PLACEHOLDER.sub(put, text)


def unmask_json(raw: str, mapping: dict[str, str]) -> str:
    """Tool-call arguments: real values go inside the JSON strings (escaped properly)."""
    if not raw or not mapping or "_" not in raw:
        return raw
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        escaped = {k: json.dumps(v, ensure_ascii=False)[1:-1] for k, v in mapping.items()}
        return unmask(raw, escaped)
    restored = _walk_strings(data, lambda s: unmask(s, mapping))
    return raw if restored == data else json.dumps(restored, ensure_ascii=False)


def unmask_tool_calls(calls: list[Any], mapping: dict[str, str]) -> list[Any]:
    out = []
    for c in calls or []:
        if isinstance(c, dict) and isinstance(c.get("function"), dict):
            fn = c["function"]
            if isinstance(fn.get("arguments"), str):
                c = {**c, "function": {**fn, "arguments": unmask_json(fn["arguments"], mapping)}}
        out.append(c)
    return out


def unmask_json_reply(text: str, mapping: dict[str, str]) -> str:
    """A reply asked for as JSON: real values go in as JSON (an address's line break or a
    name's quote must not break the document), also when the JSON sits inside a fence."""
    if not text or not mapping or "_" not in text:
        return text
    try:
        json.loads(text)
        return unmask_json(text, mapping)
    except (TypeError, ValueError):
        pass
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        inner = text[start : end + 1]
        try:
            json.loads(inner)
            return text[:start] + unmask_json(inner, mapping) + text[end + 1 :]
        except (TypeError, ValueError):
            pass
    escaped = {k: json.dumps(v, ensure_ascii=False)[1:-1] for k, v in mapping.items()}
    return unmask(text, escaped)


def unmask_result(r: Any, mapping: dict[str, str], *, json_mode: bool = False) -> Any:
    """A client.ChatResult with the real values restored in its content, reasoning and
    tool-call arguments (before any tool runs)."""
    if not mapping:
        return r
    if r.content:
        r.content = (unmask_json_reply if json_mode else unmask)(r.content, mapping)
    if getattr(r, "reasoning_content", ""):
        r.reasoning_content = unmask(r.reasoning_content, mapping)
    if r.tool_calls:
        r.tool_calls = unmask_tool_calls(r.tool_calls, mapping)
    return r


# ---------------------------------------------------------------- preview (the settings page)


async def preview(db: AsyncSession, workspace_id: str, text: str) -> tuple[str, dict[str, int]]:
    """What a cloud provider would see of `text` with the current categories (shown even
    while masking is turned off, so it can be checked before turning it on)."""
    ws = await db.get(Workspace, workspace_id)
    s = privacy_settings(ws.settings if ws else None)
    m = Masker(await build_detector(db, workspace_id, s["categories"]))
    masked = m.text(text)
    counts = {c: int(m.counts.get(c, 0)) for c in CATEGORIES}
    return masked, counts
