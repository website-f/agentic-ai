"""P45: what each agent learned this week, so a manager can see it and promote the good parts.

Built from the rows the office already keeps (no model call, no tokens):
- work: tasks it finished;
- facts it learned (BrainFact, its own), and lessons from people saying no (source "person");
- skills: proposals from its work (new, approved), and how often its skills were used and
  accepted;
- routines: new ones learned from its work, how often it ran one, and the tokens that saved.

Plus what waits for a manager: routines still learning (Trust one to start using it now) and
skill proposals to decide.

Every Monday at 08:00 (workspace time) the week before is written as a Report
("learning", "weekly"), seen by owners and admins, who get a notice. The Learning page shows
any week live, for the agents the person may see.
"""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg, tr
from ..models import (
    Agent,
    BrainFact,
    Report,
    Routine,
    SkillProposal,
    SkillUse,
    Task,
    TaskEvent,
    Workspace,
)

EXAMPLES = 3
TO_TRUST = 10
REPORT_HOUR = 8  # Monday, workspace time: when people start the week


def week_of(day: date) -> tuple[date, date]:
    """Monday and the next Monday of the week `day` is in."""
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=7)


def week_label(monday: date) -> str:
    y, w, _ = monday.isocalendar()
    return f"{y}-W{w:02d}"


def parse_week(text: str | None, today: date) -> date:
    """ "2026-W43" -> its Monday; anything else: this week's Monday."""
    if text:
        try:
            y, w = text.upper().split("-W")
            return date.fromisocalendar(int(y), int(w), 1)
        except ValueError:
            pass
    return week_of(today)[0]


def _bounds(monday: date, tz: str) -> tuple[datetime, datetime]:
    z = ZoneInfo(tz)
    start = datetime.combine(monday, time(0), z).astimezone(UTC)
    return start, start + timedelta(days=7)


async def gather(
    db: AsyncSession,
    ws: Workspace,
    monday: date,
    agents_where: ColumnElement[bool] | None = None,
) -> dict[str, Any]:
    """The week starting `monday`, per agent (only the agents `agents_where` allows)."""
    start, end = _bounds(monday, ws.timezone)
    q = select(Agent).where(Agent.workspace_id == ws.id, Agent.status != "retired")
    if agents_where is not None:
        q = q.where(agents_where)
    agents = {a.id: a for a in (await db.scalars(q)).all()}
    ids = list(agents)
    rows: dict[str, dict[str, Any]] = {
        a.id: {
            "id": a.id,
            "name": a.name,
            "role": a.role,
            "color": a.color,
            "done": 0,
            "facts": 0,
            "fact_examples": [],
            "lessons": 0,
            "lesson_examples": [],
            "skills_proposed": 0,
            "skills_approved": 0,
            "skill_uses": 0,
            "skill_accepted": 0,
            "routines_learned": 0,
            "routine_runs": 0,
            "tokens_saved": 0,
        }
        for a in agents.values()
    }
    if not ids:
        return _wrap(monday, rows, [], 0)

    for aid, n in (
        await db.execute(
            select(Task.assignee_agent_id, func.count())
            .where(
                Task.workspace_id == ws.id,
                Task.assignee_agent_id.in_(ids),
                Task.status == "done",
                Task.finished_at >= start,
                Task.finished_at < end,
            )
            .group_by(Task.assignee_agent_id)
        )
    ).all():
        if aid is None or aid not in rows:
            continue
        rows[aid]["done"] = n

    facts = (
        await db.execute(
            select(BrainFact.agent_id, BrainFact.source_kind, BrainFact.text)
            .where(
                BrainFact.workspace_id == ws.id,
                BrainFact.agent_id.in_(ids),
                BrainFact.created_at >= start,
                BrainFact.created_at < end,
                BrainFact.valid_to.is_(None),
            )
            .order_by(BrainFact.confidence.desc(), BrainFact.created_at.desc())
        )
    ).all()
    for aid, kind, text in facts:
        if aid is None or aid not in rows:
            continue
        r = rows[aid]
        key = "lessons" if kind == "person" else "facts"
        r[key] += 1
        if len(r[f"{key[:-1]}_examples"]) < EXAMPLES:
            r[f"{key[:-1]}_examples"].append(str(text)[:200])

    for aid, status, n in (
        await db.execute(
            select(SkillProposal.agent_id, SkillProposal.status, func.count())
            .where(
                SkillProposal.workspace_id == ws.id,
                SkillProposal.agent_id.in_(ids),
                SkillProposal.created_at >= start,
                SkillProposal.created_at < end,
            )
            .group_by(SkillProposal.agent_id, SkillProposal.status)
        )
    ).all():
        if aid is None or aid not in rows:
            continue
        rows[aid]["skills_proposed"] += n
        if status == "approved":
            rows[aid]["skills_approved"] += n

    for aid, outcome, n in (
        await db.execute(
            select(SkillUse.agent_id, SkillUse.outcome, func.count())
            .where(
                SkillUse.workspace_id == ws.id,
                SkillUse.agent_id.in_(ids),
                SkillUse.created_at >= start,
                SkillUse.created_at < end,
            )
            .group_by(SkillUse.agent_id, SkillUse.outcome)
        )
    ).all():
        if aid is None or aid not in rows:
            continue
        rows[aid]["skill_uses"] += n
        if outcome == "accepted":
            rows[aid]["skill_accepted"] += n

    for aid, n in (
        await db.execute(
            select(Routine.agent_id, func.count())
            .where(
                Routine.workspace_id == ws.id,
                Routine.agent_id.in_(ids),
                Routine.created_at >= start,
                Routine.created_at < end,
            )
            .group_by(Routine.agent_id)
        )
    ).all():
        if aid is None or aid not in rows:
            continue
        rows[aid]["routines_learned"] = n

    runs: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for aid, data in (
        await db.execute(
            select(Task.assignee_agent_id, TaskEvent.data)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(
                Task.workspace_id == ws.id,
                Task.assignee_agent_id.in_(ids),
                TaskEvent.kind == "routine_run",
                TaskEvent.ts >= start,
                TaskEvent.ts < end,
            )
        )
    ).all():
        if aid is None or aid not in rows:
            continue
        if (data or {}).get("state") == "done":
            runs[aid][0] += 1
            runs[aid][1] += int((data or {}).get("saved") or 0)
    for aid, (n, saved) in runs.items():
        rows[aid]["routine_runs"] = n
        rows[aid]["tokens_saved"] = saved

    trust_q = (
        select(Routine)
        .where(Routine.workspace_id == ws.id, Routine.status == "candidate")
        .order_by(Routine.created_at.desc())
        .limit(TO_TRUST)
    )
    if agents_where is not None:
        trust_q = trust_q.where(Routine.agent_id.in_(ids))
    to_trust = [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "agent_id": r.agent_id,
            "agent_name": agents[r.agent_id].name if r.agent_id in agents else None,
            "baseline_tokens": r.baseline_tokens or 0,
        }
        for r in (await db.scalars(trust_q)).all()
    ]
    pending_skills = (
        await db.scalar(
            select(func.count())
            .select_from(SkillProposal)
            .where(SkillProposal.workspace_id == ws.id, SkillProposal.status == "pending")
        )
        or 0
    )
    return _wrap(monday, rows, to_trust, pending_skills)


def _wrap(
    monday: date, rows: dict[str, dict[str, Any]], to_trust: list[dict], pending_skills: int
) -> dict[str, Any]:
    agents = sorted(
        rows.values(),
        key=lambda r: (
            -(r["facts"] + r["lessons"] + r["skills_proposed"] + r["routines_learned"]),
            -r["done"],
            r["name"],
        ),
    )
    keys = ("done", "facts", "lessons", "skills_proposed", "skills_approved", "routines_learned",
            "routine_runs", "tokens_saved")  # fmt: skip
    return {
        "week": week_label(monday),
        "start": monday.isoformat(),
        "end": (monday + timedelta(days=6)).isoformat(),
        "agents": agents,
        "totals": {k: sum(r[k] for r in agents) for k in keys},
        "to_trust": to_trust,
        "pending_skills": pending_skills,
    }


def _body(data: dict[str, Any], lang: str) -> str:
    t = data["totals"]
    lines = [
        tr(
            "This week the AI team finished {done} tasks, learned {facts} facts and {lessons} "
            "lessons, proposed {skills} skills and learned {routines} routines. Routines ran "
            "{runs} times and saved about {saved} tokens.",
            lang,
            done=t["done"],
            facts=t["facts"],
            lessons=t["lessons"],
            skills=t["skills_proposed"],
            routines=t["routines_learned"],
            runs=t["routine_runs"],
            saved=f"{t['tokens_saved']:,}",
        ),
        "",
    ]
    for a in data["agents"]:
        if not (a["done"] or a["facts"] or a["lessons"] or a["skills_proposed"]
                or a["routines_learned"] or a["routine_runs"]):  # fmt: skip
            continue
        lines.append(f"## {a['name']} ({a['role']})")
        for ex in a["fact_examples"] + a["lesson_examples"]:
            lines.append(f"- {ex}")
        lines.append("")
    if data["to_trust"]:
        lines.append(
            tr(
                "{n} routines are still learning. Trust the good ones on the Learning page so "
                "they start saving tokens now.",
                lang,
                n=len(data["to_trust"]),
            )
        )
    if data["pending_skills"]:
        lines.append(tr("{n} skill proposals wait for a decision.", lang, n=data["pending_skills"]))
    return "\n".join(lines).strip()


async def write_report(db: AsyncSession, ws: Workspace, monday: date) -> Report | None:
    """The week's report, once (Report.call_id). None when it exists already."""
    from ..documents import provenance

    key = f"learning:week:{week_label(monday)}"
    if await db.scalar(
        select(Report.id).where(Report.workspace_id == ws.id, Report.call_id == key)
    ):
        return None
    data = await gather(db, ws, monday)
    lang = await provenance.folder_lang(db, ws.id, None)
    cols = [tr(c, lang) for c in ("Agent", "Tasks done", "Facts", "Lessons", "Skills proposed",
                                  "Routines learned", "Routine runs", "Tokens saved")]  # fmt: skip
    r = Report(
        workspace_id=ws.id,
        call_id=key,
        title=tr("What the AI team learned: week of {date}", lang, date=monday.isoformat()),
        summary=_body(data, lang).split("\n")[0][:600],
        body=_body(data, lang),
        tables=[
            {
                "title": tr("Per agent", lang),
                "columns": cols,
                "rows": [
                    [
                        a["name"],
                        a["done"],
                        a["facts"],
                        a["lessons"],
                        a["skills_proposed"],
                        a["routines_learned"],
                        a["routine_runs"],
                        a["tokens_saved"],
                    ]  # fmt: skip
                    for a in data["agents"]
                ],
            }
        ],
        labels=["learning", "weekly"],
        created_at=datetime.now(UTC),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


async def tick(db: AsyncSession, now: datetime | None = None) -> int:
    """Hourly: on Mondays at REPORT_HOUR (workspace time), last week's report and a notice to
    owners and admins. Returns how many reports were written."""
    from ..channels import deliver

    now = now or datetime.now(UTC)
    made = 0
    for ws in (await db.scalars(select(Workspace))).all():
        local = now.astimezone(ZoneInfo(ws.timezone))
        if local.weekday() != 0 or local.hour != REPORT_HOUR:
            continue
        monday = week_of(local.date())[0] - timedelta(days=7)
        r = await write_report(db, ws, monday)
        if r is None:
            continue
        made += 1
        await deliver.notify_people(
            db,
            ws.id,
            Msg("What the AI team learned last week"),
            Msg("See what each agent learned, and trust the routines that are ready."),
            "/learning?tab=week",
            dedupe=f"learning-week:{ws.id}:{week_label(monday)}",
            perm="org.manage",
        )
    return made


__all__ = ["gather", "parse_week", "tick", "week_label", "week_of", "write_report"]
