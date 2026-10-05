"""P25: everything an agent makes is stored, labelled and reviewable.

Origin. Every Document is made by a person or an agent (`origin`), every DocFile was
uploaded, made by a person (a compiled pack) or made by an agent (`origin`). Both keep the
agent, the task and the workflow run they came from, so people can filter "Made by AI" and
open the work that produced it.

The AI folder. When an agent drafts, revises or exports a document, a copy is saved into the
company's files, one file per document and format (PDF, Word, Excel). Exporting again
replaces that file's contents with the latest version (the document keeps every version), so
re-exports never pile up duplicates. People may move the file; it stays linked.

Folders are named in the company's language (its kit's Document language, else the
workspace's), one root per company:

    English: AI documents/<kind>     e.g. AI documents/Quotations
    Malay:   Dokumen AI/<kind>       e.g. Dokumen AI/Sebut harga

`<kind>` is the built-in kind's folder (KIND_FOLDERS), or the company's own template name
(e.g. "Dokumen AI/Surat amaran" for a template called "Surat amaran"), or "Other documents".
Reports agents publish go to AI documents/Reports, pictures to AI documents/Pictures, and
files from run_python to AI documents/Other files. The language is the workspace setting
`language` when set, else the first owner's language; a company that already has one root
keeps using it, so switching language never splits its AI folder in two.

Review. A document an agent made waits for a person (status "review"). People approve it,
send it back with a note (the agent revises it in its task, or in a small new task), or edit
it themselves. `review_status` is what lists show: draft | waiting | sent_back | approved.
"""

import hashlib
import io
import logging
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import normalize, tr
from ..models import (
    Agent,
    CompanyKit,
    DocFile,
    DocTemplate,
    Document,
    Membership,
    Report,
    Task,
    User,
    Workspace,
)
from . import render_pdf, service

log = logging.getLogger("agentic.documents.provenance")

ROOT = {"en": "AI documents", "ms": "Dokumen AI"}

# key -> (English folder, Malay folder)
KIND_FOLDERS: dict[str, tuple[str, str]] = {
    "quotation": ("Quotations", "Sebut harga"),
    "invoice": ("Invoices", "Invois"),
    "letter": ("Letters", "Surat"),
    "proposal": ("Proposals", "Cadangan"),
    "minutes": ("Meeting minutes", "Minit mesyuarat"),
    "profile": ("Company profiles", "Profil syarikat"),
    "delivery": ("Delivery orders", "Pesanan penghantaran"),
    "report": ("Reports", "Laporan"),
    "picture": ("Pictures", "Gambar"),
    "file": ("Other files", "Fail lain"),
    "custom": ("Other documents", "Dokumen lain"),
}

# A document's kind -> the company-files kind (intake.sort.KINDS) its saved copy gets.
FILE_KIND = {
    "quotation": "financial",
    "invoice": "financial",
    "delivery": "financial",
    "letter": "letter",
    "minutes": "report",
    "proposal": "report",
    "profile": "report",
    "report": "report",
}

FORMAT_OF = {mime: fmt for fmt, mime in service.EXPORT_MIME.items()}

REVIEW_STATES = ("draft", "waiting", "sent_back", "approved")


# ---------------------------------------------------------------- origin


def is_agent(created_by: str | None, agent_id: str | None) -> bool:
    return bool(agent_id) or (created_by or "").startswith("agent:")


def doc_origin(created_by: str | None, agent_id: str | None) -> str:
    return "agent" if is_agent(created_by, agent_id) else "person"


def file_origin(source: str, created_by: str | None, agent_id: str | None) -> str:
    if source == "upload":
        return "uploaded"
    return "agent" if is_agent(created_by, agent_id) else "person"


async def desk_owner(
    db: AsyncSession, created_by: str | None, task_id: str | None, agent_id: str | None
) -> str | None:
    """P26: whose workspace (desk) a new file or document belongs to: the person who made
    it, else the person who gave the task it came from (the top of a chain of sub-tasks), else
    the owner of the AI worker that made it (a twin or personal assistant). None = company
    work nobody in particular asked for."""

    async def person(actor: str | None) -> str | None:
        if actor and actor.startswith("user:"):
            uid = actor[5:]
            return uid if await db.get(User, uid) is not None else None
        return None

    if uid := await person(created_by):
        return uid
    if task_id:
        task = await db.get(Task, task_id)
        root = await db.get(Task, task.root_task_id) if task and task.root_task_id else task
        if root is not None and (uid := await person(root.created_by)):
            return uid
    if agent_id:
        agent = await db.get(Agent, agent_id)
        if agent is not None and agent.owner_user_id:
            return agent.owner_user_id
    return None


async def run_of(db: AsyncSession, task_id: str | None) -> str | None:
    """The workflow run a task is one step of (None for a plain task)."""
    if not task_id:
        return None
    return await db.scalar(select(Task.workflow_run_id).where(Task.id == task_id))


def review_status(status: str, review: dict[str, Any] | None) -> str:
    if status == "approved":
        return "approved"
    if status == "review":
        return "waiting"
    if (review or {}).get("state") == "sent_back":
        return "sent_back"
    return "draft"


async def actor_name(db: AsyncSession, actor: str | None) -> str | None:
    """ "user:us_1" -> the person's name, "agent:ag_1" -> the agent's name."""
    if not actor or ":" not in actor:
        return None
    kind, _, ident = actor.partition(":")
    if kind == "user":
        return await db.scalar(select(User.name).where(User.id == ident))
    if kind == "agent":
        return await db.scalar(select(Agent.name).where(Agent.id == ident))
    return None


# ---------------------------------------------------------------- the AI folder


async def folder_lang(db: AsyncSession, workspace_id: str, branch_id: str | None = None) -> str:
    """The language AI folders are named in: the company's kit `language`, else the
    workspace's `language` setting, else the first owner's language, else English."""
    from ..services.prefs import lang_of

    if branch_id:
        kit = await db.get(CompanyKit, branch_id)
        kit_lang = normalize(str((kit.data or {}).get("language") or "")) if kit else None
        if kit_lang:
            return kit_lang
    ws = await db.get(Workspace, workspace_id)
    set_lang = normalize((ws.settings or {}).get("language")) if ws else None
    if set_lang:
        return set_lang
    owner = await db.scalar(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == workspace_id, Membership.role == "owner")
        .order_by(Membership.created_at)
        .limit(1)
    )
    return lang_of(owner) if owner else "en"


async def _root(db: AsyncSession, workspace_id: str, branch_id: str | None, lang: str) -> str:
    """The root this company already uses, else the one in `lang`."""
    for code, name in ROOT.items():
        q = select(DocFile.id).where(
            DocFile.workspace_id == workspace_id,
            DocFile.folder.like(f"{name}/%"),
            DocFile.origin != "uploaded",
        )
        q = q.where(DocFile.branch_id == branch_id if branch_id else DocFile.branch_id.is_(None))
        if code != lang and await db.scalar(q.limit(1)):
            return name
    return ROOT.get(lang, ROOT["en"])


async def move_ai_folder(
    db: AsyncSession, workspace_id: str, branch_id: str | None, lang: str
) -> int:
    """Move a company's AI folder to `lang`'s root, renaming the built-in sub-folders
    ("AI documents/Quotations" -> "Dokumen AI/Sebut harga"); folders named after the
    company's own templates keep their names. Returns how many files moved."""
    new_root = ROOT.get(lang, ROOT["en"])
    i = 1 if new_root == ROOT["ms"] else 0
    subs = {pair[1 - i]: pair[i] for pair in KIND_FOLDERS.values()}
    moved = 0
    for old_root in (r for r in ROOT.values() if r != new_root):
        q = select(DocFile).where(
            DocFile.workspace_id == workspace_id,
            DocFile.origin != "uploaded",
            DocFile.folder.like(f"{old_root}/%") | (DocFile.folder == old_root),
        )
        q = q.where(DocFile.branch_id == branch_id if branch_id else DocFile.branch_id.is_(None))
        for f in (await db.scalars(q)).all():
            first, _, rest = f.folder[len(old_root) + 1 :].partition("/")
            f.folder = "/".join(p for p in (new_root, subs.get(first, first), rest) if p)
            moved += 1
    return moved


def _part(text: str) -> str:
    return re.sub(r"[\\/\x00-\x1f]+", "-", text).strip(" .-")[:80]


async def ai_folder(
    db: AsyncSession,
    workspace_id: str,
    branch_id: str | None,
    key: str,
    own_name: str | None = None,
) -> str:
    """ "AI documents/Quotations" (or the Malay twin). `own_name` (a company template's
    name) is used as is, in whatever language the company wrote it."""
    lang = await folder_lang(db, workspace_id, branch_id)
    root = await _root(db, workspace_id, branch_id, lang)
    if own_name and _part(own_name):
        sub = _part(own_name)
    else:
        en, ms = KIND_FOLDERS.get(key) or KIND_FOLDERS["custom"]
        sub = ms if root == ROOT["ms"] else en
    return f"{root}/{sub}"


def _folder_key(doc: Document, tpl: DocTemplate | None) -> tuple[str, str | None]:
    """Which AI folder a document goes in: its built-in kind, or a company template's name."""
    if tpl is not None and not tpl.builtin:
        return doc.kind, tpl.name
    return (doc.kind if doc.kind in KIND_FOLDERS else "custom"), None


def _file_kind(doc: Document) -> str:
    k = (doc.kind or "").lower()
    if k in FILE_KIND:
        return FILE_KIND[k]
    if re.search(r"letter|surat", k):
        return "letter"
    if re.search(r"order|pesanan|invoice|invois|quot|sebut", k):
        return "financial"
    return "other"


def _pages(data: bytes) -> int:
    try:
        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:  # noqa: BLE001 - a page count is a nicety
        return 0


# ---------------------------------------------------------------- saving documents


async def linked_files(db: AsyncSession, doc_id: str) -> list[DocFile]:
    return list(
        (
            await db.scalars(
                select(DocFile).where(DocFile.document_id == doc_id).order_by(DocFile.created_at)
            )
        ).all()
    )


async def _summary(db: AsyncSession, doc: Document, lang: str) -> str:
    label = f"{doc.number} {doc.title}" if doc.number else doc.title
    if doc.origin == "agent":
        name = await db.scalar(select(Agent.name).where(Agent.id == doc.agent_id)) or "AI"
        return tr(
            "{title}, made by {agent} (AI agent). Version {version}.",
            lang,
            title=label,
            agent=name,
            version=doc.version,
        )
    return tr(
        "{title}, saved from Documents. Version {version}.", lang, title=label, version=doc.version
    )


async def save_export(
    db: AsyncSession, doc: Document, fmt: str = "pdf", *, agent_id: str | None = None
) -> DocFile:
    """Render the document and keep it in the company's files: the existing file of that
    format is replaced (same id, same folder), else a new one goes into the AI folder.
    `agent_id`: the agent saving it, when the document has none. Flushes, does not commit."""
    data, name, mime = await service.export(db, doc, fmt)
    rendered = await service.render(db, doc)
    lang = await folder_lang(db, doc.workspace_id, doc.branch_id)
    f = next((x for x in await linked_files(db, doc.id) if x.mime == mime), None)
    if f is None:
        tpl = await db.get(DocTemplate, doc.template_id) if doc.template_id else None
        key, own = _folder_key(doc, tpl)
        f = await service.create_file(
            db,
            workspace_id=doc.workspace_id,
            name=name,
            data=data,
            created_by=doc.created_by,
            mime=mime,
            branch_id=doc.branch_id,
            task_id=doc.task_id,
            agent_id=doc.agent_id or agent_id,
            source="generated",
            status="ready",
            folder=await ai_folder(db, doc.workspace_id, doc.branch_id, key, own),
            origin=doc.origin,
            workflow_run_id=doc.workflow_run_id,
        )
        f.document_id = doc.id
    else:
        f.data, f.size, f.name = data, len(data), name
        f.sha256 = hashlib.sha256(data).hexdigest()
        f.updated_at = datetime.now(UTC)
    f.mime = mime
    f.title = (f"{doc.number} {doc.title}" if doc.number else doc.title)[:200]
    f.kind = _file_kind(doc)
    f.text = rendered.filled.markdown
    f.pages = _pages(data) if fmt == "pdf" else 0
    f.summary = (await _summary(db, doc, lang))[:1000]
    f.status, f.error = "ready", None
    await db.flush()
    return f


async def refresh_files(
    db: AsyncSession, doc: Document, *, ensure_pdf: bool = False
) -> list[DocFile]:
    """Bring the document's saved copies up to date after a change (each format it was saved
    in); `ensure_pdf` also saves a PDF when there is none yet. Never raises: a rendering
    problem is logged and the document change still stands. Flushes, does not commit."""
    try:
        have = {FORMAT_OF.get(f.mime) for f in await linked_files(db, doc.id)} - {None}
        if ensure_pdf:
            have.add("pdf")
        return [await save_export(db, doc, fmt) for fmt in sorted(f for f in have if f)]
    except Exception:  # noqa: BLE001 - the saved copy can be made again by exporting
        log.warning("could not save the files of document %s", doc.id, exc_info=True)
        return []


# ---------------------------------------------------------------- reports


def _report_markdown(r: Report) -> str:
    parts = [f"# {r.title}"]
    if r.summary:
        parts.append(r.summary)
    if r.body:
        parts.append(r.body)
    for t in r.tables or []:
        cols = [str(c).replace("|", "/") for c in t.get("columns") or []]
        if not cols:
            continue
        if t.get("title"):
            parts.append(f"## {t['title']}")
        lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
        for row in (t.get("rows") or [])[:300]:
            cells = [str(v).replace("|", "/").replace("\n", " ") for v in row]
            lines.append("| " + " | ".join(cells) + " |")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


async def save_report(db: AsyncSession, r: Report) -> DocFile | None:
    """Keep a PDF of an agent's report in AI documents/Reports (replaced when the report is
    updated). Never raises. Commits."""
    try:
        md = _report_markdown(r)
        lh = await service.letterhead(db, r.branch_id)
        data = render_pdf.render(md, r.title, lh, True)
        f = await db.scalar(select(DocFile).where(DocFile.report_id == r.id).limit(1))
        name = f"{re.sub(r'[^A-Za-z0-9]+', '-', r.title).strip('-')[:60] or 'report'}.pdf"
        if f is None:
            agent = await db.get(Agent, r.agent_id) if r.agent_id else None
            f = await service.create_file(
                db,
                workspace_id=r.workspace_id,
                name=name,
                data=data,
                created_by=f"agent:{r.agent_id}" if r.agent_id else "system",
                mime="application/pdf",
                branch_id=r.branch_id,
                task_id=r.task_id,
                agent_id=agent.id if agent else None,
                source="generated",
                status="ready",
                folder=await ai_folder(db, r.workspace_id, r.branch_id, "report"),
                origin="agent",
            )
            f.report_id = r.id
        else:
            f.data, f.size, f.name = data, len(data), name
            f.sha256 = hashlib.sha256(data).hexdigest()
            f.updated_at = datetime.now(UTC)
        f.kind, f.title, f.text = "report", r.title[:200], md
        f.summary = (r.summary or r.title)[:1000]
        f.pages = _pages(data)
        await db.commit()
        return f
    except Exception:  # noqa: BLE001 - the report itself is saved; its PDF is a copy
        await db.rollback()
        log.warning("could not save report %s as a file", r.id, exc_info=True)
        return None
