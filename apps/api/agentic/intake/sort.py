"""Sort a company document by kind and department (P24).

Rules first: the file name, its folders and the words on its first page ("SOP",
"TATACARA", "PANDUAN", "SENARAI SEMAK", "CARTA ALIR", "BORANG", "SIJIL", "KONTRAK",
"SURAT", and the English equivalents). When the rules are not sure, the cheap model's
reading of the file decides: the same `file.understand` call that writes its summary is asked
for a category and a department too (see HINT), so sorting costs no extra model call.

Kinds are fixed (KINDS) so lists, the tree and agents all use the same words; `DocFile.kind`
holds them for every file that came through intake.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass

KINDS = (
    "sop",
    "guide",
    "checklist",
    "flowchart",
    "form",
    "template",
    "policy",
    "contract",
    "certificate",
    "letter",
    "report",
    "financial",
    "other",
)
# How-to material: goes into the knowledge library so agents can search and cite it.
HOW_TO = frozenset({"sop", "guide", "checklist", "flowchart", "policy", "template", "form"})

# kind -> words (lower case; matched as whole words, spaces flexible). Malay and English.
_WORDS: dict[str, tuple[str, ...]] = {
    "flowchart": (
        "carta alir",
        "flowchart",
        "flow chart",
        "process flow",
        "aliran proses",
        "aliran kerja",
        "workflow",
        "proses kerja",
    ),
    "sop": (
        "sop",
        "sops",
        "standard operating procedure",
        "tatacara",
        "prosedur",
        "procedure",
        "procedures",
        "prosedur operasi standard",
        "arahan kerja",
        "work instruction",
    ),
    "checklist": (
        "checklist",
        "check list",
        "senarai semak",
        "senarai tugas",
        "senarai tugasan",
        "task list",
        "semakan",
    ),
    "guide": (
        "panduan",
        "guide",
        "guidelines",
        "guideline",
        "manual",
        "handbook",
        "buku panduan",
        "garis panduan",
        "tutorial",
        "langkah demi langkah",
        "step by step",
        "how to",
        "cara",
        "user guide",
        "modul",
        "module",
        "latihan",
        "training",
    ),
    "form": ("borang", "form", "forms", "permohonan", "application form", "pendaftaran"),
    "template": (
        "template",
        "templat",
        "contoh",
        "sample",
        "format",
        "draf",
        "draft",
        "specimen",
        "spesimen",
    ),
    "policy": (
        "polisi",
        "dasar",
        "policy",
        "policies",
        "peraturan",
        "rules",
        "kod etika",
        "code of conduct",
        "terma rujukan",
        "terms of reference",
        "pekeliling",
        "piagam",
        "charter",
    ),
    "contract": (
        "kontrak",
        "contract",
        "perjanjian",
        "agreement",
        "surat setuju terima",
        "letter of award",
        "lantikan",
        "tender award",
        "mou",
        "memorandum",
    ),
    "certificate": (
        "sijil",
        "certificate",
        "cert",
        "lesen",
        "license",
        "licence",
        "permit",
        "ssm",
        "cidb",
        "akuan pendaftaran",
        "registration certificate",
        "pengiktirafan",
        "accreditation",
        "iso",
    ),
    "letter": (
        "surat",
        "letter",
        "memo",
        "notis",
        "notice",
        "makluman",
        "warning letter",
        "surat amaran",
        "surat tunjuk sebab",
    ),
    "report": (
        "laporan",
        "report",
        "reports",
        "minit",
        "minutes",
        "audit",
        "statistik",
        "statistics",
        "analisis",
        "analysis",
        "kajian",
    ),
    "financial": (
        "invois",
        "invoice",
        "resit",
        "receipt",
        "penyata",
        "statement",
        "akaun",
        "accounts",
        "kewangan",
        "financial",
        "finance",
        "quotation",
        "sebut harga",
        "bajet",
        "budget",
        "gaji",
        "payroll",
        "cukai",
        "tax",
        "baucar",
        "voucher",
        "bayaran",
        "payment",
        "harga",
        "price",
    ),
}

# Department words: a department whose name contains a key (or a synonym of it) gets the
# matching words. Unknown department names still match on their own words.
_DEPT_WORDS: dict[str, tuple[str, ...]] = {
    "operations": (
        "operasi",
        "operation",
        "operations",
        "kawalan",
        "keselamatan",
        "pengawal",
        "guard",
        "guards",
        "security",
        "rondaan",
        "patrol",
        "tapak",
        "site",
        "syif",
        "shift",
        "lapangan",
        "field",
        "logistik",
        "logistics",
    ),
    "finance": (
        "kewangan",
        "finance",
        "akaun",
        "accounts",
        "accounting",
        "invois",
        "invoice",
        "bayaran",
        "payment",
        "gaji",
        "payroll",
        "cukai",
        "tax",
        "resit",
        "receipt",
        "penyata",
        "statement",
        "bajet",
        "budget",
        "claim",
        "tuntutan",
    ),
    "hr": (
        "sumber manusia",
        "human resource",
        "human resources",
        "hr",
        "kakitangan",
        "pekerja",
        "staff",
        "employee",
        "cuti",
        "leave",
        "disiplin",
        "discipline",
        "surat amaran",
        "warning letter",
        "pengambilan",
        "recruitment",
        "temuduga",
        "interview",
        "kebajikan",
        "welfare",
    ),
    "sales": (
        "tender",
        "tenders",
        "sebut harga",
        "quotation",
        "jualan",
        "sales",
        "pemasaran",
        "marketing",
        "perolehan",
        "procurement",
        "bida",
        "bid",
        "pelanggan",
        "customer",
        "client",
        "eperolehan",
        "proposal",
        "cadangan",
    ),
    "management": (
        "pengurusan",
        "management",
        "lembaga",
        "board",
        "pengarah",
        "director",
        "strategi",
        "strategy",
        "polisi",
        "policy",
        "dasar",
    ),
    "admin": (
        "pentadbiran",
        "admin",
        "administration",
        "sijil",
        "certificate",
        "lesen",
        "license",
        "pendaftaran",
        "registration",
        "ssm",
        "fail",
        "filing",
    ),
    "it": (
        "teknologi maklumat",
        "ict",
        "sistem",
        "system",
        "komputer",
        "computer",
        "rangkaian",
        "network",
        "perisian",
        "software",
    ),
    "training": ("latihan", "training", "kursus", "course", "modul", "module"),
    "quality": ("kualiti", "quality", "iso", "audit", "pematuhan", "compliance"),
    "research": ("penyelidikan", "research", "kajian", "study"),
}
_DEPT_ALIASES: dict[str, tuple[str, ...]] = {
    "operations": ("operation", "operasi", "ops"),
    "finance": ("finance", "kewangan", "account", "akaun"),
    "hr": ("human", "hr", "sumber manusia", "people", "personnel", "kakitangan"),
    "sales": (
        "sales",
        "jualan",
        "marketing",
        "business development",
        "tender",
        "procurement",
        "perolehan",
        "pemasaran",
    ),
    "management": ("management", "pengurusan"),
    "admin": ("admin", "pentadbiran"),
    "it": ("it", "ict", "teknologi", "technology"),
    "training": ("training", "latihan"),
    "quality": ("quality", "kualiti", "qa"),
    "research": ("research", "penyelidikan"),
}

HINT = (
    ' Also add two keys: "category", exactly one of: sop (a step-by-step procedure), guide '
    "(handbook, manual, how-to), checklist, flowchart, form (to be filled in), template "
    "(sample or blank to copy), policy (rules), contract, certificate (or licence), letter, "
    'report, financial, other; and "department", the one department from this list the '
    'document belongs to, written exactly as listed, or "" if none fits: {departments}.'
)

CONFIDENT = 3  # rule score needed to skip the model's opinion
_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff")


def _rx(words: Iterable[str]) -> re.Pattern[str]:
    alts = sorted({re.escape(w).replace(r"\ ", r"\s+") for w in words}, key=len, reverse=True)
    return re.compile(r"(?<![^\W_])(?:" + "|".join(alts) + r")(?![^\W_])", re.I)


_KIND_RX = {k: _rx(v) for k, v in _WORDS.items()}
_DEPT_RX = {k: _rx(v) for k, v in _DEPT_WORDS.items()}


def _words(text: str) -> str:
    """File names and folders: "SOP_Kawalan-Pintu.pdf" -> "SOP Kawalan Pintu pdf"."""
    return re.sub(r"[_\-.+()\[\]]+", " ", text)


def first_page(text: str, limit: int = 1500) -> str:
    """The words on page 1 (the title is where the kind is written)."""
    m = re.search(r"\[page 2\]", text)
    head = text[: m.start()] if m else text
    return head[:limit]


@dataclass
class Sorted:
    kind: str
    score: int  # rule score of the winner (0 = rules found nothing)
    confident: bool
    via: str  # rules | model | fallback


def rule_scores(name: str, folder: str, head: str) -> dict[str, int]:
    """Points per kind: the file name counts most, then its nearest folder, then page 1."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", name)
    parts = [p for p in folder.split("/") if p]
    near, far = (parts[-1] if parts else ""), " ".join(parts[:-1])
    title = head[:300]
    scores: dict[str, int] = {}
    for kind, rx in _KIND_RX.items():
        n = 0
        if rx.search(_words(stem)):
            n += 4
        if near and rx.search(_words(near)):
            n += 3
        if far and rx.search(_words(far)):
            n += 1
        if title and rx.search(title):
            n += 2
        elif head and len(rx.findall(head)) >= 2:
            n += 1
        if n:
            scores[kind] = n
    if name.lower().endswith(_IMAGE_EXT) and any(
        k in scores for k in ("flowchart", "sop", "guide", "checklist")
    ):
        # A picture of a procedure ("TATACARA ... .png" in a "CARTA ALIR" folder) is a chart:
        # it wins over the procedure words, so the rules decide instead of the model.
        scores["flowchart"] = max(scores.values()) + 2
    return scores


def model_kind(category: str, free_kind: str = "") -> str | None:
    """The model's category, or its free-form kind ("SSM certificate") mapped to KINDS."""
    c = (category or "").strip().lower()
    if c in KINDS:
        return c
    for text in (c, (free_kind or "").lower()):
        if not text:
            continue
        best = max(
            ((k, len(rx.findall(text))) for k, rx in _KIND_RX.items()),
            key=lambda kv: kv[1],
        )
        if best[1]:
            return best[0]
    return None


def kind_of(name: str, folder: str, text: str, category: str = "", free_kind: str = "") -> Sorted:
    scores = rule_scores(name, folder, first_page(text))
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], KINDS.index(kv[0])))
    top, score = ranked[0] if ranked else ("other", 0)
    second = ranked[1][1] if len(ranked) > 1 else 0
    confident = score >= CONFIDENT and score - second >= 2
    if confident:
        return Sorted(top, score, True, "rules")
    guess = model_kind(category, free_kind)
    if guess and guess != "other":
        return Sorted(guess, score, False, "model")
    if score:
        return Sorted(top, score, False, "rules")
    return Sorted(guess or "other", 0, False, "fallback")


# ---------------------------------------------------------------- departments


@dataclass(frozen=True)
class Dept:
    id: str
    name: str


def _dept_rx(d: Dept) -> re.Pattern[str]:
    low = d.name.lower()
    words = set(re.findall(r"[^\W\d_]{3,}", low)) - {"and", "dan", "the"}
    for key, aliases in _DEPT_ALIASES.items():
        # Aliases match the start of a word ("operation" in "Operations"); two-letter ones
        # ("hr", "it") only a whole word.
        tail = r"(?![^\W_])"
        if any(
            re.search(r"(?<![^\W_])" + re.escape(a) + (tail if len(a) <= 3 else ""), low)
            for a in aliases
        ):
            words |= set(_DEPT_WORDS[key])
    return _rx(words or {low})


def department_of(
    depts: list[Dept], name: str, folder: str, text: str, suggested: str = ""
) -> str | None:
    """The department id that fits best: folder and name words first, then page 1, then
    the model's suggestion (a department name from the list). None when nothing fits."""
    if not depts:
        return None
    head = first_page(text, 2500)
    best: tuple[int, int, str] | None = None
    for i, d in enumerate(depts):
        rx = _dept_rx(d)
        # The department's own name words ("Tender" in "Tender & Procurement") break a tie
        # with a department that only shares the topic ("Sales & Marketing" also takes tenders).
        own_words = set(re.findall(r"[^\W\d_]{4,}", d.name.lower())) - {"and", "dan", "the"}
        own = _rx(own_words) if own_words else None
        n = 0
        parts = [p for p in folder.split("/") if p]
        for depth, p in enumerate(reversed(parts)):
            if rx.search(_words(p)):
                n += 3 if depth == 0 else 2
            if own and own.search(_words(p)):
                n += 2
        if rx.search(_words(name)):
            n += 3
        if own and own.search(_words(name)):
            n += 2
        n += min(3, len(rx.findall(head)))
        if n and (best is None or n > best[0]):
            best = (n, -i, d.id)
    if best and best[0] >= 2:
        return best[2]
    s = (suggested or "").strip().lower()
    if s:
        for d in depts:
            if d.name.lower() == s:
                return d.id
        for d in depts:
            if s in d.name.lower() or d.name.lower() in s:
                return d.id
    return best[2] if best else None


def hint(depts: list[Dept]) -> str:
    names = ", ".join(f'"{d.name}"' for d in depts) or "(none)"
    return HINT.format(departments=names)
