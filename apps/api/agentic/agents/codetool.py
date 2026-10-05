"""The run_python agent tool (P13): send code to the isolated sandbox service and get back its
output and any files it produced.

The sandbox has no internet and no access to the office's data, so the code can only work on
what the agent passes in (plain text, or input files by id) and return text plus files it writes
to ./out. Files it produces are saved as generated office files the person can download. The
tool is off unless AGENTIC_SANDBOX_URL is set; it is approval-gated (running code is powerful,
even in a box)."""

import base64
import logging
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import undefer

from ..core.config import settings
from ..documents import service as doc_service
from ..models import DocFile
from .tools import ToolContext

log = logging.getLogger("agentic.codetool")

MAX_IN_FILES = 10
PREVIEW = 6000


async def run_python(ctx: ToolContext, args: dict[str, Any]) -> str:
    if not settings.sandbox_url:
        return "Error: the code sandbox is not set up for this office."
    code = str(args.get("code", "")).strip()
    if not code:
        return "Error: give the Python code to run."

    files_in = []
    for fid in (args.get("file_ids") or [])[:MAX_IN_FILES]:
        f = await ctx.db.scalar(
            select(DocFile).where(DocFile.id == str(fid)).options(undefer(DocFile.data))
        )
        if f is None or f.workspace_id != ctx.workspace.id:
            return f"Error: no such file {fid!r} for you."
        if f.quarantined:  # P24: held back for review (passwords or personal data)
            return f"Error: file {fid!r} is held back for review; a person must release it."
        files_in.append({"name": f.name, "b64": base64.b64encode(bytes(f.data)).decode()})

    payload = {"code": code, "files": files_in, "stdin": str(args.get("stdin") or "")}
    try:
        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.post(
                f"{settings.sandbox_url.rstrip('/')}/run",
                json=payload,
                headers={"X-Sandbox-Token": settings.sandbox_token},
            )
    except httpx.HTTPError as e:
        return f"Error: could not reach the code sandbox ({e.__class__.__name__})."
    if r.status_code != 200:
        return f"Error: the sandbox refused the run ({r.status_code}: {r.text[:200]})."
    data = r.json()

    saved = []
    for out in data.get("files") or []:
        try:
            blob = base64.b64decode(out["b64"])
        except (ValueError, KeyError):
            continue
        f = await doc_service.create_file(
            ctx.db,
            workspace_id=ctx.workspace.id,
            name=out["name"],
            data=blob,
            created_by=f"agent:{ctx.agent.id}",
            branch_id=ctx.agent.branch_id,
            task_id=ctx.task.id if ctx.task else None,
            source="generated",
            status="ready",
        )
        f.summary = "Produced by run_python."
        saved.append(f)
    if saved:
        await ctx.db.commit()

    parts = []
    stdout = (data.get("stdout") or "").strip()
    stderr = (data.get("stderr") or "").strip()
    exit_code = data.get("exit_code")
    if data.get("timed_out"):
        parts.append("The code ran out of time and was stopped.")
    elif isinstance(exit_code, int) and exit_code < 0:
        parts.append("The code was stopped (it used too much CPU or memory).")
    parts.append(f"Exit code: {exit_code}")
    if stdout:
        parts.append(f"Output:\n{stdout[:PREVIEW]}")
    if stderr:
        parts.append(f"Errors:\n{stderr[:PREVIEW]}")
    if saved:
        parts.append(
            "Files produced (saved to the office, downloadable): "
            + ", ".join(f"[{f.id}] {f.name}" for f in saved)
        )
    if not stdout and not stderr and not saved:
        parts.append("No output. Remember to print() results or write files to the ./out folder.")
    return "\n\n".join(parts)
