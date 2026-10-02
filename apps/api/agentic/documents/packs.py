"""Submission packs: a checklist of required items, matched to the company's files and
documents, then compiled into one PDF (cover, index with page numbers, every item, a page
stamp on every page). People review and submit the pack themselves."""

import io
import logging
import math
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from ..core.ids import new_id
from ..models import DocFile, Document, Pack, Workspace
from . import render_pdf, service
from .extract import sniff

log = logging.getLogger("agentic.documents")

MAX_ITEMS = 60
MATCH_MIN = 0.4  # matches are always shown as "please confirm"
ITEM_STATUS = ("missing", "ready", "waived")

DRAFT_SYSTEM = (
    "You list the documents a submission usually needs. Return ONLY JSON: "
    '{"items": [{"label": "...", "hint": "...", "required": true}]} with 4 to 20 items. '
    "label is the document's common name (e.g. Company registration certificate, Latest "
    "audited accounts, Bank statement (last 3 months), Quotation, Company profile, Cover "
    "letter); hint says what exactly is needed (e.g. certified true copy, signed and stamped). "
    "The person will confirm the list."
)


def clean_items(raw: Any, old: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    prior = {i.get("id"): i for i in old or []}
    out: list[dict[str, Any]] = []
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label") or "").strip()[:160]
        if not label:
            continue
        iid = str(it.get("id") or "") or new_id("pi")
        status = str(it.get("status") or "missing")
        item = {
            "id": iid[:40],
            "label": label,
            "hint": str(it.get("hint") or "").strip()[:300],
            "required": bool(it.get("required", True)),
            "file_id": (str(it["file_id"])[:40] if it.get("file_id") else None),
            "document_id": (str(it["document_id"])[:40] if it.get("document_id") else None),
            "status": status if status in ITEM_STATUS else "missing",
            "note": str(it.get("note") or "")[:300],
            "auto": bool(it.get("auto", prior.get(iid, {}).get("auto", False))),
        }
        if item["status"] != "waived":
            item["status"] = "ready" if (item["file_id"] or item["document_id"]) else "missing"
        out.append(item)
    return out[:MAX_ITEMS]


def progress(items: list[dict[str, Any]]) -> dict[str, int]:
    need = [i for i in items if i.get("required") and i.get("status") != "waived"]
    done = [i for i in need if i.get("status") == "ready"]
    return {
        "total": len(items),
        "required": len(need),
        "ready": sum(1 for i in items if i.get("status") == "ready"),
        "missing": len(need) - len(done),
    }


async def draft_checklist(
    db: AsyncSession, workspace_id: str, description: str
) -> list[dict[str, Any]]:
    from ..engine import gateway

    r = await gateway.chat(
        db,
        workspace_id,
        "smart",
        [
            {"role": "system", "content": DRAFT_SYSTEM},
            {"role": "user", "content": f"The submission:\n{description.strip()}"},
        ],
        task="pack.draft",
        max_tokens=2500,
        temperature=0.2,
        json_mode=True,
    )
    data = service.loads_obj(r.content or "") or {}
    return clean_items(data.get("items"))


# ---------------------------------------------------------------- matching

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "of", "a", "an", "and", "or", "for", "copy", "latest", "to", "in", "on", "last"}


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w


def _words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


async def candidates(db: AsyncSession, pack: Pack) -> list[dict[str, Any]]:
    """The company's ready files and documents an item could use."""
    out: list[dict[str, Any]] = []
    fq = select(DocFile).where(
        DocFile.workspace_id == pack.workspace_id,
        DocFile.status == "ready",
        DocFile.source == "upload",
    )
    dq = select(Document).where(Document.workspace_id == pack.workspace_id)
    if pack.branch_id:
        fq = fq.where((DocFile.branch_id == pack.branch_id) | (DocFile.branch_id.is_(None)))
        dq = dq.where(Document.branch_id == pack.branch_id)
    for f in (await db.scalars(fq.order_by(DocFile.created_at.desc()).limit(300))).all():
        out.append(
            {
                "kind": "file",
                "id": f.id,
                "name": f.name,
                "text": f"{f.kind} {f.title} {f.name} {f.summary}",
                "expires_on": f.expires_on,
            }
        )
    for d in (await db.scalars(dq.order_by(Document.updated_at.desc()).limit(200))).all():
        out.append(
            {
                "kind": "document",
                "id": d.id,
                "name": d.title,
                "text": f"{d.kind} {d.title}",
                "status": d.status,
            }
        )
    return out


async def auto_match(db: AsyncSession, pack: Pack) -> tuple[list[dict[str, Any]], int]:
    """Fill missing items with the best-matching file or document. Matches are marked auto
    so people confirm them; items people filled by hand are never changed."""
    from ..brain import embed

    items = [dict(i) for i in pack.items or []]
    cands = await candidates(db, pack)
    used = {i.get("file_id") for i in items} | {i.get("document_id") for i in items}
    cands = [c for c in cands if c["id"] not in used]
    todo = [i for i in items if i.get("status") == "missing"]
    if not todo or not cands:
        return items, 0
    # Judge on the label and on label + hint, keeping the better: a long hint (often written
    # by the AI checklist) must not drown the label's meaning.
    n = len(todo)
    texts = [i["label"] for i in todo] + [f"{i['label']} {i.get('hint', '')}" for i in todo]
    vecs = await embed.embed(texts + [c["text"] for c in cands])
    scores: list[tuple[float, int, int]] = []
    for ti, it in enumerate(todo):
        iw = _words(it["label"])
        for ci, c in enumerate(cands):
            lex = len(iw & _words(c["text"])) / max(1, len(iw))
            sem = 0.0
            if vecs:
                cv = vecs[2 * n + ci]
                sem = max(_cos(vecs[ti], cv), _cos(vecs[n + ti], cv))
            scores.append((0.6 * sem + 0.4 * lex, ti, ci))
    # Best first; on a tie the newer candidate (lower index) wins.
    scores.sort(key=lambda x: (-x[0], x[1], x[2]))
    taken_i: set[int] = set()
    taken_c: set[int] = set()
    matched = 0
    for score, ti, ci in scores:
        if score < MATCH_MIN or ti in taken_i or ci in taken_c:
            continue
        taken_i.add(ti)
        taken_c.add(ci)
        it, c = todo[ti], cands[ci]
        it[f"{c['kind']}_id"] = c["id"]
        it["status"] = "ready"
        it["auto"] = True
        note = f"Matched {c['name']} ({score:.0%} sure) — please confirm."
        if c.get("expires_on") and c["expires_on"] < datetime.now(UTC).date():
            note = f"Matched {c['name']}, but it EXPIRED on {c['expires_on']:%d %b %Y}."
        it["note"] = note
        matched += 1
    return items, matched


# ---------------------------------------------------------------- compiling


def _pages(data: bytes) -> int:
    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(data)).pages)


def _image_pdf(label: str, data: bytes, lh: render_pdf.Letterhead | None) -> bytes:
    from PIL import Image, ImageOps

    pdf = render_pdf.new_pdf(label, None, numbered=False)
    pdf.add_page()
    pdf.font(11, "B")
    pdf.cell(0, 6, pdf.t(label), new_x="LMARGIN", new_y="NEXT")
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    max_w, max_h = pdf.w - pdf.l_margin - pdf.r_margin, pdf.h - pdf.get_y() - 24
    ratio = min(max_w / img.width, max_h / img.height)
    w, h = img.width * ratio, img.height * ratio
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    pdf.image(
        io.BytesIO(buf.getvalue()), x=pdf.l_margin + (max_w - w) / 2, y=pdf.get_y() + 3, w=w, h=h
    )
    return bytes(pdf.output())


async def item_pdf(
    db: AsyncSession, item: dict[str, Any], lh: render_pdf.Letterhead | None
) -> tuple[bytes | None, str]:
    """One checklist item as PDF bytes, or (None, why not)."""
    if item.get("document_id"):
        d = await db.get(Document, item["document_id"])
        if d is None:
            return None, "the document was deleted"
        data, _, _ = await service.export(db, d, "pdf", numbered=False)
        return data, ""
    if item.get("file_id"):
        f = await db.scalar(
            select(DocFile)
            .where(DocFile.id == item["file_id"])
            .options(undefer(DocFile.data), undefer(DocFile.text))
        )
        if f is None:
            return None, "the file was deleted"
        raw = bytes(f.data)
        kind = sniff(raw, f.name, f.mime)
        if kind == "pdf":
            try:
                _pages(raw)
                return raw, ""
            except Exception:  # noqa: BLE001 - a damaged or locked PDF is reported
                return None, "the PDF is damaged or password-protected"
        if kind == "image":
            return _image_pdf(item["label"], raw, lh), ""
        if f.text.strip():
            md = f"# {item['label']}\n\n_From {f.name}_\n\n{f.text}"
            return render_pdf.render(md, item["label"], lh, numbered=False), ""
        return None, "this kind of file cannot be put in a PDF"
    return None, "nothing attached"


def _cover(
    pack: Pack,
    kit: dict[str, Any],
    rows: list[tuple[str, str, str]],
    when: str,
    lh: render_pdf.Letterhead | None,
) -> bytes:
    pdf = render_pdf.new_pdf(pack.title, lh, numbered=False)
    pdf.add_page()
    pdf.ln(24)
    pdf.font(22, "B")
    pdf.multi_cell(0, 10, pdf.t(pack.title), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.font(11)
    pdf.set_text_color(90, 90, 90)
    who = str(kit.get("legal_name") or "")
    if kit.get("reg_no"):
        who += f" ({kit['reg_no']})"
    for line in (who, f"Prepared {when}"):
        if line.strip():
            pdf.multi_cell(0, 6, pdf.t(line), new_x="LMARGIN", new_y="NEXT")
    if pack.description:
        pdf.ln(3)
        pdf.multi_cell(0, 5.5, pdf.t(pack.description[:900]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(25, 25, 25)
    pdf.ln(8)
    pdf.font(13, "B")
    pdf.cell(0, 7, "Contents", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    with pdf.table(
        col_widths=(10, 110, 28),
        text_align=("LEFT", "LEFT", "RIGHT"),
        line_height=5.2,
        padding=1.6,
        borders_layout="SINGLE_TOP_LINE",
        first_row_as_headings=True,
    ) as table:
        head = table.row()
        for h in ("No.", "Item", "Pages"):
            head.cell(h)
        for n, label, pages in rows:
            r = table.row()
            r.cell(n)
            r.cell(pdf.t(label))
            r.cell(pages)
    return bytes(pdf.output())


def _stamp(data: bytes, title: str) -> bytes:
    """'Title · Page n of N' at the foot of every page, whatever its size."""
    from fpdf import FPDF
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(data))
    total = len(reader.pages)
    over = FPDF(unit="pt")
    over.set_auto_page_break(False)
    fonts = render_pdf._fonts()  # noqa: SLF001 - same font as the documents
    if fonts:
        over.add_font("body", "", fonts[0])
        over.set_font("body", "", 7)
    else:
        over.set_font("helvetica", "", 7)
    for i, page in enumerate(reader.pages, 1):
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        over.add_page(format=(w, h))
        over.set_text_color(120, 120, 120)
        over.set_xy(0, h - 16)
        label = f"{title[:70]}  ·  Page {i} of {total}"
        if not fonts:
            label = label.replace("·", "-").encode("latin-1", "replace").decode("latin-1")
        over.cell(w - 24, 8, label, align="R")
    stamps = PdfReader(io.BytesIO(bytes(over.output())))
    writer = PdfWriter(clone_from=io.BytesIO(data))
    for page, stamp in zip(writer.pages, stamps.pages, strict=True):
        page.merge_page(stamp)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


async def compile_pack(db: AsyncSession, pack: Pack, actor: str) -> tuple[DocFile, list[str]]:
    """Build the pack PDF and store it as a generated file. Returns it and what was left out."""
    from pypdf import PdfReader, PdfWriter

    lh = await service.letterhead(db, pack.branch_id)
    kit = await service.kit_data(db, pack.branch_id)
    ws = await db.get(Workspace, pack.workspace_id)
    when = f"{service.today_in(ws.timezone if ws else None):%d %B %Y}"
    parts: list[tuple[dict[str, Any], bytes]] = []
    skipped: list[str] = []
    for it in pack.items or []:
        if it.get("status") == "waived":
            continue
        data, why = await item_pdf(db, it, lh)
        if data is None:
            if it.get("required"):
                skipped.append(f"{it['label']}: {why}")
            continue
        parts.append((it, data))
    if not parts:
        raise ValueError("Nothing to compile yet: attach at least one item.")

    def rows(offset: int) -> list[tuple[str, str, str]]:
        out, page = [], offset + 1
        for n, (it, data) in enumerate(parts, 1):
            count = _pages(data)
            span = f"{page}" if count == 1 else f"{page}–{page + count - 1}"
            out.append((str(n), it["label"], span))
            page += count
        return out

    # The cover's own length decides where item 1 starts; lay it out twice to get it right.
    draft = _cover(pack, kit, rows(1), when, lh)
    cover = _cover(pack, kit, rows(_pages(draft)), when, lh)
    writer = PdfWriter()
    for blob in [cover] + [d for _, d in parts]:
        for page in PdfReader(io.BytesIO(blob)).pages:
            writer.add_page(page)
    merged = io.BytesIO()
    writer.write(merged)
    final = _stamp(merged.getvalue(), pack.title)

    index = "\n".join(f"{n}. {label} (page {p})" for n, label, p in rows(_pages(cover)))
    name = re.sub(r"[^A-Za-z0-9]+", "-", pack.title).strip("-")[:60] or "pack"
    f = await service.create_file(
        db,
        workspace_id=pack.workspace_id,
        name=f"{name}.pdf",
        data=final,
        created_by=actor,
        mime="application/pdf",
        branch_id=pack.branch_id,
        task_id=pack.task_id,
        source="generated",
        status="ready",
    )
    f.kind, f.title, f.pages = "submission pack", pack.title, _pages(final)
    f.summary = f"Compiled pack of {len(parts)} item(s)." + (
        f" Left out: {len(skipped)}." if skipped else ""
    )
    f.text = f"{pack.title}\n\nContents:\n{index}"
    pack.compiled_file_id = f.id
    pack.compiled_at = datetime.now(UTC)
    pack.status = "compiled"
    return f, skipped


def pack_brief(pack: Pack) -> str:
    """The pack as text for an agent: what is ready and what is still missing."""
    lines = [f"Pack {pack.id}: {pack.title}"]
    if pack.description:
        lines.append(pack.description)
    for it in pack.items or []:
        mark = {"ready": "✓", "waived": "–"}.get(it.get("status", ""), "✗")
        att = it.get("file_id") or it.get("document_id") or ""
        lines.append(
            f"{mark} [{it['id']}] {it['label']}"
            + (f" — {it['hint']}" if it.get("hint") else "")
            + (f" — attached {att}" if att else "")
            + ("" if it.get("required", True) else " (optional)")
        )
    p = progress(pack.items or [])
    lines.append(f"{p['ready']} ready, {p['missing']} required item(s) missing.")
    return "\n".join(lines)
