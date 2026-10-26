"""P40: where company files are kept (documents/storage.py, documents/sources.py). Owner and
admin only (org.manage): this holds bucket keys and file server passwords.

- GET    /api/storage                  the storage targets (secrets never returned)
- POST   /api/storage                  add one (tested before it is saved)
- PATCH  /api/storage/{id}             rename, new credentials, primary, Library import
- POST   /api/storage/{id}/check       test it (write, read back, delete a small file)
- POST   /api/storage/{id}/sync        import its documents into the Library now
- DELETE /api/storage/{id}             remove it (only when no file lives there any more)
"""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ...core.db import get_db
from ...core.ids import new_id
from ...documents import sources, storage
from ...models import Branch, Department, DocFile, StorageTarget
from ...services import audit
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/storage", tags=["storage"])

ALLOWED: dict[str, tuple[str, ...]] = {
    "local": ("folder",),
    "s3": ("endpoint", "bucket", "region", "access_key", "secret_key"),
    "webdav": ("url", "username", "password"),
}


class SyncIn(BaseModel):
    enabled: bool = False
    branch_id: str | None = None
    department_id: str | None = None
    prefix: str = Field(default="", max_length=300)
    folder: str = Field(default="", max_length=80)  # the Library folder its files go in


class TargetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["local", "s3", "webdav"]
    config: dict[str, str] = Field(default_factory=dict)
    is_primary: bool = False
    sync: SyncIn | None = None


class TargetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    config: dict[str, str] | None = None
    is_primary: bool | None = None
    sync: SyncIn | None = None


class TargetOut(BaseModel):
    id: str
    name: str
    kind: str
    config: dict[str, Any]
    is_primary: bool
    sync: dict[str, Any]
    files: int  # files whose bytes live here


async def _files(db: AsyncSession, t: StorageTarget) -> int:
    return int(
        await db.scalar(select(func.count()).select_from(DocFile).where(DocFile.storage_id == t.id))
        or 0
    )


async def _out(db: AsyncSession, t: StorageTarget) -> TargetOut:
    return TargetOut(
        id=t.id,
        name=t.name,
        kind=t.kind,
        config=storage.public_config(t),
        is_primary=t.is_primary,
        sync=dict(t.sync or {}),
        files=await _files(db, t),
    )


def _clean(kind: str, config: dict[str, str]) -> dict[str, str]:
    bad = set(config) - set(ALLOWED[kind])
    if bad:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_storage_config",
            "This kind of storage does not take {field}.",
            field=sorted(bad)[0],
        )
    return {k: str(v).strip() for k, v in config.items() if str(v).strip()}


async def _check_sync(db: AsyncSession, principal: Principal, s: SyncIn) -> dict[str, Any]:
    if s.enabled and not s.branch_id:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "branch_required",
            "Pick the company whose Library these documents are for.",
        )
    if s.branch_id:
        b = await db.get(Branch, s.branch_id)
        if b is None or b.workspace_id != principal.workspace_id:
            raise api_error(status.HTTP_400_BAD_REQUEST, "bad_branch", "Pick a branch from here.")
    if s.department_id:
        d = await db.get(Department, s.department_id)
        if d is None or d.branch_id != s.branch_id:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "bad_department", "Pick a department from here."
            )
    return s.model_dump()


async def _get(db: AsyncSession, principal: Principal, target_id: str) -> StorageTarget:
    t = await db.get(StorageTarget, target_id)
    if t is None or t.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "storage_not_found", "That storage is not here.")
    return t


async def _test(t: StorageTarget) -> None:
    try:
        await storage.check(t)
    except storage.StorageError as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "storage_check_failed", str(e)
        ) from e


async def _only_primary(db: AsyncSession, t: StorageTarget) -> None:
    await db.execute(
        update(StorageTarget)
        .where(StorageTarget.workspace_id == t.workspace_id, StorageTarget.id != t.id)
        .values(is_primary=False)
    )


@router.get("")
async def list_targets(
    principal: Principal = Depends(require("org.manage")), db: AsyncSession = Depends(get_db)
) -> list[TargetOut]:
    rows = (
        await db.scalars(
            select(StorageTarget)
            .where(StorageTarget.workspace_id == principal.workspace_id)
            .order_by(StorageTarget.created_at)
        )
    ).all()
    return [await _out(db, t) for t in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_target(
    body: TargetIn,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> TargetOut:
    t = StorageTarget(
        id=new_id("st"),
        workspace_id=principal.workspace_id,
        name=body.name.strip(),
        kind=body.kind,
        created_by=principal.actor,
        is_primary=False,
        sync={},
    )
    t.config = storage.seal_config(t.id, _clean(body.kind, body.config))
    await _test(t)  # never save a target that cannot store a file
    if body.sync is not None:
        t.sync = await _check_sync(db, principal, body.sync)
    db.add(t)
    await db.flush()
    if body.is_primary:
        await _only_primary(db, t)
        t.is_primary = True
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "storage.added",
        target=t.id,
        after={"name": t.name, "kind": t.kind, "primary": t.is_primary},
    )
    await db.commit()
    return await _out(db, t)


@router.patch("/{target_id}")
async def update_target(
    target_id: str,
    body: TargetPatch,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> TargetOut:
    t = await _get(db, principal, target_id)
    if body.name is not None:
        t.name = body.name.strip()
    if body.config is not None:
        fresh = _clean(t.kind, body.config)
        old = t.config or {}
        # P52: a saved password or key must never follow a new address it was not typed for
        # (it would be sent to that host on the next check), as with AI provider keys.
        for addr in ("endpoint", "url"):
            moved = addr in fresh and str(fresh.get(addr) or "").rstrip("/") != str(
                old.get(addr) or ""
            ).rstrip("/")
            had = any(old.get(f"{k}_enc") for k in storage.SECRET_FIELDS)
            if moved and had and not any(fresh.get(k) for k in storage.SECRET_FIELDS):
                raise api_error(
                    status.HTTP_400_BAD_REQUEST,
                    "secret_required_for_new_address",
                    "Changing the address needs the password or key typed again.",
                )
        merged = {k: v for k, v in (t.config or {}).items()}
        merged.update(storage.seal_config(t.id, fresh))
        t.config = merged
        flag_modified(t, "config")
        await _test(t)
    if body.sync is not None:
        t.sync = {**(t.sync or {}), **await _check_sync(db, principal, body.sync)}
        flag_modified(t, "sync")
    if body.is_primary is not None:
        if body.is_primary:
            await _only_primary(db, t)
        t.is_primary = body.is_primary
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "storage.changed",
        target=t.id,
        after={
            "name": t.name,
            "primary": t.is_primary,
            "sync": bool((t.sync or {}).get("enabled")),
        },
    )
    await db.commit()
    return await _out(db, t)


@router.post("/{target_id}/check")
async def check_target(
    target_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await _test(await _get(db, principal, target_id))
    return {"ok": True}


@router.post("/{target_id}/sync")
async def sync_target(
    target_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    t = await _get(db, principal, target_id)
    try:
        out = await sources.sync(db, t)
    except storage.StorageError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "sync_failed", str(e)) from e
    await audit.record(
        db, principal.workspace_id, principal.actor, "storage.synced", target=t.id, after=out
    )
    await db.commit()
    return out


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_target(
    target_id: str,
    principal: Principal = Depends(require("org.manage")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    t = await _get(db, principal, target_id)
    n = await _files(db, t)
    if n:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "storage_in_use",
            "{n} files are kept in this storage. Turn off its import and keep it until they "
            "are moved or deleted.",
            n=n,
        )
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "storage.deleted",
        target=t.id,
        before={"name": t.name, "kind": t.kind},
    )
    await db.delete(t)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
