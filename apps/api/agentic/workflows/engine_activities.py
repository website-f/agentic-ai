"""Activities for AI Engine background work. Runs in the worker, outside the sandbox."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio import activity

from ..core.db import SessionLocal
from ..engine import store, tester
from ..models import AIProvider, LLMCall

log = logging.getLogger("agentic.worker.engine")


RECENT = timedelta(hours=2)


async def _used_lately(db: AsyncSession, provider_id: str) -> bool:
    since = datetime.now(UTC) - RECENT
    return (
        await db.scalar(
            select(LLMCall.id)
            .where(
                LLMCall.provider_id == provider_id,
                LLMCall.status == "ok",
                LLMCall.task != "engine.test",
                LLMCall.ts >= since,
            )
            .limit(1)
        )
    ) is not None


@activity.defn
async def check_all_providers() -> dict[str, int]:
    """Key + chat check for every enabled provider with a key, in every workspace."""
    async with SessionLocal() as db:
        ids = (
            await db.scalars(
                select(AIProvider.id).where(
                    AIProvider.enabled.is_(True), AIProvider.api_key_enc != ""
                )
            )
        ).all()

    ok = failed = 0
    local_done: set[str] = set()
    for pid in ids:
        async with SessionLocal() as db:
            p = await db.get(AIProvider, pid)
            if p is None:
                continue
            # P52: the local backup model is one Ollama on this server, registered in every
            # workspace: check it once a round, not once per workspace (each check holds its
            # single CPU worker while real work waits).
            if p.tier == "local":
                if p.base_url in local_done:
                    continue
                local_done.add(p.base_url)
            # P52: real work answered by it lately proves it works: no test call (these were
            # ~11,000 calls a month, paid models included).
            if await _used_lately(db, p.id):
                ok += 1
                continue
            key = store.provider_key(p)
            if not key:
                continue
            target = tester.Target(
                workspace_id=p.workspace_id,
                base_url=p.base_url,
                key=key,
                preset=p.preset,
                name=p.name,
                tier=p.tier,
                provider=p,
                source="scheduled",
                model=(p.last_test_result or {}).get("model"),
            )
            result = False
            async for event in tester.run(target, db):
                if event.get("type") == "done":
                    result = bool(event.get("ok"))
            ok, failed = ok + result, failed + (not result)
            activity.heartbeat(pid)
    log.info("provider health: %s ok, %s failing", ok, failed)
    return {"ok": ok, "failed": failed}
