"""P81: delete many files and SOPs at once (Library, Browse, SOPs), with the same rules as
deleting one:

- a file: `work.write` and a file this person may change (files.get_file's scope); its
  library passages, search index entries and stored bytes go with it;
- an SOP: `org.manage`; it is detached from every agent and its passages go.

POST /api/library/delete {files: [ids], sops: [ids]} (at most MAX_ITEMS in one call). What
this person may not delete, or what is already gone, is skipped and listed with the reason;
the rest goes in one transaction. Bytes in storage are deleted after the commit, so a failed
commit never leaves rows whose files are gone.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...documents import service
from ...knowledge import indexer
from ...models import SOP, Agent, CompanyKit, DocFile, StorageTarget
from ...search.models import SearchHeading, SearchPassage, SearchSource
from ...services import audit
from ..deps import Principal, require

router = APIRouter(tags=["library"])
log = logging.getLogger("agentic.api.bulk_delete")

MAX_ITEMS = 500


class BulkDeleteIn(BaseModel):
    files: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    sops: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)


class Skipped(BaseModel):
    kind: Literal["file", "sop"]
    id: str
    reason: Literal["not_allowed", "not_found"]


class BulkDeleteOut(BaseModel):
    files: int
    sops: int
    skipped: list[Skipped]


async def _drop_search(db: AsyncSession, kind: str, ids: list[str]) -> None:
    """The search index's rows for these sources (a sync would drop them later anyway)."""
    for model in (SearchPassage, SearchHeading, SearchSource):
        await db.execute(delete(model).where(model.source_kind == kind, model.source_id.in_(ids)))


@router.post("/api/library/delete")
async def bulk_delete(
    body: BulkDeleteIn,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> BulkDeleteOut:
    ws = principal.workspace_id
    skipped: list[Skipped] = []
    file_ids = [i for i in dict.fromkeys(body.files) if i][:MAX_ITEMS]
    sop_ids = [i for i in dict.fromkeys(body.sops) if i][:MAX_ITEMS]

    # ---- files: the ones this person may change (as files.delete_file)
    files: list[DocFile] = []
    if file_ids and not can(principal.role, "work.write"):
        skipped += [Skipped(kind="file", id=i, reason="not_allowed") for i in file_ids]
    elif file_ids:
        files = list(
            (
                await db.scalars(
                    service.scoped(
                        select(DocFile).where(DocFile.workspace_id == ws, DocFile.id.in_(file_ids)),
                        DocFile,
                        principal,
                    )
                )
            ).all()
        )
        found = {f.id for f in files}
        missing = [i for i in file_ids if i not in found]
        if missing:
            # Here but not theirs (another company's, someone's private work) vs gone.
            exists = set(
                (
                    await db.scalars(
                        select(DocFile.id).where(
                            DocFile.workspace_id == ws, DocFile.id.in_(missing)
                        )
                    )
                ).all()
            )
            skipped += [
                Skipped(kind="file", id=i, reason="not_allowed" if i in exists else "not_found")
                for i in missing
            ]
    bytes_to_forget: list[tuple[str, str]] = []
    if files:
        ids = [f.id for f in files]
        await db.execute(
            update(CompanyKit)
            .where(CompanyKit.logo_file_id.in_(ids))
            .values(logo_file_id=None)
            .execution_options(synchronize_session=False)
        )
        for f in files:
            await audit.record(
                db, ws, principal.actor, "file.deleted", target=f.id, before={"name": f.name}
            )
            await indexer.remove(db, "file", f.id)  # P18: its library passages go with it
            # P40: only what we wrote ourselves (agentic/...): a company's own files never are.
            if f.storage_id and f.storage_key and f.storage_key.startswith("agentic/"):
                bytes_to_forget.append((f.storage_id, f.storage_key))
        await _drop_search(db, "file", ids)
        await db.execute(delete(DocFile).where(DocFile.workspace_id == ws, DocFile.id.in_(ids)))

    # ---- SOPs: org.manage, as sops.delete_sop
    sops: list[SOP] = []
    if sop_ids and not can(principal.role, "org.manage"):
        skipped += [Skipped(kind="sop", id=i, reason="not_allowed") for i in sop_ids]
    elif sop_ids:
        sops = list(
            (await db.scalars(select(SOP).where(SOP.workspace_id == ws, SOP.id.in_(sop_ids)))).all()
        )
        found = {s.id for s in sops}
        skipped += [
            Skipped(kind="sop", id=i, reason="not_found") for i in sop_ids if i not in found
        ]
    if sops:
        gone = {s.id for s in sops}
        for a in (await db.scalars(select(Agent).where(Agent.workspace_id == ws))).all():
            if gone.intersection(a.sop_ids or []):
                a.sop_ids = [x for x in a.sop_ids if x not in gone]
        for s in sops:
            await audit.record(
                db, ws, principal.actor, "sop.deleted", target=s.id, before={"title": s.title}
            )
            await indexer.remove(db, "sop", s.id)
        await _drop_search(db, "sop", list(gone))
        await db.execute(delete(SOP).where(SOP.workspace_id == ws, SOP.id.in_(list(gone))))

    if files or sops:
        await audit.record(
            db,
            ws,
            principal.actor,
            "library.bulk_deleted",
            after={"files": len(files), "sops": len(sops), "skipped": len(skipped)},
        )
    await db.commit()
    if files or sops:
        from ...search import index as search_index

        await search_index._bump(ws)  # suggestion caches key on the index generation
    await _forget_bytes(db, bytes_to_forget)
    return BulkDeleteOut(files=len(files), sops=len(sops), skipped=skipped)


async def _forget_bytes(db: AsyncSession, items: list[tuple[str, str]]) -> None:
    """Delete stored bytes after the rows are gone (documents.storage.forget, in bulk)."""
    if not items:
        return
    from ...documents import storage

    targets = {
        t.id: t
        for t in (
            await db.scalars(
                select(StorageTarget).where(StorageTarget.id.in_({sid for sid, _ in items}))
            )
        ).all()
    }
    for sid, key in items:
        t = targets.get(sid)
        if t is None:
            continue
        try:
            await storage.delete(t, key)
        except Exception as e:  # noqa: BLE001 - the row is gone; a stray object is only space
            log.warning("could not delete %s from %s: %s", key, sid, e)
