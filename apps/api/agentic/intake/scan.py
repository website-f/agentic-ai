"""Find secrets and personal data in a document's text (P24).

Company documents carry things agents must never see: a tender guide with the government
portal's login ID, password, security-question answer and digital-certificate PIN printed in
it, or an SOP whose sample warning letters hold staff IC numbers. This scanner reports WHAT
it found (kinds, counts, pages), never the values: nothing it returns may hold a secret.

Rules (English and Malay):
- credentials: a password / kata laluan, login ID / ID log masuk / nama pengguna, PIN, TAC or
  OTP, a security-question answer / jawapan soalan keselamatan, API keys and tokens, private
  keys. A label alone is not enough: a value must follow that looks like one (a blank form's
  "Password: ________" or a policy's "Password must be 8 characters" is not a secret).
  Any credential quarantines the file.
- personal IDs: Malaysian IC numbers (YYMMDD-PB-####, with a real date and birthplace code),
  passport numbers next to a passport label, bank account numbers next to bank words.
  Three or more IC numbers in one file (staff records) quarantine it; fewer only flag it.

`mask` hides the values themselves, for text that leaves the scanner (the model that reads
and summarises a file sees "[hidden]").

Same spirit as core/threats.py: compiled patterns, bounded gaps, no backtracking blow-ups.
"""

import bisect
import calendar
import re
from dataclasses import dataclass, field
from typing import Any

HIDDEN = "[hidden]"
IC_QUARANTINE = 3

LABELS = {
    "password": "password",
    "login_id": "login ID",
    "pin": "PIN",
    "otp": "one-time code",
    "security_answer": "security-question answer",
    "api_key": "API key or token",
    "private_key": "private key",
}
PERSONAL_LABELS = {
    "ic": ("IC number", "IC numbers"),
    "passport": ("passport number", "passport numbers"),
    "bank_account": ("bank account number", "bank account numbers"),
}

# What may sit between a label and its value: "Kata Laluan (Password) : X", "| Password | X".
_PAREN = r"(?:[ \t]*\([^)\n]{0,30}\))?"
_SEP = re.compile(
    r"^" + _PAREN + r"(?P<sep>[ \t]*(?:[:=：|]|[-–](?=[ \t])|\b(?:is|ialah|adalah)\b)[ \t]*"
    r"(?:\n[ \t]*)?|[ \t]+)(?P<val>[^\s|]+)",
    re.I,
)
_PAGE = re.compile(r"\[page (\d+)\]")

_PASSWORD = re.compile(
    r"\b(?:password|passwd|pass\s?word|pwd|kata\s*laluan|kod\s+laluan|katalaluan)\b", re.I
)
_LOGIN = re.compile(
    r"\b(?:id\s+log\s*masuk|log\s*masuk\s+id|id\s+pengguna|nama\s+pengguna|user\s*-?\s*(?:name|id)"
    r"|log\s*-?\s*in\s*(?:id|name)|id\s+login|userid|username)\b",
    re.I,
)
_LOGIN_LOOSE = re.compile(r"\b(?:login|log\s+masuk)\b", re.I)
_PIN = re.compile(
    r"\bPIN\b|(?i:\b(?:kod|nombor|no\.?)\s+pin\b|\bpin\s+(?:number|code|no\.?|sijil|digital|"
    r"token|kad)\b|\bpin(?=\s*[:=]))"
)
_OTP = re.compile(
    r"\b(?:TAC|OTP)\b|(?i:\bkod\s+pengesahan\b|\bone[-\s]time\s+(?:password|pin|code)\b"
    r"|\bverification\s+code\b)"
)
_DIGITS_AFTER = re.compile(r"^[^\d\n]{0,40}(?:\n[^\d\n]{0,12})?(?<!\d)(\d{4,8})(?!\d)(?![/.,-]\d)")
_QUESTION = re.compile(
    r"\b(?:soalan\s+keselamatan|security\s+question|soalan\s+rahsia|secret\s+question)\b", re.I
)
_ANSWER_NEAR = re.compile(r"\b(?:jawapan|answer|jwpn)\b", re.I)
_ANSWER = re.compile(
    r"\b(?:jawapan\s+(?:keselamatan|rahsia)|security\s+answer|secret\s+answer)\b", re.I
)
_KEY_LABEL = re.compile(
    r"\b(?:api[\s_-]?key|secret[\s_-]?key|access[\s_-]?key(?:[\s_-]?id)?|client[\s_-]?secret"
    r"|access[\s_-]?token|auth(?:orization)?[\s_-]?token|bearer)\b",
    re.I,
)
_RAW_TOKENS = re.compile(
    r"\b(?:sk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{16,}"
    r"|\bgh[pousr]_[A-Za-z0-9]{30,}"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\bxox[abprs]-[A-Za-z0-9-]{10,}"
    r"|\bAIza[0-9A-Za-z_-]{35}"
    r"|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
)
_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----")

_IC = re.compile(r"(?<![\d-])(\d{6})-(\d{2})-(\d{4})(?![\d-])")
_IC_LABEL = re.compile(
    r"\b(?:no\.?\s*)?(?:k/p|kp|ic|i/c|nric|mykad|kad\s+pengenalan)\b[^\d\n]{0,25}"
    r"(?<![\d-])(\d{6})[ -]?(\d{2})[ -]?(\d{4})(?![\d-])",
    re.I,
)
_PASSPORT = re.compile(
    r"\b(?:passport|pasport)(?:\s*(?:no\.?|number|nombor))?\b[^\n]{0,20}?\b([A-Z]{1,2}\d{6,9})\b",
    re.I,
)
_BANK = re.compile(
    r"\b(?:bank|akaun|account|a/c|acc\.?\s*no|maybank|cimb|rhb|public\s*bank|hong\s*leong"
    r"|ambank|bsn|affin|alliance|agrobank|muamalat|ocbc|hsbc|uob|standard\s+chartered"
    r"|al\s*rajhi|kfh)\b",
    re.I,
)
_ACCOUNT_NO = re.compile(r"(?<![\d-])(\d(?:[ -]?\d){9,15})(?![\d-])")
_PHONE_SHAPE = re.compile(r"0\d{1,2}-")
_CELL_END = re.compile(r"[\n|]")
_PHONE_WORDS = re.compile(r"\b(?:tel|telefon|phone|fon|faks|fax|h/p|hp|mobile|no\.?\s*tel)\b", re.I)

# Words that follow a credential label in ordinary prose and forms, not secrets.
_STOP = frozenset(
    """must should will can is are the your you a an anda yang akan hendaklah mestilah mesti
    perlu baru baharu lama sementara dan atau and or not tidak untuk for to of di ke pada with
    dengan reset change tukar forgot lupa policy polisi dasar field required wajib sendiri
    pengguna user email e-mel emel nombor number no seperti contoh example berikut following
    below here hidden redacted n/a na tiada none nil nill kosong blank masukkan enter type
    taip isi fill akaun account login log masuk portal sistem system id nama name kata laluan
    password pin rahsia secret minimum maximum length panjang characters aksara huruf digit
    digits angka masa time tamat expired expiry diberi given dihantar sent melalui via oleh
    by daripada from mengikut according format""".split()
)
_UNITS = re.compile(
    r"^[ \t]*(?:characters?|chars?|aksara|digits?|huruf|angka|minimum|min|kali|times|hari"
    r"|days?|bulan|months?)\b",
    re.I,
)
_PLACEHOLDER = re.compile(r"[_.\-*xX•#…?~=]+|\[.*\]|<.*>|\(.*\)|\{.*\}")
_VALID_PB = frozenset(
    list(range(1, 17))
    + list(range(21, 60))
    + list(range(60, 69))
    + [71, 72]
    + list(range(74, 80))
    + [82]
    + list(range(83, 94))
    + [98, 99]
)


@dataclass
class Findings:
    credentials: dict[str, set[int]] = field(default_factory=dict)  # kind -> pages
    personal: dict[str, set[str]] = field(default_factory=dict)  # kind -> distinct values
    personal_pages: set[int] = field(default_factory=set)
    spans: list[tuple[int, int]] = field(default_factory=list)  # values to hide (in memory only)

    @property
    def ic_count(self) -> int:
        return len(self.personal.get("ic", ()))

    @property
    def personal_ids(self) -> int:
        return sum(len(v) for v in self.personal.values())

    @property
    def any(self) -> bool:
        return bool(self.credentials or self.personal_ids)

    @property
    def quarantine(self) -> bool:
        return bool(self.credentials) or self.ic_count >= IC_QUARANTINE

    def record(self) -> dict[str, Any]:
        """What is stored on the file: kinds, counts and pages. Never a value."""
        if not self.any:
            return {}
        out: dict[str, Any] = {}
        if self.credentials:
            out["credentials"] = sorted(self.credentials)
            out["credential_pages"] = sorted(
                {p for ps in self.credentials.values() for p in ps} - {0}
            )
        if self.personal_ids:
            out["personal_ids"] = self.personal_ids
            out["personal_kinds"] = {k: len(v) for k, v in sorted(self.personal.items()) if v}
            out["personal_pages"] = sorted(self.personal_pages - {0})
        return out


# Kept across re-reads: who reviewed the file, and whether they released or held it.
REVIEW_KEYS = ("reviewed_by", "reviewed_at", "review_reason", "released", "held_by", "held_at")


def apply(f: Any, found: Findings) -> None:
    """Record a scan on a file (a DocFile). Quarantines it when the findings say so, unless
    a person already released it; never lifts a quarantine (only a person does that)."""
    prev = dict(f.sensitive or {})
    rec = found.record()
    rec.update({k: prev[k] for k in REVIEW_KEYS if k in prev})
    f.sensitive = rec
    if found.quarantine and not prev.get("released"):
        f.quarantined = True


def reasons(record: dict[str, Any]) -> list[str]:
    out = []
    if record.get("credentials"):
        out.append("credentials")
    if record.get("personal_ids"):
        out.append("personal_ids")
    return out


def _pages(pages: list[int]) -> str:
    pages = [p for p in pages if p]
    if not pages:
        return ""
    shown = ", ".join(str(p) for p in pages[:6]) + (", …" if len(pages) > 6 else "")
    return f" ({'page' if len(pages) == 1 else 'pages'} {shown})"


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def describe(record: dict[str, Any]) -> str:
    """A short sentence for people: what kinds were found, and where. No values."""
    parts = []
    creds = [LABELS.get(str(k), str(k)) for k in record.get("credentials") or []]
    if creds:
        text = _join(creds)
        parts.append(text[0].upper() + text[1:] + _pages(record.get("credential_pages") or []))
    kinds = record.get("personal_kinds") or {}
    if kinds:
        bits = []
        for k, n in kinds.items():
            one, many = PERSONAL_LABELS.get(k, (k, k))
            bits.append(f"{n} {one if n == 1 else many}")
        parts.append(_join(bits) + _pages(record.get("personal_pages") or []))
    return ". ".join(parts)[:300]


# ---------------------------------------------------------------- matching


def _page_finder(text: str):
    marks = [(m.start(), int(m.group(1))) for m in _PAGE.finditer(text)]
    starts = [s for s, _ in marks]

    def page_at(pos: int) -> int:
        i = bisect.bisect_right(starts, pos) - 1
        return marks[i][1] if i >= 0 else 0

    return page_at


def _line_end(text: str, start: int) -> int:
    """Where a multi-word value (a security answer) ends: the line or table cell."""
    m = _CELL_END.search(text, start)
    return min(m.start() if m else len(text), start + 120)


def _clean(value: str) -> str:
    return value.strip("\"'“”‘’`,;.)]}")


def _placeholder(v: str) -> bool:
    """A blank to fill in: "_____", "xxxx", "[isi sendiri]", "<password>", "(optional)"."""
    return bool(_PLACEHOLDER.fullmatch(v)) or len(set(v.lower())) == 1 or v[0] in "[<({"


def _value_after(text: str, end: int) -> tuple[str, int, int, bool] | None:
    """(value, start, end, explicit separator) right after a label, or None."""
    m = _SEP.match(text[end : end + 120])
    if not m:
        return None
    raw = m.group("val")
    value = _clean(raw)
    if not value:
        return None
    lead = raw.find(value)
    start = end + m.start("val") + max(lead, 0)
    explicit = bool(m.group("sep").strip())
    after = text[start + len(value) : start + len(value) + 40]
    if _UNITS.match(after):  # "Password: 8 characters", "PIN: 6 digits"
        return None
    return value, start, start + len(value), explicit


def _has(v: str, pattern: str) -> bool:
    return re.search(pattern, v) is not None


def _secretish(v: str, explicit: bool, paired: bool = False) -> bool:
    """Does this look like a password rather than the next word of a sentence?"""
    if len(v) < 4 or _placeholder(v) or v.lower() in _STOP or v == HIDDEN:
        return False
    digit, alpha = _has(v, r"\d"), _has(v, r"[^\W\d_]")
    symbol = _has(v[1:-1], r"[^\w]") or "_" in v
    inner_case = _has(v[1:], r"[A-Z]") and _has(v, r"[a-z]")
    if explicit and (digit or symbol or inner_case or paired):
        return True
    return len(v) >= 6 and digit and alpha


def _login_value(v: str, explicit: bool, loose: bool) -> bool:
    if len(v) < 3 or _placeholder(v) or v.lower() in _STOP or v == HIDDEN or not explicit:
        return False
    if loose:  # plain "Login:" needs an ID-looking value ("Login: click the button" is not)
        return _has(v, r"[\d@_.]")
    return True


def _valid_ic(ymd: str, pb: str) -> bool:
    mm, dd, code = int(ymd[2:4]), int(ymd[4:6]), int(pb)
    if not 1 <= mm <= 12 or code not in _VALID_PB:
        return False
    return 1 <= dd <= calendar.monthrange(2000, mm)[1]  # 2000 is a leap year: 29 Feb is valid


def scan(text: str) -> Findings:
    found = Findings()
    if not text:
        return found
    page_at = _page_finder(text)

    def cred(kind: str, pos: int, span: tuple[int, int] | None = None) -> None:
        found.credentials.setdefault(kind, set()).add(page_at(pos))
        if span:
            found.spans.append(span)

    logins = [m.start() for m in _LOGIN.finditer(text)]

    def near_login(pos: int) -> bool:
        i = bisect.bisect_left(logins, pos - 300)
        return i < len(logins) and logins[i] <= pos + 300

    for m in _PASSWORD.finditer(text):
        got = _value_after(text, m.end())
        if got and _secretish(got[0], got[3], paired=near_login(m.start())):
            cred("password", m.start(), (got[1], got[2]))
    for rx, loose in ((_LOGIN, False), (_LOGIN_LOOSE, True)):
        for m in rx.finditer(text):
            got = _value_after(text, m.end())
            if got and _login_value(got[0], got[3], loose):
                cred("login_id", m.start(), (got[1], got[2]))
    for rx, kind in ((_PIN, "pin"), (_OTP, "otp")):
        for m in rx.finditer(text):
            d = _DIGITS_AFTER.match(text[m.end() : m.end() + 80])
            if d:
                s = m.end() + d.start(1)
                cred(kind, m.start(), (s, s + len(d.group(1))))
    for m in _QUESTION.finditer(text):
        window = text[m.end() : m.end() + 250]
        a = _ANSWER_NEAR.search(window)
        if a:
            got = _value_after(text, m.end() + a.end())
            if got and got[3] and len(got[0]) >= 2 and not _placeholder(got[0]):
                cred("security_answer", m.start(), (got[1], _line_end(text, got[1])))
    for m in _ANSWER.finditer(text):
        got = _value_after(text, m.end())
        if got and got[3] and len(got[0]) >= 2 and not _placeholder(got[0]):
            cred("security_answer", m.start(), (got[1], _line_end(text, got[1])))
    for m in _KEY_LABEL.finditer(text):
        got = _value_after(text, m.end())
        if (
            got
            and len(got[0]) >= 16
            and _has(got[0], r"\d")
            and _has(got[0], r"[A-Za-z]")
            and re.fullmatch(r"[A-Za-z0-9_\-./+=]+", got[0])
        ):
            cred("api_key", m.start(), (got[1], got[2]))
    for m in _RAW_TOKENS.finditer(text):
        cred("api_key", m.start(), (m.start(), m.end()))
    for m in _PRIVATE_KEY.finditer(text):
        end = text.find("-----END", m.end())
        cred("private_key", m.start(), (m.start(), end if end != -1 else m.end()))

    def personal(kind: str, value: str, pos: int, span: tuple[int, int]) -> None:
        found.personal.setdefault(kind, set()).add(value)
        found.personal_pages.add(page_at(pos))
        found.spans.append(span)

    ics: set[tuple[int, int]] = set()
    for m in _IC.finditer(text):
        if _valid_ic(m.group(1), m.group(2)):
            personal("ic", m.group(1) + m.group(2) + m.group(3), m.start(), (m.start(), m.end()))
            ics.add((m.start(), m.end()))
    for m in _IC_LABEL.finditer(text):
        if _valid_ic(m.group(1), m.group(2)):
            s, e = m.start(1), m.end(3)
            personal("ic", m.group(1) + m.group(2) + m.group(3), s, (s, e))
            ics.add((s, e))
    for m in _PASSPORT.finditer(text):
        personal("passport", m.group(1).upper(), m.start(1), (m.start(1), m.end(1)))
    for m in _BANK.finditer(text):
        window = text[m.end() : m.end() + 60]
        n = _ACCOUNT_NO.search(window)
        if not n:
            continue
        s, e = m.end() + n.start(1), m.end() + n.end(1)
        digits = re.sub(r"\D", "", n.group(1))
        before = text[max(0, m.start() - 20) : m.end()] + window[: n.start(1)]
        if not 10 <= len(digits) <= 16 or _PHONE_WORDS.search(before):
            continue
        if _PHONE_SHAPE.match(n.group(1)):  # 03-2070 8833, 012-345 6789
            continue
        if any(a <= s < b for a, b in ics):
            continue
        personal("bank_account", digits, s, (s, e))
    return found


def mask(text: str, found: Findings | None = None) -> str:
    """The text with every value the scan found replaced by [hidden]."""
    found = found if found is not None else scan(text)
    if not found.spans:
        return text
    out, last = [], 0
    for s, e in sorted(found.spans):
        if e <= last:
            continue
        s = max(s, last)
        out.append(text[last:s])
        out.append(HIDDEN)
        last = e
    out.append(text[last:])
    return "".join(out)
