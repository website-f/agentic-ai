"""Skill optimizer (P18): reflective prompt evolution, in the spirit of GEPA (Agrawal et al.,
2025) and DSPy's optimizers, built on our own evals.

Hermes improves a skill only when a later session happens to rewrite it. Here a skill can be
optimized on purpose:

1. Run the live text on its test cases (the baseline). A skill with fewer than MIN_CASES gets
   cases drafted from its own accepted work first (saved, so later checks reuse them).
2. Reflect: a strong model reads the skill, every failing case (input, answer, what was
   missing) and the passing ones, and rewrites the skill to fix the causes, not the symptoms.
   CANDIDATES variants per round, each told to focus on a different failure.
3. Test every variant on all cases. Keep the best: most cases passed, then fewest tokens.
4. Repeat from the best for up to ROUNDS rounds, stopping when nothing improves.

Only a variant that beats the baseline becomes a proposal (kind patch, by "optimizer"), with
its evals attached; the learning autopilot then decides as for any other change.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.facts import parse_json
from ..core.fence import fence
from ..engine import gateway
from ..models import Skill, SkillEvalCase, SkillProposal, SkillUse, Task, Workspace
from . import autopilot, evals
from . import format as fmt
from .store import SkillError, propose

log = logging.getLogger("agentic.skills.optimize")

ROUNDS = 3
CANDIDATES = 2
MIN_CASES = 2
MAX_CASES = 6  # cost: every candidate runs every case
OPTIMIZER = "optimizer"

REFLECT = """You improve a procedure ("skill") that AI office staff follow. Below: the skill,
and how it did on its test cases (the request, the answer it produced, and what a correct
answer needed). Find WHY the failing answers fell short — a missing step, an unclear or wrong
instruction, a missing check, an unclear output format — and rewrite the skill so that every
case would pass, without breaking the ones that pass now.
Return JSON only:
{"diagnosis": "one or two sentences: the cause", "description": "one sentence",
 "body": "the full improved markdown: ## When to use, ## Steps, ## Output format, ## Pitfalls"}
Rules: keep what works; general rules, not answers to these exact cases (never paste a test's
expected words in as a fixed answer); no client names, amounts or secrets; under 900 words."""

CASES = """Write test cases for a procedure ("skill") used by AI office staff, from real work
it was used for. Return JSON only:
{"cases": [{"title": "...", "input": "a realistic request like the real ones",
            "must_contain": ["short words a correct answer must include"]}]}
Up to 3 cases. Checks must be things any correct answer contains (a section name the output
format requires, a required field, a computed total), never one exact phrasing."""


@dataclass
class Scored:
    body: str
    description: str
    result: dict[str, Any]
    diagnosis: str = ""

    @property
    def passed(self) -> int:
        return int(self.result.get("passed") or 0)

    @property
    def tokens(self) -> int:
        return int(self.result.get("tokens") or 0)

    def better_than(self, other: "Scored") -> bool:
        if self.passed != other.passed:
            return self.passed > other.passed
        return self.tokens < other.tokens * 0.9  # same score: only if clearly cheaper


@dataclass
class Outcome:
    skill: str
    baseline: dict[str, Any]
    best: dict[str, Any] | None
    rounds: int
    proposal_id: str | None = None
    status: str | None = None
    note: str = ""
    tried: list[dict[str, Any]] = field(default_factory=list)


async def _ask(db: AsyncSession, ws_id: str, system: str, user: str, task: str, key: str) -> dict:
    for group in ("smart", "fast"):
        try:
            r = await gateway.chat(
                db,
                ws_id,
                group,
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                task=task,
                max_tokens=2200,
                temperature=0.4,
                json_mode=True,
                accept=lambda c: key in parse_json(c),
            )
            return parse_json(r.content)
        except gateway.GatewayUnavailable:
            continue
    return {}


async def cases_for(db: AsyncSession, skill: Skill) -> list[dict[str, Any]]:
    rows = (await db.scalars(select(SkillEvalCase).where(SkillEvalCase.skill_id == skill.id))).all()
    return [{"title": c.title, "input": c.input, "checks": c.checks} for c in rows]


async def draft_cases(db: AsyncSession, skill: Skill) -> list[dict[str, Any]]:
    """Cases from the skill's accepted work, saved so every later check reuses them."""
    work = (
        await db.execute(
            select(Task.title, Task.brief, Task.result)
            .join(SkillUse, SkillUse.task_id == Task.id)
            .where(SkillUse.skill_id == skill.id, SkillUse.outcome == "accepted")
            .order_by(SkillUse.id.desc())
            .limit(4)
        )
    ).all()
    examples = (
        "\n\n".join(
            f"REQUEST: {t}\n{(b or '')[:600]}\nACCEPTED ANSWER: {(r or '')[:800]}"
            for t, b, r in work
        )
        or "(no recorded work yet: write cases from the procedure itself)"
    )
    got = await _ask(
        db,
        skill.workspace_id,
        CASES,
        f"SKILL {skill.name}: {skill.description}\n{skill.body}\n\nREAL WORK:\n{fence(examples)}",
        "skill.optimize.cases",
        "cases",
    )
    out: list[dict[str, Any]] = []
    for c in (got.get("cases") or [])[:3]:
        if not isinstance(c, dict) or not c.get("input") or not c.get("must_contain"):
            continue
        checks = {"must_contain": [str(x)[:80] for x in c["must_contain"]][:5]}
        title = str(c.get("title") or "case")[:160]
        db.add(
            SkillEvalCase(
                workspace_id=skill.workspace_id,
                skill_id=skill.id,
                title=title,
                input=str(c["input"])[:4000],
                checks=checks,
                created_by=OPTIMIZER,
                created_at=fmt_now(),
            )
        )
        out.append({"title": title, "input": str(c["input"]), "checks": checks})
    await db.commit()
    return out


def fmt_now():  # small indirection so tests can freeze time if they need to
    from datetime import UTC, datetime

    return datetime.now(UTC)


def _report(result: dict[str, Any], cases: list[dict[str, Any]]) -> str:
    lines = []
    by_title = {c.get("title"): c for c in cases}
    for r in result.get("cases") or []:
        case = by_title.get(r.get("title")) or {}
        status = "PASS" if r.get("pass") else "FAIL: " + "; ".join(r.get("failures") or [])
        lines.append(
            f"CASE {r.get('title')}: {status}\nREQUEST: {str(case.get('input', ''))[:700]}\n"
            f"ANSWER: {str(r.get('output', ''))[:900]}"
        )
    return "\n\n".join(lines)


async def _variants(
    db: AsyncSession, skill: Skill, best: Scored, cases: list[dict[str, Any]]
) -> list[Scored]:
    failing = [r for r in best.result.get("cases") or [] if not r.get("pass")]
    out: list[Scored] = []
    for i in range(CANDIDATES):
        focus = (
            f"\nFocus first on the failing case {failing[i % len(failing)].get('title')!r}."
            if failing
            else "\nAll cases pass: make it shorter and clearer without losing any step."
        )
        got = await _ask(
            db,
            skill.workspace_id,
            REFLECT,
            f"SKILL {skill.name}: {best.description}\n{best.body}\n\nRESULTS "
            f"({best.passed}/{len(cases)} passed):\n{fence(_report(best.result, cases))}{focus}",
            "skill.optimize",
            "body",
        )
        body = str(got.get("body") or "").strip()
        if not body or body == best.body.strip():
            continue
        desc = " ".join(str(got.get("description") or best.description).split())[:300]
        try:
            fmt.check(skill.name, desc, body + "\n")
        except fmt.SkillFormatError:
            continue
        result = await evals.run_suite(db, skill.workspace_id, body, cases)
        if result.get("error"):
            continue
        out.append(Scored(body, desc, result, str(got.get("diagnosis") or "")[:400]))
    return out


async def optimize(db: AsyncSession, ws: Workspace, skill: Skill) -> Outcome:
    cases = await cases_for(db, skill)
    if len(cases) < MIN_CASES:
        cases += await draft_cases(db, skill)
    cases = cases[:MAX_CASES]
    if not cases:
        raise SkillError(f"{skill.name} has no test cases and none could be drafted.")
    base = await evals.run_suite(db, ws.id, skill.body, cases)
    if base.get("error"):
        raise SkillError(f"The tests could not run: {base['error']}")
    baseline = Scored(skill.body, skill.description, base)
    best, rounds, tried = baseline, 0, []
    for rounds in range(1, ROUNDS + 1):  # noqa: B007 - rounds is reported
        improved = False
        for v in await _variants(db, skill, best, cases):
            tried.append({"round": rounds, "passed": v.passed, "tokens": v.tokens})
            if v.better_than(best):
                best, improved = v, True
        if not improved or best.passed == len(cases) and rounds > 1:
            break
    outcome = Outcome(skill.name, _brief(base), None, rounds, tried=tried)
    if best is baseline:
        outcome.note = f"No variant beat the current text ({baseline.passed}/{len(cases)})."
        return outcome
    outcome.best = _brief(best.result)
    try:
        p = await propose(
            db,
            ws,
            kind="patch",
            skill=skill,
            name=skill.name,
            description=best.description,
            body=best.body,
            proposed_by=OPTIMIZER,
            reason=(
                f"Optimizer: {baseline.passed}/{len(cases)} -> {best.passed}/{len(cases)} cases "
                f"after {rounds} round(s). {best.diagnosis}"
            ).strip(),
            eval_cases=[c for c in cases if c.get("title")],
        )
    except (SkillError, fmt.SkillFormatError) as e:
        outcome.note = f"The improved text could not be proposed: {e}"
        return outcome
    p.eval = {"new": best.result, "old": base, "old_version": skill.version}
    await db.commit()
    await autopilot.consider(db, ws, p)
    outcome.proposal_id, outcome.status = p.id, p.status
    outcome.note = p.decision_note or ""
    return outcome


def _brief(result: dict[str, Any]) -> dict[str, Any]:
    return {k: result.get(k) for k in ("passed", "total", "tokens")}


async def nightly_pick(db: AsyncSession, ws: Workspace) -> Skill | None:
    """One skill a night: an active skill whose last check failed some case, or that people
    keep sending back, and that the optimizer has not touched in a week."""
    from datetime import timedelta

    week = fmt_now() - timedelta(days=7)
    recent = set(
        (
            await db.scalars(
                select(SkillProposal.skill_id).where(
                    SkillProposal.workspace_id == ws.id,
                    SkillProposal.proposed_by == OPTIMIZER,
                    SkillProposal.created_at >= week,
                )
            )
        ).all()
    )
    for s in (
        await db.scalars(select(Skill).where(Skill.workspace_id == ws.id, Skill.status == "active"))
    ).all():
        if s.id in recent:
            continue
        ev = s.last_eval or {}
        if ev.get("total") and ev.get("passed", 0) < ev["total"]:
            return s
    return None
