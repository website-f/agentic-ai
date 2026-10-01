"""Liveness, readiness, and the system status card on the Command center."""

import asyncio
import json
import time
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ... import __version__
from ...core.config import settings
from ...core.db import get_db
from ...core.temporal import temporal_client
from ...core.valkey import valkey
from ...models import Agent, AIProvider, Approval, Branch, Department, Membership, Task
from ...workflows.system import PingWorkflow
from ..deps import Principal, require
from ..schemas import ComponentStatus, SystemStatusOut

router = APIRouter(tags=["system"])

WORKER_CHECK_CACHE_KEY = "system:worker_check"
WORKER_CHECK_TTL = 30  # seconds; avoids starting a workflow on every dashboard refresh


async def _timed(name: str, coro) -> ComponentStatus:
    t0 = time.perf_counter()
    try:
        detail = await asyncio.wait_for(coro, timeout=6)
        return ComponentStatus(
            name=name, ok=True, detail=detail, latency_ms=int((time.perf_counter() - t0) * 1000)
        )
    except Exception as e:  # noqa: BLE001 - status reporting, never raise
        msg = str(e) or e.__class__.__name__
        return ComponentStatus(
            name=name, ok=False, detail=msg[:200], latency_ms=int((time.perf_counter() - t0) * 1000)
        )


async def _db_check(db: AsyncSession) -> str:
    version = await db.scalar(text("SHOW server_version"))
    return f"PostgreSQL {version}"


async def _valkey_check() -> str:
    info = await valkey().info("server")
    return f"Valkey {info.get('valkey_version') or info.get('redis_version', '?')}"


async def _temporal_check() -> str:
    client = await temporal_client()
    await client.service_client.check_health()
    return f"namespace {settings.temporal_namespace}"


async def _worker_check() -> str:
    r = valkey()
    cached = await r.get(WORKER_CHECK_CACHE_KEY)
    if cached:
        data = json.loads(cached)
        if not data["ok"]:
            raise RuntimeError(data["detail"])
        return data["detail"]
    client = await temporal_client()
    try:
        result = await client.execute_workflow(
            PingWorkflow.run,
            "status",
            id=f"ping-{uuid.uuid4().hex[:12]}",
            task_queue=settings.temporal_task_queue,
            execution_timeout=timedelta(seconds=5),
        )
        detail = f"task queue {settings.temporal_task_queue} answered ({result})"
        await r.set(
            WORKER_CHECK_CACHE_KEY, json.dumps({"ok": True, "detail": detail}), ex=WORKER_CHECK_TTL
        )
        return detail
    except Exception as e:
        detail = f"no worker answered on {settings.temporal_task_queue}: {e}"
        await r.set(WORKER_CHECK_CACHE_KEY, json.dumps({"ok": False, "detail": detail}), ex=10)
        raise RuntimeError(detail) from e


@router.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
async def readyz(response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    checks = await asyncio.gather(
        _timed("database", _db_check(db)), _timed("valkey", _valkey_check())
    )
    ok = all(c.ok for c in checks)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ok": ok, "checks": [c.model_dump() for c in checks]}


@router.get("/api/system/status")
async def system_status(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> SystemStatusOut:
    components = [
        await _timed("Database", _db_check(db)),
        *await asyncio.gather(
            _timed("Valkey", _valkey_check()),
            _timed("Temporal", _temporal_check()),
            _timed("Worker", _worker_check()),
        ),
    ]
    ws = principal.workspace_id

    async def count(model) -> int:
        return (
            await db.scalar(select(func.count()).select_from(model).where(model.workspace_id == ws))
            or 0
        )

    counts = {
        "members": await count(Membership),
        "branches": await count(Branch),
        "departments": await count(Department),
        "providers": await count(AIProvider),
        "agents": await db.scalar(
            select(func.count())
            .select_from(Agent)
            .where(Agent.workspace_id == ws, Agent.status != "retired")
        )
        or 0,
        "tasks_running": await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.workspace_id == ws, Task.status.in_(("running", "blocked")))
        )
        or 0,
        "tasks_review": await db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.workspace_id == ws, Task.status == "review")
        )
        or 0,
        "approvals_pending": await db.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.workspace_id == ws, Approval.status == "pending")
        )
        or 0,
    }
    return SystemStatusOut(
        ok=all(c.ok for c in components), version=__version__, components=components, counts=counts
    )
