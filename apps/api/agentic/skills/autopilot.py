"""The learning autopilot (P17): skill changes that prove themselves go live without a person.

Hermes lets its background reviewer write skills directly, with no measurement. Here every
change is measured first: a proposal is approved automatically only when the safety scan is
clean and its evals show it is at least as good as the version it replaces. Everything else
waits for a person, as before. Every automatic change is versioned, audited, announced and
can be rolled back in one click.

Modes (workspace setting `skill_learning.mode`):
- review     every change waits for a person (the old behaviour)
- auto_safe  (default) proven changes go live; unproven ones wait
- auto       also approve changes with no test cases, if the scan is clean
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import store as brain_store
from ..models import Skill, SkillProposal, SkillVersion, Workspace
from ..services import audit, events
from .scan import blocked
from .store import SkillError, approve

log = logging.getLogger("agentic.skills.autopilot")

MODES = ("review", "auto_safe", "auto")
DEFAULT_MODE = "auto_safe"
AUTOPILOT = brain_store.Author("system:autopilot", "Learning autopilot")
MIN_PASS_RATE = 0.6  # a brand-new skill must pass most of its own cases
STALE_DAYS = 14  # pending proposals nobody looked at for this long are closed


def mode(ws: Workspace) -> str:
    m = ((ws.settings or {}).get("skill_learning") or {}).get("mode", DEFAULT_MODE)
    return m if m in MODES else DEFAULT_MODE


def verdict(p: SkillProposal, how: str) -> tuple[bool, str]:
    """May this proposal go live on its own? (yes/no, and why, in plain words)."""
    if how == "review":
        return False, "the workspace reviews every skill change by hand"
    if p.kind == "retire":
        return False, "retiring a skill is always a person's call"
    if blocked(p.scan or []):
        return False, "the safety scan blocked it"
    if any(f.get("level") == "warn" for f in p.scan or []):
        return False, "the safety scan raised a warning"
    ev: dict[str, Any] = p.eval or {}
    new, old = ev.get("new") or {}, ev.get("old")
    if not new or new.get("error") or not new.get("total"):
        if how == "auto":
            return True, "no test cases; auto mode approves clean changes"
        return False, "it has no test results yet"
    rate = new["passed"] / new["total"]
    score = f"{new['passed']}/{new['total']}"
    if old and not old.get("error") and old.get("total"):
        before = f"{old['passed']}/{old['total']}"
        if new["passed"] < old["passed"]:
            return False, f"it does worse than the current version ({score} vs {before} cases)"
        if rate < MIN_PASS_RATE and new["passed"] == old["passed"] == 0:
            return False, "neither version passes its cases"
        return True, f"passes {score} cases (current version {before})"
    if rate < MIN_PASS_RATE:
        return False, f"passes only {score} of its cases"
    return True, f"passes {score} of its cases"


async def consider(db: AsyncSession, ws: Workspace, p: SkillProposal) -> Skill | None:
    """Approve `p` automatically if it has proven itself. Returns the live skill, or None."""
    if p.status != "pending":
        return None
    ok, why = verdict(p, mode(ws))
    if not ok:
        p.decision_note = f"Waiting for a person: {why}."[:2000]
        await db.commit()
        return None
    try:
        skill = await approve(db, ws, p, AUTOPILOT)
    except SkillError as e:
        log.info("autopilot left %s for review: %s", p.id, e)
        p.decision_note = f"Waiting for a person: it passed its tests, but {e}"[:2000]
        await db.commit()
        return None
    p.decision_note = f"Approved automatically: {why}."[:2000]
    await db.commit()
    await audit.record(
        db,
        ws.id,
        AUTOPILOT.actor,
        "skill.auto_approved",
        target=p.id,
        after={"name": p.name, "why": why},
    )
    await db.commit()
    await events.publish(
        ws.id, "skill.updated", {"skill_id": skill.id, "name": skill.name, "auto": True}
    )
    return skill


async def revert(
    db: AsyncSession, ws: Workspace, skill: Skill, version: int, actor: brain_store.Author
) -> Skill:
    """Put an earlier version back live (as a new version, so nothing is lost)."""
    old = await db.scalar(
        select(SkillVersion).where(
            SkillVersion.skill_id == skill.id, SkillVersion.version == version
        )
    )
    if old is None:
        raise SkillError(f"{skill.name} has no version {version}.")
    if old.body.strip() == skill.body.strip() and old.description == skill.description:
        raise SkillError(f"Version {version} is what is live already.")
    from .store import _mirror  # the vault copy follows the live text

    skill.version += 1
    skill.body, skill.description = old.body, old.description
    db.add(
        SkillVersion(
            skill_id=skill.id,
            version=skill.version,
            description=old.description,
            body=old.body,
            created_by=actor.actor,
            approved_by=actor.actor,
            note=f"Rolled back to version {version}",
            created_at=datetime.now(UTC),
        )
    )
    await db.flush()
    await _mirror(db, ws, skill, actor, f"skills: roll {skill.name} back to v{version}")
    await audit.record(
        db, ws.id, actor.actor, "skill.reverted", target=skill.id, after={"to_version": version}
    )
    await db.commit()
    await events.publish(ws.id, "skill.updated", {"skill_id": skill.id, "name": skill.name})
    return skill


async def tidy(db: AsyncSession, ws: Workspace) -> dict[str, int]:
    """Nightly: close proposals that can never go live, or that nobody looked at."""
    now = datetime.now(UTC)
    rows = (
        await db.scalars(
            select(SkillProposal).where(
                SkillProposal.workspace_id == ws.id, SkillProposal.status == "pending"
            )
        )
    ).all()
    out = {"blocked": 0, "stale": 0, "approved": 0}
    for p in rows:
        if blocked(p.scan or []):
            # Never keep a secret around in a draft nobody may approve.
            p.status, p.decided_at, p.decided_by = "rejected", now, AUTOPILOT.actor
            p.decision_note = "Closed automatically: it contained a secret or an injection."
            p.body = "(removed: the draft contained something that must not be stored)\n"
            out["blocked"] += 1
        elif p.created_at < now - timedelta(days=STALE_DAYS):
            p.status, p.decided_at, p.decided_by = "superseded", now, AUTOPILOT.actor
            p.decision_note = f"Closed automatically after {STALE_DAYS} days without review."
            out["stale"] += 1
    await db.commit()
    from .reflect import evaluate  # reflect imports this module

    for p in rows:
        if p.status != "pending":
            continue
        if p.eval is None and p.kind != "retire":
            try:
                await evaluate(db, p)  # older drafts were queued before they were tested
            except Exception:  # noqa: BLE001 - untested drafts simply wait for a person
                log.warning("evals failed for proposal %s", p.id, exc_info=True)
        if await consider(db, ws, p):
            out["approved"] += 1
    return out
