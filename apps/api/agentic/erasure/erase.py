"""Erase one workspace, in this order (each step is one worker activity, safe to repeat):

1. prepare      count what there is (rows per table, members, outside services) and note it
2. revoke       sign everyone out of it, lock its members out, destroy every stored secret
                (AI keys, Microsoft / Google tokens, channel tokens, MCP and CRM secrets,
                saved logins), revoke linked computers, stop running work and its schedules
                in Temporal (and delete those workflow histories)
3. storage      delete every object this app wrote for it in every storage target (its files,
                computer backups), then the targets' own keys; and its export ZIPs
4. vault        delete the brain vault folder, git history included
5. cache        delete every Valkey key that carries one of its ids
6. database     delete every row (audit log too), then the members who belong nowhere else,
                then check that no table with a workspace_id column still holds its id
7. certificate  write the deletion certificate (JSON + PDF, SHA-256) where the owner can
                fetch it with their link, and close the server-level erasure record

What cannot be erased per workspace (and the certificate says so): the encrypted server
backups until the backup cycle overwrites them, Temporal's own retention of closed workflow
histories, and what outside services (AI providers, channels, storage the company owns)
keep under their own terms.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from ..core.db import SessionLocal
from . import inventory, jobs
from .models import ErasureRecord, WorkspaceExport

log = logging.getLogger("agentic.erasure")

# deploy/backup/agentic-backup.sh keeps 7 daily, 4 weekly and 6 monthly restic snapshots
# (BACKUP_KEEP); the oldest monthly one can be about six months old.
BACKUP_RETENTION_DAYS = int(os.environ.get("AGENTIC_BACKUP_RETENTION_DAYS", "186"))
# docker-compose.yml: Temporal's DEFAULT_NAMESPACE_RETENTION.
TEMPORAL_RETENTION_DAYS = int(os.environ.get("AGENTIC_TEMPORAL_RETENTION_DAYS", "7"))
DUE_DAYS = 14  # the NDA's clause: done within 14 days of the request
MAX_WORKFLOWS = 5000

STEPS = ("prepare", "revoke", "storage", "vault", "cache", "database", "certificate")
PROGRESS = {s: int(100 * (i + 1) / (len(STEPS) + 1)) for i, s in enumerate(STEPS)}


class EraseError(Exception):
    pass


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- notes between steps


def _draft_path(rid: str) -> Path:
    return inventory.erasure_dir(rid) / "draft.json"


def load_draft(rid: str) -> dict[str, Any]:
    p = _draft_path(rid)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def save_draft(rid: str, d: dict[str, Any]) -> None:
    p = _draft_path(rid)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    tmp.write_text(json.dumps(d, default=str, indent=1), encoding="utf-8")
    os.replace(tmp, p)


async def _mark(rid: str, step: str, **fields: Any) -> None:
    async with SessionLocal() as db:
        r = await db.get(ErasureRecord, rid)
        if r is None:
            return
        r.step, r.progress = step, PROGRESS.get(step, r.progress)
        for k, v in fields.items():
            setattr(r, k, v)
        await db.commit()


async def _record(rid: str) -> ErasureRecord:
    async with SessionLocal() as db:
        r = await db.get(ErasureRecord, rid)
    if r is None:
        raise EraseError(f"no erasure record {rid}")
    return r


# ---------------------------------------------------------------- 1. prepare


async def prepare(rid: str) -> dict[str, Any]:
    from ..models import Membership, User, Workspace

    r = await _record(rid)
    ws_id = r.erased_workspace_id
    draft = load_draft(rid)
    if draft.get("counts"):  # a retry after the rows started going: keep the first count
        return {"tables": len(draft["counts"])}
    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        if ws is None:
            raise EraseError("The workspace is already gone.")
        sch = await inventory.schema(db)
        counts = await inventory.counts(db, ws_id, sch)
        only = await inventory.users_only_here(db, ws_id)
        members = (
            await db.scalars(select(Membership.user_id).where(Membership.workspace_id == ws_id))
        ).all()
        who = await db.get(User, r.requested_by)
        providers = await inventory.providers(db, ws_id)
    draft = {
        "workspace": {"id": ws.id, "name": ws.name, "slug": ws.slug},
        "requested_by": {
            "id": r.requested_by,
            "name": who.name if who else "",
            "email": who.email if who else "",
        },
        "counts": counts,
        "members": {"total": len(members), "deleted": len(only), "kept": len(members) - len(only)},
        "providers": providers,
    }
    save_draft(rid, draft)
    await _mark(rid, "prepare", counts=counts)
    return {"tables": len(counts)}


# ---------------------------------------------------------------- 2. revoke


async def _best_effort(what: str, coro: Any) -> bool:
    try:
        await coro
        return True
    except Exception:  # noqa: BLE001 - the secret is destroyed here anyway
        log.info("erase: %s at the provider failed", what, exc_info=True)
        return False


async def revoke(rid: str) -> dict[str, int]:
    from ..models import (
        Agent,
        AIProvider,
        ApiToken,
        AuthSession,
        Channel,
        Credential,
        CredentialState,
        CrmConnector,
        Device,
        DeviceLinkCode,
        GoogleAccount,
        Integration,
        McpServer,
        Meeting,
        MeetingRecording,
        Membership,
        MicrosoftAccount,
        PushSubscription,
        Schedule,
        SharedMailbox,
        Task,
        User,
        WorkflowRun,
        Workspace,
    )

    r = await _record(rid)
    ws_id = r.erased_workspace_id
    out: dict[str, int] = {}

    def add(k: str, n: int) -> None:
        if n:
            out[k] = out.get(k, 0) + n

    async with SessionLocal() as db:
        ws = await db.get(Workspace, ws_id)
        if ws is None:
            return dict(load_draft(rid).get("revoked") or {})
        ws.settings = {**(ws.settings or {}), "erasing": rid}
        # People: sessions end; those only here can no longer sign in; the others keep their
        # account and other workspaces, but lose this one now.
        only = await inventory.users_only_here(db, ws_id)
        if only:
            res = await db.execute(
                update(User)
                .where(User.id.in_(only), User.is_active.is_(True))
                .values(is_active=False)
            )
            add("Accounts closed (people only in this workspace)", res.rowcount or 0)
        res = await db.execute(
            delete(Membership).where(
                Membership.workspace_id == ws_id, Membership.user_id.not_in(only or [""])
            )
        )
        add("Members' access removed (they keep other workspaces)", res.rowcount or 0)
        res = await db.execute(delete(AuthSession).where(AuthSession.workspace_id == ws_id))
        add("Sign-in sessions ended", res.rowcount or 0)
        if only:
            await db.execute(delete(AuthSession).where(AuthSession.user_id.in_(only)))
        res = await db.execute(
            delete(PushSubscription).where(PushSubscription.workspace_id == ws_id)
        )
        add("Push subscriptions removed", res.rowcount or 0)
        res = await db.execute(delete(ApiToken).where(ApiToken.workspace_id == ws_id))
        add("API tokens removed", res.rowcount or 0)
        await db.execute(delete(DeviceLinkCode).where(DeviceLinkCode.workspace_id == ws_id))
        await db.commit()

        # Linked computers: revoked (their token stops working now; the row goes later).
        from ..devices import hub

        devices = (
            await db.scalars(
                select(Device).where(Device.workspace_id == ws_id, Device.revoked_at.is_(None))
            )
        ).all()
        for d in devices:
            d.revoked_at = now()
            await _best_effort("device disconnect", hub.disconnect(d.id, "revoked", "Erased."))
        add("Linked computers revoked", len(devices))
        await db.commit()

        # Microsoft 365: subscriptions deleted at Microsoft while the token works, then tokens.
        from ..microsoft import auth as ms_auth
        from ..microsoft import sync as ms_sync

        accts = (
            await db.scalars(select(MicrosoftAccount).where(MicrosoftAccount.workspace_id == ws_id))
        ).all()
        for a in accts:
            await _best_effort("Microsoft subscriptions", ms_sync.drop_subscriptions(db, a))
            await _best_effort("Microsoft token cache", ms_auth.forget(a))
        boxes = (
            await db.scalars(select(SharedMailbox).where(SharedMailbox.workspace_id == ws_id))
        ).all()
        for b in boxes:
            await _best_effort("Microsoft mailbox subscriptions", ms_sync.drop_subscriptions(db, b))
        res = await db.execute(
            update(MicrosoftAccount)
            .where(MicrosoftAccount.workspace_id == ws_id)
            .values(token_enc="", status="disconnected")
        )
        add("Microsoft 365 accounts disconnected", res.rowcount or 0)

        # Google: the token is revoked at Google, then destroyed here.
        from ..assistants import gmail

        gaccts = (
            await db.scalars(select(GoogleAccount).where(GoogleAccount.workspace_id == ws_id))
        ).all()
        for g in gaccts:
            await _best_effort("Google revoke", gmail.revoke(db, g))
        res = await db.execute(
            update(GoogleAccount).where(GoogleAccount.workspace_id == ws_id).values(token_enc="")
        )
        add("Google accounts disconnected", res.rowcount or 0)

        # Telegram bots poll (no webhook to remove); a WhatsApp session is logged out.
        from ..channels import whatsapp
        from ..core import crypto

        chans = (await db.scalars(select(Channel).where(Channel.workspace_id == ws_id))).all()
        for ch in chans:
            if ch.kind == "whatsapp" and ch.config_enc:
                try:
                    cfg = whatsapp.Config.load(crypto.decrypt(ch.config_enc, f"channel:{ch.id}"))
                except Exception:  # noqa: BLE001 - unreadable here: nothing to log out with
                    cfg = None
                if cfg is not None and cfg.provider == "waha" and cfg.base_url:
                    await _best_effort("WhatsApp logout", whatsapp.waha_logout(cfg))
        res = await db.execute(
            update(Channel)
            .where(Channel.workspace_id == ws_id)
            .values(config_enc="", enabled=False)
        )
        add("Messaging channels disconnected (bot tokens destroyed)", res.rowcount or 0)

        res = await db.execute(
            update(AIProvider)
            .where(AIProvider.workspace_id == ws_id)
            .values(api_key_enc="", enabled=False)
        )
        add("AI provider keys destroyed", res.rowcount or 0)
        res = await db.execute(
            update(McpServer)
            .where(McpServer.workspace_id == ws_id)
            .values(auth_header_enc="", enabled=False)
        )
        add("Tool server (MCP) keys destroyed", res.rowcount or 0)
        res = await db.execute(
            update(Integration).where(Integration.workspace_id == ws_id).values(config_enc="")
        )
        add("Integration settings destroyed (app secrets)", res.rowcount or 0)
        cred_ids = (
            await db.scalars(select(Credential.id).where(Credential.workspace_id == ws_id))
        ).all()
        if cred_ids:
            await db.execute(
                delete(CredentialState).where(CredentialState.credential_id.in_(cred_ids))
            )
            await db.execute(
                update(Credential)
                .where(Credential.id.in_(cred_ids))
                .values(username_enc="", password_enc="")
            )
        add("Saved logins destroyed (credentials vault)", len(cred_ids))
        conns = (
            await db.scalars(select(CrmConnector).where(CrmConnector.workspace_id == ws_id))
        ).all()
        for c in conns:
            c.config = {
                k: v
                for k, v in (c.config or {}).items()
                if not (k.endswith("_enc") or k.lower() in inventory.SECRET_KEYS)
            }
            c.enabled = False
            c.webhook_hash = None
        add("CRM connector secrets destroyed, sync links disabled", len(conns))

        # Work: agents paused, schedules off; then Temporal.
        await db.execute(update(Agent).where(Agent.workspace_id == ws_id).values(status="paused"))
        sched_ids = (
            await db.scalars(select(Schedule.id).where(Schedule.workspace_id == ws_id))
        ).all()
        await db.execute(
            update(Schedule).where(Schedule.workspace_id == ws_id).values(enabled=False)
        )
        await db.execute(
            update(WorkspaceExport)
            .where(
                WorkspaceExport.workspace_id == ws_id,
                WorkspaceExport.status.in_(("queued", "running")),
            )
            .values(status="failed", error="Stopped: the workspace is being erased.")
        )
        await db.commit()

        wids: list[str] = []
        wids += [
            w
            for w in (
                await db.scalars(
                    select(Task.workflow_id).where(
                        Task.workspace_id == ws_id, Task.workflow_id.is_not(None)
                    )
                )
            ).all()
            if w
        ]
        wids += [
            f"wfrun-{i}"
            for i in (
                await db.scalars(select(WorkflowRun.id).where(WorkflowRun.workspace_id == ws_id))
            ).all()
        ]
        wids += [
            f"meeting-{i}"
            for i in (
                await db.scalars(select(Meeting.id).where(Meeting.workspace_id == ws_id))
            ).all()
        ]
        wids += [
            w
            for w in (
                await db.scalars(
                    select(MeetingRecording.workflow_id).where(
                        MeetingRecording.workspace_id == ws_id,
                        MeetingRecording.workflow_id.is_not(None),
                    )
                )
            ).all()
            if w
        ]
        wids += [f"scheduled-{s}" for s in sched_ids]
        wids += [
            f"export-{i}"
            for i in (
                await db.scalars(
                    select(WorkspaceExport.id).where(WorkspaceExport.workspace_id == ws_id)
                )
            ).all()
        ]
    dropped = 0
    for sid in sched_ids:
        if await _best_effort("Temporal schedule", jobs.temporal_drop_schedule(sid)):
            dropped += 1
    add("Recurring schedules removed (Temporal)", dropped)
    forgotten = 0
    for wid in list(dict.fromkeys(wids))[:MAX_WORKFLOWS]:
        try:
            if await jobs.temporal_forget(wid):
                forgotten += 1
        except Exception:  # noqa: BLE001 - Temporal's retention removes the rest
            log.info("erase: could not delete workflow %s", wid, exc_info=True)
    add("Workflow runs stopped and their histories deleted (Temporal)", forgotten)

    draft = load_draft(rid)
    prev = dict(draft.get("revoked") or {})
    for k, v in out.items():
        prev[k] = max(prev.get(k, 0), v)
    draft["revoked"] = prev
    save_draft(rid, draft)
    await _mark(rid, "revoke", revoked=prev)
    return prev


# ---------------------------------------------------------------- 3. storage


async def storage_objects(rid: str, attempt: int = 99, max_attempts: int = 3) -> dict[str, Any]:
    """Delete what this app wrote for the workspace in every storage target. Files a
    company imported from its own storage (read in place) are its own copy and stay."""
    import httpx

    from ..documents import storage
    from ..models import StorageTarget

    r = await _record(rid)
    ws_id = r.erased_workspace_id
    report: dict[str, Any] = {}
    failed = False
    async with SessionLocal() as db:
        targets = (
            await db.scalars(select(StorageTarget).where(StorageTarget.workspace_id == ws_id))
        ).all()
        for t in targets:
            row = {"name": t.name, "kind": t.kind, "deleted": 0, "failed": 0, "error": ""}
            for prefix in inventory.storage_prefixes(ws_id):
                for _ in range(1000):  # listings come in pages of storage.MAX_LIST
                    try:
                        entries = await storage.list_files(t, prefix)
                    except (storage.StorageError, httpx.HTTPError) as e:
                        row["error"] = str(e)[:300] or e.__class__.__name__
                        failed = True
                        break
                    entries = [e for e in entries if e.key.startswith(prefix)]
                    if not entries:
                        break
                    before = row["failed"]
                    for e in entries:
                        try:
                            await storage.delete(t, e.key)
                            row["deleted"] += 1
                        except (storage.StorageError, httpx.HTTPError) as err:
                            row["failed"] += 1
                            row["error"] = str(err)[:300] or err.__class__.__name__
                    if row["failed"] > before:
                        failed = True
                        break
            if t.kind == "local":
                _prune_local(t, ws_id)
            report[t.id] = row
        last = attempt >= max_attempts
        if failed and not last:
            raise EraseError("Some stored files could not be deleted yet; trying again.")
        # The targets' own keys go once their objects are gone (or on the last attempt).
        for t in targets:
            t.config = {k: v for k, v in (t.config or {}).items() if not k.endswith("_enc")}
            t.config = {
                k: ("" if k.lower() in inventory.SECRET_KEYS else v) for k, v in t.config.items()
            }
        await db.commit()
    exports = 0
    folder = inventory.exports_dir(ws_id)
    if folder.exists():
        exports = sum(1 for p in folder.rglob("*") if p.is_file())
        await asyncio.to_thread(_rmtree, folder)
    draft = load_draft(rid)
    draft["storage"] = report
    draft["exports_deleted"] = exports
    save_draft(rid, draft)
    await _mark(rid, "storage")
    return {"targets": len(report), "exports": exports}


def _prune_local(t: Any, ws_id: str) -> None:
    from ..documents import storage

    root = storage._local_root(t)
    for prefix in inventory.storage_prefixes(ws_id):
        p = (root / prefix).resolve()
        if root in p.parents and p.exists():
            # Only empty folders remain (every file was deleted above).
            for d in sorted((x for x in p.rglob("*") if x.is_dir()), reverse=True):
                with _quiet():
                    d.rmdir()
            with _quiet():
                p.rmdir()


class _quiet:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *exc: object) -> bool:
        return exc[0] is not None and issubclass(exc[0], OSError)  # type: ignore[arg-type]


def _rmtree(path: Path) -> None:
    def writable(func: Any, p: str, _exc: Any) -> None:  # git packs are read-only on Windows
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onexc=writable)


# ---------------------------------------------------------------- 4. vault


async def vault_dir(rid: str) -> dict[str, Any]:
    from ..brain import vault

    draft = load_draft(rid)
    slug = (draft.get("workspace") or {}).get("slug") or ""
    out = {"files": 0, "history": False}
    try:
        root = vault.root(slug)
    except ValueError:
        root = None
    if root is not None and root.exists():
        out["files"] = sum(
            1 for p in root.rglob("*") if p.is_file() and ".git" not in p.relative_to(root).parts
        )
        out["history"] = (root / ".git").is_dir()
        await asyncio.to_thread(_rmtree, root)
        if root.exists():
            raise EraseError("The vault folder could not be deleted.")
    draft["vault"] = out
    save_draft(rid, draft)
    await _mark(rid, "vault")
    return out


# ---------------------------------------------------------------- 5. cache


_SPLIT = re.compile(r"[:/|,]")


async def cache_keys(rid: str) -> dict[str, int]:
    from ..core.valkey import valkey

    r = await _record(rid)
    async with SessionLocal() as db:
        ids = await inventory.key_ids(db, r.erased_workspace_id)
    ids.add(r.erased_workspace_id)
    v = valkey()
    doomed: set[str] = set()
    sessions: set[str] = set()
    async for key in v.scan_iter(count=1000):
        k = key.decode(errors="replace") if isinstance(key, bytes) else str(key)
        if set(_SPLIT.split(k)) & ids:
            doomed.add(k)
            # Browser sessions are keyed by their own id: browser:task:<task> -> session id.
            if k.startswith(("browser:task:", "browser:agent:")):
                try:
                    sid = await v.get(k)
                except Exception:  # noqa: BLE001 - not a string value
                    sid = None
                if sid:
                    sessions.add(str(sid))
    if sessions:
        async for key in v.scan_iter(count=1000):
            k = key.decode(errors="replace") if isinstance(key, bytes) else str(key)
            if set(_SPLIT.split(k)) & sessions:
                doomed.add(k)
    batch = list(doomed)
    for i in range(0, len(batch), 500):
        await v.delete(*batch[i : i + 500])
    draft = load_draft(rid)
    draft["cache_keys"] = int(draft.get("cache_keys") or 0) + len(batch)
    save_draft(rid, draft)
    await _mark(rid, "cache")
    return {"keys": len(batch)}


# ---------------------------------------------------------------- 6. database


async def leftovers(db: Any, ws_id: str) -> dict[str, int]:
    """Rows still carrying the workspace's id, in every table that has the column."""
    tables = (
        await db.scalars(
            text(
                "SELECT c.table_name FROM information_schema.columns c JOIN "
                "information_schema.tables t ON t.table_name = c.table_name AND "
                "t.table_schema = c.table_schema WHERE c.table_schema = current_schema() AND "
                "t.table_type = 'BASE TABLE' AND c.column_name = 'workspace_id'"
            )
        )
    ).all()
    out: dict[str, int] = {}
    for t in tables:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", t):
            continue
        n = int(
            await db.scalar(
                text(f"SELECT count(*) FROM {t} WHERE workspace_id = :ws"),  # noqa: S608
                {"ws": ws_id},
            )
            or 0
        )
        if n:
            out[t] = n
    if await db.scalar(text("SELECT count(*) FROM workspaces WHERE id = :ws"), {"ws": ws_id}):
        out["workspaces"] = 1
    return out


async def database(rid: str) -> dict[str, Any]:
    r = await _record(rid)
    ws_id = r.erased_workspace_id
    deleted: dict[str, int] = {}
    async with SessionLocal() as db:
        await db.execute(text("SET LOCAL agentic.erasure = 'on'"))
        sch = await inventory.schema(db)
        only = await inventory.users_only_here(db, ws_id)
        # Children first (in case one points at its parent without ON DELETE CASCADE), then
        # the owned tables, in passes: a table refused because another still points at it
        # is tried again after the others went.
        pending = [*sch.children, *sch.direct]
        for _ in range(len(pending) + 1):
            if not pending:
                break
            left: list[str] = []
            for name in pending:
                sql = f"DELETE FROM {name} WHERE {sch.tables[name].owned_sql}"  # noqa: S608 - live schema
                try:
                    async with db.begin_nested():
                        res = await db.execute(text(sql), {"ws": ws_id})
                    if res.rowcount:
                        deleted[name] = deleted.get(name, 0) + res.rowcount
                except DBAPIError:
                    left.append(name)
            if len(left) == len(pending):
                raise EraseError(f"These tables could not be emptied: {', '.join(left)}")
            pending = left
        await db.execute(text("DELETE FROM workspaces WHERE id = :ws"), {"ws": ws_id})
        users_deleted = 0
        if only:
            res = await db.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": only})
            users_deleted = res.rowcount or 0
        left_rows = await leftovers(db, ws_id)
        if left_rows:
            raise EraseError(f"Rows remain after the erase: {left_rows}")
        if only:
            still = await db.scalar(
                text("SELECT count(*) FROM users WHERE id = ANY(:ids)"), {"ids": only}
            )
            if still:
                raise EraseError("Some accounts remain after the erase.")
        checked = int(
            await db.scalar(
                text(
                    "SELECT count(DISTINCT c.table_name) FROM information_schema.columns c JOIN "
                    "information_schema.tables t ON t.table_name = c.table_name AND "
                    "t.table_schema = c.table_schema WHERE c.table_schema = current_schema() "
                    "AND t.table_type = 'BASE TABLE' AND c.column_name = 'workspace_id'"
                )
            )
            or 0
        )
        rec = await db.get(ErasureRecord, rid)
        if rec is not None:
            rec.step, rec.progress = "database", PROGRESS["database"]
        await db.commit()
    draft = load_draft(rid)
    draft["database"] = {
        "deleted": deleted,
        "users_deleted": users_deleted,
        "tables_checked": checked,
        "checked_at": now().isoformat(),
    }
    save_draft(rid, draft)
    return {"tables": len(deleted), "users": users_deleted}


# ---------------------------------------------------------------- 7. certificate


async def certificate(rid: str) -> dict[str, Any]:
    from . import certificate as cert

    r = await _record(rid)
    draft = load_draft(rid)
    if not draft and r.certificate_sha256:  # done before: nothing more to do
        return {"sha256": r.certificate_sha256}
    done_at = now()
    doc = cert.build(r, draft, done_at)
    digest = cert.write(rid, doc)
    async with SessionLocal() as db:
        rec = await db.get(ErasureRecord, rid)
        if rec is not None:
            rec.status, rec.step, rec.progress = "done", "done", 100
            rec.completed_at = done_at
            rec.certificate_sha256 = digest
            rec.error = None
            await db.commit()
    _draft_path(rid).unlink(missing_ok=True)
    return {"sha256": digest}


async def failed(rid: str, why: str) -> None:
    async with SessionLocal() as db:
        rec = await db.get(ErasureRecord, rid)
        if rec is not None and rec.status != "done":
            rec.status, rec.error = "failed", why[:500]
            await db.commit()


async def run_step(rid: str, step: str, attempt: int = 99, max_attempts: int = 3) -> dict[str, Any]:
    """One step, once: a retried erase (after a failure part-way) skips the steps already
    done, so their notes (what was deleted where) are not overwritten by an empty rerun."""
    if step in (load_draft(rid).get("done") or []):
        return {"skipped": True}
    if step == "prepare":
        out = await prepare(rid)
    elif step == "revoke":
        out = await revoke(rid)
    elif step == "storage":
        out = await storage_objects(rid, attempt, max_attempts)
    elif step == "vault":
        out = await vault_dir(rid)
    elif step == "cache":
        out = await cache_keys(rid)
    elif step == "database":
        out = await database(rid)
    elif step == "certificate":
        return await certificate(rid)  # removes the notes: nothing to mark
    else:
        raise ValueError(f"unknown erase step {step!r}")
    draft = load_draft(rid)
    draft["done"] = [*(draft.get("done") or []), step]
    save_draft(rid, draft)
    return out


async def run_all(rid: str) -> dict[str, Any]:
    """Every step in order, here and now (tests; the worker runs them as activities)."""
    out: dict[str, Any] = {}
    for step in STEPS:
        out = await run_step(rid, step)
    return out
