"""Activities for AI Engine background work. Runs in the worker, outside the sandbox."""

import logging

from sqlalchemy import select
from temporalio import activity

from ..core.db import SessionLocal
from ..engine import store, tester
from ..models import AIProvider

log = logging.getLogger("agentic.worker.engine")


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
    for pid in ids:
        async with SessionLocal() as db:
            p = await db.get(AIProvider, pid)
            if p is None:
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
