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
    # P19 finance and management starters. They lean on finance_calc and forecast, which do
    # the maths deterministically, so the model only chooses inputs and explains.
    (
        "cash-flow-forecast",
        "Forecast the next months of cash in, cash out and closing balance from past monthly "
        "figures, with a range and the months where cash runs short.",
        """## When to use
Someone asks how cash will look in the coming months, whether there is enough to pay a
commitment, or wants a 3, 6 or 12 month cash-flow projection.

## Steps
1. Collect at least 6 months (ideally 24) of monthly cash in and cash out, oldest first, and the
   opening bank balance. Use read_file for statements or ask_human for what is missing.
2. Run forecast separately for cash in and for cash out (season_length 12 when you have two
   years or more; last_period as YYYY-MM so months are labelled).
3. Add known one-off items people told you about (a loan drawdown, a big payment, bonus month)
   on top of the forecast, and list them.
4. Closing balance each month = opening + cash in - cash out. Use calc for the running total.
5. Flag every month where the closing balance falls below the minimum buffer (ask for it;
   default one month of cash out) and say how big the gap is.

## Output format
- One line: the lowest month, its closing balance, and whether action is needed.
- Table: month, cash in, cash out, net, closing balance, low and high (80% range).
- Assumptions and one-off items as a short list, then the forecast method from the tool.

## Pitfalls
- Never invent history. With fewer than 6 months say the projection is rough.
- Forecasts are ranges, not promises: give the 80% range, not only the point.
- Receivables are not cash until collected; use actual receipts, not invoices raised.
""",
    ),
    (
        "budget-variance",
        "Compare budget against actual by line, compute variances and percentages, and explain "
        "the few lines that matter.",
        """## When to use
Someone gives a budget and actual figures (monthly or year to date) and asks how the company
is doing against plan, or for a variance report.

## Steps
1. Line up budget and actual for each line; keep income and expense lines apart.
2. For each line use calc: variance = actual - budget, and variance % = variance / budget.
3. Mark each variance favourable or unfavourable: more income or less cost is favourable.
4. Pick the lines with the largest absolute variance (top 3 to 5) and those over 10%; for
   each, give the likely cause in one sentence and a question to confirm it (ask_human if a
   person must answer).
5. Total income, total expenses and net profit against budget at the bottom.

## Output format
- One line: net profit against budget, in RM and %.
- Table: line, budget, actual, variance, variance %, F/U.
- "What explains it" for the top lines, then "Actions".

## Pitfalls
- A favourable cost variance can mean work not done yet (timing), not savings. Say so.
- Do not compute percentages on a zero budget; write "n/a".
""",
    ),
    (
        "debtor-ageing",
        "Age outstanding customer invoices into 0-30, 31-60, 61-90 and over 90 days and draft "
        "a collection plan by customer.",
        """## When to use
Someone shares an invoice list or debtor report and asks who owes what, how old it is, or how
to collect it faster.

## Steps
1. For each unpaid invoice note customer, invoice number, date, due date and amount
   outstanding. Use time_now for today's date.
2. Days overdue = today - due date (use invoice date + credit term when there is no due date).
3. Put each into a bucket: current (not due), 1-30, 31-60, 61-90, over 90 days overdue.
   Use calc for every bucket and customer total.
4. Collection plan per customer, oldest and largest first: 1-30 a friendly reminder, 31-60 a
   call plus statement, 61-90 a firm letter and hold new credit, over 90 escalate to
   management (a person decides on legal action).
5. Draft reminder text if asked, but never send it: a person sends it.

## Output format
- One line: total outstanding and how much is over 90 days.
- Ageing table: customer, current, 1-30, 31-60, 61-90, over 90, total.
- Collection plan: customer, amount, action, owner, by when.

## Pitfalls
- Credit notes and part payments reduce the balance; apply them first.
- Do not threaten legal action in drafts; that is a decision for a person.
""",
    ),
    (
        "monthly-management-report",
        "Write a one-page monthly management report: revenue, profit, cash, debtors, key "
        "numbers against last month and budget, risks and decisions needed.",
        """## When to use
The owner or management asks for the month-end report, a business update or a board pack
summary.

## Steps
1. Gather this month's figures, last month's and the budget: revenue, gross profit, expenses,
   net profit, cash balance, debtors, creditors, and any operating numbers they track
   (orders, projects, tickets). Ask for what is missing rather than guessing.
2. Use finance_calc (calculation margin) for gross and net margins and calc for every change
   (amount and %) against last month and budget.
3. If there are 6 or more months of history, run forecast on revenue for the next 3 months.
4. Pick the 3 things management must know and the decisions you need from them.
5. Publish the report with publish_report (tables for the figures).

## Output format
- Headline (2-3 sentences).
- Key figures table: measure, this month, last month, change, budget, variance.
- Highlights, Risks, Decisions needed (bullets, each one line).

## Pitfalls
- Report numbers, not adjectives. Say "revenue fell 12%", not "a challenging month".
- Mark figures that are estimates or not yet reconciled.
""",
    ),
    (
        "pricing-margin-check",
        "Check a price or quotation against cost: margin, markup, break-even volume and the "
        "price needed for a target margin, before it goes to the customer.",
        """## When to use
Before a quotation, tender price or price change is sent, or when someone asks whether a price
is profitable or what to charge.

## Steps
1. Get the full unit cost: materials, labour, subcontract, delivery, and a share of overheads
   if the company uses one. List what was included.
2. Run finance_calc with calculation margin (cost and price) for margin and markup.
3. If there is a target margin, run finance_calc margin with margin_pct for the price needed.
4. If fixed costs for the job or product are known, run finance_calc break_even for the
   volume needed.
5. Check SST: is the price before or after tax? Use finance_calc sst when needed.
6. Recommend: keep, raise or lower, with the margin each option gives.

## Output format
- One line: the margin at the proposed price and whether it meets the target.
- Table: cost, price, margin, markup; then the price for the target margin.
- Assumptions (what cost includes), then the recommendation.

## Pitfalls
- Margin and markup are different: 30% markup is a 23.08% margin.
- Quote prices with or without SST explicitly.
""",
    ),
    (
        "financing-comparison",
        "Compare loan, hire-purchase or financing offers on instalment, total cost and true "
        "effective rate, flat against reducing balance.",
        """## When to use
Someone has two or more financing offers (bank loan, hire purchase, Islamic financing, lease)
for a vehicle, machine, property or working capital and asks which is cheaper.

## Steps
1. For each offer note amount financed, rate, whether the rate is flat or reducing balance
   (ask if unclear: hire purchase is usually flat), tenure, fees, and deposit.
2. Run finance_calc calculation loan for each offer with its method, schedule yearly.
3. Compare on the effective (reducing-balance) rate and the total paid including fees, not on
   the headline rate: a 3% flat rate costs about 5.6% a year over 5 years.
4. Note terms that change the real cost: early settlement (Rule of 78 rebate for flat-rate
   hire purchase), lock-in periods, insurance, balloon payments.
5. Recommend one, and say what would change the answer.

## Output format
- One line: the cheapest offer and by how much in total.
- Table: offer, amount, rate quoted, effective rate, instalment, total interest, total paid.
- Terms to watch, then the recommendation.

## Pitfalls
- Never compare a flat rate with a reducing-balance rate directly.
- Islamic financing quotes a profit rate; treat it the same way for the comparison.
""",
    ),
]

# Tests for the built-in skills: run from the Skills page like any skill's eval cases.
BUILTIN_CASES: dict[str, list[dict[str, Any]]] = {
    "cash-flow-forecast": [
        {
            "title": "Six-month projection with a shortfall",
            "input": "Opening balance RM 40,000. Cash in Apr-Sep: 52000, 48000, 55000, 50000, "
            "53000, 51000. Cash out Apr-Sep: 50000, 51000, 54000, 56000, 55000, 57000. "
            "Project the next 3 months.",
            "must_call": ["forecast"],
            "must_contain": ["closing"],
            "rubric": "Gives a month-by-month table with closing balances, states a range or "
            "uncertainty, and points out whether cash runs short.",
        },
    ],
    "budget-variance": [
        {
            "title": "Revenue below budget, costs above",
            "input": "Budget: revenue 200000, salaries 80000, rent 12000. Actual: revenue "
            "180000, salaries 85000, rent 12000. Variance report please.",
            "must_contain": ["unfavourable", "20,000"],
            "rubric": "Shows variance and variance % per line, marks revenue and salaries "
            "unfavourable, and states net profit against budget (RM 25,000 worse).",
        },
    ],
    "debtor-ageing": [
        {
            "title": "Buckets and a plan",
            "input": "Today is 2026-10-01. Unpaid: Alpha Sdn Bhd INV-101 due 2026-09-20 RM "
            "5,000; Beta Trading INV-088 due 2026-06-15 RM 12,000; Alpha Sdn Bhd INV-110 due "
            "2026-10-15 RM 3,000.",
            "must_contain": ["90"],
            "rubric": "Beta Trading's RM 12,000 is over 90 days overdue and escalated to "
            "management; Alpha's INV-101 is 1-30 days; INV-110 is current; totals are right.",
        },
    ],
    "monthly-management-report": [
        {
            "title": "Month-end summary",
            "input": "September: revenue 310000 (Aug 290000, budget 300000), gross profit "
            "93000, net profit 21000, cash 145000, debtors 220000. Write the management report.",
            "must_contain": ["revenue"],
            "rubric": "Has a headline, a key figures table with change against last month and "
            "budget, and lists risks (e.g. high debtors) and decisions needed.",
        },
    ],
    "pricing-margin-check": [
        {
            "title": "Markup is not margin",
            "input": "Our cost is RM 1,000 and sales wants to quote RM 1,300. We target a 30% "
            "margin. Is the price OK?",
            "must_call": ["finance_calc"],
            "rubric": "Says RM 1,300 is a 23.08% margin (30% markup), below the 30% target, "
            "and that about RM 1,428.57 is needed for a 30% margin.",
        },
    ],
    "financing-comparison": [
        {
            "title": "Flat against reducing",
            "input": "Offer A: hire purchase RM 50,000 at 3% flat for 5 years. Offer B: bank "
            "loan RM 50,000 at 5% reducing balance for 5 years. Which is cheaper?",
            "must_call": ["finance_calc"],
            "must_contain": ["effective"],
            "rubric": "Converts the flat rate to an effective rate (about 5.6%) and compares "
            "total interest: A about RM 7,500, B about RM 6,614; recommends B.",
        },
    ],
}

# The starters every workspace had before P19, so older workspaces gain only the new ones.
_FIRST_BUILTIN = ("compare-quotes", "meeting-notes")


async def ensure_builtin(db: AsyncSession, ws: Workspace) -> None:
    """Add the built-in starters a workspace has not had yet. Each is seeded once (recorded
    in workspace settings), so a starter someone deleted does not come back."""
    seeded_key = "builtin_skills"
    all_names = {b[0] for b in BUILTIN}
    settings = dict(ws.settings or {})
    seeded = settings.get(seeded_key)
    if isinstance(seeded, list) and all_names <= set(seeded):
        return  # the usual case: one dict lookup, no query
    if not isinstance(seeded, list):
        have = await db.scalar(
            select(func.count()).select_from(Skill).where(Skill.workspace_id == ws.id)
        )
        seeded = list(_FIRST_BUILTIN) if have else []
    existing = set((await db.scalars(select(Skill.name).where(Skill.workspace_id == ws.id))).all())
    todo = [b for b in BUILTIN if b[0] not in seeded and b[0] not in existing]
    settings[seeded_key] = sorted({*seeded, *all_names})
    ws.settings = settings
    if not todo:
        await db.commit()
        return
    vectors = await embed.embed([f"{n}: {d}" for n, d, _ in todo]) or [None] * len(todo)
    for (name, description, body), vec in zip(todo, vectors, strict=True):
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
        for c in BUILTIN_CASES.get(name, []):
            db.add(
                SkillEvalCase(
                    workspace_id=ws.id,
                    skill_id=s.id,
                    title=c["title"],
                    input=c["input"],
                    checks={k: v for k, v in c.items() if k not in ("title", "input")},
                    created_by="system",
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
