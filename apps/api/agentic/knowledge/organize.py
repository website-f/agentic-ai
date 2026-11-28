"""P149c: organizing the Library's files: keywords, folders proposed from what a file is and
its date, and the plans an AI shows before it moves anything.

The owner (28 Nov 2026): "In the Library users find it hard to group and organize uploaded
files; when I ask the AI to organize them it doesn't know how ... when they upload files in the
Library, e.g. in Unit HR, files are auto-grouped based on the content and the PDF filename
(filenames sometimes have dates). And ... keywords for all the files uploaded."

Deterministic first, the model last (and cheap):
  1. a date in the file name, then its title, then the top of its first page ("2026-11",
     "15.11.2026", "Nov 2026", "Disember 2026") gives year / month sub-folders;
  2. what the file is (CATEGORIES: Payroll, Leave, Claims, Invoices, Contracts, Minutes,
     Letters, Reports, Policies, Forms...) from its name, the uploader's keywords, the title and
     kind the reading model already wrote (no extra call), and its first page;
  3. the uploader's keywords: a keyword that names a category decides it; otherwise the first
     keyword becomes the folder when nothing else says what the file is;
  4. the unit: its own categories win a tie (Unit HR: payroll, leave...; Unit Kewangan:
     invoices, statements...), and each unit (or company) may rename the folders and turn the
     date folders off (RULES_KEY in the workspace settings).

"Payroll/2026/11" is the result for a payslip of November 2026. An existing folder that already
means the category ("GAJI", "Slip Gaji") is followed instead of making a second one.

Nothing is ever deleted, and file names are kept. A file a person placed (folder_by "person")
is never moved by the sorter or by a plan.
"""

import calendar
import json
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DocFile, Workspace

# ---------------------------------------------------------------- keywords

MAX_KEYWORDS = 20
MAX_KEYWORD_LEN = 40


def clean_keywords(raw: Any) -> list[str]:
    """ "Payroll, Nov 2026 ;HR" or a list -> ["payroll", "nov 2026", "hr"]: trimmed, spaces
    collapsed, lower case, 1..40 characters (longer ones cut), duplicates dropped, at most 20."""
    items: list[str] = []
    for part in raw if isinstance(raw, list | tuple) else [raw]:
        items += re.split(r"[,;\n]+", str(part or ""))
    out: list[str] = []
    for item in items:
        k = re.sub(r"\s+", " ", item).strip().strip("#").strip().casefold()[:MAX_KEYWORD_LEN]
        k = k.strip()
        if k and k not in out:
            out.append(k)
    return out[:MAX_KEYWORDS]


def merge_keywords(
    have: list[str] | None, add: list[str], remove: list[str] | None = None
) -> list[str]:
    gone = set(clean_keywords(list(remove or [])))
    kept = [k for k in (have or []) if k not in gone]
    return clean_keywords(kept + [k for k in clean_keywords(add) if k not in kept])


# ---------------------------------------------------------------- dates

_MONTHS: dict[str, int] = {}
for _n, _names in {
    1: ("jan", "january", "januari"),
    2: ("feb", "february", "februari", "febuari"),
    3: ("mar", "march", "mac"),
    4: ("apr", "april"),
    5: ("may", "mei"),
    6: ("jun", "june"),
    7: ("jul", "july", "julai"),
    8: ("aug", "august", "ogos", "ogo"),
    9: ("sep", "sept", "september"),
    10: ("oct", "october", "okt", "oktober"),
    11: ("nov", "november"),
    12: ("dec", "december", "dis", "disember"),
}.items():
    for _w in _names:
        _MONTHS[_w] = _n
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))
_SEP = r"[-_./ ]"
# Letters around a month name never letters (a digit or a separator may touch it: "NOV2026").
_MON = rf"(?<![^\W\d_])(?P<mon>{_MONTH_ALT})\.?(?![^\W\d_])"
_YEAR4 = r"(?P<y>(?:19|20)\d{2})"

_DATE_RX: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 2026-11-15, 2026_11_15, 20261115
    (
        "ymd",
        re.compile(
            rf"(?<!\d){_YEAR4}(?P<s>{_SEP}?)(?P<m>0[1-9]|1[0-2])(?P=s)(?P<d>0[1-9]|[12]\d|3[01])(?!\d)"
        ),
    ),
    # 15.11.2026, 15/11/2026, 15-11-26, 15112026
    (
        "dmy",
        re.compile(
            r"(?<!\d)(?P<d>0?[1-9]|[12]\d|3[01])(?P<s>[-_./])(?P<m>0?[1-9]|1[0-2])(?P=s)"
            r"(?P<y>(?:19|20)\d{2}|\d{2})(?!\d)"
        ),
    ),
    (
        "dmy",
        re.compile(r"(?<!\d)(?P<d>0[1-9]|[12]\d|3[01])(?P<m>0[1-9]|1[0-2])(?P<y>20\d{2})(?!\d)"),
    ),
    # 15 Nov 2026, 15hb Disember 2026, Nov 2026, November-2026, NOV2026, Nov '26
    (
        "dmony",
        re.compile(
            rf"(?:(?<!\d)(?P<d>0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th|hb)?[\s\-_.,]*)?{_MON}"
            rf"[\s\-_.,']*(?P<y>(?:19|20)\d{{2}}|(?<=')\d{{2}})(?!\d)",
            re.I,
        ),
    ),
    # 2026 Nov, 2026-Disember
    ("ymon", re.compile(rf"(?<!\d){_YEAR4}[\s\-_.,]*{_MON}", re.I)),
    # 2026-11, 2026_11, 2026.11 (not followed by another number: not a full date)
    ("ym", re.compile(rf"(?<!\d){_YEAR4}[-_./](?P<m>0?[1-9]|1[0-2])(?![\d])")),
    # 11/2026, 11-2026
    ("my", re.compile(rf"(?<!\d)(?P<m>0?[1-9]|1[0-2])[-_./]{_YEAR4}(?!\d)")),
    # a year on its own (weakest)
    ("y", re.compile(r"(?<![\d])(?P<y>(?:19[89]|20\d)\d)(?![\d])")),
)
_RANK = {"ymd": 3, "dmy": 3, "dmony": 3, "ymon": 2, "ym": 2, "my": 2, "y": 1}


@dataclass(frozen=True)
class FoundDate:
    year: int
    month: int | None = None
    day: int | None = None
    text: str = ""  # what was read, e.g. "15.11.2026"

    def month_name(self) -> str:
        return calendar.month_name[self.month] if self.month else ""


def _year(raw: str) -> int | None:
    y = int(raw)
    if y < 100:
        y += 2000
    return y if 1980 <= y <= 2099 else None


def find_date(text: str, *, year_only_ok: bool = True) -> FoundDate | None:
    """The most precise date in `text` (a full date beats a month, a month beats a year; the
    first one wins between equals). Malay and English month names, day-first numbers."""
    if not text:
        return None
    best: tuple[int, int, FoundDate] | None = None
    for kind, rx in _DATE_RX:
        if kind == "y" and not year_only_ok:
            continue
        for m in rx.finditer(text):
            g = m.groupdict()
            y = _year(g["y"]) if g.get("y") else None
            if y is None:
                continue
            month = int(g["m"]) if g.get("m") else _MONTHS.get((g.get("mon") or "").lower())
            day = int(g["d"]) if g.get("d") else None
            if month is not None and not 1 <= month <= 12:
                continue
            if day is not None and month is not None:
                if day > calendar.monthrange(y, month)[1]:
                    continue
            found = FoundDate(y, month, day, m.group(0).strip())
            rank = _RANK[kind] if month else 1
            if best is None or rank > best[0] or (rank == best[0] and m.start() < best[1]):
                best = (rank, m.start(), found)
            break  # the first match of each pattern is enough
    return best[2] if best else None


def _words(text: str) -> str:
    """File names: "Slip_Gaji-Nov.2026.pdf" -> "Slip Gaji Nov.2026" (the extension dropped)."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", text or "")
    return re.sub(r"[_+()\[\]]+", " ", stem)


# ---------------------------------------------------------------- categories


@dataclass(frozen=True)
class Category:
    key: str
    folder: str  # the default folder name
    words: tuple[str, ...]  # English and Malay, matched as whole words
    kinds: tuple[str, ...] = ()  # intake.sort KINDS that fall back to it


CATEGORIES: tuple[Category, ...] = (
    Category(
        "payroll",
        "Payroll",
        (
            "payroll",
            "payslip",
            "payslips",
            "pay slip",
            "pay slips",
            "slip gaji",
            "penyata gaji",
            "gaji",
            "salary",
            "salaries",
            "wages",
            "upah",
            "epf",
            "kwsp",
            "socso",
            "perkeso",
            "eis",
            "pcb",
            "cp39",
            "ea form",
            "borang ea",
            "elaun",
            "allowance",
            "allowances",
            "overtime",
            "bonus",
        ),
    ),
    Category(
        "leave",
        "Leave",
        (
            "leave",
            "cuti",
            "annual leave",
            "cuti tahunan",
            "medical leave",
            "cuti sakit",
            "mc",
            "sijil sakit",
            "medical certificate",
            "emergency leave",
            "cuti kecemasan",
            "maternity",
            "bersalin",
            "unpaid leave",
        ),
    ),
    Category(
        "claims",
        "Claims",
        ("claim", "claims", "tuntutan", "reimbursement", "expense claim", "mileage", "perbatuan"),
    ),
    Category(
        "attendance",
        "Attendance",
        (
            "attendance",
            "kehadiran",
            "timesheet",
            "timesheets",
            "time sheet",
            "punch card",
            "clock in",
            "roster",
            "jadual tugas",
            "jadual syif",
        ),
    ),
    Category(
        "recruitment",
        "Recruitment",
        (
            "resume",
            "cv",
            "curriculum vitae",
            "interview",
            "temuduga",
            "recruitment",
            "pengambilan",
            "job application",
            "permohonan jawatan",
            "offer letter",
            "surat tawaran",
            "tawaran kerja",
            "onboarding",
        ),
    ),
    Category(
        "discipline",
        "Discipline",
        (
            "disciplinary",
            "tatatertib",
            "disiplin",
            "warning letter",
            "surat amaran",
            "show cause",
            "tunjuk sebab",
            "domestic inquiry",
            "siasatan dalaman",
        ),
    ),
    Category(
        "training",
        "Training",
        ("training", "latihan", "kursus", "course", "seminar", "bengkel", "workshop"),
    ),
    Category(
        "invoices",
        "Invoices",
        (
            "invoice",
            "invoices",
            "invois",
            "receipt",
            "receipts",
            "resit",
            "quotation",
            "quotations",
            "sebut harga",
            "purchase order",
            "delivery order",
            "baucar",
            "voucher",
            "payment voucher",
            "baucar bayaran",
            "debit note",
            "credit note",
        ),
        ("financial",),
    ),
    Category(
        "statements",
        "Statements",
        (
            "bank statement",
            "penyata bank",
            "statement of account",
            "penyata akaun",
            "penyata",
            "statement",
            "statements",
            "ledger",
            "lejar",
            "bank reconciliation",
            "penyesuaian bank",
        ),
    ),
    Category(
        "contracts",
        "Contracts",
        (
            "contract",
            "contracts",
            "kontrak",
            "agreement",
            "agreements",
            "perjanjian",
            "mou",
            "memorandum of understanding",
            "letter of award",
            "surat setuju terima",
            "lantikan",
            "appointment letter",
            "surat lantikan",
            "tenancy",
            "sewaan",
        ),
        ("contract",),
    ),
    Category(
        "minutes",
        "Minutes",
        ("minutes", "minit", "minit mesyuarat", "meeting minutes", "mesyuarat", "agenda"),
    ),
    Category(
        "audit",
        "Audit",
        (
            "audit",
            "audit report",
            "laporan audit",
            "audit findings",
            "penemuan audit",
            "compliance",
            "pematuhan",
            "internal control",
            "kawalan dalaman",
        ),
    ),
    Category(
        "reports",
        "Reports",
        ("report", "reports", "laporan", "statistik", "statistics", "analysis", "analisis"),
        ("report",),
    ),
    Category(
        "policies",
        "Policies",
        (
            "policy",
            "policies",
            "polisi",
            "dasar",
            "sop",
            "sops",
            "procedure",
            "procedures",
            "prosedur",
            "tatacara",
            "garis panduan",
            "guideline",
            "guidelines",
            "pekeliling",
            "circular",
            "handbook",
            "manual",
            "peraturan",
            "code of conduct",
            "kod etika",
        ),
        ("sop", "policy", "guide", "flowchart"),
    ),
    Category(
        "forms",
        "Forms",
        ("form", "forms", "borang", "application form", "permohonan", "template", "templat"),
        ("form", "template", "checklist"),
    ),
    Category(
        "letters",
        "Letters",
        ("letter", "letters", "surat", "memo", "notis", "notice", "makluman"),
        ("letter",),
    ),
    Category(
        "certificates",
        "Certificates",
        (
            "certificate",
            "certificates",
            "sijil",
            "license",
            "licence",
            "lesen",
            "permit",
            "ssm",
            "cidb",
        ),
        ("certificate",),
    ),
)
BY_KEY = {c.key: c for c in CATEGORIES}
# A unit's own categories first: they win a tie (a "surat cuti" in Unit HR is Leave).
UNIT_FIRST: dict[str, tuple[str, ...]] = {
    "hr": (
        "payroll",
        "leave",
        "claims",
        "attendance",
        "recruitment",
        "discipline",
        "training",
        "contracts",
    ),
    "audit": ("audit", "reports", "policies", "minutes"),
    "finance": ("invoices", "statements", "payroll", "claims", "contracts", "reports"),
}


def _rx(words: tuple[str, ...]) -> re.Pattern[str]:
    alts = sorted({re.escape(w).replace(r"\ ", r"[\s_\-.]+") for w in words}, key=len, reverse=True)
    return re.compile(r"(?<![^\W\d_])(?:" + "|".join(alts) + r")(?![^\W\d_])", re.I)


_CAT_RX = {c.key: _rx(c.words) for c in CATEGORIES}


def category_of_text(text: str) -> str | None:
    """The first category whose words appear in `text` (a keyword, a folder name)."""
    for c in CATEGORIES:
        if _CAT_RX[c.key].search(text or ""):
            return c.key
    return None


# ---------------------------------------------------------------- rules

RULES_KEY = "library_organize"
DATE_MODES = ("month", "year", "off")


@dataclass
class Rules:
    """How one unit or company sorts: folder name per category, date folders, keyword folders,
    and whether "sort automatically" starts on in its upload dialog."""

    folders: dict[str, str] = field(default_factory=dict)  # category key -> folder name
    dates: str = "month"  # month: Payroll/2026/11; year: Payroll/2026; off: Payroll
    keyword_folders: bool = True  # no category: the first keyword is the folder
    auto: bool = True  # the upload dialog's "sort automatically" starts on
    unit: str | None = None  # hr | audit | finance when it is a Library unit

    def folder(self, key: str) -> str:
        return self.folders.get(key) or BY_KEY[key].folder

    def out(self) -> dict[str, Any]:
        return {
            "folders": {c.key: self.folder(c.key) for c in CATEGORIES},
            "dates": self.dates,
            "keyword_folders": self.keyword_folders,
            "auto": self.auto,
            "unit": self.unit,
        }


def place_key(branch_id: str | None, department_id: str | None) -> str:
    return department_id or branch_id or "workspace"


def clean_folder_name(raw: Any) -> str:
    """One folder name (no slashes): "  Slip / Gaji " -> "Slip Gaji", at most 60 characters."""
    s = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", " ", str(raw or ""))
    return re.sub(r"\s+", " ", s).strip().strip(".")[:60].strip()


def parse_rules(raw: Any, unit: str | None, *, is_unit: bool) -> Rules:
    r = Rules(unit=unit, auto=is_unit)
    if not isinstance(raw, dict):
        return r
    folders = raw.get("folders")
    if isinstance(folders, dict):
        for k, v in folders.items():
            name = clean_folder_name(v)
            if k in BY_KEY and name:
                r.folders[k] = name
    if raw.get("dates") in DATE_MODES:
        r.dates = str(raw["dates"])
    if isinstance(raw.get("keyword_folders"), bool):
        r.keyword_folders = raw["keyword_folders"]
    if isinstance(raw.get("auto"), bool):
        r.auto = raw["auto"]
    return r


async def unit_key(db: AsyncSession, workspace_id: str, department_id: str | None) -> str | None:
    """hr | audit | finance when the department is one of the Library's units."""
    if not department_id:
        return None
    from . import library_units

    for u in await library_units.find(db, workspace_id):
        if u.department.id == department_id:
            return u.key
    return None


async def load_rules(
    db: AsyncSession, workspace_id: str, branch_id: str | None, department_id: str | None
) -> Rules:
    settings = await db.scalar(select(Workspace.settings).where(Workspace.id == workspace_id))
    saved = ((settings or {}).get(RULES_KEY) or {}).get(place_key(branch_id, department_id))
    unit = await unit_key(db, workspace_id, department_id)
    return parse_rules(saved, unit, is_unit=unit is not None)


async def save_rules(
    db: AsyncSession,
    workspace_id: str,
    branch_id: str | None,
    department_id: str | None,
    rules: Rules,
) -> None:
    """Only this place's entry, in one statement (core.workspace_settings.merge)."""
    from ..core import workspace_settings

    q = (
        select(Workspace.settings)
        .where(Workspace.id == workspace_id)
        .with_for_update(key_share=True)
    )
    settings = await db.scalar(q) or {}
    every = dict(settings.get(RULES_KEY) or {})
    stored = rules.out()
    every[place_key(branch_id, department_id)] = {
        "folders": {
            k: v for k, v in stored["folders"].items() if v != BY_KEY[k].folder
        },  # only what differs from the default names
        "dates": rules.dates,
        "keyword_folders": rules.keyword_folders,
        "auto": rules.auto,
    }
    sync = db.sync_session
    ws = sync.identity_map.get(sync.identity_key(Workspace, workspace_id))
    await workspace_settings.merge(db, workspace_id, {RULES_KEY: every}, ws)


# ---------------------------------------------------------------- proposals


@dataclass
class Proposal:
    folder: str | None  # relative to the base folder; None = leave it where it is
    category: str | None
    date: FoundDate | None
    why: list[str]  # short reasons, English (tools); the web shows the folder only

    def reason(self) -> str:
        return "; ".join(self.why) or "nothing to go by"


@dataclass
class FileFacts:
    """What the sorter reads of one file (a DocFile, or a name before it is uploaded)."""

    name: str
    title: str = ""
    kind: str = ""  # intake.sort KINDS once read
    free_kind: str = ""  # what the reading model called it ("Payslip")
    head: str = ""  # the top of its first page
    keywords: list[str] = field(default_factory=list)

    @classmethod
    def of(cls, f: DocFile, info: dict[str, Any] | None = None, head: str = "") -> "FileFacts":
        return cls(
            name=f.name,
            title=f.title or "",
            kind=f.kind or "",
            free_kind=str((info or {}).get("kind") or ""),
            head=head,
            keywords=list(f.keywords or []),
        )


def _score(facts: FileFacts, unit: str | None) -> tuple[str | None, str]:
    name = _words(facts.name)
    kw = " , ".join(facts.keywords)
    head = facts.head[:1500]
    best: tuple[int, int, str, str] | None = None
    first = UNIT_FIRST.get(unit or "", ())
    for i, c in enumerate(CATEGORIES):
        rx = _CAT_RX[c.key]
        n, via = 0, ""
        if kw and rx.search(kw):
            n, via = n + 5, via or "keyword"
        if rx.search(name):
            n, via = n + 4, via or "name"
        if facts.title and rx.search(facts.title):
            n, via = n + 3, via or "title"
        if facts.free_kind and rx.search(facts.free_kind):
            n, via = n + 3, via or "content"
        if head:
            hits = len(rx.findall(head))
            if hits:
                n, via = n + min(2, hits), via or "content"
        if not n:
            continue
        order = first.index(c.key) if c.key in first else len(first) + i
        if best is None or n > best[0] or (n == best[0] and order < best[1]):
            best = (n, order, c.key, via)
    if best is not None:
        return best[2], best[3]
    for c in CATEGORIES:  # the reading's kind (intake.sort KINDS) as a last resort
        if facts.kind and facts.kind in c.kinds:
            return c.key, "kind"
    return None, ""


def _date_of(facts: FileFacts) -> tuple[FoundDate | None, str]:
    d = find_date(_words(facts.name))
    if d is not None:
        return d, "name"
    for kw in facts.keywords:
        d = find_date(kw, year_only_ok=False)
        if d is not None:
            return d, "keyword"
    if facts.title:
        d = find_date(facts.title, year_only_ok=False)
        if d is not None:
            return d, "title"
    if facts.head:
        d = find_date(facts.head[:600], year_only_ok=False)
        if d is not None:
            return d, "content"
    return None, ""


def _existing(name: str, existing: list[str], key: str | None) -> str:
    """Follow a folder people already have: the same name (any case), or one that means the
    same category ("GAJI" for Payroll)."""
    low = name.casefold()
    for e in existing:
        if e.casefold() == low:
            return e
    if key:
        for e in existing:
            if category_of_text(e) == key:
                return e
    return name


def propose(
    facts: FileFacts, rules: Rules, existing: dict[str, list[str]] | None = None
) -> Proposal:
    """The folder (relative to the base) for one file. `existing`: folder path -> its
    sub-folders' names ("" = the base's own), to follow the names people already use."""
    existing = existing or {}
    key, via = _score(facts, rules.unit)
    date, date_via = _date_of(facts) if rules.dates != "off" else (None, "")
    why: list[str] = []
    parts: list[str] = []
    if key:
        parts.append(_existing(rules.folder(key), existing.get("", []), key))
        why.append(f"{key} ({via})")
    elif rules.keyword_folders and facts.keywords:
        kw = clean_folder_name(facts.keywords[0])
        if kw:
            parts.append(_existing(kw[:1].upper() + kw[1:], existing.get("", []), None))
            why.append("first keyword")
    if not parts and date is None:
        return Proposal(None, None, None, ["nothing to go by"])
    if not parts:
        parts.append(_existing("General", existing.get("", []), None))
    if date is not None:
        y = _existing(str(date.year), existing.get("/".join(parts), []), None)
        parts.append(y)
        if rules.dates == "month" and date.month:
            parts.append(_existing(f"{date.month:02d}", existing.get("/".join(parts), []), None))
        why.append(f"date {date.text} ({date_via})")
    return Proposal("/".join(parts), key, date, why)


def existing_tree(paths: list[str], base: str = "") -> dict[str, list[str]]:
    """{relative parent: [child names]} of the folders under `base`."""
    out: dict[str, list[str]] = {}
    pre = f"{base}/" if base else ""
    for p in paths:
        if base and not p.startswith(pre):
            continue
        rel = p[len(pre) :] if base else p
        parts = [x for x in rel.split("/") if x]
        for i in range(len(parts)):
            parent = "/".join(parts[:i])
            kids = out.setdefault(parent, [])
            if parts[i] not in kids:
                kids.append(parts[i])
    return out


def join(base: str, rel: str) -> str:
    return "/".join(x for x in (base, rel) if x)[:300]


# ---------------------------------------------------------------- folders of a place


async def folder_paths(
    db: AsyncSession, workspace_id: str, branch_id: str | None, department_id: str | None
) -> list[str]:
    """Every folder of the place (files' folders and created empty ones)."""
    q = select(DocFile.folder).where(DocFile.workspace_id == workspace_id, DocFile.folder != "")
    if branch_id:
        q = q.where(DocFile.branch_id == branch_id)
    if department_id:
        q = q.where(DocFile.department_id == department_id)
    paths = set((await db.scalars(q.distinct())).all())
    from ..api.routers.company_files import _saved_folders

    for e in await _saved_folders(db, workspace_id):
        if (branch_id is None or e["branch_id"] == branch_id) and (
            department_id is None or e.get("department_id") == department_id
        ):
            paths.add(e["path"])
    every: set[str] = set()
    for p in paths:
        parts = p.split("/")
        every |= {"/".join(parts[: i + 1]) for i in range(len(parts))}
    return sorted(every, key=str.casefold)


# ---------------------------------------------------------------- on upload


async def sort_on_read(db: AsyncSession, f: DocFile, info: dict[str, Any], text: str) -> None:
    """intake: a file uploaded with "sort into folders automatically" (folder_by "sort"),
    once read. Moved under the folder it was uploaded into, unless a person moved it
    meanwhile (then folder_by is "person" and nothing happens here)."""
    await db.refresh(f, ["folder", "folder_by"])  # a person may have moved it while it was read
    if f.folder_by != "sort":
        return
    if f.quarantined or f.status == "failed":
        f.folder_by = ""
        return
    from ..intake.sort import first_page

    rules = await load_rules(db, f.workspace_id, f.branch_id, f.department_id)
    base = f.folder or ""
    paths = await folder_paths(db, f.workspace_id, f.branch_id, f.department_id)
    p = propose(FileFacts.of(f, info, first_page(text)), rules, existing_tree(paths, base))
    if p.folder:
        f.folder = join(base, p.folder)
        f.folder_by = "auto"
    else:
        f.folder_by = ""


# ---------------------------------------------------------------- plans (agents, the web)


@dataclass
class Move:
    file_id: str
    name: str
    src: str
    dst: str
    why: str

    def out(self) -> dict[str, str]:
        return {"file_id": self.file_id, "folder": self.dst}


@dataclass
class Plan:
    base: str
    moves: list[Move]
    kept: list[tuple[str, str, str]]  # (file id, name, why it stays)

    def folders(self) -> list[str]:
        return sorted({m.dst for m in self.moves}, key=str.casefold)


def movable(f: DocFile, base: str) -> str | None:
    """None when a plan may move this file, else why it stays."""
    if f.quarantined:
        return "held back for review"
    if f.folder_by == "person":
        return "placed by a person"
    if (f.folder or "") == base:
        return None
    if f.folder_by == "auto":  # sorted by the rules before: re-sorted with today's rules
        return None
    return "already in a folder"


async def make_plan(
    db: AsyncSession,
    files: list[DocFile],
    rules: Rules,
    base: str,
    paths: list[str],
    hints: dict[str, str] | None = None,
) -> Plan:
    """A plan for the files under `base`: loose files (and ones the rules sorted before) to
    their proposed folders. `hints`: file id -> category key a model suggested for the files
    the rules could not place."""
    from ..intake.sort import first_page

    tree = existing_tree(paths, base)
    moves: list[Move] = []
    kept: list[tuple[str, str, str]] = []
    for f in files:
        why = movable(f, base)
        if why:
            kept.append((f.id, f.name, why))
            continue
        text = await db.scalar(select(DocFile.text).where(DocFile.id == f.id)) or ""
        facts = FileFacts.of(f, None, first_page(text))
        hint = (hints or {}).get(f.id)
        if hint in BY_KEY:
            facts.keywords = [*facts.keywords, *BY_KEY[hint].words[:1]]
        p = propose(facts, rules, tree)
        if not p.folder:
            kept.append((f.id, f.name, p.reason()))
            continue
        dst = join(base, p.folder)
        if dst == (f.folder or ""):
            kept.append((f.id, f.name, "already in the right folder"))
            continue
        moves.append(Move(f.id, f.name, f.folder or "", dst, p.reason()))
    return Plan(base, moves, kept)


AI_PROMPT = (
    "Sort office files into folders. For each file below answer the one category it belongs "
    'to, from exactly this list: {cats}; or "" when none fits. Reply with JSON only: '
    '{{"<file id>": "<category>", ...}}.'
)


async def ai_hints(db: AsyncSession, workspace_id: str, files: list[DocFile]) -> dict[str, str]:
    """One cheap model call for files the rules could not place (empty when no model)."""
    from ..engine import gateway

    if not files:
        return {}
    lines = [
        f"{f.id}: {f.name} | {f.title or ''} | {f.kind or ''} | {(f.summary or '')[:200]}"
        for f in files[:40]
    ]
    prompt = "\n".join(lines)
    system = AI_PROMPT.format(cats=", ".join(c.key for c in CATEGORIES))
    try:
        r = await gateway.chat_first(
            db,
            workspace_id,
            gateway.cheap_groups(prompt),
            [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            task="library.organize",
            max_tokens=600,
            temperature=0,
            json_mode=True,
        )
    except gateway.GatewayUnavailable:
        return {}
    try:
        raw = json.loads(re.sub(r"^```(?:json)?|```$", "", (r.content or "").strip()))
    except ValueError:
        return {}
    ids = {f.id for f in files}
    return {
        str(k): str(v)
        for k, v in (raw.items() if isinstance(raw, dict) else [])
        if k in ids and v in BY_KEY
    }
