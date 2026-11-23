"""P127: the organization chart kept in step with Prima, and downloaded as Excel or PDF.

Fitri (23 Nov 2026): "make sure the organization and hierarchy things sync with agentic side
... and then give me the pdf/excel for this hierarchy so I can view".

- GET  /api/org-chart/prima-sync: the last sync with Prima's org chart and the people who are
  not in step (members.manage: owners, admins, management, HR).
- POST /api/org-chart/prima-sync: "Sync with Prima" now (prima/org_sync.py). It applies no
  choice of its own: it only aligns lines already applied on either side, so it is not held for
  approval (outside org/held.py's prefixes on purpose).
- GET  /api/org-chart/export.xlsx and export.pdf: the chart as the reader sees it (the members
  router's _Chart: their own part in full, everyone else by name, job title, company and
  department only). Every download is in the audit log.
"""

from datetime import datetime
from io import BytesIO
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...i18n import tr
from ...models import PrimaLink, Workspace
from ...org import hierarchy as org_chart
from ...prima import client as prima_client
from ...prima import org_sync
from ...services import audit
from ..deps import Principal, api_error, require
from .members import _Chart

router = APIRouter(prefix="/api/org-chart", tags=["org-chart"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
INDENT_MM = 6.0
MAX_INDENT = 14
COLUMNS = (
    "name", "job_title", "company", "also", "department", "reports_to", "level_shown", "direct",
    "prima_linked", "prima_line", "prima_how",
)  # fmt: skip


@router.get("/prima-sync")
async def prima_sync_status(
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await org_sync.status(db, principal.workspace_id)


@router.post("/prima-sync")
async def prima_sync_now(
    principal: Principal = Depends(require("members.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not prima_client.enabled(principal.workspace_id):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "prima_off", "Prima is not set up on this server."
        )
    run = await org_sync.sync(db, principal.workspace_id)
    out = await org_sync.status(db, principal.workspace_id)
    out["running"] = run is None  # another run held the lock: the last result
    return out


# ---------------------------------------------------------------- the downloads

HOW_LABEL = {
    "set": "Set by a head in Prima",
    "standard": "From the job in Prima",
    "assumed": "Assumed (Chief of Staff)",
    "top": "Top of the group",
}


def _how(how: str) -> str:
    return tr(HOW_LABEL[how]) if how in HOW_LABEL else ""


async def _rows(db: AsyncSession, principal: Principal) -> tuple[list[dict[str, Any]], str, str]:
    """The people the reader may see, in tree order (each manager before their people), with
    the workspace name and today's date in its time zone."""
    ws = await db.get(Workspace, principal.workspace_id)
    assert ws is not None
    chart = await _Chart.load(db, principal.workspace_id)
    full, limited = chart.visible(principal)
    shown = full | limited
    parent = {
        uid: (boss if boss in shown and boss != uid else None)
        for uid, boss in chart.parent.items()
        if uid in shown
    }
    kids = org_chart.children_of(parent)
    linked = set(
        (
            await db.scalars(
                select(PrimaLink.user_id).where(PrimaLink.workspace_id == principal.workspace_id)
            )
        ).all()
    )
    prima = await org_sync.prima_lines(db, principal.workspace_id)
    names = chart.names

    def key(uid: str) -> tuple[str, str]:
        return ((chart.by[uid].user.name or "").lower(), uid)

    order: list[tuple[str, int]] = []
    seen: set[str] = set()

    def walk(uid: str, level: int) -> None:
        stack = [(uid, level)]
        while stack:
            cur, lv = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            order.append((cur, lv))
            for k in sorted(kids.get(cur, []), key=key, reverse=True):
                stack.append((k, lv + 1))

    for root in sorted((u for u in shown if parent.get(u) is None), key=key):
        walk(root, 1)
    for uid in sorted(shown - seen, key=key):  # a loop in old data: shown at the top
        walk(uid, 1)

    out: list[dict[str, Any]] = []
    for uid, level in order:
        m = chart.by[uid]
        lim = uid in limited
        boss = parent.get(uid)
        others = [names.get(b, "") for b in m.branch_ids if b != m.branch_id and names.get(b)]
        p_name, p_how = prima.get(uid, (None, ""))
        out.append(
            {
                "level": level,
                "limited": lim,
                "name": m.user.name or "",
                "job_title": m.job_title or "",
                "company": names.get(m.branch_id or "", ""),
                "also": "" if lim else ", ".join(others),
                "department": names.get(m.department_id or "", ""),
                "reports_to": "" if lim or not boss else (chart.by[boss].user.name or ""),
                "level_shown": "" if lim else level,
                "direct": "" if lim else len(kids.get(uid, [])),
                "prima_linked": ""
                if lim
                else (tr("yes") if uid in linked or uid in prima else tr("no")),
                "prima_line": "" if lim else (p_name or ""),
                "prima_how": "" if lim else _how(p_how),
            }
        )
    zone = ZoneInfo(ws.timezone or "Asia/Kuala_Lumpur")
    return out, ws.name or "", datetime.now(zone).strftime("%Y-%m-%d")


def _file_name(ws_name: str, day: str, ext: str) -> str:
    keep = "".join(ch if ch.isalnum() or ch in " -_" else " " for ch in ws_name).strip()
    stem = "-".join(keep.split())[:60] or "Organization"
    return f"Organization-chart-{stem}-{day}.{ext}"


async def _logged(db: AsyncSession, principal: Principal, kind: str, n: int) -> None:
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "org.chart_downloaded",
        after={"format": kind, "people": n},
    )
    await db.commit()


@router.get("/export.xlsx")
async def export_xlsx(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """One row per person the reader may see, managers before their people."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    rows, ws_name, day = await _rows(db, principal)
    head = [
        tr("Name"),
        tr("Job title"),
        tr("Company"),
        tr("Also works in"),
        tr("Department"),
        tr("Reports to"),
        tr("Level from top"),
        tr("Direct reports"),
        tr("Linked to Prima"),
        tr("Line in Prima"),
        tr("Where Prima's line comes from"),
    ]
    book = Workbook()
    sh = book.active
    assert sh is not None
    sh.title = tr("Organization chart")[:31]
    sh.append(head)
    for c in sh[1]:
        c.font = Font(bold=True)
    widths = [len(h) for h in head]
    for r in rows:
        line = [r[k] for k in COLUMNS]
        sh.append(line)
        cell = sh.cell(row=sh.max_row, column=1)
        cell.alignment = Alignment(indent=min(MAX_INDENT, r["level"] - 1))
        widths = [max(w, len(str(v))) for w, v in zip(widths, line, strict=True)]
    sh.freeze_panes = "B2"
    sh.auto_filter.ref = sh.dimensions
    for i, w in enumerate(widths, start=1):
        sh.column_dimensions[get_column_letter(i)].width = max(10, min(48, w + 3))
    sh.column_dimensions["A"].width = max(30, min(60, widths[0] + 8))
    buf = BytesIO()
    book.save(buf)
    await _logged(db, principal, "xlsx", len(rows))
    name = _file_name(ws_name, day, "xlsx")
    return Response(
        content=buf.getvalue(),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export.pdf")
async def export_pdf(
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Formal, black on white, landscape A4: the title and date, then the tree indented by
    level, page numbers at the foot."""
    from fpdf import FPDF

    from ...documents.render_pdf import _fonts

    rows, ws_name, day = await _rows(db, principal)
    title = tr("Organization chart")
    footer = tr("Page {n} of {total}", n="{n}", total="{nb}")

    class Doc(FPDF):
        def footer(self) -> None:
            self.set_y(-12)
            self.set_font(family, "", 8)
            self.set_text_color(0, 0, 0)
            self.cell(0, 6, txt(footer.replace("{n}", str(self.page_no()))), align="C")

    pdf = Doc(orientation="L", format="A4", unit="mm")
    fonts = _fonts()
    if fonts:
        for style, path in zip(("", "B", "I", "BI"), fonts, strict=True):
            pdf.add_font("body", style, path)
        family = "body"
    else:
        family = "helvetica"

    def txt(s: str) -> str:
        if fonts:
            return s
        return s.replace("·", "-").replace("—", "-").encode("latin-1", "replace").decode("latin-1")

    pdf.set_title(title)
    pdf.alias_nb_pages()
    pdf.set_margins(14, 14, 14)
    pdf.set_auto_page_break(True, margin=16)
    pdf.add_page()
    pdf.set_text_color(0, 0, 0)
    pdf.set_draw_color(0, 0, 0)
    pdf.set_font(family, "B", 16)
    pdf.cell(0, 9, txt(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(family, "", 10)
    sub = " · ".join(x for x in (ws_name, tr("As at {date}", date=day)) if x)
    pdf.cell(0, 6, txt(sub), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, txt(tr("{n} people", n=len(rows))), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(3)
    width = pdf.w - pdf.l_margin - pdf.r_margin
    for r in rows:
        indent = min(MAX_INDENT, r["level"] - 1) * INDENT_MM
        pdf.set_x(pdf.l_margin + indent)
        parts = [r["job_title"], r["company"], r["department"]]
        if not r["limited"] and r["direct"]:
            parts.append(tr("{n} report directly", n=r["direct"]))
        detail = " · ".join(p for p in parts if p)
        pdf.set_font(family, "B", 9.5)
        name = r["name"]
        name_w = min(pdf.get_string_width(txt(name)) + 2, width - indent)
        pdf.cell(name_w, 5.5, txt(name))
        pdf.set_font(family, "", 9)
        rest = width - indent - name_w
        if detail and rest > 10:
            pdf.multi_cell(rest, 5.5, txt("  " + detail), new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.ln(5.5)
    data = bytes(pdf.output())
    await _logged(db, principal, "pdf", len(rows))
    name = _file_name(ws_name, day, "pdf")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
