"""Nightly skill curator (runs inside the dream). It proposes; the autopilot or people decide.

- Two skills that overlap (similarity > 0.85): propose one merged skill.
- A skill nobody used for 60 days: propose retiring it (built-in skills are left alone).
- A skill accepted less than 70 % of the time over its last 20 judged uses: flag it, and
  (P17) draft a repair from the work that was sent back or failed with it. The repair is
  tested old vs new and goes live only if it does no worse (autopilot.py).
- Finally the autopilot tidies the queue: tests untested drafts, closes dead ones.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.facts import parse_json
from ..engine import gateway
from ..models import AgentMessage, Skill, SkillProposal, SkillUse, Task, Workspace
from . import autopilot
from . import format as fmt
from .store import SkillError, nearest, propose

log = logging.getLogger("agentic.skills.curator")

OVERLAP = 0.85
UNUSED_DAYS = 60
LOW_SUCCESS = 0.7
RECENT_USES = 20
MIN_JUDGED = 5
MAX_REPAIRS = 2  # repairs drafted per night (each costs a model call and two eval runs)
REPAIR_COOLDOWN_DAYS = 7  # after a repair attempt, give the skill a week of new evidence
FEEDBACK = "Feedback on your last answer:"  # how a send-back is recorded (reflect.FEEDBACK)

REPAIR = """A procedure ("skill") that AI office staff follow keeps producing work that people
send back or that fails. Below: the skill, and what went wrong on recent tasks that used it.
Find the cause in the skill's text (a missing step, a wrong instruction, a missing check, an
unclear output format) and fix it. Return JSON only:
{"fix": true, "why": "one sentence: what was wrong", "description": "one sentence",
 "body": "the full improved markdown: ## When to use, ## Steps, ## Output format, ## Pitfalls",
 "eval_cases": [{"title": "...", "input": "a realistic request", "must_contain": ["..."]}]}
Rules: fix the wrong text in place, keep what works, turn each correction into a general
rule in Pitfalls. If the failures are not the skill's fault (outages, bad inputs), return
{"fix": false, "why": "..."}. Never copy client names, amounts or secrets."""

MERGE = """Two procedures for an office overlap. Merge them into one that keeps every useful
step and pitfall from both, without repeating anything. Return JSON only:
{"description": "one sentence: what it does and when to use it",
 "body": "markdown with ## When to use, ## Steps, ## Output format, ## Pitfalls"}"""


async def _merge_text(db: AsyncSession, ws: Workspace, a: Skill, b: Skill) -> dict[str, Any]:
    user = f"SKILL {a.name}: {a.description}\n{a.body}\n\nSKILL {b.name}: {b.description}\n{b.body}"
    for group in ("fast", "smart"):
        try:
            r = await gateway.chat(
                db,
                ws.id,
                group,
                [{"role": "system", "content": MERGE}, {"role": "user", "content": user}],
                task="skill.curator",
                max_tokens=1400,
                temperature=0,
                json_mode=True,
                accept=lambda c: "body" in parse_json(c),
            )
            return parse_json(r.content)
        except gateway.GatewayUnavailable:
            continue
    return {}


async def _recent_success(
    db: AsyncSession, skill_id: str, version: int | None = None
) -> tuple[float | None, int]:
    q = select(SkillUse.outcome).where(SkillUse.skill_id == skill_id, SkillUse.outcome.is_not(None))
    if version is not None:
        q = q.where(SkillUse.version == version)
    outcomes = (await db.scalars(q.order_by(SkillUse.id.desc()).limit(RECENT_USES))).all()
    if len(outcomes) < MIN_JUDGED:
        return None, len(outcomes)
    return sum(1 for o in outcomes if o == "accepted") / len(outcomes), len(outcomes)


async def run(db: AsyncSession, ws: Workspace) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    skills = list(
        (
            await db.scalars(
                select(Skill).where(Skill.workspace_id == ws.id, Skill.status == "active")
            )
        ).all()
    )
    pending = {
        (p.skill_id, p.kind)
        for p in (
            await db.scalars(
                select(SkillProposal).where(
                    SkillProposal.workspace_id == ws.id, SkillProposal.status == "pending"
                )
            )
        ).all()
    }

    done_pairs: set[frozenset[str]] = set()
    for a in skills:
        if a.embedding is None:
            continue
        near = await nearest(db, ws.id, list(a.embedding), exclude=a.id)
        if near is None or near[1] <= OVERLAP:
            continue
        b, sim = near
        pair = frozenset((a.id, b.id))
        if pair in done_pairs or (a.id, "merge") in pending or (b.id, "merge") in pending:
            continue
        done_pairs.add(pair)
        keep, other = sorted((a, b), key=lambda s: (s.trust != "builtin", s.created_at))
        merged = await _merge_text(db, ws, keep, other)
        if not merged.get("body"):
            continue
        try:
            await propose(
                db,
                ws,
                kind="merge",
                skill=keep,
                other=other,
                name=keep.name,
                description=str(merged.get("description") or keep.description),
                body=str(merged["body"]),
                proposed_by="curator",
                reason=f"{keep.name} and {other.name} overlap ({round(sim * 100)}% similar).",
            )
            changes.append(
                {"kind": "skill", "action": "merge", "name": keep.name, "other": other.name}
            )
        except (SkillError, fmt.SkillFormatError):
            continue

    cutoff = datetime.now(UTC) - timedelta(days=UNUSED_DAYS)
    for s in skills:
        last = s.last_used_at or s.created_at
        if s.trust == "builtin" or last >= cutoff or (s.id, "retire") in pending:
            continue
        days = (datetime.now(UTC) - last).days
        await propose(
            db,
            ws,
            kind="retire",
            skill=s,
            name=s.name,
            description=s.description,
            body=s.body,
            proposed_by="curator",
            reason=f"Not used for {days} days.",
        )
        changes.append({"kind": "skill", "action": "retire", "name": s.name, "days": days})

    for s in skills:
        rate, n = await _recent_success(db, s.id)
        if rate is not None and rate < LOW_SUCCESS:
            changes.append(
                {
                    "kind": "skill",
                    "action": "flag",
                    "name": s.name,
                    "success_rate": round(rate, 2),
                    "uses": n,
                }
            )

    repaired = 0
    for s in skills:
        if repaired >= MAX_REPAIRS:
            break
        rate, n = await _recent_success(db, s.id, s.version)  # this version's record only
        if rate is None or rate >= LOW_SUCCESS or (s.id, "patch") in pending:
            continue
        if await _repaired_lately(db, s.id):
            continue
        try:
            p = await _repair(db, ws, s, rate, n)
        except Exception:  # noqa: BLE001 - one skill's repair never stops the dream
            log.warning("repair of %s failed", s.name, exc_info=True)
            continue
        if p is not None:
            repaired += 1
            changes.append({"kind": "skill", "action": "repair", "name": s.name, "uses": n})

    try:
        tidied = await autopilot.tidy(db, ws)
        if any(tidied.values()):
            changes.append({"kind": "skill", "action": "autopilot", **tidied})
    except Exception:  # noqa: BLE001
        log.warning("autopilot tidy failed for %s", ws.id, exc_info=True)
    return changes


async def _repaired_lately(db: AsyncSession, skill_id: str) -> bool:
    since = datetime.now(UTC) - timedelta(days=REPAIR_COOLDOWN_DAYS)
    return (
        await db.scalar(
            select(SkillProposal.id)
            .where(
                SkillProposal.skill_id == skill_id,
                SkillProposal.proposed_by == "curator",
                SkillProposal.kind == "patch",
                SkillProposal.created_at >= since,
            )
            .limit(1)
        )
    ) is not None


async def _evidence(db: AsyncSession, s: Skill) -> str:
    """What went wrong on recent work with this version: corrections first, then errors."""
    rows = (
        await db.execute(
            select(SkillUse.outcome, Task)
            .join(Task, Task.id == SkillUse.task_id)
            .where(
                SkillUse.skill_id == s.id,
                SkillUse.version == s.version,
                SkillUse.outcome.in_(("sent_back", "failed")),
            )
            .order_by(SkillUse.id.desc())
            .limit(6)
        )
    ).all()
    out: list[str] = []
    for outcome, task in rows:
        notes = (
            await db.scalars(
                select(AgentMessage.content)
                .where(
                    AgentMessage.task_id == task.id,
                    AgentMessage.role == "user",
                    AgentMessage.content.startswith(FEEDBACK),
                )
                .order_by(AgentMessage.id)
            )
        ).all()
        line = f'- "{task.title[:100]}" was {str(outcome).replace("_", " ")}.'
        for c in notes:
            line += f"\n  Person said: {(c or '').removeprefix(FEEDBACK).strip()[:400]}"
        if task.error:
            line += f"\n  Error: {task.error[:300]}"
        if task.result and not notes:
            line += f"\n  Answer given: {task.result[:400]}"
        out.append(line)
    return "\n".join(out)


async def _repair(
    db: AsyncSession, ws: Workspace, s: Skill, rate: float, n: int
) -> SkillProposal | None:
    evidence = await _evidence(db, s)
    if not evidence:
        return None
    user = (
        f"SKILL {s.name} (v{s.version}): {s.description}\n{s.body}\n\n"
        f"RECORD: accepted {round(rate * 100)}% of {n} judged uses.\n\n"
        f"WHAT WENT WRONG:\n{evidence}"
    )
    got: dict[str, Any] = {}
    for group in ("smart", "fast"):
        try:
            r = await gateway.chat(
                db,
                ws.id,
                group,
                [{"role": "system", "content": REPAIR}, {"role": "user", "content": user}],
                task="skill.repair",
                max_tokens=1600,
                temperature=0.2,
                json_mode=True,
                accept=lambda c: "fix" in parse_json(c),
            )
            got = parse_json(r.content)
            break
        except gateway.GatewayUnavailable:
            continue
    if not got.get("fix") or not got.get("body"):
        return None
    cases = got.get("eval_cases")
    try:
        return await propose(
            db,
            ws,
            kind="patch",
            skill=s,
            name=s.name,
            description=str(got.get("description") or s.description),
            body=str(got["body"]),
            proposed_by="curator",
            reason=(
                f"Repair: accepted only {round(rate * 100)}% of {n} uses. "
                f"{str(got.get('why') or '').strip()}"
            ).strip(),
            eval_cases=cases if isinstance(cases, list) else [],
        )
    except (SkillError, fmt.SkillFormatError) as e:
        log.info("no repair for %s: %s", s.name, e)
        return None
