"""P27: agents fill in company forms (claims, monthly records, requests) the way a person
would: read the form's layout, then write the values into a copy. The filled copy is kept
with the company's files and, when a person asked for it, waits as their draft to check and
hand in (agentic/api/routers/forms.py). Nothing is sent or handed in by the agent.
"""

import asyncio
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import undefer

from ..documents import provenance
from ..documents import service as doc_service
from ..forms import describe, describe_schedule, fill, is_excel, store
from ..models import DocFile, Form, Task
from .tools import Tool, ToolContext


async def _form(ctx: ToolContext, form_id: str) -> Form | str:
    f = await ctx.db.get(Form, str(form_id or "").strip())
    if f is None or f.workspace_id != ctx.workspace.id or f.status != "active":
        return "Error: no such form. The task names the form id."
    if f.branch_id and f.branch_id != ctx.agent.branch_id:
        return "Error: that form belongs to another company."
    return f


async def _blank(ctx: ToolContext, f: Form) -> DocFile | None:
    if not f.file_id:
        return None
    return await ctx.db.scalar(
        select(DocFile).where(DocFile.id == f.file_id).options(undefer(DocFile.data))
    )


async def _describe_form(ctx: ToolContext, args: dict[str, Any]) -> str:
    f = await _form(ctx, args.get("form_id", ""))
    if isinstance(f, str):
        return f
    blank = await _blank(ctx, f)
    head = f"Form {f.name!r} ({f.kind}), due {describe_schedule(f.schedule)}.\n" + (
        f"How to fill it: {f.guide}\n" if f.guide else ""
    )
    if blank is None:
        return head + "It has no file; answer in text."
    if not is_excel(blank.name):
        return (
            head + f"The blank is {blank.name!r} (not Excel): read it with read_file file_id="
            f"'{blank.id}' and prepare the filled version as a document (draft_document)."
        )
    try:  # P29: off the event loop (a big sheet takes a while), and refused when too big
        return head + await asyncio.to_thread(describe, bytes(blank.data))
    except Exception as e:  # noqa: BLE001 - a broken or oversized workbook
        return head + f"Error: could not read the form ({e.__class__.__name__}: {str(e)[:200]})."


async def _fill_form(ctx: ToolContext, args: dict[str, Any]) -> str:
    f = await _form(ctx, args.get("form_id", ""))
    if isinstance(f, str):
        return f
    blank = await _blank(ctx, f)
    if blank is None or not is_excel(blank.name):
        return "Error: this form is not an Excel file; prepare it with draft_document instead."
    raw_cells, raw_fields, raw_rows = args.get("cells"), args.get("fields"), args.get("rows")
    cells: dict[str, Any] = raw_cells if isinstance(raw_cells, dict) else {}
    fields: dict[str, Any] = raw_fields if isinstance(raw_fields, dict) else {}
    rows: list[dict[str, Any]] = [
        r for r in (raw_rows if isinstance(raw_rows, list) else []) if isinstance(r, dict)
    ][:300]
    if not (cells or fields or rows):
        return "Error: give cells, fields or rows to write."
    try:
        data, report = await asyncio.to_thread(
            lambda: fill(
                bytes(blank.data), cells=cells, fields=fields, rows=rows, sheet=args.get("sheet")
            )
        )
    except Exception as e:  # noqa: BLE001 - a broken workbook or a bad value
        return f"Error: could not fill the form ({e.__class__.__name__}: {str(e)[:200]})."

    # Whose form it is: the person who asked (the task's root), else nobody in particular.
    person: str | None = None
    if ctx.task is not None:
        root = await ctx.db.get(Task, ctx.task.root_task_id) if ctx.task.root_task_id else ctx.task
        if root is not None and root.created_by.startswith("user:"):
            person = root.created_by[5:]
    stem = blank.name.rsplit(".", 1)[0]
    label = str(args.get("file_name") or "").strip()
    name = f"{label or stem}.xlsx" if not (label or stem).lower().endswith(".xlsx") else label
    folder = await provenance.ai_folder(
        ctx.db, ctx.workspace.id, ctx.agent.branch_id, "file", f.name
    )
    out = await doc_service.create_file(
        ctx.db,
        workspace_id=ctx.workspace.id,
        name=name,
        data=data,
        created_by=f"agent:{ctx.agent.id}",
        branch_id=f.branch_id or ctx.agent.branch_id,
        task_id=ctx.task.id if ctx.task else None,
        agent_id=ctx.agent.id,
        source="generated",
        status="ready",
        folder=folder,
    )
    out.kind = "form"
    out.summary = f"{f.name}, filled by {ctx.agent.name}."
    draft = ""
    if person:
        today = await store.today_in(ctx.db, ctx.workspace.id)
        period = await store.person_round(ctx.db, f, person, today)
        s = await store.upsert(ctx.db, f, person, f.branch_id or ctx.agent.branch_id, period)
        if s.status in ("draft", "returned"):
            s.file_ids = [out.id, *[i for i in (s.file_ids or []) if i != out.id]][:20]
            s.made_by = "agent"
            s.status = "draft"
            s.task_id = ctx.task.id if ctx.task else s.task_id
            draft = f" It waits as their draft for {period}: they check it and hand it in."
        else:
            draft = f" ({period} was already handed in, so it is not their draft.)"
    await ctx.db.commit()
    return f"Filled {f.name!r}: file [{out.id}] {out.name}.{draft}\n" + "\n".join(
        f"- {line}" for line in report[:60]
    )


FORM_TOOLS = (
    Tool(
        "describe_form",
        "Read a company form",
        "See a company form's layout before filling it: its sheets, the label of every filled "
        "cell by reference (e.g. B5 'NAMA PENGAWAL'), table headers and merged areas, plus "
        "when it is due and how to fill it.",
        {
            "type": "object",
            "properties": {"form_id": {"type": "string", "description": "The form's id"}},
            "required": ["form_id"],
        },
        "low",
        "allow",
        _describe_form,
    ),
    Tool(
        "fill_form",
        "Fill in a company form",
        "Write values into a copy of a company Excel form, keeping its layout and formulas. "
        "Give any of: cells {'D12': 2, 'Sheet1!C5': 'Ahmad'}; fields {'Nama': 'Ahmad'} (written "
        "in the first empty cell right of that label); rows [{'Tarikh': '2026-10-03', "
        "'Perkara': 'Grab', 'Jumlah (RM)': 23.5}] (written under the header row with those "
        "column names). Amounts like 'RM1,234.50' are stored as numbers. The copy is saved "
        "with the company's files and, when a person asked, waits as their draft to check "
        "and hand in. Call describe_form first.",
        {
            "type": "object",
            "properties": {
                "form_id": {"type": "string"},
                "cells": {"type": "object", "description": "Cell reference -> value"},
                "fields": {"type": "object", "description": "Label -> value"},
                "rows": {"type": "array", "items": {"type": "object"}},
                "sheet": {"type": "string", "description": "Sheet for fields and rows"},
                "file_name": {"type": "string", "description": "Name for the filled copy"},
            },
            "required": ["form_id"],
        },
        "low",
        "allow",
        _fill_form,
    ),
)
