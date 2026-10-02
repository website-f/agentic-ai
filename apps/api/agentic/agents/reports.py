"""Reports agents publish for people (P9): a summary, markdown, and tables.

One report per tool call (a retried step finds the one it already wrote). Tables are
cleaned to plain strings and numbers and capped, so a runaway model cannot store megabytes.
"""

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.redact import redact
from ..models import Agent, Report, Task

MAX_TABLES = 6
MAX_COLS = 12
MAX_ROWS = 500
MAX_CELL = 400
MAX_BODY = 40_000


# "132,000.00" or "-1,250" in a table is a number the model wrote as text: store it as one so
# the column sorts, aligns and sums like a number. Anything else ("RM 12", "PQ001") stays text.
_NUMBER = re.compile(r"^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$")


def _cell(v: Any) -> str | int | float:
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int | float):
        return v
    text = str(v if v is not None else "").strip()
    if (
        _NUMBER.match(text)
        and len(text.replace(",", "").lstrip("-").split(".")[0]) <= 12  # ids stay text
        and not (len(text) > 1 and text[0] == "0" and text[1] != ".")
    ):
        n = float(text.replace(",", ""))
        return int(n) if n.is_integer() and "." not in text else n
    return redact(text)[:MAX_CELL]


def clean_tables(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for t in raw[:MAX_TABLES]:
        if not isinstance(t, dict):
            continue
        cols = [str(c)[:80] for c in (t.get("columns") or [])][:MAX_COLS]
        if not cols:
            continue
        rows = []
        for r in (t.get("rows") or [])[:MAX_ROWS]:
            if isinstance(r, dict):
                r = [r.get(c) for c in cols]
            if not isinstance(r, list):
                continue
            cells = [_cell(v) for v in r[: len(cols)]]
            rows.append(cells + [""] * (len(cols) - len(cells)))
        out.append({"title": str(t.get("title") or "")[:160], "columns": cols, "rows": rows})
    return out


async def save_report(
    db: AsyncSession, agent: Agent, task: Task | None, args: dict[str, Any], call_id: str = ""
) -> tuple[Report, bool]:
    title = str(args.get("title") or "").strip()[:200]
    if not title:
        raise ValueError("give the report a title")
    if task is not None:
        prior = await db.scalar(
            select(Report).where(Report.task_id == task.id, Report.title == title)
        )
        if prior is not None:  # a retried step, or a second draft: update in place
            _fill(prior, args)
            await db.commit()
            return prior, False
    r = Report(
        workspace_id=agent.workspace_id,
        branch_id=agent.branch_id,
        agent_id=agent.clone_of or agent.id,
        task_id=task.id if task else None,
        call_id=call_id or None,
        title=title,
        created_at=datetime.now(UTC),
    )
    _fill(r, args)
    db.add(r)
    await db.commit()
    return r, True


def _fill(r: Report, args: dict[str, Any]) -> None:
    r.summary = redact(str(args.get("summary") or ""))[:600]
    r.body = redact(str(args.get("body") or ""))[:MAX_BODY]
    r.tables = clean_tables(args.get("tables"))
    r.labels = [str(x).lower()[:32] for x in (args.get("labels") or []) if str(x).strip()][:8]
