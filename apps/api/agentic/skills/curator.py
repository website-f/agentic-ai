"""Nightly skill curator (runs inside the dream). It only ever proposes; people decide.

- Two skills that overlap (similarity > 0.85): propose one merged skill.
- A skill nobody used for 60 days: propose retiring it (built-in skills are left alone).
- A skill accepted less than 70 % of the time over its last 20 judged uses: flag it.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.facts import parse_json
from ..engine import gateway
from ..models import Skill, SkillProposal, SkillUse, Workspace
from . import format as fmt
from .store import SkillError, nearest, propose

OVERLAP = 0.85
UNUSED_DAYS = 60
LOW_SUCCESS = 0.7
RECENT_USES = 20
MIN_JUDGED = 5

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
            )
            return parse_json(r.content)
        except gateway.GatewayUnavailable:
            continue
    return {}


async def _recent_success(db: AsyncSession, skill_id: str) -> tuple[float | None, int]:
    outcomes = (
        await db.scalars(
            select(SkillUse.outcome)
            .where(SkillUse.skill_id == skill_id, SkillUse.outcome.is_not(None))
            .order_by(SkillUse.id.desc())
            .limit(RECENT_USES)
        )
    ).all()
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
    return changes
