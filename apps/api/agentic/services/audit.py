"""Append-only, hash-chained audit log.

Each row's hash covers its own content plus the previous row's hash, per workspace.
Editing or deleting any row breaks every hash after it, which `verify_chain` detects.
The DB trigger from migration 0001 also rejects UPDATE/DELETE outright.
"""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog


def _digest(prev_hash: str | None, row: dict[str, Any]) -> str:
    canonical = json.dumps(row, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(((prev_hash or "") + canonical).encode()).hexdigest()


def _row_payload(
    workspace_id: str,
    ts: datetime,
    actor: str,
    action: str,
    target: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    note: str | None,
) -> dict[str, Any]:
    return {
        "workspace_id": workspace_id,
        "ts": ts.isoformat(),
        "actor": actor,
        "action": action,
        "target": target,
        "before": before,
        "after": after,
        "note": note,
    }


async def record(
    db: AsyncSession,
    workspace_id: str,
    actor: str,
    action: str,
    target: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    """Append one entry inside the caller's transaction (the caller commits)."""
    # Serialize appends per workspace so two writers can't chain onto the same prev_hash.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"audit:{workspace_id}"}
    )
    prev_hash = await db.scalar(
        select(AuditLog.hash)
        .where(AuditLog.workspace_id == workspace_id)
        .order_by(AuditLog.id.desc())
        .limit(1)
    )
    ts = datetime.now(UTC)
    payload = _row_payload(workspace_id, ts, actor, action, target, before, after, note)
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            ts=ts,
            actor=actor,
            action=action,
            target=target,
            before=before,
            after=after,
            note=note,
            prev_hash=prev_hash,
            hash=_digest(prev_hash, payload),
        )
    )


async def verify_chain(db: AsyncSession, workspace_id: str) -> dict[str, Any]:
    rows = (
        await db.scalars(
            select(AuditLog).where(AuditLog.workspace_id == workspace_id).order_by(AuditLog.id)
        )
    ).all()
    prev: str | None = None
    for row in rows:
        payload = _row_payload(
            row.workspace_id,
            row.ts,
            row.actor,
            row.action,
            row.target,
            row.before,
            row.after,
            row.note,
        )
        if row.prev_hash != prev or row.hash != _digest(prev, payload):
            return {"ok": False, "checked": len(rows), "broken_at": row.id}
        prev = row.hash
    return {"ok": True, "checked": len(rows), "broken_at": None}
