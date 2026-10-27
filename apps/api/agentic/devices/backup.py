"""P53: company backup of the folders a staff computer shares.

Company-owned computers: the owner can have the files in each computer's shared folders copied
to a storage place they choose (Backblaze B2, a file server, the VPS disk — documents/storage),
so when a computer is wiped or lost the company's work is safe. Transparent, not covert:

- it is off until the owner turns it on in Settings, with a destination;
- it copies only the folders the staff member already shares with their AI (never the whole
  disk, and never the files the agent refuses: passwords, keys, browser data — those are not
  reachable through files.list either);
- it is incremental (a per-computer manifest in the destination; unchanged files are skipped)
  and bounded per run, so it never floods the line;
- every run is written to the computer's activity log, which the staff member sees.

Runs on the liveness round (workflows/reconcile_activities), like storage-source sync.
"""

import contextlib
import json
import logging
import posixpath
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Device, StorageTarget, Workspace
from . import bridge, core
from .core import DeviceError

log = logging.getLogger("agentic.devices.backup")

MAX_FILES_PER_RUN = 200  # per computer per round, so one big computer never ties up the line
MAX_BYTES_PER_RUN = 500 * 1024 * 1024
MAX_FILE_BYTES = 100 * 1024 * 1024  # a single file larger than this is noted and skipped
MAX_ENTRIES = 50_000  # walk guard
EVERY_HOURS_DEFAULT = 6
KEY_ROOT = "pc-backups"


@dataclass
class Policy:
    enabled: bool = False
    target_id: str = ""
    every_hours: int = EVERY_HOURS_DEFAULT


def policy(ws: Workspace) -> Policy:
    raw: dict[str, Any] = (ws.settings or {}).get("pc_backup") or {}
    try:
        hours = int(raw.get("every_hours", EVERY_HOURS_DEFAULT))
    except (TypeError, ValueError):
        hours = EVERY_HOURS_DEFAULT
    return Policy(
        enabled=bool(raw.get("enabled")),
        target_id=str(raw.get("target_id") or ""),
        every_hours=max(1, min(168, hours)),
    )


def save_policy(ws: Workspace, p: Policy) -> None:
    ws.settings = {
        **(ws.settings or {}),
        "pc_backup": {
            "enabled": p.enabled,
            "target_id": p.target_id,
            "every_hours": p.every_hours,
        },
    }


@dataclass
class Stats:
    files: int = 0
    bytes: int = 0
    skipped: int = 0
    too_big: int = 0
    errors: list[str] = field(default_factory=list)
    hit_cap: bool = False

    def dict(self) -> dict[str, Any]:
        return {
            "files": self.files,
            "bytes": self.bytes,
            "skipped": self.skipped,
            "too_big": self.too_big,
            "errors": self.errors[:5],
            "hit_cap": self.hit_cap,
        }


def _rel(folder: str, path: str) -> str:
    """A storage-safe relative key for a file under one shared folder."""
    base = folder.replace("\\", "/").rstrip("/")
    p = path.replace("\\", "/")
    rel = p[len(base) + 1 :] if p.lower().startswith(base.lower() + "/") else posixpath.basename(p)
    parts = [seg for seg in rel.split("/") if seg not in ("", ".", "..")]
    return "/".join(parts)


def _manifest_key(ws_id: str, device_id: str) -> str:
    return f"{KEY_ROOT}/{ws_id}/{device_id}/_manifest.json"


def _file_key(ws_id: str, device_id: str, folder_i: int, rel: str) -> str:
    return f"{KEY_ROOT}/{ws_id}/{device_id}/{folder_i}/{rel}"


async def _load_manifest(target: StorageTarget, ws_id: str, device_id: str) -> dict[str, Any]:
    from ..documents import storage

    try:
        raw = await storage.get(target, _manifest_key(ws_id, device_id))
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 - no manifest yet (first run), or unreadable: start fresh
        return {}


async def _save_manifest(
    target: StorageTarget, ws_id: str, device_id: str, manifest: dict[str, Any]
) -> None:
    from ..documents import storage

    await storage.put(
        target,
        _manifest_key(ws_id, device_id),
        json.dumps(manifest, separators=(",", ":")).encode("utf-8"),
    )


async def run_once(db: AsyncSession, device: Device, target: StorageTarget) -> Stats:
    """Copy the computer's shared folders to the target, incrementally and bounded. The agent
    only lists and uploads files inside the shared folders and never the denied ones, so this
    cannot reach anything the staff member did not share."""
    from ..documents import storage

    st = Stats()
    ws_id = device.workspace_id
    manifest = await _load_manifest(target, ws_id, device.id)
    seen: set[str] = set()
    changed = False
    folders = list(device.folders or [])
    walked = 0

    for i, folder in enumerate(folders):
        queue = [folder]
        while queue:
            if st.files >= MAX_FILES_PER_RUN or st.bytes >= MAX_BYTES_PER_RUN:
                st.hit_cap = True
                break
            cur = queue.pop(0)
            walked += 1
            if walked > MAX_ENTRIES:
                st.hit_cap = True
                break
            try:
                listing = await bridge.call(device.id, "files.list", {"folder": cur}, 30.0)
            except DeviceError as e:
                st.errors.append(f"{cur}: {e.code}")
                continue
            for item in listing.get("items") or []:
                if item.get("is_dir"):
                    queue.append(str(item.get("path") or ""))
                    continue
                path = str(item.get("path") or "")
                size = int(item.get("size") or 0)
                mtime = str(item.get("modified") or "")
                rel = _rel(folder, path)
                if not rel:
                    continue
                key = _file_key(ws_id, device.id, i, rel)
                seen.add(key)
                prev = manifest.get(key)
                if (
                    isinstance(prev, dict)
                    and prev.get("size") == size
                    and prev.get("mtime") == mtime
                ):
                    st.skipped += 1
                    continue
                if size > MAX_FILE_BYTES:
                    st.too_big += 1
                    continue
                if st.files >= MAX_FILES_PER_RUN or st.bytes + size > MAX_BYTES_PER_RUN:
                    st.hit_cap = True
                    break
                try:
                    _, data = await bridge.fetch_file(
                        device.id, path, max_bytes=MAX_FILE_BYTES, kind="backup", timeout=180.0
                    )
                except DeviceError as e:
                    st.errors.append(f"{rel}: {e.code}")
                    continue
                await storage.put(target, key, data)
                manifest[key] = {"size": len(data), "mtime": mtime, "at": _now_iso()}
                changed = True
                st.files += 1
                st.bytes += len(data)
        if st.hit_cap:
            break

    # Drop files that are gone from the computer (only when the whole tree was walked).
    if not st.hit_cap:
        for key in [
            k
            for k in manifest
            if k not in seen and k.startswith(f"{KEY_ROOT}/{ws_id}/{device.id}/")
        ]:
            del manifest[key]
            changed = True

    if changed:
        await _save_manifest(target, ws_id, device.id, manifest)
    if st.files or st.errors:
        await core.log_activity(
            db,
            device,
            "backup",
            {
                "files": st.files,
                "bytes": st.bytes,
                "skipped": st.skipped,
                "error": st.errors[0] if st.errors else None,
            },
            ok=not st.errors,
        )
        await db.commit()
    return st


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _too_soon(key: str, every_hours: int) -> bool:
    """True if this computer was backed up within its interval (skip it this round)."""
    from ..core.valkey import valkey

    try:
        last = await valkey().get(key)
    except Exception:  # noqa: BLE001 - no cache: do not skip
        return False
    if not last:
        return False
    try:
        ago = (datetime.now(UTC) - datetime.fromisoformat(str(last))).total_seconds()
    except ValueError:
        return False
    return ago < every_hours * 3600


async def backup_due(db: AsyncSession) -> int:
    """Every workspace with backup on, each online computer that is due: one bounded run.
    Returns how many computers were backed up this round."""
    from ..core.valkey import valkey
    from ..documents import storage

    done = 0
    ws_rows = (await db.scalars(select(Workspace))).all()
    for ws in ws_rows:
        pol = policy(ws)
        if not pol.enabled or not pol.target_id:
            continue
        target = await db.get(StorageTarget, pol.target_id)
        if target is None or target.workspace_id != ws.id:
            continue
        devices = (
            await db.scalars(
                select(Device).where(Device.workspace_id == ws.id, Device.revoked_at.is_(None))
            )
        ).all()
        if not devices:
            continue
        online = await core.online_ids(d.id for d in devices)
        for d in devices:
            if d.id not in online:
                continue
            key = f"pcbackup:last:{d.id}"
            if await _too_soon(key, pol.every_hours):
                continue
            try:
                await run_once(db, d, target)
                done += 1
            except storage.StorageError as e:
                log.warning("pc backup to storage failed for %s: %s", d.id, e)
            except Exception:  # noqa: BLE001 - one computer must not stop the round
                log.warning("pc backup failed for %s", d.id, exc_info=True)
            with contextlib.suppress(Exception):
                await valkey().set(key, _now_iso(), ex=pol.every_hours * 3600 * 2)
    return done
