"""Skills: the library, its review queue, test cases and evals.

People who can decide approvals (owner, admin, approver) publish directly: their edits go
through the same proposal -> approve path, so every change gets a version and a git commit.
Everyone else with work.write proposes, and the proposal waits for review.
"""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import dispatch
from ...brain.store import Author
from ...core.db import get_db
from ...core.security import can
from ...models import Skill, SkillEvalCase, SkillProposal, SkillUse, SkillVersion, Task, Workspace
from ...skills import format as fmt
from ...skills import store
from ..deps import Principal, api_error, require
from .brain import _names

router = APIRouter(prefix="/api", tags=["skills"])

# ---------------------------------------------------------------- schemas


class StatsOut(BaseModel):
    uses: int
    accepted: int
    sent_back: int
    failed: int
    success_rate: float | None
    avg_tokens: int | None


class SkillOut(BaseModel):
    id: str
    name: str
    description: str
    version: int
    trust: str
    status: str
    branch_id: str | None
    agent_ids: list[str]
    created_by: str
    created_by_name: str
    approved_by_name: str | None
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
    stats: StatsOut
    baseline_tokens: int | None
    saved_pct: float | None  # 1 - avg tokens with the skill / tokens of the task it came from
    pending: int


class SkillDetail(SkillOut):
    body: str
    versions: list[dict[str, Any]]
    uses: list[dict[str, Any]]
    eval_cases: list[dict[str, Any]]
    last_eval: dict[str, Any] | None
    proposals: list[dict[str, Any]]


class SkillIn(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    description: str = Field(min_length=10, max_length=300)
    body: str = Field(min_length=1, max_length=fmt.MAX_BODY)
    note: str | None = Field(default=None, max_length=300)


class SkillUpdateIn(BaseModel):
    description: str | None = Field(default=None, min_length=10, max_length=300)
    body: str | None = Field(default=None, max_length=fmt.MAX_BODY)
    note: str | None = Field(default=None, max_length=300)
    agent_ids: list[str] | None = Field(default=None, max_length=200)
    status: Literal["active", "retired"] | None = None


class ProposalOut(BaseModel):
    id: str
    kind: str
    name: str
    description: str
    body: str
    base_version: int | None
    current: dict[str, Any] | None
    other: dict[str, Any] | None
    stale: bool
    reason: str
    eval_cases: list[dict[str, Any]]
    scan: list[dict[str, Any]]
    eval: dict[str, Any] | None
    proposed_by: str
    proposed_by_name: str
    agent_id: str | None
    source_task: dict[str, Any] | None
    status: str
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime


class ApproveIn(BaseModel):
    description: str | None = Field(default=None, min_length=10, max_length=300)
    body: str | None = Field(default=None, max_length=fmt.MAX_BODY)


class RejectIn(BaseModel):
    reason: str = Field(default="", max_length=2000)


class CaseIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    input: str = Field(min_length=1, max_length=8000)
    must_contain: list[str] = Field(default_factory=list, max_length=20)
    must_not_contain: list[str] = Field(default_factory=list, max_length=20)
    regex: str | None = Field(default=None, max_length=300)
    number: dict[str, float] | None = None
    json_keys: list[str] = Field(default_factory=list, max_length=20)
    rubric: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------- helpers


def _author(p: Principal) -> Author:
    return Author(p.actor, p.user.name)


def _can_publish(p: Principal) -> bool:
    return can(p.role, "approvals.decide")


async def _ws(db: AsyncSession, p: Principal) -> Workspace:
    ws = await db.get(Workspace, p.workspace_id)
    assert ws is not None
    return ws


async def _skill(db: AsyncSession, p: Principal, skill_id: str) -> Skill:
    s = await db.get(Skill, skill_id)
    if s is None or s.workspace_id != p.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "skill_not_found", "That skill is not here.")
    return s


async def _proposal(db: AsyncSession, p: Principal, proposal_id: str) -> SkillProposal:
    sp = await db.get(SkillProposal, proposal_id)
    if sp is None or sp.workspace_id != p.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "proposal_not_found", "That proposal is not here."
        )
    return sp


def _bad(e: Exception) -> Exception:
    return api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_skill", str(e))


async def _skills_out(db: AsyncSession, rows: list[Skill]) -> list[SkillOut]:
    st = await store.stats(db, [s.id for s in rows])
    names = await _names(db, {x for s in rows for x in (s.created_by, s.approved_by or "") if x})
    pending = (
        dict(
            (
                await db.execute(
                    select(SkillProposal.skill_id, func.count())
                    .where(
                        SkillProposal.skill_id.in_([s.id for s in rows]),
                        SkillProposal.status == "pending",
                    )
                    .group_by(SkillProposal.skill_id)
                )
            ).all()
        )
        if rows
        else {}
    )
    out = []
    for s in rows:
        x = st[s.id]
        saved = (
            round(1 - x.avg_tokens / s.baseline_tokens, 3)
            if x.avg_tokens and s.baseline_tokens
            else None
        )
        out.append(
            SkillOut(
                id=s.id,
                name=s.name,
                description=s.description,
                version=s.version,
                trust=s.trust,
                status=s.status,
                branch_id=s.branch_id,
                agent_ids=s.agent_ids or [],
                created_by=s.created_by,
                created_by_name=names.get(
                    s.created_by, "Built in" if s.created_by == "system" else "an agent"
                ),
                approved_by_name=names.get(s.approved_by or "") if s.approved_by else None,
                created_at=s.created_at,
                updated_at=s.updated_at,
                last_used_at=s.last_used_at,
                stats=StatsOut(
                    uses=x.uses,
                    accepted=x.accepted,
                    sent_back=x.sent_back,
                    failed=x.failed,
                    success_rate=x.success_rate,
                    avg_tokens=x.avg_tokens,
                ),
                baseline_tokens=s.baseline_tokens,
                saved_pct=saved,
                pending=pending.get(s.id, 0),
            )
        )
    return out


async def _proposal_out(db: AsyncSession, sp: SkillProposal) -> ProposalOut:
    skill = await db.get(Skill, sp.skill_id) if sp.skill_id else None
    other = await db.get(Skill, sp.other_skill_id) if sp.other_skill_id else None
    names = await _names(db, {x for x in (sp.proposed_by, sp.decided_by or "") if x})
    task = await db.get(Task, sp.source_task_id) if sp.source_task_id else None
    proposer = {"curator": "Nightly curator", "vault": "Vault edit"}.get(sp.proposed_by)
    return ProposalOut(
        id=sp.id,
        kind=sp.kind,
        name=sp.name,
        description=sp.description,
        body=sp.body,
        base_version=sp.base_version,
        current={
            "version": skill.version,
            "description": skill.description,
            "body": skill.body,
            "status": skill.status,
        }
        if skill
        else None,
        other={"name": other.name, "description": other.description, "body": other.body}
        if other
        else None,
        stale=bool(
            skill
            and sp.base_version
            and skill.version != sp.base_version
            and sp.status == "pending"
        ),
        reason=sp.reason,
        eval_cases=sp.eval_cases or [],
        scan=sp.scan or [],
        eval=sp.eval,
        proposed_by=sp.proposed_by,
        proposed_by_name=proposer or names.get(sp.proposed_by, "Someone"),
        agent_id=sp.agent_id,
        source_task={
            "id": task.id,
            "title": task.title,
            "tokens": await store.task_tokens(db, task.id),
        }
        if task
        else None,
        status=sp.status,
        decided_by_name=names.get(sp.decided_by) if sp.decided_by else None,
        decided_at=sp.decided_at,
        decision_note=sp.decision_note,
        created_at=sp.created_at,
    )


async def _detail(db: AsyncSession, s: Skill) -> SkillDetail:
    await db.refresh(s)  # updated_at is set by the database on save
    base = (await _skills_out(db, [s]))[0]
    versions = list(
        (
            await db.scalars(
                select(SkillVersion)
                .where(SkillVersion.skill_id == s.id)
                .order_by(SkillVersion.version.desc())
            )
        ).all()
    )
    uses = list(
        (
            await db.scalars(
                select(SkillUse)
                .where(SkillUse.skill_id == s.id)
                .order_by(SkillUse.id.desc())
                .limit(20)
            )
        ).all()
    )
    names = await _names(
        db,
        {x for v in versions for x in (v.created_by, v.approved_by or "") if x}
        | {f"agent:{u.agent_id}" for u in uses},
    )
    titles = (
        dict(
            (
                await db.execute(
                    select(Task.id, Task.title).where(
                        Task.id.in_({u.task_id for u in uses if u.task_id})
                    )
                )
            ).all()
        )
        if uses
        else {}
    )
    cases = list(
        (
            await db.scalars(
                select(SkillEvalCase)
                .where(SkillEvalCase.skill_id == s.id)
                .order_by(SkillEvalCase.created_at)
            )
        ).all()
    )
    props = list(
        (
            await db.scalars(
                select(SkillProposal)
                .where(SkillProposal.skill_id == s.id)
                .order_by(SkillProposal.created_at.desc())
                .limit(10)
            )
        ).all()
    )
    return SkillDetail(
        **base.model_dump(),
        body=s.body,
        versions=[
            {
                "version": v.version,
                "description": v.description,
                "body": v.body,
                "note": v.note,
                "created_by_name": names.get(
                    v.created_by, "Built in" if v.created_by == "system" else v.created_by
                ),
                "approved_by_name": names.get(v.approved_by or "", None),
                "created_at": v.created_at,
            }
            for v in versions
        ],
        uses=[
            {
                "agent_name": names.get(f"agent:{u.agent_id}", "an agent"),
                "task_id": u.task_id,
                "task_title": titles.get(u.task_id or ""),
                "version": u.version,
                "outcome": u.outcome,
                "tokens": u.tokens,
                "created_at": u.created_at,
            }
            for u in uses
        ],
        eval_cases=[
            {"id": c.id, "title": c.title, "input": c.input, "checks": c.checks} for c in cases
        ],
        last_eval=s.last_eval,
        proposals=[
            {"id": p.id, "kind": p.kind, "status": p.status, "created_at": p.created_at}
            for p in props
        ],
    )


# ---------------------------------------------------------------- library


@router.get("/skills")
async def list_skills(
    state: Literal["active", "retired", "all"] = "active",
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[SkillOut]:
    await store.ensure_builtin(db, await _ws(db, principal))
    q = select(Skill).where(Skill.workspace_id == principal.workspace_id)
    if state != "all":
        q = q.where(Skill.status == state)
    return await _skills_out(db, list((await db.scalars(q.order_by(Skill.name))).all()))


@router.get("/skills/{skill_id}")
async def get_skill(
    skill_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> SkillDetail:
    return await _detail(db, await _skill(db, principal, skill_id))


@router.post("/skills", status_code=status.HTTP_201_CREATED)
async def create_skill(
    body: SkillIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Approvers publish straight away; others create a proposal."""
    ws = await _ws(db, principal)
    try:
        sp = await store.propose(
            db,
            ws,
            name=body.name,
            description=body.description,
            body=body.body,
            reason=body.note or f"Written by {principal.user.name}.",
            proposed_by=principal.actor,
        )
        if _can_publish(principal):
            s = await store.approve(db, ws, sp, _author(principal))
            return {"skill": (await _detail(db, s)).model_dump(), "proposal": None}
    except (store.SkillError, fmt.SkillFormatError) as e:
        raise _bad(e) from e
    return {"skill": None, "proposal": (await _proposal_out(db, sp)).model_dump()}


@router.patch("/skills/{skill_id}")
async def update_skill(
    skill_id: str,
    body: SkillUpdateIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ws = await _ws(db, principal)
    s = await _skill(db, principal, skill_id)
    publish = _can_publish(principal)
    if (body.agent_ids is not None or body.status is not None) and not publish:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "forbidden",
            "Only approvers can change who uses a skill or retire it.",
        )
    if body.agent_ids is not None:
        s.agent_ids = list(dict.fromkeys(body.agent_ids))
        await db.commit()
    proposal = None
    try:
        if body.status == "retired" and s.status == "active":
            sp = await store.propose(
                db,
                ws,
                kind="retire",
                skill=s,
                name=s.name,
                description=s.description,
                body=s.body,
                reason=body.note or "Retired by hand.",
                proposed_by=principal.actor,
            )
            await store.approve(db, ws, sp, _author(principal))
        elif body.status == "active" and s.status == "retired":
            s.status = "active"
            await db.commit()
        if body.body is not None or body.description is not None:
            sp = await store.propose(
                db,
                ws,
                kind="patch",
                skill=s,
                name=s.name,
                description=body.description if body.description is not None else s.description,
                body=body.body if body.body is not None else s.body,
                reason=body.note or f"Edited by {principal.user.name}.",
                proposed_by=principal.actor,
            )
            if publish:
                await store.approve(db, ws, sp, _author(principal))
            else:
                proposal = (await _proposal_out(db, sp)).model_dump()
    except (store.SkillError, fmt.SkillFormatError) as e:
        raise _bad(e) from e
    await db.refresh(s)
    return {"skill": (await _detail(db, s)).model_dump(), "proposal": proposal}


# ---------------------------------------------------------------- test cases and evals


@router.post("/skills/{skill_id}/cases", status_code=status.HTTP_201_CREATED)
async def add_case(
    skill_id: str,
    body: CaseIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    s = await _skill(db, principal, skill_id)
    checks = body.model_dump(exclude={"title", "input"}, exclude_none=True)
    checks = {k: v for k, v in checks.items() if v not in ([], "", None)}
    if not checks:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "no_checks",
            "Add at least one check, e.g. words the answer must contain.",
        )
    c = SkillEvalCase(
        workspace_id=s.workspace_id,
        skill_id=s.id,
        title=body.title.strip(),
        input=body.input,
        checks=checks,
        created_by=principal.actor,
        created_at=store._now(),
    )  # noqa: SLF001
    db.add(c)
    await db.commit()
    return {"id": c.id, "title": c.title, "input": c.input, "checks": c.checks}


@router.delete("/skills/{skill_id}/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    skill_id: str,
    case_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _skill(db, principal, skill_id)
    c = await db.get(SkillEvalCase, case_id)
    if c is None or c.skill_id != skill_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "case_not_found", "That test case is not here.")
    await db.delete(c)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _start_eval(kind: str, target: str) -> dict[str, str]:
    try:
        return {"workflow_id": await dispatch.start_skill_eval(kind, target)}
    except Exception as e:  # noqa: BLE001
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "worker_unavailable",
            "The background worker is not reachable, so the tests cannot run.",
        ) from e


@router.post("/skills/{skill_id}/evals/run", status_code=status.HTTP_202_ACCEPTED)
async def run_evals(
    skill_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    s = await _skill(db, principal, skill_id)
    n = await db.scalar(
        select(func.count()).select_from(SkillEvalCase).where(SkillEvalCase.skill_id == s.id)
    )
    if not n:
        raise api_error(status.HTTP_409_CONFLICT, "no_cases", "Add a test case first.")
    return await _start_eval("skill", s.id)


# ---------------------------------------------------------------- proposals


class ProposalListOut(BaseModel):
    """A review-queue row: light. The full body, the skill's current and merged bodies, the
    test cases and the per-case test outputs come from GET /api/skill-proposals/{id}."""

    id: str
    kind: str
    name: str
    description: str
    body: str  # first BODY_PREVIEW characters
    body_truncated: bool
    base_version: int | None
    current: dict[str, Any] | None  # version, description, status (no body)
    other: dict[str, Any] | None  # name, description (no body)
    stale: bool
    reason: str
    eval_case_count: int
    scan: list[dict[str, Any]]
    eval: dict[str, Any] | None  # suites keep passed/total/tokens/error; `cases` is emptied
    proposed_by: str
    proposed_by_name: str
    agent_id: str | None
    source_task: dict[str, Any] | None
    status: str
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime


BODY_PREVIEW = 1000


def _suite_summary(suite: Any) -> Any:
    """An eval suite without its per-case outputs (the heavy part); same shape, empty cases."""
    if not isinstance(suite, dict):
        return suite
    return {**suite, "cases": []} if "cases" in suite else suite


async def _proposals_list(db: AsyncSession, rows: list[SkillProposal]) -> list[ProposalListOut]:
    """Many proposals in four queries (not five per row)."""
    from ...models import LLMCall

    skill_ids = {x for sp in rows for x in (sp.skill_id, sp.other_skill_id) if x}
    skills = (
        {s.id: s for s in (await db.scalars(select(Skill).where(Skill.id.in_(skill_ids)))).all()}
        if skill_ids
        else {}
    )
    names = await _names(db, {x for sp in rows for x in (sp.proposed_by, sp.decided_by or "") if x})
    task_ids = {sp.source_task_id for sp in rows if sp.source_task_id}
    tasks = (
        dict((await db.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids)))).all())
        if task_ids
        else {}
    )
    tokens = (
        dict(
            (
                await db.execute(
                    select(
                        LLMCall.task_id,
                        func.coalesce(
                            func.sum(LLMCall.prompt_tokens + LLMCall.completion_tokens), 0
                        ),
                    )
                    .where(LLMCall.task_id.in_(list(tasks)), LLMCall.task == "agent.task")
                    .group_by(LLMCall.task_id)
                )
            ).all()
        )
        if tasks
        else {}
    )
    out = []
    for sp in rows:
        skill = skills.get(sp.skill_id or "")
        other = skills.get(sp.other_skill_id or "")
        ev = sp.eval
        out.append(
            ProposalListOut(
                id=sp.id,
                kind=sp.kind,
                name=sp.name,
                description=sp.description,
                body=sp.body[:BODY_PREVIEW],
                body_truncated=len(sp.body) > BODY_PREVIEW,
                base_version=sp.base_version,
                current={
                    "version": skill.version,
                    "description": skill.description,
                    "status": skill.status,
                }
                if skill
                else None,
                other={"name": other.name, "description": other.description} if other else None,
                stale=bool(
                    skill
                    and sp.base_version
                    and skill.version != sp.base_version
                    and sp.status == "pending"
                ),
                reason=sp.reason,
                eval_case_count=len(sp.eval_cases or []),
                scan=sp.scan or [],
                eval={k: _suite_summary(v) for k, v in ev.items()}
                if isinstance(ev, dict)
                else None,
                proposed_by=sp.proposed_by,
                proposed_by_name={"curator": "Nightly curator", "vault": "Vault edit"}.get(
                    sp.proposed_by
                )
                or names.get(sp.proposed_by, "Someone"),
                agent_id=sp.agent_id,
                source_task={
                    "id": sp.source_task_id,
                    "title": tasks[sp.source_task_id],
                    "tokens": int(tokens.get(sp.source_task_id, 0)),
                }
                if sp.source_task_id in tasks
                else None,
                status=sp.status,
                decided_by_name=names.get(sp.decided_by) if sp.decided_by else None,
                decided_at=sp.decided_at,
                decision_note=sp.decision_note,
                created_at=sp.created_at,
            )
        )
    return out


@router.get("/skill-proposals")
async def list_proposals(
    state: Literal["pending", "decided", "all"] = "pending",
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProposalListOut]:
    q = select(SkillProposal).where(SkillProposal.workspace_id == principal.workspace_id)
    if state == "pending":
        q = q.where(SkillProposal.status == "pending")
    elif state == "decided":
        q = q.where(SkillProposal.status != "pending")
    rows = list((await db.scalars(q.order_by(SkillProposal.created_at.desc()).limit(100))).all())
    return await _proposals_list(db, rows)


@router.get("/skill-proposals/{proposal_id}")
async def get_proposal(
    proposal_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> ProposalOut:
    return await _proposal_out(db, await _proposal(db, principal, proposal_id))


@router.post("/skill-proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: str,
    body: ApproveIn,
    principal: Principal = Depends(require("approvals.decide")),
    db: AsyncSession = Depends(get_db),
) -> SkillDetail:
    sp = await _proposal(db, principal, proposal_id)
    try:
        s = await store.approve(
            db,
            await _ws(db, principal),
            sp,
            _author(principal),
            description=body.description,
            body=body.body,
        )
    except (store.SkillError, fmt.SkillFormatError) as e:
        raise _bad(e) from e
    return await _detail(db, s)


@router.post("/skill-proposals/{proposal_id}/reject")
async def reject_proposal(
    proposal_id: str,
    body: RejectIn,
    principal: Principal = Depends(require("approvals.decide")),
    db: AsyncSession = Depends(get_db),
) -> ProposalOut:
    sp = await _proposal(db, principal, proposal_id)
    try:
        await store.reject(db, await _ws(db, principal), sp, _author(principal), body.reason)
    except store.SkillError as e:
        raise api_error(status.HTTP_409_CONFLICT, "already_decided", str(e)) from e
    return await _proposal_out(db, sp)


@router.post("/skill-proposals/{proposal_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
async def evaluate_proposal(
    proposal_id: str,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    sp = await _proposal(db, principal, proposal_id)
    return await _start_eval("proposal", sp.id)
