"""After work: pull durable facts out of a finished task or a chat turn, and log it.

Runs in the worker (Temporal activities), never in the request path.
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, AgentMessage, ChatSession, Task, Workspace
from . import facts, store
from .scope import for_agent

log = logging.getLogger("agentic.brain.learn")

MIN_CHAT_CHARS = 25
TOOL_RESULT_CHARS = 600


def _transcript(task: Task | None, msgs: list[AgentMessage]) -> str:
    out = []
    if task is not None:
        out.append(f"TASK: {task.title}\n{task.brief}".strip())
    for m in msgs:
        if not m.content:
            continue
        if m.role == "tool":
            out.append(f"TOOL {m.name}: {m.content[:TOOL_RESULT_CHARS]}")
        else:
            out.append(f"{m.role.upper()}: {m.content}")
    return "\n\n".join(out)


RESEARCH_TOOLS = frozenset({"research_gather", "web_search", "web_fetch", "browser_read"})
MIN_FINDINGS = 200
MAX_SOURCES = 15
_URL = re.compile(r"https?://[^\s<>\"')\]]+")


async def save_research(
    db: AsyncSession, task: Task, agent: Agent, ws: Workspace, msgs: list[AgentMessage]
) -> str | None:
    """P39: what an agent found on the web becomes a wiki page in the office's shared brain
    (wiki/research/...): the question, the findings and the sources. Every later task and
    chat recalls it (brain/recall.py), so the office does not research the same thing twice.
    Returns the page path, or None when the task did no web research."""
    if task.status not in ("review", "done") or agent.private:
        return None
    findings = (task.result or "").strip()
    used = [m for m in msgs if m.role == "tool" and m.name in RESEARCH_TOOLS and m.content]
    if len(findings) < MIN_FINDINGS or not used:
        return None
    sources: list[str] = []
    for m in used:
        for url in _URL.findall(m.content or ""):
            url = url.rstrip(".,;:")
            if url not in sources and "duckduckgo.com" not in url:
                sources.append(url)
    if not sources:
        return None
    from datetime import UTC, datetime

    from ..core.redact import redact
    from ..models import Branch
    from ..services.text import slugify

    now = datetime.now(UTC)
    path = f"wiki/research/{now:%Y-%m}-{slugify(task.title, 'research')[:60]}.md"
    own = await db.get(Branch, agent.branch_id) if agent.branch_id else None
    if own is not None and own.isolated:  # an isolated company keeps its research
        path = f"branches/{own.slug}/{path}"
    body = (
        f"# {task.title.strip()}\n\n"
        f"_Researched by {agent.name} on {now:%Y-%m-%d} (task {task.id})._\n\n"
        f"## Question\n\n{(task.brief or task.title).strip()[:2000]}\n\n"
        f"## Findings\n\n{findings[:8000]}\n\n"
        "## Sources\n\n" + "\n".join(f"- {u}" for u in sources[:MAX_SOURCES]) + "\n"
    )
    await store.save_page(
        db,
        ws,
        path,
        redact(body),
        store.Author(f"agent:{agent.id}", agent.name),
        f"Research: {task.title[:150]}",
    )
    return path


async def learn_from_task(db: AsyncSession, task_id: str) -> facts.Learned | None:
    task = await db.get(Task, task_id)
    if (
        task is None
        or task.assignee_agent_id is None
        or task.status not in ("review", "done", "failed")
    ):
        return None
    agent = await db.get(Agent, task.assignee_agent_id)
    ws = await db.get(Workspace, task.workspace_id)
    if agent is None or ws is None:
        return None
    msgs = list(
        (
            await db.scalars(
                select(AgentMessage)
                .where(AgentMessage.task_id == task.id)
                .order_by(AgentMessage.id)
            )
        ).all()
    )
    try:
        await save_research(db, task, agent, ws, msgs)
    except Exception:  # noqa: BLE001 - the page is extra; facts are learned regardless
        await db.rollback()
        log.warning("could not save research of %s", task.id, exc_info=True)
    learned = await facts.learn(
        db,
        agent,
        await for_agent(db, agent),
        _transcript(task, msgs),
        source_kind="task",
        source_id=task.id,
        source_label=f'task "{task.title[:120]}"',
    )
    await store.append_log(
        db,
        ws,
        f'{agent.name} finished "{task.title[:100]}" ({task.status}); memory: {learned.summary()}',
        store.Author(f"agent:{agent.id}", agent.name),
    )
    return learned


async def learn_from_chat(db: AsyncSession, message_id: int) -> facts.Learned | None:
    """`message_id` is the agent's reply; the person's message before it is the input."""
    reply = await db.get(AgentMessage, message_id)
    if reply is None or reply.session_id is None or reply.role != "assistant":
        return None
    asked = await db.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.session_id == reply.session_id,
            AgentMessage.role == "user",
            AgentMessage.id < reply.id,
        )
        .order_by(AgentMessage.id.desc())
        .limit(1)
    )
    if asked is None or len(asked.content or "") < MIN_CHAT_CHARS:
        return None
    agent = await db.get(Agent, reply.agent_id)
    session = await db.get(ChatSession, reply.session_id)
    if agent is None or session is None:
        return None
    return await facts.learn(
        db,
        agent,
        await for_agent(db, agent),
        _transcript(None, [asked, reply]),
        source_kind="chat",
        source_id=session.id,
        source_label=f'chat "{session.title[:120]}"',
    )
