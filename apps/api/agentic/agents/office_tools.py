"""P55: everyday office paperwork for agents: see the company's folders, file documents into
them, and compile several files or drafts into one PDF (a claim, a staff file, a month's
receipts).

Filing moves only files the agent may already read (doc_tools._file: its company, its
department's guidelines, never anyone's own files or held-back ones), and every move is on
the audit log with where it came from, so a person can put it back. Compiling reuses the
submission-pack converter (documents/packs.item_pdf): PDFs as they are, pictures as pages,
anything with text set as pages; the result is a new file in the AI documents folder.
"""

import io
import re
from typing import Any

from sqlalchemy import func, select

from ..documents import packs, provenance, render_pdf, service
from ..models import DocFile
from .doc_tools import HELD_BACK, _doc, _file, _task_id
from .tools import Tool, ToolContext

MAX_FILE_AT_ONCE = 50
MAX_COMPILE = 30
FOLDER_PART = re.compile(r"[\\:*?\"<>|\x00-\x1f]")


def clean_folder(raw: str) -> str | None:
    """A folder path people can read: "Finance/Claims/2026", no "..", at most 6 levels."""
    parts = [FOLDER_PART.sub(" ", p).strip()[:60] for p in str(raw or "").split("/")]
    parts = [p for p in parts if p and p not in (".", "..")]
    if not parts or len(parts) > 6:
        return None
    return "/".join(parts)[:300]


async def _list_folders(ctx: ToolContext, args: dict[str, Any]) -> str:
    under = clean_folder(str(args.get("under") or "")) or ""
    q = (
        select(DocFile.folder, func.count())
        .where(
            DocFile.workspace_id == ctx.workspace.id,
            service.agent_files(ctx.agent, _task_id(ctx)),
        )
        .group_by(DocFile.folder)
        .order_by(DocFile.folder)
    )
    if under:
        q = q.where(or_prefix(under))
    rows = (await ctx.db.execute(q.limit(200))).all()
    if not rows:
        return "No folders yet" + (f" under {under!r}." if under else ".")
    return "Folders (files in each):\n" + "\n".join(
        f"- {folder or '(top level)'}: {n}" for folder, n in rows
    )


def or_prefix(under: str) -> Any:
    return (DocFile.folder == under) | DocFile.folder.startswith(f"{under}/")


async def _file_document(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..services import audit

    folder = clean_folder(str(args.get("folder") or ""))
    if folder is None:
        return "Error: give the folder as a path, e.g. 'Finance/Claims/2026' (at most 6 levels)."
    raw = args.get("file_ids")
    ids = [str(x) for x in (raw if isinstance(raw, list) else [args.get("file_id")]) if x]
    if not ids:
        return "Error: give file_ids (from list_files or search_documents)."
    lines: list[str] = []
    moved = 0
    for fid in ids[:MAX_FILE_AT_ONCE]:
        f = await _file(ctx, fid)
        if f is None:
            lines.append(f"- [{fid}] not a file you may file (list_files shows yours).")
            continue
        if f.quarantined:
            lines.append(f"- [{fid}] " + HELD_BACK.format(name=f.name).removeprefix("Error: "))
            continue
        if f.folder == folder:
            lines.append(f"- [{f.id}] {f.name}: already in {folder}.")
            continue
        before = f.folder
        f.folder = folder
        await audit.record(
            ctx.db,
            ctx.workspace.id,
            f"agent:{ctx.agent.id}",
            "file.filed",
            target=f.id,
            before={"folder": before},
            after={"folder": folder, "task_id": ctx.task.id if ctx.task else None},
        )
        moved += 1
        lines.append(f"- [{f.id}] {f.name}: {before or 'top level'} -> {folder}")
    await ctx.db.commit()
    more = f" (only the first {MAX_FILE_AT_ONCE})" if len(ids) > MAX_FILE_AT_ONCE else ""
    return f"Filed {moved} file(s) into {folder}{more}:\n" + "\n".join(lines)


async def _compile_documents(ctx: ToolContext, args: dict[str, Any]) -> str:
    from pypdf import PdfReader, PdfWriter

    title = str(args.get("title") or "").strip()[:150]
    if not title:
        return "Error: give the compiled document a title."
    file_ids = [str(x) for x in (args.get("file_ids") or []) if x]
    doc_ids = [str(x) for x in (args.get("document_ids") or []) if x]
    if not file_ids and not doc_ids:
        return "Error: give file_ids and/or document_ids, in the order they should appear."
    if len(file_ids) + len(doc_ids) > MAX_COMPILE:
        return f"Error: at most {MAX_COMPILE} items in one document."
    lh = await service.letterhead(ctx.db, ctx.agent.branch_id)
    parts: list[tuple[str, bytes]] = []
    skipped: list[str] = []
    for kind, ref in [("file", i) for i in file_ids] + [("document", i) for i in doc_ids]:
        if kind == "file":
            f = await _file(ctx, ref)
            if f is None:
                skipped.append(f"[{ref}]: not a file you may read")
                continue
            label = f.title or f.name
            item = {"file_id": f.id, "label": label}
        else:
            d = await _doc(ctx, ref)
            if d is None:
                skipped.append(f"[{ref}]: not a document you may read")
                continue
            label = d.title
            item = {"document_id": d.id, "label": label}
        data, why = await packs.item_pdf(ctx.db, item, lh)
        if data is None:
            skipped.append(f"{label}: {why}")
        else:
            parts.append((label, data))
    if not parts:
        return "Error: nothing could be put in the document:\n" + "\n".join(skipped)

    # A contents page first, then every item in order.
    page, rows = 2, []
    for n, (label, data) in enumerate(parts, 1):
        count = len(PdfReader(io.BytesIO(data)).pages)
        rows.append(f"{n}. {label} (page {page})")
        page += count
    contents = render_pdf.render(
        f"# {title}\n\n## Contents\n\n" + "\n".join(rows), title, lh, numbered=False
    )
    writer = PdfWriter()
    for blob in [contents] + [d for _, d in parts]:
        for p in PdfReader(io.BytesIO(blob)).pages:
            writer.add_page(p)
    out = io.BytesIO()
    writer.write(out)
    data = out.getvalue()

    folder = clean_folder(str(args.get("folder") or "")) or await provenance.ai_folder(
        ctx.db, ctx.workspace.id, ctx.agent.branch_id, "custom"
    )
    name = re.sub(r"[^A-Za-z0-9 _.-]+", " ", title).strip()[:80] or "Compiled"
    f = await service.create_file(
        ctx.db,
        workspace_id=ctx.workspace.id,
        name=f"{name}.pdf",
        data=data,
        created_by=f"agent:{ctx.agent.id}",
        mime="application/pdf",
        branch_id=ctx.agent.branch_id,
        task_id=ctx.task.id if ctx.task else None,
        agent_id=ctx.agent.id,
        source="generated",
        status="ready",
        folder=folder,
    )
    f.kind, f.title = "compiled", title
    f.pages = len(PdfReader(io.BytesIO(data)).pages)
    f.summary = f"{len(parts)} item(s) compiled by {ctx.agent.name}."
    f.text = f"{title}\n\nContents:\n" + "\n".join(rows)
    await ctx.db.commit()
    left = ("\nLeft out:\n- " + "\n- ".join(skipped)) if skipped else ""
    return (
        f"Compiled {len(parts)} item(s) into [{f.id}] {f.name} ({f.pages} pages, folder "
        f"{folder}).{left}"
    )


_IDS = {"type": "array", "items": {"type": "string"}}

OFFICE_TOOLS = (
    Tool(
        "list_folders",
        "See the folders",
        "The company's file folders and how many files each holds, to file things where "
        "people already keep them. Optional `under` narrows to one branch of the tree.",
        {"type": "object", "properties": {"under": {"type": "string"}}},
        "low",
        "allow",
        _list_folders,
    ),
    Tool(
        "file_document",
        "File documents",
        "Move files into a folder, e.g. this month's receipts into 'Finance/Claims/2026-10'. "
        "Use list_folders first and follow the folders people already use. Each move is "
        "logged with where the file was, so a person can put it back.",
        {
            "type": "object",
            "properties": {
                "file_ids": {**_IDS, "description": "Files to file (ids from list_files)."},
                "folder": {"type": "string", "description": "e.g. 'HR/Staff files/Aina'"},
            },
            "required": ["file_ids", "folder"],
        },
        "low",
        "allow",
        _file_document,
    ),
    Tool(
        "compile_documents",
        "Compile into one PDF",
        "Put several files and drafts into one PDF with a contents page, in the order given: "
        "a claim with its receipts, a staff file, a month's invoices. PDFs are kept as they "
        "are, pictures become pages, other files are set as text.",
        {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "file_ids": _IDS,
                "document_ids": {**_IDS, "description": "Drafts from draft_document."},
                "folder": {"type": "string", "description": "Optional; else AI documents."},
            },
            "required": ["title"],
        },
        "low",
        "allow",
        _compile_documents,
    ),
)
