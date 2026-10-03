"""Skill library, proposals and usage.

- Agents see an index (name + description) in their prompt and load a body with use_skill:
  40 skills cost about 1,200 prompt tokens instead of 40,000.
- Nothing an agent writes becomes a skill until a person approves it. Every approval is a
  new version, a row in skill_versions and a git commit in the vault.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import embed
from ..brain import facts as brain_facts
from ..brain import store as brain_store
from ..brain.scope import for_agent
from ..models import (
    Agent,
    BrainPage,
    LLMCall,
    Skill,
    SkillEvalCase,
    SkillProposal,
    SkillUse,
    SkillVersion,
    Task,
    Workspace,
)
from ..services import audit, events
from . import format as fmt
from .scan import blocked, scan

PATCH_SIMILARITY = 0.8  # above this, a "new" skill must be a patch of the existing one
INDEX_LIMIT = 40
STALE_DAYS = 21  # unused this long: named in the index, description dropped


class SkillError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def vault_path(name: str) -> str:
    return f"skills/{name}/SKILL.md"


def known_tools() -> set[str]:
    from ..agents.tools import TOOLS  # late: tools imports this module

    return set(TOOLS)


# ---------------------------------------------------------------- built-in starters

BUILTIN = [
    (
        "compare-quotes",
        "Compare two or more supplier quotations into one table with totals, gaps and a "
        "recommendation.",
        """## When to use
Someone gives you two or more quotations, price lists or offers for the same need.

## Steps
1. List every quotation: supplier, date, validity, currency.
2. Line up the items that are the same across quotations. Mark items only one supplier offers.
3. Use calc for every subtotal, tax and total. Never add numbers in your head.
4. Note terms that change the real cost: delivery, payment terms, warranty, minimum order.
5. Recommend one supplier in one sentence, and say what would change your mind.

## Output format
- One-line recommendation first.
- A markdown table: item, then one column per supplier, totals in the last row.
- "Gaps and risks" as a short list.

## Pitfalls
- Quotations in different currencies or with and without tax are not comparable until converted.
- Ask a person (ask_human) if a quotation has expired.
""",
    ),
    (
        "meeting-notes",
        "Turn a meeting transcript or rough notes into decisions, action items with owners and "
        "dates, and open questions.",
        """## When to use
You are given a transcript, chat log or rough notes from a meeting.

## Steps
1. Find every decision. Write each as one sentence in the past tense.
2. Find every action item: what, who owns it, and by when. If the owner or date is missing,
   write "owner?" or "date?" instead of guessing.
3. List questions nobody answered.
4. Save lasting decisions with write_page under wiki/decisions/ when they affect future work.

## Output format
- Summary: one sentence.
- Decisions, Action items (table: action, owner, due), Open questions.

## Pitfalls
- Do not invent owners or dates.
""",
    ),
]


async def ensure_builtin(db: AsyncSession, ws: Workspace) -> None:
    have = await db.scalar(
        select(func.count()).select_from(Skill).where(Skill.workspace_id == ws.id)
    )
    if have:
        return
    vectors = await embed.embed([f"{n}: {d}" for n, d, _ in BUILTIN]) or [None] * len(BUILTIN)
    for (name, description, body), vec in zip(BUILTIN, vectors, strict=True):
        s = Skill(
            workspace_id=ws.id,
            name=name,
            description=description,
            body=body,
            version=1,
            trust="builtin",
            created_by="system",
            approved_by="system",
            embedding=vec,
        )
        db.add(s)
        await db.flush()
        db.add(
            SkillVersion(
                skill_id=s.id,
                version=1,
                description=description,
                body=body,
                created_by="system",
                approved_by="system",
                note="Built in",
                created_at=_now(),
            )
        )
        await _mirror(db, ws, s, brain_store.SYSTEM, f"skills: add built-in {name}")
    await db.commit()


# ---------------------------------------------------------------- reading


async def visible(db: AsyncSession, agent: Agent) -> list[Skill]:
    v = await for_agent(db, agent)
    q = select(Skill).where(Skill.workspace_id == agent.workspace_id, Skill.status == "active")
    if v.branch_ids is not None:
        q = q.where(or_(Skill.branch_id.is_(None), Skill.branch_id.in_(v.branch_ids)))
    rows = (await db.scalars(q.order_by(Skill.last_used_at.desc().nulls_last(), Skill.name))).all()
    return [s for s in rows if not s.agent_ids or agent.id in s.agent_ids]


async def index_for(db: AsyncSession, agent: Agent) -> str:
    """The level-1 index for the prompt. Empty when the agent has no skills."""
    ws = await db.get(Workspace, agent.workspace_id)
    if ws is not None:
        await ensure_builtin(db, ws)
    skills = (await visible(db, agent))[:INDEX_LIMIT]
    if not skills:
        return ""
    # P12 (from Hermes): skills nobody used for weeks are listed by name only, which keeps
    # the always-sent index small; they still load with use_skill and come back when used.
    stale_before = datetime.now(UTC) - timedelta(days=STALE_DAYS)
    fresh, stale = [], []
    for s in sorted(skills, key=lambda s: s.name):
        last = s.last_used_at or s.created_at
        (stale if s.trust != "builtin" and last < stale_before else fresh).append(s)
    lines = [f"- {s.name}: {s.description}" for s in fresh]
    if stale:
        lines.append("- Also available (not used lately): " + ", ".join(s.name for s in stale))
    return (
        "Proven procedures for this office. When a task matches one, call use_skill with its "
        "name first and follow it.\n" + "\n".join(lines)
    )


async def find(db: AsyncSession, workspace_id: str, name: str) -> Skill | None:
    return await db.scalar(
        select(Skill).where(Skill.workspace_id == workspace_id, Skill.name == fmt.slug(name))
    )


async def load(
    db: AsyncSession, agent: Agent, name: str, task_id: str | None, file: str | None = None
) -> str:
    """The use_skill tool: level 2 (body) or level 3 (a supporting file)."""
    skill = next((s for s in await visible(db, agent) if s.name == fmt.slug(name)), None)
    if skill is None:
        return f"Error: there is no skill called {name!r} for you. Check the skills list."
    if file:
        path = f"skills/{skill.name}/{file.strip().strip('/')}"
        page = await db.scalar(
            select(BrainPage).where(
                BrainPage.workspace_id == agent.workspace_id, BrainPage.path == path
            )
        )
        return page.body if page else f"Error: {skill.name} has no file {file!r}."
    already = (
        await db.scalar(
            select(SkillUse.id).where(SkillUse.skill_id == skill.id, SkillUse.task_id == task_id)
        )
        if task_id
        else None
    )
    if already is None:
        db.add(
            SkillUse(
                workspace_id=agent.workspace_id,
                skill_id=skill.id,
                version=skill.version,
                agent_id=agent.id,
                task_id=task_id,
                created_at=_now(),
            )
        )
    skill.last_used_at = _now()
    await db.commit()
    await events.publish(
        agent.workspace_id,
        "skill.used",
        {"skill_id": skill.id, "agent_id": agent.id, "task_id": task_id},
    )
    return f"Skill {skill.name} (version {skill.version}). Follow it:\n\n{skill.body}"


async def task_tokens(db: AsyncSession, task_id: str) -> int:
    total = await db.scalar(
        select(func.coalesce(func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0)).where(
            LLMCall.task_id == task_id, LLMCall.task == "agent.task"
        )
    )
    return int(total or 0)


async def settle(db: AsyncSession, task_id: str, outcome: str) -> None:
    """Record how a task that used skills ended: accepted | sent_back | failed. A send-back is
    provisional: when the reworked task is finally accepted (or fails), that is the outcome."""
    uses = (
        await db.scalars(
            select(SkillUse).where(
                SkillUse.task_id == task_id,
                or_(SkillUse.outcome.is_(None), SkillUse.outcome == "sent_back"),
            )
        )
    ).all()
    if not uses:
        return
    tokens = await task_tokens(db, task_id)
    for u in uses:
        u.outcome = outcome
        u.tokens = tokens
    await db.commit()


@dataclass
class Stats:
    uses: int = 0
    accepted: int = 0
    sent_back: int = 0
    failed: int = 0
    avg_tokens: int | None = None

    @property
    def success_rate(self) -> float | None:
        judged = self.accepted + self.sent_back + self.failed
        return round(self.accepted / judged, 3) if judged else None


async def stats(db: AsyncSession, skill_ids: list[str]) -> dict[str, Stats]:
    out = {sid: Stats() for sid in skill_ids}
    if not skill_ids:
        return out
    rows = (
        await db.execute(
            select(SkillUse.skill_id, SkillUse.outcome, func.count(), func.avg(SkillUse.tokens))
            .where(SkillUse.skill_id.in_(skill_ids))
            .group_by(SkillUse.skill_id, SkillUse.outcome)
        )
    ).all()
    weighted: dict[str, tuple[float, int]] = {}
    for sid, outcome, n, avg in rows:
        s = out[sid]
        s.uses += n
        if outcome in ("accepted", "sent_back", "failed"):
            setattr(s, outcome, getattr(s, outcome) + n)
        if avg is not None:
            total, count = weighted.get(sid, (0.0, 0))
            weighted[sid] = (total + float(avg) * n, count + n)
    for sid, (total, count) in weighted.items():
        out[sid].avg_tokens = round(total / count) if count else None
    return out


# ---------------------------------------------------------------- proposals


async def nearest(
    db: AsyncSession, workspace_id: str, vector: list[float] | None, exclude: str | None = None
) -> tuple[Skill, float] | None:
    if vector is None:
        return None
    dist = Skill.embedding.cosine_distance(vector)
    q = select(Skill, (1 - dist).label("sim")).where(
        Skill.workspace_id == workspace_id, Skill.status == "active", Skill.embedding.is_not(None)
    )
    if exclude:
        q = q.where(Skill.id != exclude)
    row = (await db.execute(q.order_by(dist).limit(1))).first()
    return (row[0], float(row[1])) if row else None


async def propose(
    db: AsyncSession,
    ws: Workspace,
    *,
    name: str,
    description: str,
    body: str,
    reason: str,
    proposed_by: str,
    kind: str = "new",
    agent: Agent | None = None,
    source_task_id: str | None = None,
    eval_cases: list[dict[str, Any]] | None = None,
    skill: Skill | None = None,
    other: Skill | None = None,
) -> SkillProposal:
    """Queue a change for review. A 'new' skill that duplicates an existing one (same name,
    or similarity >= PATCH_SIMILARITY) becomes a patch of that skill instead."""
    await ensure_builtin(db, ws)  # so a proposal never duplicates a starter skill
    name, description, body = fmt.slug(name), " ".join(description.split()), body.strip() + "\n"
    if kind in ("new", "patch"):
        fmt.check(name, description, body)
    if kind == "new" and skill is None:
        skill = await find(db, ws.id, name)
        if skill is None:
            near = await nearest(db, ws.id, await embed.embed_one(f"{name}: {description}"))
            if near and near[1] >= PATCH_SIMILARITY:
                skill = near[0]
        if skill is not None:
            kind, name = "patch", skill.name
    if kind == "patch" and skill is None:
        raise SkillError(f"There is no skill called {name!r} to update.")
    if (
        skill is not None
        and kind == "patch"
        and skill.body.strip() == body.strip()
        and skill.description == description
    ):
        raise SkillError(f"{skill.name} already says exactly this.")
    findings = scan(body, description, known_tools()) if kind != "retire" else []
    if blocked(findings):
        # Never store a draft that carries a secret or an injection (P17): say why, keep nothing.
        raise SkillError(
            "The safety scan blocked it: "
            + "; ".join(f["message"] for f in findings if f["level"] == "block")[:300]
        )
    # A new draft under the same name replaces any older pending one, whoever proposed it.
    if skill is None:
        for old in (
            await db.scalars(
                select(SkillProposal).where(
                    SkillProposal.workspace_id == ws.id,
                    SkillProposal.name == name,
                    SkillProposal.status == "pending",
                    SkillProposal.skill_id.is_(None),
                )
            )
        ).all():
            old.status, old.decided_at, old.decision_note = (
                "superseded",
                _now(),
                "A newer draft of the same skill replaced it.",
            )
    # One open proposal per proposer and skill: a newer draft replaces the older one.
    if skill is not None:
        for old in (
            await db.scalars(
                select(SkillProposal).where(
                    SkillProposal.skill_id == skill.id,
                    SkillProposal.status == "pending",
                    SkillProposal.proposed_by == proposed_by,
                    SkillProposal.kind == kind,
                )
            )
        ).all():
            old.status, old.decided_at, old.decision_note = (
                "superseded",
                _now(),
                "A newer draft replaced it.",
            )
    p = SkillProposal(
        workspace_id=ws.id,
        skill_id=skill.id if skill else None,
        other_skill_id=other.id if other else None,
        kind=kind,
        name=name,
        description=description[: fmt.MAX_DESCRIPTION],
        body=body,
        base_version=skill.version if skill else None,
        reason=reason.strip()[:2000],
        eval_cases=[c for c in (eval_cases or []) if isinstance(c, dict)][:10],
        scan=findings,
        proposed_by=proposed_by,
        agent_id=agent.id if agent else None,
        branch_id=await _branch_for(db, agent),
        source_task_id=source_task_id,
        created_at=_now(),
    )
    db.add(p)
    await db.commit()
    await events.publish(
        ws.id,
        "skill.proposal",
        {"proposal_id": p.id, "name": p.name, "kind": p.kind, "by": proposed_by},
    )
    return p


async def _branch_for(db: AsyncSession, agent: Agent | None) -> str | None:
    """Skills learned in an isolated company stay in that company."""
    if agent is None:
        return None
    from ..models import Branch

    b = await db.get(Branch, agent.branch_id)
    return b.id if b is not None and b.isolated else None


async def _mirror(
    db: AsyncSession, ws: Workspace, s: Skill, author: brain_store.Author, message: str
) -> None:
    meta = {
        "name": s.name,
        "description": s.description,
        "version": s.version,
        "trust": s.trust,
        "status": s.status if s.status != "active" else None,
        "created_by": s.created_by,
        "approved_by": s.approved_by,
    }
    await brain_store.save_page(
        db, ws, vault_path(s.name), fmt.render(meta, s.body), author, message
    )


async def _cases_from(db: AsyncSession, skill: Skill, p: SkillProposal, actor: str) -> None:
    titles = set(
        (
            await db.scalars(select(SkillEvalCase.title).where(SkillEvalCase.skill_id == skill.id))
        ).all()
    )
    for c in p.eval_cases:
        title, text = str(c.get("title") or "").strip()[:160], str(c.get("input") or "").strip()
        if not title or not text or title in titles:
            continue
        checks = {
            k: c[k]
            for k in ("must_contain", "must_not_contain", "regex", "number", "json_keys", "rubric")
            if k in c
        }
        db.add(
            SkillEvalCase(
                workspace_id=skill.workspace_id,
                skill_id=skill.id,
                title=title,
                input=text,
                checks=checks,
                created_by=actor,
                created_at=_now(),
            )
        )


async def approve(
    db: AsyncSession,
    ws: Workspace,
    p: SkillProposal,
    approver: brain_store.Author,
    *,
    description: str | None = None,
    body: str | None = None,
) -> Skill:
    if p.status != "pending":
        raise SkillError(f"This proposal is already {p.status}.")
    if body is not None or description is not None:  # edit and approve: scan the edited text
        p.body = (body if body is not None else p.body).strip() + "\n"
        p.description = " ".join(
            (description if description is not None else p.description).split()
        )
        if p.kind != "retire":
            fmt.check(p.name, p.description, p.body)
            p.scan = scan(p.body, p.description, known_tools())
    if blocked(p.scan):
        raise SkillError("The safety scan found problems. Edit the skill to fix them first.")
    skill = await db.get(Skill, p.skill_id) if p.skill_id else None
    who = approver.name
    if p.kind == "new":
        if await find(db, ws.id, p.name):
            raise SkillError(f"A skill called {p.name} exists now; propose a patch instead.")
        baseline = await task_tokens(db, p.source_task_id) if p.source_task_id else None
        skill = Skill(
            workspace_id=ws.id,
            branch_id=p.branch_id,
            name=p.name,
            description=p.description,
            body=p.body,
            version=1,
            trust="trusted",
            created_by=p.proposed_by,
            approved_by=approver.actor,
            baseline_tokens=baseline or None,
            source_task_id=p.source_task_id,
            embedding=await embed.embed_one(f"{p.name}: {p.description}"),
        )
        db.add(skill)
        await db.flush()
        note = f"Created from {p.proposed_by}"
    elif skill is None:
        raise SkillError("The skill this proposal changes no longer exists.")
    elif p.kind == "retire":
        skill.status = "retired"
        note = "Retired"
    else:
        skill.version += 1
        skill.description, skill.body = p.description, p.body
        skill.embedding = await embed.embed_one(f"{skill.name}: {skill.description}")
        skill.approved_by = approver.actor
        if skill.trust == "builtin":
            skill.trust = "official"  # a person changed it, so it is now the office's own
        note = "Merged" if p.kind == "merge" else "Updated"
        if p.kind == "merge" and p.other_skill_id:
            other = await db.get(Skill, p.other_skill_id)
            if other is not None and other.status == "active":
                other.status = "retired"
                await _mirror(
                    db,
                    ws,
                    other,
                    approver,
                    f"skills: retire {other.name} (merged into {skill.name})",
                )
    if p.kind != "retire":
        db.add(
            SkillVersion(
                skill_id=skill.id,
                version=skill.version,
                description=skill.description,
                body=skill.body,
                created_by=p.proposed_by,
                approved_by=approver.actor,
                note=(p.reason or note)[:300],
                created_at=_now(),
            )
        )
        await _cases_from(db, skill, p, approver.actor)
    p.status, p.decided_by, p.decided_at = "approved", approver.actor, _now()
    p.skill_id = skill.id
    await _mirror(
        db,
        ws,
        skill,
        approver,
        f"skills: v{skill.version} {skill.name} ({note.lower()}, approved by {who})",
    )
    await audit.record(
        db,
        ws.id,
        approver.actor,
        "skill.approved",
        target=skill.id,
        after={"name": skill.name, "version": skill.version, "kind": p.kind},
    )
    await db.commit()
    await events.publish(ws.id, "skill.updated", {"skill_id": skill.id, "name": skill.name})
    return skill


async def reject(
    db: AsyncSession, ws: Workspace, p: SkillProposal, reviewer: brain_store.Author, reason: str
) -> None:
    if p.status != "pending":
        raise SkillError(f"This proposal is already {p.status}.")
    p.status, p.decided_by, p.decided_at = "rejected", reviewer.actor, _now()
    p.decision_note = reason.strip()[:2000] or None
    # The agent learns from the rejection: a private fact it will recall next time.
    agent = await db.get(Agent, p.agent_id) if p.agent_id else None
    if agent is not None and reason.strip():
        text = brain_facts.clean(
            f"{reviewer.name} rejected my skill proposal {p.name}: {reason.strip()}"
        )
        if text:
            await brain_facts.add(
                db,
                await for_agent(db, agent),
                text,
                branch_id=None,
                agent_id=agent.id,
                source_kind="person",
                source_label=f"skill review by {reviewer.name}",
                created_by=reviewer.actor,
            )
    # A rejected edit made in the vault is put back to the approved text.
    if p.proposed_by == "vault" and p.skill_id:
        skill = await db.get(Skill, p.skill_id)
        if skill is not None:
            await _mirror(db, ws, skill, reviewer, f"skills: restore {skill.name} (edit rejected)")
    await audit.record(
        db,
        ws.id,
        reviewer.actor,
        "skill.rejected",
        target=p.id,
        after={"name": p.name, "reason": p.decision_note},
    )
    await db.commit()
    await events.publish(ws.id, "skill.proposal", {"proposal_id": p.id, "status": "rejected"})


async def ingest_vault(db: AsyncSession, ws: Workspace, paths: list[str]) -> list[str]:
    """SKILL.md files edited in the vault become proposals, never silent changes."""
    made = []
    for path in paths:
        parts = path.split("/")
        if len(parts) != 3 or parts[0] != "skills" or parts[2] != "SKILL.md":
            continue
        page = await db.scalar(
            select(BrainPage).where(BrainPage.workspace_id == ws.id, BrainPage.path == path)
        )
        if page is None:
            continue
        meta, body = fmt.parse(page.body)
        skill = await find(db, ws.id, parts[1])
        description = str(meta.get("description") or (skill.description if skill else ""))
        try:
            await propose(
                db,
                ws,
                name=parts[1],
                description=description,
                body=body,
                reason="Edited directly in the vault (Obsidian or git).",
                proposed_by="vault",
                kind="patch" if skill else "new",
                skill=skill,
            )
            made.append(parts[1])
        except (SkillError, fmt.SkillFormatError):
            continue
    return made


async def task_title(db: AsyncSession, task_id: str | None) -> str | None:
    if not task_id:
        return None
    t = await db.get(Task, task_id)
    return t.title if t else None
