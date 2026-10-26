"""P41: the Recruiter, an agent that researches a job and drafts the blueprint for an AI
agent that does it well.

Given a role ("purchasing officer at a construction company"), the Recruiter runs as an
ordinary task with research tools (the web through its own browser and the search engine, the
company Library and SOPs). It then calls draft_blueprint once. That tool saves:
- a Blueprint (source "analyst"): the job description the agent works from, its tools and
  their modes, its model group;
- starter skills as proposals (evaluated, then live as the learning rules allow);
- draft SOPs where the company has none (never live until a person activates them).
A person reviews the blueprint and applies it to a new or an existing agent.
"""

import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SOP, Agent, Blueprint, Branch, Department, Task
from .tools import TOOLS, Tool, ToolContext

RECRUITER_TEMPLATE = "recruiter"
MODES = ("allow", "ask", "deny")
GROUPS = ("smart", "fast", "bulk", "reasoning")
MAX_SKILLS = 5
MAX_SOPS = 3
MIN_SOUL = 300
# Outward actions never start as "allow" in a drafted blueprint: a person decides each time.
NEVER_ALLOW = frozenset(
    {"browser_submit", "browser_upload", "pc_save_to_pc", "email_draft", "notify_person",
     "run_python", "tool_call", "outlook_draft", "create_invoice_draft"}
)  # fmt: skip

RECRUITER_TOOLS = {
    "research_gather": "allow",
    "web_search": "allow",
    "web_fetch": "allow",
    "search_library": "allow",
    "search_documents": "allow",
    "company_documents": "allow",
    "find_sop": "allow",
    "draft_blueprint": "allow",
}

SOUL = (
    "You are the office's Recruiter. You research jobs and design AI agents that can do them. "
    "For each role you are given, find out what a capable person in that job does day to day "
    "in a Malaysian company of that kind: duties, recurring tasks and their steps, documents and "
    "systems used, deadlines, KPIs, the laws, authorities and standards involved, common "
    "mistakes and what must always be checked by a person. Use the web (research_gather first, "
    "then web_fetch for important pages) and the company's own Library and SOPs, which win over "
    "general practice. Then call draft_blueprint once, with instructions an agent can work "
    "from directly. Cite your main sources. Never invent a regulation, a form number or a rate: "
    "if you could not confirm one, say so in the instructions."
)


def brief(role: str, company: str, industry: str, notes: str) -> str:
    where = f" at {company}" + (f" ({industry})" if industry else "") if company else ""
    return (
        f"Design an AI agent for this job: {role}{where}.\n"
        + (f"What the owner says about it: {notes}\n" if notes else "")
        + "\n1. Research the job (research_gather, web_search, web_fetch) and how this company "
        "does it (search_library, find_sop, company_documents): duties, recurring tasks step by "
        "step, documents, systems, deadlines, KPIs, laws and authorities (for example LHDN, "
        "SSM, KWSP, PERKESO, CIDB, DOSH where they apply), common mistakes, what needs a "
        "person's approval.\n"
        "2. Call draft_blueprint once: instructions written to the agent ('You are...'), a "
        "section per main task with its steps and checks, what it must ask a person first, "
        "what it must never do; the tools it needs; up to 5 starter skills for its most "
        "frequent tasks; up to 3 SOP drafts only for procedures the company has none for; "
        "your main sources.\n"
        "3. Answer with a short summary of the blueprint and the sources."
    )


async def ensure_recruiter(db: AsyncSession, workspace_id: str, branch_id: str | None) -> Agent:
    """The workspace's Recruiter (made on first use, in the given or first company)."""
    found = await db.scalar(
        select(Agent).where(
            Agent.workspace_id == workspace_id,
            Agent.template == RECRUITER_TEMPLATE,
            Agent.status != "retired",
        )
    )
    if found is not None:
        return found
    branch = await db.get(Branch, branch_id) if branch_id else None
    if branch is None:
        branch = await db.scalar(
            select(Branch).where(Branch.workspace_id == workspace_id).order_by(Branch.created_at)
        )
    if branch is None:
        raise ValueError("Add a company first: the Recruiter works in one.")
    depts = list(
        (
            await db.scalars(
                select(Department)
                .where(Department.branch_id == branch.id)
                .order_by(Department.position)
            )
        ).all()
    )
    dept = next((d for d in depts if re.search(r"\b(hr|human|admin)", d.name, re.I)), None)
    dept = dept or (depts[0] if depts else None)
    if dept is None:
        raise ValueError("Add a department to the company first: the Recruiter sits in one.")
    taken = int(
        await db.scalar(
            select(func.count())
            .select_from(Agent)
            .where(Agent.workspace_id == workspace_id, Agent.slug.like("recruiter%"))
        )
        or 0
    )
    a = Agent(
        workspace_id=workspace_id,
        branch_id=branch.id,
        department_id=dept.id,
        slug="recruiter" if not taken else f"recruiter-{taken + 1}",
        name="Rania (Recruiter)",
        role="AI Recruiter",
        template=RECRUITER_TEMPLATE,
        role_kind="leaf",
        soul=SOUL,
        model_group="smart",
        tools=dict(RECRUITER_TOOLS),
        autonomy="ask",
        heartbeat=False,
        color="#7a5af5",
    )
    db.add(a)
    await db.flush()
    return a


def _tools(raw: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    for name, mode in raw.items():
        name, mode = str(name), str(mode).lower()
        if name not in TOOLS or mode not in MODES or name == "draft_blueprint":
            continue
        if mode == "allow" and (name in NEVER_ALLOW or TOOLS[name].risk == "high"):
            mode = "ask"
        out[name] = mode
    return out


async def _draft_blueprint(ctx: ToolContext, args: dict[str, Any]) -> str:
    from ..services import audit
    from ..skills import store as skill_store

    name = " ".join(str(args.get("name") or "").split())[:80]
    role = " ".join(str(args.get("role") or "").split())[:120]
    soul = str(args.get("instructions") or "").strip()
    if not name or not role:
        return "Error: give the blueprint a name and the role."
    if len(soul) < MIN_SOUL:
        return (
            f"Error: the instructions are too short ({len(soul)} characters): write the full "
            "job description with each main task's steps and checks."
        )
    group = str(args.get("model_group") or "smart")
    taken = await ctx.db.scalar(
        select(func.count())
        .select_from(Blueprint)
        .where(Blueprint.workspace_id == ctx.workspace.id, Blueprint.name.like(f"{name}%"))
    )
    if taken:
        name = f"{name[:72]} (v{int(taken) + 1})"
    sources = [str(s)[:300] for s in (args.get("sources") or []) if str(s).strip()][:15]
    if sources:
        soul += "\n\nSources the Recruiter used:\n" + "\n".join(f"- {s}" for s in sources)
    sop_ids: list[str] = []
    for s in (args.get("sops") or [])[:MAX_SOPS]:
        if not isinstance(s, dict) or not str(s.get("title") or "").strip():
            continue
        sop = SOP(
            workspace_id=ctx.workspace.id,
            scope="library",
            scope_id=None,
            title=str(s["title"]).strip()[:160],
            body=str(s.get("body") or "").strip()[:20_000],
            status="draft",  # never followed until a person activates it
            updated_by=f"agent:{ctx.agent.id}",
        )
        ctx.db.add(sop)
        await ctx.db.flush()
        sop_ids.append(sop.id)
    bp = Blueprint(
        workspace_id=ctx.workspace.id,
        branch_id=None,
        name=name,
        description=" ".join(str(args.get("description") or role).split())[:300],
        role=role,
        soul=soul[:8000],
        model_group=group if group in GROUPS else "smart",
        tools=_tools(args.get("tools")),
        autonomy="ask",
        sop_ids=sop_ids,
        skill_ids=[],
        color="#2f6db5",
        source="analyst",
        created_by=f"agent:{ctx.agent.id}",
    )
    ctx.db.add(bp)
    await ctx.db.flush()
    proposed = []
    for s in (args.get("skills") or [])[:MAX_SKILLS]:
        if not isinstance(s, dict):
            continue
        try:
            p = await skill_store.propose(
                ctx.db,
                ctx.workspace,
                name=str(s.get("name") or ""),
                description=str(s.get("description") or ""),
                body=str(s.get("body") or ""),
                reason=f"Starter skill for the blueprint {name}, from the Recruiter's research.",
                proposed_by=f"agent:{ctx.agent.id}",
                agent=ctx.agent,
                source_task_id=ctx.task.id if ctx.task else None,
            )
            proposed.append(p.name)
        except Exception as e:  # noqa: BLE001 - one malformed skill does not lose the blueprint
            proposed.append(f"(not saved: {str(e)[:80]})")
    await audit.record(
        ctx.db,
        ctx.workspace.id,
        f"agent:{ctx.agent.id}",
        "blueprint.drafted",
        target=bp.id,
        after={"name": bp.name, "role": role, "skills": proposed, "sops": len(sop_ids)},
    )
    await ctx.db.commit()
    return (
        f"Saved the blueprint {bp.name!r} (id {bp.id}) with {len(bp.tools)} tools, "
        f"{len(sop_ids)} draft SOP(s) and {len(proposed)} starter skill(s) proposed: "
        f"{', '.join(proposed) or 'none'}. A person reviews it in Blueprints and applies it."
    )


DRAFT_BLUEPRINT = Tool(
    "draft_blueprint",
    "Draft an agent blueprint",
    "Save the blueprint for an AI agent that does a job you researched: its instructions (the "
    "full job description written to the agent), the tools it needs with allow/ask/deny, "
    "starter skills for its most frequent tasks, draft SOPs where the company has none, and "
    "your sources. A person reviews it before it is used. Call it once per role.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Blueprint name, e.g. Purchasing Officer"},
            "role": {"type": "string", "description": "Job title the agent will have"},
            "description": {"type": "string", "description": "One sentence: what it does"},
            "instructions": {
                "type": "string",
                "description": "The job description written to the agent ('You are...'): "
                "duties, each main task's steps and checks, what to ask a person first, "
                "what never to do. Markdown, 300-7000 characters.",
            },
            "tools": {
                "type": "object",
                "description": "Tool name -> allow | ask | deny, e.g. "
                '{"web_search": "allow", "draft_document": "allow", "email_draft": "ask"}',
            },
            "model_group": {"type": "string", "enum": list(GROUPS)},
            "skills": {
                "type": "array",
                "description": "Up to 5 procedures for its most frequent tasks",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "kebab-case"},
                        "description": {"type": "string"},
                        "body": {
                            "type": "string",
                            "description": "Markdown: When to use, Steps, Output format, Pitfalls",
                        },
                    },
                    "required": ["name", "description", "body"],
                },
            },
            "sops": {
                "type": "array",
                "description": "Up to 3 SOP drafts, only where the company has none",
                "items": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
                    "required": ["title", "body"],
                },
            },
            "sources": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name", "role", "instructions", "tools"],
    },
    "low",
    "deny",  # only the Recruiter is given it (RECRUITER_TOOLS)
    _draft_blueprint,
)


async def recruit(
    db: AsyncSession,
    *,
    workspace_id: str,
    role: str,
    notes: str,
    branch_id: str | None,
    actor: str,
) -> Task:
    """A research task for the Recruiter. The caller launches it."""
    agent = await ensure_recruiter(db, workspace_id, branch_id)
    branch = await db.get(Branch, branch_id or agent.branch_id)
    t = Task(
        workspace_id=workspace_id,
        branch_id=agent.branch_id,
        title=f"Design an AI agent: {role}"[:200],
        brief=brief(
            role, branch.name if branch else "", (branch.industry if branch else ""), notes
        ),
        priority="normal",
        assignee_agent_id=agent.id,
        created_by=actor,
        source="manual",
        requires_review=False,
        labels=["recruit"],
        status="triage",
    )
    db.add(t)
    await db.flush()
    t.root_task_id = t.id
    await db.commit()
    return t
