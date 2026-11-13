"""Export everything one workspace holds into a ZIP on this server's disk.

Layout (also in the README.md and index.html inside the ZIP):
    README.md, index.html, manifest.json
    tables/<table>.json      that workspace's rows, one JSON array per table; secrets "[redacted]"
    files/<folder>/<name>    every file's original bytes, in its Library folder
    vault/<path>.md          the brain (memory) as markdown, as Obsidian opens it
    documents/<title>.md     documents as they are stored (markdown with the company's blocks)

Embeddings and search indexes are not exported: they are derived from the text above.
"""

import hashlib
import json
import logging
import os
import re
import zipfile
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.db import SessionLocal
from . import inventory
from .models import WorkspaceExport

log = logging.getLogger("agentic.erasure.export")

KEEP_DAYS = 7  # a finished export not downloaded by then is deleted
Beat = Callable[[], Awaitable[None] | None]


def _json_default(v: Any) -> Any:
    if isinstance(v, datetime | date | time):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, bytes | memoryview):
        return None
    if isinstance(v, set | tuple):
        return list(v)
    return str(v)


def clean_row(row: dict[str, Any], json_cols: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if inventory.secret_column(k):
            out[k] = inventory.REDACTED if v not in (None, "", [], {}) else v
            continue
        if k in json_cols and isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                pass
        out[k] = inventory.redact_json(v) if isinstance(v, dict | list) else v
    return out


_BAD = re.compile(r'[\x00-\x1f\\/:*?"<>|]+')


def safe_name(name: str, fallback: str = "file") -> str:
    n = _BAD.sub("_", name or "").strip().strip(".").strip()
    return n[:150] or fallback


def safe_folder(folder: str) -> str:
    parts = [safe_name(p, "") for p in (folder or "").replace("\\", "/").split("/")]
    return "/".join(p for p in parts if p and p not in (".", ".."))


class _Names:
    """Unique paths inside the ZIP (two files with one name in one folder both survive)."""

    def __init__(self) -> None:
        self.seen: set[str] = set()

    def take(self, path: str, tag: str) -> str:
        if path.lower() not in self.seen:
            self.seen.add(path.lower())
            return path
        stem, ext = os.path.splitext(path)
        alt = f"{stem} ({tag}){ext}"
        self.seen.add(alt.lower())
        return alt


async def _progress(export_id: str, pct: int, step: str) -> None:
    async with SessionLocal() as db:
        ex = await db.get(WorkspaceExport, export_id)
        if ex is not None:
            ex.progress, ex.step = pct, step
            await db.commit()


async def _beat(beat: Beat | None) -> None:
    if beat is not None:
        r = beat()
        if r is not None:
            await r


async def _write_table(
    db: AsyncSession, z: zipfile.ZipFile, name: str, t: inventory.Table, ws_id: str
) -> int:
    cols = ", ".join(f'"{c}"' for c, _ in t.columns)
    json_cols = {c for c, d in t.columns if d in ("json", "jsonb")}
    sql = f"SELECT {cols} FROM {name} WHERE {t.owned_sql}"  # noqa: S608 - names from the live schema
    n = 0
    with z.open(f"tables/{name}.json", "w", force_zip64=True) as fh:
        fh.write(b"[")
        result = await db.stream(text(sql), {"ws": ws_id})
        async for row in result.mappings():
            fh.write(b"\n" if n == 0 else b",\n")
            data = clean_row(dict(row), json_cols)
            fh.write(json.dumps(data, default=_json_default, ensure_ascii=False).encode())
            n += 1
        fh.write(b"\n]\n")
    return n


async def write_zip(
    db: AsyncSession, ws_id: str, z: zipfile.ZipFile, on_step: Callable[[int, str], Any]
) -> dict[str, Any]:
    """Everything of one workspace into an open ZIP. Returns the manifest."""
    from ..brain import vault
    from ..documents import storage
    from ..models import DocFile, Document, Workspace

    ws = await db.get(Workspace, ws_id)
    if ws is None:
        raise ValueError("workspace not found")
    manifest: dict[str, Any] = {
        "workspace": {"id": ws.id, "name": ws.name, "slug": ws.slug},
        "created_at": datetime.now(UTC).isoformat(),
        "tables": {},
        "skipped_columns": {},
        "files": 0,
        "files_unreadable": [],
        "vault_pages": 0,
        "documents": 0,
    }
    # ---- tables
    sch = await inventory.schema(db)
    names = sorted(sch.tables)
    for i, name in enumerate(names):
        t = sch.tables[name]
        manifest["tables"][name] = await _write_table(db, z, name, t, ws_id)
        if t.skipped:
            manifest["skipped_columns"][name] = t.skipped
        await on_step(5 + int(45 * (i + 1) / max(1, len(names))), "tables")
    # people (members only; passwords and sign-in secrets redacted)
    ucols = (
        await db.execute(
            text(
                "SELECT column_name, data_type FROM information_schema.columns WHERE "
                "table_schema = current_schema() AND table_name = 'users' ORDER BY ordinal_position"
            )
        )
    ).all()
    users = inventory.Table(
        "users",
        [(c, d) for c, d in ucols if d not in inventory.SKIP_TYPES],
        [],
        inventory.MEMBERS_SQL,
        False,
    )
    manifest["tables"]["users"] = await _write_table(db, z, "users", users, ws_id)
    row = {
        c.name: getattr(ws, c.key)
        for c in Workspace.__table__.columns  # type: ignore[attr-defined]
    }
    z.writestr(
        "tables/workspaces.json",
        json.dumps([clean_row(row, {"settings"})], default=_json_default, ensure_ascii=False),
    )
    manifest["tables"]["workspaces"] = 1

    # ---- files: original bytes, wherever they live
    taken = _Names()
    files = (
        await db.scalars(
            select(DocFile).where(DocFile.workspace_id == ws_id).order_by(DocFile.created_at)
        )
    ).all()
    for i, f in enumerate(files):
        path = "/".join(p for p in ("files", safe_folder(f.folder), safe_name(f.name, f.id)) if p)
        try:
            data = await storage.read(db, f)
        except storage.StorageError as e:
            manifest["files_unreadable"].append({"id": f.id, "name": f.name, "why": str(e)})
            continue
        except Exception as e:  # noqa: BLE001 - one unreachable bucket never stops the export
            manifest["files_unreadable"].append(
                {"id": f.id, "name": f.name, "why": e.__class__.__name__}
            )
            continue
        z.writestr(taken.take(path, f.id), data)
        manifest["files"] += 1
        if i % 20 == 0:
            await on_step(50 + int(30 * (i + 1) / max(1, len(files))), "files")

    # ---- the brain vault, as markdown
    await on_step(80, "vault")
    pages = await _vault_pages(db, ws, vault)
    for rel, body in sorted(pages.items()):
        z.writestr("vault/" + safe_folder(rel), body)
    manifest["vault_pages"] = len(pages)

    # ---- documents, as stored
    await on_step(88, "documents")
    docs = (await db.scalars(select(Document).where(Document.workspace_id == ws_id))).all()
    dnames = _Names()
    for d in docs:
        head = f"<!-- {d.kind} {d.number} · status {d.status} · version {d.version} -->\n"
        z.writestr(
            dnames.take(f"documents/{safe_name(d.title, d.id)}.md", d.id),
            (head + (d.body or "")).encode(),
        )
    manifest["documents"] = len(docs)

    await on_step(97, "index")
    z.writestr("README.md", readme(manifest))
    z.writestr("index.html", index_html(manifest))
    z.writestr(
        "manifest.json", json.dumps(manifest, indent=2, default=_json_default, ensure_ascii=False)
    )
    return manifest


async def _vault_pages(db: AsyncSession, ws: Any, vault: Any) -> dict[str, str]:
    import asyncio

    from ..models import BrainPage

    try:
        pages = await asyncio.to_thread(vault.read_all, ws.slug)
    except (ValueError, OSError):
        pages = {}
    if pages:
        return pages
    # No vault folder on this server (a restore without it): the rows are the truth.
    rows = (await db.scalars(select(BrainPage).where(BrainPage.workspace_id == ws.id))).all()
    return {p.path: p.body or "" for p in rows}


def readme(m: dict[str, Any]) -> str:
    ws = m["workspace"]
    tables = "\n".join(f"- tables/{t}.json: {n} rows" for t, n in sorted(m["tables"].items()))
    unreadable = "".join(
        f"\n- {u['name']} ({u['id']}): {u['why']}" for u in m.get("files_unreadable") or []
    )
    return f"""# Export of {ws["name"]}

Workspace id: {ws["id"]}
Made: {m["created_at"]}

## What is inside

- tables/: every record of this workspace, one JSON file per table (only this workspace's
  rows). Passwords, keys, tokens and other secrets are never exported: they show as
  "[redacted]".
- files/: {m["files"]} files with their original bytes, in their Library folders.
- vault/: {m["vault_pages"]} pages of the AI's memory (the brain), as markdown. Obsidian
  opens this folder as a vault.
- documents/: {m["documents"]} documents as they are stored (markdown).
- manifest.json: the counts below, as data.

Embeddings and search indexes are not exported: they are derived from the text above and
are rebuilt from it.

## Tables

{tables}

## Files that could not be read
{unreadable or chr(10) + "None."}
"""


def index_html(m: dict[str, Any]) -> str:
    import html

    ws = m["workspace"]
    rows = "".join(
        f"<tr><td><a href='tables/{html.escape(t)}.json'>{html.escape(t)}</a></td><td>{n}</td></tr>"
        for t, n in sorted(m["tables"].items())
    )
    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>Export of {html.escape(ws["name"])}</title>
<style>body{{font:14px system-ui,sans-serif;max-width:760px;margin:2em auto;padding:0 1em}}
td{{padding:2px 12px 2px 0}}</style></head><body>
<h1>Export of {html.escape(ws["name"])}</h1>
<p>Workspace id {html.escape(ws["id"])}, made {html.escape(m["created_at"])}.</p>
<ul>
<li><b>files/</b>: {m["files"]} files, original bytes, in their folders</li>
<li><b>vault/</b>: {m["vault_pages"]} memory pages (markdown; open the folder in Obsidian)</li>
<li><b>documents/</b>: {m["documents"]} documents as stored (markdown)</li>
<li><b>tables/</b>: every record as JSON. Secrets show as "[redacted]".</li>
</ul>
<p>Embeddings and search indexes are not included: they are derived from the text.</p>
<h2>Tables</h2><table>{rows}</table></body></html>"""


async def build(export_id: str, beat: Beat | None = None) -> dict[str, Any]:
    """Run one export to the end. Returns the manifest's counts."""
    async with SessionLocal() as db:
        ex = await db.get(WorkspaceExport, export_id)
        if ex is None or ex.status not in ("queued", "running"):
            return {}
        ex.status, ex.progress, ex.step = "running", 1, "tables"
        ws_id = ex.workspace_id
        await db.commit()
    folder = inventory.exports_dir(ws_id)
    folder.mkdir(parents=True, exist_ok=True)
    final = folder / f"{export_id}.zip"
    part = folder / f"{export_id}.zip.part"

    async def on_step(pct: int, step: str) -> None:
        await _beat(beat)
        await _progress(export_id, pct, step)

    try:
        async with SessionLocal() as db:
            with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
                manifest = await write_zip(db, ws_id, z, on_step)
        os.replace(part, final)
    except Exception as e:
        part.unlink(missing_ok=True)
        async with SessionLocal() as db:
            ex = await db.get(WorkspaceExport, export_id)
            if ex is not None:
                ex.status, ex.error = "failed", str(e)[:500]
                ex.finished_at = datetime.now(UTC)
                await db.commit()
        raise
    digest = hashlib.sha256()
    with final.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    counts = {
        "tables": sum(manifest["tables"].values()),
        "files": manifest["files"],
        "files_unreadable": len(manifest["files_unreadable"]),
        "vault_pages": manifest["vault_pages"],
        "documents": manifest["documents"],
    }
    async with SessionLocal() as db:
        ex = await db.get(WorkspaceExport, export_id)
        if ex is not None:
            ex.status, ex.progress, ex.step = "ready", 100, "done"
            ex.path = final.relative_to(inventory.files_root()).as_posix()
            ex.size = final.stat().st_size
            ex.sha256 = digest.hexdigest()
            ex.counts = counts
            ex.finished_at = datetime.now(UTC)
            ex.expires_at = ex.finished_at + timedelta(days=KEEP_DAYS)
            await db.commit()
    return counts


def file_of(ex: WorkspaceExport) -> Path | None:
    if not ex.path:
        return None
    base = Path(settings.files_dir).resolve()
    p = (base / ex.path).resolve()
    return p if base in p.parents else None


def discard(ex: WorkspaceExport) -> None:
    p = file_of(ex)
    if p is not None:
        p.unlink(missing_ok=True)
