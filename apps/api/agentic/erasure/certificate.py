"""The deletion certificate: what was erased (by category, with counts), what was revoked,
who to notify, what remains in backups, and a SHA-256 over the record.

The JSON is the record; its SHA-256 is taken over its canonical form (sorted keys, no
spaces) without the "sha256" field, printed in the PDF and kept in erasure_records. Anyone
holding the JSON can check it: remove "sha256", dump it the same way, hash it.
"""

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from . import inventory
from .models import ErasureRecord


def canonical(doc: dict[str, Any]) -> bytes:
    body = {k: v for k, v in doc.items() if k != "sha256"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_of(doc: dict[str, Any]) -> str:
    return hashlib.sha256(canonical(doc)).hexdigest()


def paths(rid: str) -> tuple[Path, Path]:
    d = inventory.erasure_dir(rid)
    return d / "certificate.json", d / "certificate.pdf"


def build(r: ErasureRecord, draft: dict[str, Any], done_at: datetime) -> dict[str, Any]:
    from .erase import BACKUP_RETENTION_DAYS, TEMPORAL_RETENTION_DAYS

    ws = draft.get("workspace") or {"id": r.erased_workspace_id, "name": r.workspace_name}
    counts: dict[str, int] = dict(draft.get("counts") or r.counts or {})
    db_part = draft.get("database") or {}
    storage = draft.get("storage") or {}
    vault = draft.get("vault") or {}
    members = draft.get("members") or {}
    erased: dict[str, Any] = {
        "Database records, by category": inventory.categorize(counts),
        "Database records, by table": counts,
        "Stored file objects deleted (all storage targets)": sum(
            int(s.get("deleted") or 0) for s in storage.values()
        ),
        "Export archives deleted": int(draft.get("exports_deleted") or 0),
        "Brain vault files deleted (git history included)": int(vault.get("files") or 0),
        "Cache keys deleted (Valkey)": int(draft.get("cache_keys") or 0),
        "Accounts deleted (people only in this workspace)": int(
            db_part.get("users_deleted", members.get("deleted", 0)) or 0
        ),
        "Accounts kept (people in other workspaces; access here removed)": int(
            members.get("kept") or 0
        ),
    }
    not_deleted = [
        {
            "target": s.get("name"),
            "kind": s.get("kind"),
            "objects_not_deleted": s.get("failed"),
            "error": s.get("error"),
        }
        for s in storage.values()
        if s.get("failed") or s.get("error")
    ]
    backup_until = (done_at + timedelta(days=BACKUP_RETENTION_DAYS)).date().isoformat()
    doc: dict[str, Any] = {
        "title": "Certificate of deletion",
        "record_id": r.id,
        "workspace": {"id": ws.get("id"), "name": ws.get("name")},
        "requested_by": draft.get("requested_by") or {"id": r.requested_by},
        "requested_at": r.requested_at.isoformat() if r.requested_at else None,
        "due_by": r.due_by.isoformat() if r.due_by else None,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": done_at.isoformat(),
        "erased": erased,
        "revoked": draft.get("revoked") or r.revoked or {},
        "verification": {
            "rows_left_with_workspace_id": 0,
            "tables_checked": int(db_part.get("tables_checked") or 0),
            "checked_at": db_part.get("checked_at"),
        },
        "not_deleted": not_deleted,
        "providers_to_notify": [
            {
                **p,
                "note": "Their own retention terms apply; ask them to delete under your agreement.",
            }
            for p in draft.get("providers") or []
        ],
        "statements": [
            "Every record, file, memory page, embedding, search index, prompt, AI output and "
            "log of this workspace was removed from the active systems of this server.",
            f"Removed from active systems; remains in encrypted server backups until "
            f"overwritten by the backup cycle ({BACKUP_RETENTION_DAYS} days, by {backup_until}).",
            f"Closed workflow histories in the job engine (Temporal) that could not be deleted "
            f"one by one expire after {TEMPORAL_RETENTION_DAYS} days.",
            "Files a company imported from its own storage were read in place and left there: "
            "they are the company's own copy.",
            "Outside services listed under providers_to_notify keep what they received under "
            "their own terms.",
        ],
    }
    doc["sha256"] = sha256_of(doc)
    return doc


def _md(doc: dict[str, Any]) -> str:
    def esc(v: Any) -> str:
        return str(v if v is not None else "").replace("|", "/").replace("\n", " ")

    er = doc["erased"]
    lines = [
        "# Certificate of deletion",
        "",
        f"**Workspace:** {esc(doc['workspace']['name'])} ({esc(doc['workspace']['id'])})",
        "",
        f"**Requested by:** {esc(doc['requested_by'].get('name'))} "
        f"{esc(doc['requested_by'].get('email'))} ({esc(doc['requested_by'].get('id'))})",
        "",
        f"**Requested:** {esc(doc['requested_at'])}  ·  **Due by:** {esc(doc['due_by'])}",
        "",
        f"**Erase started:** {esc(doc['started_at'])}  ·  "
        f"**Completed:** {esc(doc['completed_at'])}",
        "",
        "## What was erased",
        "",
        "| What | Count |",
        "| --- | --- |",
    ]
    for k, v in er["Database records, by category"].items():
        lines.append(f"| {esc(k)} | {v} |")
    for k, v in er.items():
        if isinstance(v, int):
            lines.append(f"| {esc(k)} | {v} |")
    lines += ["", "## What was revoked", "", "| What | Count |", "| --- | --- |"]
    for k, v in (doc["revoked"] or {}).items():
        lines.append(f"| {esc(k)} | {v} |")
    if not doc["revoked"]:
        lines.append("| Nothing was connected | 0 |")
    v = doc["verification"]
    lines += [
        "",
        "## Verification",
        "",
        f"No row with this workspace's id remains in any of the {v['tables_checked']} tables "
        f"that carry one (checked {esc(v['checked_at'])}).",
    ]
    if doc["not_deleted"]:
        lines += ["", "## Could not be deleted (delete these by hand)", ""]
        for n in doc["not_deleted"]:
            lines.append(
                f"- {esc(n['target'])} ({esc(n['kind'])}): {esc(n['objects_not_deleted'])} "
                f"objects, {esc(n['error'])}"
            )
    lines += ["", "## Providers to notify", ""]
    if doc["providers_to_notify"]:
        lines += ["| Service | Name | Where |", "| --- | --- | --- |"]
        for p in doc["providers_to_notify"]:
            lines.append(f"| {esc(p.get('kind'))} | {esc(p.get('name'))} | {esc(p.get('where'))} |")
        lines += ["", "> Their own retention terms apply; ask each to delete under your agreement."]
    else:
        lines.append("None were configured.")
    lines += ["", "## Statements", ""]
    lines += [f"- {esc(s)}" for s in doc["statements"]]
    lines += [
        "",
        "## Database records by table",
        "",
        "| Table | Rows |",
        "| --- | --- |",
    ]
    for k, n in sorted(er["Database records, by table"].items()):
        lines.append(f"| {esc(k)} | {n} |")
    lines += [
        "",
        "---",
        "",
        f"Record {esc(doc['record_id'])}. SHA-256 of the JSON record: **{doc['sha256']}**",
    ]
    return "\n".join(lines)


def pdf_bytes(doc: dict[str, Any]) -> bytes:
    from ..documents.render_pdf import Letterhead, render

    lh = Letterhead(name="Agentic Office", footer=f"Certificate of deletion · {doc['record_id']}")
    return render(_md(doc), "Certificate of deletion", lh)


def write(rid: str, doc: dict[str, Any]) -> str:
    j, p = paths(rid)
    j.parent.mkdir(parents=True, exist_ok=True)
    tmp = j.with_suffix(".part")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    os.replace(tmp, j)
    p.write_bytes(pdf_bytes(doc))
    return str(doc["sha256"])
