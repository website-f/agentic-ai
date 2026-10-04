"""Reports agents published (P9), filtered to what the person may see."""

import csv
import io
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import String, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import Agent, Branch, Report, Task
from .. import paging
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api/reports", tags=["reports"])


class ReportOut(BaseModel):
    id: str
    title: str
    summary: str
    body: str | None = None
    tables: list[dict[str, Any]] | None = None
    table_count: int
    row_count: int
    labels: list[str]
    agent_id: str | None
    agent_name: str | None
    agent_color: str | None
    branch_id: str | None
    branch_name: str | None
    task_id: str | None
    task_title: str | None
    created_at: datetime


def _scoped(q: Any, principal: Principal) -> Any:
    sc = principal.scope
    cond = sc.agent_where()
    if cond is None:
        return q
    visible = select(Agent.id).where(Agent.workspace_id == principal.workspace_id, cond)
    parts = [Report.agent_id.in_(visible)]
    if sc.kind == "branch" and sc.branch_id:
        parts.append(Report.branch_id == sc.branch_id)
    return q.where(or_(*parts))


async def _out(db: AsyncSession, r: Report, full: bool) -> ReportOut:
    a = await db.get(Agent, r.agent_id) if r.agent_id else None
    b = await db.get(Branch, r.branch_id) if r.branch_id else None
    t = await db.get(Task, r.task_id) if r.task_id else None
    return ReportOut(
        id=r.id,
        title=r.title,
        summary=r.summary,
        body=r.body if full else None,
        tables=r.tables if full else None,
        table_count=len(r.tables or []),
        row_count=sum(len(x.get("rows") or []) for x in r.tables or []),
        labels=r.labels or [],
        agent_id=r.agent_id,
        agent_name=a.name if a else None,
        agent_color=a.color if a else None,
        branch_id=r.branch_id,
        branch_name=b.name if b else None,
        task_id=r.task_id,
        task_title=t.title if t else None,
        created_at=r.created_at,
    )


async def _get(db: AsyncSession, principal: Principal, report_id: str) -> Report:
    r = await db.scalar(
        _scoped(
            select(Report).where(
                Report.id == report_id, Report.workspace_id == principal.workspace_id
            ),
            principal,
        )
    )
    if r is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "report_not_found", "That report is not here.")
    return r


@router.get("")
async def list_reports(
    response: Response,
    branch_id: str | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
    label: str | None = None,
    q_: str = Query(default="", alias="q", max_length=120),
    limit: int = Query(default=100, ge=1, le=300),
    cursor: str | None = Query(default=None, max_length=400),
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ReportOut]:
    """Newest first. Pages with `limit` + `cursor` (X-Next-Cursor, X-Total-Count)."""
    q = _scoped(select(Report).where(Report.workspace_id == principal.workspace_id), principal)
    if branch_id:
        q = q.where(Report.branch_id == branch_id)
    if agent_id:
        q = q.where(Report.agent_id == agent_id)
    if task_id:
        q = q.where(Report.task_id == task_id)
    if label:
        q = q.where(Report.labels.contains([label.lower()]))
    if q_.strip():
        like = f"%{q_.strip()}%"
        named = select(Agent.id).where(
            Agent.workspace_id == principal.workspace_id, Agent.name.ilike(like)
        )
        q = q.where(
            or_(
                Report.title.ilike(like),
                Report.summary.ilike(like),
                cast(Report.labels, String).ilike(like),
                Report.agent_id.in_(named),
            )
        )
    rows = await paging.paginate(
        db,
        q,
        ((Report.created_at, True), (Report.id, True)),
        limit=limit,
        cursor=cursor,
        response=response,
    )
    return [await _out(db, r, False) for r in rows]


@router.get("/{report_id}")
async def read_report(
    report_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ReportOut:
    return await _out(db, await _get(db, principal, report_id), True)


@router.get("/{report_id}/table/{n}.csv")
async def table_csv(
    report_id: str,
    n: int,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    r = await _get(db, principal, report_id)
    tables = r.tables or []
    if not 0 <= n < len(tables):
        raise api_error(status.HTTP_404_NOT_FOUND, "no_table", "That table is not here.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(tables[n]["columns"])
    for row in tables[n]["rows"]:
        # Cells that start like a formula are quoted so spreadsheets do not run them.
        w.writerow(["'" + c if isinstance(c, str) and c[:1] in "=+-@" else c for c in row])
    name = "".join(ch if ch.isalnum() else "-" for ch in r.title.lower())[:60] or "report"
    return Response(
        "﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}-{n + 1}.csv"'},
    )
