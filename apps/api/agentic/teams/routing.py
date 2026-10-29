"""P55: who should do this job? The Chief of Staff hands work to the best-suited agent
without the owner naming one ("file these documents" goes to the admin clerk, "chase the
overdue invoices" to the finance clerk).

Each candidate is described by what it is for (role, department, instructions, the skills it
may use, its abilities from its tools) and matched to the job by meaning (embeddings) and by
words, so it still works where the embedding model is off. A free agent beats a busy one
when they fit about as well. No model call, no tokens.
"""

import math
import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brain import embed
from ..models import Agent, Department, Task

WORD = re.compile(r"[a-z0-9]+")
# Too common to say anything about who should do a job.
STOP = frozenset(
    "a an and are as at be by can do for from have help i in is it me my of on or our please "
    "should so some that the their them these this those to up us we will with you your all "
    "any get make need want tolong saya kami nak boleh dan untuk yang ini itu ke di dengan".split()
)
# What a tool lets an agent do, in the words people use when they ask for that work.
ABILITY = {
    "draft_document": "write letters quotations proposals documents surat",
    "export_document": "pdf word excel documents",
    "file_document": "file organise folders filing documents fail",
    "compile_documents": "compile combine merge documents pack",
    "fill_form": "fill forms borang",
    "browser_open": "browse websites portals online",
    "web_search": "research web search find out",
    "research_gather": "research web sources",
    "create_invoice_draft": "invoice billing accounts",
    "capture_bill": "bills expenses receipts accounts",
    "run_python": "spreadsheet numbers analysis charts",
    "meeting_minutes": "meeting minutes",
    "send_email": "email send reply",
}
BUSY_PENALTY = 0.04  # per open task, up to 3
MIN_SCORE = 0.05


@dataclass
class Pick:
    agent: Agent
    score: float
    why: str


def _words(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if w not in STOP and len(w) > 2}


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


async def profile(db: AsyncSession, a: Agent, dept_names: dict[str, str]) -> str:
    """What this agent is for, in plain words."""
    from ..skills.store import visible

    skills = [f"{s.name.replace('-', ' ')}: {s.description}" for s in await visible(db, a)]
    tools = a.tools or {}
    abilities = [ABILITY[t] for t, mode in tools.items() if mode != "deny" and t in ABILITY]
    parts = [
        f"{a.name}, {a.role}",
        dept_names.get(a.department_id or "", ""),
        (a.soul or "")[:700],
        "; ".join(skills[:12]),
        " ".join(abilities),
    ]
    return "\n".join(p for p in parts if p)


async def rank(db: AsyncSession, candidates: list[Agent], job: str, limit: int = 3) -> list[Pick]:
    """The best-suited agents for `job`, best first (empty when nothing fits at all)."""
    if not candidates or not job.strip():
        return []
    depts = {
        d.id: d.name
        for d in (
            await db.scalars(
                select(Department).where(
                    Department.id.in_({a.department_id for a in candidates if a.department_id})
                )
            )
        ).all()
    }
    texts = [await profile(db, a, depts) for a in candidates]
    open_tasks = dict(
        (
            await db.execute(
                select(Task.assignee_agent_id, func.count())
                .where(
                    Task.assignee_agent_id.in_([a.id for a in candidates]),
                    Task.status.in_(("ready", "running", "blocked")),
                )
                .group_by(Task.assignee_agent_id)
            )
        ).all()
    )
    vecs = await embed.embed([job, *texts])
    want = _words(job)
    picks: list[Pick] = []
    for i, (a, text) in enumerate(zip(candidates, texts, strict=True)):
        have = _words(text)
        shared = sorted(want & have)
        by_words = len(shared) / max(len(want), 1)
        by_meaning = _cos(vecs[0], vecs[i + 1]) if vecs else 0.0
        score = 0.6 * by_meaning + 0.4 * by_words if vecs else by_words
        busy = min(int(open_tasks.get(a.id, 0)), 3)
        score -= BUSY_PENALTY * busy
        if score < MIN_SCORE:
            continue
        why = f"its role ({a.role})"
        if shared:
            why += " fits " + ", ".join(shared[:4])
        if busy:
            why += f"; {busy} open task{'s' if busy > 1 else ''}"
        picks.append(Pick(a, score, why))
    picks.sort(key=lambda p: p.score, reverse=True)
    return picks[:limit]
