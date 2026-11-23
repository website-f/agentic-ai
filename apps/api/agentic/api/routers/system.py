"""Liveness, readiness, and the system status card on the Command center."""

import asyncio
import json
import time
import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ... import __version__
from ...core.config import settings
from ...core.db import get_db
from ...core.security import APPROVER_ROLES, can
from ...core.temporal import temporal_client
from ...core.valkey import valkey
from ...models import (
    SOP,
    Agent,
    AIProvider,
    Approval,
    Branch,
    Department,
    DocFile,
    Membership,
    ModelGroup,
    SkillProposal,
    Task,
)
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


def _cond(c) -> tuple:
    return () if c is None else (c,)


@router.get("/api/system/status")
async def system_status(
    principal: Principal = Depends(require("read")), db: AsyncSession = Depends(get_db)
) -> SystemStatusOut:
    # P123 (polled every 15 s by the home page): Valkey, Temporal and the worker are asked while
    # the database counts run (they never touch this session), and the counts are one query.
    others = asyncio.ensure_future(
        asyncio.gather(
            _timed("Valkey", _valkey_check()),
            _timed("Temporal", _temporal_check()),
            _timed("Worker", _worker_check()),
        )
    )
    try:
        database = await _timed("Database", _db_check(db))
        counts = await _counts(db, principal)
    except BaseException:
        others.cancel()
        raise
    components = [database, *await others]
    # P92: the office beyond one's own work (members, companies, AI providers, skills, every
    # agent and task) is for people who may open the office (office.view). Everyone else, staff
    # above all, gets their own numbers: their agents, their work, the decisions waiting for
    # them (the app badge), and no infrastructure detail.
    if not can(principal.role, "office.view"):
        components = [c.model_copy(update={"detail": ""}) for c in components]
    return SystemStatusOut(
        ok=all(c.ok for c in components), version=__version__, components=components, counts=counts
    )


async def _counts(db: AsyncSession, principal: Principal) -> dict[str, int]:
    """The status card's numbers, each read by its own count, all in one round trip."""
    from .documents import review_queue_query

    ws = principal.workspace_id
    office = can(principal.role, "office.view")
    sc = principal.scope
    task_cond = sc.task_where()
    approval_cond = sc.approval_where()

    def count(model) -> Any:
        return select(func.count()).select_from(model).where(model.workspace_id == ws)

    asked: dict[str, Any] = {}
    if office:
        asked |= {
            "members": count(Membership),
            "branches": count(Branch),
            "departments": count(Department),
            "providers": count(AIProvider),
        }
    asked |= {
        "agents": select(func.count())
        .select_from(Agent)
        .where(Agent.workspace_id == ws, Agent.status != "retired", sc.agent_where()),
        "tasks_running": select(func.count())
        .select_from(Task)
        .where(Task.workspace_id == ws, Task.status.in_(("running", "blocked")))
        .where(*_cond(task_cond)),
        "tasks_review": select(func.count())
        .select_from(Task)
        .where(Task.workspace_id == ws, Task.status == "review")
        .where(*_cond(task_cond)),
        "approvals_pending": select(func.count())
        .select_from(Approval)
        .where(Approval.workspace_id == ws, Approval.status == "pending")
        .where(*_cond(approval_cond)),
        # P25: documents agents made that wait for this person (scoped like Documents).
        "documents_review": review_queue_query(principal).with_only_columns(func.count()),
        "tasks": select(func.count())
        .select_from(Task)
        .where(Task.workspace_id == ws)
        .where(*_cond(task_cond)),
    }
    if office:
        asked |= {
            "skill_proposals_pending": select(func.count())
            .select_from(SkillProposal)
            .where(SkillProposal.workspace_id == ws, SkillProposal.status == "pending"),
            # P36 setup steps: the company's documents in the library, and its active SOPs.
            "library_files": select(func.count())
            .select_from(DocFile)
            .where(DocFile.workspace_id == ws, DocFile.library.is_(True)),
            "library_sops": select(func.count())
            .select_from(SOP)
            .where(SOP.workspace_id == ws, SOP.status == "active"),
        }
    if principal.role in APPROVER_ROLES:  # P125: IT support's changes for an owner / admin
        from ...org.held_models import HeldChange
        from .held_changes import pending_count_where

        asked["it_changes_pending"] = (
            select(func.count()).select_from(HeldChange).where(pending_count_where(principal))
        )
    row = (
        await db.execute(select(*(q.scalar_subquery().label(k) for k, q in asked.items())))
    ).one()
    got = {k: int(v or 0) for k, v in zip(asked, row, strict=True)}
    # P36: the models agents can chat with ("smart" group).
    chat_models = (
        len(
            await db.scalar(
                select(ModelGroup.members).where(
                    ModelGroup.workspace_id == ws, ModelGroup.name == "smart"
                )
            )
            or []
        )
        if office
        else 0
    )
    return {
        "members": got.get("members", 0),
        "branches": got.get("branches", 0),
        "departments": got.get("departments", 0),
        "providers": got.get("providers", 0),
        "agents": got["agents"],
        "tasks_running": got["tasks_running"],
        "tasks_review": got["tasks_review"],
        "approvals_pending": got["approvals_pending"],
        "skill_proposals_pending": got.get("skill_proposals_pending", 0),
        "it_changes_pending": got.get("it_changes_pending", 0),
        "documents_review": got["documents_review"],
        "chat_models": chat_models,
        "library": got.get("library_files", 0) + got.get("library_sops", 0),
        "tasks": got["tasks"],
    }
